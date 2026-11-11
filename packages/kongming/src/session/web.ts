/** 固定会话的准备和控制接口，使用宿主现有的鉴权连接。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-connection";
import type { KongmingRuntime } from "./runtime.ts";
import {
  EnsureRequestSchema,
  EnsureResultSchema,
  FixedSessionSchema,
  FailureSchema,
  ControlRequestSchema,
  ControlResultSchema,
  ControlFailureSchema,
} from "./protocol.ts";
/** 注册固定会话的 HTTP 路由，并将校验和执行错误转成可读响应。 */
export function mountWeb(ctx: Context, runtime: KongmingRuntime): void {
  ctx.connection.fetch.register({
    path: "/api/kmh-kongming/session-id",
    methods: ["GET"],
    requestBody: "buffered",
    /** 供侧栏识别已有会话，首次读取时保持按需创建。 */
    fetch: () =>
      Promise.resolve(
        Response.json(
          FixedSessionSchema.parse({ sessionId: runtime.fixedSessionId }),
          { headers: { "Cache-Control": "no-store" } },
        ),
      ),
  });
  ctx.connection.fetch.register({
    path: "/api/kmh-kongming/control",
    methods: ["POST"],
    requestBody: "buffered",
    /** 校验请求并准备固定会话，再将操作交给其控制器。 */
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
    /** 准备固定会话并返回身份与工作目录，供原生导航打开。 */
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
