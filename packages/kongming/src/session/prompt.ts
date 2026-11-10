/** 将配置原文绑定到孔明作用域，普通会话继续使用各自提示词。 */
import type { Agent } from "@deepseek-ai/dsh-agent";
import { PERSONA_PREFIX_SECTION } from "@deepseek-ai/dsh-system-prompt";
import type { Config } from "../config.ts";
/** @param agent - 孔明的真实 Agent。 @param config - 插件默认配置。 @returns 人格与配置段落的幂等清理入口。 */
export function mountPrompt(agent: Agent, config: Config): () => void {
  const releases = [
    agent.ctx.systemPrompt.section({
      name: PERSONA_PREFIX_SECTION,
      order: agent.ctx.systemPrompt.getSectionOrder(
        "DEPLOYMENT_PERSONA_PREFIX",
      ),
      text: config.personalityPrompt,
      interpolate: false,
    }),
    agent.ctx.systemPrompt.section({
      name: "kmh-kongming:instructions",
      order: agent.ctx.systemPrompt.getSectionOrder(
        "DEPLOYMENT_PERSONA_SUFFIX",
      ),
      text: config.systemPrompt,
      interpolate: false,
    }),
  ];
  let active = true;
  // 按注册的逆序释放段落，并允许重复调用清理入口。
  return () => {
    if (active) {
      active = false;
      for (const release of releases.reverse()) release();
    }
  };
}
