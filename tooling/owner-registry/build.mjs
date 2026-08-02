import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePath = resolve(root, "tooling/owner-registry/owner-registry.ts");
const targets = [
  resolve(root, "claude-code-market/scripts/owner-registry.mjs"),
  resolve(root, "codex-market/plugins/ghost-agent-workflow/scripts/owner-registry.mjs"),
];
const source = readFileSync(sourcePath, "utf8");
const output = [
  "// Generated from tooling/owner-registry/owner-registry.ts. Do not edit directly.",
  stripTypeScriptTypes(source, { mode: "strip" }).replace(/[ \t]+$/gm, ""),
].join("\n");

for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, output, "utf8");
}

process.stdout.write(`${targets.join("\n")}\n`);
