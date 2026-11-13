/** 孔明工作目录与提示词配置；默认文案由安装配置提供。 */
import Schema from "@deepseek-ai/schemastery";
/** 插件配置。 */
export const Config = Schema.object({
  projectDir: Schema.string()
    .default("")
    .description(
      "孔明工作目录的绝对路径。留空时沿用已有绑定，首次使用会建立专用目录。",
    ),
  personalityPrompt: Schema.string().default(""),
  systemPrompt: Schema.string().default(""),
});
/** 已经过 schema 解析的配置值。 */
export type Config = ReturnType<typeof Config>;
