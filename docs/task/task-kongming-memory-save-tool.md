# 孔明记忆改为专属保存工具追加

> spec: 无，独立任务
> 创建: 2026-11-10

## ① 需求

### 功能方向

孔明会话收尾时把值得长期保留的内容写进记忆。写入改用孔明自己的保存工具完成：工具只能追加新条目，永远不能修改或删除已有记忆。收尾提醒文案同步优化，写明工具名，并提醒不重要的内容（如天气、寒暄）不需要记录。

### 功能边界

- 做：孔明专属 `kongming_memory_save` 工具（仅追加、空白条目拒绝、只在孔明 Agent 作用域可用）；收尾提醒默认文案改为引导使用该工具并说明取舍标准
- 不做：不提供修改/删除已有条目的任何入口；不改变冻结文件的发布链路；不调整沙箱与审批配置（工具由插件进程直接执行，天然不经沙箱）；普通会话不感知该工具

### 不能破坏的不变量

- 冻结记忆的加载、启动重发与手动 `/compact` 刷新链路行为不变
- 收尾提醒的触发时机、每会话每轮一次去重、max-tokens 跳过与取消保护行为不变
- 普通会话（非孔明 Agent）不收到提醒，也无法通过该工具写入
- 记忆文件所有写入仍经服务串行队列，追加与冻结发布互不交错

## ② 测试用例（先写，此刻失败）

### unit

- blank_entry_rejected：空白 content 调用工具 → 工具结果 isError、原始文件内容不变 → 边界
- separator_and_serialized：原始文件无结尾换行时两条并发追加按入队顺序落盘并补分隔符；空白内容直接拒绝且文件不变 → 边界 + 串行不变量

### smoke

- reminder_guides_tool_append：真实 Agent 循环中收尾提醒送达（文案含工具名），模型调用 `kongming_memory_save`，条目以换行追加到原始文件末尾、冻结文件不变、无工具错误 → 功能方向
- ordinary_agent_cannot_save：普通 Agent 发起同名工具调用 → 结果 isError、原始文件不变 → 普通会话不变量

（既有 R01 收尾链路用例同步改走新工具，作为不变量回归的一部分。）

### e2e（按需）

不需要，依据：改动局限于记忆插件进程内工具与文案，无跨进程用户链路；沙箱/审批交互本身就是本任务要绕开的对象，无法在单测环境复现线上审批弹窗。

## ③ 技术实现

### 实现步骤

1. `src/files.ts`：新增 `appendOriginalFile()`——trim 后空白拒绝；读取原文件判断结尾换行决定分隔符；`writeFile` 追加旗标写入（保留信号取消），权限 0o600。
2. `src/tool.ts`（新增）：`mountMemoryTool()` 仿照委派工具模式，用 `defineTool` 在孔明 Agent 作用域注册 `kongming_memory_save`；`requireSource` 限制仅当前孔明 Agent 可执行；描述明确 append-only 与"天气等琐事不记"。
3. `src/types.ts`：`KongmingMemoryV1` 增加 `appendOriginal()`；`MemoryFiles.original` 注释改为"仅追加"。
4. `src/index.ts`：`appendOriginal` 经 `enqueue` 串行队列执行；`bindAgent()` 挂载工具，释放时先注销工具。
5. `cordis.patch.yml`：`reminderPrompt` 默认文案改为"判断价值 → 调 kongming_memory_save 追加 → 寒暄天气不记录 → 失败如实说明"；首行指令保持原文（既有断言依赖）。
6. `package.json`：补 `@deepseek-ai/dsh-tools` peer/dev 依赖。
7. 测试：`test/turn-reminder.test.ts` R01 改走新工具；新增 `test/memory-tool.test.ts`（T01–T04 对应 ②）。

### 涉及文件

- packages/kongming-memory/src/files.ts: 新增 appendOriginalFile
- packages/kongming-memory/src/tool.ts: 新增保存工具挂载
- packages/kongming-memory/src/types.ts: 服务契约增加 appendOriginal
- packages/kongming-memory/src/index.ts: 串行队列接入 + bindAgent 挂载
- packages/kongming-memory/cordis.patch.yml: 提醒默认文案
- packages/kongming-memory/package.json: dsh-tools 依赖 + test 脚本
- packages/kongming-memory/test/turn-reminder.test.ts: R01 改走工具
- packages/kongming-memory/test/memory-tool.test.ts: 新增工具用例
- packages/kongming-memory/README.md: 写入权限与收尾说明更新

## ④ 验证结果

> 流程说明：本任务实现先于 x-qdev 流程介入完成（用户中途切换流程），②的用例在实现落地后补写并独立执行；先红后绿未逐例留痕，④只记录真实通过的输出。

### 测试输出

`packages/kongming-memory` 全量（`pnpm test`，含新增 T01–T04 与改写的 R01）：

```
✔ M01 / F01：空目录生成两份空文件并在实际请求中加载
✔ M02 / F01：首次完整复制 raw，保留中文、空行、换行和花括号
✔ M03 / F01：已有冻结 A 时启动用原始 B 重发，raw B 保留
✔ M04 / F02：raw 日常修改后连续请求仍使用冻结版本
✔ M05 / F03：重建独立记忆服务后按原始 B 重发并保留会话身份
✔ M06 / F04：两次真实手动压缩后第一条请求分别使用新冻结 B、C
✔ M07 / F01：出生为空的冻结在启动时由原始 A 自愈重发
✔ M08 / F01：原始为空时保留已有冻结 A 不回退
✔ T01 / reminder_guides_tool_append：收尾提醒含工具名，模型经保存工具追加且冻结不变
✔ T02 / blank_entry_rejected：空白条目返回工具错误，原始文件保持原样
✔ T03 / separator_and_serialized：无结尾换行补分隔，并发追加按入队顺序落盘
✔ T04 / ordinary_agent_cannot_save：普通 Agent 调用同名工具失败且文件不变
✔ P05：记忆模板由配置决定，路径和完整冻结正文只替换一次
✔ P06：模板缺少路径或冻结正文变量、为空或类型错误时校验失败
✔ R01 / S01/S02/S04：系统只加载记忆上下文，任务收尾后同轮提醒并经保存工具追加条目
✔ R02 / S05：每轮各提醒一次，普通 Agent 保持独立
✔ R03 / S06：max-tokens 事实保持整轮，下一正常轮恢复提醒
✔ R04 / S07：模型异常与用户取消均按实际结果结束并保持零提醒
✔ R05 / S11：提醒进入队列后重建服务，既有证据阻止同轮重复提醒
✔ R06：空配置停用提醒，自定义配置只经 steer 送达
ℹ tests 20  ℹ pass 20  ℹ fail 0
```

`pnpm typecheck`、`pnpm lint`（--max-warnings 0）、`pnpm format:check`、`pnpm build` 均通过。

### 不变量回归

`packages/kongming` 全量（`node --test test/*.test.ts`，含可选记忆 O01–O05）：

```
ℹ tests 49  ℹ pass 48  ℹ fail 0  ℹ skipped 1
```

跳过 1 例为改动前即存在的平台条件用例，与本任务无关（基线一致）。

### 结论

- [x] 所有需求点被测试覆盖
- [x] 所有测试真实跑过且通过
- [x] 实现在边界内
- [x] 不变量未破坏
