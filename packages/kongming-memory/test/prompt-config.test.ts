/** 记忆模板只替换声明变量一次，冻结原文中的占位符和美元符号保持字面量。 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUserMessage, type StreamChunk } from "@deepseek-ai/dsh-llm";
import * as Plugin from "../src/index.ts";
import { createMockHost } from "./fixtures/mock-host.ts";

await test("P05：记忆模板由配置决定，路径和完整冻结正文只替换一次", async () => {
  const root = await mkdtemp(join(tmpdir(), "kmh-memory-prompt-"));
  const home = join(root, "home");
  const projectDir = join(root, "proj");
  const frozen =
    "冻结内容 {{originalMemoryPath}} {{frozenMemory}} $& {{other}}\n";
  let host;
  try {
    await mkdir(join(home, ".kongming"), { recursive: true });
    await mkdir(projectDir);
    await writeFile(join(home, ".kongming/MEMORY.frozen.md"), frozen);
    const reply: readonly StreamChunk[] = [
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text: "收到" },
      { type: "block-end", index: 0, block: { type: "text", text: "收到" } },
      { type: "finish", reason: { kind: "stop" } },
    ];
    host = await createMockHost({
      home,
      projectDir,
      replies: [reply],
      promptTemplate:
        "自定义说明\n原文={{originalMemoryPath}}\n冻结={{frozenMemoryPath}}\n正文={{frozenMemory}}",
    });
    host.agent.followup(
      createUserMessage({
        content: [{ type: "text", text: "模板验证" }],
        source: { kind: "user" },
      }),
    );
    await host.agent.whenIdle();
    const request = host.requests[0];
    assert.ok(request);
    const system = request.messages
      .filter((m) => m.role === "system")
      .flatMap((m) => m.content)
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    assert.ok(
      system.includes(
        `自定义说明\n原文=${host.files.original}\n冻结=${host.files.frozen}\n正文=${frozen}`,
      ),
    );
    assert.equal(system.includes("每轮最终回复前检查长期价值"), false);
  } finally {
    await host?.close();
    await rm(root, { recursive: true, force: true });
  }
});

await test("P06：模板缺少路径或冻结正文变量、为空或类型错误时校验失败", async () => {
  assert.equal(typeof Plugin.Config, "function");
  assert.throws(() => Plugin.Config({ promptTemplate: "只留下说明" }));
  assert.throws(() => Plugin.Config({ promptTemplate: "{{frozenMemory}}" }));
  assert.throws(() => Plugin.Config({ promptTemplate: "" }));
  const invalid = await Plugin.Config["~standard"].validate({
    promptTemplate: 42,
  });
  assert.ok(invalid.issues);
});
