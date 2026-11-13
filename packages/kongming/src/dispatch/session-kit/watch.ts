/** 跟踪目标会话的实际执行轮次，结束后把业务回复回传发送方一次。 */
import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type ContentBlock } from "@deepseek-ai/dsh-llm";
import type { TurnEndReason } from "@deepseek-ai/dsh-session/types";
import { RelaySourceSchema } from "./protocol.ts";
import {
  buildRelayMessage,
  hasSubstance,
  resolveTarget,
  type SendSessionMessageOptions,
} from "./send.ts";

/** 为执行失败、中断或空正文完成生成回传说明。 */
function resultNotice(reason: TurnEndReason): string {
  if (reason.kind === "error")
    return `执行失败（${reason.error.code}）：${reason.error.message}`;
  if (reason.kind === "completed") return "执行已结束，但没有公开回复正文。";
  return `执行未完成（${reason.kind}）。`;
}

export interface WatchTurnReplyOptions {
  /** 接收回传的发送方 live Agent。 */
  from: Agent;
  /** 已解析的目标 Agent。 */
  target: Agent;
  /** 已投递消息的稳定 ID（inbox 事件按它关联）。 */
  messageId: string;
  /** 本次通信 ID。 */
  dispatchId: string;
  /** 发送方有效性回调；失效时静默跳过回传并记警告。默认恒真。 */
  isSourceActive?: () => boolean;
}

export interface WatchHandle {
  /** 注销全部监听并停止跟踪；幂等。 */
  release(this: void): void;
}

/**
 * 为一条已（或即将）投递的消息注册轮次跟踪：目标实际领取消息的轮次结束时，
 * 把业务阶段最后一条助手消息的公开正文回传发送方，一次为限；执行前取消、目标
 * 提前销毁或异常终态则回传对应说明。调用方应保证在投递前注册（用
 * sendAndWatch 可完全避免竞态）。
 * @param ctx - 宿主上下文。
 * @param options - 跟踪选项。
 * @returns 释放入口。
 */
export function watchTurnReply(
  ctx: Context,
  options: WatchTurnReplyOptions,
): WatchHandle {
  const { from, target, messageId, dispatchId } = options;
  const isSourceActive = options.isSourceActive ?? (() => true);
  let released = false;
  let claimedTurn: number | undefined;
  let collectingReply = false;
  let answer: ContentBlock[] = [];

  const offClaim = ctx.on(
    "agent/inbox/claimed",
    ({ agent, message: claimed, turn }) => {
      if (agent !== target) return;
      if (claimed.id === messageId) claimedTurn = turn;
      // 同轮真实补充输入继续参与业务答复；插件上下文沿用当前阶段。
      if (
        turn === claimedTurn &&
        (claimed.id === messageId ||
          claimed.source.kind === "user" ||
          ("form" in claimed.source && claimed.source.form === "relay"))
      )
        collectingReply = true;
    },
  );
  const offStopping = ctx.on("agent/turn-stopping", ({ agent, turn }) => {
    // 宿主首次准备结束业务步骤后，插件可追加同轮收尾步骤。
    if (agent === target && turn === claimedTurn) collectingReply = false;
  });
  const offDiscard = ctx.on(
    "agent/inbox/discarded",
    // 只检查这次消息对应的移除事件。
    ({ agent, message: discarded }) => {
      if (agent !== target || discarded.id !== messageId) return;
      // 编辑与转入当前轮会保留消息 ID，等队列操作完成后再判断是否取消。
      queueMicrotask(() => {
        if (
          released ||
          claimedTurn !== undefined ||
          target.inbox.nextTurn.some((queued) => queued.id === messageId) ||
          target.inbox.nextStep.some((queued) => queued.id === messageId)
        )
          return;
        deliver("消息已在开始执行前取消。");
      });
    },
  );
  // 业务阶段的末条助手消息决定正文，轮次终态决定是否回传正文。
  const offEvent = ctx.on("session/event", (session, event) => {
    if (session !== target.session || claimedTurn === undefined) return;
    if (
      collectingReply &&
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
  // 目标 Agent 提前关闭时，把关闭原因回传发送方。
  const offDispose = ctx.on("agent/disposed", ({ agent }) => {
    if (agent === target) deliver("执行会话已关闭。");
  });

  /** 先注销跟踪，再向有效的发送方回传一次正文或终态说明。 */
  function deliver(failure: string | undefined): void {
    if (released) return;
    release();
    if (!isSourceActive()) return;
    try {
      from.followup(
        createUserMessage({
          source: RelaySourceSchema.parse({
            kind: "kmh-relay",
            form: "relay",
            senderSessionId: target.id,
            dispatchId,
            targetSessionId: target.id,
          }),
          content: [
            {
              type: "text",
              text:
                `来自会话 ${target.id} 的回复（${dispatchId}）` +
                (failure === undefined
                  ? "。请根据下列内容继续处理。"
                  : `：${failure}`),
            },
            ...(failure === undefined ? answer : []),
          ],
        }),
      );
    } catch (error) {
      ctx.logger.warn(`跨会话回复 ${dispatchId} 回传失败：${String(error)}`);
    }
  }

  function release(): void {
    if (released) return;
    released = true;
    offClaim();
    offStopping();
    offDiscard();
    offEvent();
    offDispose();
  }

  return { release };
}

export interface SendAndWatchOptions extends SendSessionMessageOptions {
  /** 发送方有效性回调；失效时静默跳过回传并记警告。 */
  isSourceActive?: () => boolean;
}

export interface SendAndWatchResult {
  /** 本次通信 ID。 */
  dispatchId: string;
  /** 已投递消息的稳定 ID。 */
  messageId: string;
  /** 已解析的目标 Agent。 */
  target: Agent;
  /** 停止跟踪的释放入口。 */
  release(this: void): void;
}

/**
 * 发送并跟踪一条跨会话消息：先注册轮次监听再投递（无竞态），目标作答后
 * 自动把回复回传发送方一次。
 * @param ctx - 宿主上下文。
 * @param options - 发送选项加发送方有效性回调。
 * @returns 通信 ID、消息 ID、目标 Agent 与释放入口。
 * @throws 正文为空或目标不可用时抛错，不产生任何投递。
 */
export async function sendAndWatch(
  ctx: Context,
  options: SendAndWatchOptions,
): Promise<SendAndWatchResult> {
  if (!hasSubstance(options.content))
    throw Error("消息内容不能为空：至少需要一段非空白文本或附件。");
  const target = await resolveTarget(ctx, options.toSessionId);
  const dispatchId = options.dispatchId ?? randomUUID();
  const message = buildRelayMessage(options, dispatchId);
  // 先订阅后投递，确保领取/轮次事件不丢失。
  const watch = watchTurnReply(ctx, {
    from: options.from,
    target,
    messageId: message.id,
    dispatchId,
    ...(options.isSourceActive === undefined
      ? {}
      : { isSourceActive: options.isSourceActive }),
  });
  if (options.delivery === "steer") target.steer(message);
  else target.followup(message);
  return {
    dispatchId,
    messageId: message.id,
    target,
    release: watch.release,
  };
}
