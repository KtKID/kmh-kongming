/** 固定会话准备和控制接口的请求与响应校验。 */
import { z } from "zod";
/** 准备入口由服务端决定身份与目录。 */
export const EnsureRequestSchema = z.object({}).strict();
/** 固定会话已准备完成。 */
export const EnsureResultSchema = z
  .object({
    sessionId: z.string().uuid(),
    cwd: z.string().min(1),
  })
  .strict();
/** 准备入口响应值。 */
export type EnsureResult = z.infer<typeof EnsureResultSchema>;
/** 只读的固定会话身份，首次使用前为 null。 */
export const FixedSessionSchema = z
  .object({ sessionId: EnsureResultSchema.shape.sessionId.nullable() })
  .strict();
export type FixedSession = z.infer<typeof FixedSessionSchema>;
/** 孔明控制入口只接纳文本，并由宿主确定固定会话身份。 */
export const PromptControlSchema = z
  .object({
    action: z.literal("prompt"),
    text: z
      .string()
      // 校验去掉空白后的长度，接纳后沿用用户原文。
      .refine((value) => value.trim().length > 0, "输入内容不能为空"),
    mode: z.enum(["queue", "steer"]).default("queue"),
    requestId: z.string().min(1),
  })
  .strict();
/** 固定会话的控制请求；调用者通过 action 选择操作。 */
export const ControlRequestSchema = z.discriminatedUnion("action", [
  PromptControlSchema,
  z.object({ action: z.enum(["stop", "resume"]) }).strict(),
  z
    .object({
      action: z.literal("supplement"),
      text: PromptControlSchema.shape.text,
    })
    .strict(),
]);
export type ControlRequest = z.infer<typeof ControlRequestSchema>;
/** 控制操作已接纳，执行完成通过会话事件观察。 */
export const ControlResultSchema = z
  .object({ accepted: z.literal(true) })
  .strict();
/** 控制失败保留具体原因，调用方可核对状态后重试。 */
export const ControlFailureSchema = z
  .object({
    code: z.literal("KONGMING_CONTROL_FAILED"),
    message: z.string(),
    retryable: z.boolean(),
  })
  .strict();
/** 可读的准备或恢复失败。 */
export const FailureSchema = z
  .object({
    code: z.literal("KONGMING_PREPARE_FAILED"),
    message: z.string(),
    retryable: z.boolean(),
  })
  .strict();
