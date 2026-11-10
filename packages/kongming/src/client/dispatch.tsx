/** 折叠孔明委派轮次，普通会话中的原生消息节点保留各自的渲染器。 */
import type { ComponentType } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type {
  ChatNode,
  ChatNodeViewProps,
} from "@deepseek-ai/dsh-client-ui-chat/client";
import type { ConversationNodeDefinition } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { PropsRenderSlots } from "@deepseek-ai/dsh-client-ui-slots";
import { DispatchSourceSchema, dispatchPreface } from "../protocol/dispatch.ts";

interface DispatchInput {
  readonly dispatchId: string;
  readonly request: ChatNode<"user">["data"];
}

declare module "@deepseek-ai/dsh-client-ui-chat/client" {
  interface ChatNodeDataMap {
    "kongming-dispatch": DispatchInput;
  }
}

const dispatchInput: ConversationNodeDefinition<DispatchInput> = {
  kind: "kongming-dispatch-input",
  target: "chat",
  match(event) {
    if (event.type !== "user/message" || event.surfaceOp !== "append")
      return null;
    return DispatchSourceSchema.safeParse(event.data.source).success
      ? { id: event.data.id, role: "start", exclusive: true }
      : null;
  },
  start(_context, { event }) {
    if (event.type !== "user/message")
      throw Error("Expected a Kongming dispatch message");
    const { id, source, content } = event.data;
    const dispatch = DispatchSourceSchema.parse(source);
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
  update: ({ state }) => state,
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

type UserViewProps = ChatNodeViewProps<"user"> & {
  renderSlotChain: PropsRenderSlots<"conversation.chat.user.before">["renderSlotChain"];
};

/**
 * Both native standalone rows and process groups expose their owning turn.
 * Scope the closed state to this Chat flow, so the same turn number in another
 * pane or the next direct exchange cannot hide its rows.
 */
function closedTurnStyle(turn: number): string {
  return `
    [data-slot="conversation.chat.flow"]:has(> [data-chat-flow-kind="kongming-dispatch"] details[data-kongming-turn="${turn}"]:not([open]))
      > [data-chat-turn="${turn}"]:not([data-chat-flow-kind="kongming-dispatch"]) {
        display: none !important;
      }
  `;
}

/** Add one turn disclosure at the original request position. */
export function mountDispatchView(ctx: Context): void {
  if (ctx.uiConversation === undefined) return;
  ctx.uiConversation.events.register(dispatchInput);
  ctx.slots.inject("conversation.chat.node", () => {
    const native = ctx.slots
      .entriesOfSlot("conversation.chat.node")
      .find((entry) => entry.options.key === "user");
    if (native === undefined)
      throw Error("Kongming requires the native DSH user message renderer");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The slot inspection erases the public user renderer props.
    const NativeUser = native.component as ComponentType<UserViewProps>;
    const kongming = ctx.locale.bind("kongming");

    function DispatchView(props: ChatNodeViewProps<"kongming-dispatch">) {
      const { node } = props;
      const { location, data } = node;
      const turn =
        location.kind === "step" || location.kind === "turn"
          ? location.turn
          : undefined;
      const end = props.useChat((snapshot) =>
        turn === undefined
          ? undefined
          : snapshot.timeline.turns.get(turn.turn)?.end?.data.reason.kind,
      );
      const status =
        end === undefined
          ? kongming("dispatchRunning")
          : end === "completed"
            ? kongming("dispatchCompleted")
            : kongming("dispatchStopped");
      return (
        <>
          {turn !== undefined && <style>{closedTurnStyle(turn.turn)}</style>}
          <details
            data-kongming-dispatch={data.dispatchId}
            data-kongming-turn={turn?.turn}
            style={{
              border: "1px solid var(--dsw-alias-separator-primary)",
              borderRadius: 8,
              padding: "8px 12px",
            }}
          >
            <summary style={{ cursor: "pointer" }}>
              {kongming("dispatchExchange")} · {status}
            </summary>
            <div style={{ paddingTop: 12 }}>
              <NativeUser
                {...props}
                node={{ ...node, kind: "user", data: data.request }}
                renderSlotChain={() => null}
              />
            </div>
          </details>
        </>
      );
    }

    return ctx.slots.register(
      {
        name: "conversation.chat.node",
        key: "kongming-dispatch",
        locale: "chat",
      },
      DispatchView,
    );
  });
}
