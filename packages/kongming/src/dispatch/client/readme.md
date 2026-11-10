# dispatch/client/ 委派浏览器侧

> 草稿，待用户检查。模块总览、设计理念与使用方式见 [../../readme.md](../../readme.md)，委派宿主侧见 [../readme.md](../readme.md)。

这一目录负责委派在**目标会话**里的展示：孔明发出的委派请求和目标 Bot 对应的回复默认合并折叠，摘要显示「孔明 · 会话往来」和执行状态；用户直接发消息的轮次保持原生展示。两个文件配合：[projection.ts](projection.ts) 把原生会话事件"接管"为插件自己的聊天节点类型，[view.tsx](view.tsx) 为这类节点渲染折叠视图。对应 [feat02 场景1、场景2](../../../../../docs/spec/kongming-session-dispatch-mvp/spec.md#feat02-区分孔明往来与用户直接聊天)（C5 折叠、来源可见、直接聊天不受影响）。

### [projection.ts](projection.ts) — 委派事件投影

**功能**：`dispatchInput` 是一个 Conversation 节点定义（DSH 聊天界面的扩展点），把原生会话日志里来源为 `kongming-dispatch` 的追加消息"接管"为插件自己的聊天节点类型 `kongming-dispatch`。

**实现原理**：`match()` 只对 `user/message` 且 `surfaceOp === "append"` 的事件尝试解析来源 schema（[../protocol.ts](../protocol.ts)），命中则独占（`exclusive: true`）——这条消息不再走原生用户消息节点。`start()` 从事件初始化投影：剥掉第一块的来源前缀文本（内容相等时），其余正文原样保留。`update()` 恒等返回（请求正文在起始事件已确定）。`buildViewNode()` 在原请求位置生成 `kongming-dispatch` 聊天节点，归入"exchange"分组树。

**设计取舍**：投影基于持久化的事件流而不是组件内存，页面刷新后折叠记录自动重建（对应技术设计[界面行为](../../../../../docs/spec/kongming-session-dispatch-mvp/tech-design.md#界面行为)）；只接管追加的委派消息，用户编辑等操作交给原生逻辑——普通用户消息不匹配来源 schema，天然继续走原生节点。

#### 关键函数

| 函数及源码链接 | 负责什么 | 主要输入和结果 | 关键处理或限制 |
| --- | --- | --- | --- |
| [`dispatchInput`](projection.ts#L17) | 委派事件的节点定义 | 一个 Conversation 节点定义对象，含 `match`/`start`/`update`/`buildViewNode` 四个环节 | `match` 只认 append 且来源 schema 命中，独占接管；`start` 剥前缀块后正文原样保留 |

### [view.tsx](view.tsx) — 委派折叠视图

**功能**：`mountDispatchView(ctx)` 注册上面的投影，并在聊天节点插槽里挂 `DispatchView` 组件：把孔明委派请求和同轮回复合成一个默认折叠的 `<details>` 块，摘要显示「孔明 · 会话往来」+ 状态（进行中/已完成/已结束，订阅该轮结束原因得出）。

**实现原理**：插槽注入时先在宿主已注册的 `conversation.chat.node` 条目里找到原生 `user` 渲染器，展开时直接复用它渲染请求正文（跳过附加插槽链）。折叠时用一段 CSS（`:has()` 选择器）隐藏聊天流里同一轮次的原生回复与工具组节点，展开即恢复——DOM 属性 `data-chat-turn` 由原生节点提供。

**设计取舍**：复用原生渲染器保证 Markdown、图片、工具呈现与宿主一致，插件只加外壳；代价是 CSS 依赖当前 DSH 版本的 DOM 结构，DSH 升级后需要重新验收（技术设计[界面行为](../../../../../docs/spec/kongming-session-dispatch-mvp/tech-design.md#界面行为)明确记录了这一点）。折叠用原生 `<details>` 而不是状态管理，刷新后依然可开合。

#### 关键函数

| 函数及源码链接 | 负责什么 | 主要输入和结果 | 关键处理或限制 |
| --- | --- | --- | --- |
| [`mountDispatchView`](view.tsx#L26) | 注册投影与视图 | 收到浏览器上下文，无返回 | 宿主无 `uiConversation` 时静默跳过；找不到原生 user 渲染器时报错 |
| [`DispatchView`](view.tsx#L42) | 渲染折叠块 | 聊天节点属性；输出折叠摘要与展开正文 | 状态取自对应轮次的 `turn/end` 原因 |
| [`closedTurnStyle`](view.tsx#L16) | 折叠样式 | 轮次号；输出隐藏同轮原生节点的 CSS | 依赖 `data-chat-turn` DOM 属性 |
