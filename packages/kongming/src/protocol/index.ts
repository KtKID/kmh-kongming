/** 身份文件和连接消息共用的边界校验定义。 */
import { z } from "zod";
/** 已预留或已完成创建的固定会话绑定。 */
export const BindingSchema = z
  .object({
    version: z.literal(1),
    phase: z.enum(["reserved", "ready"]),
    sessionId: z.string().uuid(),
    cwd: z.string().min(1),
    agentPreset: z.string().min(1).optional(),
  })
  .strict();
/** 持久化身份值。 */
export type Binding = z.infer<typeof BindingSchema>;
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
/** 孔明控制入口只接纳文本，并由宿主确定固定会话身份。 */
export const PromptControlSchema = z
  .object({
    action: z.literal("prompt"),
    text: z
      .string()
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
