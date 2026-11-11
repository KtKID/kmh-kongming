/** 每个用例拥有一个 Loader 子进程，按就绪行同步并等待真实退出。 */
import type {
  EnsureResult,
  FixedSession,
} from "../../lib/src/session/protocol.js";
import type { InspectState } from "./wire.ts";
import { ReadySchema, RpcSchema, FailureSchema, apiSchemas } from "./wire.ts";
import type { SessionController } from "@deepseek-ai/dsh-api-session-controller";
import {
  ControlResultSchema,
  type ControlRequest,
} from "../../lib/src/session/protocol.js";

type RpcRequestMap = {
  [K in "prompt" | "cancel" | "updateQueue" as `session/${K}`]: {
    request: Parameters<SessionController[K]>[0];
  };
};
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** 在调用者私有根目录启动一次干净 Web/Loader 组合。 */
export async function startFixture(
  root: string,
  options: { memoryPlugin?: boolean } = {},
) {
  const home = join(root, "home");
  const projectDir = join(root, "proj");
  const readyPath = join(root, "ready.json");
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, "input.txt"), "PROJECT_READ_OK");
  await writeFile(join(root, "input.txt"), "STARTUP_WRONG");
  const env = Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "LANG", "SHELL"].flatMap((key) =>
      process.env[key] === undefined ? [] : [[key, process.env[key]]],
    ),
  );
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./server.ts", import.meta.url))],
    {
      cwd: root,
      env: {
        ...env,
        DSH_HOME: home,
        KMH_HOME: home,
        KMH_KONGMING_PROJECT_DIR: projectDir,
        KMH_KONGMING_TEST_READY: readyPath,
        KMH_KONGMING_TEST_LOG: join(root, "requests.jsonl"),
        KMH_KONGMING_TEST_MEMORY: options.memoryPlugin === false ? "off" : "on",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  let errors = "";
  const {
    promise: started,
    resolve: resolveReady,
    reject: rejectReady,
  } = Promise.withResolvers<void>();
  const exited = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) =>
    child.once("close", (code, signal) => {
      rejectReady(
        Error(`fixture exited (${code}, ${signal})\n${errors}\n${output}`),
      );
      resolve({ code, signal });
    }),
  );
  child.once("error", rejectReady);
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (output.includes("KMH_KONGMING_TEST_READY\n")) resolveReady();
  });
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const timer = setTimeout(
    () => rejectReady(Error(`fixture startup timeout\n${errors}\n${output}`)),
    30000,
  );
  let closed = false;
  const close = async () => {
    if (!closed) {
      closed = true;
      child.kill("SIGTERM");
    }
    await exited;
  };
  try {
    await started;
    const ready = ReadySchema.parse(
      JSON.parse(await readFile(readyPath, "utf8")),
    );
    const exchange = await fetch(ready.url, { redirect: "manual" });
    const cookie = exchange.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw Error(`fixture login failed: ${exchange.status}`);
    const base = new URL(ready.url).origin;
    const requestJson = async (
      path: string,
      body?: unknown,
    ): Promise<unknown> => {
      const response = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Cookie: cookie,
          Origin: base,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        throw Error(
          `fixture ${path}: HTTP ${response.status}, body=${text.slice(0, 200)}`,
        );
      }
      if (!response.ok) throw Error(FailureSchema.parse(value).message);
      return value;
    };
    function api(
      path: "/api/kmh-kongming/control",
      body: unknown,
    ): Promise<{ accepted: true }>;
    function api(
      path: "/api/kmh-kongming/ensure",
      body?: unknown,
    ): Promise<EnsureResult>;
    function api(path: "/api/kmh-kongming/session-id"): Promise<FixedSession>;
    function api(
      path:
        | "/api/kmh-kongming-test/inspect"
        | "/api/kmh-kongming-test/inspect?wait=idle",
      body?: unknown,
    ): Promise<InspectState>;
    function api(
      path: "/api/kmh-kongming-test/barrier",
      body?: unknown,
    ): Promise<{ blocked: true }>;
    function api(
      path: "/api/kmh-kongming-test/release",
      body?: unknown,
    ): Promise<{ released: true }>;
    async function api(path: keyof typeof apiSchemas, body?: unknown) {
      return apiSchemas[path].parse(await requestJson(path, body));
    }
    return {
      ...ready,
      home,
      projectDir,
      api,
      control: async (input: ControlRequest) =>
        ControlResultSchema.parse(
          await requestJson("/api/kmh-kongming/control", input),
        ),
      rpc: async <M extends keyof RpcRequestMap>(
        method: M,
        args: RpcRequestMap[M],
      ) => {
        const result = RpcSchema.parse(
          await requestJson("/api/" + method, {
            type: "client-request",
            rpcId: crypto.randomUUID(),
            method,
            payload: { args },
          }),
        );
        if (!result.result.ok) throw Error(result.result.error.message);
        return result.result.value;
      },
      close,
      diagnostics: () => ({ output, errors }),
    };
  } catch (error) {
    await close();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export type WebFixture = Awaited<ReturnType<typeof startFixture>>;
