/** 单会话测试共享真实宿主；屏障只控制外部模型输出时机。 */
import type {
  GenerateOptions,
  StreamChunk,
  MessageId,
} from "@deepseek-ai/dsh-llm";
import type {
  SessionPromptRequest,
  SessionUpdateQueueRequest,
} from "@deepseek-ai/dsh-api-session-controller";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defaultConfig } from "./config.ts";
import { KongmingRuntime } from "../../lib/src/session/runtime.js";
import { createHost, getAgent, type HostPaths } from "./host.ts";
import { messageText, type ScriptEntry } from "./mock-adapter.ts";

/** 返回可放行、可取消的模型屏障；调用方在 finally 放行并等待宿主退出。 */
export function controlledResponse(
  chunks: readonly StreamChunk[],
  beforeFirstChunk = false,
) {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  let settled = false;
  const stream = async function* (
    options: GenerateOptions,
  ): AsyncGenerator<StreamChunk> {
    const onAbort = () => {
      aborted.resolve();
      release.resolve();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      options.signal?.throwIfAborted();
      const split = beforeFirstChunk ? 0 : 2;
      yield* chunks.slice(0, split);
      entered.resolve();
      await release.promise;
      options.signal?.throwIfAborted();
      yield* chunks.slice(split);
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      settled = true;
    }
  };
  return {
    stream,
    entered: entered.promise,
    aborted: aborted.promise,
    release: () => release.resolve(),
    get settled() {
      return settled;
    },
  };
}

/** 以同一个 home 打开真实固定会话，close 会等待所有插件完成退出。 */
export async function openSession(
  paths: HostPaths,
  script: readonly ScriptEntry[] = [],
) {
  await mkdir(paths.projectDir, { recursive: true });
  const host = await createHost({ ...paths, script });
  try {
    const runtime = new KongmingRuntime(host.ctx, defaultConfig(), paths);
    const binding = await runtime.ensure();
    const sessionId = SessionId(binding.sessionId);
    const agent = getAgent(host.ctx, sessionId);
    const controller = host.ctx.sessionController;
    return {
      ...host,
      runtime,
      binding,
      agent,
      paths,
      prompt: (
        text: string,
        mode: SessionPromptRequest["mode"] = "queue",
        requestId: string = randomUUID(),
      ) => runtime.control.prompt(text, mode, requestId),
      cancel: () => runtime.control.cancel(),
      resume: () => runtime.control.resume(),
      supplement: (text: string) => runtime.control.supplement(text),
      queue: (itemId: MessageId, action: SessionUpdateQueueRequest["action"]) =>
        controller.updateQueue({ sessionId, itemId, action }),
      events: () => agent.session.snapshotEvents(),
      users: () =>
        agent.session
          .snapshotEvents()
          .filter((e) => e.type === "user/message")
          .filter((e) => e.data.source.kind === "user")
          .map((e) => messageText(e.data)),
    };
  } catch (error) {
    await host.close();
    throw error;
  }
}

/** 每例独占目录；先释放模型屏障，再收敛宿主，最后清理文件。 */
export async function singleSession(
  script: readonly ScriptEntry[],
  task: (host: SingleSession) => Promise<void>,
  gates: readonly ReturnType<typeof controlledResponse>[] = [],
) {
  const root = await mkdtemp(join(tmpdir(), "kmh-kongming-controls-"));
  const paths = { home: join(root, "home"), projectDir: join(root, "proj") };
  let host: SingleSession | undefined;
  try {
    host = await openSession(paths, script);
    await task(host);
  } finally {
    for (const gate of gates) gate.release();
    await host?.close();
    await rm(root, { recursive: true, force: true });
  }
}

export type SingleSession = Awaited<ReturnType<typeof openSession>>;
