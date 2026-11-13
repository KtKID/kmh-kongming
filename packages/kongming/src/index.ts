/** 孔明插件宿主：固定会话、默认人格及已鉴权的准备入口。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@kmh/kongming/events";
import type { Config } from "./config.ts";
import { runtimePaths } from "./paths.ts";
import { KongmingRuntime } from "./session/runtime.ts";
import { mountWeb } from "./session/web.ts";
export { Config } from "./config.ts";
/** 插件诊断名称。 */
export const name = "kmh-kongming";
/** 会话与工具使用当前 Web 的生产服务。 */
export const inject = [
  "agents",
  "attachments",
  "llm",
  "tools",
  "sessions",
  "systemPrompt",
  "sessionController",
  "workspaceRegistry",
  "connection",
];
declare module "@deepseek-ai/cordis" {
  interface Context {
    kongming: KongmingRuntime;
  }
}
/** 创建固定会话运行时，尝试恢复已有身份，再发布服务与 HTTP 接口。 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const runtime = new KongmingRuntime(
    ctx,
    config,
    runtimePaths(config.projectDir),
  );
  try {
    await runtime.restoreExisting();
  } catch (error) {
    ctx.logger.warn(
      `孔明启动恢复失败，入口重试会重新检查会话与已启用扩展：${String(error)}`,
    );
  }
  ctx.provide("kongming", runtime);
  mountWeb(ctx, runtime);
}
