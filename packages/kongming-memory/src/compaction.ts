/** 手动压缩接入：成功 command/done 关联真实摘要与提交记录，登记刷新供后续请求等待。 */
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { CompactionResult } from "@deepseek-ai/dsh-compaction";
import type {} from "@deepseek-ai/dsh-commands";
import type { KongmingMemoryV1 } from "./types.ts";

/** 绑定已确认成功的手动压缩；自动/超限入口按后续阶段接入，清理等待当前刷新收敛。 */
export function mountCompactionRefresh(
  agent: Agent,
  memory: KongmingMemoryV1,
): () => Promise<void> {
  const active = new Set<Promise<void>>();
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- DSH session/event 的 emit 调度接管异步观察器拒绝。
  const release = agent.ctx.on("session/event", async (session, event) => {
    if (
      session !== agent.session ||
      event.type !== "command/done" ||
      event.data.kind !== "success" ||
      event.data.sourceEventSeq === undefined
    )
      return;
    const sourceEventSeq = event.data.sourceEventSeq;
    const commandId = event.data.commandId;
    const events = session.snapshotEvents();
    const summary = events.find((item) => item.seq === sourceEventSeq);
    if (
      summary?.type !== "compaction/summary" ||
      summary.data.sourceCommandId !== commandId
    )
      return;
    const start = events.find(
      (item) =>
        item.type === "compaction/start" &&
        item.data.compactionId === summary.data.compactionId,
    );
    const end = events.find(
      (item) =>
        item.type === "compaction/end" &&
        item.data.compactionId === summary.data.compactionId,
    );
    if (
      start?.type !== "compaction/start" ||
      end?.type !== "compaction/end" ||
      end.data.error !== undefined
    )
      return;
    const result: CompactionResult = {
      compactionId: summary.data.compactionId,
      sourceCommandId: commandId,
      startSeq: start.seq,
      summarySeq: summary.seq,
      endSeq: end.seq,
      summary: summary.data.summary,
      shadowedRange: summary.data.shadowedRange,
      shadowedSeqs: summary.data.shadowedSeqs,
      shadowedTokenCount: summary.data.shadowedTokenCount,
    };
    const operation = refreshAfterCompaction(memory, result);
    active.add(operation);
    try {
      await operation;
    } finally {
      active.delete(operation);
    }
  });
  return async () => {
    release();
    await Promise.allSettled(active);
  };
}

/** 将成功结果交给记忆服务完整刷新；失败传播并由后续读取保持可见。 */
export async function refreshAfterCompaction(
  memory: KongmingMemoryV1,
  result: CompactionResult,
  signal?: AbortSignal,
): Promise<void> {
  await memory.refreshFrozen(result, signal);
}
