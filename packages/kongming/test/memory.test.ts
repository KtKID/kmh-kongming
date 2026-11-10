/** 完整冻结正文、首次复制和原始文件变化的真实请求验证。 */
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { HostPaths } from "./fixtures/host.ts";
import { requestAt } from "./fixtures/mock-adapter.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defaultConfig } from "./fixtures/config.ts";
import { KongmingRuntime } from "../lib/src/session/runtime.js";
import { createHost, getAgent, type Host } from "./fixtures/host.ts";
import { textResponse, messageText } from "./fixtures/mock-adapter.ts";

type MemoryHost = Host & {
  runtime: KongmingRuntime;
  paths: HostPaths;
  directory: string;
  agent: Agent;
  send: (text: string) => Promise<void>;
};
async function fixture(
  original: string | undefined,
  task: (host: MemoryHost) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "kmh-kongming-memory-"));
  const paths = { home: join(root, "home"), projectDir: join(root, "proj") };
  const directory = join(paths.home, ".kongming");
  await mkdir(paths.projectDir, { recursive: true });
  if (original !== undefined) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "MEMORY.md"), original);
  }
  let host: Host | undefined;
  try {
    host = await createHost({
      ...paths,
      script: [textResponse("第一轮"), textResponse("第二轮")],
    });
    const runtime = new KongmingRuntime(host.ctx, defaultConfig(), paths);
    const ready = await runtime.ensure();
    const agent = getAgent(host.ctx, SessionId(ready.sessionId));
    const send = async (text: string) => {
      agent.followup(
        createUserMessage({
          content: [{ type: "text", text }],
          source: { kind: "user" },
        }),
      );
      await agent.whenIdle();
    };
    await task({ ...host, runtime, paths, directory, agent, send });
  } finally {
    await host?.close();
    await rm(root, { recursive: true, force: true });
  }
}

await test("T07.1: first use copies all original bytes and delivers literal frozen text in the actual system message", async () => {
  const original = "长期事实：青竹\n\n保留 {{example}} 原文\n尾部换行\n";
  await fixture(original, async ({ directory, adapter, send }) => {
    assert.deepEqual(
      await readFile(join(directory, "MEMORY.frozen.md")),
      Buffer.from(original),
    );
    assert.equal(
      await readFile(join(directory, "MEMORY.md"), "utf8"),
      original,
    );
    await send("询问记忆");
    const system = requestAt(adapter, 0)
      .messages.filter((m) => m.role === "system")
      .map(messageText)
      .join("\n");
    assert.ok(system.includes(original));
    assert.ok(system.includes(join(directory, "MEMORY.md")));
    assert.ok(system.includes(join(directory, "MEMORY.frozen.md")));
  });
});
await test("T07.2/T07.3: ordinary requests carry the same frozen content while original memory changes", async () => {
  await fixture("冻结版本甲\n", async ({ directory, adapter, send }) => {
    await send("普通问题");
    await writeFile(join(directory, "MEMORY.md"), "原始版本乙\n");
    await send("继续交流");
    assert.equal(adapter.requests.length, 2);
    for (const request of adapter.requests) {
      const system = request.messages
        .filter((m) => m.role === "system")
        .map(messageText)
        .join("\n");
      assert.ok(system.includes("冻结版本甲\n"));
      assert.equal(system.includes("原始版本乙\n"), false);
    }
    assert.equal(
      await readFile(join(directory, "MEMORY.frozen.md"), "utf8"),
      "冻结版本甲\n",
    );
    assert.equal(
      await readFile(join(directory, "MEMORY.md"), "utf8"),
      "原始版本乙\n",
    );
  });
});
await test("T09.1/T05.3: an empty home initializes two empty files and plain chat leaves them intact", async () => {
  await fixture(undefined, async ({ directory, adapter, send, agent }) => {
    await send("你好");
    assert.equal(await readFile(join(directory, "MEMORY.md"), "utf8"), "");
    assert.equal(
      await readFile(join(directory, "MEMORY.frozen.md"), "utf8"),
      "",
    );
    assert.equal(
      agent.session.snapshotEvents().filter((e) => e.type === "tool/call")
        .length,
      0,
    );
    assert.equal(
      requestAt(adapter, 0)
        .messages.filter((m) => m.role === "system")
        .map(messageText)
        .join("\n")
        .includes(
          "每次完成对话或完成任务后，把有价值的内容和踩坑记录到记忆文件里",
        ),
      false,
    );
  });
});

await test("K01：孔明绑定独立记忆服务后，维护指令由同轮 steer 送达", async () => {
  const root = await mkdtemp(join(tmpdir(), "kmh-reminder-binding-"));
  const paths = { home: join(root, "home"), projectDir: join(root, "proj") };
  const instruction =
    "每次完成对话或完成任务后，把有价值的内容和踩坑记录到记忆文件里";
  let host: Host | undefined;
  try {
    await mkdir(paths.projectDir, { recursive: true });
    host = await createHost({
      ...paths,
      memoryReminder: true,
      script: [textResponse("普通任务已完成"), textResponse("记忆检查结束")],
    });
    const runtime = new KongmingRuntime(host.ctx, defaultConfig(), paths);
    const binding = await runtime.ensure();
    const agent = getAgent(host.ctx, SessionId(binding.sessionId));
    agent.followup(
      createUserMessage({
        content: [{ type: "text", text: "请分析这个问题" }],
        source: { kind: "user" },
      }),
    );
    await agent.whenIdle();
    assert.equal(host.adapter.requests.length, 2);
    assert.ok(
      requestAt(host.adapter, 1)
        .messages.filter((m) => m.role === "user")
        .map(messageText)
        .join("\n")
        .includes(instruction),
    );
    for (const request of host.adapter.requests) {
      assert.equal(
        request.messages
          .filter((m) => m.role === "system")
          .map(messageText)
          .join("\n")
          .includes(instruction),
        false,
      );
    }
    assert.equal(
      agent.session.snapshotEvents().filter((e) => e.type === "turn/start")
        .length,
      1,
    );
    assert.equal(
      agent.session
        .snapshotEvents()
        .filter(
          (e) =>
            e.type === "user/message" &&
            e.data.source.kind === "kongming-memory-v1:reminder",
        ).length,
      1,
    );
  } finally {
    await host?.close();
    await rm(root, { recursive: true, force: true });
  }
});
