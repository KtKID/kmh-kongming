/** 把孔明委派的原生会话事件投影为聊天节点。 */
import type { ChatNode } from "@deepseek-ai/dsh-client-ui-chat/client";
import type { ConversationNodeDefinition } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { z } from "zod";
import { AnyRelaySourceSchema, dispatchPreface } from "../protocol.ts";

interface DispatchInput {
  readonly dispatchId: string;
  readonly direction: "request" | "reply";
  readonly message: ChatNode<"user">["data"];
}

type RelaySource = z.infer<typeof AnyRelaySourceSchema>;
type MessageContent = ChatNode<"user">["data"]["content"];

/** 从显示正文移除回流头部，保留业务内容、附件或失败说明。 */
function replyContent(
  source: RelaySource,
  content: MessageContent,
): MessageContent {
  const [first, ...body] = content;
  if (first?.type !== "text") return content;
  const { dispatchId, senderSessionId } = source;
  const header =
    source.kind === "kongming-reply"
      ? `委派 ${dispatchId} · 会话 ${senderSessionId} 的执行结果`
      : `来自会话 ${senderSessionId} 的回复（${dispatchId}）`;
  if (first.text.startsWith(`${header}。`)) return body;
  const failurePrefix = `${header}：`;
  if (first.text.startsWith(failurePrefix))
    return [
      { ...first, text: first.text.slice(failurePrefix.length) },
      ...body,
    ];
  return content;
}

declare module "@deepseek-ai/dsh-client-ui-chat/client" {
  interface ChatNodeDataMap {
    "kongming-dispatch": DispatchInput;
  }
}

export const dispatchInput: ConversationNodeDefinition<DispatchInput> = {
  kind: "kongming-dispatch-input",
  target: "chat",
  /** 接管追加到会话中的委派与回信，普通输入继续走原生展示。 */
  match(event) {
    if (event.type !== "user/message" || event.surfaceOp !== "append")
      return null;
    return AnyRelaySourceSchema.safeParse(event.data.source).success
      ? { id: event.data.id, role: "start", exclusive: true }
      : null;
  },
  /** 从原生消息初始化投影，展示正文时去掉模型专用的来源前缀。 */
  start(_context, { event }) {
    if (event.type !== "user/message")
      throw Error("Expected a Kongming dispatch message");
    const { id, source, content } = event.data;
    const dispatch = AnyRelaySourceSchema.parse(source);
    // 现行回信用原执行会话同时记录发送方和 targetSessionId。
    const isReply =
      dispatch.kind === "kongming-reply" ||
      (dispatch.kind === "kmh-relay" &&
        dispatch.senderSessionId === dispatch.targetSessionId);
    const first = content[0];
    return {
      dispatchId: dispatch.dispatchId,
      direction: isReply ? "reply" : "request",
      message: {
        kind: "user",
        messageId: id,
        seq: event.seq,
        time: event.time,
        source,
        content: isReply
          ? replyContent(dispatch, content)
          : first?.type === "text" &&
              first.text === dispatchPreface(dispatch.senderSessionId)
            ? content.slice(1)
            : content,
      },
    };
  },
  /** 委派请求正文在起始事件中确定，后续事件沿用已有投影。 */
  update: ({ state }) => state,
  /** 在原请求的位置生成折叠视图使用的聊天节点。 */
  buildViewNode({ key, id, state, start }) {
    if (state === undefined || start === undefined) return null;
    const node: ChatNode<"kongming-dispatch"> = {
      key,
      id,
      kind: "kongming-dispatch",
      target: "chat",
      anchorSeq: state.message.seq,
      location: start.location,
      groupTree: state.direction === "reply" ? "input" : "exchange",
      visibility: "visible",
      data: state,
    };
    return node;
  },
};
