![孔明图标](docs/assets/kongming-icon.png)

**简体中文** · [English](README.en.md)

# 孔明 · DeepSeek Harness 插件

孔明是 [DeepSeek Harness](https://www.deepseek.com/harness/) 的常驻助手。在侧栏打开一个固定会话，继续之前的工作，委派任务给其他模型，并把有用的信息留给后续对话。

- [孔明能做什么](#孔明能做什么)
- [工作机制](#工作机制)
- [安装与启用](#安装与启用)
- [首次使用](#首次使用)
- [从源码开发](#从源码开发)
- [文档与反馈](#文档与反馈)

## 孔明能做什么

- **持续协作。** 点击侧栏「孔明」打开专属聊天。重启 Harness 后可以回到同一个会话，继续之前的任务。
- **委派给其他模型。** 可以请孔明用已配置的指定模型开一个新会话。目标会话完成后会把结果送回孔明。打开目标会话的「孔明 · 会话往来」可查看原任务和回复。
- **保留长期记忆。** 孔明可在任务结束时记录值得保留的偏好、决定和经验，供之后的对话使用。

[观看孔明功能演示（MP4）](docs/assets/media.mp4)

## 工作机制

孔明复用 Harness 的原生会话、模型、工具和审批规则。首次打开时，插件在当前 Harness 数据目录下建立专用工作区并保存固定会话身份。可以在首次打开前到插件配置填写 `projectDir`，让孔明在指定目录中工作。已有会话继续沿用已绑定的目录。

记忆与会话身份保存在 Harness 数据目录的 `.kongming/` 下。新条目追加到 `MEMORY.md`，模型读取 `MEMORY.frozen.md`。启动时绑定会话和手动 `/compact` 成功后会刷新冻结版本。

## 安装与启用

1. 打开 [DeepSeek Harness](https://www.deepseek.com/harness/)。插件适配 DSH `0.2.2-rc.1` 和 `0.2.2-alpha.2`。发送消息前请配置一个可用模型。
2. 打开侧栏「插件」→「添加插件」，粘贴以下 GitHub 仓库地址，点击「安装」。

   ```text
   https://github.com/KtKID/kmh-kongming.git
   ```

3. 安装完成后选择「立即启用」，再点侧栏「孔明」。一次安装会加载孔明和 Memory。仓库随附预编译入口，安装时无需构建。

也可以从 [GitHub Releases](https://github.com/KtKID/kmh-kongming/releases) 选择版本，将对应 `.tgz` 的下载链接粘贴到同一输入框。

## 首次使用

点击侧栏「孔明」，发送「用一句话介绍你自己」。收到回复后，再点侧栏入口应回到这条会话。体验委派时，可以发送「请用另一个模型把『今天下午开会』翻译成英文」。打开新建的目标会话可查看委派记录，结果会回到孔明。

## 从源码开发

使用 Node.js 24 和 pnpm 11.7.0，在仓库根目录执行以下命令。打包命令生成 `dist/kmh-kongming-<版本>.tgz`，可在「添加插件」中填写该文件的绝对路径试装。

```sh
pnpm install --frozen-lockfile
pnpm -r --filter './packages/*' run build
pnpm -r --filter './packages/*' test
pnpm build:git-bundle
pnpm pack:dsh
```

更新孔明或 Memory 后，将 `pnpm build:git-bundle` 生成的 `prebuilt/` 与源码一并提交。持续集成会检查两者是否一致。

本仓也可作为 kongming-os 的 Git 子模块使用。配置和构建方式见[在 KMH 中集成](docs/kmh-integration.md)。

## 文档与反馈

- [孔明插件](packages/kongming/README.md) · 固定会话、工作目录、人格和委派。
- [记忆插件](packages/kongming-memory/README.md) · 记忆文件、冻结刷新和停用行为。
- [会话委派规格](docs/spec/kongming-session-dispatch-mvp/spec.md) · 委派、回传及来源展示。
- [GitHub Issues](https://github.com/KtKID/kmh-kongming/issues) · 安装或运行问题。
