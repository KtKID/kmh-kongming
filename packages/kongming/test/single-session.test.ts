/** 孔明控制接口、真实 Session Controller 和队列的恢复；全部 LLM 使用 mock。 */
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import type { SingleSession } from "./fixtures/single-session.ts";
import { requestAt } from "./fixtures/mock-adapter.ts";
import test from "node:test";
import { defineContentToolFixture } from "@deepseek-ai/dsh-tool-testkit";
import { KongmingRuntime } from "../lib/src/session.js";
import { defaultConfig } from "./fixtures/config.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  textResponse,
  toolCallResponse,
  messageText,
} from "./fixtures/mock-adapter.ts";
import {
  controlledResponse,
  openSession,
  singleSession,
} from "./fixtures/single-session.ts";

const options = { timeout: 20000 };
const assistantTexts = (host: SingleSession) =>
  host
    .events()
    .filter((e) => e.type === "assistant/message")
    .map((e) => messageText(e.data.message));
const historyHas = (request: GenerateOptions, text: string) =>
  request.messages.some(
    (m) => m.role === "user" && messageText(m).includes(text),
  );

await test(
  "S13: plugin reload retains the live session's pending inputs",
  options,
  async () => {
    const gate = controlledResponse(textResponse("原始输出"));
    await singleSession(
      [gate.stream, textResponse("排队消息完成")],
      async (h) => {
        await h.prompt("当前请求");
        await gate.entered;
        await h.prompt("排队请求");
        await h.runtime.close();
        assert.equal(h.agent.inbox.nextTurn.length, 1);
        const replacement = new KongmingRuntime(
          h.ctx,
          defaultConfig(),
          h.paths,
        );
        assert.equal((await replacement.ensure()).sessionId, h.agent.id);
        replacement.control.resume();
        await h.agent.whenIdle();
        assert.deepEqual(h.users(), ["当前请求", "排队请求"]);
        await replacement.close();
      },
      [gate],
    );
  },
);

await test(
  "S14: concurrent plugin close calls all await pending preparation",
  options,
  async () => {
    await singleSession([], async (h) => {
      const entered = Promise.withResolvers<void>(),
        release = Promise.withResolvers<void>();
      const original = h.ctx.workspaceRegistry.create.bind(
        h.ctx.workspaceRegistry,
      );
      h.ctx.workspaceRegistry.create = async (
        ...args: Parameters<typeof original>
      ) => {
        entered.resolve();
        await release.promise;
        return original(...args);
      };
      const preparing = h.runtime.ensure();
      await entered.promise;
      const first = h.runtime.close();
      let second;
      try {
        let secondSettled = false;
        second = h.runtime.close().then(() => {
          secondSettled = true;
        });
        await Promise.resolve();
        await Promise.resolve();
        assert.equal(secondSettled, false);
      } finally {
        release.resolve();
        await Promise.all([preparing, first, second]);
        h.ctx.workspaceRegistry.create = original;
      }
    });
  },
);

await test(
  "S15: stop during tool execution aborts and joins the tool before accepting a later task",
  options,
  async () => {
    const entered = Promise.withResolvers<void>();
    let executions = 0,
      settled = false;
    await singleSession(
      [toolCallResponse("blocked_operation", {}), textResponse("后续完成")],
      async (h) => {
        h.ctx.tools.register(
          defineContentToolFixture({
            name: "blocked_operation",
            description: "test-only external operation",
            parameters: {},
            execute: async (_args, exec) => {
              executions++;
              entered.resolve();
              try {
                await new Promise<never>((_resolve, reject) => {
                  const abort = () => {
                    const reason: unknown = exec.signal.reason;
                    reject(
                      reason instanceof Error
                        ? reason
                        : new Error("受控工具已取消", { cause: reason }),
                    );
                  };
                  if (exec.signal.aborted) abort();
                  else
                    exec.signal.addEventListener("abort", abort, {
                      once: true,
                    });
                });
                return [{ type: "text", text: "unexpected completion" }];
              } finally {
                settled = true;
              }
            },
          }),
        );
        await h.prompt("执行受控工具");
        await entered.promise;
        h.cancel();
        h.cancel();
        await h.agent.whenIdle();
        assert.equal(executions, 1);
        assert.equal(settled, true);
        assert.equal(
          h.events().filter((e) => e.type === "tool/call").length,
          1,
        );
        assert.equal(
          h.events().filter((e) => e.type === "tool/result").length,
          1,
        );
        await h.prompt("新任务");
        h.resume();
        await h.agent.whenIdle();
        assert.ok(assistantTexts(h).includes("后续完成"));
      },
    );
  },
);

await test(
  "S16: cancellation at the dispatch boundary skips a real file write",
  options,
  async () => {
    await singleSession([], async (h) => {
      const target = join(h.paths.projectDir, "must-not-write.txt");
      h.adapter.script.push(
        toolCallResponse("write", { file_path: target, content: "late write" }),
        textResponse("后续完成"),
      );
      const off = h.ctx.on("session/event", (session, event) => {
        if (session === h.agent.session && event.type === "assistant/message")
          h.cancel();
      });
      await h.prompt("写入文件前取消");
      await h.agent.whenIdle();
      off();
      await assert.rejects(readFile(target), { code: "ENOENT" });
      await h.prompt("继续");
      h.resume();
      await h.agent.whenIdle();
      assert.ok(assistantTexts(h).includes("后续完成"));
    });
  },
);

await test(
  "S01: stop before the first fragment settles and explicit continue handles the next input",
  options,
  async () => {
    const gate = controlledResponse(textResponse("不应显示"), true);
    await singleSession(
      [gate.stream, textResponse("继续成功")],
      async (h) => {
        await h.prompt("开始");
        await gate.entered;
        h.cancel();
        await h.agent.whenIdle();
        assert.equal(gate.settled, true);
        assert.equal(h.agent.status, "idle");
        assert.deepEqual(assistantTexts(h), []);
        assert.equal(h.adapter.requests.length, 1);
        await h.prompt("新的问题");
        h.resume();
        await h.agent.whenIdle();
        assert.deepEqual(h.users(), ["开始", "新的问题"]);
        assert.ok(assistantTexts(h).includes("继续成功"));
        assert.equal((await h.runtime.ensure()).sessionId, h.binding.sessionId);
      },
      [gate],
    );
  },
);

await test(
  "S02: stop mid-stream commits the shown prefix once and later requests replay that prefix",
  options,
  async () => {
    const gate = controlledResponse(textResponse("甲后续内容"));
    await singleSession(
      [gate.stream, textResponse("恢复完成")],
      async (h) => {
        await h.prompt("开始流式输出");
        await gate.entered;
        h.cancel();
        await h.agent.whenIdle();
        assert.deepEqual(assistantTexts(h), ["甲"]);
        const partial = h.events().find((e) => e.type === "assistant/message");
        assert.ok(partial);
        assert.equal(partial.data.interrupted, true);
        await h.prompt("继续分析");
        h.resume();
        await h.agent.whenIdle();
        assert.equal(assistantTexts(h).filter((t) => t === "甲").length, 1);
        assert.ok(
          requestAt(h.adapter, 1).messages.some(
            (m) => m.role === "assistant" && messageText(m) === "甲",
          ),
        );
        assert.equal(h.events().filter((e) => e.type === "turn/end").length, 2);
      },
      [gate],
    );
  },
);

await test(
  "S03: stop preserves queued inputs and continue drains them in FIFO order",
  options,
  async () => {
    const gate = controlledResponse(textResponse("首轮"));
    await singleSession(
      [gate.stream, textResponse("乙完成"), textResponse("丙完成")],
      async (h) => {
        await h.prompt("甲");
        await gate.entered;
        await h.prompt("乙");
        h.cancel();
        await h.agent.whenIdle();
        await h.prompt("丙");
        assert.equal(h.agent.inbox.nextTurn.length, 2);
        assert.equal(h.adapter.requests.length, 1);
        h.resume();
        h.resume();
        await h.agent.whenIdle();
        assert.deepEqual(h.users(), ["甲", "乙", "丙"]);
        assert.equal(h.adapter.requests.length, 3);
        assert.equal(h.agent.inbox.nextTurn.length, 0);
        assert.equal(h.agent.inbox.nextStep.length, 0);
      },
      [gate],
    );
  },
);

await test(
  "S04: steer joins the running turn at its next step with one durable input",
  options,
  async () => {
    const gate = controlledResponse(textResponse("首段"));
    await singleSession(
      [gate.stream, textResponse("按新方向完成")],
      async (h) => {
        await h.prompt("分析原方向");
        await gate.entered;
        await h.prompt("插入新方向", "steer");
        assert.equal(h.agent.inbox.nextStep.length, 1);
        gate.release();
        await h.agent.whenIdle();
        assert.deepEqual(h.users(), ["分析原方向", "插入新方向"]);
        assert.ok(historyHas(requestAt(h.adapter, 1), "插入新方向"));
        assert.equal(h.events().filter((e) => e.type === "turn/end").length, 1);
      },
      [gate],
    );
  },
);

await test(
  "S05: edit, remove and promote queued items use the actual pending queue",
  options,
  async () => {
    const gate = controlledResponse(textResponse("正在分析"));
    await singleSession(
      [gate.stream, textResponse("插入已完成")],
      async (h) => {
        await h.prompt("第一轮");
        await gate.entered;
        await h.prompt("待修改");
        await h.prompt("待删除");
        const [edit, remove] = h.agent.inbox.nextTurn;
        assert.ok(edit);
        assert.ok(remove);
        await h.queue(edit.id, {
          kind: "edit",
          content: [{ type: "text", text: "修改后的要求" }],
        });
        await h.queue(remove.id, { kind: "remove" });
        await h.queue(edit.id, { kind: "steer" });
        assert.equal(h.agent.inbox.nextTurn.length, 0);
        assert.equal(h.agent.inbox.nextStep.length, 1);
        gate.release();
        await h.agent.whenIdle();
        assert.deepEqual(h.users(), ["第一轮", "修改后的要求"]);
        assert.equal(h.adapter.requests.length, 2);
        assert.ok(historyHas(requestAt(h.adapter, 1), "修改后的要求"));
        await assert.rejects(
          h.queue(edit.id, { kind: "remove" }),
          /no longer pending/,
        );
        assert.deepEqual(h.users(), ["第一轮", "修改后的要求"]);
      },
      [gate],
    );
  },
);

await test(
  "S06: a supplement is included at the next real file-tool step",
  options,
  async () => {
    const gate = controlledResponse(
      toolCallResponse("read", { file_path: "input.txt" }),
      true,
    );
    await singleSession(
      [gate.stream, textResponse("合并补充完成")],
      async (h) => {
        await writeFile(join(h.paths.projectDir, "input.txt"), "真实工具结果");
        await h.prompt("读取文件并分析");
        await gate.entered;
        h.supplement("本轮补充条件");
        gate.release();
        await h.agent.whenIdle();
        assert.ok(historyHas(requestAt(h.adapter, 1), "本轮补充条件"));
        assert.ok(
          requestAt(h.adapter, 1).messages.some(
            (m) => m.role === "tool" && messageText(m).includes("真实工具结果"),
          ),
        );
        assert.deepEqual(h.users(), ["读取文件并分析", "本轮补充条件"]);
        assert.equal(h.events().filter((e) => e.type === "turn/end").length, 1);
      },
      [gate],
    );
  },
);

await test(
  "S07: replaying an accepted request identity does not enqueue or execute it twice",
  options,
  async () => {
    const gate = controlledResponse(textResponse("首轮"));
    await singleSession(
      [gate.stream, textResponse("后续完成")],
      async (h) => {
        const firstId = randomUUID(),
          queuedId = randomUUID();
        await h.prompt("第一条", "queue", firstId);
        await gate.entered;
        await h.prompt("第一条", "queue", firstId);
        await h.prompt("第二条", "queue", queuedId);
        await h.prompt("第二条", "queue", queuedId);
        assert.equal(h.agent.inbox.nextTurn.length, 1);
        gate.release();
        await h.agent.whenIdle();
        await h.prompt("第一条", "queue", firstId);
        assert.deepEqual(h.users(), ["第一条", "第二条"]);
        assert.equal(h.adapter.requests.length, 2);
      },
      [gate],
    );
  },
);

await test(
  "S08: concurrent ensure calls keep the running agent, model request and files unchanged",
  options,
  async () => {
    const gate = controlledResponse(textResponse("完成"));
    await singleSession(
      [gate.stream],
      async (h) => {
        await h.prompt("工作中");
        await gate.entered;
        const identities = await Promise.all(
          Array.from({ length: 8 }, () => h.runtime.ensure()),
        );
        assert.ok(identities.every((r) => r.sessionId === h.agent.id));
        assert.equal(h.ctx.agents.get(h.agent.id), h.agent);
        assert.equal(h.agent.status, "running");
        assert.equal(h.adapter.requests.length, 1);
        gate.release();
        await h.agent.whenIdle();
        assert.deepEqual(h.users(), ["工作中"]);
        assert.equal(
          await readFile(
            join(h.paths.home, ".kongming/MEMORY.frozen.md"),
            "utf8",
          ),
          "",
        );
      },
      [gate],
    );
  },
);

await test(
  "S09: partial model failure retains an attempt and the same session accepts a retry",
  options,
  async () => {
    const chunks: StreamChunk[] = [
      { type: "block-start", index: 0, blockType: "text" },
      { type: "text-delta", index: 0, text: "已显示部分" },
      {
        type: "finish",
        reason: {
          kind: "error",
          failure: { code: "SERVER", message: "mock error" },
        },
      },
    ];
    await singleSession([chunks, textResponse("重试完成")], async (h) => {
      await h.prompt("会失败的请求");
      await h.agent.whenIdle();
      assert.ok(
        h
          .events()
          .some(
            (e) =>
              e.type === "assistant/attempt" &&
              JSON.stringify(e.data.stream).includes("已显示部分"),
          ),
      );
      await h.prompt("重试");
      await h.agent.whenIdle();
      assert.equal(h.agent.id, h.binding.sessionId);
      assert.ok(assistantTexts(h).includes("重试完成"));
      assert.ok(historyHas(requestAt(h.adapter, 1), "会失败的请求"));
    });
  },
);

await test(
  "S10: cancellation after a real memory write preserves original and frozen bytes through restart",
  options,
  async () => {
    const root = await mkdtemp(join(tmpdir(), "kmh-kongming-cancel-memory-"));
    const paths = { home: join(root, "home"), projectDir: join(root, "proj") };
    const gate = controlledResponse(textResponse("已保存偏好"));
    let h: SingleSession | undefined;
    try {
      h = await openSession(paths, []);
      const original = join(paths.home, ".kongming/MEMORY.md");
      h.adapter.script.push(
        toolCallResponse("write", {
          file_path: original,
          content: "可靠保存的偏好\n",
        }),
        gate.stream,
      );
      await h.prompt("保存偏好");
      await gate.entered;
      h.cancel();
      await h.agent.whenIdle();
      assert.equal(await readFile(original, "utf8"), "可靠保存的偏好\n");
      const id = h.agent.id;
      await h.close();
      h = undefined;
      h = await openSession(paths, [textResponse("恢复完成")]);
      assert.equal(h.agent.id, id);
      assert.equal(await readFile(original, "utf8"), "可靠保存的偏好\n");
      assert.equal(
        await readFile(join(paths.home, ".kongming/MEMORY.frozen.md"), "utf8"),
        "",
      );
      await h.prompt("继续");
      h.resume();
      await h.agent.whenIdle();
      assert.ok(assistantTexts(h).includes("恢复完成"));
    } finally {
      gate.release();
      await h?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

await test(
  "S11: plugin shutdown joins a blocked generation and restores its interrupted history",
  options,
  async () => {
    const root = await mkdtemp(join(tmpdir(), "kmh-kongming-shutdown-"));
    const paths = { home: join(root, "home"), projectDir: join(root, "proj") };
    const gate = controlledResponse(textResponse("甲未完成"));
    let h: SingleSession | undefined;
    try {
      h = await openSession(paths, [gate.stream]);
      await h.prompt("原始请求");
      await gate.entered;
      const id = h.agent.id;
      await h.runtime.close();
      assert.equal(gate.settled, true);
      await h.close();
      h = undefined;
      h = await openSession(paths, [textResponse("重启后完成")]);
      assert.equal(h.agent.id, id);
      assert.deepEqual(h.users(), ["原始请求"]);
      assert.ok(assistantTexts(h).includes("甲"));
      await h.prompt("继续处理");
      h.resume();
      await h.agent.whenIdle();
      assert.ok(assistantTexts(h).includes("重启后完成"));
    } finally {
      gate.release();
      await h?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

await test(
  "S12: shutting down with queued input preserves the accepted queue for explicit resume",
  {
    ...options,
    skip: "当前 DSH AgentFactory 退出会清空 inbox；完整停服的待执行队列恢复需要独立 KMH 生命周期覆盖",
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "kmh-kongming-shutdown-queue-"));
    const paths = { home: join(root, "home"), projectDir: join(root, "proj") };
    const gate = controlledResponse(textResponse("甲未完成"));
    let h: SingleSession | undefined;
    try {
      h = await openSession(paths, [gate.stream]);
      await h.prompt("正在执行");
      await gate.entered;
      await h.prompt("已接受的排队消息");
      const id = h.agent.id;
      await h.runtime.close();
      await h.close();
      h = undefined;
      h = await openSession(paths, [textResponse("排队消息完成")]);
      assert.equal(h.agent.id, id);
      assert.equal(h.agent.inbox.nextTurn.length, 1);
      h.resume();
      await h.agent.whenIdle();
      assert.deepEqual(h.users(), ["正在执行", "已接受的排队消息"]);
    } finally {
      gate.release();
      await h?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
