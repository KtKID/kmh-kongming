/** 浏览器插件入口，注册共用词典和各业务模块。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import { mountDispatchView } from "../dispatch/client/view.tsx";
import { mountSessionEntry } from "../session/client/entry.ts";
import { zh, en, type KongmingLocaleKey } from "./locales.ts";

/** 浏览器半的公开服务依赖。 */
export const inject = [
  "slots",
  "locale",
  "sessions",
  "uiWorkspace",
  "uiConversation",
];

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    kongming: KongmingLocaleKey;
  }
}

/** 将词典和业务模块注册到当前浏览器插件作用域。 */
export function apply(ctx: Context): void {
  // 词典随插件作用域注册并释放。
  ctx.effect(() => ctx.locale.register("kongming", { zh, en }));
  mountDispatchView(ctx);
  mountSessionEntry(ctx);
}
