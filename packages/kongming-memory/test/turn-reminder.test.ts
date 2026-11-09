/** 收尾提醒经真实 Agent 循环进入同轮后续请求，文件工具与结束事件均保留真实实现。 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createUserMessage,
  ToolCallId,
  type StreamChunk,
  type GenerateOptions,
} from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import type { UserMessage } from "@deepseek-ai/dsh-llm";
import {
  createMockHost,
  type MemoryMockHost,
  type MockReply,
} from "./fixtures/mock-host.ts";
import { defaultMemoryConfig } from "./fixtures/config.ts";
import { createMemoryService } from "../src/index.ts";

const reminderKind = "kongming-memory-v1:reminder";
const instruction =
  "每次完成对话或完成任务后，把有价值的内容和踩坑记录到记忆文件里";
const frozen = "原有事实：青竹\n";

function textReply(
  text: string,
  reason: "stop" | "max-tokens" = "stop",
): StreamChunk[] {
  return [
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text },
    { type: "block-end", index: 0, block: { type: "text", text } },
    { type: "finish", reason: { kind: reason } },
  ];
}

function toolReply(
  name: string,
  args: Record<string, unknown>,
  suffix: string,
): StreamChunk[] {
  const id = ToolCallId(`reminder-${suffix}`);
  const value = JSON.stringify(args);
  return [
    { type: "block-start", index: 0, blockType: "tool-call" },
    { type: "tool-call-delta", index: 0, id, name, argumentsDelta: value },
    {
      type: "block-end",
      index: 0,
      block: { type: "tool-call", id, name, arguments: value },
    },
    { type: "finish", reason: { kind: "tool-calls" } },
  ];
}

function content(request: GenerateOptions, role: "user" | "system"): string {
  return request.messages
    .filter((m) => m.role === role)
    .flatMap((m) => m.content)
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function requestAt(host: MemoryMockHost, index: number): GenerateOptions {
  const request = host.requests[index];
  assert.ok(request, `应存在第 ${index + 1} 次模型请求`);
  return request;
}

function barrier() {
  let finish: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return {
    promise,
    resolve: () => {
      assert.ok(finish);
      finish();
    },
  };
}

function reminders(host: MemoryMockHost) {
  return host.agent.session
    .snapshotEvents()
    .filter(
      (e) => e.type === "user/message" && e.data.source.kind === reminderKind,
    );
}

async function send(host: MemoryMockHost, text = "请完成任务") {
  host.agent.followup(
    createUserMessage({
      content: [{ type: "text", text }],
      source: { kind: "user" },
    }),
  );
  await host.agent.whenIdle();
}

async function fixture(
  replies: (files: {
    original: string;
    frozen: string;
  }) => readonly MockReply[],
  task: (host: MemoryMockHost) => Promise<void>,
  prompt = defaultMemoryConfig().reminderPrompt,
) {
  const root = await mkdtemp(join(tmpdir(), "memory-turn-reminder-"));
  const projectDir = root;
  const home = join(root, "home");
  const files = {
    original: join(home, ".kongming/MEMORY.md"),
    frozen: join(home, ".kongming/MEMORY.frozen.md"),
  };
  let host;
  try {
    await mkdir(join(home, ".kongming"), { recursive: true });
    await writeFile(files.original, frozen);
    await writeFile(files.frozen, frozen);
    host = await createMockHost({
      home,
      projectDir,
      replies: replies(files),
      reminderPrompt: prompt,
      fileTools: true,
    });
    await task(host);
  } finally {
    await host?.close();
    await rm(root, { recursive: true, force: true });
  }
}

await test("R01 / S01/S02/S04：系统只加载记忆上下文，任务收尾后同轮提醒并用真实文件工具保存 raw", async () => {
  await fixture(
    (files) => [
      textReply("任务已完成"),
      toolReply("read", { file_path: files.original }, "read"),
      toolReply(
        "write",
        {
          file_path: files.original,
          content: frozen + "新偏好：先列验收标准\n",
        },
        "write",
      ),
      textReply("已保存偏好"),
    ],
    async (host) => {
      await send(host, "以后先列验收标准");
      assert.equal(host.requests.length, 4);
      assert.equal(reminders(host).length, 1);
      assert.ok(content(requestAt(host, 1), "user").includes(instruction));
      for (const request of host.requests) {
        assert.equal(content(request, "system").includes(instruction), false);
        assert.equal(
          content(request, "system").includes("每轮最终回复前检查长期价值"),
          false,
        );
        assert.ok(content(request, "system").includes(frozen));
      }
      const events = host.agent.session.snapshotEvents();
      const taskReply = events.find((e) => e.type === "assistant/message");
      const reminder = reminders(host)[0];
      assert.ok(taskReply && reminder && reminder.seq > taskReply.seq);
      assert.equal(events.filter((e) => e.type === "turn/start").length, 1);
      assert.equal(events.filter((e) => e.type === "turn/end").length, 1);
      assert.equal(
        events.filter((e) => e.type === "tool/result" && e.data.message.isError)
          .length,
        0,
      );
      assert.equal(
        await readFile(host.files.original, "utf8"),
        frozen + "新偏好：先列验收标准\n",
      );
      assert.equal(await readFile(host.files.frozen, "utf8"), frozen);
    },
  );
});

await test("R02 / S05：每轮各提醒一次，普通 Agent 保持独立", async () => {
  await fixture(
    () => [
      textReply("第一轮"),
      textReply("已检查"),
      textReply("第二轮"),
      textReply("已检查"),
      textReply("普通回复"),
    ],
    async (host) => {
      await send(host);
      await send(host);
      assert.equal(reminders(host).length, 2);
      const ordinary = await host.createAgent(
        SessionId("ordinary-reminder-test"),
      );
      ordinary.followup(
        createUserMessage({
          content: [{ type: "text", text: "普通问题" }],
          source: { kind: "user" },
        }),
      );
      await ordinary.whenIdle();
      assert.equal(
        ordinary.session
          .snapshotEvents()
          .filter(
            (e) =>
              e.type === "user/message" && e.data.source.kind === reminderKind,
          ).length,
        0,
      );
    },
  );
});

await test("R03 / S06：max-tokens 事实保持整轮，下一正常轮恢复提醒", async () => {
  await fixture(
    () => [
      textReply("达到上限", "max-tokens"),
      textReply("其他 steer 继续"),
      textReply("下一轮"),
      textReply("检查结束"),
    ],
    async (host) => {
      let extended = false;
      host.agent.ctx.on("agent/turn-stopping", ({ turn }) => {
        if (turn === 1 && !extended) {
          extended = true;
          host.agent.steer(
            createUserMessage({
              content: [{ type: "text", text: "外部继续" }],
              source: { kind: "user" },
            }),
          );
        }
      });
      await send(host);
      assert.equal(host.requests.length, 2);
      assert.equal(reminders(host).length, 0);
      await send(host);
      assert.equal(host.requests.length, 4);
      assert.equal(reminders(host).length, 1);
    },
  );
});

await test("R04 / S07：模型异常与用户取消均按实际结果结束并保持零提醒", async () => {
  await fixture(
    () => [new Error("脚本模型失败")],
    async (host) => {
      await send(host);
      assert.equal(reminders(host).length, 0);
      const end = host.agent.session
        .snapshotEvents()
        .findLast((e) => e.type === "turn/end");
      assert.ok(end?.type === "turn/end");
      assert.equal(end.data.reason.kind, "error");
    },
  );
  const entered = barrier();
  const release = barrier();
  async function* blocked(): AsyncGenerator<StreamChunk> {
    entered.resolve();
    await release.promise;
    yield* textReply("恢复");
  }
  try {
    await fixture(
      () => [blocked()],
      async (host) => {
        try {
          host.agent.followup(
            createUserMessage({
              content: [{ type: "text", text: "长任务" }],
              source: { kind: "user" },
            }),
          );
          await Promise.race([
            entered.promise,
            host.agent.whenIdle().then(() => {
              throw Error("模型进入受控屏障前已结束");
            }),
          ]);
          host.agent.cancel({ kind: "user" });
          release.resolve();
          await host.agent.whenIdle();
          assert.equal(reminders(host).length, 0);
        } finally {
          release.resolve();
        }
      },
    );
  } finally {
    release.resolve();
  }
});

await test("R05 / S11：提醒进入队列后重建服务，既有证据阻止同轮重复提醒", async () => {
  await fixture(
    () => [textReply("任务结束"), textReply("已维护")],
    async (host) => {
      let restored = false;
      host.agent.ctx.on("agent/pre-step", async ({ messages }, next) => {
        if (
          !restored &&
          messages.some((m: UserMessage) => m.source.kind === reminderKind)
        ) {
          restored = true;
          await host.memory.close();
          const memory = createMemoryService(
            host.ctx,
            host.files,
            defaultMemoryConfig(),
          );
          await memory.initialize();
          memory.bindAgent(host.agent);
        }
        return next();
      });
      await send(host);
      assert.equal(restored, true);
      assert.equal(host.requests.length, 2);
      assert.equal(reminders(host).length, 1);
    },
  );
});

await test("R06：空配置停用提醒，自定义配置只经 steer 送达", async () => {
  await fixture(
    () => [textReply("直接完成")],
    async (host) => {
      await send(host);
      assert.equal(host.requests.length, 1);
      assert.equal(reminders(host).length, 0);
    },
    "",
  );
  await fixture(
    () => [textReply("普通回复"), textReply("检查完成")],
    async (host) => {
      await send(host);
      assert.equal(reminders(host).length, 1);
      assert.ok(
        content(requestAt(host, 1), "user").includes("配置暗号 {{literal}}"),
      );
      assert.equal(
        content(requestAt(host, 0), "system").includes("配置暗号"),
        false,
      );
    },
    "配置暗号 {{literal}}\n{{originalMemoryPath}}",
  );
});
