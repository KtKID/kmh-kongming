/** 孔明入口、原生会话和刷新恢复；配置页由后续阶段提供。 */
import { createElement } from "react";
import type { Context } from "@deepseek-ai/cordis";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { MainPanelId } from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-workspace/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import { IconSparkleRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { EnsureResultSchema, FailureSchema } from "../protocol/index.ts";
import { KongmingPanel } from "./KongmingPanel.tsx";
import { zh, en, type KongmingLocaleKey } from "./locales.ts";
/** 浏览器半的公开服务依赖。 */
export const inject = ["slots", "locale", "sessions", "uiWorkspace"];
const PANEL_ID = brandString<MainPanelId>("kmh-kongming");
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    kongming: KongmingLocaleKey;
  }
}
function KongmingIcon({ size }: PropsRuntime<"sidebar.panellist">) {
  return createElement(IconSparkleRegular, { size });
}
/** @param ctx - 浏览器插件的生命周期上下文。 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register("kongming", { zh, en }));
  const t = ctx.locale.bind("kongming");
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
  ctx.slots.inject("main", () =>
    ctx.slots.register(
      {
        name: "main",
        key: PANEL_ID,
        locale: "kongming",
        inject: () => ({ prepare }),
      },
      KongmingPanel,
    ),
  );
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: PANEL_ID,
        order: 5,
        locale: "kongming",
        label: () => t("panel"),
      },
      KongmingIcon,
    ),
  );
}
