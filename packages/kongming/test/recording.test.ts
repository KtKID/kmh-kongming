/** 由脚本发起真实文件读写，核对原始记忆和后续模型请求。 */
import { requestAt } from "./fixtures/mock-adapter.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defaultConfig } from "./fixtures/config.ts";
import { KongmingRuntime } from "../lib/src/session.js";
import { createHost, getAgent } from "./fixtures/host.ts";
import {
  textResponse,
  toolCallResponse,
  messageText,
} from "./fixtures/mock-adapter.ts";

await test("T05.1/T07.2/T07.3: read → write → reply changes original memory and retains frozen bytes across tool requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "kmh-kongming-recording-"));
  const paths = { home: join(root, "home"), projectDir: join(root, "proj") };
  const memory = join(paths.home, ".kongming", "MEMORY.md");
  const frozen = join(paths.home, ".kongming", "MEMORY.frozen.md");
  const original = "已有记录甲\n";
  const preference = "以后给我的开发方案，先列验收标准，再列实现步骤";
  await mkdir(join(paths.home, ".kongming"), { recursive: true });
  await mkdir(paths.projectDir, { recursive: true });
  await writeFile(memory, original);
  let host;
  try {
    host = await createHost({
      ...paths,
      script: [
        toolCallResponse("read", { file_path: memory }, "read-memory"),
        toolCallResponse(
          "write",
          { file_path: memory, content: original + preference + "\n" },
          "write-memory",
        ),
        textResponse("偏好已保存"),
      ],
    });
    const runtime = new KongmingRuntime(host.ctx, defaultConfig(), paths);
    const ready = await runtime.ensure();
    const agent = getAgent(host.ctx, SessionId(ready.sessionId));
    agent.followup(
      createUserMessage({
        content: [{ type: "text", text: preference }],
        source: { kind: "user" },
      }),
    );
    await agent.whenIdle();
    assert.equal(host.adapter.requests.length, 3);
    assert.equal(host.adapter.script.length, 0);
    assert.ok(
      requestAt(host.adapter, 1).messages.some(
        (m) => m.role === "tool" && messageText(m).includes("已有记录甲"),
      ),
    );
    assert.ok(
      requestAt(host.adapter, 2).messages.some(
        (m) =>
          m.role === "tool" && !messageText(m).includes("permission denied"),
      ),
    );
    assert.equal(await readFile(memory, "utf8"), original + preference + "\n");
    assert.equal(await readFile(frozen, "utf8"), original);
    for (const request of host.adapter.requests) {
      const system = request.messages
        .filter((m) => m.role === "system")
        .map(messageText)
        .join("\n");
      assert.ok(
        system.includes(`<kongming-memory>\n${original}\n</kongming-memory>`),
      );
      assert.equal(system.includes("新要求更新对应旧条目"), false);
    }
    const events = agent.session.snapshotEvents();
    const writeResult = events.findLast((e) => e.type === "tool/result");
    const answer = events.findLast((e) => e.type === "assistant/message");
    assert.ok(writeResult);
    assert.ok(answer);
    assert.ok(writeResult.seq < answer.seq);
    assert.equal(messageText(answer.data.message), "偏好已保存");
  } finally {
    await host?.close();
    await rm(root, { recursive: true, force: true });
  }
});

await test("D05/D06: another ordinary agent keeps its own persona and receives its own user input", async () => {
  const root = await mkdtemp(join(tmpdir(), "kmh-kongming-scope-"));
  let host;
  try {
    host = await createHost({
      home: join(root, "home"),
      projectDir: root,
      script: [textResponse("普通会话")],
    });
    const runtime = new KongmingRuntime(host.ctx, defaultConfig(), {
      home: join(root, "home"),
      projectDir: root,
    });
    await runtime.ensure();
    const other = await host.ctx.sessionController.create({ cwd: root });
    const resolved = await host.ctx.sessionController.resolveAgent(
      other.sessionId,
    );
    assert.ok("agent" in resolved);
    const agent = resolved.agent;
    agent.followup(
      createUserMessage({
        content: [{ type: "text", text: "普通问题" }],
        source: { kind: "user" },
      }),
    );
    await agent.whenIdle();
    const system = requestAt(host.adapter, 0)
      .messages.filter((m) => m.role === "system")
      .map(messageText)
      .join("\n");
    assert.equal(system.includes("kongming-memory"), false);
    assert.equal(system.includes("每次完成对话或完成任务后"), false);
  } finally {
    await host?.close();
    await rm(root, { recursive: true, force: true });
  }
});
