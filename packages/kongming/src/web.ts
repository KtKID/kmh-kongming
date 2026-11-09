/** 固定会话准备入口，使用宿主现有的鉴权连接。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-connection";
import type { KongmingRuntime } from "./session.ts";
import {
  EnsureRequestSchema,
  EnsureResultSchema,
  FailureSchema,
  ControlRequestSchema,
  ControlResultSchema,
  ControlFailureSchema,
} from "./protocol/index.ts";
/** @param ctx - 已提供连接服务的插件上下文。 @param runtime - 当前实例的固定会话运行时。 */
export function mountWeb(ctx: Context, runtime: KongmingRuntime): void {
  ctx.connection.fetch.register({
    path: "/api/kmh-kongming/control",
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      const headers = { "Cache-Control": "no-store" };
      try {
        const input = ControlRequestSchema.parse(await request.json());
        await runtime.ensure();
        request.signal.throwIfAborted();
        const control = runtime.control;
        let result: { accepted: true };
        switch (input.action) {
          case "prompt":
            result = await control.prompt(
              input.text,
              input.mode,
              input.requestId,
              request.signal,
            );
            break;
          case "stop":
            result = control.cancel();
            break;
          case "resume":
            result = control.resume();
            break;
          case "supplement":
            result = control.supplement(input.text);
            break;
        }
        return Response.json(ControlResultSchema.parse(result), { headers });
      } catch (error) {
        return Response.json(
          ControlFailureSchema.parse({
            code: "KONGMING_CONTROL_FAILED",
            message: String(error),
            retryable: true,
          }),
          { status: 400, headers },
        );
      }
    },
  });
  ctx.connection.fetch.register({
    path: "/api/kmh-kongming/ensure",
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      const headers = { "Cache-Control": "no-store" };
      try {
        EnsureRequestSchema.parse(await request.json());
        return Response.json(EnsureResultSchema.parse(await runtime.ensure()), {
          headers,
        });
      } catch (error) {
        return Response.json(
          FailureSchema.parse({
            code: "KONGMING_PREPARE_FAILED",
            message: String(error),
            retryable: true,
          }),
          { status: 400, headers },
        );
      }
    },
  });
}
