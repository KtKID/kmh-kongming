# kmh-kongming（孔明套件仓）

一仓两包：孔明本体插件与独立记忆插件。两包在 kongming-os 中总是组合部署（kmh-kongming 的测试夹具默认装载记忆插件），故共用一个自足仓，互依由仓内 workspace（`workspace:*`）解析。

| 目录 | 包名 | 说明 |
| --- | --- | --- |
| `packages/kongming` | `@kmh/kongming` | 孔明固定会话、原生聊天与可选能力扩展；含 Web 侧栏面板 |
| `packages/kongming-memory` | `@kmh/kongming-memory-v1` | 孔明独立记忆：冻结文件、完整加载与手动压缩刷新；对 `@kmh/kongming` 仅为可选类型依赖（事件声明） |

## 功能规格

- [孔明创建会话委派查询与来源展示（MVP）](docs/spec/kongming-session-dispatch-mvp/spec.md)：首版已实现；MiniMax-M2.7 真实天气委派、回传与孔明后续答复已通过会话日志核对，完整验收状态见开发回执。
- [技术设计与 smoke 用例](docs/spec/kongming-session-dispatch-mvp/tech-design.md) · [开发清单](docs/spec/kongming-session-dispatch-mvp/tasks/task-session-dispatch/dev-checklist.md)。

## 独立开发

devDependencies 使用 npm 发布版 `@deepseek-ai/dsh-*`（钉底座版本 `0.2.2-alpha.2` 线），本仓离开 kongming-os 检出即可安装构建：

```bash
pnpm install --frozen-lockfile
pnpm -r --filter './packages/*' run build
pnpm -r --filter './packages/*' run typecheck
pnpm -r --filter './packages/*' test
pnpm -r --filter './packages/*' run lint
pnpm -r --filter './packages/*' run format:check
```

与 DSH 底座的真组合验证（profile 装配、真启动）不在本仓 CI，由宿主 kongming-os 侧守卫测试覆盖。

## 与 kongming-os 的双副本关系

本仓（`proj/kmh-plugin/kmh-kongming`）与 kongming-os 内挂载克隆 `packages/kmh-plugin/kmh-kongming`（submodule）是两份工作树：在挂载克隆改完提交后，源仓执行 `git pull <克隆路径> main` 对齐；在源仓改完则克隆内 `git pull origin main`，并刷新宿主 gitlink。任何一边改完先同步另一边再继续。
