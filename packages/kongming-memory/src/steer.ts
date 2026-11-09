/** 收尾提醒：由真实 turn-stopping 追加同轮 steer，来源与会话记录用于去重。 */
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";
import type { Session } from "@deepseek-ai/dsh-session";
import type { MemoryFiles } from "./types.ts";

/** 为指定 Agent 注册收尾动作；空文案停用，清理幂等，steer 接纳错误向执行循环传播。 */
export function mountMemoryReminder(
  agent: Agent,
  files: MemoryFiles,
  reminderPrompt: string,
): () => void {
  if (reminderPrompt.trim().length === 0) return () => {};
  let active = true;
  const release = agent.ctx.on(
    "agent/turn-stopping",
    ({ agent: current, turn, signal }) => {
      if (
        !active ||
        current !== agent ||
        signal.aborted ||
        hasMemoryReminder(agent.session, turn) ||
        reachedOutputLimit(agent.session, turn)
      )
        return;
      agent.steer(
        createMemoryReminder(files, agent.session.id, turn, reminderPrompt),
      );
    },
  );
  return () => {
    if (!active) return;
    active = false;
    release();
  };
}

/** 从已进入模型历史或已接纳队列的来源证据判断该会话该轮是否提醒过，供重新绑定恢复。 */
export function hasMemoryReminder(session: Session, turn: number): boolean {
  const matches = (message: UserMessage): boolean =>
    message.source.kind === "kongming-memory-v1:reminder" &&
    message.source.sessionId === session.id &&
    message.source.turn === turn;
  return session
    .snapshotEvents()
    .some(
      (event) =>
        (event.type === "user/message" && matches(event.data)) ||
        (event.type === "agent/inbox/spliced" &&
          event.data.inserted.some(matches)),
    );
}

/** 读取本轮全部已提交尝试，保留早先 step 的输出上限事实；后续正常 finish 保持该事实。 */
function reachedOutputLimit(session: Session, turn: number): boolean {
  return session
    .snapshotEvents()
    .some(
      (event) =>
        (event.type === "assistant/message" ||
          event.type === "assistant/attempt") &&
        event.data.turn === turn &&
        event.data.stream.some(
          (record) =>
            record.type === "chunk" &&
            record.chunk.type === "finish" &&
            record.chunk.reason.kind === "max-tokens",
        ),
    );
}

/** 将配置原文一次填入路径并标注来源；消息进入当前 turn 的后续 step，文件保存由现有工具执行。 */
export function createMemoryReminder(
  files: MemoryFiles,
  sessionId: Session["id"],
  turn: number,
  reminderPrompt: string,
): UserMessage {
  return createUserMessage({
    source: {
      kind: "kongming-memory-v1:reminder",
      form: "instructions",
      sessionId,
      turn,
    },
    content: [
      {
        type: "text",
        text: reminderPrompt.replace(
          /\{\{(?:originalMemoryPath|frozenMemoryPath)\}\}/g,
          (placeholder) =>
            placeholder === "{{originalMemoryPath}}"
              ? files.original
              : files.frozen,
        ),
      },
    ],
  });
}
