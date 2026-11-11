/** 原生会话日志中由孔明签发的跨会话消息来源（现行 kind 为底座的 kmh-relay）。 */
import { z } from "zod";
import type {} from "@deepseek-ai/dsh-llm";

const sourceFields = {
  form: z.literal("relay"),
  senderSessionId: z.string().min(1),
  dispatchId: z.uuid(),
  targetSessionId: z.string().min(1),
};

/** 历史标记：迁移到 @kmh/session-kit 前的委派消息来源，仅供读取旧日志。 */
export const DispatchSourceSchema = z.object({
  ...sourceFields,
  kind: z.literal("kongming-dispatch"),
});

/** 兼容历史委派、回信与现行 kmh-relay 标记（投影用）。 */
export const AnyRelaySourceSchema = z.object({
  ...sourceFields,
  kind: z.enum(["kongming-dispatch", "kongming-reply", "kmh-relay"]),
});

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "kongming-dispatch": z.infer<typeof DispatchSourceSchema>;
    "kongming-reply": z.infer<typeof AnyRelaySourceSchema> & {
      kind: "kongming-reply";
    };
  }
}

/** 生成委派来源前缀，供目标模型识别来源和浏览器定位前缀文本块。 */
export function dispatchPreface(senderSessionId: string): string {
  return `来自孔明会话 ${senderSessionId} 的委派。`;
}
