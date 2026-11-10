/** 孔明专属保存工具：仅注册到固定 Agent 作用域，只追加新条目、不提供覆盖入口。 */
import type { Agent } from "@deepseek-ai/dsh-agent";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { KongmingMemoryV1 } from "./types.ts";

/** 保存回执为单段字符串，渲染为文本块交给模型。 */
const outputSchema = { type: "string" } as const;

/** 为指定孔明 Agent 注册记忆保存工具；返回同步释放函数，重复释放幂等。 */
export function mountMemoryTool(
  agent: Agent,
  memory: KongmingMemoryV1,
): () => void {
  let active = true;
  /** 确认挂载仍有效，且宿主仍持有同一个孔明 Agent 实例。 */
  const isSourceActive = () =>
    active && agent.ctx.agents.get(agent.id) === agent;
  /** 检查请求是否取消，并限制工具只能由当前孔明 Agent 调用。 */
  function requireSource(caller: Agent | undefined, signal: AbortSignal): void {
    signal.throwIfAborted();
    if (caller !== agent || !isSourceActive())
      throw Error("孔明记忆保存入口已释放");
  }
  const off = agent.ctx.tools.register(
    defineTool({
      name: "kongming_memory_save",
      description:
        "Append one new entry to Kongming's long-term memory file. " +
        "Append-only: existing entries can never be modified or deleted through this tool. " +
        "Record only durable value such as stable preferences, decisions, conclusions and pitfalls; " +
        "do not record trivial content such as weather, greetings or ephemeral task details.",
      parameters: {
        content: {
          type: "string",
          required: true,
          description:
            "Complete self-contained markdown entry to append; future sessions read it without this conversation's context.",
        },
      },
      output: {
        schema: outputSchema,
        /** 将保存回执作为文本块交给模型。 */
        render: (_args, value) => [{ type: "text", text: value }],
      },
      /** 经服务串行队列追加条目，返回带完整路径的保存回执。 */
      async execute(args, { agent: caller, signal }) {
        requireSource(caller, signal);
        await memory.appendOriginal(args.content, signal);
        requireSource(caller, signal);
        return `记忆条目已追加到 ${memory.files.original}`;
      },
    }),
  );
  return () => {
    active = false;
    off();
  };
}
