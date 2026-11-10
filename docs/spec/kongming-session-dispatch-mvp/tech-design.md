# 孔明会话委派 MVP · 技术设计

日期：2026-11-10。需求：[spec.md](./spec.md)。设计状态：依据用户本轮“写好 tech design、拆 req、派 6.1 Sol 开发、启动 60000 真实验收”的明确授权直接进入实施。本文中的接口名称是本次设计决策；真实测试结果写入测试报告，不能由设计代替。

## 设计决策

| 编号 | 决策 | 需求依据 |
|---|---|---|
| D1 | 在孔明 Agent 作用域提供模型目录工具和创建并发送工具；普通 DSH 会话执行工作，使用既有 provider。 | C1、C3；feat01 场景1、2 |
| D2 | 统一调用 Agent 的原生 followup 队列；发送与回传均携带可持久化的来源信息，按实际消费请求的 turn 关联回复。 | C2、C4、C6 |
| D3 | 使用公开 Conversation 扩展点，把孔明请求及该 turn 的 Bot 输出合为一个默认折叠节点；展开复用原生消息组件。 | C4、C5；feat02 全部场景 |
| D4 | 先在 kmh-web 的 60000 端口完成真实天气委派和直接聊天，保存原生会话 JSONL，再以这些事实编写 mock/replay 回归。 | 用户本轮测试顺序要求 |

第一版包含一次创建并发送和一次自动回传。指定已有 session 的多轮续聊、长期订阅及重启补收、笔记、独立权限与思考等级面板留在后续范围。已有孔明固定会话、暂停/继续和记忆插件继续使用原有流程。

## 代码依据与复用边界

基线：孔明仓 `1af3bb0072c6f8bce0c5016c72e71d88e2e0b009`；部署宿主 `/Volumes/machub_app/proj/kongming-os`；DSH 源码位于该仓 `third_party/dsh`，提交为 `ce7073d51254c26cd63b22a60835b8f948deb447`，本次使用 `0.2.2-alpha.2` 系列公开包。

| 能力 | 现有实现 | 本次接入方式 |
|---|---|---|
| 创建与恢复普通会话 | DSH `packages/api/session-controller/src`：`create`、`resolveAgent`；孔明 `src/session/runtime.ts` 已使用 | 同一宿主创建普通 Session；复用 workspaceRegistry 的目录与会话关联 |
| 已有模型列表 | SessionController `modelCatalog()` | 返回原目录的 provider/model ID；执行前校验准确匹配 |
| 单会话模型选择 | Agent `model.select()`；SessionController `selectModel()` 还会保存全局默认模型 | 选用 Agent 公共方法，并通过 LLM 服务校验路由，限定在新会话 |
| 排队与唤醒 | Agent `followup(createUserMessage(...))` | 统一 send 内部路径；交给 DSH 消费队列、执行 AgentLoop |
| 消息正文与附件 | `dsh-llm` 原生消息、`dsh-attachment` admission、上传收据服务 | 复用内容类型和入库过程，来源说明单独加文本块，原始内容块保持顺序与内容 |
| 来源 | `MessageSourceMap` 扩展及 `form: relay` | 插件定义 Kongming 来源，持久化在原生 user/message 中 |
| 回传触发 | Host `session/event`，`user/message`、`assistant/message`、`turn/end` | 监听当前派发的目标，依据消息来源和 turn 收集对应最终回复 |
| 会话展示 | `uiConversation.events.register`、`conversation.chat.node` slot | 插件贡献折叠节点；普通用户 turn 走原生节点 |
| 原生渲染参考 | `packages/kmh-team/src/client/chat.tsx`、`messages.ts` | 从宿主 slot 复用 user/assistant renderer，保留 Markdown、图片、工具呈现 |
| 回放测试参考 | DSH `apps/web/tests/subagent-conversation.e2e.ts`、`packages/test-support/session-snapshot` | 保存真实 JSONL，提取实际消费消息、来源和输出作为后续回归数据 |

重要区别：SessionController 的公开 `prompt` 固定写入 `kind: user`。插件在已经解析到的 Agent 上调用公开 `followup`，保留孔明来源，同时使用相同原生队列。禁止依赖 DSH 私有 `/src` 模块；宿主第三方源码保持原样。

## 模块与数据归属

- `src/dispatch/tools.ts` 注册工具并管理挂载，`content.ts` 校验正文与附件归属，`submit.ts` 校验模型和目录并准备目标会话，`relay.ts` 负责入队、回传与监听清理。
- `src/dispatch/protocol.ts` 定义消息来源和委派前缀，由宿主和浏览器共同引用。
- `src/session/runtime.ts` / `src/index.ts`：在孔明 Agent 已就绪时挂载工具，随其作用域释放；完成宿主依赖声明。
- `src/dispatch/client/projection.ts` 将原生事件转为聊天节点，`view.tsx` 注册折叠视图并复用原生正文组件。文案由 `src/client/locales.ts` 提供。
- `test/dispatch*.test.ts` 与 `test/fixtures/dispatch/`：真实路径取证后的定向回归。

Session、消息、模型选择、cwd、队列、工具执行、附件及事件日志均由 DSH 持有。孔明持有当前进程里“此次派发待回传”的小型关联表，字段仅为源 Session、目标 Session、派发 ID、实际 turn、终态发送标志。会话日志中的来源支持刷新后的界面重建。首次 MVP 的进程重启结束本轮内存监听；重启补收独立排期。

## 工具与数据契约

工具仅挂到孔明固定 Agent，目标普通会话保留自身工具集合。工具描述说明创建之后将异步收到结果，避免孔明重复轮询或提前把已排队说成已完成。

### `kongming_list_models`

无业务参数。返回现有 modelCatalog 的 provider 分组和可用模型 ID/名称。工具保留目录中的准确 ID，模型别名不做猜测。

### `kongming_dispatch`

| 字段 | 类型 / 规则 | 用途 |
|---|---|---|
| `provider` | 必填 string，现有目录中的精确 ID | 选择已接入 provider |
| `model` | 必填 string，该 provider 下的精确 ID | 本次真实用例为 `glm-5.3-flash` |
| `content` | 必填非空原生内容块数组；text/image/file 沿用当前 DSH 入参或已入库引用的合法边界 | 任务正文；此次 smoke 使用 text |
| `cwd` | 可选 string，省略取孔明当前工作目录 | 创建目标工作区 |

执行前依据 DSH 原生内容校验与 admission 处理；文件收据属于其上传会话，跨会话复用必须先通过已有附件接口得到合法持久引用。实现若遇到当前公共接口的内容类型边界，显式返回该类型的失败原因并记录限制，保留原文与附件；第一版天气 smoke 的验收范围限定文本。工具执行返回 `{dispatchId, sessionId, provider, model, status: "queued"}`，仅表示排队成功。不可用模型返回明确工具错误，创建前完成目录校验；排队后执行失败则通过回传报告实际错误。

### 消息来源（唯一声明在 src/dispatch/protocol.ts）

| 字段 | 类型 / 规则 | 用途 |
|---|---|---|
| `kind` | `kongming-dispatch` 或 `kongming-reply` | 请求与回传方向 |
| `form` | `relay` | 复用跨会话消息语义 |
| `senderSessionId` | 原生 SessionId | 真实发送者 |
| `dispatchId` | 本次派发生成的唯一 string | 关联请求及回传 |
| `targetSessionId` | 原生 SessionId | 本次执行 Session |

发送内容在原块前增加简短来源块“来自孔明会话 <id> 的委派”，后续块保持原样。回传含目标 session ID、对应结果/失败说明；来源使用 `kongming-reply`。工具结果和前端同时保留 target ID，方便定位真实会话。模型可见输入通过额外来源块提供身份；纯 source 元数据负责日志与 UI 识别。

## 执行链路与失败处理

1. 用户向孔明发要求；孔明通过已有目录查询取得 provider/model。
2. 派发工具校验内容、目录及模型路由，解析父 cwd；创建普通会话，关联工作区，选择该 Agent 模型。
3. 先注册本次回传关联，再通过唯一 send 路径入原生 followup 队列。会话进入既有列表，工具返回 queued。
4. 以原生 `agent/inbox/claimed` 事件中的 message ID 记录实际 turn，覆盖模型调用前即失败的情况；后续 assistant 事件归属于此 turn，原生工具执行、审批与搜索行为保持宿主设置。
5. 对应 turn 终结后，收集该 turn 的最终公开回复，向父 Agent followup 一次。中断、模型错误和无正文终结都回传实际状态，不生成天气内容。
6. 父 Agent 空闲时原生队列自动启动，忙碌时排队，向用户汇总查询结果；完成后释放本次跟踪。

监听必须按目标 ID、来源和 turn 同时关联；目标会话中用户随后发送的普通消息使用其自己的 turn。终态重复到达只允许一次回传，卸载清理监听。发送失败应移除待回传记录并保留真实错误；已经创建的会话继续由 DSH 管理。插件自身不实现超时调度器、持久队列或额外通信协议。

## 界面行为

在目标会话中，来源为 `kongming-dispatch` 的请求和同一 turn 的对应 Bot 回复展示为一个原生 Conversation 自定义节点，默认折叠，摘要显示“孔明 · 会话往来”及进行中/完成状态。展开可以看到完整请求、Bot 回复和原有工具呈现；原生格式及附件组件继续负责内容。

实际实现通过 Conversation 事件节点的 exclusive 匹配接管委派请求，注册 `kongming-dispatch` chat 节点。原生 ChatNodeSeat/ChatGroupSeat 在 flow 的直接子节点上提供 `data-chat-turn`；插件的 `<details>` 通过当前 flow 范围内的 CSS 随开关显示或隐藏同 turn 的原生回复与工具组。正文继续由原生 user/assistant/tool renderer 渲染，原生 Chat Group Registry 保持原样。用户 `kind: user` 的请求与回复继续走原有渲染。刷新页面从已持久化事件重建折叠记录，不依赖组件内存保存来源。此实现依赖当前 DSH 版本的 DOM 属性，后续升级须重新执行 T1/T2/T4。

首版 content 接收原生 text、带编码数据的新 image、孔明历史消息中已有的 image/file attachmentId。已入库附件从原消息取回完整原生引用，经过 `attachments.admitPromptContent` 发送。新会话的上传收据需要先由原生上传流程入库，工具当前接受持久附件引用；真实附件专项验证留在后续范围。附件所有权校验失败时明确报告错误。

## 测试设计

所有新回归数据在真实首轮链路后建立。开发前可以运行已有检查与类型构建；用户明确授权的真实优先顺序覆盖通常的新增自动化先红后绿顺序。每次执行记录命令、时间、输入、观察结果、会话 ID 和 evidence 路径；用例状态初始为待执行。

| 用例 | 层级 / 场景约束 | 为什么测 / 数据准备 | 执行与观察点 | 初始状态 |
|---|---|---|---|---|
| T1 | 真实 Web smoke；feat01 场景1，feat02 场景1；C1–C6，D1–D4 | 唯一主链路完成证据；60000 kmh-web、真实已有模型目录、独立测试目录，天气指定杭州与当天日期 | 从孔明 UI 发“让 glm-5.3-flash 查询杭州天气预报”；核对实际模型、普通新 session、继承 cwd、原始正文和来源、真实查询工具/来源、目标回复、孔明自动收到并回复；打开目标截图折叠及展开，刷新再观察；保存两边原生 JSONL | 待执行 |
| T2 | 真实 Web smoke；feat02 场景2；C5 | 同一目标会话，上一用例已完成 | 用户直接发简短追问，等待真实 Bot 回复；两者正常展开、显示用户来源，孔明往来维持独立折叠；截图及日志 | 待执行 |
| T3 | 回归集成；feat01 场景2；C1，D1 | T1 后用宿主 testkit 构造不存在模型、选中模型执行报错 | 无路由时明确受阻且无成功结果；模型执行失败回传错误；父默认模型保持原值 | 待执行 |
| T4 | 事件回放 / UI；feat02 全场景；C4、C5，D3 | 从 T1/T2 的 JSONL 提取脱敏会话片段，沿用原生 assembler 与 renderer | 请求和对应回复同折叠，直接用户 turn 正常；重放/刷新一致；实际正文无缺失或重复 | 待执行 |
| T5 | 原生 AgentLoop 集成；feat01 场景1；C2、C4、C6，D2 | 真实链路后的定向 mockAdapter，使用原生队列、session 事件 | 父忙时结果排队、父闲时唤醒；只回传目标对应 turn，终态重复/释放后无重复；原始内容块顺序保留，发送失败清理关联 | 待执行 |
| T6 | 构建与既有回归；feat01、feat02；D1–D3 | 当前源仓及部署目录，已有 fixture | 源插件 typecheck/lint/build、相关原测试；记录既有失败与本次新增失败；60000 部署加载实际新 bundle，第三方 DSH 零修改 | 待执行 |

真实查询证据必须能关联实际 provider、模型、搜索/天气查询及可核对的天气来源。若模型登录、额度、网络或当前 provider 阻止查询，记录受阻原因和已跑到的阶段，保持 T1 待完成；mock 只能覆盖修复回归，不能代替 T1。天气回复中的事实由执行模型查询，验收人员核对其查询记录与引用。

## 启动、部署与产物

测试使用 `/Volumes/machub_app/proj/kongming-os/profiles/kmh-web` 既有 profile，经 `scripts/kmh.mjs web --no-open` 启动，监听 60000；开始先检查端口。以独立 `KMH_HOME` 和 `KMH_KONGMING_PROJECT_DIR` 放置测试会话和项目，provider 复用已有登录能力，密钥及登录令牌保持私有。若隔离 home 影响认证，只复制/配置必要引用并隐藏凭据，不在证据中输出秘密。

源仓为 `/Volumes/machub_app/proj/kmh-plugin/kmh-kongming`，部署副本为宿主 `packages/kmh-plugin/kmh-kongming`。同步前检查两边 Git 状态，仅同步本次变更，构建插件，真实浏览器核对加载。宿主现有无关改动保持原样；60000 原占用时先识别归属，停止动作仅作用于本次启动的测试实例。

主验收报告：`reports/kongming-session-dispatch-mvp/20261110-01/test-report.md`，同目录保存 execution.log、screens、sessions；报告链接各用例证据、实际命令和变更行覆盖/缺口。文档清单引用该报告，报告实时区分真实、mock、未执行和环境受阻。收尾生成同批次 `sleep-report.md`，记载本地交付状态和剩余事项。

## 本轮执行状态

6.1 Sol 已完成首版并通过构建、类型、Lint、格式、冻结锁文件检查；既有回归 44 项通过、1 项原有跳过。源代码与部署副本的 13 个关键文件 SHA-256 一致，kmh-web 已在 60000 启动。真实浏览器访问被工具保存的权限策略阻止；用户两次确认允许/已解除后重试仍返回该策略拒绝。T1/T2 保持受阻；T3/T4/T5 按用户“真实数据先于新增 mock”要求留待真实运行之后执行。本轮完成状态以主报告为准。
