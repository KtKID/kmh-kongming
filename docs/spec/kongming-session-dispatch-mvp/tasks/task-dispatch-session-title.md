# 给孔明委派的新会话命名

> 功能定义见 [feat01 场景4](../spec.md#场景4-普通委派会话按任务命名)。比较基线为 `9ea1e6b`，本次涉及的既有源码、测试和功能文档在任务开始时与该提交一致。

## ① 需求与变更

用户要求给孔明 dispatch 增加命名参数，解决普通委派在侧栏显示「未命名」。本次承接 feat01 场景4，沿用 C2 的原生队列与 C4 的消息来源。军机阁专属会话继续按大臣名命名。变更已列入 [功能变更记录](../spec.md#changelog)。

## ② 精简技术设计

沿用 [既有设计 D1、D2](../tech-design.md#设计决策)。在 `dispatch/tools.ts` 的工具 schema 加可选 `title`，指导孔明优先用用户指定名，默认按任务拟名。在 `dispatch/submit.ts` 去除首尾空白，有值时在新建会话后、发任务前调用 `sessionController.rename`。宿主负责规范化、写入标题事件和更新侧栏。可选字段与空白省略兼容已有调用。运行验证使用隔离宿主，覆盖真实标题服务与队列；Web 验收用已有浏览器夹具。重建本插件及其 Git 安装入口 `prebuilt/index.js`。

## ③ 测试用例与变化

| 用例 | 类型 | 场景与判据 |
| --- | --- | --- |
| T1 | 新增集成 | feat01 场景4。调用工具传入带首尾空白的中文标题，标题先于委派消息出现，并能从持久化日志读回。 |
| T2 | 新增集成 | feat01 场景4。省略标题和传入空白两个输入均成功回传，沿用宿主命名行为。 |
| T3 | 沿用回归 | feat01 场景1/3、feat02 场景1。原生队列与往来回传及投影通过现有回归。 |
| T4 | 新增浏览器验收 | feat01 场景4。从孔明输入委派，核对侧栏标题及刷新后的结果。浏览器夹具只替换模型输出。 |

## ④ 技术实现

- `mountDispatch` 在 `packages/kongming/src/dispatch/tools.ts` 暴露 `title` 并传至 `prepareDispatch`。`prepareDispatch` 在 `packages/kongming/src/dispatch/submit.ts` 调用宿主重命名，再进入原生发送链路。
- `packages/kongming/test/dispatch.test.ts` 增加三组输入的集成回归。`test/fixtures/host.ts` 接真实标题服务，`mock-llm.ts` 提供浏览器用的固定工具调用。浏览器夹具 `cordis.yml`、包清单和锁文件补齐聊天组件依赖的文件拖拽插件。
- 包 README 补充使用方式。`prebuilt/index.js` 已用项目打包命令重建，覆盖从 Git 安装的入口。

## ⑤ 验证结果

插件构建和静态检查通过。自动化回归 53 项通过，1 项既有测试跳过。隔离浏览器完成从孔明发起委派、打开目标会话和刷新核对。详情见 [测试报告](../../../../reports/dispatch-session-title/20261113-01/test-report.md)与[验收截图](../../../../reports/dispatch-session-title/20261113-01/evidence/session-title.png)。

独立插件仓已验证，运行中的 KMH 需要同步主仓子模块并构建后加载。正式模型按任务拟标题的结果待实际使用验证。
