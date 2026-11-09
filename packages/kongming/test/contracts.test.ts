/** 基础装配取证：干净生产循环接收脚本模型，并实际执行文件工具。 */
import { requestAt } from "./fixtures/mock-adapter.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionId } from "@deepseek-ai/dsh-session";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { createHost } from "./fixtures/host.ts";
import {
  textResponse,
  toolCallResponse,
  messageText,
} from "./fixtures/mock-adapter.ts";
import * as Plugin from "../lib/src/index.js";

await test("T1: clean plugin composition uses the production loop, request history and read tool", async () => {
  const root = await mkdtemp(join(tmpdir(), "kmh-kongming-contract-"));
  let host;
  try {
    await writeFile(join(root, "input.txt"), "PROJECT_READ_OK");
    host = await createHost({
      home: root,
      projectDir: root,
      script: [
        toolCallResponse("read", { file_path: "input.txt" }),
        textResponse("已读取"),
      ],
    });
    await host.ctx.plugin(Plugin);
    const agent = await host.driver.create(
      SessionId("kongming-contract"),
      { provider: "mock", model: "mock" },
      { cwd: root },
    );
    agent.followup(
      createUserMessage({
        content: [{ type: "text", text: "读取 input.txt" }],
        source: { kind: "user" },
      }),
    );
    await agent.whenIdle();
    assert.equal(host.adapter.requests.length, 2);
    assert.ok(
      requestAt(host.adapter, 1).messages.some(
        (m) => m.role === "tool" && messageText(m).includes("PROJECT_READ_OK"),
      ),
    );
    assert.ok(
      agent.session
        .snapshotEvents()
        .some(
          (e) => e.type === "turn/end" && e.data.reason.kind === "completed",
        ),
    );
    await host.ctx.sessions.flush(agent.session);
    assert.equal(
      await readFile(join(root, "input.txt"), "utf8"),
      "PROJECT_READ_OK",
    );
    assert.equal(Plugin.name, "kmh-kongming");
  } finally {
    await host?.close();
    await rm(root, { recursive: true, force: true });
  }
});
