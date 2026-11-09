/** 孔明提示词配置；默认文案由插件 cordis.patch.yml 提供。 */
import Schema from "@deepseek-ai/schemastery";
/** 插件配置。 */
export const Config = Schema.object({
  personalityPrompt: Schema.string().default(""),
  systemPrompt: Schema.string().default(""),
});
/** 已经过 schema 解析的配置值。 */
export type Config = ReturnType<typeof Config>;
