/** 保存工具经真实 Agent 循环追加条目；空白拒绝、串行落盘与孔明专属范围均保留真实实现。 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createUserMessage,
  ToolCallId,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import {
  createMockHost,
  type MemoryMockHost,
  type MockReply,
} from "./fixtures/mock-host.ts";
import { defaultMemoryConfig } from "./fixtures/config.ts";

const reminderKind = "kongming-memory-v1:reminder";
const frozen = "原有事实：青竹\n";
const saveTool = "kongming_memory_save";

/** 单条纯文本回复脚本，模拟模型直接给出结论。 */
function textReply(text: string): StreamChunk[] {
  return [
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text },
    { type: "block-end", index: 0, block: { type: "text", text } },
    { type: "finish", reason: { kind: "stop" } },
  ];
}

/** 单次工具调用回复脚本；参数整体 JSON 编码后按增量下发。 */
function toolReply(name: string, args: unknown, suffix: string): StreamChunk[] {
  const id = ToolCallId(`memory-tool-${suffix}`);
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

/** 取第一份收尾提醒的完整文本；提醒缺失时直接失败。 */
function reminderText(host: MemoryMockHost): string {
  const reminder = host.agent.session
    .snapshotEvents()
    .find(
      (e) => e.type === "user/message" && e.data.source.kind === reminderKind,
    );
  assert.ok(reminder?.type === "user/message");
  return (
    reminder.data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n") ?? ""
  );
}

/** 统计指定会话内带错误标记的工具结果，默认检查孔明会话。 */
function errorResults(host: MemoryMockHost, session = host.agent.session) {
  return session
    .snapshotEvents()
    .filter((e) => e.type === "tool/result" && e.data.message.isError);
}

/** 发送一条用户消息并等待本轮任务收敛。 */
async function send(host: MemoryMockHost, text = "请完成任务") {
  host.agent.followup(
    createUserMessage({
      content: [{ type: "text", text }],
      source: { kind: "user" },
    }),
  );
  await host.agent.whenIdle();
}

/** 建立带真实提醒文案与文件工具的私有宿主；任务结束回收临时目录。 */
async function fixture(
  replies: readonly MockReply[],
  task: (host: MemoryMockHost) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "memory-tool-"));
  const projectDir = root;
  const home = join(root, "home");
  let host;
  try {
    await mkdir(join(home, ".kongming"), { recursive: true });
    await writeFile(join(home, ".kongming/MEMORY.md"), frozen);
    await writeFile(join(home, ".kongming/MEMORY.frozen.md"), frozen);
    host = await createMockHost({
      home,
      projectDir,
      replies,
      reminderPrompt: defaultMemoryConfig().reminderPrompt,
      fileTools: true,
    });
    await task(host);
  } finally {
    await host?.close();
    await rm(root, { recursive: true, force: true });
  }
}

await test("T01 / reminder_guides_tool_append：收尾提醒含工具名，模型经保存工具追加且冻结不变", async () => {
  await fixture(
    [
      textReply("任务已完成"),
      toolReply(saveTool, { content: "新偏好：先列验收标准" }, "save"),
      textReply("已保存偏好"),
    ],
    async (host) => {
      await send(host, "以后先列验收标准");
      // 工具成功路径不产生任何错误回执。
      assert.equal(errorResults(host).length, 0);
      // 默认文案必须写明工具名和取舍标准（天气类琐事不记录）。
      const reminder = reminderText(host);
      assert.ok(reminder.includes(saveTool));
      assert.ok(reminder.includes("天气"));
      // 条目以换行追加到原始文件末尾，冻结文件保持不变。
      assert.equal(
        await readFile(host.files.original, "utf8"),
        frozen + "新偏好：先列验收标准\n",
      );
      assert.equal(await readFile(host.files.frozen, "utf8"), frozen);
    },
  );
});

await test("T02 / blank_entry_rejected：空白条目返回工具错误，原始文件保持原样", async () => {
  await fixture(
    [
      textReply("任务已完成"),
      toolReply(saveTool, { content: "   \n\t " }, "blank"),
      textReply("保存失败已说明"),
    ],
    async (host) => {
      await send(host, "记录一件小事");
      // 空白条目被工具拒绝，且不产生任何文件改动。
      assert.equal(errorResults(host).length, 1);
      assert.equal(await readFile(host.files.original, "utf8"), frozen);
      assert.equal(await readFile(host.files.frozen, "utf8"), frozen);
    },
  );
});

await test("T03 / separator_and_serialized：无结尾换行补分隔，并发追加按入队顺序落盘", async () => {
  await fixture([textReply("直接完成")], async (host) => {
    // 直接改写原始文件，模拟外部遗留的无结尾换行状态。
    await writeFile(host.files.original, "既有事实没有结尾换行");
    await assert.rejects(host.memory.appendOriginal("  "));
    // 两个并发追加经服务队列按入队顺序串行落盘。
    await Promise.all([
      host.memory.appendOriginal("第一条"),
      host.memory.appendOriginal("第二条"),
    ]);
    assert.equal(
      await readFile(host.files.original, "utf8"),
      "既有事实没有结尾换行\n第一条\n第二条\n",
    );
    assert.equal(await readFile(host.files.frozen, "utf8"), frozen);
  });
});

await test("T04 / ordinary_agent_cannot_save：普通 Agent 调用同名工具失败且文件不变", async () => {
  await fixture(
    [
      textReply("任务已完成"),
      textReply("本轮无需记录"),
      toolReply(saveTool, { content: "越权条目" }, "foreign"),
      textReply("普通会话结束"),
    ],
    async (host) => {
      await send(host, "做点事");
      // 普通 Agent 与工具不在同一作用域，同名调用必然失败。
      const ordinary = await host.createAgent(SessionId("ordinary-tool-test"));
      ordinary.followup(
        createUserMessage({
          content: [{ type: "text", text: "普通问题" }],
          source: { kind: "user" },
        }),
      );
      await ordinary.whenIdle();
      assert.equal(errorResults(host, ordinary.session).length, 1);
      assert.equal(await readFile(host.files.original, "utf8"), frozen);
    },
  );
});
