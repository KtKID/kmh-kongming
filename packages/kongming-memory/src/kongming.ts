/** 孔明可选接入：通过公开事件绑定当前和后续 Agent，卸载时只释放记忆能力。 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type {} from "@kmh/kongming/events";
import type { KongmingMemoryV1 } from "./types.ts";

/** 订阅孔明生命周期并访问已有 Agent；返回幂等清理，初始化错误由记忆读取路径与插件日志报告。 */
export function mountKongmingMemory(
  ctx: Context,
  memory: KongmingMemoryV1,
): () => Promise<void> {
  const bindings = new Map<
    Agent,
    { ready: Promise<void>; release: () => Promise<void> }
  >();
  let closed = false;
  let closing: Promise<void> | undefined;
  const prepare = (agent: Agent): Promise<void> => {
    if (closed) return Promise.resolve();
    const existing = bindings.get(agent);
    if (existing !== undefined) return existing.ready;
    const release = memory.bindAgent(agent);
    const ready = memory.initialize();
    bindings.set(agent, { ready, release });
    return ready;
  };
  const detach = async (agent: Agent): Promise<void> => {
    const binding = bindings.get(agent);
    if (binding === undefined) return;
    bindings.delete(agent);
    const released = binding.release();
    await binding.ready.catch(() => undefined);
    await released;
  };
  const stopReady = ctx.on("kongming/agent-ready", ({ agent }) =>
    prepare(agent),
  );
  const stopDetach = ctx.on("kongming/agent-detached", ({ agent }) =>
    detach(agent),
  );
  const restored = ctx.serial("kongming/visit-agents", prepare);
  restored.catch((error: unknown) => {
    ctx.logger.warn(`记忆接入已有孔明会话失败：${String(error)}`);
  });
  return () => {
    if (closing !== undefined) return closing;
    closed = true;
    stopReady();
    stopDetach();
    closing = (async () => {
      await Promise.all([...bindings.keys()].map(detach));
      await restored.catch(() => undefined);
    })();
    return closing;
  };
}
