/**
 * 将两包已构建产物打成 DeepSeek Harness 可安装的单包。
 * 默认输入为发布输出目录。--git 将同一份构建输出写到仓库预编译入口。
 * 缺少产物或打包失败时退出并清理临时目录。
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const kongming = fileURLToPath(
  new URL("../packages/kongming/", import.meta.url),
);
const memory = fileURLToPath(
  new URL("../packages/kongming-memory/", import.meta.url),
);
const manifest = JSON.parse(
  await readFile(join(kongming, "package.json"), "utf8"),
);
const require = createRequire(join(kongming, "package.json"));
const { build, transform } = require("esbuild");
const memoryManifest = JSON.parse(
  await readFile(join(memory, "package.json"), "utf8"),
);
const root = fileURLToPath(new URL("../", import.meta.url));
const rootManifest = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const gitBundle = process.argv[2] === "--git";
const output = resolve(process.argv[2] ?? "dist");
const patchFile = manifest.dsh.bundle.patch;
const memoryEntry = `name: "${memoryManifest.name}"`;
const patch = await readFile(join(kongming, patchFile), "utf8");
if (!patch.includes(memoryEntry)) throw Error("安装配置缺少记忆插件实例");
const distributionPatch = patch.replace(
  memoryEntry,
  `name: "${manifest.name}/memory"`,
);
assert.equal(rootManifest.name, manifest.name);
assert.equal(rootManifest.version, manifest.version);
assert.deepEqual(rootManifest.dsh.client, manifest.dsh.client);

// DSH 从宿主解析这些依赖；打包版本无需下载另一套 Harness。
const { [manifest.name]: _kongming, ...memoryPeers } =
  memoryManifest.peerDependencies;
const peerDependencies = { ...memoryPeers, ...manifest.peerDependencies };
const dshVersions = rootManifest.engines.dsh;
for (const name of Object.keys(peerDependencies)) {
  if (name.startsWith("@deepseek-ai/dsh-"))
    peerDependencies[name] = dshVersions;
}
const releaseManifest = {
  name: manifest.name,
  version: manifest.version,
  description: manifest.description,
  type: manifest.type,
  main: manifest.main,
  engines: { dsh: dshVersions },
  exports: {
    ...manifest.exports,
    "./memory": "./lib/memory/index.js",
  },
  dsh: manifest.dsh,
  files: [
    "lib/src",
    "lib/browser-types",
    "lib/client.js",
    "lib/memory",
    "events.d.ts",
    "LICENSE-session-kit",
    "LICENSE-zod",
    patchFile,
  ],
  peerDependencies,
  peerDependenciesMeta: Object.fromEntries(
    Object.keys(peerDependencies).map((name) => [name, { optional: true }]),
  ),
};
const staging = await mkdtemp(join(tmpdir(), "kongming-dsh-pack-"));
try {
  await cp(join(kongming, "lib"), join(staging, "lib"), { recursive: true });
  await cp(join(memory, "lib/src"), join(staging, "lib/memory"), {
    recursive: true,
  });
  await cp(join(kongming, "events.d.ts"), join(staging, "events.d.ts"));
  await cp(
    join(kongming, "src/dispatch/session-kit/LICENSE"),
    join(staging, "LICENSE-session-kit"),
  );
  await cp(
    join(require.resolve("zod/package.json"), "..", "LICENSE"),
    join(staging, "LICENSE-zod"),
  );
  for (const [entry, outfile] of [
    [join(kongming, manifest.main), join(staging, manifest.main)],
    [
      join(memory, memoryManifest.main),
      join(staging, releaseManifest.exports["./memory"]),
    ],
  ]) {
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node24",
      external: ["@deepseek-ai/*"],
      minifyWhitespace: gitBundle,
      minifySyntax: gitBundle,
    });
  }
  await writeFile(join(staging, patchFile), distributionPatch);
  await writeFile(
    join(staging, "package.json"),
    JSON.stringify(releaseManifest, null, 2) + "\n",
  );
  for (const entry of [
    manifest.main,
    manifest.exports["./client"].default,
    releaseManifest.exports["./memory"],
  ]) {
    await readFile(join(staging, entry));
  }
  if (gitBundle) {
    const entries = [
      [manifest.main, rootManifest.exports["."]],
      [releaseManifest.exports["./memory"], rootManifest.exports["./memory"]],
      [patchFile, rootManifest.dsh.bundle.patch],
      ["LICENSE-session-kit", "prebuilt/LICENSE-session-kit"],
      ["LICENSE-zod", "prebuilt/LICENSE-zod"],
    ];
    await mkdir(join(root, "prebuilt"), { recursive: true });
    for (const [from, to] of entries)
      await cp(join(staging, from), join(root, to));
    const client = await readFile(
      join(staging, manifest.exports["./client"].default),
      "utf8",
    );
    const { code } = await transform(client, {
      minifyWhitespace: true,
      minifySyntax: true,
    });
    await writeFile(join(root, rootManifest.exports["./client"]), code);
  } else {
    await mkdir(output, { recursive: true });
    // npm pack 只打包暂存文件，安装时无需执行构建脚本。
    execFileSync(
      "npm",
      [
        "pack",
        "--ignore-scripts",
        "--cache",
        join(staging, ".npm-cache"),
        "--pack-destination",
        output,
      ],
      {
        cwd: staging,
        stdio: "inherit",
      },
    );
  }
} finally {
  await rm(staging, { recursive: true, force: true });
}
