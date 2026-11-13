/** 原生会话日志中由本底座签发的跨会话消息来源（发送与回传共用 kind）。 */
import { z } from "zod";
import type {} from "@deepseek-ai/dsh-llm";

const sourceFields = {
  form: z.literal("relay"),
  senderSessionId: z.string().min(1),
  dispatchId: z.uuid(),
  targetSessionId: z.string().min(1),
};

export const RelaySourceSchema = z.object({
  ...sourceFields,
  kind: z.literal("kmh-relay"),
});

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "kmh-relay": z.infer<typeof RelaySourceSchema>;
  }
}

/**
 * 生成来源前缀文本，供目标模型识别消息来源、浏览器定位前缀块做折叠投影。
 * @param senderSessionId - 发送方会话 ID。
 * @returns 一行中文前缀文本。
 */
export function relayPreface(senderSessionId: string): string {
  return `来自会话 ${senderSessionId} 的消息。`;
}
