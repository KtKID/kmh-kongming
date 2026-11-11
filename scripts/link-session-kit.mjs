/**
 * 开发工作区内把兄弟仓库 kmh-session-kit 符号链接进本仓库根 node_modules，
 * 供 packages/kongming 开发与测试解析 @kmh/session-kit（未发布 npm）。
 *
 * 定位顺序：env SESSION_KIT_DIR → 自本仓库根逐级向上探测 <祖先>/kmh-session-kit
 * （本仓库位于 kmh-plugin 工作区时的兄弟目录）。
 * 输出：node_modules/@kmh/session-kit 符号链接；已正确则跳过（幂等）。
 * 失败行为：定位不到时打印提示并以 0 退出——主仓子模块场景（本仓库位于
 * kongming-os/packages/kmh-plugin/ 下）由主仓 profile 依赖提供该包，不需要本链接。
 */
import { mkdir, readlink, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** 逐级向上找到 kmh-plugin 工作区里的 kmh-session-kit；找不到返回 undefined。 */
function locateSessionKit() {
  if (process.env.SESSION_KIT_DIR) return process.env.SESSION_KIT_DIR;
  let current = repoRoot;
  for (;;) {
    const sibling = join(current, "kmh-session-kit");
    if (existsSync(join(sibling, "package.json"))) return sibling;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

const kitRoot = locateSessionKit();
if (kitRoot === undefined) {
  console.log(
    "link-session-kit: 未定位到 kmh-session-kit（主仓子模块场景无需链接，跳过）",
  );
  process.exit(0);
}
if (!existsSync(join(kitRoot, "lib/src/index.js"))) {
  console.error(
    `link-session-kit: ${kitRoot} 缺少 lib/src/index.js，请先在其仓库内执行 pnpm build`,
  );
  process.exit(1);
}

const linkPath = join(repoRoot, "node_modules/@kmh/session-kit");
await mkdir(dirname(linkPath), { recursive: true });
try {
  if (resolve(dirname(linkPath), await readlink(linkPath)) === kitRoot) {
    console.log(`link-session-kit: 已指向 ${kitRoot}，跳过`);
    process.exit(0);
  }
  await rm(linkPath, { recursive: true, force: true });
} catch {
  // 尚无链接，直接创建。
}
await symlink(kitRoot, linkPath, "dir");
console.log(`link-session-kit: ${linkPath} -> ${kitRoot}`);
