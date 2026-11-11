/** 把孔明委派的原生会话事件投影为聊天节点。 */
import type { ChatNode } from "@deepseek-ai/dsh-client-ui-chat/client";
import type { ConversationNodeDefinition } from "@deepseek-ai/dsh-client-ui-conversation/client";
import { AnyRelaySourceSchema, dispatchPreface } from "../protocol.ts";

interface DispatchInput {
  readonly dispatchId: string;
  readonly request: ChatNode<"user">["data"];
}

declare module "@deepseek-ai/dsh-client-ui-chat/client" {
  interface ChatNodeDataMap {
    "kongming-dispatch": DispatchInput;
  }
}

export const dispatchInput: ConversationNodeDefinition<DispatchInput> = {
  kind: "kongming-dispatch-input",
  target: "chat",
  /** 只接管追加到会话中的孔明委派请求。 */
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
    const first = content[0];
    return {
      dispatchId: dispatch.dispatchId,
      request: {
        kind: "user",
        messageId: id,
        seq: event.seq,
        time: event.time,
        source,
        content:
          first?.type === "text" &&
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
      anchorSeq: state.request.seq,
      location: start.location,
      groupTree: "exchange",
      visibility: "visible",
      data: state,
    };
    return node;
  },
};
