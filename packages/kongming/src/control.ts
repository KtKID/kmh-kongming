/** 固定孔明会话的停止、继续和补充；通过公开 Agent 队列保存控制意图。 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { SessionPromptRequest } from "@deepseek-ai/dsh-api-session-controller";
import { PromptControlSchema } from "./protocol/index.ts";

/** 每个已绑定 Agent 拥有一份暂停意图；只控制该孔明实例的输入。 */
export class KongmingControl {
  private paused = false;
  private closed = false;

  constructor(
    private readonly ctx: Context,
    readonly agent: Agent,
  ) {
    const end = agent.session
      .snapshotEvents()
      .findLast((e) => e.type === "turn/start" || e.type === "turn/end");
    this.paused =
      end?.type === "turn/end" &&
      end.data.reason.kind === "aborted" &&
      end.data.reason.reason?.kind === "user";
  }

  private assertActive(): void {
    if (this.closed || this.ctx.agents.get(this.agent.id) !== this.agent)
      throw Error("孔明会话控制器已释放");
  }

  /** 释放该插件实例的控制入口；待执行输入继续由 Agent 队列持有。 */
  dispose(): void {
    this.closed = true;
  }

  /** 接纳文本；暂停期间以原请求身份入队，重复请求沿用既有回执。 */
  async prompt(
    text: string,
    mode: SessionPromptRequest["mode"],
    requestId: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<{ accepted: true }> {
    this.assertActive();
    signal.throwIfAborted();
    const input = PromptControlSchema.parse({
      action: "prompt",
      text,
      mode,
      requestId,
    });
    const id = brandString<SessionPromptRequest["requestId"]>(input.requestId);
    if (!this.paused)
      return this.ctx.sessionController.prompt(
        {
          sessionId: this.agent.id,
          mode: input.mode,
          requestId: id,
          content: [{ type: "text", text: input.text }],
        },
        signal,
      );
    const recorded = this.agent.session
      .snapshotEvents()
      .some(
        (e) =>
          e.type === "user/message" &&
          e.data.source.kind === "user" &&
          "rpcId" in e.data.source &&
          e.data.source.rpcId === id,
      );
    const pending = [
      ...this.agent.inbox.nextTurn,
      ...this.agent.inbox.nextStep,
    ].some(
      (m) =>
        m.source.kind === "user" &&
        "rpcId" in m.source &&
        m.source.rpcId === id,
    );
    if (!recorded && !pending)
      this.agent.send(
        createUserMessage({
          content: [{ type: "text", text: input.text }],
          source: { kind: "user", rpcId: id },
        }),
        input.mode === "steer" ? "next-step" : "next-turn",
        false,
      );
    return { accepted: true };
  }

  /** 停止当前执行并保留待处理输入；调用方通过 whenIdle 等待执行退出。 */
  cancel(): { accepted: true } {
    this.assertActive();
    const result = this.ctx.sessionController.cancel({
      sessionId: this.agent.id,
    });
    this.paused = true;
    return result;
  }

  /** 以队列末项的原身份唤醒，保持 FIFO 顺序；重复继续沿用同一驱动。 */
  resume(): { accepted: true } {
    this.assertActive();
    if (!this.paused && this.agent.status === "running")
      return { accepted: true };
    this.paused = false;
    const target =
      this.agent.inbox.nextTurn.length > 0 ? "next-turn" : "next-step";
    const message = (
      target === "next-turn"
        ? this.agent.inbox.nextTurn
        : this.agent.inbox.nextStep
    ).at(-1);
    if (message !== undefined && this.agent.inbox.remove(message.id))
      this.agent.send(message, target, true);
    return { accepted: true };
  }

  /** 在最近的后续步骤提供用户文本；空闲时保留输入，等待显式唤醒。 */
  supplement(text: string): { accepted: true } {
    this.assertActive();
    const input = PromptControlSchema.shape.text.parse(text);
    this.agent.inject(
      createUserMessage({
        content: [{ type: "text", text: input }],
        source: { kind: "user" },
      }),
    );
    return { accepted: true };
  }
}
