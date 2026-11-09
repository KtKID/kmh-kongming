/** 数据目录随 Harness home 解析，工作目录由部署明确给出。 */
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
/** 本实例的运行数据与项目总目录。 */
export interface RuntimePaths {
  home: string;
  projectDir: string;
}
/** @param env - 启动进程环境。 @returns 与启动器一致的 home 及部署配置的 proj。 */
export function runtimePaths(
  env: Record<string, string | undefined> = process.env,
): RuntimePaths {
  return {
    home: resolveDshHome(undefined, env),
    projectDir: env.KMH_KONGMING_PROJECT_DIR ?? "",
  };
}
/** @param path - proj 的绝对路径。 @returns 目录可读可遍历时完成；配置和访问错误直接报告。 */
export async function validateProjectDir(path: string): Promise<void> {
  if (!isAbsolute(path))
    throw Error("请通过 KMH_KONGMING_PROJECT_DIR 设置 proj 的绝对路径");
  try {
    if (!(await stat(path)).isDirectory()) throw Error("目标为文件");
    await access(path, constants.R_OK | constants.X_OK);
  } catch (error) {
    throw Error(`无法访问项目目录 ${path}：${String(error)}`, { cause: error });
  }
}
