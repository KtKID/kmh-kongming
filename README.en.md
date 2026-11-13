![Kongming icon](docs/assets/kongming-icon.png)

[简体中文](README.md) · **English**

# Kongming · DeepSeek Harness Plugin

Kongming is a persistent assistant for [DeepSeek Harness](https://www.deepseek.com/harness/). Open its dedicated chat from the sidebar to pick up where you left off, delegate tasks to other models, and save useful details for future conversations.

- [What Kongming can do](#what-kongming-can-do)
- [How it works](#how-it-works)
- [Install and enable](#install-and-enable)
- [Quick start](#quick-start)
- [Develop from source](#develop-from-source)
- [Documentation and feedback](#documentation-and-feedback)

## What Kongming can do

- **Resume your work.** Click **Kongming** in the sidebar to open its dedicated chat. You can return to the same conversation after restarting Harness.
- **Delegate to another model.** Ask Kongming to start a new session with a model you have configured. When that session finishes, its result returns to Kongming. Expand **Kongming · Delegation** in the target session to see the original task and reply.
- **Keep long-term memory.** At the end of a task, Kongming can save preferences, decisions, and lessons worth carrying into future conversations.

[Watch the Kongming demo (MP4)](docs/assets/media.mp4)

## How it works

Kongming uses Harness sessions, models, tools, and approval rules. The first time you open Kongming, it creates a dedicated workspace in the Harness data directory and saves the session ID. To use a different workspace, set `projectDir` in the plugin settings before opening Kongming for the first time. An existing session keeps its assigned directory.

Kongming stores its session ID and memory files in `.kongming/` under the Harness data directory. New entries are appended to `MEMORY.md`, and the model reads from `MEMORY.frozen.md`. The plugin refreshes the snapshot when it reconnects to the session at startup and after a successful manual `/compact`.

## Install and enable

1. Open [DeepSeek Harness](https://www.deepseek.com/harness/). Kongming supports DSH `0.2.2-rc.1` and `0.2.2-alpha.2`. Configure a model before sending your first message.
2. In the sidebar, open **Plugins** → **Add Plugin**, paste the GitHub repository address below, and click **Install**.

   ```text
   https://github.com/KtKID/kmh-kongming.git
   ```

3. Choose **Enable Now**, then click **Kongming** in the sidebar. A single installation includes both Kongming and Memory. The repository includes prebuilt files, so you can install it without a local build.

You can also choose a version from [GitHub Releases](https://github.com/KtKID/kmh-kongming/releases) and paste its `.tgz` download URL into the same field.

## Quick start

Click **Kongming** in the sidebar and send “Introduce yourself in one sentence.” After it replies, click **Kongming** again to return to the same conversation. To try delegation, send “Ask another model to translate ‘The meeting is this afternoon’ into Chinese.” The new session shows the delegated task, and the result comes back to Kongming.

## Develop from source

Use Node.js 24 and pnpm 11.7.0. Run the following commands from the repository root. The last command creates `dist/kmh-kongming-<version>.tgz`. Paste the file’s absolute path into **Add Plugin** to try it locally.

```sh
pnpm install --frozen-lockfile
pnpm -r --filter './packages/*' run build
pnpm -r --filter './packages/*' test
pnpm build:git-bundle
pnpm pack:dsh
```

After changing Kongming or Memory, run `pnpm build:git-bundle` and commit the generated `prebuilt/` files alongside the source changes. CI checks that the files match the build output.

Kongming can also run as a Git submodule of kongming-os. See the [KMH integration guide](docs/kmh-integration.md) (Chinese) for configuration and build steps.

## Documentation and feedback

- [Kongming plugin](packages/kongming/README.md) (Chinese) · Dedicated session, workspace, persona, and delegation.
- [Memory plugin](packages/kongming-memory/README.md) (Chinese) · Memory files, snapshot refresh, and how to disable Memory.
- [Session delegation specification](docs/spec/kongming-session-dispatch-mvp/spec.md) (Chinese) · Task dispatch, replies, and how their origin appears in the UI.
- [GitHub Issues](https://github.com/KtKID/kmh-kongming/issues) · Installation and runtime issues.
