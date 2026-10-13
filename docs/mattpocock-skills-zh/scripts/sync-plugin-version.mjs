#!/usr/bin/env node
// 将 package.json 的版本复制到 .claude-plugin/plugin.json。
// 作为 `npm run version` 的一部分，在 `changeset version` 后立即运行。
// 使用 --check 时不修改文件；两个版本不同时，以退出码 1 结束。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginPath = join(repo, ".claude-plugin", "plugin.json");

const { version } = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
const source = readFileSync(pluginPath, "utf8");
const plugin = JSON.parse(source);

if (plugin.version === version) {
  console.log(`plugin.json 版本为 ${version}（已经同步）`);
  process.exit(0);
}

if (process.argv.includes("--check")) {
  console.error(
    `plugin.json 版本为 ${plugin.version}，package.json 版本为 ${version}。请运行 \`node scripts/sync-plugin-version.mjs\`。`,
  );
  process.exit(1);
}

// 只重写版本所在行，保持键顺序和格式。
const updated = source.replace(
  /("version"\s*:\s*")[^"]*(")/,
  `$1${version}$2`,
);

if (JSON.parse(updated).version !== version) {
  console.error(`在 ${pluginPath} 中找不到可替换的 version 字段。`);
  process.exit(1);
}

writeFileSync(pluginPath, updated);
console.log(`plugin.json 版本 ${plugin.version} -> ${version}`);
