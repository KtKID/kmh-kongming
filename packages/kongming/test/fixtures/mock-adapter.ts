/** 脚本模型夹具：记录最终请求，提供确定性文本流、工具调用和故障。 */
import assert from "node:assert/strict";
import {
  LlmAdapter,
  ToolCallId,
  type GenerateOptions,
  type StreamChunk,
  type LlmModelInfo,
} from "@deepseek-ai/dsh-llm";

/** 构造完整文本流；每个字符使用独立 delta，便于检查增量展示。 */
export function textResponse(text: string): StreamChunk[] {
  return [
    { type: "block-start", index: 0, blockType: "text" },
    ...Array.from(text, (text): StreamChunk => ({
      type: "text-delta",
      index: 0,
      text,
    })),
    { type: "block-end", index: 0, block: { type: "text", text } },
    { type: "usage", usage: { inputTokens: 10, outputTokens: text.length } },
    { type: "finish", reason: { kind: "stop" } },
  ];
}

/** 构造交给真实工具管线执行的调用。 */
export function toolCallResponse(
  name: string,
  args: Record<string, unknown>,
  id = "kongming-call",
): StreamChunk[] {
  const callId = ToolCallId(id);
  const argumentsJson = JSON.stringify(args);
  return [
    { type: "block-start", index: 0, blockType: "tool-call" },
    {
      type: "tool-call-delta",
      index: 0,
      id: callId,
      name,
      argumentsDelta: argumentsJson,
    },
    {
      type: "block-end",
      index: 0,
      block: { type: "tool-call", id: callId, name, arguments: argumentsJson },
    },
    { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
    { type: "finish", reason: { kind: "tool-calls" } },
  ];
}

export type ScriptEntry =
  | readonly StreamChunk[]
  | Error
  | ((
      options: GenerateOptions,
    ) =>
      | Iterable<StreamChunk>
      | AsyncIterable<StreamChunk>
      | Promise<Iterable<StreamChunk> | AsyncIterable<StreamChunk>>);

/** 逐请求消费脚本；函数项可根据实际历史返回数组或异步流。 */
export class MockAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];
  readonly script: ScriptEntry[];
  constructor(script: readonly ScriptEntry[] = []) {
    super();
    this.script = [...script];
  }
  override providerInfo(provider: string) {
    return { id: provider, name: "Kongming mock" };
  }
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([
      { provider, id: "mock", name: "Mock", inputModalities: ["text"] },
    ]);
  }
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model });
  }
  async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    this.requests.push(options);
    const entry = this.script.shift();
    if (entry === undefined) throw Error("MockAdapter: script exhausted");
    if (entry instanceof Error) throw entry;
    const chunks = typeof entry === "function" ? await entry(options) : entry;
    for await (const chunk of chunks) {
      options.signal?.throwIfAborted();
      yield chunk;
    }
  }
}

/** 从真实消息中取文本，断言在测试主体执行。 */
export function messageText(message: {
  readonly content: readonly {
    readonly type: string;
    readonly text?: string | undefined;
  }[];
}): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

/** 取得已观察的请求；缺失时让测试在使用前明确失败。 */
export function requestAt(
  adapter: MockAdapter,
  index: number,
): GenerateOptions {
  const request = adapter.requests[index];
  assert.ok(request, `缺少第 ${index + 1} 次模型请求`);
  return request;
}
