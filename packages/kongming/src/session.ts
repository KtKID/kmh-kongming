/** 固定会话运行时：复用生产 Session Controller 的创建、恢复和模型选择。 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-api-session-controller";
import type {} from "@deepseek-ai/dsh-workspace";
import type {} from "@kmh/kongming/events";
import type { Config } from "./config.ts";
import { validateProjectDir, type RuntimePaths } from "./paths.ts";
import { BindingStore } from "./state.ts";
import { mountPrompt } from "./prompt.ts";
import { KongmingControl } from "./control.ts";
import type { Binding, EnsureResult } from "./protocol/index.ts";
export type { RuntimePaths } from "./paths.ts";
/** 孔明固定会话运行时。 */
export class KongmingRuntime {
  private readonly store: BindingStore;
  private pending: Promise<EnsureResult> | undefined;
  private restoring: Promise<void> | undefined;
  private agent: Agent | undefined;
  private closed = false;
  private closing: Promise<void> | undefined;
  private binding: Binding | undefined;
  private boundControl: KongmingControl | undefined;
  private readonly prompts = new Map<Agent, () => void>();
  constructor(
    readonly ctx: Context,
    readonly config: Config,
    readonly paths: RuntimePaths,
  ) {
    this.store = new BindingStore(paths.home);
    ctx.on("agent/created", ({ agent }) => {
      if (!this.closed && agent.id === this.binding?.sessionId)
        this.bindPrompt(agent);
    });
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- DSH emit 调度会接管异步清理观察器的拒绝。
    ctx.on("agent/disposed", async ({ agent }) => {
      await this.releaseAgent(agent);
    });
    ctx.on("kongming/visit-agents", async (visit) => {
      if (!this.closed && this.agent !== undefined) await visit(this.agent);
    });
    ctx.effect(() => () => this.close(), "kmh-kongming: settle runtime");
  }
  /** 恢复已有身份的提示词绑定；首次启动保留按需创建，读取失败向调用者报告。 */
  restoreExisting(): Promise<void> {
    return (this.restoring ??= this.restoreOnce());
  }
  private async restoreOnce(): Promise<void> {
    const binding = await this.store.readExisting();
    if (binding === undefined || this.closed) return;
    this.binding = binding;
    const agent = this.ctx.agents.get(SessionId(binding.sessionId));
    if (agent !== undefined) this.bindPrompt(agent);
  }
  /** 准备本数据目录的固定会话。 @returns 身份及工作目录；创建和恢复错误直接向调用者报告。 */
  ensure(): Promise<EnsureResult> {
    if (this.closed) return Promise.reject(Error("孔明插件已停用"));
    if (this.pending !== undefined) return this.pending;
    const operation = this.ensureOnce();
    this.pending = operation;
    operation
      .finally(() => {
        if (this.pending === operation) this.pending = undefined;
      })
      .catch(() => {
        /* 调用者收到同一个准备失败，后续重试可重新进入。 */
      });
    return operation;
  }
  private async ensureOnce(): Promise<EnsureResult> {
    await validateProjectDir(this.paths.projectDir);
    const binding = await this.store.loadOrReserve(this.paths.projectDir);
    if (binding.cwd !== this.paths.projectDir)
      throw Error(`孔明工作目录已绑定为 ${binding.cwd}，请使用该目录继续交流`);
    this.binding = binding;
    const id = SessionId(binding.sessionId);
    if (binding.phase === "reserved") {
      const created = await this.ctx.sessionController.create({
        sessionId: id,
        cwd: binding.cwd,
        ...(binding.agentPreset === undefined
          ? {}
          : { agentPreset: binding.agentPreset }),
      });
      this.binding = {
        ...binding,
        phase: "ready",
        ...(created.agentPreset === undefined
          ? {}
          : { agentPreset: created.agentPreset }),
      };
    }
    const result = await this.ctx.sessionController.resolveAgent(id);
    if ("error" in result)
      throw Error(`孔明会话恢复失败：${result.error.message}`);
    this.agent = result.agent;
    this.bindPrompt(result.agent);
    if (!(await this.ctx.sessions.flush(result.agent.session)))
      throw Error("孔明会话保存失败，请重试");
    const workspace = await this.ctx.workspaceRegistry.create(binding.cwd);
    await workspace.attachSession(id);
    if (binding.phase === "reserved" && this.binding !== undefined)
      await this.store.commit(this.binding);
    return { sessionId: id, cwd: binding.cwd };
  }
  private bindPrompt(agent: Agent): void {
    this.agent = agent;
    if (this.boundControl?.agent !== agent)
      this.boundControl = new KongmingControl(this.ctx, agent);
    if (!this.prompts.has(agent)) {
      this.prompts.set(agent, mountPrompt(agent, this.config));
    }
    this.ctx.emit("kongming/agent-ready", { agent });
  }
  /** 返回已准备的固定会话控制器；未准备或已停用时明确拒绝操作。 */
  get control(): KongmingControl {
    if (this.closed || this.boundControl === undefined)
      throw Error("孔明会话尚未准备或插件已停用");
    return this.boundControl;
  }
  private async releaseAgent(agent: Agent): Promise<void> {
    const release = this.prompts.get(agent);
    if (release === undefined) return;
    release();
    this.prompts.delete(agent);
    if (this.boundControl?.agent === agent) {
      this.boundControl.dispose();
      this.boundControl = undefined;
    }
    if (this.agent === agent) this.agent = undefined;
    await this.ctx.serial("kongming/agent-detached", { agent });
  }
  /** 停止并等待本插件的工作结束，身份和会话文件继续保存。 */
  close(): Promise<void> {
    this.closed = true;
    return (this.closing ??= this.closeOnce());
  }
  private async closeOnce(): Promise<void> {
    await this.restoring?.catch(() => {
      /* 启动恢复错误已由插件报告，卸载继续等待现有工作。 */
    });
    await this.pending?.catch(() => {
      /* 准备失败已返回调用者，卸载继续收敛现有工作。 */
    });
    if (this.agent !== undefined) {
      const agent = this.agent;
      agent.cancel({ kind: "disposed" }, { keepInbox: true });
      await agent.whenIdle();
      await this.ctx.sessions.flush(agent.session);
    }
    for (const agent of this.prompts.keys()) await this.releaseAgent(agent);
  }
}
