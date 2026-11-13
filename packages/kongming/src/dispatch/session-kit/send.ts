/** 向任意平级普通会话投递一条带来源标记的消息（排队或步骤边界注入）。 */
import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type ContentBlock } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-api-session-controller";
import { RelaySourceSchema, relayPreface } from "./protocol.ts";

export interface SendSessionMessageOptions {
  /** 发送方 live Agent；其 session id 写入来源标记。 */
  from: Agent;
  /** 目标普通会话 ID（subagent 子会话会被上游 API 拒绝，归档会话轮次被阻断）。 */
  toSessionId: string;
  /** 消息正文块，按原顺序投递。 */
  content: readonly ContentBlock[];
  /** 投递方式：queue 排入下一轮（默认），steer 在最近步骤边界注入运行中的轮。 */
  delivery?: "queue" | "steer";
  /** 覆盖默认来源前缀文本。 */
  preface?: string;
  /** 调用方预先生成的通信 ID（组合跟踪时复用同一 ID）。 */
  dispatchId?: string;
}

export interface SendSessionMessageResult {
  /** 本次通信 ID。 */
  dispatchId: string;
  /** 已投递消息的稳定 ID（watchTurnReply 按它关联事件）。 */
  messageId: string;
  /** 已解析的目标 Agent。 */
  target: Agent;
}

/** 正文是否携带非空白文本或附件。 */
export function hasSubstance(content: readonly ContentBlock[]): boolean {
  return content.some(
    (block) =>
      block.type === "image" ||
      block.type === "file" ||
      (block.type === "text" && block.text.trim() !== ""),
  );
}

/** 解析目标会话为 live Agent。
 * @param ctx - 宿主上下文。
 * @param toSessionId - 目标会话 ID。
 * @returns 目标 Agent。
 * @throws 目标不存在/不可用时抛带错误码的 Error。
 */
export async function resolveTarget(
  ctx: Context,
  toSessionId: string,
): Promise<Agent> {
  const resolved = await ctx.sessionController.resolveAgent(
    SessionId(toSessionId),
  );
  if ("error" in resolved)
    throw Error(
      `目标会话 ${toSessionId} 不可用（${resolved.error.code}）：${resolved.error.message}`,
    );
  return resolved.agent;
}

/** 构造带来源标记的完整消息（前缀块 + 原始正文块）。 */
export function buildRelayMessage(
  options: SendSessionMessageOptions,
  dispatchId: string,
) {
  return createUserMessage({
    source: RelaySourceSchema.parse({
      kind: "kmh-relay",
      form: "relay",
      senderSessionId: options.from.id,
      dispatchId,
      targetSessionId: options.toSessionId,
    }),
    content: [
      {
        type: "text",
        text: options.preface ?? relayPreface(options.from.id),
      },
      ...options.content,
    ],
  });
}

/**
 * 向目标会话投递一条跨会话消息。
 * @param ctx - 宿主上下文。
 * @param options - 发送选项；默认排队投递。
 * @returns 通信 ID、消息 ID 与目标 Agent。
 * @throws 正文为空或目标不可用时抛错，不产生任何投递。
 */
export async function sendSessionMessage(
  ctx: Context,
  options: SendSessionMessageOptions,
): Promise<SendSessionMessageResult> {
  if (!hasSubstance(options.content))
    throw Error("消息内容不能为空：至少需要一段非空白文本或附件。");
  const target = await resolveTarget(ctx, options.toSessionId);
  const dispatchId = options.dispatchId ?? randomUUID();
  const message = buildRelayMessage(options, dispatchId);
  if (options.delivery === "steer") target.steer(message);
  else target.followup(message);
  return { dispatchId, messageId: message.id, target };
}
