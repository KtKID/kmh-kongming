# 孔明插件源码（packages/kongming/src）

> 草稿，待用户检查。

## 功能描述

这批源码是「孔明」插件的本体：在 Web 侧栏提供一个固定入口，打开一个永不换身份的原生聊天助手（每个数据目录保存一个助手身份，重启后接着聊），并让这个助手能把任务委派给新建的普通模型会话、等结果自动回来后替用户总结。代码分成两半：**宿主半**（跑在服务端，管身份、会话、HTTP 接口和委派工具）和**浏览器半**（管侧栏入口、准备面板和委派消息的折叠展示）。

安装、部署和配置的完整说明见[包 README](../README.md)；本文覆盖 src 根目录的代码，各子目录有自己的 readme（见[代码说明](#代码说明)的导读表）。

## 设计理念

- **复用 DSH 原生能力，插件只补"固定"和"中转"两件事。** 会话创建、消息排队、模型选择、附件入库、聊天界面全部走宿主（DSH，孔明所依赖的底座）已有的公开服务，插件不另造队列或协议。好处是行为和普通会话一致、升级负担小；代价是功能边界受公开接口限制（[技术设计 · 代码依据与复用边界](../../../docs/spec/kongming-session-dispatch-mvp/tech-design.md#代码依据与复用边界)明确禁止依赖 DSH 私有模块）。
- **固定身份先落盘、后建会话。** 身份写在 `$home/.kongming/state.json`，用"独占预留 → 创建会话 → 原子提交"三步走，中途崩溃也不会出现两个身份或身份指向不存在会话的永久错误。
- **能力挂在 Agent 作用域，随会话释放。** 提示词段落、委派工具、控制器都只注册到孔明那个 Agent（DSH 里一个会话的执行实例）自己的作用域上，普通会话完全不受影响；Agent 销毁时逐一清理并通知外部扩展。
- **委派走原生队列，只回传一次。** 委派消息用 DSH 的 followup 队列（原生消息排队机制）发给目标会话，插件只维护一张"哪笔委派还没有回传"的内存小表，按实际执行轮次关联结果，终态到达一次即释放监听。代价是进程重启后本轮内存监听失效（重启补收明确留在后续范围，见技术设计"模块与数据归属"）。
- **浏览器只做入口和投影。** 准备成功后立即交给原生会话导航，聊天页由 DSH 挂载；委派消息在目标会话里以"事件投影 + 折叠视图"呈现，正文渲染复用原生组件。

## 使用方式

日常使用不需要直接碰这批源码，入口在浏览器侧栏：

1. 构建宿主与客户端：在包目录执行 `node build.ts`。
2. 启动前设置 `KMH_KONGMING_PROJECT_DIR` 为实际项目目录的绝对路径（数据目录 `home` 指一个 KMH 实例的私有数据目录，随启动器解析）。
3. 点击侧栏「孔明」：面板请求宿主准备固定会话，成功后自动打开完整聊天页；失败时原位显示原因和「重试」按钮。

宿主对外提供两个已鉴权 HTTP 接口（实现在 [session/web.ts](session/web.ts)）：

| 接口                             | 作用                                                         |
| -------------------------------- | ------------------------------------------------------------ |
| `POST /api/kmh-kongming/ensure`  | 准备固定会话，返回 `{sessionId, cwd}` 供原生导航             |
| `POST /api/kmh-kongming/control` | 按 `action` 执行 `prompt` / `stop` / `resume` / `supplement` |

孔明会话里的模型额外获得两个工具（实现在 [dispatch/tools.ts](dispatch/tools.ts)）：`kongming_list_models` 列出可用模型，`kongming_dispatch` 创建普通会话并排队一个任务，结果自动回传。

回归验证命令与测试范围见[包 README · 开发验证](../README.md#开发验证)。以上步骤与配置键均已对照当前代码和包 README 核查；浏览器端到端操作属真实环境验收，本文未实际执行（状态见 [spec 索引](#spec-索引)）。

## 代码说明

本 readme 覆盖 src 根目录的三个文件；紧邻本目录的三个文件不在覆盖范围内，但关系密切：[../events.d.ts](../events.d.ts) 声明插件对外的三个公开事件类型（宿主与可选扩展共用），[../build.ts](../build.ts) 负责构建，[../test/](../test) 是回归测试。

各子目录的代码说明在它们自己的 readme 里：

| 目录                                 | 负责什么                                               | readme                                                 |
| ------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------ |
| [session/](session/)                 | 固定会话宿主侧：身份、运行时、提示词、控制与 HTTP 接口 | [session/readme.md](session/readme.md)                 |
| [session/client/](session/client/)   | 固定会话浏览器侧：侧栏入口与准备面板                   | [session/client/readme.md](session/client/readme.md)   |
| [dispatch/](dispatch/)               | 跨会话委派宿主侧：工具、校验、目标会话准备与回传       | [dispatch/readme.md](dispatch/readme.md)               |
| [dispatch/client/](dispatch/client/) | 委派浏览器侧：事件投影与折叠视图                       | [dispatch/client/readme.md](dispatch/client/readme.md) |
| [client/](client/)                   | 浏览器半总入口与词典                                   | [client/readme.md](client/readme.md)                   |

### [index.ts](index.ts) — 宿主插件入口

**功能**：孔明在服务端的起点。DSH 加载插件时调用 `apply`，之后的固定会话、HTTP 接口都从这里长出来。

**实现原理**：`apply` 用 `runtimePaths()` 解析数据目录和项目目录，创建 `KongmingRuntime`，先尝试恢复上次保存的身份（失败只记警告，不阻断加载——入口重试会再检查一次），然后把运行时注册为 `kongming` 服务供其他插件调用，最后挂载两个 HTTP 路由。`inject` 列出 9 个依赖服务（会话、模型、工具、提示词、工作区、连接等），全部来自当前 Web 的生产服务。

**设计取舍**：启动恢复失败降级为警告而不是报错，是为了坏身份文件不拖垮整个 Web；具体错误会在用户第一次点击入口时通过准备接口看到。`declare module` 给 `Context` 补上 `kongming` 属性的类型，调用方拿到的是同一份运行时实例。

#### 关键函数

| 函数及源码链接          | 负责什么 | 主要输入和结果                             | 关键处理或限制                                   |
| ----------------------- | -------- | ------------------------------------------ | ------------------------------------------------ |
| [`apply`](index.ts#L29) | 插件入口 | 收到宿主上下文和配置，建立运行时并发布服务 | 恢复失败仅告警；卸载时由运行时注册的 effect 收尾 |

### [config.ts](config.ts) — 配置声明

**功能**：声明插件的两项字符串配置 `personalityPrompt`（人格段落）和 `systemPrompt`（系统段落），默认都是空字符串。

**实现原理与取舍**：schema 默认值留空、正式文案由安装 patch（`cordis.patch.yml`）提供，代码里不硬编码人格——部署文案与代码解耦，改人格不用动源码。配置原文按字面装配，不做花括号插值（见 [session/prompt.ts](session/prompt.ts)）。

### [paths.ts](paths.ts) — 运行路径与目录校验

**功能**：告诉插件"数据在哪、项目在哪"，并校验项目目录可用。

**实现原理**：`runtimePaths()` 用 `resolveDshHome` 解析数据目录，工作目录优先取插件配置 `projectDir`，其次取环境变量 `KMH_KONGMING_PROJECT_DIR`。两项都为空时，运行时沿用已有绑定，首次使用则在数据目录下建立 `.kongming/workspace`。`validateProjectDir()` 校验目录为可读、可遍历的绝对路径。

**设计取舍**：默认工作区跟随 Harness 数据目录，已有身份沿用已保存的路径。准备会话和委派前都校验目录，目录不可用时返回具体原因。

#### 关键函数

| 函数及源码链接                       | 负责什么     | 主要输入和结果                                            | 关键处理或限制                                   |
| ------------------------------------ | ------------ | --------------------------------------------------------- | ------------------------------------------------ |
| [`runtimePaths`](paths.ts#L12)       | 解析运行路径 | 可注入环境变量（默认进程环境），返回 `{home, projectDir}` | 项目目录未配置时为空串，由后续校验兜底           |
| [`validateProjectDir`](paths.ts#L21) | 校验项目目录 | 收到路径，目录可读可遍历时完成                            | 非绝对路径、目标为文件、无权限都直接抛错并附原因 |

## spec 索引

spec 保存在仓库 [docs/spec/](../../../docs/spec/) 下。检索范围：`docs/` 全部 Markdown 与 `reports/` 索引；固定会话部分未找到独立 spec（见[待确认](#待确认)第 1 条）。委派部分的明细 spec 索引也在 [dispatch/readme.md](dispatch/readme.md) 就近维护。

已核对的 spec（spec 有明确定义、开发记录指向本目录、当前代码实现对应行为）：

| Spec 章节                                                                                                                       | 定义了什么                                                                                                       | 与模块的关系及依据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [feat01 孔明委派查询并收回回复](../../../docs/spec/kongming-session-dispatch-mvp/spec.md#feat01-孔明委派天气查询并收回回复)     | 场景1 新建指定模型会话执行查询；场景2 模型不可用时明确受阻；场景3 排队委派被移除后回传取消                       | `dispatch/` 实现（[submit.ts](dispatch/submit.ts) 场景2、[relay.ts](dispatch/relay.ts) 场景1/3）。依据[技术设计 · 模块与数据归属](../../../docs/spec/kongming-session-dispatch-mvp/tech-design.md#模块与数据归属)、[开发回执](../../../docs/spec/kongming-session-dispatch-mvp/tasks/task-session-dispatch/dev-report.md)与[排队取消任务](../../../docs/spec/kongming-session-dispatch-mvp/tasks/task-dispatch-queue-cancellation.md)。真实浏览器验收：MiniMax 委派闭环已核对，glm-5.3-flash 原始用例与界面专项待完成（以开发回执口径为准） |
| [feat02 区分孔明往来与用户直接聊天](../../../docs/spec/kongming-session-dispatch-mvp/spec.md#feat02-区分孔明往来与用户直接聊天) | 委派请求与回复默认折叠、来源可识别、可展开；用户直接聊天保持原生展示                                             | [dispatch/client/](dispatch/client/readme.md) 的投影与折叠视图实现；用户消息不匹配来源 schema，继续走原生节点。依据技术设计 D3 与[界面行为](../../../docs/spec/kongming-session-dispatch-mvp/tech-design.md#界面行为)章节                                                                                                                                                                                                                                                                                                                   |
| [技术设计 · 设计决策 D1–D4](../../../docs/spec/kongming-session-dispatch-mvp/tech-design.md#设计决策)                           | 工具挂孔明作用域（D1）、原生队列 + 持久化来源 + 按轮次关联（D2）、折叠节点复用原生渲染（D3）、真实优先测试（D4） | D1 → [dispatch/tools.ts](dispatch/tools.ts)；D2 → [dispatch/relay.ts](dispatch/relay.ts) + [dispatch/protocol.ts](dispatch/protocol.ts)；D3 → [dispatch/client/view.tsx](dispatch/client/view.tsx)。依据同文件"模块与数据归属"                                                                                                                                                                                                                                                                                                              |
| [排队委派移除后回传取消 · 任务记录](../../../docs/spec/kongming-session-dispatch-mvp/tasks/task-dispatch-queue-cancellation.md) | feat01 场景3 的实现与测试任务                                                                                    | 已交付：[dispatch/relay.ts](dispatch/relay.ts) 的 `agent/inbox/discarded` 监听 + 微任务复查队列。注意该文写于目录重构前，其 `src/dispatch.ts` 链接对应现 [relay.ts](dispatch/relay.ts)；测试报告在 [reports/session-dispatch-queue-cancellation/](../../../reports/session-dispatch-queue-cancellation/)                                                                                                                                                                                                                                    |
| [委派架构时序图](../../../docs/architecture/kongming-dispatch.html)                                                             | 委派全链路的可视化时序                                                                                           | 参考材料，与 relay/submit 的实际链路一致                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

外部依赖（非本模块 spec，注明作用）：[../events.d.ts](../events.d.ts) 定义的三个 `kongming/*` 公开事件是可选能力插件（如 kongming-memory-v1）的接入契约，由 [session/runtime.ts](session/runtime.ts) 发布和串行等待。

## 待确认

1. **固定会话部分的 spec 归属**。`session/`（身份、提示词、控制接口、HTTP 路由）与浏览器入口没有找到对应的 spec——已检索 `docs/` 全目录与 `reports/` 索引，仅有 dispatch MVP 的 spec；包 README 自称"保存当前使用与实现契约"。如果固定会话的 spec 在别的仓库或已散佚，请告知位置，我会补进 spec 索引；确认没有的话，本节会改为注明"以包 README 为契约"。
2. **几处推导的设计理由**（各子目录 readme 内已就地标"待确认"）：[session/readme.md](session/readme.md) 中 runtime 的卸载收尾时序、binding-store 的多进程原子预留、control 的暂停/去重语义。三者均从代码行为归纳，未找到设计记录。如能提供原始考虑，我会替换标记并补依据。
3. **包 README 的失效链接**（不属于本文档范围，顺带报告）：[包 README](../README.md) 引用的 `reports/fix/fix-report-20261031-kongming.md` 已不存在，现存的是 [fix-report-20261110-120350.md](../../../reports/fix/fix-report-20261110-120350.md)，且其源码链接仍指向拆分前的 `src/dispatch.ts`。需要的话我可以在你确认文档后一并修掉。
