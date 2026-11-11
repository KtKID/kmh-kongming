# 孔明与记忆合并为单一 bundle

> spec: 无，独立任务
> 创建: 2026-11-10

## ① 需求

### 功能方向

孔明插件与记忆插件合成一个 bundle：profile 只需选择 `@kmh/kongming` 一个 bundle，即同时装配孔明主体与记忆插件。记忆包不再作为独立 bundle 提供。

### 功能边界

- 做：孔明安装 patch 一并登记 `kmh-kongming` 与 `kongming-memory-v1` 两个实例；memory 包移除 `dsh.bundle.patch` 与自身 patch 文件；测试夹具改为从孔明 patch 读取两份默认配置；两包 README 与失效链接同步修正
- 不做：不改 kongming-os 主仓（profile 的 `dsh.profile.bundles` 列表后续由主仓自行调整）；不合并两个 npm 包；运行期停用记忆插件的既有能力不变

### 不能破坏的不变量

- 记忆插件默认配置（promptTemplate/reminderPrompt）仍只有一份事实来源，且被测试实际读取
- 孔明与记忆的全部既有测试（prompt/recording/optional-memory/main-flow/turn-reminder/memory-tool）通过
- patch 结构通过生产 schema 校验（loadOverlayPatches + Config）

## ② 测试用例

### unit

- memory 夹具 `test/fixtures/config.ts`：从孔明 patch 找到 `@kmh/kongming-memory-v1` 条目并过 Config 校验，找不到即失败 → 合并事实来源不变量
- kongming 夹具 `test/fixtures/config.ts`：同一 patch 中孔明与记忆条目同时存在 → 合并后两个实例登记

### smoke

- `packages/kongming` 全量测试（含 server 夹具按合并后单 patch 启动真实 boot）
- `packages/kongming-memory` 全量测试（默认文案来自孔明 patch）

### e2e（按需）

不需要，依据：bundle 装配发生在主仓 profile 侧（本次不动主仓），插件仓内以真实 boot 夹具覆盖。

## ③ 技术实现

### 实现步骤

1. `packages/kongming/cordis.patch.yml`：追加 `kongming-memory-v1` 条目（含完整默认文案），文件头注释说明同 bundle 提供。
2. `packages/kongming-memory/package.json`：删除 `dsh.bundle.patch` 与 `dsh` 段；format 脚本移除已删除的 patch 文件。
3. 删除 `packages/kongming-memory/cordis.patch.yml`。
4. 夹具改读孔明 patch：memory `test/fixtures/config.ts`、kongming `test/fixtures/config.ts` 与 `server.ts`（两份 patch 合一）。
5. README：memory「接入与记忆文件」「提示词配置」改为同 bundle 表述；kongming「启动与配置」「可选记忆」同步；修正旧布局失效链接（`../kmh-kongming/...`、`../kongming-memory-v1/...`、`packages/kmh-kongming/test`）。

### 涉及文件

- packages/kongming/cordis.patch.yml: 双实例登记
- packages/kongming-memory/package.json: 去 bundle 声明
- packages/kongming-memory/cordis.patch.yml: 删除
- packages/kongming-memory/test/fixtures/config.ts / packages/kongming/test/fixtures/config.ts / server.ts: 读取路径合一
- packages/kongming-memory/README.md / packages/kongming/README.md: 说明与链接

## ④ 验证结果

### 测试输出

`packages/kongming-memory`：`build`/`typecheck`/`lint`/`format:check` 通过；`pnpm test`：

```
ℹ tests 20  ℹ pass 20  ℹ fail 0
```

`packages/kongming`：`build`（host/browser/tools 三套 tsc）/`typecheck`/`lint` 通过；`node --test --test-concurrency=1 test/*.test.ts`：

```
ℹ tests 49  ℹ pass 48  ℹ fail 0  ℹ skipped 1
```

（跳过 1 例为既有 S12 平台条件用例，基线一致；工作区另有一组并行未提交的「侧栏隐藏」改动，与本任务文件零重叠，测试为两者共存状态下通过。）

`format:check` 在 kongming 包报 6 个 `src/**/readme.md` 格式问题——均为 `2c326a9` 提交遗留，非本任务文件，未处理。

### 不变量回归

memory 夹具与 kongming 夹具均从孔明 patch 单一来源读到记忆默认配置并过生产 schema 校验（断言失败即测试失败）；两包全部既有用例通过。

### 结论

- [x] 所有需求点被测试覆盖
- [x] 所有测试真实跑过且通过
- [x] 实现在边界内（未触碰 kongming-os 主仓与并行侧栏改动）
- [x] 不变量未破坏

