import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";


const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePath = resolve(root, "tooling/thread-plan/thread-plan.ts");
const targets = [
  {
    path: resolve(root, "codex-market/plugins/ghost-agent-workflow/scripts/thread-plan.mjs"),
    executionPlatform: "codex",
  },
  {
    path: resolve(root, "claude-code-market/scripts/thread-plan.mjs"),
    executionPlatform: "claude_code",
  },
];
const source = readFileSync(sourcePath, "utf8");
const outputTemplate = [
  "// Generated from tooling/thread-plan/thread-plan.ts. Do not edit directly.",
  stripTypeScriptTypes(source, { mode: "strip" }),
].join("\n");

for (const target of targets) {
  const output = outputTemplate.replaceAll(
    "__EXECUTION_PLATFORM__",
    target.executionPlatform,
  );
  mkdirSync(dirname(target.path), { recursive: true });
  writeFileSync(target.path, output, "utf8");
}

process.stdout.write(`${targets.map(({ path }) => path).join("\n")}\n`);
