import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

function writeJson(relativePath, value) {
  writeFileSync(join(root, relativePath), JSON.stringify(value, null, 2) + "\n", "utf8");
}

const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const bumpRequested = process.argv.includes("--bump-base");
if (process.argv.some((argument) => argument.startsWith("--") && argument !== "--bump-base")) {
  throw new Error("usage: update-ghost-agent-skills.mjs [--bump-base]");
}

function baseVersion(version) {
  return version.split("+", 1)[0];
}

function bumpBase(version) {
  const parts = baseVersion(version).split(".").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error("invalid base version: " + version);
  }
  parts[2] += 1;
  if (parts[2] === 10) {
    parts[2] = 0;
    parts[1] += 1;
  }
  if (parts[1] === 10) {
    parts[1] = 0;
    parts[0] += 1;
  }
  return parts.join(".");
}

const codexManifestPath = "codex-market/plugins/ghost-agent-skills/.codex-plugin/plugin.json";
const codexManifest = readJson(codexManifestPath);
const codexBase = bumpRequested ? bumpBase(codexManifest.version) : baseVersion(codexManifest.version);
codexManifest.version = codexBase + "+codex." + timestamp;
codexManifest.description = "检查当前仓库改动并创建规范的中文 Git 提交。";
codexManifest.keywords = [...new Set([
  ...codexManifest.keywords,
  "deterministic-script",
  "single-executor",
  "conditional-review",
])];
codexManifest.interface.shortDescription = "检查当前改动并创建规范的中文 Git 提交。";
codexManifest.interface.longDescription = "分析 staged、unstaged、untracked 与 submodule 变更，按职责拆分批次并创建规范的中文 Git 提交。";
writeJson(codexManifestPath, codexManifest);

const claudePluginPath = "claude-code-market/plugins/ghost-agent-skills/.claude-plugin/plugin.json";
const claudePlugin = readJson(claudePluginPath);
claudePlugin.version = bumpRequested ? bumpBase(claudePlugin.version) : baseVersion(claudePlugin.version);
claudePlugin.description = "检查当前仓库改动并创建规范的中文 Git 提交。";
claudePlugin.keywords = [...new Set([
  ...claudePlugin.keywords,
  "deterministic-script",
  "single-executor",
  "conditional-review",
])];
writeJson(claudePluginPath, claudePlugin);

const kimiManifestPath = "kimi-market/plugins/ghost-agent-skills/kimi.plugin.json";
const kimiManifest = readJson(kimiManifestPath);
kimiManifest.version = bumpRequested ? bumpBase(kimiManifest.version) : baseVersion(kimiManifest.version);
kimiManifest.description = "检查当前仓库改动并创建规范的中文 Git 提交。";
kimiManifest.keywords = [...new Set([
  ...kimiManifest.keywords,
  "deterministic-script",
  "single-executor",
  "conditional-review",
])];
kimiManifest.interface.shortDescription = "检查当前改动并创建规范的中文 Git 提交。";
kimiManifest.interface.longDescription = "分析 staged、unstaged、untracked 与 submodule 变更，按职责拆分批次并创建规范的中文 Git 提交。";
writeJson(kimiManifestPath, kimiManifest);

process.stdout.write(
  "ghost-agent-skills configs updated; versions codex=" + codexManifest.version +
  " claude=" + claudePlugin.version + " kimi=" + kimiManifest.version + "\n"
);
