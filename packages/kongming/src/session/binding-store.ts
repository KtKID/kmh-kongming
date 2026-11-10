/** 固定身份先独占发布，再创建会话；已有损坏文件保留供修复。 */
import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/** 已预留或已完成创建的固定会话绑定。 */
const BindingSchema = z
  .object({
    version: z.literal(1),
    phase: z.enum(["reserved", "ready"]),
    sessionId: z.string().uuid(),
    cwd: z.string().min(1),
    agentPreset: z.string().min(1).optional(),
  })
  .strict();
/** 持久化身份值。 */
export type Binding = z.infer<typeof BindingSchema>;

/** @param error - I/O 异常。 @param code - 预期系统错误码。 @returns 错误码是否匹配。 */
function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
/** 一个 home 的身份文件所有者。 */
export class BindingStore {
  readonly directory: string;
  readonly filename: string;

  /** 根据当前 home 确定固定身份文件的位置。 */
  constructor(home: string) {
    this.directory = join(home, ".kongming");
    this.filename = join(this.directory, "state.json");
  }
  /** 只读取已有身份；首次启动返回 undefined，损坏或 I/O 故障直接报告。 */
  async readExisting(): Promise<Binding | undefined> {
    try {
      return await this.read();
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return undefined;
      throw error;
    }
  }
  /** @param cwd - 新身份绑定的项目目录。 @returns 已有或独占创建的身份，读取与校验失败直接报告。 */
  async loadOrReserve(cwd: string): Promise<Binding> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      return await this.read();
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) throw error;
    }
    const binding: Binding = {
      version: 1,
      phase: "reserved",
      sessionId: randomUUID(),
      cwd,
    };
    const temporary = join(this.directory, `.state-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(binding) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      try {
        await link(temporary, this.filename);
      } catch (error) {
        if (!hasErrorCode(error, "EEXIST")) throw error;
      }
      return await this.read();
    } finally {
      await rm(temporary, { force: true });
    }
  }
  /** @param binding - 已完成会话创建的绑定。 @returns 原子发布完成；失败保留原身份文件。 */
  async commit(binding: Binding): Promise<void> {
    const value = BindingSchema.parse(binding);
    const temporary = join(this.directory, `.state-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(value) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, this.filename);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  /** 读取并校验身份文件，校验失败时报告可用于修复的文件路径。 */
  private async read(): Promise<Binding> {
    const text = await readFile(this.filename, "utf8");
    try {
      return BindingSchema.parse(JSON.parse(text));
    } catch (error) {
      throw Error(
        `孔明身份恢复失败，请检查 ${this.filename}：${String(error)}`,
        { cause: error },
      );
    }
  }
}
