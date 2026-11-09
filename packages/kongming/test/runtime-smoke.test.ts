/** 经真实 Loader/Web 子进程验证聊天、文件工具、记忆与重启；LLM 全部使用 mock。 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFixture, type WebFixture } from "./fixtures/process.ts";
await test(
  "T01/T02/T03/T04/T05/T07: clean Loader composition completes the fixed assistant workflow and process restart",
  { timeout: 90000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "kmh-kongming-loader-"));
    let app: WebFixture | undefined;
    try {
      app = await startFixture(root);
      const first = await app.api("/api/kmh-kongming/ensure", {});
      const again = await app.api("/api/kmh-kongming/ensure", {});
      assert.equal(first.sessionId, again.sessionId);
      const initialApp = app;
      const send = (text: string) =>
        initialApp.api("/api/kmh-kongming-test/inspect", { text });
      await send("这次讨论叫青竹");
      let state = await send("这次讨论叫什么");
      assert.ok(JSON.stringify(state.events).includes("这次讨论叫青竹"));
      state = await send("读取 input.txt");
      assert.ok(JSON.stringify(state.events).includes("PROJECT_READ_OK"));
      state = await send("以后给我的开发方案，先列验收标准，再列实现步骤");
      assert.ok(state.original.includes("先列验收标准"));
      assert.equal(state.frozen, "");
      assert.equal(state.binding.cwd, app.projectDir);
      await app.close();
      app = undefined;
      app = await startFixture(root);
      const restored = await app.api("/api/kmh-kongming-test/inspect");
      assert.equal(restored.binding.sessionId, first.sessionId);
      assert.ok(restored.original.includes("先列验收标准"));
      assert.equal(restored.frozen, "");
      assert.ok(JSON.stringify(restored.events).includes("青竹"));
      const continued = await app.api("/api/kmh-kongming-test/inspect", {
        text: "重启后继续",
      });
      assert.equal(continued.requests.length, 1);
    } finally {
      await app?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
