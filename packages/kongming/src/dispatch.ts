/** 孔明发起普通会话，并在原生执行轮次结束后通过队列交回结果。 */
import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-api-session-controller";
import type {} from "@deepseek-ai/dsh-working-directory";
import type {} from "@deepseek-ai/dsh-attachment";
import type { AttachmentAdmissionPart } from "@deepseek-ai/dsh-attachment/types";
import { createUserMessage, type ContentBlock } from "@deepseek-ai/dsh-llm";
import type { TurnEndReason } from "@deepseek-ai/dsh-session/types";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { z } from "zod";
import { validateProjectDir } from "./paths.ts";
import {
  DispatchSourceSchema,
  ReplySourceSchema,
  dispatchPreface,
} from "./protocol/dispatch.ts";

const attachmentReference = z.object({
  attachment: z.object({ attachmentId: z.string().min(1) }),
});
const contentSchema = z
  .array(
    z.union([
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({
        type: z.literal("image"),
        data: z.string().min(1),
        mediaType: z.enum([
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/gif",
        ]),
        name: z.string().optional(),
      }),
      attachmentReference.extend({ type: z.literal("image") }),
      attachmentReference.extend({ type: z.literal("file") }),
    ]),
  )
  .min(1)
  .refine(
    (parts) =>
      parts.some((part) => part.type !== "text" || part.text.trim() !== ""),
    {
      error: "Dispatch content must contain text or an attachment",
    },
  );

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

type DispatchContent = z.infer<typeof contentSchema>;

function attachmentParts(
  source: Agent,
  content: DispatchContent,
): AttachmentAdmissionPart[] {
  const originals = content.some((part) => "attachment" in part)
    ? source.session
        .snapshotEvents()
        .flatMap((event) =>
          event.type === "user/message" ? event.data.content : [],
        )
    : [];
  return content.map((part) => {
    if (part.type === "text") return part;
    if ("data" in part) {
      const { type, mediaType, data, name } = part;
      return { type, mediaType, data, ...(name === undefined ? {} : { name }) };
    }
    const ref = originals.find(
      (block) =>
        (block.type === "image" || block.type === "file") &&
        block.type === part.type &&
        block.attachment.attachmentId === part.attachment.attachmentId,
    );
    if (ref?.type === "image")
      return {
        type: "image",
        attachment: ref.attachment,
        encodedBytes: ref.attachment.bytes,
      };
    if (ref?.type === "file") return ref;
    throw Error(
      `附件 ${part.attachment.attachmentId} 不属于孔明会话中的已入库附件`,
    );
  });
}

function resultNotice(reason: TurnEndReason): string {
  if (reason.kind === "error")
    return `执行失败（${reason.error.code}）：${reason.error.message}`;
  if (reason.kind === "completed") return "执行已结束，但没有公开回复正文。";
  return `执行未完成（${reason.kind}）。`;
}

/** 注册仅在固定孔明 Agent 作用域可见的工具，并返回跟踪器的释放入口。 */
export function mountDispatch(ctx: Context, source: Agent): () => void {
  const pending = new Set<() => void>();
  let active = true;

  function requireSource(agent: Agent | undefined, signal: AbortSignal): void {
    signal.throwIfAborted();
    if (!active || agent !== source || ctx.agents.get(source.id) !== source)
      throw Error("孔明会话委派入口已释放");
  }

  function followDispatch(
    target: Agent,
    content: readonly ContentBlock[],
    dispatchId: string,
  ): void {
    const message = createUserMessage({
      source: DispatchSourceSchema.parse({
        kind: "kongming-dispatch",
        form: "relay",
        senderSessionId: source.id,
        dispatchId,
        targetSessionId: target.id,
      }),
      content: [{ type: "text", text: dispatchPreface(source.id) }, ...content],
    });
    let claimedTurn: number | undefined;
    let answer: ContentBlock[] = [];

    const offClaim = ctx.on(
      "agent/inbox/claimed",
      ({ agent, message: claimed, turn }) => {
        if (agent === target && claimed.id === message.id) claimedTurn = turn;
      },
    );
    const offDiscard = ctx.on(
      "agent/inbox/discarded",
      ({ agent, message: discarded }) => {
        if (agent !== target || discarded.id !== message.id) return;
        // 编辑与转入当前轮会保留消息 ID，等队列操作完成后再判断是否取消。
        queueMicrotask(() => {
          if (
            !pending.has(release) ||
            claimedTurn !== undefined ||
            target.inbox.nextTurn.some((queued) => queued.id === message.id) ||
            target.inbox.nextStep.some((queued) => queued.id === message.id)
          )
            return;
          deliver("委派已在开始执行前取消。");
        });
      },
    );
    const offEvent = ctx.on("session/event", (session, event) => {
      if (session !== target.session || claimedTurn === undefined) return;
      if (
        event.type === "assistant/message" &&
        event.data.turn === claimedTurn
      ) {
        answer = event.data.message.content.filter(
          (block) =>
            block.type === "image" ||
            block.type === "file" ||
            (block.type === "text" && block.text.trim() !== ""),
        );
      }
      if (event.type !== "turn/end" || event.data.turn !== claimedTurn) return;
      const reason = event.data.reason;
      deliver(
        reason.kind === "completed" && answer.length > 0
          ? undefined
          : resultNotice(reason),
      );
    });
    const offDispose = ctx.on("agent/disposed", ({ agent }) => {
      if (agent === target) deliver("执行会话已关闭。");
    });

    function release(): void {
      pending.delete(release);
      offClaim();
      offDiscard();
      offEvent();
      offDispose();
    }

    function deliver(failure: string | undefined): void {
      if (!pending.has(release)) return;
      release();
      if (!active || ctx.agents.get(source.id) !== source) return;
      try {
        source.followup(
          createUserMessage({
            source: ReplySourceSchema.parse({
              kind: "kongming-reply",
              form: "relay",
              senderSessionId: target.id,
              dispatchId,
              targetSessionId: target.id,
            }),
            content: [
              {
                type: "text",
                text:
                  `委派 ${dispatchId} · 会话 ${target.id} 的执行结果` +
                  (failure === undefined
                    ? "。请根据下列回复向用户答复。"
                    : `：${failure}`),
              },
              ...(failure === undefined ? answer : []),
            ],
          }),
        );
      } catch (error) {
        ctx.logger.warn(`孔明委派 ${dispatchId} 回传失败：${String(error)}`);
      }
    }

    pending.add(release);
    try {
      target.followup(message);
    } catch (error) {
      release();
      throw error;
    }
  }

  const offList = source.ctx.tools.register(
    defineTool({
      name: "kongming_list_models",
      description:
        "List the current DSH provider and exact model IDs for Kongming delegation.",
      parameters: {},
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      async execute(_args, { agent, signal }) {
        requireSource(agent, signal);
        const { groups } = await ctx.sessionController.modelCatalog();
        requireSource(agent, signal);
        return JSON.stringify(
          groups.map(({ id, name, models }) => ({
            id,
            name,
            models: models.map(({ id, name }) => ({ id, name })),
          })),
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
        render: (_args, value) => [
          { type: "text", text: JSON.stringify(value) },
        ],
      },
      async execute({ provider, model, content, cwd }, { agent, signal }) {
        requireSource(agent, signal);
        const parts = attachmentParts(source, contentSchema.parse(content));
        const selection = { provider, model };
        const catalog = await ctx.sessionController.modelCatalog();
        const group = catalog.groups.find((entry) => entry.id === provider);
        if (group?.models.some((entry) => entry.id === model) !== true) {
          const cause = catalog.failures.find(
            (failure) => failure.id === provider,
          )?.message;
          throw Error(
            `模型 ${provider}/${model} 当前不可用${cause === undefined ? "。" : `：${cause}`}`,
          );
        }
        try {
          await ctx.llm.resolveCallConfig(selection, signal);
          if (parts.some((part) => part.type === "image")) {
            const info = await ctx.llm.resolveModelInfo(
              provider,
              model,
              signal,
            );
            if (info.inputModalities?.includes("image") === false)
              throw Error("该模型不支持图像输入");
          }
        } catch (error) {
          signal.throwIfAborted();
          throw Error(
            `模型 ${provider}/${model} 无法接收本次委派：${String(error)}`,
            { cause: error },
          );
        }
        const directory =
          cwd ??
          ctx.get("workingDirectory")?.get(source.session) ??
          source.session.header.cwd;
        if (directory === undefined) throw Error("孔明会话没有工作目录");
        await validateProjectDir(directory);
        requireSource(agent, signal);
        const admitted = await ctx.attachments.admitPromptContent(parts);
        const workspace = await ctx.workspaceRegistry.create(directory);
        requireSource(agent, signal);
        const { sessionId } = await ctx.sessionController.create({
          workspaceId: workspace.id,
        });
        const resolved = await ctx.sessionController.resolveAgent(sessionId);
        if ("error" in resolved) throw resolved.error;
        requireSource(agent, signal);
        resolved.agent.model.select(selection);
        const dispatchId = randomUUID();
        followDispatch(resolved.agent, admitted, dispatchId);
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
  return () => {
    active = false;
    offDispatch();
    offList();
    for (const release of pending) release();
  };
}
