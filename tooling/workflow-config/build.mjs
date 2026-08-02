import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePath = resolve(root, "tooling/workflow-config/workflow-config.mjs");
const targets = [
  resolve(root, "codex-market/plugins/ghost-agent-workflow/scripts/workflow-config.mjs"),
  resolve(root, "claude-code-market/scripts/workflow-config.mjs"),
];
const source = readFileSync(sourcePath, "utf8");

for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source, { encoding: "utf8", mode: 0o755 });
}

process.stdout.write(`${targets.join("\n")}\n`);
