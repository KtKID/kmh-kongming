/** 主链路宿主：真实循环、JSONL、提示词和手动压缩，模型输出由私有脚本控制。 */
import { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import {
  LlmAdapter,
  type GenerateOptions,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
  provideWorkingDirectoryFixture,
} from "@deepseek-ai/dsh-agent-loop-testkit";
import * as Persistence from "@deepseek-ai/dsh-session-persistence-jsonl";
import Commands from "@deepseek-ai/dsh-commands";
import TokenMeter from "@deepseek-ai/dsh-token-meter";
import BasicCompaction from "@deepseek-ai/dsh-compaction-basic";
import * as CommandCompact from "@deepseek-ai/dsh-command-compact";
import { join } from "node:path";
import { createMemoryService, resolveMemoryFiles } from "../../src/index.ts";
import type { KongmingMemoryV1, MemoryFiles } from "../../src/types.ts";
import { defaultMemoryConfig } from "./config.ts";
import SandboxPolicy from "@deepseek-ai/dsh-sandbox-policy";
import Fs from "@deepseek-ai/dsh-fs-sandbox";
import * as ToolFs from "@deepseek-ai/dsh-tool-fs";
import Approval from "@deepseek-ai/dsh-user-approval";

export type MockReply =
  readonly StreamChunk[] | AsyncIterable<StreamChunk> | Error;
export interface MockHostOptions {
  readonly home: string;
  readonly projectDir: string;
  /** 按真实请求顺序消费，包含 purpose=compaction 的摘要请求。 */
  readonly replies: readonly MockReply[];
  readonly promptTemplate?: string;
  /** 冻结主链路默认关闭提醒；收尾用例显式使用真实配置文案。 */
  readonly reminderPrompt?: string;
  readonly fileTools?: boolean;
}
export interface MemoryMockHost {
  readonly ctx: Context;
  readonly agent: Agent;
  readonly memory: KongmingMemoryV1;
  readonly files: MemoryFiles;
  readonly requests: readonly GenerateOptions[];
  createAgent(id: SessionId): Promise<Agent>;
  close(): Promise<void>;
}

/** 有限模型脚本：真实请求完整记录；脚本耗尽或指定错误使测试明确失败。 */
class ScriptAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];
  readonly replies: MockReply[];
  constructor(replies: readonly MockReply[]) {
    super();
    this.replies = [...replies];
  }
  override providerInfo(provider: string) {
    return { id: provider, name: "Memory mock" };
  }
  override listModels(provider: string) {
    return Promise.resolve([{ provider, id: "mock", name: "Memory mock" }]);
  }
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: 100_000 },
    });
  }
  override async *stream(
    options: GenerateOptions,
  ): AsyncGenerator<StreamChunk> {
    this.requests.push(options);
    const response = this.replies.shift();
    if (response === undefined) throw Error("Memory mock: script exhausted");
    if (response instanceof Error) throw response;
    for await (const chunk of response) {
      options.signal?.throwIfAborted();
      yield chunk;
    }
  }
}

/** 建立私有真实能力宿主；准备失败时同样等待 Context 释放，调用方拥有临时目录。 */
export async function createMockHost(
  options: MockHostOptions,
): Promise<MemoryMockHost> {
  const ctx = new Context();
  try {
    await mountAgentLoopTestDependencies(ctx);
    if (options.fileTools) {
      await ctx.plugin(SandboxPolicy, {
        mode: "workspace-write",
        workspaceRoot: options.projectDir,
      });
      await ctx.plugin(Fs, { cwd: options.projectDir });
      provideWorkingDirectoryFixture(ctx, options.projectDir);
      await ctx.plugin(ToolFs);
      await ctx.plugin(Approval);
    }
    await ctx.plugin(Persistence, { root: join(options.home, "sessions") });
    await ctx.plugin(Commands);
    await ctx.plugin(TokenMeter);
    await ctx.plugin(BasicCompaction, {
      auto: false,
      maxTokens: 128,
      headroomTokens: 128,
    });
    await ctx.plugin(CommandCompact);
    const adapter = new ScriptAdapter(options.replies);
    ctx.llm.registerAdapter(["mock"], adapter);
    const memory = createMemoryService(ctx, resolveMemoryFiles(options.home), {
      ...defaultMemoryConfig(),
      ...(options.promptTemplate === undefined
        ? {}
        : { promptTemplate: options.promptTemplate }),
      reminderPrompt: options.reminderPrompt ?? "",
    });
    ctx.provide("kongmingMemoryV1", memory);
    await memory.initialize();
    const driver = await mountAgentLoopTestHarness(ctx);
    const agent = await driver.create(
      SessionId("memory-main-flow"),
      { provider: "mock", model: "mock" },
      { cwd: options.projectDir },
    );
    memory.bindAgent(agent);
    return {
      ctx,
      agent,
      memory,
      files: memory.files,
      requests: adapter.requests,
      createAgent: (id) =>
        driver.create(
          id,
          { provider: "mock", model: "mock" },
          { cwd: options.projectDir },
        ),
      close: () => ctx.fiber.dispose(),
    };
  } catch (error) {
    await ctx.fiber.dispose();
    throw error;
  }
}

/* F09–F36 的受控发布/写入屏障、首次准备前故障、重建控制按边界阶段补齐。
 * 故障限定每例文件与实例；finally 释放屏障、恢复注入、等待工作与子进程退出后回收目录。 */
