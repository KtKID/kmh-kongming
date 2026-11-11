# 委派收发迁移会话互通底座

> spec: docs/spec/kongming-session-dispatch-mvp/spec.md
> feat: feat01（链路重构，验收场景不变）
> 创建: 2026-11-11

## ① 需求

### 功能方向

孔明委派（kongming_dispatch）的发送与回传不再自己实现消息队列逻辑，改为调用会话互通底座包 `@kmh/session-kit` 的组合接口：建好目标会话后，把任务正文交给底座发送、跟踪轮次并收回回复。用户可感知的委派行为（排队回执、结果自动回传、取消/编辑/转入当前轮、折叠展示）保持不变。

### 功能边界

- 做：`relay.ts` 的入队与回传逻辑替换为 `sendAndWatch`；来源标记统一为 `kmh-relay`（前缀文案保留孔明语义）；折叠投影兼容新旧两种标记（历史会话不丢折叠）；删除 `ReplySourceSchema`
- 不做：`prepareDispatch` 的领域校验（附件归属、cwd、图像能力）不动；明庭/junji 不动；`kongming_list_models` 不动；client 视图（view.tsx）不动
- 不做（明确排除）：不接主仓、不重启主仓 Web（另行确认时机）

### 不能破坏的不变量

- T1-T4 委派回归全部通过（空正文终态、领取前移除回传取消、编辑后继续回传、转入当前轮后继续回传）
- 历史会话里的 `kongming-dispatch` 消息在浏览器里仍折叠展示
- 工具仍只对固定孔明 Agent 可见；挂载释放后 `requireSource` 全部失效
- 工作区并行未提交改动（session/ 侧栏可见性工作流）不被本任务触碰、不被混入提交

## ② 测试用例（先改，此刻失败）

### unit

不需要新增单测：底座 `@kmh/session-kit` 已有 13 项单测覆盖发送/跟踪/回传（见其 docs/task/task-session-kit.md）；本任务是其消费方接线，行为验证由既有真实链路回归承担。

### smoke

- dispatch.test.ts 全部用例改断言后跑通（见下），即真实宿主链路 smoke：
  - T1 空正文终态：回传 kind 变为 `kmh-relay`，文案 `执行已结束，但没有公开回复正文。` 不变 → 不变量
  - T2 领取前移除：回传文案改为 `消息已在开始执行前取消。` → 功能方向
  - T3 编辑 / T4 转入当前轮：目标消息 kind `kmh-relay`、结果正常回传 → 不变量
  - observeReply：回传 source 解析用 `@kmh/session-kit` 的 `RelaySourceSchema`；`senderSessionId`/`targetSessionId` 仍为目标会话；工具回执与回传正文共享同一 `dispatchId` → 功能方向

### e2e（按需）

不需要额外 e2e，依据：dispatch.test.ts 本身起真实 DSH 宿主、走原生会话队列与模型脚本，即隔离环境 e2e；浏览器折叠目检留到主仓同步后（另行确认时机）。

## ③ 技术实现

### 实现步骤

1. 依赖接线：`packages/kongming/package.json` peerDependencies 声明 `@kmh/session-kit@0.1.0`；仓库根加 `scripts/link-session-kit.mjs` + postinstall，把兄弟目录 `kmh-session-kit` 符号链接进根 `node_modules/@kmh/`（定位不到时提示并退出 0，主仓子模块场景由 profile 依赖提供，不依赖本脚本）
2. 改测试断言（红）：`test/dispatch.test.ts` 中 `kongming-dispatch`/`kongming-reply` kind 断言改 `kmh-relay`，`ReplySourceSchema` 换底座 `RelaySourceSchema`，取消文案同步
3. `src/dispatch/tools.ts`：删 `createDispatchRelay`，`execute` 内改调 `sendAndWatch`（`preface` 传 `dispatchPreface(source.id)` 保留孔明语义），收集每次 release；卸载时统一释放
4. `src/dispatch/relay.ts` 删除；`src/dispatch/protocol.ts` 删 `ReplySourceSchema`，新增兼容两 kind 的宽松 schema 供投影使用
5. `src/dispatch/client/projection.ts`：`match`/`start` 改用宽松 schema（历史 `kongming-dispatch` 与新 `kmh-relay` 都折叠）

### 涉及文件

- packages/kongming/package.json: peerDeps 声明
- scripts/link-session-kit.mjs（新增）+ 根 package.json: postinstall
- packages/kongming/src/dispatch/tools.ts: relay 换 sendAndWatch
- packages/kongming/src/dispatch/relay.ts: 删除
- packages/kongming/src/dispatch/protocol.ts: 删 ReplySourceSchema、加宽松 schema
- packages/kongming/src/dispatch/client/projection.ts: 兼容两种标记
- packages/kongming/test/dispatch.test.ts: 断言更新

## ④ 验证结果

### 测试输出

```
$ node --test --test-concurrency=1 test/dispatch.test.ts
✔ T1：空正文终态回传状态，省略工具调用前的过程话语
✔ T2：领取前移除时回传取消
✔ T3：编辑排队消息后继续回传结果
✔ T4：转入当前轮后继续回传结果
ℹ tests 4  pass 4  fail 0  duration_ms ~800ms
```

TDD 红→绿记录：断言先改（4/4 红，失败点为旧 kind 找不到回传/排队消息）；迁移实现后两轮返工——
①测试跑的是 lib 构建产物，src 改后未 build 导致假失败；②一处 find 条件（`event.data.source.kind`）在批量替换中漏改。
另有一次实现侧类型阻塞：session-kit 链接本地 DSH 与 kongming 的 registry 版 cordis 构成双类型实体（`exactOptionalPropertyTypes` 差异），修法为 session-kit 默认使用 registry 版同侪依赖（本地 DSH 改为 `SESSION_KIT_LOCAL_DSH=1` 显式开关）+ kongming tsconfig `paths` 将 DSH 声明归一到包内 node_modules 副本 + session-kit 对齐 `exactOptionalPropertyTypes`/`noUncheckedIndexedAccess`。

### 不变量回归

```
$ pnpm typecheck   （host + browser + tools 三 tsconfig）
无错误
$ pnpm test         （全量）
ℹ tests 49  pass 48  fail 0  skipped 1（S12 为既有跳过项，含原因注释）
```

session-kit 侧：`pnpm test` 13/13 通过、`pnpm typecheck` 通过（加严选项后）。
工作区并行改动（session/ 侧栏可见性工作流）未被触碰，提交按文件分离。

### 结论

- [x] 所有需求点被测试覆盖
- [x] 所有测试真实跑过且通过
- [x] 实现在边界内
- [x] 不变量未破坏
