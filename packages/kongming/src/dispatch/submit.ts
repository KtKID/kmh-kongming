/** 校验委派目标并用原生会话服务准备执行 Agent。 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-api-session-controller";
import type {} from "@deepseek-ai/dsh-working-directory";
import type {} from "@deepseek-ai/dsh-attachment";
import { validateProjectDir } from "../paths.ts";
import { parseDispatchContent } from "./content.ts";

interface DispatchRequest {
  provider: string;
  model: string;
  title: string | undefined;
  content: unknown;
  cwd: string | undefined;
}

/** 校验模型与目录并入库附件，返回完成命名和模型选择的目标会话及待入队内容。 */
export async function prepareDispatch(
  ctx: Context,
  source: Agent,
  { provider, model, title, content, cwd }: DispatchRequest,
  signal: AbortSignal,
  requireSource: () => void,
) {
  requireSource();
  const parts = parseDispatchContent(source, content);
  const selection = { provider, model };
  const catalog = await ctx.sessionController.modelCatalog();
  // 先按服务商的精确 ID 缩小模型查询范围。
  const group = catalog.groups.find((entry) => entry.id === provider);
  // 模型 ID 在选定服务商的目录内匹配。
  if (group?.models.some((entry) => entry.id === model) !== true) {
    const cause = catalog.failures.find(
      // 优先提供该服务商加载模型目录时记录的失败原因。
      (failure) => failure.id === provider,
    )?.message;
    throw Error(
      `模型 ${provider}/${model} 当前不可用${cause === undefined ? "。" : `：${cause}`}`,
    );
  }
  try {
    await ctx.llm.resolveCallConfig(selection, signal);
    // 图片内容需要额外检查模型的输入能力。
    if (parts.some((part) => part.type === "image")) {
      const info = await ctx.llm.resolveModelInfo(provider, model, signal);
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
  requireSource();
  const admitted = await ctx.attachments.admitPromptContent(parts);
  const workspace = await ctx.workspaceRegistry.create(directory);
  requireSource();
  const { sessionId } = await ctx.sessionController.create({
    workspaceId: workspace.id,
  });
  const resolved = await ctx.sessionController.resolveAgent(sessionId);
  if ("error" in resolved) throw resolved.error;
  requireSource();
  const sessionTitle = title?.trim();
  if (sessionTitle) {
    await ctx.sessionController.rename({ sessionId, title: sessionTitle });
    requireSource();
  }
  resolved.agent.model.select(selection);
  return { sessionId, target: resolved.agent, admitted };
}
