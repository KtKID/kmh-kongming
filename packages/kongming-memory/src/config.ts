/** 记忆提示模板配置；路径与冻结正文变量保持必填，默认说明由安装 patch 提供。 */
import Schema from "@deepseek-ai/schemastery";

export const Config = Schema.object({
  reminderPrompt: Schema.string().default(""),
  promptTemplate: Schema.string()
    .pattern(
      /^(?=.*\{\{originalMemoryPath\}\})(?=.*\{\{frozenMemoryPath\}\})(?=.*\{\{frozenMemory\}\})/s,
    )
    .default("{{originalMemoryPath}}\n{{frozenMemoryPath}}\n{{frozenMemory}}"),
});

export type Config = ReturnType<typeof Config>;
