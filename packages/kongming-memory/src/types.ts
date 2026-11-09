/** 独立记忆服务的类型契约；文件、提示词、提醒与压缩模块共同引用。 */
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { CompactionResult } from "@deepseek-ai/dsh-compaction";
import type { SessionId } from "@deepseek-ai/dsh-session";

declare module "@deepseek-ai/dsh-llm" {
  interface MessageSourceMap {
    "kongming-memory-v1:reminder": {
      readonly kind: "kongming-memory-v1:reminder";
      readonly form: "instructions";
      readonly sessionId: SessionId;
      readonly turn: number;
    };
  }
}

/** 两份记忆文件的绝对路径；目录规则沿用当前孔明 home。 */
export interface MemoryFiles {
  /** 助手通过现有文件工具维护的原始记忆。 */
  readonly original: string;
  /** 提示词每次完整读取、由插件复制发布的冻结记忆。 */
  readonly frozen: string;
}

/** 可选的独立记忆服务，负责冻结加载、收尾提醒与手动压缩刷新。 */
export interface KongmingMemoryV1 {
  /** 当前插件实例拥有的两份文件路径。 */
  readonly files: MemoryFiles;
  /** 补齐原始文件，首次复制冻结文件；失败保留已有文件并拒绝。 */
  initialize(signal?: AbortSignal): Promise<void>;
  /** 等待当前发布完成并读取完整冻结正文；读取失败直接拒绝。 */
  readFrozen(signal?: AbortSignal): Promise<string>;
  /** 接受已成功完成的压缩结果并完整刷新；失败保留完整旧版并拒绝。 */
  refreshFrozen(result: CompactionResult, signal?: AbortSignal): Promise<void>;
  /** 为指定孔明 Agent 绑定冻结提示、同轮收尾提醒与手动刷新；返回异步清理入口。 */
  bindAgent(agent: Agent): () => Promise<void>;
  /** 释放监听并等待文件工作收敛；清理错误向调用者传播。 */
  close(): Promise<void>;
}
