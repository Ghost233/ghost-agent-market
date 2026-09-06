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

function skillKeywords(keywords) {
  return [...new Set([
    ...keywords.filter((keyword) => keyword !== "conditional-review"),
    "deterministic-script",
    "single-executor",
    "explicit-paths",
    "content-fingerprint",
  ])];
}

const codexManifestPath = "codex-market/plugins/ghost-agent-skills/.codex-plugin/plugin.json";
const codexManifest = readJson(codexManifestPath);
const codexBase = bumpRequested ? bumpBase(codexManifest.version) : baseVersion(codexManifest.version);
codexManifest.version = codexBase + "+codex." + timestamp;
codexManifest.keywords = skillKeywords(codexManifest.keywords);
writeJson(codexManifestPath, codexManifest);

const claudePluginPath = "claude-code-market/plugins/ghost-agent-skills/.claude-plugin/plugin.json";
const claudePlugin = readJson(claudePluginPath);
claudePlugin.version = bumpRequested ? bumpBase(claudePlugin.version) : baseVersion(claudePlugin.version);
claudePlugin.keywords = skillKeywords(claudePlugin.keywords);
writeJson(claudePluginPath, claudePlugin);

const zcodePluginPath = "claude-code-market/plugins/ghost-agent-skills/.zcode-plugin/plugin.json";
const zcodePlugin = readJson(zcodePluginPath);
zcodePlugin.version = bumpRequested ? bumpBase(zcodePlugin.version) : baseVersion(zcodePlugin.version);
zcodePlugin.keywords = skillKeywords(zcodePlugin.keywords);
writeJson(zcodePluginPath, zcodePlugin);

process.stdout.write(
  "ghost-agent-skills configs updated; versions codex=" + codexManifest.version +
  " claude=" + claudePlugin.version + " zcode=" + zcodePlugin.version + "\n"
);
