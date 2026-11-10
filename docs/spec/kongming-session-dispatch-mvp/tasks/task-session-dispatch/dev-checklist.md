# task-session-dispatch · 开发清单

> spec: [spec.md](../../spec.md)
> tech-design: [tech-design.md](../../tech-design.md)
> 创建: 2026-11-10

两项 feat 共同组成一次跨会话可观察链路，交给同一个 6.1 Sol 开发 Agent。主 Agent 负责真实 Web 验收与回归审查。用户明确授权本轮设计后连续开发验收，并要求真实数据先于新增 mock 回归。

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败。下表任务行编号与设计用例编号独立。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | 核实公开 DSH 工具、模型、队列和 Conversation 接口，建立来源唯一契约；用例 T6（构建），D1–D3 | src/protocol/dispatch.ts，package.json，pnpm-lock.yaml | None | [x] 🟢 |
| T2 | 实现孔明作用域的模型目录与创建派发工具、继承 cwd、独立模型选择和原生发送；用例 T1（真实）、T3/T5（集成）、T6，C1–C4、D1/D2 | src/dispatch.ts，src/session.ts，src/index.ts | 高:普通会话创建与模型来源持久化 | [ ] ▶️ |
| T3 | 关联实际消费 turn，自动回传一次、失败回传及释放；用例 T1（真实）、T3/T5（集成），C2/C6、D2 | src/dispatch.ts，src/protocol/dispatch.ts | 高:跨会话异步回传与原生队列并发 | [ ] ▶️ |
| T4 | 增加默认折叠的孔明往来，复用原生正文渲染，用户直接对话保持原显示；用例 T1/T2（真实）、T4（事件回放），C4/C5、D3 | src/client/dispatch.tsx，src/client/index.ts，src/client/locales.ts | None | [ ] ▶️ |
| T5 | 同步部署副本并构建，主 Agent 启动 kmh-web:60000 完成真实 T1/T2，保存 JSONL/截图/实际查询来源；覆盖全部约束 C1–C6、D4 | reports/kongming-session-dispatch-mvp/20261110-01/ | 高:真实 provider 调用与测试会话持久化 | [!] 🔴 浏览器权限受阻 |
| T6 | 根据真实证据完成缺陷修复及 T3/T4/T5 定向 mock/replay；跑 T6 相关回归并记录变更覆盖 | test/dispatch*.test.ts，test/fixtures/dispatch/，reports/kongming-session-dispatch-mvp/20261110-01/ | None | [ ] ⏳ |
| T7 | 对照四个场景与 C1–C6 完成验收结论，更新使用说明与最终设计实际接口，收尾报告 | README.md，packages/kongming/README.md，tech-design.md，dev-checklist.md，dev-report.md，reports/kongming-session-dispatch-mvp/20261110-01/ | None | [ ] ▶️ 受阻回执已落盘 |

## 影响文件树

路径 `src`、`test`、`package.json` 均位于 `packages/kongming/`；根锁文件位于仓根。测试目录为规划新增，等待真实日志后创建。

```text
kmh-kongming/
├── README.md                                      M # 链接设计与验收入口
├── pnpm-lock.yaml                                 M # 锁定公开依赖
├── packages/kongming/
│   ├── package.json                              M # 声明复用的公开依赖与客户端加载顺序
│   ├── README.md                                  M # 新增委派能力用法与边界
│   ├── src/protocol/dispatch.ts                   U # 唯一来源契约
│   ├── src/dispatch.ts                            U # 作用域工具与一次回传
│   ├── src/session.ts / src/index.ts              M # 接入孔明 Agent 生命周期
│   ├── src/client/dispatch.tsx                    U # 孔明往来原生扩展节点
│   ├── src/client/index.ts                        M # 注册展示扩展
│   ├── src/client/locales.ts                      M # 现有语言资源加入展示文字
│   ├── test/dispatch*.test.ts                     U # 规划：真实数据后建立定向回归
│   └── test/fixtures/dispatch/                    U # 规划：真实会话片段与回放数据
└── docs/spec/kongming-session-dispatch-mvp/
    ├── tech-design.md                             U # 设计及全部场景测试映射
    └── tasks/task-session-dispatch/
        ├── dev-checklist.md                       U # 任务状态与交付对账
        └── dev-report.md                          U # 开发回执与唯一验收报告入口
reports/kongming-session-dispatch-mvp/20261110-01/    U # 被 Git 忽略的真实验收与回归证据
```

## 场景覆盖与执行责任

| 场景 | 全部用例 | 承接任务行 | 执行责任 |
|---|---|---|---|
| feat01 场景1 | 设计 T1、T5、T6 | 任务 T1/T2/T3/T5/T6 | 开发 Agent 实现及回归；主 Agent 真实 smoke 和验收 |
| feat01 场景2 | 设计 T3、T6 | 任务 T2/T3/T6 | 开发 Agent 回归；主 Agent 审查失败呈现 |
| feat02 场景1 | 设计 T1、T4、T6 | 任务 T4/T5/T6 | 主 Agent 真实 UI；开发 Agent 回放 |
| feat02 场景2 | 设计 T2、T4、T6 | 任务 T4/T5/T6 | 主 Agent 真实聊天；开发 Agent 回放 |

报告：[test-report.md](../../../../../reports/kongming-session-dispatch-mvp/20261110-01/test-report.md)。当前状态：设计和拆分已完成；T1–T4 代码已实现且构建检查通过，T2–T4 等待真实行为验收。T5 的 60000 服务已启动，浏览器受保存的权限策略阻止；T6 的新增回归遵循真实优先顺序等待，已有回归 44 通过/1 原有跳过。T7 文档和受阻交付报告已整理。
