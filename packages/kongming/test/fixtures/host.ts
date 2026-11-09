/** 干净宿主：真实生产循环、JSONL 和文件工具；仅替换 LLM adapter。 */
import { Context } from "@deepseek-ai/cordis";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
  provideWorkingDirectoryFixture,
} from "@deepseek-ai/dsh-agent-loop-testkit";
import * as Persistence from "@deepseek-ai/dsh-session-persistence-jsonl";
import PointQuery from "./point-query.ts";
import assert from "node:assert/strict";
import type { SessionId } from "@deepseek-ai/dsh-session";
import SandboxPolicy from "@deepseek-ai/dsh-sandbox-policy";
import Fs from "@deepseek-ai/dsh-fs-sandbox";
import * as ToolFs from "@deepseek-ai/dsh-tool-fs";
import Approval from "@deepseek-ai/dsh-user-approval";
import { join } from "node:path";
import { MockAdapter, type ScriptEntry } from "./mock-adapter.ts";
import { defaultMemoryConfig } from "./config.ts";
import {
  createMemoryService,
  resolveMemoryFiles,
} from "@kmh/kongming-memory-v1";

export interface HostPaths {
  readonly home: string;
  readonly projectDir: string;
}
export interface HostOptions extends HostPaths {
  readonly script?: readonly ScriptEntry[];
  /** 收尾流程用例显式开启；其余用例专测原有队列、工具或冻结行为。 */
  readonly memoryReminder?: boolean;
  readonly memoryPlugin?: boolean;
}

/** 从真实注册表取活动 Agent；缺失时明确报告初始化失败。 */
export function getAgent(ctx: Context, id: SessionId) {
  const agent = ctx.agents.get(id);
  assert.ok(agent, "固定会话应已有活动 Agent");
  return agent;
}

/** 每次创建新 Context，调用者拥有目录与异步清理。 */
export async function createCoreHost({
  home,
  projectDir,
  script = [],
  memoryReminder = false,
  memoryPlugin = true,
}: HostOptions) {
  const ctx = new Context();
  try {
    await mountAgentLoopTestDependencies(ctx);
    if (memoryPlugin)
      ctx.provide(
        "kongmingMemoryV1",
        createMemoryService(ctx, resolveMemoryFiles(home), {
          ...defaultMemoryConfig(),
          reminderPrompt: memoryReminder
            ? defaultMemoryConfig().reminderPrompt
            : "",
        }),
      );
    await ctx.plugin(Persistence, { root: join(home, "sessions") });
    await ctx.plugin(PointQuery);
    await ctx.plugin(SandboxPolicy, {
      mode: "danger-full-access",
      workspaceRoot: projectDir,
    });
    await ctx.plugin(Fs, { cwd: projectDir });
    provideWorkingDirectoryFixture(ctx, projectDir);
    await ctx.plugin(ToolFs);
    await ctx.plugin(Approval);
    const adapter = new MockAdapter(script);
    ctx.llm.registerAdapter(["mock"], adapter);
    const driver = await mountAgentLoopTestHarness(ctx);
    return { ctx, driver, adapter, close: () => ctx.fiber.dispose() };
  } catch (error) {
    await ctx.fiber.dispose();
    throw error;
  }
}

/** 固定会话测试加载真实 Session Controller 的最小公开依赖组合。 */
export async function createHost(options: HostOptions) {
  const host = await createCoreHost(options);
  const { ctx } = host;
  try {
    const [
      DefaultModel,
      Storage,
      Json,
      Domain,
      Workspaces,
      Attachments,
      Credentials,
      Connection,
      Commands,
      Uploads,
      Typert,
      Access,
      Gateway,
      Controller,
    ] = await Promise.all([
      import("@deepseek-ai/dsh-agent-default-model"),
      import("@deepseek-ai/dsh-storage"),
      import("@deepseek-ai/dsh-storage-json"),
      import("@deepseek-ai/dsh-storage-domain"),
      import("@deepseek-ai/dsh-workspace"),
      import("@deepseek-ai/dsh-attachment-local"),
      import("@deepseek-ai/dsh-credentials-local"),
      import("@deepseek-ai/dsh-client-connection"),
      import("@deepseek-ai/dsh-commands"),
      import("@deepseek-ai/dsh-client-file-upload"),
      import("@deepseek-ai/dsh-typert-registry"),
      import("@deepseek-ai/dsh-api-remote-access"),
      import("@deepseek-ai/dsh-api-gateway"),
      import("@deepseek-ai/dsh-api-session-controller"),
    ]);
    await ctx.plugin(DefaultModel.default, { provider: "mock", model: "mock" });
    await ctx.plugin(Storage.default);
    await ctx.plugin(Json, { root: join(options.home, "storage") });
    await ctx.plugin(Domain, { backend: "json" });
    await ctx.plugin(Workspaces.default);
    await ctx.plugin(Attachments.default, { dshHome: options.home });
    await ctx.plugin(Credentials.default, { dshHome: options.home });
    await ctx.plugin(Typert.default);
    await ctx.plugin(Access.default);
    await ctx.plugin(Gateway.default);
    await ctx.plugin(Connection);
    await ctx.plugin(Commands.default);
    await ctx.plugin(Uploads.default);
    await ctx.plugin(Controller.default);
    return host;
  } catch (error) {
    await host.close();
    throw error;
  }
}

export type Host = Awaited<ReturnType<typeof createHost>>;
