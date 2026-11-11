/** 孔明首阶段面板文案。 */
export const zh = {
  panel: "孔明",
  dispatchExchange: "孔明 · 会话往来",
  dispatchReply: "收到会话回信",
  dispatchRunning: "进行中",
  dispatchCompleted: "已完成",
  dispatchStopped: "已结束",
  retry: "重试",
  empty: "与孔明开始交流，聊天和记忆会保存在当前数据目录",
  prepareFailed: "孔明暂时无法打开",
} as const;
/** 英文文案与中文保持同键。 */
export const en: Record<keyof typeof zh, string> = {
  panel: "Kongming",
  dispatchExchange: "Kongming · Delegation",
  dispatchReply: "Session reply received",
  dispatchRunning: "In progress",
  dispatchCompleted: "Completed",
  dispatchStopped: "Ended",
  retry: "Retry",
  empty: "Chat with Kongming. This home keeps your conversation and memory.",
  prepareFailed: "Kongming could not be opened",
};
/** 词典键。 */
export type KongmingLocaleKey = keyof typeof zh;
