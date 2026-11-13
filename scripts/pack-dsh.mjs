/**
 * 将两包已构建产物打成 DeepSeek Harness 可安装的单包。
 * 输入为输出目录，版本取孔明包清单。缺少产物或打包失败时退出并清理临时目录。
 */
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
const { build } = require("esbuild");
const memoryManifest = JSON.parse(
  await readFile(join(memory, "package.json"), "utf8"),
);
const output = resolve(process.argv[2] ?? "dist");
const patchFile = manifest.dsh.bundle.patch;
const memoryEntry = `name: "${memoryManifest.name}"`;
const patch = await readFile(join(kongming, patchFile), "utf8");
if (!patch.includes(memoryEntry)) throw Error("安装配置缺少记忆插件实例");

// DSH 从宿主解析这些依赖；打包版本无需下载另一套 Harness。
const { [manifest.name]: _kongming, ...memoryPeers } =
  memoryManifest.peerDependencies;
const peerDependencies = { ...memoryPeers, ...manifest.peerDependencies };
const dshVersions = "0.2.2-alpha.2 || 0.2.2-rc.1";
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
  await mkdir(output, { recursive: true });
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
    });
  }
  await writeFile(
    join(staging, patchFile),
    patch.replace(memoryEntry, `name: "${manifest.name}/memory"`),
  );
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
} finally {
  await rm(staging, { recursive: true, force: true });
}
