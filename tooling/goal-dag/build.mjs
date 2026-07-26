import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const targets = [
  {
    source: "tooling/goal-dag/goal-dag.ts",
    path: resolve(root, "codex-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs"),
    executionPlatform: "codex",
  },
  {
    source: "tooling/goal-dag/goal-dag-claude.ts",
    path: resolve(root, "claude-code-market/scripts/goal-dag.mjs"),
    executionPlatform: "claude_code",
  },
];

for (const target of targets) {
  const source = readFileSync(resolve(root, target.source), "utf8");
  const output = [
    `// Generated from ${target.source}. Do not edit directly.`,
    stripTypeScriptTypes(source, { mode: "strip" }).replace(/[ \t]+$/gm, ""),
  ]
    .join("\n")
    .replaceAll("__EXECUTION_PLATFORM__", target.executionPlatform);
  mkdirSync(dirname(target.path), { recursive: true });
  writeFileSync(target.path, output, "utf8");
}

process.stdout.write(`${targets.map(({ path }) => path).join("\n")}\n`);
