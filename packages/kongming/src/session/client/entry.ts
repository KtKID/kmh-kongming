/** 注册孔明固定会话入口，准备成功后交给原生会话导航。 */
import { createElement } from "react";
import type { Context } from "@deepseek-ai/cordis";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { MainPanelId } from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-workspace/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import { IconSparkleRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { EnsureResultSchema, FailureSchema } from "../protocol.ts";
import { KongmingPanel } from "./KongmingPanel.tsx";

const PANEL_ID = brandString<MainPanelId>("kmh-kongming");

/** 按侧栏提供的尺寸渲染孔明入口图标。 */
function KongmingIcon({ size }: PropsRuntime<"sidebar.panellist">) {
  return createElement(IconSparkleRegular, { size });
}

/** 将侧栏按钮和准备面板接到同一固定会话。 */
export function mountSessionEntry(ctx: Context): void {
  const t = ctx.locale.bind("kongming");
  /** 请求宿主准备固定会话，刷新列表后用原生导航打开它。 */
  const prepare = async (signal: AbortSignal): Promise<void> => {
    const response = await fetch("/api/kmh-kongming/ensure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal,
    });
    const value: unknown = await response.json();
    if (!response.ok) throw Error(FailureSchema.parse(value).message);
    const result = EnsureResultSchema.parse(value);
    await ctx.sessions.refresh();
    signal.throwIfAborted();
    ctx.uiWorkspace.openSession(brandString<SessionId>(result.sessionId));
  };
  ctx.slots.inject(
    "main",
    // 主面板接管打开入口后、固定会话准备完成前的状态。
    () =>
      ctx.slots.register(
        {
          name: "main",
          key: PANEL_ID,
          locale: "kongming",
          /** 将宿主准备请求交给面板触发，并接收面板的取消信号。 */
          inject: () => ({ prepare }),
        },
        KongmingPanel,
      ),
  );
  ctx.slots.inject(
    "sidebar.panellist",
    // 侧栏按钮使用与准备面板相同的入口 ID。
    () =>
      ctx.slots.register(
        {
          name: "sidebar.panellist",
          id: PANEL_ID,
          order: 5,
          locale: "kongming",
          /** 按当前语言显示入口名称。 */
          label: () => t("panel"),
        },
        KongmingIcon,
      ),
  );
}
