/** 本地 Loader 验收接口：校验所观察的字段，其余事件载荷保留原始 JSON。 */
import { z } from "zod";
import {
  EnsureResultSchema,
  ControlResultSchema,
} from "../../lib/src/session/protocol.js";
export const ReadySchema = z.object({
  url: z.url(),
  pid: z.number().int().positive(),
});
const ContentSchema = z.array(
  z.object({ type: z.string(), text: z.string().optional() }).passthrough(),
);
export const UserSchema = z
  .object({
    id: z.string(),
    content: ContentSchema,
    source: z.object({ kind: z.string() }).passthrough(),
  })
  .passthrough();
export const InboxSchema = z
  .object({ inserted: z.array(UserSchema) })
  .passthrough();
export const InspectSchema = z.object({
  binding: EnsureResultSchema,
  events: z.array(
    z.object({ type: z.string(), data: z.unknown() }).passthrough(),
  ),
  requests: z.array(
    z.object({
      sessionId: z.string().optional(),
      messages: z.array(
        z.object({ role: z.string(), content: ContentSchema }).passthrough(),
      ),
    }),
  ),
  blocked: z.number().int().nonnegative(),
  original: z.string(),
  frozen: z.string(),
});
export type InspectState = z.infer<typeof InspectSchema>;
export const InspectRequestSchema = z.object({ text: z.string() });
export const AcceptedSchema = z.object({ accepted: z.literal(true) });
export const RpcSchema = z.object({
  result: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value: AcceptedSchema }),
    z.object({
      ok: z.literal(false),
      error: z.object({ message: z.string() }),
    }),
  ]),
});
export const FailureSchema = z.object({ message: z.string() });
export const apiSchemas = {
  "/api/kmh-kongming/control": ControlResultSchema,
  "/api/kmh-kongming/ensure": EnsureResultSchema,
  "/api/kmh-kongming-test/inspect": InspectSchema,
  "/api/kmh-kongming-test/inspect?wait=idle": InspectSchema,
  "/api/kmh-kongming-test/barrier": z.object({ blocked: z.literal(true) }),
  "/api/kmh-kongming-test/release": z.object({ released: z.literal(true) }),
};
