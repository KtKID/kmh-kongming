/** 数据目录随 Harness home 解析，工作目录可由插件配置或宿主环境指定。 */
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
/** 本实例的运行数据与项目总目录。 */
export interface RuntimePaths {
  home: string;
  projectDir: string;
}
/** @param projectDir - 插件配置。 @param env - 进程环境。 @returns 宿主数据目录和显式指定的工作目录。 */
export function runtimePaths(
  projectDir = "",
  env: Record<string, string | undefined> = process.env,
): RuntimePaths {
  return {
    home: resolveDshHome(undefined, env),
    projectDir: projectDir || env.KMH_KONGMING_PROJECT_DIR || "",
  };
}
/** @param path - proj 的绝对路径。 @returns 目录可读可遍历时完成；配置和访问错误直接报告。 */
export async function validateProjectDir(path: string): Promise<void> {
  if (!isAbsolute(path))
    throw Error("请在孔明插件设置中填写工作目录的绝对路径");
  try {
    if (!(await stat(path)).isDirectory()) throw Error("目标为文件");
    await access(path, constants.R_OK | constants.X_OK);
  } catch (error) {
    throw Error(`无法访问项目目录 ${path}：${String(error)}`, { cause: error });
  }
}
