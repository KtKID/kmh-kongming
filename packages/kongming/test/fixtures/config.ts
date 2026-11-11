/** 测试从实际安装 patch 读取默认配置，避免在夹具复制部署文案。 */
import { loadOverlayPatches } from "@deepseek-ai/dsh-app-boot";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { Config } from "../../lib/src/config.js";
import { Config as MemoryConfig } from "@kmh/kongming-memory-v1";

// 孔明与记忆同属一个 bundle，两份实例登记都在孔明安装 patch 里。
const entries = loadOverlayPatches(
  "kongming-test",
  fileURLToPath(new URL("../../cordis.patch.yml", import.meta.url)),
).flatMap((patch) => patch.insert ?? []);
const kongming = entries.find((e) => e.name === "@kmh/kongming");
const memory = entries.find(
  (entry) => entry.name === "@kmh/kongming-memory-v1",
);
assert.ok(kongming, "安装配置应登记孔明");
assert.ok(memory, "安装配置应登记记忆插件");
const rawKongming: unknown = kongming.config;
const rawMemory: unknown = memory.config;
assert.ok(rawKongming !== null && typeof rawKongming === "object");
assert.ok(rawMemory !== null && typeof rawMemory === "object");
const parsedKongming = Config(rawKongming);
const parsedMemory = MemoryConfig(rawMemory);

/** 返回独立配置副本，文案来自实际部署且已通过生产 schema 校验。 */
export function defaultConfig(): Config {
  return { ...parsedKongming };
}

/** 与正式安装共用记忆模板；缺少记忆配置时直接使夹具失败。 */
export function defaultMemoryConfig(): MemoryConfig {
  return { ...parsedMemory };
}
