/** 检查构建模块的入口注册与卸载；隔离 VM 拥有浏览器全局，页面由浏览器验收。 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
const require = createRequire(import.meta.url);
const PrepareSchema = z.function({
  input: [z.instanceof(AbortSignal)],
  output: z.promise(z.void()),
});
const EntrySchema = z.object({
  name: z.string(),
  id: z.string().optional(),
  children: z.unknown().optional(),
  inject: z
    .function({ input: [], output: z.object({ prepare: PrepareSchema }) })
    .optional(),
});
const ModuleSchema = z.object({
  apply: z.function({ input: [z.unknown()], output: z.void() }),
});
type Cleanup = () => unknown;

await test("T01.1/T01.4: a plugin sidebar entry mounts a native session host and unwinds with its owner", async () => {
  let module: z.infer<typeof ModuleSchema> | undefined;
  const entries: z.infer<typeof EntrySchema>[] = [];
  const cleanups: Cleanup[] = [];
  const sessionId = randomUUID();
  const ordinarySessionId = randomUUID();
  const opened: string[] = [];
  const attachedStyles = new Set<unknown>();
  const style = {
    textContent: "",
    remove: () => attachedStyles.delete(style),
  };
  const sandbox = {
    AbortController,
    fetch: (path: string) =>
      Promise.resolve(
        Response.json(
          path === "/api/kmh-kongming/session-id"
            ? { sessionId }
            : { sessionId, cwd: "/proj" },
        ),
      ),
    document: {
      createElement: (tag: string) => {
        assert.equal(tag, "style");
        return style;
      },
      head: { appendChild: (value: unknown) => attachedStyles.add(value) },
    },
    window: {
      __ModuleLoader__: {
        load: (item: {
          factory: (require: (name: string) => unknown) => unknown;
        }) => {
          module = ModuleSchema.parse(
            item.factory((name) =>
              name === "@deepseek-ai/dsh-client-ui-primitives"
                ? {
                    Button: () => null,
                    IconLoadingOutlineRegular: () => null,
                    IconSparkleRegular: () => null,
                  }
                : require(name),
            ),
          );
        },
      },
    },
  };
  try {
    vm.runInNewContext(
      await readFile(new URL("../lib/client.js", import.meta.url), "utf8"),
      sandbox,
    );
    const ctx = {
      effect: (effect: () => Cleanup) => {
        cleanups.push(effect());
      },
      locale: { register: () => () => {}, bind: () => (key: string) => key },
      slots: {
        register: (options: unknown) => {
          const entry = EntrySchema.parse(options);
          entries.push(entry);
          return () => entries.splice(entries.indexOf(entry), 1);
        },
        inject: (_slot: string, callback: () => Cleanup) => {
          cleanups.push(callback());
        },
      },
      sessions: { refresh: () => Promise.resolve() },
      uiWorkspace: { openSession: (id: string) => opened.push(id) },
    };
    assert.ok(module);
    module.apply(ctx);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.ok(attachedStyles.has(style), "启动时应挂载侧栏隐藏样式");
    assert.ok(
      style.textContent.includes(`data-row-key="session:${sessionId}"`),
    );
    assert.ok(!style.textContent.includes(ordinarySessionId));
    assert.deepEqual(opened, [], "读取已有身份时保持当前页面");
    assert.ok(
      entries.some(
        (e) => e.name === "sidebar.panellist" && e.id === "kmh-kongming",
      ),
    );
    const main = entries.find((e) => e.name === "main");
    assert.ok(main);
    assert.equal(main.children, undefined);
    assert.ok(main.inject);
    await main.inject().prepare(new AbortController().signal);
    assert.deepEqual(opened, [sessionId]);
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(main.inject().prepare(cancelled.signal), {
      name: "AbortError",
    });
    assert.deepEqual(opened, [sessionId]);
    assert.equal(
      entries.filter((e) => e.name === "main.conversation").length,
      0,
    );
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    assert.equal(entries.length, 0);
    assert.equal(attachedStyles.size, 0);
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup();
  }
});
