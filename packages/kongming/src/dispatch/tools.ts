/** 将委派入口注册到固定孔明 Agent，并管理挂载生命周期。 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-api-session-controller";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { sendAndWatch } from "./session-kit/watch.ts";
import { dispatchPreface } from "./protocol.ts";
import { prepareDispatch } from "./submit.ts";

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    dispatchId: { type: "string", required: true },
    sessionId: { type: "string", required: true },
    provider: { type: "string", required: true },
    model: { type: "string", required: true },
    status: { type: "string", const: "queued", required: true },
  },
} as const;

/** 注册仅在固定孔明 Agent 作用域可见的工具，并返回统一释放入口。 */
export function mountDispatch(ctx: Context, source: Agent): () => void {
  let active = true;
  /** 确认挂载仍有效，且宿主仍持有同一个源 Agent 实例。 */
  const isSourceActive = () => active && ctx.agents.get(source.id) === source;
  // 每次委派的轮次跟踪释放入口；挂载卸载时统一释放。
  const releases = new Set<() => void>();

  /** 检查请求是否取消，并限制工具只能由当前孔明 Agent 调用。 */
  function requireSource(agent: Agent | undefined, signal: AbortSignal): void {
    signal.throwIfAborted();
    if (agent !== source || !isSourceActive())
      throw Error("孔明会话委派入口已释放");
  }

  const offList = source.ctx.tools.register(
    defineTool({
      name: "kongming_list_models",
      description:
        "List the current DSH provider and exact model IDs for Kongming delegation.",
      parameters: {},
      output: {
        schema: { type: "string" },
        /** 将模型目录 JSON 作为文本块交给模型。 */
        render: (_args, value) => [{ type: "text", text: value }],
      },
      /** 读取当前模型目录，返回可直接用于委派的服务商和模型标识。 */
      async execute(_args, { agent, signal }) {
        requireSource(agent, signal);
        const { groups } = await ctx.sessionController.modelCatalog();
        requireSource(agent, signal);
        return JSON.stringify(
          groups.map(
            // 以服务商为单位组织模型列表。
            ({ id, name, models }) => ({
              id,
              name,
              models: models.map(
                // 保留精确模型 ID 和供阅读的名称。
                ({ id, name }) => ({ id, name }),
              ),
            }),
          ),
        );
      },
    }),
  );
  const offDispatch = source.ctx.tools.register(
    defineTool({
      name: "kongming_dispatch",
      description:
        "Create a normal DSH session with an exact model from kongming_list_models and queue one task. " +
        "The tool result only confirms queue acceptance. The completed reply or failure arrives automatically " +
        "as a follow-up in this Kongming session. Wait for that message before giving the final answer; do not poll or repeat the dispatch.",
      parameters: {
        provider: {
          type: "string",
          required: true,
          description: "Exact provider ID.",
        },
        model: {
          type: "string",
          required: true,
          description: "Exact model ID.",
        },
        title: {
          type: "string",
          description:
            "Title shown in the session list. Use the user's requested name, or write a short task-specific title in the user's language.",
        },
        content: {
          type: "array",
          items: { type: "object", additionalProperties: true },
          required: true,
          description:
            'Ordered content blocks. Text: {"type":"text","text":"..."}. A saved image or file uses ' +
            '{"type":"image" or "file","attachment":{"attachmentId":"..."}} with the original attachment ID. ' +
            'A new image uses {"type":"image","mediaType":"image/png","data":"<base64>"}.',
        },
        cwd: {
          type: "string",
          description:
            "Absolute working directory; defaults to Kongming's current directory.",
        },
      },
      output: {
        schema: outputSchema,
        /** 将结构化排队回执序列化为工具结果文本。 */
        render: (_args, value) => [
          { type: "text", text: JSON.stringify(value) },
        ],
      },
      /** 准备目标会话并发送任务，入队成功后返回委派与会话 ID。 */
      async execute(
        { provider, model, title, content, cwd },
        { agent, signal },
      ) {
        const { sessionId, admitted } = await prepareDispatch(
          ctx,
          source,
          { provider, model, title, content, cwd },
          signal,
          // 跨越异步步骤后，用原调用身份和取消信号重新校验。
          () => requireSource(agent, signal),
        );
        requireSource(agent, signal);
        const { dispatchId, release } = await sendAndWatch(ctx, {
          from: source,
          toSessionId: sessionId,
          content: admitted,
          preface: dispatchPreface(source.id),
          isSourceActive,
        });
        releases.add(release);
        return {
          dispatchId,
          sessionId,
          provider,
          model,
          status: "queued" as const,
        };
      },
    }),
  );
  // 先标记挂载失效，再注销工具并清理尚待回传的跟踪。
  return () => {
    active = false;
    offDispatch();
    offList();
    for (const release of releases) release();
    releases.clear();
  };
}
