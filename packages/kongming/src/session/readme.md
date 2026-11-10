# session/ 固定会话（宿主侧）

> 草稿，待用户检查。模块总览、设计理念与使用方式见 [../readme.md](../readme.md)。

这一目录负责孔明的核心承诺：**让每个 home 永远对应同一个原生会话**。六个文件配合：[runtime.ts](runtime.ts) 是总指挥；[binding-store.ts](binding-store.ts) 管身份文件；[prompt.ts](prompt.ts) 装提示词；[control.ts](control.ts) 提供停止/继续/补充；[protocol.ts](protocol.ts) 和 [web.ts](web.ts) 把能力暴露成 HTTP 接口。调用链：浏览器入口（[client/readme.md](client/readme.md)）→ `/api/kmh-kongming/ensure`（`web.ts`）→ `runtime.ensure()` → `binding-store` 读取身份 + `prompt.ts`/`control.ts`/委派工具（[../dispatch/](../dispatch/readme.md)）挂到 Agent。

本目录没有找到独立 spec，现行契约以[包 README](../../README.md) 为准（见 [../readme.md](../readme.md) 待确认第 1 条）。

### [runtime.ts](runtime.ts) — 固定会话运行时

**功能**：`KongmingRuntime` 类，插件的核心。对内管理身份、Agent 绑定和生命周期，对外就是 `ctx.kongming` 服务。

**实现原理**：构造时订阅三类事件——`agent/created`（新 Agent 的 ID 等于固定身份时立即绑定能力）、`agent/disposed`（释放该 Agent 的所有挂载并等外部扩展清理）、`kongming/visit-agents`（让后启用的扩展访问当前 Agent）；再注册一个 effect 保证插件卸载时收敛。`ensure()` 把并发的准备请求合并成同一次操作，失败后允许重试。`ensureOnce()` 的完整流程：校验项目目录 → 读或预留身份 → 核对身份里的工作目录与当前配置一致 → 首次（`reserved` 阶段）调用 Session Controller 创建会话 → 解析出 Agent → 绑定能力 → 等会话落盘 → 创建工作区并关联会话 → 首次场景下提交身份文件。

**设计取舍**：并发合并 ensures 多次点击只做一次事；`closed` 标志先置位再慢慢收尾，保证停用后新请求立即被拒而旧工作还能等完；卸载时先取消执行（保留待处理输入）、等空闲、保存会话，再释放绑定——宁可卸载慢一点也不丢已排队的消息。这些时序安排是从代码行为归纳的，未找到单独的设计记录（待确认）。

#### 关键函数

| 函数及源码链接 | 负责什么 | 主要输入和结果 | 关键处理或限制 |
| --- | --- | --- | --- |
| [`restoreExisting`](runtime.ts#L60) | 启动恢复 | 无输入；读到旧身份且对应 Agent 已加载时直接绑定 | 身份不存在或插件已停用时静默返回 |
| [`ensure`](runtime.ts#L73) | 准备固定会话 | 无输入；返回 `{sessionId, cwd}` | 已停用直接拒绝；进行中的准备共用同一 Promise；失败的准备会清空缓存允许重试 |
| [`bindAgent`](runtime.ts#L128) | 给 Agent 接上全部孔明能力 | 收到 Agent；挂控制器、提示词、委派工具并广播就绪事件 | 同一 Agent 只挂一次；换 Agent 时重建控制器 |
| [`releaseAgent`](runtime.ts#L151) | 释放单个 Agent | 注销提示词与工具、释放控制器，再串行等外部扩展清理 | 每步幂等，重复调用安全 |
| [`close`](runtime.ts#L164) | 停用收敛 | 等恢复和准备结束，取消执行、保存会话、释放全部绑定 | 取消时 `keepInbox: true`，待处理消息留给 Agent 队列 |
| [`control` (getter)](runtime.ts#L144) | 取控制器 | 返回当前绑定的 `KongmingControl` | 未准备或已停用时明确抛错 |

### [binding-store.ts](binding-store.ts) — 身份文件

**功能**：读写 `$home/.kongming/state.json`，内容是 `{version, phase, sessionId, cwd, agentPreset?}`，zod schema 严格校验。

**实现原理**：`loadOrReserve()` 先建目录（权限 `0o700`）；已有身份直接读；没有就生成 UUID、把 `phase: "reserved"` 的身份写进独占临时文件（`wx` 标志保证不覆盖），再硬链接到正式文件名——并发场景下 `EEXIST` 说明别人赢了，回头读正式文件即可。`commit()` 在会话创建并保存成功后，用"写临时文件 + rename"原子替换正式文件为 `phase: "ready"`。读取或校验失败时，错误信息带完整文件路径供修复。

**设计取舍**：三步走（预留 → 建会话 → 提交）保证任何一步崩溃后，下次启动都能从身份文件推断该做什么：`reserved` 就重新创建，`ready` 就直接恢复。独占写 + 硬链接是文件系统级的原子预留，不需要额外的锁文件；代价是目录里偶尔短暂出现 `.state-*.tmp`（`finally` 里会清理）。多进程并发的防御姿态是从代码推导的判断（待确认）。

#### 关键函数

| 函数及源码链接 | 负责什么 | 主要输入和结果 | 关键处理或限制 |
| --- | --- | --- | --- |
| [`readExisting`](binding-store.ts#L35) | 启动时读身份 | 无输入；返回身份或 `undefined` | 文件不存在视为首次启动；损坏或 I/O 故障直接抛错 |
| [`loadOrReserve`](binding-store.ts#L44) | 取得或创建身份 | 收到项目目录；返回已有或新预留的身份 | 并发预留只胜出一个；返回前总会重读正式文件 |
| [`commit`](binding-store.ts#L74) | 原子发布就绪身份 | 收到绑定；rename 完成替换 | 校验失败或写失败时原身份文件保留不动 |

### [prompt.ts](prompt.ts) — 提示词装配

**功能**：把两项配置原文装进孔明 Agent 的系统提示词。

**实现原理**：`mountPrompt(agent, config)` 在 Agent 作用域注册两个段落：人格段挂到 DSH 的 `DEPLOYMENT_PERSONA_PREFIX` 顺序位，指令段挂到 `DEPLOYMENT_PERSONA_SUFFIX` 顺序位，`interpolate: false` 表示花括号按字面量保留。返回一个幂等清理函数，重复调用安全。

**设计取舍**：用 DSH 的系统提示词分段机制而不是整段替换，孔明和宿主其他提示词贡献可以共存；挂在 Agent 自己的 `ctx` 上，普通会话继续用各自的提示词（[../../test/prompt.test.ts](../../test/prompt.test.ts) 覆盖此隔离）。

#### 关键函数

| 函数及源码链接 | 负责什么 | 主要输入和结果 | 关键处理或限制 |
| --- | --- | --- | --- |
| [`mountPrompt`](prompt.ts#L6) | 装配提示词段落 | Agent + 配置；返回幂等清理函数 | 清理按注册逆序执行，重复调用安全 |

### [control.ts](control.ts) — 停止、继续与补充

**功能**：`KongmingControl` 类，每个绑定的 Agent 一份，实现 control 接口的四个动作。

**实现原理**：构造时回看会话最近的 `turn/start`/`turn/end` 事件——如果上一轮是"用户主动中止"结束，就把 `paused` 置真，恢复"停止后"的状态。`prompt()` 在未暂停时直接走 Session Controller 的原生 prompt；暂停时自己按 `rpcId`（请求身份号）去重——已写入历史或还在待执行队列里的同一请求直接沿用回执，否则用 `agent.send()` 把消息排进"下一轮"或"下一步"队列（`steer` 模式插当前轮）。`cancel()` 调原生取消并置 `paused`。`resume()` 从队尾取一条待处理消息，原身份重新发送来唤醒队列。`supplement()` 用 `agent.inject()` 把用户文本递给最近的后续步骤。每个动作前都 `assertActive()` 确认控制器还绑着宿主当前持有的同一 Agent。

**设计取舍**：暂停语义由插件自管（`paused` 标志 + 队列保留在 Agent 手里），"停止"不清空输入、"继续"按原顺序唤醒——与原生"取消即丢上下文"的行为区分开；去重靠 `rpcId` 保证同一请求只接纳一次。这套暂停/去重语义的原始设计讨论未找到记录（待确认）。行为回归见 [../../test/control.test.ts](../../test/control.test.ts)。

#### 关键函数

| 函数及源码链接 | 负责什么 | 主要输入和结果 | 关键处理或限制 |
| --- | --- | --- | --- |
| [`prompt`](control.ts#L41) | 接纳文本 | 文本、模式（`queue`/`steer`）、请求 ID、取消信号；返回 `{accepted: true}` | 暂停期间按 `rpcId` 去重后入队；控制器释放后拒绝 |
| [`cancel`](control.ts#L97) | 停止当前执行 | 无输入；原生取消并记暂停 | 待处理输入保留在 Agent 队列 |
| [`resume`](control.ts#L107) | 继续队列 | 无输入；取队尾消息原身份重发 | 未暂停且在运行时是幂等空操作；空队列保持空闲 |
| [`supplement`](control.ts#L125) | 补充本轮 | 文本经非空白校验后 `inject` | 空闲时保留输入等待后续唤醒 |

### [protocol.ts](protocol.ts) — 固定会话接口校验

**功能**：zod schema 集中定义 ensure / control 两个接口的请求与响应边界：准备请求只接受空对象；控制请求是按 `action` 区分的联合类型（`prompt` 要求非空白文本、`mode` 默认 `queue`、必填 `requestId`；`stop`/`resume` 无额外字段；`supplement` 只要文本）；成功响应 `{accepted: true}`，失败响应带 `KONGMING_PREPARE_FAILED` 或 `KONGMING_CONTROL_FAILED` 错误码和 `retryable`。

**设计取舍**：schema 同时供 [web.ts](web.ts)（服务端校验）和浏览器入口（[client/entry.ts](client/entry.ts) 解析响应）引用，两端共用同一份边界定义，避免各写一套漂移。

### [web.ts](web.ts) — HTTP 路由

**功能**：`mountWeb(ctx, runtime)` 注册两个已鉴权 POST 路由，把 HTTP 请求翻译成运行时调用。

**实现原理**：control 路由先校验请求、调 `runtime.ensure()`（控制隐含准备），再按 `action` 分发给控制器；ensure 路由校验空对象请求体后直接返回准备结果。两边的失败统一转成 HTTP 400 + 错误码 + 可读原因，响应都带 `Cache-Control: no-store`（这类状态响应不该被缓存）。鉴权沿用宿主连接服务，插件不自建鉴权。

**设计取舍**：所有异常都兜成 400 而不是 500，调用方拿到的永远是可解析的结构化失败；`retryable` 恒为 true——失败后核对状态再试一次总是安全的。

#### 关键函数

| 函数及源码链接 | 负责什么 | 主要输入和结果 | 关键处理或限制 |
| --- | --- | --- | --- |
| [`mountWeb`](web.ts#L14) | 挂载两个路由 | 收到上下文和运行时，无返回 | 请求中途取消（`signal` 中止）也走失败响应 |
