/** 原生会话日志中由孔明签发的跨会话消息来源。 */
import { z } from "zod";
import type {} from "@deepseek-ai/dsh-llm";

const sourceFields = {
  form: z.literal("relay"),
  senderSessionId: z.string().min(1),
  dispatchId: z.uuid(),
  targetSessionId: z.string().min(1),
};

export const DispatchSourceSchema = z.object({
  ...sourceFields,
  kind: z.literal("kongming-dispatch"),
});

export const ReplySourceSchema = z.object({
  ...sourceFields,
  kind: z.literal("kongming-reply"),
});

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "kongming-dispatch": z.infer<typeof DispatchSourceSchema>;
    "kongming-reply": z.infer<typeof ReplySourceSchema>;
  }
}

/** 模型收到的独立来源说明，浏览器依据同一文案识别该块。 */
export function dispatchPreface(senderSessionId: string): string {
  return `来自孔明会话 ${senderSessionId} 的委派。`;
}
