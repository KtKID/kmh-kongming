/** 提示词配置回归：通过真实请求观察配置原文、空值和同一 Agent 的重新绑定。 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOverlayPatches } from "@deepseek-ai/dsh-app-boot";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { Config } from "../lib/src/config.js";
import { mountPrompt } from "../lib/src/session/prompt.js";
import { KongmingRuntime } from "../lib/src/session/runtime.js";
import { createHost, getAgent } from "./fixtures/host.ts";
import {
  messageText,
  textResponse,
  requestAt,
} from "./fixtures/mock-adapter.ts";

const identity = "你是孔明，用户的长期助手。";
const instruction =
  "每次完成对话或完成任务后，把有价值的内容和踩坑记录到记忆文件里";
const frozen = "配置测试冻结正文 {{literal-frozen}}";

async function fixture(
  config: Config,
  task: (h: {
    host: Awaited<ReturnType<typeof createHost>>;
    agent: ReturnType<typeof getAgent>;
    runtime: KongmingRuntime;
    send: () => Promise<string>;
  }) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "kmh-prompt-config-"));
  const paths = { home: join(root, "home"), projectDir: join(root, "proj") };
  let host;
  try {
    await mkdir(join(paths.home, ".kongming"), { recursive: true });
    await mkdir(paths.projectDir, { recursive: true });
    await writeFile(join(paths.home, ".kongming/MEMORY.frozen.md"), frozen);
    host = await createHost({
      ...paths,
      script: Array.from({ length: 3 }, () => textResponse("已收到")),
    });
    const runtime = new KongmingRuntime(host.ctx, config, paths);
    const binding = await runtime.ensure();
    const agent = getAgent(host.ctx, SessionId(binding.sessionId));
    const current = host;
    const send = async () => {
      agent.followup(
        createUserMessage({
          content: [{ type: "text", text: "检查配置" }],
          source: { kind: "user" },
        }),
      );
      await agent.whenIdle();
      return requestAt(current.adapter, current.adapter.requests.length - 1)
        .messages.filter((m) => m.role === "system")
        .map(messageText)
        .join("\n");
    };
    await task({ host, agent, runtime, send });
  } finally {
    await host?.close();
    await rm(root, { recursive: true, force: true });
  }
}

await test("P01：自定义文案逐字装配，孔明身份和维护约定由配置决定", async () => {
  const config = Config({
    personalityPrompt: "自定义人格 {{literal-persona}}",
    systemPrompt: "自定义系统 {{literal-system}}",
  });
  await fixture(config, async ({ host, send }) => {
    const system = await send();
    assert.ok(system.includes(config.personalityPrompt));
    assert.ok(system.includes(config.systemPrompt));
    assert.ok(system.includes(host.ctx.kongmingMemoryV1.files.original));
    assert.ok(system.includes(host.ctx.kongmingMemoryV1.files.frozen));
    assert.equal(system.includes(identity), false);
    assert.equal(system.includes(instruction), false);
    assert.ok(system.includes(frozen));
  });
});

await test("P02：默认 schema 与显式空配置保持空文案，冻结正文仍完整注入", async () => {
  assert.deepEqual(Config({}), { personalityPrompt: "", systemPrompt: "" });
  await fixture(
    Config({ personalityPrompt: "", systemPrompt: "" }),
    async ({ send }) => {
      const system = await send();
      assert.equal(system.includes(identity), false);
      assert.equal(system.includes(instruction), false);
      assert.ok(system.includes(frozen));
    },
  );
});

await test("P03：实际 YAML 提供默认人格与系统指令", async () => {
  const entries = loadOverlayPatches(
    "prompt-test",
    fileURLToPath(new URL("../cordis.patch.yml", import.meta.url)),
  ).flatMap((patch) => patch.insert ?? []);
  const entry = entries.find((e) => e.name === "@kmh/kongming");
  assert.ok(entry);
  const raw: unknown = entry.config;
  assert.ok(raw !== null && typeof raw === "object");
  const config = Config(raw);
  assert.ok(config.personalityPrompt.includes("沉稳、简洁、有主见"));
  assert.ok(config.systemPrompt.includes(identity));
  assert.equal(config.systemPrompt.includes(instruction), false);
  await fixture(config, async ({ host, send }) => {
    const system = await send();
    assert.ok(system.includes(config.personalityPrompt));
    assert.ok(system.includes(config.systemPrompt));
    assert.ok(system.includes(host.ctx.kongmingMemoryV1.files.original));
    assert.ok(system.includes(host.ctx.kongmingMemoryV1.files.frozen));
    assert.ok(system.includes(frozen));
  });
});

await test("P04：同一 Agent 重新绑定配置后下一请求使用新原文", async () => {
  await fixture(Config({}), async ({ host, agent, runtime, send }) => {
    await runtime.close();
    const memory = host.ctx.kongmingMemoryV1.bindAgent(agent);
    const old = mountPrompt(
      agent,
      Config({ personalityPrompt: "旧人格", systemPrompt: "旧系统" }),
    );
    assert.ok((await send()).includes("旧系统"));
    old();
    const current = mountPrompt(
      agent,
      Config({
        personalityPrompt: "新人格",
        systemPrompt: "新系统 {{literal-new}}",
      }),
    );
    try {
      const system = await send();
      assert.ok(system.includes("新系统 {{literal-new}}"));
      assert.equal(system.includes("旧系统"), false);
      assert.equal(system.includes(instruction), false);
      assert.ok(system.includes(frozen));
      const cwd = agent.session.header.cwd;
      assert.ok(cwd);
      const ordinary = await host.driver.create(
        SessionId("ordinary-prompt-check"),
        { provider: "mock", model: "mock" },
        { cwd },
      );
      ordinary.followup(
        createUserMessage({
          content: [{ type: "text", text: "普通会话" }],
          source: { kind: "user" },
        }),
      );
      await ordinary.whenIdle();
      const ordinarySystem = requestAt(host.adapter, 2)
        .messages.filter((m) => m.role === "system")
        .map(messageText)
        .join("\n");
      assert.equal(ordinarySystem.includes("新系统"), false);
      assert.equal(ordinarySystem.includes(frozen), false);
    } finally {
      current();
      await memory();
    }
  });
});
