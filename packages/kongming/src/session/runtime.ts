/** 固定会话运行时：复用生产 Session Controller 的创建、恢复和模型选择。 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-api-session-controller";
import type {} from "@deepseek-ai/dsh-workspace";
import type {} from "@kmh/kongming/events";
import type { Config } from "../config.ts";
import { validateProjectDir, type RuntimePaths } from "../paths.ts";
import { BindingStore, type Binding } from "./binding-store.ts";
import { mountPrompt } from "./prompt.ts";
import { mountDispatch } from "../dispatch/tools.ts";
import { KongmingControl } from "./control.ts";
import type { EnsureResult } from "./protocol.ts";
export type { RuntimePaths } from "../paths.ts";
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
  private readonly agentBindings = new Map<Agent, () => void>();

  /** 初始化身份存储，并订阅固定会话的 Agent 创建、访问与释放。 */
  constructor(
    readonly ctx: Context,
    readonly config: Config,
    readonly paths: RuntimePaths,
  ) {
    this.store = new BindingStore(paths.home);
    // 普通会话沿用宿主配置，只给固定身份对应的 Agent 挂载孔明能力。
    ctx.on("agent/created", ({ agent }) => {
      if (!this.closed && agent.id === this.binding?.sessionId)
        this.bindAgent(agent);
    });
    // Agent 销毁时释放该实例上的能力及外部扩展。
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- DSH emit 调度会接管异步清理观察器的拒绝。
    ctx.on("agent/disposed", async ({ agent }) => {
      await this.releaseAgent(agent);
    });
    // 后启用的扩展可以通过公开事件接入当前 Agent。
    ctx.on("kongming/visit-agents", async (visit) => {
      if (!this.closed && this.agent !== undefined) await visit(this.agent);
    });
    ctx.effect(
      // 将异步收尾注册到插件作用域。
      () => {
        // 插件卸载时等待运行时完成保存与释放。
        return () => this.close();
      },
      "kmh-kongming: settle runtime",
    );
  }

  /** 恢复已有身份的 Agent 绑定，首次使用时保留按需创建。 */
  restoreExisting(): Promise<void> {
    return (this.restoring ??= this.restoreOnce());
  }

  /** 读取已持久化的身份，并为已加载的同一会话绑定孔明能力。 */
  private async restoreOnce(): Promise<void> {
    const binding = await this.store.readExisting();
    if (binding === undefined || this.closed) return;
    this.binding = binding;
    const agent = this.ctx.agents.get(SessionId(binding.sessionId));
    if (agent !== undefined) this.bindAgent(agent);
  }
  /** 合并并发准备请求，返回固定会话身份及工作目录。 */
  ensure(): Promise<EnsureResult> {
    if (this.closed) return Promise.reject(Error("孔明插件已停用"));
    if (this.pending !== undefined) return this.pending;
    const operation = this.ensureOnce();
    this.pending = operation;
    operation
      // 释放已结束的准备操作，允许下一次访问重试。
      .finally(() => {
        if (this.pending === operation) this.pending = undefined;
      })
      .catch(() => {
        /* 调用者收到同一个准备失败，后续重试可重新进入。 */
      });
    return operation;
  }

  /** 按固定身份创建或恢复会话，保存后关联工作区并提交身份。 */
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
    this.bindAgent(result.agent);
    if (!(await this.ctx.sessions.flush(result.agent.session)))
      throw Error("孔明会话保存失败，请重试");
    const workspace = await this.ctx.workspaceRegistry.create(binding.cwd);
    await workspace.attachSession(id);
    if (binding.phase === "reserved" && this.binding !== undefined)
      await this.store.commit(this.binding);
    return { sessionId: id, cwd: binding.cwd };
  }

  /** 为当前 Agent 接上控制器、提示词和委派工具，再通知可选扩展。 */
  private bindAgent(agent: Agent): void {
    this.agent = agent;
    if (this.boundControl?.agent !== agent)
      this.boundControl = new KongmingControl(this.ctx, agent);
    if (!this.agentBindings.has(agent)) {
      const offPrompt = mountPrompt(agent, this.config);
      const offDispatch = mountDispatch(this.ctx, agent);
      // 先清理委派监听，再移除该 Agent 的提示词段落。
      this.agentBindings.set(agent, () => {
        offDispatch();
        offPrompt();
      });
    }
    this.ctx.emit("kongming/agent-ready", { agent });
  }
  /** 返回已准备的固定会话控制器；未准备或已停用时明确拒绝操作。 */
  get control(): KongmingControl {
    if (this.closed || this.boundControl === undefined)
      throw Error("孔明会话尚未准备或插件已停用");
    return this.boundControl;
  }

  /** 释放指定 Agent 的能力和控制器，再等待外部扩展清理完毕。 */
  private async releaseAgent(agent: Agent): Promise<void> {
    const release = this.agentBindings.get(agent);
    if (release === undefined) return;
    release();
    this.agentBindings.delete(agent);
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

  /** 等待恢复和准备结束，再停止当前执行、保存会话并释放全部绑定。 */
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
    for (const agent of this.agentBindings.keys())
      await this.releaseAgent(agent);
  }
}
