import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePath = resolve(root, "tooling/goal-dag/goal-dag.ts");
const dashboardSourcePath = resolve(root, "tooling/goal-dag/dashboard.html");
const dashboardStarterSourcePath = resolve(root, "tooling/goal-dag/start-dashboard.mjs");
const targets = [
  {
    path: resolve(root, "codex-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs"),
    dashboardPath: resolve(root, "codex-market/plugins/ghost-agent-workflow/assets/goal-dag-dashboard.html"),
    dashboardStarterPath: resolve(root, "codex-market/plugins/ghost-agent-workflow/scripts/start-dashboard.mjs"),
    executionPlatform: "codex",
  },
  {
    path: resolve(root, "claude-code-market/scripts/goal-dag.mjs"),
    dashboardPath: resolve(root, "claude-code-market/assets/goal-dag-dashboard.html"),
    dashboardStarterPath: resolve(root, "claude-code-market/scripts/start-dashboard.mjs"),
    executionPlatform: "claude_code",
  },
  {
    path: resolve(root, "kimi-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs"),
    dashboardPath: resolve(root, "kimi-market/plugins/ghost-agent-workflow/assets/goal-dag-dashboard.html"),
    dashboardStarterPath: resolve(root, "kimi-market/plugins/ghost-agent-workflow/scripts/start-dashboard.mjs"),
    executionPlatform: "kimi",
  },
];
const source = readFileSync(sourcePath, "utf8");
const dashboard = readFileSync(dashboardSourcePath, "utf8");
const dashboardStarter = readFileSync(dashboardStarterSourcePath, "utf8");
const outputTemplate = [
  "// Generated from tooling/goal-dag/goal-dag.ts. Do not edit directly.",
  stripTypeScriptTypes(source, { mode: "strip" }).replace(/[ \t]+$/gm, ""),
].join("\n");

for (const target of targets) {
  const output = outputTemplate.replaceAll(
    "__EXECUTION_PLATFORM__",
    target.executionPlatform,
  );
  mkdirSync(dirname(target.path), { recursive: true });
  writeFileSync(target.path, output, "utf8");
  mkdirSync(dirname(target.dashboardPath), { recursive: true });
  writeFileSync(target.dashboardPath, dashboard, "utf8");
  mkdirSync(dirname(target.dashboardStarterPath), { recursive: true });
  writeFileSync(target.dashboardStarterPath, dashboardStarter, { encoding: "utf8", mode: 0o755 });
}

process.stdout.write(`${targets.flatMap(({ path, dashboardPath, dashboardStarterPath }) => [path, dashboardPath, dashboardStarterPath]).join("\n")}\n`);
