# client/ 浏览器总入口与词典

> 草稿，待用户检查。模块总览、设计理念与使用方式见 [../readme.md](../readme.md)。

这一目录是孔明**浏览器半**的起点：DSH 客户端加载插件时调用这里的 `apply`，把孔明的界面能力注册进去。它只做装配，真正的界面行为在两个子模块里——固定会话入口（[session/client/readme.md](../session/client/readme.md)）和委派折叠视图（[dispatch/client/readme.md](../dispatch/client/readme.md)）。

### [index.ts](index.ts) — 浏览器插件入口

**功能**：浏览器半的 `apply`，注册词典并挂载两个子模块。

**实现原理**：按插件作用域注册中英文词典（`kongming` 命名空间，随插件卸载一起释放），再依次挂载委派折叠视图（[../dispatch/client/view.tsx](../dispatch/client/view.tsx)）和固定会话入口（[../session/client/entry.ts](../session/client/entry.ts)）。`inject` 声明五个界面服务依赖（插槽、词典、会话列表、工作区与对话 UI）。

**设计取舍**：入口只做装配不含业务，界面行为全在两个子模块里，注册顺序即依赖顺序；词典用 `ctx.effect` 注册保证作用域一致。

#### 关键函数

| 函数及源码链接 | 负责什么 | 主要输入和结果 | 关键处理或限制 |
| --- | --- | --- | --- |
| [`apply`](index.ts#L24) | 浏览器入口 | 收到浏览器上下文，注册词典与子模块，无返回 | 宿主缺少对话 UI 等能力时由各子模块自行决定跳过或报错 |

### [locales.ts](locales.ts) — 词典

**功能**：孔明浏览器侧的全部文案，中英同键：入口名、委派折叠标题与三态（进行中/已完成/已结束）、重试、空会话提示、准备失败标题。

**实现原理与取舍**：键类型由中文对象的 `keyof` 推导，英文对象必须逐键补齐（类型层面强制同步）；文案集中在安装 patch 与这一个文件，不散落在组件里。`KongmingLocaleKey` 供 `declare module` 注册命名空间类型使用（[index.ts](index.ts)）。
