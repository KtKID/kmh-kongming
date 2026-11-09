/** 从记忆插件自己的安装 patch 取得实际部署模板。 */
import { loadOverlayPatches } from "@deepseek-ai/dsh-app-boot";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { Config } from "../../src/config.ts";

const entries = loadOverlayPatches(
  "memory-test",
  fileURLToPath(new URL("../../cordis.patch.yml", import.meta.url)),
).flatMap((patch) => patch.insert ?? []);
const entry = entries.find((e) => e.name === "@kmh/kongming-memory-v1");
assert.ok(entry, "安装配置应登记记忆插件");
const raw: unknown = entry.config;
assert.ok(raw !== null && typeof raw === "object");
const parsed = Config(raw);

/** 返回当前模板副本，避免调用者修改夹具默认值。 */
export function defaultMemoryConfig(): Config {
  return { ...parsed };
}
