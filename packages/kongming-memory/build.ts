/** 构建独立记忆插件：清理 lib，再用严格 TypeScript 输出运行代码与声明。 */
import { rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

/** 输出运行产物和声明；编译失败直接保留诊断并向调用者报告。 */
export async function buildPlugin(): Promise<void> {
  const root = fileURLToPath(new URL(".", import.meta.url));
  await rm(new URL("lib", import.meta.url), { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [
      createRequire(import.meta.url).resolve("typescript/bin/tsc"),
      "-p",
      "tsconfig.build.json",
    ],
    { cwd: root, stdio: "inherit" },
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await buildPlugin();
}
