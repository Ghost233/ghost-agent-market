import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";


const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePath = resolve(root, "tooling/thread-plan/thread-plan.ts");
const targets = [
  resolve(root, "codex-market/plugins/ghost-agent-workflow/scripts/thread-plan.mjs"),
  resolve(root, "claude-code-market/scripts/thread-plan.mjs"),
];
const source = readFileSync(sourcePath, "utf8");
const output = [
  "// Generated from tooling/thread-plan/thread-plan.ts. Do not edit directly.",
  stripTypeScriptTypes(source, { mode: "strip" }),
].join("\n");

for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, output, "utf8");
}

process.stdout.write(`${targets.join("\n")}\n`);
