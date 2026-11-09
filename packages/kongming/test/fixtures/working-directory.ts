/** Loader 测试复用公开目录夹具，使文件工具沿用本例的项目根。 */
import type { Context } from "@deepseek-ai/cordis";
import { provideWorkingDirectoryFixture } from "@deepseek-ai/dsh-agent-loop-testkit";
import { z } from "zod";

export const name = "kongming-test-working-directory";
export const inject = ["fs"];
/** 为已挂载文件系统提供本例目录；缺失配置时让启动明确失败。 */
export function apply(ctx: Context): void {
  provideWorkingDirectoryFixture(
    ctx,
    z.string().min(1).parse(process.env.KMH_KONGMING_PROJECT_DIR),
  );
}
