/** 启动供真实浏览器验收的私有 mock 环境；退出时收敛服务并删除临时数据。 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFixture } from "./fixtures/process.ts";
const root = await mkdtemp(join(tmpdir(), "kmh-kongming-browser-"));
const app = await startFixture(root);
const ready = join(root, "browser.json");
await writeFile(
  ready,
  JSON.stringify({
    root,
    url: app.url,
    home: app.home,
    projectDir: app.projectDir,
  }),
);
process.stdout.write(
  JSON.stringify({ pid: process.pid, readyFile: ready, url: app.url }) + "\n",
);
let closing: Promise<void> | undefined;
const close = () => {
  closing ??= app.close().finally(async () => {
    await rm(root, { recursive: true, force: true });
    process.exit(0);
  });
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
