/** Loader 模型注册夹具：所有响应在本地确定，真实文件工具保持执行。 */
import type { Context } from "@deepseek-ai/cordis";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import { z } from "zod";

declare module "@deepseek-ai/cordis" {
  interface Context {
    kongmingTestAdapter: BrowserMock;
  }
}
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MockAdapter,
  messageText,
  textResponse,
  toolCallResponse,
} from "./mock-adapter.ts";
export const name = "kmh-kongming-mock";
export const inject = ["llm"];
class BrowserMock extends MockAdapter {
  failed = false;
  controls = new Set<() => void>();
  waiting = new Set<() => void>();
  /** 等待模型屏障已进入；只用于本地测试同步。 */
  async waitBlocked(signal: AbortSignal) {
    if (this.controls.size > 0) return;
    const ready = Promise.withResolvers<void>();
    const abort = () => ready.reject(signal.reason);
    this.waiting.add(ready.resolve);
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      await ready.promise;
    } finally {
      this.waiting.delete(ready.resolve);
      signal.removeEventListener("abort", abort);
    }
  }
  /** 显式放行测试拥有的模型请求。 */
  release() {
    for (const resolve of this.controls) resolve();
  }
  override async *stream(
    options: GenerateOptions,
  ): AsyncGenerator<StreamChunk> {
    this.requests.push(options);
    if (process.env.KMH_KONGMING_TEST_LOG)
      await appendFile(
        process.env.KMH_KONGMING_TEST_LOG,
        JSON.stringify({
          sessionId: options.sessionId,
          purpose: options.purpose,
          messages: options.messages,
          tools: options.tools,
        }) + "\n",
      );
    const lastUser = options.messages.findLast(
      (m) => m.role === "user" && m.source?.kind === "user",
    );
    const text = lastUser ? messageText(lastUser) : "";
    const results = options.messages
      .slice((lastUser ? options.messages.indexOf(lastUser) : -1) + 1)
      .filter((m) => m.role === "tool");
    if (text === "请委派查询杭州天气") {
      if (
        results.length === 0 &&
        options.tools?.some(({ name }) => name === "kongming_dispatch")
      ) {
        yield* toolCallResponse(
          "kongming_dispatch",
          {
            provider: "mock",
            model: "mock",
            title: "杭州天气预报",
            content: [{ type: "text", text: "查询杭州天气" }],
          },
          "browser-dispatch-title",
        );
        return;
      }
      yield* textResponse("杭州天气委派已提交。");
      return;
    }
    if (text.includes("受控任务")) {
      const ready = Promise.withResolvers<void>();
      const abort = () => ready.resolve();
      this.controls.add(ready.resolve);
      options.signal?.addEventListener("abort", abort, { once: true });
      try {
        yield { type: "block-start", index: 0, blockType: "text" };
        yield { type: "text-delta", index: 0, text: "受控输出片段" };
        for (const resolve of this.waiting) resolve();
        await ready.promise;
        options.signal?.throwIfAborted();
        yield {
          type: "block-end",
          index: 0,
          block: { type: "text", text: "受控输出片段" },
        };
        yield { type: "finish", reason: { kind: "stop" } };
      } finally {
        this.controls.delete(ready.resolve);
        options.signal?.removeEventListener("abort", abort);
      }
      return;
    }
    if (text.includes("长回复")) {
      yield* textResponse(
        Array.from(
          { length: 60 },
          (_, i) => `第 ${i + 1} 段：检查聊天滚动、历史保留和输入区位置。`,
        ).join("\n\n"),
      );
      return;
    }
    if (text.includes("故障") && !this.failed) {
      this.failed = true;
      yield { type: "block-start", index: 0, blockType: "text" };
      yield { type: "text-delta", index: 0, text: "故障前已输出片段" };
      yield {
        type: "finish",
        reason: {
          kind: "error",
          failure: { code: "SERVER", message: "mock unavailable" },
        },
      };
      return;
    }
    if (text.includes("以后") || text.includes("记住偏好")) {
      const memory = join(
        z.string().min(1).parse(process.env.DSH_HOME),
        ".kongming",
        "MEMORY.md",
      );
      if (results.length === 0) {
        yield* toolCallResponse(
          "read",
          { file_path: memory },
          "browser-memory-read",
        );
        return;
      }
      if (results.length === 1) {
        yield* toolCallResponse(
          "write",
          { file_path: memory, content: "- " + text + "\n" },
          "browser-memory-write",
        );
        return;
      }
      yield* textResponse("偏好已保存到原始记忆文件");
      return;
    }
    if (text.includes("读取")) {
      if (results.length === 0) {
        yield* toolCallResponse(
          "read",
          { file_path: "input.txt" },
          "browser-file-read",
        );
        return;
      }
      yield* textResponse("读取结果：" + results.map(messageText).join("\n"));
      return;
    }
    if (text.includes("叫什么")) {
      yield* textResponse(
        options.messages.some(
          (m) => m.role === "user" && messageText(m).includes("青竹"),
        )
          ? "这次讨论叫青竹"
          : "请先告诉我名称",
      );
      return;
    }
    yield* textResponse(
      "建议先明确目标，再列验收标准。依据是先验证关键流程，成立条件是使用同一个数据目录。",
    );
  }
}
export function apply(ctx: Context) {
  const adapter = new BrowserMock();
  ctx.effect(() => ctx.llm.registerAdapter(["mock"], adapter));
  ctx.provide("kongmingTestAdapter", adapter);
}
