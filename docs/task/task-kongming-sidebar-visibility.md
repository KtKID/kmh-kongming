# 孔明固定会话的侧栏专属入口

> 功能主定义见[侧栏专属入口](../../packages/kongming/README.md#侧栏专属入口)，变更见[索引](../../packages/kongming/README.md#变更记录)。技术依据为本任务②，状态为源码交付完成。

## ① 需求与变更

用户要求点击「孔明」直接打开原会话，并去掉普通列表里的重复入口。用户以「同意 qdev」批准孔明插件内部按 ID 隐藏普通列表行的方案。侧栏搜索遵循宿主规则。修改前行为见 `8d320c7` 下的包 README 与[已有工作区差异](../../reports/kongming-sidebar-visibility/20261110-01/evidence/baseline.diff)，后者是本任务前已有的聊天标识改动。

## ② 精简技术设计

D01 复用已有固定绑定。宿主通过已鉴权的只读路由返回固定会话 ID 或空值。浏览器子模块启动时读取已有 ID，点击入口准备成功时从原响应取得 ID。子模块按宿主侧栏行的 `data-row-key` 精确隐藏该 ID，并随客户端插件卸载移除样式。现有原生导航、存储、工作区挂载、会话创建和搜索路径保持各自职责。共享 Zod 契约校验 ID，既有绑定是身份唯一来源，主动准备结果优先于迟到的初始读取。

范围包括 `src/session/client/` 的入口与隐藏子模块、`src/session/` 的只读路由与协议，以及现有客户端与 Web 夹具。适用的 R1、R2、R4、R5、R7 通过导入与状态审查、类型检查、路由及界面回归核对。R3、R6 分别对应跨语言契约和业务参数，本次范围无适用项。

## ③ 测试用例与变化

| 用例 | 变化     | 预期                                                           | 验证入口                           |
| ---- | -------- | -------------------------------------------------------------- | ---------------------------------- |
| T01  | 新增     | 已有固定会话在页面加载后从普通列表隐藏，同工作区普通会话保留。 | 客户端用例与隔离浏览器             |
| T02  | 修改     | 点击孔明直接进入同一会话，首次准备结果生效，插件卸载移除样式。 | `test/client.test.ts` 与隔离浏览器 |
| T03  | 新增     | 只读路由在未绑定时返回空值，绑定后返回原 ID。                  | 隔离 Web 宿主                      |
| T04  | 沿用回归 | 孔明保留原会话身份、聊天和工作目录。                           | 单会话回归与隔离浏览器             |

## ④ 技术实现

- [`mountSidebarVisibility()`](../../packages/kongming/src/session/client/sidebar-visibility.ts) 挂载并清理隐藏规则，`hide()` 只匹配固定会话 ID。
- [`mountSessionEntry()`](../../packages/kongming/src/session/client/entry.ts) 准备成功后先更新隐藏规则，再使用原生导航打开原会话。
- [`mountWeb()`](../../packages/kongming/src/session/web.ts)、[运行时](../../packages/kongming/src/session/runtime.ts)和[协议](../../packages/kongming/src/session/protocol.ts)提供固定 ID 的只读响应。客户端用例覆盖样式挂载与卸载，Web 用例和夹具覆盖鉴权及首次读取。

## ⑤ 验证结果

- [统一测试报告](../../reports/kongming-sidebar-visibility/20261110-01/test-report.md)记录 T01–T04、技术验收和覆盖率。自动化执行 19 项，通过 18 项，既有停服队列用例按原配置跳过。
- [分组截图](../../reports/kongming-sidebar-visibility/20261110-01/evidence/grouped.jpg)与[平铺截图](../../reports/kongming-sidebar-visibility/20261110-01/evidence/flat.jpg)展示右侧原孔明聊天及左侧普通会话对照。
- 功能定义和变更索引已同步，交付对账与技术验收通过。按用户后续要求同步并重启了 `60000`，已核对实际返回的固定会话 ID 和页面产物。侧栏搜索沿用宿主规则。
