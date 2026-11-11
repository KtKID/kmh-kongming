/** 让孔明固定会话只保留独立入口，在普通侧栏列表按 ID 隐藏对应行。 */
import type { Context } from "@deepseek-ai/cordis";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import { FixedSessionSchema } from "../protocol.ts";

/** 挂载侧栏样式，返回当前固定会话 ID 及更新入口。 */
export function mountSidebarVisibility(ctx: Context) {
  let fixedSessionId: SessionId | undefined;
  const style = document.createElement("style");

  /** 使用已校验的 ID 匹配宿主侧栏行，名称和工作区均可变化。 */
  function hide(sessionId: SessionId): void {
    fixedSessionId = sessionId;
    style.textContent = `[data-slot="sidebar.workspaces"] [data-row-key="session:${sessionId}"] { display: none !important; }`;
  }

  ctx.effect(() => {
    const controller = new AbortController();
    document.head.appendChild(style);
    fetch("/api/kmh-kongming/session-id", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        const { sessionId } = FixedSessionSchema.parse(await response.json());
        controller.signal.throwIfAborted();
        // 点击入口拿到的 ID 优先于迟到的初始读取。
        if (fixedSessionId === undefined && sessionId !== null)
          hide(brandString<SessionId>(sessionId));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          ctx.logger.warn(`读取孔明会话 ID 失败：${String(error)}`);
      });
    return () => {
      controller.abort();
      style.remove();
    };
  }, "kmh-kongming: sidebar visibility");

  return {
    get sessionId() {
      return fixedSessionId;
    },
    hide,
  };
}
