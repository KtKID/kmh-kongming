/** 测试专用 Loader 进程，输出临时认证入口并在信号到达后等待完整退出。 */
import type {} from "@deepseek-ai/dsh-host-webserver";
import type {} from "./mock-llm.ts";
import { SessionId } from "@deepseek-ai/dsh-session";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { SessionRequestId } from "@deepseek-ai/dsh-api-session-controller";
import { z } from "zod";
import { getAgent } from "./host.ts";
import { InspectRequestSchema, InspectSchema, ReadySchema } from "./wire.ts";
import { boot, loadOverlayPatches } from "@deepseek-ai/dsh-app-boot";
import { defaultMemoryConfig } from "./config.ts";
import { fileURLToPath } from "node:url";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
const config = fileURLToPath(new URL("./cordis.yml", import.meta.url));
// 孔明与记忆同属一个 bundle，同一份安装 patch 登记两个插件；
// 现有 Web 用例专测队列和冻结；收尾提醒由独立真实循环用例启用并验证。
const patches = [
  ...loadOverlayPatches(
    "kongming-test",
    fileURLToPath(new URL("../../cordis.patch.yml", import.meta.url)),
  ),
];
for (const patch of patches) {
  if (process.env.KMH_KONGMING_TEST_MEMORY === "off" && patch.insert)
    patch.insert = patch.insert.filter(
      (entry) => entry.name !== "@kmh/kongming-memory-v1",
    );
  for (const entry of patch.insert ?? []) {
    if (entry.name === "@kmh/kongming-memory-v1")
      entry.config = { ...defaultMemoryConfig(), reminderPrompt: "" };
  }
}
const ctx = await boot(
  "kmh-kongming-test",
  config,
  patches,
  undefined,
  new URL("../../package.json", import.meta.url).href,
);
const home = z.string().min(1).parse(process.env.DSH_HOME);
/** 验收接口以空串表示缺省文件；测试另行核对文件存在性，其他读取错误继续抛出。 */
async function inspectMemory(name: string): Promise<string> {
  try {
    return await readFile(join(home, ".kongming", name), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return "";
    throw error;
  }
}
const readyPath = z.string().min(1).parse(process.env.KMH_KONGMING_TEST_READY);
const ready = ReadySchema.parse({
  url: ctx.connection.authenticatedUrl(
    `http://127.0.0.1:${ctx.webServer.port}/`,
  ),
  pid: process.pid,
});
ctx.connection.fetch.register({
  path: "/api/kmh-kongming-test/inspect",
  methods: ["GET", "POST"],
  requestBody: "buffered",
  fetch: async (request) => {
    const binding = await ctx.kongming.ensure();
    if (new URL(request.url).searchParams.get("wait") === "idle")
      await getAgent(ctx, SessionId(binding.sessionId)).whenIdle();
    if (request.method === "POST") {
      const { text } = InspectRequestSchema.parse(await request.json());
      await ctx.sessionController.prompt(
        {
          sessionId: SessionId(binding.sessionId),
          requestId: brandString<SessionRequestId>(crypto.randomUUID()),
          mode: "queue",
          content: [{ type: "text", text }],
        },
        request.signal,
      );
      await getAgent(ctx, SessionId(binding.sessionId)).whenIdle();
    }
    return Response.json(
      InspectSchema.parse({
        binding,
        events: getAgent(
          ctx,
          SessionId(binding.sessionId),
        ).session.snapshotEvents(),
        requests: ctx.kongmingTestAdapter.requests.map(
          ({ sessionId, messages }) => ({ sessionId, messages }),
        ),
        blocked: ctx.kongmingTestAdapter.controls.size,
        original: await inspectMemory("MEMORY.md"),
        frozen: await inspectMemory("MEMORY.frozen.md"),
      }),
    );
  },
});
ctx.connection.fetch.register({
  path: "/api/kmh-kongming-test/barrier",
  methods: ["GET"],
  requestBody: "buffered",
  fetch: async (request) => {
    await ctx.kongmingTestAdapter.waitBlocked(request.signal);
    return Response.json({ blocked: true });
  },
});
ctx.connection.fetch.register({
  path: "/api/kmh-kongming-test/release",
  methods: ["POST"],
  requestBody: "buffered",
  fetch: () =>
    Promise.resolve().then(() => {
      ctx.kongmingTestAdapter.release();
      return Response.json({ released: true });
    }),
});
await writeFile(readyPath, JSON.stringify(ready));
process.stdout.write("KMH_KONGMING_TEST_READY\n");
let closing: Promise<void> | undefined;
const close = () => {
  closing ??= ctx.fiber.dispose().then(() => {
    process.exit(0);
  });
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
