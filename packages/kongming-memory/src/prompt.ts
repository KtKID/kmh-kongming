/** 冻结提示词：每次真实组装等待发布，再完整读取当前快照，保留其他提示词段落。 */
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {
  AssembleContext,
  PromptPresentation,
} from "@deepseek-ai/dsh-system-prompt";
import type { KongmingMemoryV1 } from "./types.ts";
import type { Config } from "./config.ts";

/** 为指定孔明 Agent 注册组装贡献；返回同步移除函数，读取错误交给实际请求反馈。 */
export function mountFrozenPrompt(
  agent: Agent,
  memory: KongmingMemoryV1,
  config: Config,
): () => void {
  let active = true;
  const release = agent.ctx.on(
    "system-prompt/assemble",
    (_assembly, context, next) =>
      assembleFrozenPrompt(context, memory, config, next, () => active),
  );
  return () => {
    active = false;
    release();
  };
}

/** 用配置模板一次填入路径和完整冻结正文；启用时读错直接传播，卸载时退出当前贡献并保留基础组装结果。 */
export async function assembleFrozenPrompt(
  context: AssembleContext,
  memory: KongmingMemoryV1,
  config: Config,
  next: () => Promise<PromptPresentation>,
  isActive: () => boolean = () => true,
): Promise<PromptPresentation> {
  const result = await next();
  if (!isActive()) return result;
  let frozen: string;
  try {
    frozen = await memory.readFrozen(context.signal);
  } catch (error) {
    if (!isActive()) return result;
    throw error;
  }
  if (!isActive()) return result;
  return {
    ...result,
    sections: [
      ...result.sections,
      {
        name: "kmh-kongming:memory",
        interpolate: false,
        text: config.promptTemplate.replace(
          /\{\{(?:originalMemoryPath|frozenMemoryPath|frozenMemory)\}\}/g,
          (placeholder) => {
            switch (placeholder) {
              case "{{originalMemoryPath}}":
                return memory.files.original;
              case "{{frozenMemoryPath}}":
                return memory.files.frozen;
              case "{{frozenMemory}}":
                return frozen;
              default:
                return placeholder;
            }
          },
        ),
      },
    ],
  };
}
