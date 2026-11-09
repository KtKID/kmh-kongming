/** 校验实际浏览器导出的聊天尺寸；输入 JSON 路径，布局异常时以断言失败退出。 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const Rect = z.object({
  top: z.number(),
  bottom: z.number(),
  height: z.number(),
});
const Layout = z.object({
  panel: Rect,
  composer: Rect,
  scrollHeight: z.number().optional(),
  clientHeight: z.number().optional(),
  viewport: z.number().optional(),
  documentHeight: z.number().optional(),
});
const path = process.argv[2];
assert.ok(path, "请提供真实浏览器测量的 JSON 文件");
const mode = z.enum(["empty", "active"]).parse(process.argv[3] ?? "active");
const layout = Layout.parse(JSON.parse(await readFile(path, "utf8")));
const gap = layout.panel.bottom - layout.composer.bottom;
assert.ok(layout.panel.height > 200, "聊天面板应占用可见主区");
assert.ok(layout.composer.height > 0, "输入区应可见");
assert.ok(layout.composer.top >= layout.panel.top, "输入区应位于主区内");
if (mode === "empty") {
  const center = (layout.composer.top + layout.composer.bottom) / 2;
  const ratio = (center - layout.panel.top) / layout.panel.height;
  assert.ok(
    ratio >= 0.35 && ratio <= 0.65,
    `空会话输入区应居中，实际中心位于面板高度的 ${ratio * 100}%`,
  );
} else {
  assert.ok(
    gap >= -1 && gap <= 48,
    `聊天输入区应贴近面板底部，实际间隙 ${gap}px`,
  );
}
if (layout.documentHeight !== undefined && layout.viewport !== undefined)
  assert.ok(layout.documentHeight <= layout.viewport + 1, "聊天应使用内部滚动");
if (layout.scrollHeight !== undefined && layout.clientHeight !== undefined)
  assert.ok(
    layout.scrollHeight > layout.clientHeight,
    "长回复应形成内部滚动内容",
  );
console.log(`${mode} layout passed; bottom gap ${gap}px`);
