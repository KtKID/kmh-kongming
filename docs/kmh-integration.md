# 在 KMH 中集成孔明

kongming-os 通过 `packages/kmh-plugin/kmh-kongming` 子模块加载孔明。按 [kongming-os 安装说明](https://github.com/KtKID/kongming-os#安装与启动)准备宿主，完成子模块初始化后，将孔明子模块切到要使用的版本。后续运行 `pnpm run setup` 会再次检出宿主记录的子模块版本。

在宿主的 `profiles/kmh-web/package.json` 中保留以下本地包链接，将 `@kmh/kongming` 加入 `dsh.profile.bundles`。孔明的[安装配置](../packages/kongming/cordis.patch.yml)同时登记孔明和记忆两个实例。

```json
{
  "dependencies": {
    "@kmh/kongming": "link:../../packages/kmh-plugin/kmh-kongming/packages/kongming",
    "@kmh/kongming-memory-v1": "link:../../packages/kmh-plugin/kmh-kongming/packages/kongming-memory"
  },
  "dsh": {
    "profile": {
      "bundles": ["@kmh/kongming"]
    }
  }
}
```

从旧版迁移时，移除 `bundles` 中独立的 `@kmh/kongming-memory-v1` 条目。只使用基础聊天和委派时，在 Web profile 的 `cordis.patch.yml` 中覆盖记忆实例。

```yaml
- id: kongming-memory-v1
  disabled: true
```

在 kongming-os 根目录构建并启动。已有孔明会话会沿用绑定的路径。部署也可以继续使用 `KMH_KONGMING_PROJECT_DIR` 指定目录。

```sh
pnpm --filter @kmh/kongming --filter @kmh/kongming-memory-v1 run build
pnpm web
```

KMH 将 `KMH_HOME` 映射为 `DSH_HOME`。会话身份与记忆文件都位于该目录的 `.kongming/`。两个包重建 `lib/` 后，重启 Web 以加载新产物。
