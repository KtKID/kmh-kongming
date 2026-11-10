# dispatch/ 跨会话委派（宿主侧）

> 草稿，待用户检查。模块总览、设计理念与使用方式见 [../readme.md](../readme.md)。

这一目录让孔明把任务交给另一个模型会话执行，再把结果收回来：用户对孔明说"让 glm-5.3-flash 查询杭州天气预报"，孔明调用这里的工具新建一个普通会话、选定模型、把任务排进 DSH 原生队列；目标轮次结束后，结果自动排回孔明会话。五个文件配合：[tools.ts](tools.ts) 对模型暴露两个工具；[submit.ts](submit.ts) 校验并准备目标会话；[content.ts](content.ts) 校验任务正文和附件归属；[relay.ts](relay.ts) 入队并跟踪回传；[protocol.ts](protocol.ts) 定义委派消息的来源标记（宿主和浏览器共用）。工具由 [../session/runtime.ts](../session/runtime.ts) 的 `bindAgent` 挂到孔明 Agent；浏览器侧的折叠展示见 [client/readme.md](client/readme.md)。设计依据是[技术设计 · 模块与数据归属](../../../../docs/spec/kongming-session-dispatch-mvp/tech-design.md#模块与数据归属)。

### [tools.ts](tools.ts) — 委派工具注册

**功能**：`mountDispatch(ctx, source)` 在孔明 Agent 的工具作用域注册 `kongming_list_models` 和 `kongming_dispatch`，返回统一释放入口（先标记失效、注销工具、再清 relay 监听）。

**实现原理**：`requireSource()` 在每个执行点双重校验——调用者确实是孔明 Agent 且挂载仍有效、请求未取消；跨过异步步骤后还会再校验一次。`kongming_list_models` 读宿主模型目录，按服务商分组返回精确的 provider/model ID。`kongming_dispatch` 收 provider、model、content、可选 cwd，交给 `prepareDispatch` 准备目标会话，再由 `relay.enqueue` 排队，返回 `{dispatchId, sessionId, provider, model, status: "queued"}`——只表示排队成功。工具描述里明确写了"结果会自动到达，等待回传，不要轮询或重复委派"。

**设计取舍**：工具注册在 `source.ctx`（Agent 作用域）而非全局，普通会话看不到这两个工具（对应技术设计 D1）；排队回执与执行结果分离，防止模型把"已排队"当成"已完成"。

#### 关键函数

| 函数及源码链接 | 负责什么 | 主要输入和结果 | 关键处理或限制 |
| --- | --- | --- | --- |
| [`mountDispatch`](tools.ts#L22) | 挂载委派工具 | 收到上下文和源 Agent；返回释放入口 | 释放后 `requireSource` 全部失效 |
| [`requireSource`](tools.ts#L29) | 执行点守卫 | 校验 Agent 身份、挂载有效性与取消信号 | 不满足时抛"委派入口已释放" |

### [submit.ts](submit.ts) — 目标会话准备

**功能**：`prepareDispatch()` 把一次委派请求变成"选好模型、校验完毕的目标 Agent + 已入库的待发内容"。

**实现原理**：依次做——[content.ts](content.ts) 校验正文 → 在模型目录里精确匹配 provider/model（不匹配时优先带上该服务商加载目录的失败原因）→ `llm.resolveCallConfig` 验证路由可用，含图片时再查模型的图像输入能力 → 解析工作目录（优先级：显式 `cwd` → 孔明会话当前工作目录 → 会话头部记录的目录）并校验可访问 → 附件入库（`admitPromptContent`）→ 创建工作区和普通会话 → 解析目标 Agent 并 `model.select()` 选定模型。每个异步步骤后都重新 `requireSource()`。

**设计取舍**：把所有校验放在创建会话之前，避免留下"会话建了但任务发不出去"的半成品；模型选择用 Agent 公开的 `model.select()` 而不是 SessionController 的 `selectModel()`——后者会顺手改全局默认模型，影响别的会话（依据[技术设计 · 代码依据与复用边界](../../../../docs/spec/kongming-session-dispatch-mvp/tech-design.md#代码依据与复用边界)）。

#### 关键函数

| 函数及源码链接 | 负责什么 | 主要输入和结果 | 关键处理或限制 |
| --- | --- | --- | --- |
| [`prepareDispatch`](submit.ts#L18) | 校验并准备目标 | 委派参数 + 取消信号 + 守卫回调；返回 `{sessionId, target, admitted}` | 模型不可用、目录无效、附件不属于孔明会话都会在创建会话前失败 |

### [content.ts](content.ts) — 正文与附件校验

**功能**：`parseDispatchContent()` 校验工具入参的内容块，产出可直接交给附件入库服务的部件。

**实现原理**：schema 接受三类块——文本、带 base64 数据的新图片、孔明会话里已入库的图片/文件引用（按 `attachmentId`）；要求至少一个非空白文本或附件。遇到引用时，扫描孔明会话已记录的用户消息历史，按"类型 + 附件 ID 都匹配"找回完整的原生附件记录（含字节），找不到就报"附件不属于孔明会话中的已入库附件"。产出按原顺序保留所有块。

**设计取舍**：引用必须回源会话历史验证归属，防止把别的会话的附件 ID 混进来；新图片和引用两条路都收，模型不需要区分底层差异。

#### 关键函数

| 函数及源码链接 | 负责什么 | 主要输入和结果 | 关键处理或限制 |
| --- | --- | --- | --- |
| [`parseDispatchContent`](content.ts#L42) | 校验正文与附件 | 源 Agent + 工具入参；返回按原顺序的入库部件 | 引用找不到归属时抛错，错误带附件 ID |

### [relay.ts](relay.ts) — 入队与回传

**功能**：`createDispatchRelay()` 为一个源 Agent 建立委派中转站：`enqueue()` 把任务排进目标会话并开始跟踪，目标轮次结束后把结果回传给孔明，一次为限。

**实现原理**：`enqueue` 生成 `dispatchId`，构造一条消息——第一块是来源说明文本"来自孔明会话 \<id\> 的委派。"，后面接原始内容块；消息来源带上 `kongming-dispatch` 标记。然后注册四个监听：目标**领取**消息时记下实际执行轮次；消息被**移出队列**时用微任务等队列操作尘埃落定——同 ID 消息已不在任何队列且从未被领取，才算真取消，回传"委派已在开始执行前取消"；**会话事件**里持续缓存该轮次最后一条助手消息的公开正文（只留文本、图片、文件），轮次结束时回传——正常完成带正文，中断/失败/空正文则带对应的终态说明；目标 Agent **提前销毁**时回传"执行会话已关闭"。`deliver()` 用 `pending` 集合做一次性守卫，先释放监听再回传；回传前检查源会话还活着，用 `followup` 把结果（`kongming-reply` 来源）排进孔明的原生队列。`dispose()` 在插件卸载时清掉全部待回传记录。

**设计取舍**：按"实际领取的轮次"而不是"发送时间"关联结果，用户后来在目标会话里的直接聊天不会被误收；取消判断放进微任务并复查队列，是为了把"编辑排队消息""转入当前轮"这类保留原 ID 的操作和真正的移除区分开（对应 [feat01 场景3](../../../../docs/spec/kongming-session-dispatch-mvp/spec.md#场景3-排队中的委派被移除)及[排队取消任务](../../../../docs/spec/kongming-session-dispatch-mvp/tasks/task-dispatch-queue-cancellation.md)；该任务记录写于目录重构前，文中 `src/dispatch.ts` 的逻辑现已拆分到本文件）。回传关联表只在内存里，进程重启即失效——MVP 明确接受此限制。行为回归见 [../test/dispatch.test.ts](../../test/dispatch.test.ts)。

#### 关键函数

| 函数及源码链接 | 负责什么 | 主要输入和结果 | 关键处理或限制 |
| --- | --- | --- | --- |
| [`createDispatchRelay`](relay.ts#L22) | 建中转站 | 收到上下文、源 Agent、源有效性回调；返回 `{enqueue, dispose}` | 源失效后回传静默跳过（记警告） |
| [`enqueue`](relay.ts#L30) | 排队并跟踪一次委派 | 目标 Agent + 内容块；返回 `dispatchId` | 入队失败立即注销监听并抛错 |
| [`deliver`](relay.ts#L114) | 一次性回传 | 失败说明（或 undefined 表示带正文）；向源会话 followup 一条结果消息 | 重复终态、已释放、源失效都不回传 |

### [protocol.ts](protocol.ts) — 委派消息来源

**功能**：定义两种跨会话消息来源的 zod schema（`kongming-dispatch` 委出、`kongming-reply` 回传，都带 `form: "relay"`、发送者/目标会话 ID 和 `dispatchId`），通过 `MessageSourceMap` 模块声明合并进 DSH 的消息类型；`dispatchPreface()` 生成给目标模型看的来源前缀文本。

**设计取舍**：来源信息持久化在原生会话日志里，浏览器刷新后仍能凭它重建折叠视图（对应技术设计 D2、D3）；模型可见的来源说明用普通文本块，机器可读的元数据放 source 字段，两者各司其职。

## spec 索引

本目录对应的 spec（总索引见 [../readme.md](../readme.md)）：

| Spec 章节 | 定义了什么 | 与本目录的关系及依据 |
| --- | --- | --- |
| [feat01 场景1 新建指定模型会话完成查询](../../../../docs/spec/kongming-session-dispatch-mvp/spec.md#feat01-孔明委派天气查询并收回回复) | 指定模型、沿用孔明工作目录、完整正文与来源说明、结果自动回传 | [tools.ts](tools.ts) + [submit.ts](submit.ts) + [relay.ts](relay.ts) 全链路实现 |
| [feat01 场景2 指定模型不可用时明确呈现委派受阻](../../../../docs/spec/kongming-session-dispatch-mvp/spec.md#feat01-孔明委派天气查询并收回回复) | 模型不可用时报具体原因，不误判成功 | [submit.ts](submit.ts) 创建会话前的目录精确匹配与失败原因回传 |
| [feat01 场景3 排队中的委派被移除](../../../../docs/spec/kongming-session-dispatch-mvp/spec.md#场景3-排队中的委派被移除) | 移除排队委派回传取消；编辑/转入当前轮继续执行 | [relay.ts](relay.ts) 的 `agent/inbox/discarded` 监听与微任务复查；依据[排队取消任务](../../../../docs/spec/kongming-session-dispatch-mvp/tasks/task-dispatch-queue-cancellation.md)（写于目录重构前，其 `src/dispatch.ts` 即现 [relay.ts](relay.ts)） |
| [技术设计 D1、D2 与执行链路](../../../../docs/spec/kongming-session-dispatch-mvp/tech-design.md#执行链路与失败处理) | 工具挂孔明作用域、原生队列 + 持久化来源 + 按轮次一次回传 | 本目录全部五个文件；依据同文件[模块与数据归属](../../../../docs/spec/kongming-session-dispatch-mvp/tech-design.md#模块与数据归属)逐文件点名 |
| [委派架构时序图](../../../../docs/architecture/kongming-dispatch.html) | 委派全链路的可视化时序 | 参考材料，与 relay/submit 的实际链路一致 |
