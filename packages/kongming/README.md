---
description: 孔明固定原生会话的启动、提示词配置、身份恢复、可选记忆接入与开发验证。
---

# 孔明永久助手

## 概述

`@kmh/kongming` 在 Web 侧栏提供「孔明」入口，点击后打开固定的原生聊天。每个服务端 home 保存一个助手身份，支持连续追问、流式回复、通用文件工具和重启恢复。模型、技能、工具和审批沿用当前 Web 预设。部署可单独选择孔明，也可配合独立记忆插件保存长期信息。

## 目录

- [启动与配置](#启动与配置)
- [身份、数据与恢复](#身份数据与恢复)
- [可选记忆](#可选记忆)
- [实现说明](#实现说明)
- [开发验证](#开发验证)
- [归属与相关文档](#归属与相关文档)
- [开发备注](#开发备注)

<!-- prettier-ignore -->
-----

## 启动与配置

已有 KMH 安装与构建环境可通过 Web profile 使用本包。自定义 profile 在依赖中声明 `@kmh/kongming`，并在 `dsh.profile.bundles` 中选择同名 bundle；[安装 patch](cordis.patch.yml) 登记 `kmh-kongming` 实例和默认提示词。

启动前将 `KMH_KONGMING_PROJECT_DIR` 设置为实际项目目录的绝对路径。该目录需要存在且可读、可遍历；文件写入遵循当前工具与审批规则。点击「孔明」后，插件准备身份、注册工作区，再通过 DSH 原生导航打开完整会话页。头部、上下文、文件、终端、模型选择和审批由当前 Web 插件组合提供。

本包拥有两项提示词配置，部署文案集中保存在安装 patch。

| 配置键              | Schema 默认值 | 行为                                       |
| ------------------- | ------------- | ------------------------------------------ |
| `personalityPrompt` | 空字符串      | 完整人格段落；安装配置提供现代中文顾问人格 |
| `systemPrompt`      | 空字符串      | 完整系统段落；安装配置提供孔明身份         |

两项文本均按配置原文装配，花括号保持字面量。显式清空后，对应段落为空。配置覆盖与迁移见提示词配置升级。

## 身份、数据与恢复

本包将固定身份保存在 `$KMH_HOME/.kongming/state.json`，内容包括 `sessionId`、项目路径、预设和准备状态。首次访问预留身份后创建会话，后续访问沿用该身份。KMH 启动器将 `KMH_HOME` 映射为 `DSH_HOME`，插件通过公开 home 解析能力定位同一数据目录；聊天持久化路径见运行记录。

启动时，插件读取已有身份，为已加载或后续恢复的同身份 Agent 绑定孔明提示词。并发准备请求共用一次操作，失败后可重试。目录配置缺失、目录与已绑定路径冲突、身份损坏或会话恢复失败时，入口显示具体原因和重试按钮；修复报错所指的目录或文件后重试。已有身份与会话文件保留，项目目录需要与身份文件中的绑定保持一致。

已鉴权的 `POST /api/kmh-kongming/ensure` 接受空对象，成功返回 `sessionId` 和 `cwd`。失败响应为 HTTP 400，包含 `code: KONGMING_PREPARE_FAILED`、可读原因和 `retryable`；响应使用 `no-store`。协议定义见 [src/protocol/index.ts](src/protocol/index.ts)。

停用孔明本体时，插件取消当前执行、等待空闲并保存会话，同一宿主中尚待处理的消息继续保留。重新启用后沿用固定身份。整服务退出时，底座当前会清空待处理队列；已完成和已中断的历史继续保存。停服前请处理完队列，或另行保留待发送内容。

### 固定会话控制

已鉴权的 `POST /api/kmh-kongming/control` 通过 `action` 接纳以下文本操作，身份由宿主绑定的孔明会话确定。请求 schema 拒绝额外的 `sessionId`；接口沿用宿主的 owner 鉴权。成功返回 `{ "accepted": true }`，执行结束通过会话事件与状态观察；校验或执行接纳失败返回 HTTP 400 和 `KONGMING_CONTROL_FAILED`，响应使用 `no-store`。

| action       | 其他字段                         | 行为                                                                                           |
| ------------ | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `prompt`     | `text`、`requestId`、可选 `mode` | 文本逐字保留，`mode` 为 `queue` 或 `steer`，默认 `queue`；同一请求身份只接纳一次。             |
| `stop`       | —                                | 取消当前执行，保留待处理输入；之后经本入口发送的文本继续入队，等待显式继续。                   |
| `resume`     | —                                | 以原消息身份唤醒队列，保留顺序；空队列保持空闲，连续调用沿用同一驱动。                         |
| `supplement` | `text`                           | 通过 `Agent.inject()` 为最近的后续步骤提供用户文本；空闲时等待后续唤醒，已开始的请求照常完成。 |

`text` 需要包含非空白内容。宿主插件先调用 `ctx.kongming.ensure()`，再通过 `ctx.kongming.control` 调用 `prompt(text, mode, requestId)`、`cancel()`、`resume()` 或 `supplement(text)`；停用或释放后，原控制器拒绝新操作。控制方法实现在 [src/control.ts](src/control.ts)，边界 schema 集中在 [src/protocol/index.ts](src/protocol/index.ts)。原生聊天界面继续使用 DSH 的通用输入和停止操作；上述入口为调用方提供孔明自己的显式继续与补充本轮能力。

## 可选记忆

`@kmh/kongming-memory-v1` 独立提供冻结记忆加载、收尾记录提醒和手动压缩刷新。默认 Web profile 分别选择两个 bundle；只选择孔明时，固定会话、人格、模型和通用工具继续工作。启用记忆时，文件、提示词与权限要求见[记忆插件说明](../kongming-memory-v1/README.md)。

停用记忆插件后，孔明实例、当前任务、会话和已有记忆文件继续保留。后续提示词装配使用孔明及其余已启用插件的贡献。**同一会话的完整请求仍可能携带历史中的记忆内容**：系统提示词更新模式、旧回复、工具结果和已入队提醒的具体规则见[卸载后的系统提示词与历史](../kongming-memory-v1/README.md#卸载后的系统提示词与历史)。

<!-- prettier-ignore -->
-----

## 实现说明

<details>
<summary>固定身份、原生导航与扩展生命周期 — 点击展开</summary>

浏览器点击入口后向宿主请求准备固定会话。宿主校验项目目录，独占预留或读取身份，通过公开 Session Controller 创建或恢复 Agent，绑定配置提示词，再登记工作区与保存身份。浏览器拿到会话 ID 后交给原生导航。可选能力通过公开事件访问该 Agent，并管理自己的准备、请求等待和清理。

### 宿主、协议与构建

以下文件共同负责准备、持久化与释放。文件读写或底座调用失败会沿准备接口返回；启动恢复失败会记录诊断，并保留入口重试路径。

| 文件                                           | 作用、处理与关键函数                                                                                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [src/index.ts](src/index.ts)                   | `apply(ctx, config)` 解析运行路径并建立运行时，尝试恢复已有身份，提供服务并挂载 Web 路由。所需注入项均来自基础会话、提示词、工作区与连接服务。                                                               |
| [src/config.ts](src/config.ts)                 | `Config` 校验两项字符串配置，并为缺省值提供空字符串；默认自然语言文案由安装 patch 拥有。                                                                                                                     |
| [src/paths.ts](src/paths.ts)                   | `runtimePaths()` 读取 home 与项目目录环境配置；`validateProjectDir()` 校验绝对路径及目录访问，失败时带上目录与原因。                                                                                         |
| [src/state.ts](src/state.ts)                   | `BindingStore.readExisting()` 读取已有身份；`loadOrReserve(cwd)` 通过临时文件和独占发布保留同一身份；`commit(binding)` 校验后原子替换状态文件。损坏内容保留并报告路径。                                      |
| [src/session.ts](src/session.ts)               | `KongmingRuntime.ensure()` 合并并发准备，创建或恢复会话、等待保存、关联工作区并返回身份。`restoreExisting()` 接入已有身份；`bindPrompt()` 绑定人格并发布就绪事件；`close()` 等待准备和执行收敛，再释放绑定。 |
| [src/prompt.ts](src/prompt.ts)                 | `mountPrompt(agent, config)` 在指定 Agent 作用域装配人格和系统配置原文，返回幂等清理函数。普通会话继续使用各自的提示词。                                                                                     |
| [src/web.ts](src/web.ts)                       | `mountWeb(ctx, runtime)` 经现有鉴权连接登记准备接口，校验请求与响应，将准备错误转为可读失败响应。                                                                                                            |
| [src/protocol/index.ts](src/protocol/index.ts) | `BindingSchema` 校验身份文件；`EnsureRequestSchema`、`EnsureResultSchema` 和 `FailureSchema` 供宿主、浏览器与测试共同校验边界数据。                                                                          |
| [events.d.ts](events.d.ts)                     | `@kmh/kongming/events` 的类型入口，定义可选能力接入事件；消费者使用类型导入。                                                                                                                                |
| [build.ts](build.ts)                           | 直接执行时清理 `lib`，编译宿主与浏览器声明，再打包客户端。`watchClient()` 首次构建后监听客户端依赖，返回异步关闭函数；初始化失败会释放构建器。                                                               |

### 浏览器与验收脚本

浏览器侧负责准备入口和原生会话导航，聊天执行由 DSH 提供。准备中显示加载状态，失败时显示原位原因与重试按钮。

| 文件                                                                                                                         | 作用、处理与关键函数                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/client/index.ts](src/client/index.ts)                                                                                   | `apply(ctx)` 注册词典、侧栏与准备面板；内部 `prepare(signal)` 调用准备接口、刷新会话目录，再执行 `uiWorkspace.openSession(sessionId)`。请求与卸载取消通过信号传递。             |
| [src/client/KongmingPanel.tsx](src/client/KongmingPanel.tsx)                                                                 | `KongmingPanel()` 管理加载、失败与重试状态；面板退出时取消尚待完成的准备请求。                                                                                                  |
| [src/client/locales.ts](src/client/locales.ts)                                                                               | 提供同键的中文与英文入口、重试和失败文案。                                                                                                                                      |
| [test/browser.ts](test/browser.ts)                                                                                           | 启动私有 mock Web 环境，输出验收地址和临时目录信息；退出信号触发服务关闭与目录回收。                                                                                            |
| [test/check-layout.ts](test/check-layout.ts)                                                                                 | 读取真实浏览器导出的尺寸 JSON，校验空会话居中、聊天输入区贴底与内部滚动；输入或布局异常时断言失败。                                                                             |
| [test/fixtures/host.ts](test/fixtures/host.ts)、[process.ts](test/fixtures/process.ts)、[server.ts](test/fixtures/server.ts) | 分别建立真实循环宿主、私有 Web 子进程和 Loader 配置；每例使用独立 home/proj，并等待资源关闭后回收。模型请求由 [mock-adapter.ts](test/fixtures/mock-adapter.ts) 的有限脚本提供。 |
| [test/fixtures/wire.ts](test/fixtures/wire.ts)                                                                               | 定义本地验收接口的 schema，供服务端和测试共同使用；RPC 请求类型来自公开 Session Controller。                                                                                    |

### 可选能力事件

扩展通过 `@kmh/kongming/events` 导入公开类型，自行订阅事件并管理资源。

| 事件                      | 时机与等待责任                                                                   |
| ------------------------- | -------------------------------------------------------------------------------- |
| `kongming/agent-ready`    | 孔明人格绑定后通过 `emit` 发布 Agent；扩展自行管理异步准备和实际请求中的等待。   |
| `kongming/visit-agents`   | 通过 `serial` 访问当前已绑定 Agent，供后启用的能力接入；孔明缺省时访问集合为空。 |
| `kongming/agent-detached` | 孔明停止使用该 Agent 时通过 `serial` 等待扩展释放自身绑定。                      |

记忆插件按这些事件接入，孔明的生产代码依赖基础服务。记忆退出后的请求与文件处理归属见其 README。

</details>

<!-- prettier-ignore -->
-----

## 开发验证

测试使用私有临时目录、真实 AgentLoop、Session Controller、JSONL 和文件工具，模型由脚本替换。Loader 测试需要允许本机监听临时端口；真实模型的判断质量由单独验收承担。

在本包目录构建宿主与客户端：

```sh
node build.ts
```

在仓库根目录构建可选记忆，并验证孔明流程：

```sh
node packages/kongming-memory-v1/build.ts
node --test --test-concurrency=1 packages/kmh-kongming/test/*.test.ts
```

`optional-memory.test.ts` 覆盖独立启动、运行中卸载记忆、后装与重装、固定身份恢复及记忆准备失败后的移除；`prompt.test.ts` 覆盖配置原文与作用域隔离。单会话停止、队列、插话、工具中断和故障恢复的用例归属见单会话回归。

测试组合使用本包声明的 `dsh-api-remote-access`、`dsh-tool-executor-native` 和 `dsh-tool-testkit`：前者接入真实 Gateway 授权服务，后两者分别提供 Loader 的工具执行与标准工具夹具。内存宿主的 AgentLoop testkit 已挂载执行器。`control.test.ts` 覆盖控制入口鉴权、固定身份限制、暂停去重、消息身份及旧控制器释放。当前升级工作区的依赖锁文件边界与执行记录见[上游兼容修复报告](reports/fix/fix-report-20261031-kongming.md)。

包的 `typecheck` 检查宿主、浏览器、测试与构建工具，`lint`、`format:check` 覆盖对应源码与配置。实际浏览器验收场景和历史执行证据见首阶段开发报告。

## 归属与相关文档

包 README 保存当前使用与实现契约，规格和任务保存阶段安排及执行记录。

- [独立记忆插件](../kongming-memory-v1/README.md)：冻结文件、收尾 steer、刷新与卸载后的历史。
- Web profile：部署选择与项目目录配置。
- 可选记忆配置升级：bundle、准备接口与扩展接入迁移。
- 技术设计：阶段范围、完整场景与实现依据。
- TypeScript 任务：构建、测试、夹具与验收脚本的语言迁移记录。

## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

提示词配置页、列表与搜索隔离的阶段安排保存在技术设计。记忆边界用例由独立记忆插件文档导航。

</details>

## 从 Web 会话发布明庭任务

明庭任务发布插件已迁移为独立仓库 [kmh-mingting](../kmh-plugin/kmh-mingting/README.md)（submodule 挂载于 `packages/kmh-plugin/kmh-mingting`），配置项、工具行为与启用方式见该包 README。
