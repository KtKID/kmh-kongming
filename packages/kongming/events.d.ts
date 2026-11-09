/** 孔明公开 Agent 扩展事件；能力插件按自身生命周期订阅，孔明独立管理固定会话。 */
import type { Agent } from "@deepseek-ai/dsh-agent";

declare module "@deepseek-ai/cordis" {
  interface Events {
    /** 已绑定孔明人格的 Agent 可接入扩展；emit 通知，异步准备由能力自己的请求屏障管理。 */
    "kongming/agent-ready"(payload: { agent: Agent }): void | Promise<void>;
    /** 孔明停止使用该 Agent，能力插件释放自己的绑定；serial 等待清理。 */
    "kongming/agent-detached"(payload: { agent: Agent }): void | Promise<void>;
    /** 访问当前已绑定 Agent，供后启用的插件接入；孔明缺省时访问集合为空。 */
    "kongming/visit-agents"(
      visit: (agent: Agent) => void | Promise<void>,
    ): void | Promise<void>;
  }
}

export {};
