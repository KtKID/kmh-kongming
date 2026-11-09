/** 原生会话入口的流式、多轮、空输入和失败恢复测试。 */
import type { Agent } from "@deepseek-ai/dsh-agent";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { SessionRequestId } from "@deepseek-ai/dsh-api-session-controller";
import type { EnsureResult } from "../lib/src/protocol/index.js";
import type { ScriptEntry } from "./fixtures/mock-adapter.ts";
import { requestAt } from "./fixtures/mock-adapter.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defaultConfig } from "./fixtures/config.ts";
import { KongmingRuntime } from "../lib/src/session.js";
import { createHost, getAgent, type Host } from "./fixtures/host.ts";
import { textResponse, messageText } from "./fixtures/mock-adapter.ts";
type ChatHost = Host & {
  runtime: KongmingRuntime;
  ready: EnsureResult;
  agent: Agent;
  send: (text: string) => Promise<void>;
};
async function fixture(
  script: readonly ScriptEntry[],
  task: (host: ChatHost) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "kmh-kongming-chat-"));
  const paths = { home: join(root, "home"), projectDir: join(root, "proj") };
  await mkdir(paths.projectDir, { recursive: true });
  let host: Host | undefined;
  try {
    host = await createHost({ ...paths, script });
    const runtime = new KongmingRuntime(host.ctx, defaultConfig(), paths);
    const ready = await runtime.ensure();
    const sessionId = SessionId(ready.sessionId);
    const agent = getAgent(host.ctx, sessionId);
    const controller = host.ctx.sessionController;
    const send = async (text: string) => {
      await controller.prompt(
        {
          sessionId,
          requestId: brandString<SessionRequestId>(randomUUID()),
          mode: "queue",
          content: [{ type: "text", text }],
        },
        new AbortController().signal,
      );
      await agent.whenIdle();
    };
    await task({ ...host, runtime, ready, agent, send });
  } finally {
    await host?.close();
    await rm(root, { recursive: true, force: true });
  }
}

await test(
  "T02.1/T02.2: the standard prompt entry streams and carries the actual prior turn and persona",
  { timeout: 10000 },
  async () => {
    const gate = Promise.withResolvers<void>();
    const observed = Promise.withResolvers<void>();
    await fixture(
      [
        async function* () {
          const chunks = textResponse(
            "建议先确定验收标准，依据是关键流程优先，条件是范围已明确",
          );
          yield* chunks.slice(0, 2);
          await gate.promise;
          yield* chunks.slice(2);
        },
        (options) =>
          textResponse(
            options.messages.some(
              (m) => m.role === "user" && messageText(m).includes("青竹"),
            )
              ? "青竹"
              : "缺少历史",
          ),
      ],
      async ({ adapter, agent, send }) => {
        const chunks = [];
        agent.ctx.on("agent/assistant-stream", ({ frame }) => {
          chunks.push(frame);
          if (JSON.stringify(frame).includes("text-delta")) observed.resolve();
        });
        const running = send("这次讨论叫青竹，帮我分析方案");
        try {
          await observed.promise;
          assert.equal(
            agent.session.snapshotEvents().filter((e) => e.type === "turn/end")
              .length,
            0,
          );
        } finally {
          gate.resolve();
        }
        await running;
        await send("这次讨论叫什么");
        assert.equal(adapter.requests.length, 2);
        const system = requestAt(adapter, 0)
          .messages.filter((m) => m.role === "system")
          .map(messageText)
          .join("\n");
        assert.ok(system.includes("孔明"));
        assert.ok(system.includes("判断依据"));
        assert.ok(chunks.length > 2);
        assert.ok(
          agent.session
            .snapshotEvents()
            .some(
              (e) =>
                e.type === "assistant/message" &&
                messageText(e.data.message) === "青竹",
            ),
        );
        assert.equal(
          agent.session.snapshotEvents().filter((e) => e.type === "turn/end")
            .length,
          2,
        );
      },
    );
  },
);
await test("T02.3: whitespace is refused before admitting a model request or history", async () => {
  await fixture([], async ({ agent, adapter, send }) => {
    const before = agent.session.snapshotEvents().length;
    for (const text of ["", "   \n"])
      await assert.rejects(send(text), /non-whitespace/);
    assert.equal(adapter.requests.length, 0);
    assert.equal(agent.session.snapshotEvents().length, before);
  });
});
await test("T02.4: model failure keeps the user input and next send continues the same identity", async () => {
  await fixture(
    [
      [
        {
          type: "finish",
          reason: {
            kind: "error",
            failure: { code: "SERVER", message: "mock unavailable" },
          },
        },
      ],
      textResponse("恢复成功"),
    ],
    async ({ agent, adapter, ready, send }) => {
      const errors: unknown[] = [];
      agent.ctx.on("agent/error", ({ error }) => errors.push(error));
      await send("第一轮故障");
      assert.ok(errors.length > 0);
      assert.ok(
        agent.session
          .snapshotEvents()
          .some(
            (e) =>
              e.type === "user/message" &&
              messageText(e.data).includes("第一轮故障"),
          ),
      );
      await send("继续");
      assert.equal(agent.id, ready.sessionId);
      assert.equal(adapter.requests.length, 2);
      assert.ok(
        agent.session
          .snapshotEvents()
          .some(
            (e) =>
              e.type === "assistant/message" &&
              messageText(e.data.message) === "恢复成功",
          ),
      );
    },
  );
});
