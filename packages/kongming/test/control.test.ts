/** 孔明自有控制入口的鉴权、固定身份、暂停去重及卸载归属回归。 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFixture, type WebFixture } from "./fixtures/process.ts";
import {
  controlledResponse,
  singleSession,
} from "./fixtures/single-session.ts";
import { textResponse } from "./fixtures/mock-adapter.ts";

await test(
  "孔明控制入口要求登录、限定固定身份，空队列继续保持空闲",
  { timeout: 90000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "kmh-kongming-control-"));
    let app: WebFixture | undefined;
    try {
      app = await startFixture(root);
      const response = await fetch(
        new URL("/api/kmh-kongming/control", app.url),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resume" }),
        },
      );
      assert.equal(response.status, 401);
      await response.arrayBuffer();
      await assert.rejects(
        app.api("/api/kmh-kongming/control", {
          action: "resume",
          sessionId: randomUUID(),
        }),
        /Unrecognized key/,
      );
      await assert.rejects(
        app.api("/api/kmh-kongming/control", {
          action: "prompt",
          text: "  ",
          requestId: randomUUID(),
        }),
        /输入内容不能为空/,
      );
      await app.control({ action: "resume" });
      const state = await app.api("/api/kmh-kongming-test/inspect?wait=idle");
      assert.equal(state.requests.length, 0);
      assert.equal(
        state.events.filter((e) => e.type === "turn/start").length,
        0,
      );
    } finally {
      await app?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

await test(
  "暂停输入保留原消息身份与请求去重，卸载后原控制器拒绝继续",
  { timeout: 20000 },
  async () => {
    const gate = controlledResponse(textResponse("原始输出"));
    await singleSession(
      [gate.stream, textResponse("继续完成")],
      async (host) => {
        await host.prompt("开始");
        await gate.entered;
        host.cancel();
        await host.agent.whenIdle();
        const id = randomUUID();
        await host.prompt("排队消息", "queue", id);
        const queued = host.agent.inbox.nextTurn[0];
        assert.ok(queued);
        await host.prompt("排队消息", "queue", id);
        assert.equal(host.agent.inbox.nextTurn.length, 1);
        assert.equal(host.adapter.requests.length, 1);
        host.resume();
        host.resume();
        await host.agent.whenIdle();
        assert.deepEqual(host.users(), ["开始", "排队消息"]);
        const saved = host
          .events()
          .find(
            (event) =>
              event.type === "user/message" && event.data.id === queued.id,
          );
        assert.ok(saved);
        assert.equal(host.adapter.requests.length, 2);
        const control = host.runtime.control;
        await host.runtime.close();
        assert.throws(() => control.resume(), /已释放/);
      },
      [gate],
    );
  },
);
