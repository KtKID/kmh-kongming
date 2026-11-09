/** 经真实 Loader、鉴权和生成 RPC 验证单会话操作；模型由屏障 mock 控制。 */
import { SessionId } from "@deepseek-ai/dsh-session";
import { MessageId } from "@deepseek-ai/dsh-llm";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { SessionPromptRequest } from "@deepseek-ai/dsh-api-session-controller";
import { UserSchema, InboxSchema, type InspectState } from "./fixtures/wire.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFixture, type WebFixture } from "./fixtures/process.ts";
import { messageText } from "./fixtures/mock-adapter.ts";

type Prompt = (
  text: string,
  mode?: SessionPromptRequest["mode"],
  requestId?: string,
) => Promise<{ accepted: true }>;
async function withWeb(
  task: (host: {
    app: WebFixture;
    sessionId: SessionId;
    prompt: Prompt;
  }) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "kmh-kongming-web-controls-"));
  let app: WebFixture | undefined;
  try {
    app = await startFixture(root);
    const ready = await app.api("/api/kmh-kongming/ensure", {});
    const sessionId = SessionId(ready.sessionId);
    const fixture = app;
    const prompt: Prompt = (
      text,
      mode = "queue",
      requestId = crypto.randomUUID(),
    ) =>
      fixture.control({
        action: "prompt",
        mode,
        requestId: brandString<SessionPromptRequest["requestId"]>(requestId),
        text,
      });
    await task({ app, sessionId, prompt });
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
}
const users = (state: InspectState) =>
  state.events
    .filter((e) => e.type === "user/message")
    .map((e) => UserSchema.parse(e.data))
    .filter((m) => m.source.kind === "user")
    .map(messageText);

await test(
  "S17 Web: queued edits, duplicate receipt, stop and continue preserve one session",
  { timeout: 90000 },
  async () => {
    await withWeb(async ({ app, sessionId, prompt }) => {
      await prompt("受控任务甲");
      await app.api("/api/kmh-kongming-test/barrier");
      const id = crypto.randomUUID();
      await prompt("等待修改", "queue", id);
      await prompt("等待修改", "queue", id);
      await prompt("等待删除");
      const state = await app.api("/api/kmh-kongming-test/inspect");
      const insertions = state.events
        .filter((e) => e.type === "agent/inbox/spliced")
        .flatMap((e) => InboxSchema.parse(e.data).inserted);
      const edit = insertions.find((m) => messageText(m) === "等待修改");
      const remove = insertions.find((m) => messageText(m) === "等待删除");
      assert.ok(edit);
      assert.ok(remove);
      await app.rpc("session/updateQueue", {
        request: {
          sessionId,
          itemId: MessageId(edit.id),
          action: {
            kind: "edit",
            content: [{ type: "text", text: "编辑后待发" }],
          },
        },
      });
      await app.rpc("session/updateQueue", {
        request: {
          sessionId,
          itemId: MessageId(remove.id),
          action: { kind: "remove" },
        },
      });
      await app.control({ action: "stop" });
      const stopped = await app.api("/api/kmh-kongming-test/inspect?wait=idle");
      assert.equal(stopped.requests.length, 1);
      assert.equal(stopped.blocked, 0);
      await prompt("后来的消息");
      await app.control({ action: "resume" });
      const complete = await app.api(
        "/api/kmh-kongming-test/inspect?wait=idle",
      );
      assert.deepEqual(users(complete), [
        "受控任务甲",
        "编辑后待发",
        "后来的消息",
      ]);
      assert.equal(complete.requests.length, 3);
      assert.equal(complete.binding.sessionId, sessionId);
      assert.equal(complete.frozen, "");
    });
  },
);

await test(
  "S18 Web: steer and supplement join the current turn and every request keeps frozen memory",
  { timeout: 90000 },
  async () => {
    await withWeb(async ({ app, prompt }) => {
      await prompt("受控任务乙");
      await app.api("/api/kmh-kongming-test/barrier");
      await prompt("插入本轮", "steer");
      await app.control({ action: "supplement", text: "补充本轮条件" });
      await app.api("/api/kmh-kongming-test/release", {});
      const complete = await app.api(
        "/api/kmh-kongming-test/inspect?wait=idle",
      );
      assert.deepEqual(users(complete), [
        "受控任务乙",
        "插入本轮",
        "补充本轮条件",
      ]);
      assert.equal(
        complete.events.filter((e) => e.type === "turn/end").length,
        1,
      );
      assert.equal(complete.requests.length, 2);
      for (const request of complete.requests) {
        const system = request.messages
          .filter((m) => m.role === "system")
          .map(messageText)
          .join("\n");
        assert.equal(
          system.includes(
            "每次完成对话或完成任务后，把有价值的内容和踩坑记录到记忆文件里",
          ),
          false,
        );
        assert.ok(system.includes("<kongming-memory>\n\n</kongming-memory>"));
      }
    });
  },
);
