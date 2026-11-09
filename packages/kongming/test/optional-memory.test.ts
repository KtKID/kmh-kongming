/** 插件启停使用真实 Cordis Fiber；孔明身份、请求、文件与执行取消状态均从实际链路观察。 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  access,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import * as Memory from "@kmh/kongming-memory-v1";
import * as Core from "../lib/src/index.js";
import { KongmingRuntime } from "../lib/src/session.js";
import { defaultConfig, defaultMemoryConfig } from "./fixtures/config.ts";
import {
  createHost,
  getAgent,
  type Host,
  type HostPaths,
} from "./fixtures/host.ts";
import { startFixture, type WebFixture } from "./fixtures/process.ts";
import { controlledResponse } from "./fixtures/single-session.ts";
import {
  textResponse,
  requestAt,
  messageText,
  type ScriptEntry,
} from "./fixtures/mock-adapter.ts";

function installCore(ctx: Context, paths: HostPaths) {
  return ctx.plugin({
    name: "independent-kongming",
    inject: Core.inject,
    apply(inner: Context) {
      inner.provide(
        "kongming",
        new KongmingRuntime(inner, defaultConfig(), paths),
      );
    },
  });
}

function installMemory(ctx: Context, paths: HostPaths, reminders = false) {
  return ctx.plugin({
    name: "optional-memory",
    inject: Memory.inject,
    apply(inner: Context) {
      inner.provide(
        "kongmingMemoryV1",
        Memory.createMemoryService(
          inner,
          Memory.resolveMemoryFiles(paths.home),
          {
            ...defaultMemoryConfig(),
            reminderPrompt: reminders
              ? defaultMemoryConfig().reminderPrompt
              : "",
          },
        ),
      );
    },
  });
}

async function fixture(
  script: readonly ScriptEntry[],
  task: (host: Host, paths: HostPaths) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "kmh-memory-optional-"));
  const paths = { home: join(root, "home"), projectDir: join(root, "proj") };
  let host;
  try {
    await mkdir(paths.projectDir, { recursive: true });
    host = await createHost({ ...paths, script, memoryPlugin: false });
    await task(host, paths);
  } finally {
    await host?.close();
    await rm(root, { recursive: true, force: true });
  }
}

async function send(host: Host, runtime: KongmingRuntime, text: string) {
  const binding = await runtime.ensure();
  const agent = getAgent(host.ctx, SessionId(binding.sessionId));
  agent.followup(
    createUserMessage({
      content: [{ type: "text", text }],
      source: { kind: "user" },
    }),
  );
  await agent.whenIdle();
  return agent;
}

function system(host: Host, index: number) {
  return requestAt(host.adapter, index)
    .messages.filter((m) => m.role === "system")
    .map(messageText)
    .join("\n");
}

await test(
  "O01：真实 Loader 移除记忆插件后，孔明可准备会话、聊天并执行文件工具",
  { timeout: 60000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "kmh-no-memory-web-"));
    let app: WebFixture | undefined;
    try {
      app = await startFixture(root, { memoryPlugin: false });
      const ready = await app.api("/api/kmh-kongming/ensure", {});
      const state = await app.api("/api/kmh-kongming-test/inspect", {
        text: "读取 input.txt 并报告结果",
      });
      assert.equal(state.binding.sessionId, ready.sessionId);
      assert.equal(state.requests.length, 2);
      const afterRead = state.requests[1];
      assert.ok(afterRead);
      assert.ok(
        afterRead.messages.some(
          (message) =>
            message.role === "tool" &&
            message.content.some((block) =>
              block.text?.includes("PROJECT_READ_OK"),
            ),
        ),
      );
      assert.ok(
        state.events.some((event) => event.type === "assistant/message"),
      );
      await assert.rejects(access(join(app.home, ".kongming/MEMORY.md")), {
        code: "ENOENT",
      });
      await assert.rejects(
        access(join(app.home, ".kongming/MEMORY.frozen.md")),
        { code: "ENOENT" },
      );
    } finally {
      await app?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

await test("O02：任务执行中卸载记忆 Fiber，孔明实例和当前任务继续运行", async () => {
  const gate = controlledResponse(textResponse("任务已完成"), true);
  try {
    await fixture(
      [gate.stream, textResponse("继续聊天")],
      async (host, paths) => {
        await mkdir(join(paths.home, ".kongming"), { recursive: true });
        await writeFile(
          join(paths.home, ".kongming/MEMORY.md"),
          "冻结事实：青竹",
        );
        const memory = await installMemory(host.ctx, paths, true);
        await installCore(host.ctx, paths);
        const runtime = host.ctx.kongming;
        assert.ok(runtime);
        const ready = await runtime.ensure();
        const agent = getAgent(host.ctx, SessionId(ready.sessionId));
        agent.followup(
          createUserMessage({
            content: [{ type: "text", text: "开始长任务" }],
            source: { kind: "user" },
          }),
        );
        await gate.entered;
        await memory.dispose();
        assert.ok(host.ctx.kongming === runtime, "停用记忆后孔明实例应保留");
        assert.ok(host.ctx.agents.get(agent.id) === agent, "当前 Agent 应保留");
        assert.equal(gate.settled, false);
        gate.release();
        await agent.whenIdle();
        assert.equal(
          await readFile(
            join(paths.home, ".kongming/MEMORY.frozen.md"),
            "utf8",
          ),
          "冻结事实：青竹",
        );
        await send(host, runtime, "后续聊天");
        assert.equal(system(host, 1).includes("<kongming-memory>"), false);
        assert.equal(host.adapter.requests.length, 2);
      },
    );
  } finally {
    gate.release();
  }
  // 组装回调已进入后再卸载，检验已等待的记忆回调也能随能力退出。
  await fixture([textResponse("组装期间卸载后完成")], async (host, paths) => {
    const memory = await installMemory(host.ctx, paths);
    await installCore(host.ctx, paths);
    const runtime = host.ctx.kongming;
    assert.ok(runtime);
    const ready = await runtime.ensure();
    const agent = getAgent(host.ctx, SessionId(ready.sessionId));
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const stop = agent.ctx.on(
      "system-prompt/assemble",
      async (_assembly, _context, next) => {
        entered.resolve();
        await release.promise;
        return next();
      },
    );
    try {
      agent.followup(
        createUserMessage({
          content: [{ type: "text", text: "组装期间卸载" }],
          source: { kind: "user" },
        }),
      );
      await Promise.race([
        entered.promise,
        agent.whenIdle().then(() => {
          throw Error("组装屏障前请求已结束");
        }),
      ]);
      await memory.dispose();
      release.resolve();
      await agent.whenIdle();
      assert.equal(host.adapter.requests.length, 1);
      assert.equal(system(host, 0).includes("<kongming-memory>"), false);
    } finally {
      release.resolve();
      stop();
    }
  });
});

await test("O03：孔明先启动，记忆反复启停后继续使用同一会话和已有冻结", async () => {
  await fixture(
    Array.from({ length: 5 }, () => textResponse("正常回复")),
    async (host, paths) => {
      await installCore(host.ctx, paths);
      const runtime = host.ctx.kongming;
      assert.ok(runtime);
      const agent = await send(host, runtime, "启用前");
      assert.equal(system(host, 0).includes("<kongming-memory>"), false);
      await writeFile(join(paths.home, ".kongming/MEMORY.md"), "冻结 A");
      const first = await installMemory(host.ctx, paths);
      await send(host, runtime, "启用后");
      assert.ok(system(host, 1).includes("冻结 A"));
      await first.dispose();
      await send(host, runtime, "停用后");
      assert.equal(system(host, 2).includes("<kongming-memory>"), false);
      await writeFile(join(paths.home, ".kongming/MEMORY.md"), "raw B");
      await installMemory(host.ctx, paths, true);
      const after = await send(host, runtime, "再次启用");
      assert.equal(after, agent);
      assert.equal(host.ctx.kongming, runtime);
      // f7d6858 起启动绑定会把非空原始完整重发为冻结：再次启用注入的是重发后的最新原始。
      assert.equal(system(host, 3).includes("冻结 A"), false);
      assert.ok(system(host, 3).includes("raw B"));
      assert.equal(host.adapter.requests.length, 5);
      assert.ok(
        requestAt(host.adapter, 4).messages.some(
          (message) =>
            message.role === "user" &&
            messageText(message).includes("每次完成对话或完成任务后"),
        ),
      );
      assert.equal(
        await readFile(join(paths.home, ".kongming/MEMORY.md"), "utf8"),
        "raw B",
      );
    },
  );
});

await test("O04：孔明独立卸载重建后沿用固定身份和已有历史", async () => {
  await fixture(
    [textResponse("重启前"), textResponse("重启后")],
    async (host, paths) => {
      const before = await installCore(host.ctx, paths);
      const first = host.ctx.kongming;
      assert.ok(first);
      const agent = await send(host, first, "应保留的历史");
      await before.dispose();
      await installCore(host.ctx, paths);
      const restored = host.ctx.kongming;
      assert.ok(restored);
      const after = await send(host, restored, "继续工作");
      assert.equal(after.id, agent.id);
      assert.ok(
        requestAt(host.adapter, 1).messages.some(
          (m) => m.role === "user" && messageText(m).includes("应保留的历史"),
        ),
      );
    },
  );
});

await test("O05：记忆准备失败后移除能力，孔明保持原身份并继续聊天", async () => {
  await fixture([textResponse("恢复基础聊天")], async (host, paths) => {
    await installCore(host.ctx, paths);
    const runtime = host.ctx.kongming;
    assert.ok(runtime);
    const before = await runtime.ensure();
    await mkdir(join(paths.home, ".kongming/MEMORY.md"));
    const memory = await installMemory(host.ctx, paths);
    assert.ok(host.ctx.kongming === runtime);
    await memory.dispose();
    const after = await runtime.ensure();
    assert.equal(after.sessionId, before.sessionId);
    await send(host, runtime, "恢复基础聊天");
    assert.equal(host.adapter.requests.length, 1);
    assert.equal(system(host, 0).includes("<kongming-memory>"), false);
  });
});
