/** 独立记忆插件：提供冻结上下文、收尾 steer 和手动压缩刷新，监听与文件工作随实例清理。 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import {
  appendOriginalFile,
  initializeMemoryFiles,
  readFrozenFile,
  replaceFrozenFile,
  resolveMemoryFiles,
} from "./files.ts";
import { mountFrozenPrompt } from "./prompt.ts";
import { Config } from "./config.ts";
import { mountMemoryReminder } from "./steer.ts";
import { mountCompactionRefresh } from "./compaction.ts";
import { mountMemoryTool } from "./tool.ts";
import { mountKongmingMemory } from "./kongming.ts";
import type { KongmingMemoryV1, MemoryFiles } from "./types.ts";
export type { KongmingMemoryV1, MemoryFiles } from "./types.ts";
export { resolveMemoryFiles } from "./files.ts";
export { Config } from "./config.ts";
export const name = "kongming-memory-v1";
export const inject = ["sessions", "systemPrompt"];

declare module "@deepseek-ai/cordis" {
  interface Context {
    kongmingMemoryV1: KongmingMemoryV1;
  }
}

/** 从实例 DSH_HOME 建立记忆服务并提供给孔明；首次文件准备由使用者等待 initialize。 */
export function apply(ctx: Context, config: Config): void {
  ctx.provide(
    "kongmingMemoryV1",
    createMemoryService(ctx, resolveMemoryFiles(resolveDshHome()), config),
  );
}

/** 创建独立服务并登记清理；路径和模板由调用方提供，模板校验同步抛错，读写错误传播到请求或调用方。 */
export function createMemoryService(
  ctx: Context,
  files: MemoryFiles,
  config: Config = Config({}),
): KongmingMemoryV1 {
  const promptConfig = Config(config);
  let writing = Promise.resolve();
  let closed = false;
  let closing: Promise<void> | undefined;
  let publishedId: string | undefined;
  const bindings = new Map<Agent, () => Promise<void>>();
  const enqueue = async (action: () => Promise<void>): Promise<void> => {
    if (closed) throw Error("记忆服务已关闭");
    writing = writing.catch(() => undefined).then(action);
    await writing;
  };
  const memory: KongmingMemoryV1 = {
    files,
    initialize: (signal) => enqueue(() => initializeMemoryFiles(files, signal)),
    async readFrozen(signal) {
      if (closed) throw Error("记忆服务已关闭");
      await writing;
      return readFrozenFile(files, signal);
    },
    appendOriginal: (content, signal) =>
      enqueue(() => appendOriginalFile(files, content, signal)),
    refreshFrozen: (result, signal) =>
      enqueue(async () => {
        if (publishedId === result.compactionId) return;
        await replaceFrozenFile(files, signal);
        publishedId = result.compactionId;
      }),
    bindAgent(agent) {
      if (closed) throw Error("记忆服务已关闭");
      const existing = bindings.get(agent);
      if (existing !== undefined) return existing;
      const releasePrompt = mountFrozenPrompt(agent, memory, promptConfig);
      const releaseTool = mountMemoryTool(agent, memory);
      const releaseReminder = mountMemoryReminder(
        agent,
        files,
        promptConfig.reminderPrompt,
      );
      const releaseCompaction = mountCompactionRefresh(agent, memory);
      const release = async (): Promise<void> => {
        releaseReminder();
        releaseTool();
        releasePrompt();
        bindings.delete(agent);
        await releaseCompaction();
      };
      bindings.set(agent, release);
      return release;
    },
    close() {
      closed = true;
      return (closing ??= (async () => {
        await releaseKongming();
        await Promise.all([...bindings.values()].map((release) => release()));
        await writing.catch(() => undefined);
      })());
    },
  };
  const releaseKongming = mountKongmingMemory(ctx, memory);
  ctx.effect(
    () => () => memory.close(),
    "kongming-memory-v1: settle files and bindings",
  );
  return memory;
}
