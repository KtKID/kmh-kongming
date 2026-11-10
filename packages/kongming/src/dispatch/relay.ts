/** 通过原生队列发送委派，跟踪实际执行轮次并回传一次结果。 */
import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type ContentBlock } from "@deepseek-ai/dsh-llm";
import type { TurnEndReason } from "@deepseek-ai/dsh-session/types";
import {
  DispatchSourceSchema,
  ReplySourceSchema,
  dispatchPreface,
} from "./protocol.ts";

/** 为执行失败、中断或空正文完成生成回传说明。 */
function resultNotice(reason: TurnEndReason): string {
  if (reason.kind === "error")
    return `执行失败（${reason.error.code}）：${reason.error.message}`;
  if (reason.kind === "completed") return "执行已结束，但没有公开回复正文。";
  return `执行未完成（${reason.kind}）。`;
}

/** 为一个源 Agent 管理尚待回传的委派及其监听。 */
export function createDispatchRelay(
  ctx: Context,
  source: Agent,
  isSourceActive: () => boolean,
) {
  const pending = new Set<() => void>();

  /** 先订阅目标会话事件，再入队并返回本次委派 ID。 */
  function enqueue(target: Agent, content: readonly ContentBlock[]): string {
    const dispatchId = randomUUID();
    const message = createUserMessage({
      source: DispatchSourceSchema.parse({
        kind: "kongming-dispatch",
        form: "relay",
        senderSessionId: source.id,
        dispatchId,
        targetSessionId: target.id,
      }),
      content: [{ type: "text", text: dispatchPreface(source.id) }, ...content],
    });
    let claimedTurn: number | undefined;
    let answer: ContentBlock[] = [];

    const offClaim = ctx.on(
      "agent/inbox/claimed",
      // 以目标 Agent 实际领取消息时的轮次关联后续回复。
      ({ agent, message: claimed, turn }) => {
        if (agent === target && claimed.id === message.id) claimedTurn = turn;
      },
    );
    const offDiscard = ctx.on(
      "agent/inbox/discarded",
      // 只检查这次委派对应的移除事件。
      ({ agent, message: discarded }) => {
        if (agent !== target || discarded.id !== message.id) return;
        // 编辑与转入当前轮会保留消息 ID，等队列操作完成后再判断是否取消。
        queueMicrotask(() => {
          if (
            !pending.has(release) ||
            claimedTurn !== undefined ||
            target.inbox.nextTurn.some(
              // 编辑后消息可能仍在下一轮队列。
              (queued) => queued.id === message.id,
            ) ||
            target.inbox.nextStep.some(
              // 转入当前轮后消息可能在下一步队列。
              (queued) => queued.id === message.id,
            )
          )
            return;
          deliver("委派已在开始执行前取消。");
        });
      },
    );
    // 保存被领取轮次的最后一条助手消息，并在该轮结束时回传。
    const offEvent = ctx.on("session/event", (session, event) => {
      if (session !== target.session || claimedTurn === undefined) return;
      if (
        event.type === "assistant/message" &&
        event.data.turn === claimedTurn
      ) {
        answer = event.data.message.content.filter(
          // 回传只携带公开正文、图片和文件。
          (block) =>
            block.type === "image" ||
            block.type === "file" ||
            (block.type === "text" && block.text.trim() !== ""),
        );
      }
      if (event.type !== "turn/end" || event.data.turn !== claimedTurn) return;
      const reason = event.data.reason;
      deliver(
        reason.kind === "completed" && answer.length > 0
          ? undefined
          : resultNotice(reason),
      );
    });
    // 目标 Agent 提前关闭时，把关闭原因回传给孔明。
    const offDispose = ctx.on("agent/disposed", ({ agent }) => {
      if (agent === target) deliver("执行会话已关闭。");
    });

    /** 移除本次委派记录并注销四个监听。 */
    function release(): void {
      pending.delete(release);
      offClaim();
      offDiscard();
      offEvent();
      offDispose();
    }

    /** 先释放本次跟踪，再向有效的源会话回传一次正文或终态说明。 */
    function deliver(failure: string | undefined): void {
      if (!pending.has(release)) return;
      release();
      if (!isSourceActive()) return;
      try {
        source.followup(
          createUserMessage({
            source: ReplySourceSchema.parse({
              kind: "kongming-reply",
              form: "relay",
              senderSessionId: target.id,
              dispatchId,
              targetSessionId: target.id,
            }),
            content: [
              {
                type: "text",
                text:
                  `委派 ${dispatchId} · 会话 ${target.id} 的执行结果` +
                  (failure === undefined
                    ? "。请根据下列回复向用户答复。"
                    : `：${failure}`),
              },
              ...(failure === undefined ? answer : []),
            ],
          }),
        );
      } catch (error) {
        ctx.logger.warn(`孔明委派 ${dispatchId} 回传失败：${String(error)}`);
      }
    }

    pending.add(release);
    try {
      target.followup(message);
    } catch (error) {
      release();
      throw error;
    }
    return dispatchId;
  }

  return {
    enqueue,
    /** 卸载时注销全部待回传委派的监听。 */
    dispose() {
      for (const release of pending) release();
    },
  };
}
