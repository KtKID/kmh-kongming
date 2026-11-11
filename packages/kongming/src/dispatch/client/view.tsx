/** 在原生聊天中注册并渲染孔明委派折叠。 */
import type { ComponentType } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { ChatNodeViewProps } from "@deepseek-ai/dsh-client-ui-chat/client";
import type { PropsRenderSlots } from "@deepseek-ai/dsh-client-ui-slots";
import { dispatchInput } from "./projection.ts";

type UserViewProps = ChatNodeViewProps<"user"> & {
  renderSlotChain: PropsRenderSlots<"conversation.chat.user.before">["renderSlotChain"];
};

/**
 * 原生消息和工具组都携带所属轮次。
 * 折叠时只隐藏当前聊天流中该轮的原生节点，保留折叠入口和其他轮次。
 */
function closedTurnStyle(turn: number): string {
  return `
    [data-slot="conversation.chat.flow"]:has(> [data-chat-flow-kind="kongming-dispatch"] details[data-kongming-turn="${turn}"]:not([open]))
      > [data-chat-turn="${turn}"]:not([data-chat-flow-kind="kongming-dispatch"]) {
        display: none !important;
      }
  `;
}

/** 注册委派事件投影和折叠视图，在原请求位置展示委派轮次。 */
export function mountDispatchView(ctx: Context): void {
  if (ctx.uiConversation === undefined) return;
  ctx.uiConversation.events.register(dispatchInput);
  // 在聊天节点插槽可用时，绑定原生消息渲染器并注册委派组件。
  ctx.slots.inject("conversation.chat.node", () => {
    const native = ctx.slots.entriesOfSlot("conversation.chat.node").find(
      // 复用宿主注册的用户消息渲染器。
      (entry) => entry.options.key === "user",
    );
    if (native === undefined)
      throw Error("Kongming requires the native DSH user message renderer");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- 枚举插槽时丢失了原生用户消息渲染器的参数类型。
    const NativeUser = native.component as ComponentType<UserViewProps>;
    const kongming = ctx.locale.bind("kongming");

    /** 委派卡片折叠同轮往来；回信卡片仅折叠自身正文。 */
    function DispatchView(props: ChatNodeViewProps<"kongming-dispatch">) {
      const { node } = props;
      const { location, data } = node;
      const turn =
        data.direction === "request" &&
        (location.kind === "step" || location.kind === "turn")
          ? location.turn
          : undefined;
      const end = props.useChat(
        // 只订阅对应轮次的结束原因，供折叠摘要显示状态。
        (snapshot) =>
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
              {data.direction === "reply"
                ? kongming("dispatchReply")
                : `${kongming("dispatchExchange")} · ${status}`}
            </summary>
            <div style={{ paddingTop: 12 }}>
              <NativeUser
                {...props}
                node={{ ...node, kind: "user", data: data.message }}
                renderSlotChain={
                  // 折叠内只复用原生消息正文，跳过附加插槽。
                  () => null
                }
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
