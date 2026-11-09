/** 固定身份与真实 JSONL 恢复；所有模型响应来自脚本 adapter。 */
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ScriptEntry } from "./fixtures/mock-adapter.ts";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { SessionRequestId } from "@deepseek-ai/dsh-api-session-controller";
import { requestAt } from "./fixtures/mock-adapter.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { defaultConfig } from "./fixtures/config.ts";
import { KongmingRuntime } from "../lib/src/session.js";
import * as KongmingPlugin from "../lib/src/index.js";
import { createHost, getAgent } from "./fixtures/host.ts";
import { textResponse, messageText } from "./fixtures/mock-adapter.ts";
import { controlledResponse } from "./fixtures/single-session.ts";

async function setup(
  root: string,
  homeName = "home",
  script: readonly ScriptEntry[] = [],
) {
  const paths = { home: join(root, homeName), projectDir: join(root, "proj") };
  await mkdir(paths.projectDir, { recursive: true });
  const host = await createHost({ ...paths, script });
  const runtime = new KongmingRuntime(host.ctx, defaultConfig(), paths);
  return { ...host, runtime, paths };
}
function send(agent: Agent, text: string) {
  agent.followup(
    createUserMessage({
      content: [{ type: "text", text }],
      source: { kind: "user" },
    }),
  );
  return agent.whenIdle();
}

await test("S19: native restoration receives Kongming persona and frozen memory before opening the plugin entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "kmh-kongming-native-restore-"));
  const paths = { home: join(root, "home"), projectDir: join(root, "proj") };
  const previous = {
    DSH_HOME: process.env.DSH_HOME,
    KMH_KONGMING_PROJECT_DIR: process.env.KMH_KONGMING_PROJECT_DIR,
  };
  let host;
  try {
    host = await setup(root);
    const binding = await host.runtime.ensure();
    await writeFile(
      join(paths.home, ".kongming", "MEMORY.frozen.md"),
      "NATIVE_RESTORE_FROZEN",
    );
    await host.close();
    host = undefined;
    process.env.DSH_HOME = paths.home;
    process.env.KMH_KONGMING_PROJECT_DIR = paths.projectDir;
    for (const alreadyLoaded of [false, true]) {
      const gate = controlledResponse(textResponse("恢复后的受控输出"));
      host = await createHost({
        ...paths,
        script: [textResponse("原生恢复完成"), gate.stream],
      });
      if (alreadyLoaded)
        await host.ctx.sessionController.resolveAgent(
          SessionId(binding.sessionId),
        );
      await KongmingPlugin.apply(host.ctx, defaultConfig());
      await host.ctx.sessionController.prompt(
        {
          sessionId: SessionId(binding.sessionId),
          requestId: brandString<SessionRequestId>(crypto.randomUUID()),
          mode: "queue",
          content: [{ type: "text", text: "从原生页面恢复" }],
        },
        new AbortController().signal,
      );
      await getAgent(host.ctx, SessionId(binding.sessionId)).whenIdle();
      const system = requestAt(host.adapter, 0)
        .messages.filter((m) => m.role === "system")
        .map(messageText)
        .join("\n");
      assert.ok(
        system.includes(defaultConfig().systemPrompt),
        "原生恢复必须在模型请求前绑定孔明专属提示",
      );
      assert.ok(system.includes("NATIVE_RESTORE_FROZEN"));
      await host.ctx.sessionController.prompt(
        {
          sessionId: SessionId(binding.sessionId),
          requestId: brandString<SessionRequestId>(crypto.randomUUID()),
          mode: "queue",
          content: [{ type: "text", text: "恢复后的关闭验收" }],
        },
        new AbortController().signal,
      );
      await gate.entered;
      await host.ctx.kongming.close();
      assert.ok(gate.settled, "插件关闭必须等待原生恢复的执行收敛");
      await host.close();
      host = undefined;
    }
  } finally {
    await host?.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

await test("T03.1/T03.2: one identity per home survives real host restart and keeps history", async () => {
  const root = await mkdtemp(join(tmpdir(), "kmh-kongming-session-"));
  let a, b;
  try {
    a = await setup(root, "home-a", [textResponse("已记下青竹")]);
    const [first, concurrent] = await Promise.all([
      a.runtime.ensure(),
      a.runtime.ensure(),
    ]);
    assert.equal(first.sessionId, concurrent.sessionId);
    const agent = getAgent(a.ctx, SessionId(first.sessionId));
    assert.ok(agent);
    assert.equal(agent.session.header.cwd, a.paths.projectDir);
    const workspace = await a.ctx.workspaceRegistry.resolveByPath(
      a.paths.projectDir,
    );
    assert.ok(workspace, "固定 proj 应注册为标准工作区，供完整会话页解析");
    assert.ok(workspace.sessionIds.includes(SessionId(first.sessionId)));
    await send(agent, "这次讨论叫青竹");
    await a.ctx.sessions.flush(agent.session);
    await writeFile(
      join(a.paths.home, ".kongming", "MEMORY.md"),
      "重启后仍在的原始记忆",
    );
    await a.close();
    a = undefined;
    b = await setup(root, "home-b", [textResponse("B 的记录")]);
    const other = await b.runtime.ensure();
    assert.notEqual(other.sessionId, first.sessionId);
    assert.equal(
      getAgent(b.ctx, SessionId(other.sessionId))
        .session.snapshotEvents()
        .filter((e) => e.type === "user/message").length,
      0,
    );
    await send(getAgent(b.ctx, SessionId(other.sessionId)), "B 独立记录");
    await b.close();
    b = undefined;
    a = await setup(root, "home-a", [textResponse("青竹")]);
    const restored = await a.runtime.ensure();
    assert.equal(restored.sessionId, first.sessionId);
    const restoredWorkspace = await a.ctx.workspaceRegistry.resolveByPath(
      a.paths.projectDir,
    );
    assert.equal(restoredWorkspace?.id, workspace.id);
    assert.deepEqual(restoredWorkspace?.sessionIds, [
      SessionId(first.sessionId),
    ]);
    assert.equal(
      await readFile(join(a.paths.home, ".kongming", "MEMORY.md"), "utf8"),
      "重启后仍在的原始记忆",
    );
    assert.equal(
      await readFile(
        join(a.paths.home, ".kongming", "MEMORY.frozen.md"),
        "utf8",
      ),
      "",
    );
    const resumed = getAgent(a.ctx, SessionId(first.sessionId));
    await send(resumed, "这次讨论叫什么");
    assert.ok(
      requestAt(a.adapter, 0).messages.some(
        (m) => m.role === "user" && messageText(m).includes("青竹"),
      ),
    );
    assert.equal((await a.runtime.ensure()).sessionId, first.sessionId);
  } finally {
    await a?.close();
    await b?.close();
    await rm(root, { recursive: true, force: true });
  }
});

await test("T03.3: a damaged binding is preserved and retry restores its original identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "kmh-kongming-restore-"));
  let host;
  try {
    host = await setup(root);
    const before = await host.runtime.ensure();
    await host.close();
    host = undefined;
    const statePath = join(root, "home", ".kongming", "state.json");
    const original = await readFile(statePath, "utf8");
    await writeFile(statePath, "{broken");
    host = await setup(root);
    await assert.rejects(host.runtime.ensure(), /恢复|身份|state|JSON/);
    assert.equal(await readFile(statePath, "utf8"), "{broken");
    await writeFile(statePath, original);
    assert.equal((await host.runtime.ensure()).sessionId, before.sessionId);
  } finally {
    await host?.close();
    await rm(root, { recursive: true, force: true });
  }
});

await test("T03.3: damaged persisted history preserves the binding and recovers after file repair", async () => {
  const root = await mkdtemp(join(tmpdir(), "kmh-kongming-history-"));
  let host;
  try {
    host = await setup(root, "home", [textResponse("原记录")]);
    const before = await host.runtime.ensure();
    await send(getAgent(host.ctx, SessionId(before.sessionId)), "需保留的历史");
    await host.close();
    host = undefined;
    const sessionRoot = join(root, "home", "sessions");
    const entries = await readdir(sessionRoot, { recursive: true });
    const log = entries.find((name) => /\.jsonl(?:\.zstd)?$/.test(name));
    assert.ok(log);
    const logPath = join(sessionRoot, log);
    const original = await readFile(logPath);
    const bindingPath = join(root, "home", ".kongming", "state.json");
    const binding = await readFile(bindingPath, "utf8");
    await writeFile(logPath, "{broken\n");
    host = await setup(root);
    await assert.rejects(host.runtime.ensure(), /恢复失败/);
    assert.equal(await readFile(bindingPath, "utf8"), binding);
    assert.equal(await readFile(logPath, "utf8"), "{broken\n");
    await writeFile(logPath, original);
    assert.equal((await host.runtime.ensure()).sessionId, before.sessionId);
    assert.ok(
      JSON.stringify(
        getAgent(
          host.ctx,
          SessionId(before.sessionId),
        ).session.snapshotEvents(),
      ).includes("需保留的历史"),
    );
    await host.close();
    host = undefined;
    const repaired = await readFile(logPath);
    // 工作区启动会读取历史头部；此处在启动后注入 I/O 故障，验证孔明准备入口的恢复行为。
    host = await setup(root);
    await rm(logPath);
    await mkdir(logPath);
    await assert.rejects(host.runtime.ensure(), /恢复失败/);
    assert.equal(await readFile(bindingPath, "utf8"), binding);
    await rm(logPath, { recursive: true });
    await writeFile(logPath, repaired);
    assert.equal((await host.runtime.ensure()).sessionId, before.sessionId);
  } finally {
    await host?.close();
    await rm(root, { recursive: true, force: true });
  }
});
