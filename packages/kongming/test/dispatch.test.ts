/** 孔明委派回传回归。使用原生事件和会话队列，模型输出由脚本控制。 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type {
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
} from "@deepseek-ai/dsh-api-session-controller";
import {
  createUserMessage,
  type GenerateOptions,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm";
import { RelaySourceSchema } from "@kmh/session-kit";
import { dispatchInput } from "../src/dispatch/client/projection.ts";
import {
  messageText,
  textResponse,
  toolCallResponse,
} from "./fixtures/mock-adapter.ts";
import {
  singleSession,
  type SingleSession,
} from "./fixtures/single-session.ts";

const dispatch = toolCallResponse("kongming_dispatch", {
  provider: "mock",
  model: "mock",
  content: [{ type: "text", text: "查询天气" }],
});

function isTargetRequest(request: GenerateOptions): boolean {
  return request.messages.some(
    (message) =>
      message.role === "user" && message.source?.kind === "kmh-relay",
  );
}

/** 等待目标轮和回传轮结束，并核对回传归属。 */
async function observeReply(host: SingleSession) {
  await host.agent.whenIdle();
  const receipt = host
    .events()
    .findLast((event) => event.type === "tool/result");
  assert.ok(receipt && !receipt.data.message.isError, "委派应接纳");
  const target = host.ctx.agents.list().find((agent) => agent !== host.agent);
  assert.ok(target, "委派应创建目标会话");
  await target.whenIdle();
  await host.agent.whenIdle();
  const replies = host
    .events()
    .filter(
      (event) =>
        event.type === "user/message" && event.data.source.kind === "kmh-relay",
    );
  assert.equal(replies.length, 1, "本次委派应回传一次");
  const reply = replies[0];
  assert.ok(reply?.type === "user/message");
  const source = RelaySourceSchema.parse(reply.data.source);
  assert.equal(source.senderSessionId, target.id);
  assert.equal(source.targetSessionId, target.id);
  assert.ok(messageText(receipt.data.message).includes(source.dispatchId));
  return { target, reply, text: messageText(reply.data) };
}

const options = { timeout: 20_000 };

/** 用原生事件驱动同一个浏览器投影，检查分组和实际显示正文。 */
function projectDispatchEvent(
  event: Parameters<typeof dispatchInput.start>[1]["event"],
) {
  const match = dispatchInput.match(event);
  assert.ok(match?.exclusive);
  const start = {
    event,
    role: "start",
    location: { kind: "session" },
  } as const;
  const context = {
    key: match.id,
    kind: dispatchInput.kind,
    id: match.id,
    start,
    state: undefined,
    matches: [start],
    current: new Map(),
  };
  const state = dispatchInput.start(context, start, {
    previous: () => undefined,
  });
  const node = dispatchInput.buildViewNode?.({ ...context, state });
  assert.ok(node && "groupTree" in node);
  return { node, state };
}

await test(
  "T5：同轮收尾提示的输出保留在目标会话，回流原答",
  options,
  async () => {
    const businessAnswer = "杭州晴";
    const maintenanceAnswer = "记忆已保存";
    const answer = (request: GenerateOptions) => {
      if (!isTargetRequest(request)) return textResponse("孔明已记录");
      return textResponse(
        request.messages.some(
          (message) =>
            message.role === "user" &&
            message.source?.kind === "kongming-memory-v1:reminder",
        )
          ? maintenanceAnswer
          : businessAnswer,
      );
    };
    await singleSession(
      [dispatch, answer, answer, answer, answer],
      async (host) => {
        const reminded = new Set<number>();
        const off = host.ctx.on("agent/turn-stopping", ({ agent, turn }) => {
          if (agent === host.agent || reminded.has(turn)) return;
          reminded.add(turn);
          agent.steer(
            createUserMessage({
              source: {
                kind: "kongming-memory-v1:reminder",
                form: "instructions",
                sessionId: agent.session.id,
                turn,
              },
              content: [{ type: "text", text: "请保存本轮记忆。" }],
            }),
          );
        });
        try {
          await host.prompt("请委派查询");
          const { target, reply, text } = await observeReply(host);
          const request = target.session
            .snapshotEvents()
            .find(
              (event) =>
                event.type === "user/message" &&
                event.data.source.kind === "kmh-relay",
            );
          assert.ok(request);
          const requestCard = projectDispatchEvent(request);
          assert.equal(requestCard.state.direction, "request");
          assert.equal(requestCard.node.groupTree, "exchange");
          const replyCard = projectDispatchEvent(reply);
          assert.equal(replyCard.state.direction, "reply");
          assert.equal(replyCard.node.groupTree, "input");
          assert.deepEqual(replyCard.state.message.content, [
            { type: "text", text: businessAnswer },
          ]);
          const last = target.session
            .snapshotEvents()
            .findLast((event) => event.type === "assistant/message");
          assert.ok(last);
          assert.equal(messageText(last.data.message), maintenanceAnswer);
          assert.ok(text.endsWith(businessAnswer));
          assert.ok(!text.includes(maintenanceAnswer));
        } finally {
          off();
        }
      },
    );
  },
);

await test(
  "T1：空正文终态回传状态，省略工具调用前的过程话语",
  options,
  async () => {
    const answer = (request: GenerateOptions): StreamChunk[] => {
      if (!isTargetRequest(request)) return textResponse("孔明已记录");
      if (request.messages.some((message) => message.role === "tool"))
        return [{ type: "finish", reason: { kind: "stop" } }];
      return [
        ...textResponse("我先查一下").slice(0, -2),
        ...toolCallResponse("read", { file_path: "input.txt" }).map((chunk) =>
          "index" in chunk ? { ...chunk, index: 1 } : chunk,
        ),
      ];
    };
    await singleSession(
      [dispatch, answer, answer, answer, answer],
      async (host) => {
        await writeFile(join(host.paths.projectDir, "input.txt"), "测试数据");
        await host.prompt("请委派查询");
        const { target, reply, text } = await observeReply(host);
        const final = target.session
          .snapshotEvents()
          .findLast((event) => event.type === "assistant/message");
        assert.deepEqual(final?.data.message.content, []);
        assert.match(text, /执行已结束，但没有公开回复正文。$/);
        assert.doesNotMatch(text, /我先查一下/);
        const source = RelaySourceSchema.parse(reply.data.source);
        const legacy = {
          ...reply,
          data: {
            ...reply.data,
            source: { ...source, kind: "kongming-reply" as const },
            content: [
              {
                type: "text" as const,
                text: `委派 ${source.dispatchId} · 会话 ${target.id} 的执行结果：执行已结束，但没有公开回复正文。`,
              },
            ],
          },
        };
        for (const result of [reply, legacy]) {
          const { node, state } = projectDispatchEvent(result);
          assert.equal(state.direction, "reply");
          assert.equal(node.groupTree, "input");
          assert.deepEqual(state.message.content, [
            { type: "text", text: "执行已结束，但没有公开回复正文。" },
          ]);
        }
      },
    );
  },
);

const queueCases = [
  { name: "T2：领取前移除时回传取消", action: { kind: "remove" } },
  {
    name: "T3：编辑排队消息后继续回传结果",
    action: { kind: "edit", content: [{ type: "text", text: "查询气温" }] },
  },
  { name: "T4：转入当前轮后继续回传结果", action: { kind: "steer" } },
] satisfies readonly {
  name: string;
  action: SessionUpdateQueueRequest["action"];
}[];

for (const { name, action } of queueCases) {
  await test(name, options, async () => {
    const answer = (request: GenerateOptions) =>
      textResponse(isTargetRequest(request) ? "目标执行结果" : "孔明已记录");
    await singleSession([dispatch, answer, answer, answer], async (host) => {
      let changed: Promise<SessionUpdateQueueValue> | undefined;
      const off = host.ctx.on("agent/status", ({ agent, status }) => {
        if (status !== "running" || changed !== undefined) return;
        const queued = agent.inbox.nextTurn.find(
          (message) => message.source.kind === "kmh-relay",
        );
        if (queued === undefined) return;
        changed = host.ctx.sessionController.updateQueue({
          sessionId: agent.id,
          itemId: queued.id,
          action,
        });
      });
      try {
        await host.prompt("请委派查询");
        await host.agent.whenIdle();
        assert.ok(changed, "目标领取前应完成队列操作");
        assert.deepEqual(await changed, { accepted: true });
        const { target, text } = await observeReply(host);
        const admitted = target.session
          .snapshotEvents()
          .find(
            (event) =>
              event.type === "user/message" &&
              event.data.source.kind === "kmh-relay",
          );
        if (action.kind === "remove") {
          assert.equal(admitted, undefined);
          assert.match(text, /消息已在开始执行前取消。$/);
        } else {
          assert.ok(admitted?.type === "user/message");
          assert.match(text, /目标执行结果$/);
          if (action.kind === "edit")
            assert.equal(messageText(admitted.data), "查询气温");
        }
      } finally {
        off();
      }
    });
  });
}
