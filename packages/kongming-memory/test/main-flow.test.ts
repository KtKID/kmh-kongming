/** 冻结与加载主链路：真实文件、DSH 循环和手动压缩，模型文本由本例脚本提供。 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUserMessage, type StreamChunk } from "@deepseek-ai/dsh-llm";
import { defaultMemoryConfig } from "./fixtures/config.ts";
import * as MemoryPlugin from "../src/index.ts";
import type { MemoryMockHost } from "./fixtures/mock-host.ts";

const A = "旧偏好：青竹\n\n保留 {{memory_literal}}\n旧尾段\n";
const B = "新偏好：沉稳简洁\r\n\r\n完整 B 尾段\r\n";
const C = "当前决策：先跑通链路\n完整 C 尾段\n";

/** 将文本作为受控模型输出，真实请求与压缩处理继续执行。 */
function reply(text: string): StreamChunk[] {
  return [
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text },
    { type: "block-end", index: 0, block: { type: "text", text } },
    { type: "finish", reason: { kind: "stop" } },
  ];
}

/** 每例分配私有 home/proj；失败时同样等待宿主关闭再删除目录。 */
async function fixture(
  raw: string | undefined,
  frozen: string | undefined,
  replies: readonly (readonly StreamChunk[])[],
  run: (host: MemoryMockHost) => Promise<void>,
): Promise<void> {
  assert.equal(
    typeof MemoryPlugin.createMemoryService,
    "function",
    "主链路需要独立记忆服务的真实运行导出",
  );
  const root = await mkdtemp(join(tmpdir(), "kongming-memory-main-"));
  let host: MemoryMockHost | undefined;
  try {
    const home = join(root, "home");
    const projectDir = join(root, "proj");
    await mkdir(projectDir, { recursive: true });
    if (raw !== undefined || frozen !== undefined) {
      await mkdir(join(home, ".kongming"), { recursive: true });
      if (raw !== undefined)
        await writeFile(join(home, ".kongming/MEMORY.md"), raw);
      if (frozen !== undefined)
        await writeFile(join(home, ".kongming/MEMORY.frozen.md"), frozen);
    }
    const { createMockHost } = await import("./fixtures/mock-host.ts");
    host = await createMockHost({ home, projectDir, replies });
    await run(host);
  } finally {
    await host?.close();
    await rm(root, { recursive: true, force: true });
  }
}

/** 发送并等待真实 turn 完成；用完整专属段落核对记忆来源。 */
async function send(
  host: MemoryMockHost,
  expected: string,
  text = "请回答这个普通问题",
): Promise<void> {
  const before = host.requests.filter((r) => r.purpose !== "compaction").length;
  host.agent.followup(
    createUserMessage({
      content: [{ type: "text", text }],
      source: { kind: "user" },
    }),
  );
  await host.agent.whenIdle();
  const ordinary = host.requests.filter((r) => r.purpose !== "compaction");
  assert.equal(ordinary.length, before + 1, "每次发送应产生一条新的普通请求");
  const request = ordinary.at(-1);
  assert.ok(request, "应产生实际模型请求");
  const system = request.messages
    .filter((m) => m.role === "system")
    .flatMap((m) => m.content)
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  assert.ok(
    system.includes(`<kongming-memory>\n${expected}\n</kongming-memory>`),
    "实际系统请求应携带逐字完整的当前冻结正文",
  );
  assert.ok(system.includes(host.files.original));
  assert.ok(system.includes(host.files.frozen));
  const end = host.agent.session
    .snapshotEvents()
    .findLast((e) => e.type === "turn/end");
  assert.equal(end?.data.reason.kind, "completed", "当前轮应真实完成");
}

await test("M01 / F01：空目录生成两份空文件并在实际请求中加载", async () => {
  await fixture(undefined, undefined, [reply("正常开始")], async (host) => {
    assert.equal(await readFile(host.files.original, "utf8"), "");
    assert.equal(await readFile(host.files.frozen, "utf8"), "");
    await send(host, "");
  });
});

await test("M02 / F01：首次完整复制 raw，保留中文、空行、换行和花括号", async () => {
  await fixture(A, undefined, [reply("已加载")], async (host) => {
    assert.deepEqual(await readFile(host.files.original), Buffer.from(A));
    assert.deepEqual(await readFile(host.files.frozen), Buffer.from(A));
    await send(host, A);
  });
});

await test("M03 / F01：已有冻结 A 时启动用原始 B 重发，raw B 保留", async () => {
  await fixture(B, A, [reply("加载 B")], async (host) => {
    assert.deepEqual(await readFile(host.files.original), Buffer.from(B));
    assert.deepEqual(await readFile(host.files.frozen), Buffer.from(B));
    await send(host, B);
  });
});

await test("M04 / F02：raw 日常修改后连续请求仍使用冻结版本", async () => {
  await fixture(A, A, [reply("第一轮"), reply("第二轮")], async (host) => {
    await send(host, A);
    await writeFile(host.files.original, B);
    await send(host, A);
    assert.equal(host.requests.length, 2);
    assert.deepEqual(await readFile(host.files.original), Buffer.from(B));
    assert.deepEqual(await readFile(host.files.frozen), Buffer.from(A));
  });
});

await test("M05 / F03：重建独立记忆服务后按原始 B 重发并保留会话身份", async () => {
  await fixture(B, A, [reply("重建前"), reply("重建后")], async (host) => {
    await send(host, B);
    const id = host.agent.id;
    await host.memory.close();
    const restored = MemoryPlugin.createMemoryService(host.ctx, host.files, {
      ...defaultMemoryConfig(),
      reminderPrompt: "",
    });
    try {
      await restored.initialize();
      restored.bindAgent(host.agent);
      await send(host, B);
      assert.equal(host.agent.id, id);
      assert.deepEqual(await readFile(host.files.original), Buffer.from(B));
      assert.deepEqual(await readFile(host.files.frozen), Buffer.from(B));
    } finally {
      await restored.close();
    }
  });
});

await test("M06 / F04：两次真实手动压缩后第一条请求分别使用新冻结 B、C", async () => {
  await fixture(
    A,
    A,
    [
      reply("初始回答"),
      reply("摘要一"),
      reply("加载 B"),
      reply("摘要二"),
      reply("加载 C"),
    ],
    async (host) => {
      await send(host, A, "建立可压缩的历史。".repeat(300));
      await writeFile(host.files.original, B);
      const first = await host.ctx.commands.execute(
        host.agent,
        "/compact",
        [],
        new AbortController().signal,
      );
      assert.equal(first?.result.kind, "success");
      assert.ok(first?.result.sourceEventSeq, "压缩应实际提交摘要");
      await send(host, B, "继续积累可压缩的历史。".repeat(300));
      assert.deepEqual(await readFile(host.files.frozen), Buffer.from(B));
      await writeFile(host.files.original, C);
      const second = await host.ctx.commands.execute(
        host.agent,
        "/compact",
        [],
        new AbortController().signal,
      );
      assert.equal(second?.result.kind, "success");
      assert.ok(second?.result.sourceEventSeq);
      await send(host, C);
      assert.deepEqual(await readFile(host.files.frozen), Buffer.from(C));
      assert.deepEqual(await readFile(host.files.original), Buffer.from(C));
      const events = host.agent.session.snapshotEvents();
      assert.equal(
        events.filter((e) => e.type === "compaction/summary").length,
        2,
      );
      assert.equal(
        host.requests.filter((r) => r.purpose === "compaction").length,
        2,
      );
    },
  );
});

await test("M07 / F01：出生为空的冻结在启动时由原始 A 自愈重发", async () => {
  await fixture(A, "", [reply("自愈 A")], async (host) => {
    assert.deepEqual(await readFile(host.files.original), Buffer.from(A));
    assert.deepEqual(await readFile(host.files.frozen), Buffer.from(A));
    await send(host, A);
  });
});

await test("M08 / F01：原始为空时保留已有冻结 A 不回退", async () => {
  await fixture("", A, [reply("保留 A")], async (host) => {
    assert.equal(await readFile(host.files.original, "utf8"), "");
    assert.deepEqual(await readFile(host.files.frozen), Buffer.from(A));
    await send(host, A);
  });
});
