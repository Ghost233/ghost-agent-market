import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

function writeJson(relativePath, value) {
  writeFileSync(join(root, relativePath), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const bumpRequested = process.argv.includes("--bump-base");
if (process.argv.some((argument) => argument.startsWith("--") && argument !== "--bump-base")) {
  throw new Error("usage: update-thread-workflow-configs.mjs [--bump-base]");
}

function baseVersion(version) {
  return version.split("+", 1)[0];
}

function bumpBase(version) {
  const parts = baseVersion(version).split(".").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`invalid base version: ${version}`);
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

const codexManifestPath = "codex-market/plugins/ghost-agent-workflow/.codex-plugin/plugin.json";
const codexManifest = readJson(codexManifestPath);
const codexBase = bumpRequested ? bumpBase(codexManifest.version) : baseVersion(codexManifest.version);
codexManifest.version = `${codexBase}+codex.${timestamp}`;
codexManifest.description = "由用户明确选择串行 Quick Owner 或最多八线程的最小 DAG；Owner、显式 Review、机械验收和最终结果均由脚本状态机管理。";
codexManifest.keywords = [...new Set([
  ...codexManifest.keywords,
  "sub-thread-coordination",
  "thread-coordination",
  "explicit-review-dag",
  "workflow-setup",
  "planner-reviewer",
  "task-supervisor",
])];
codexManifest.interface.shortDescription = "先选择 Quick 或 DAG，再运行脚本化 Owner 工作流。";
codexManifest.interface.longDescription = "启动前要求用户明确选择串行 Quick 或最小 DAG；DAG Supervisor 在原生 Goal 内持续监督最多八个真实 ready 线程。";
codexManifest.interface.defaultPrompt[0] = "使用 $sub-thread-coordination 执行 `./plan.md`；如果我未指定 Quick 或 DAG，先要求我选择运行模式。";
if (!codexManifest.interface.defaultPrompt.some((prompt) => prompt.includes("$setup-sub-thread-workflow"))) {
  codexManifest.interface.defaultPrompt.push("使用 $setup-sub-thread-workflow 初始化当前仓库的子线程模型与八路并行配置。");
}
writeJson(codexManifestPath, codexManifest);

const claudePluginPath = "claude-code-market/.claude-plugin/plugin.json";
const claudePlugin = readJson(claudePluginPath);
const claudeVersion = bumpRequested ? bumpBase(claudePlugin.version) : baseVersion(claudePlugin.version);
claudePlugin.version = claudeVersion;
claudePlugin.description = "由用户选择串行 Quick Owner 或最多八线程的最小 DAG；缺少持久子线程 API 时 fail closed。";
claudePlugin.keywords.push("sub-thread-coordination", "thread-coordination", "explicit-review-dag");
claudePlugin.keywords = [...new Set([
  ...claudePlugin.keywords,
  "workflow-setup",
  "planner-reviewer",
  "task-supervisor",
])];
writeJson(claudePluginPath, claudePlugin);

const claudeMarketplacePath = "claude-code-market/.claude-plugin/marketplace.json";
const claudeMarketplace = readJson(claudeMarketplacePath);
const claudeEntry = claudeMarketplace.plugins.find((item) => item.name === "ghost-agent-workflow");
claudeEntry.version = claudeVersion;
claudeEntry.description = "A script-driven Owner workflow that requires choosing serial Quick or a minimal DAG with up to eight persistent sub-threads.";
claudeEntry.keywords.push("sub-thread-coordination", "thread-coordination", "explicit-review-dag");
claudeEntry.keywords = [...new Set([
  ...claudeEntry.keywords,
  "workflow-setup",
  "planner-reviewer",
  "task-supervisor",
])];
writeJson(claudeMarketplacePath, claudeMarketplace);

const kimiManifestPath = "kimi-market/plugins/ghost-agent-workflow/kimi.plugin.json";
const kimiManifest = readJson(kimiManifestPath);
kimiManifest.version = bumpRequested ? bumpBase(kimiManifest.version) : baseVersion(kimiManifest.version);
kimiManifest.description = "由用户选择串行 Quick Owner 或最多八线程的最小 DAG；缺少持久子线程 API 时 fail closed。";
kimiManifest.keywords.push("sub-thread-coordination", "thread-coordination", "explicit-review-dag");
kimiManifest.keywords = [...new Set([
  ...kimiManifest.keywords,
  "workflow-setup",
  "planner-reviewer",
  "task-supervisor",
])];
kimiManifest.interface.shortDescription = "先选择 Quick 或 DAG，再运行脚本化 Owner 工作流。";
kimiManifest.interface.longDescription = "启动前要求用户明确选择串行 Quick 或最小 DAG；DAG Supervisor 在宿主长期线程内持续监督最多八个真实 ready 线程。";
writeJson(kimiManifestPath, kimiManifest);

const openaiYaml = `interface:\n  display_name: "Owner 工作流协调器"\n  short_description: "要求用户选择 Quick 或 DAG，再协调长期 Owner 线程。"\n  default_prompt: "使用 $sub-thread-coordination；如果我没有明确指定 Quick 或 DAG，先要求我选择运行模式，确认后再启动。"\n\npolicy:\n  allow_implicit_invocation: false\n`;
for (const relativePath of [
  "codex-market/plugins/ghost-agent-workflow/skills/sub-thread-coordination/agents/openai.yaml",
  "claude-code-market/skills/sub-thread-coordination/agents/openai.yaml",
]) writeFileSync(join(root, relativePath), openaiYaml, "utf8");

const plannerYaml = `interface:\n  display_name: "最小 DAG 规划器"\n  short_description: "生成最小顶层 DAG、显式 Review 和按需内部子图。"\n  default_prompt: "使用 $parallel-task-planner，为剩余工作生成最小顶层 DAG。"\n\npolicy:\n  allow_implicit_invocation: false\n`;
for (const relativePath of [
  "codex-market/plugins/ghost-agent-workflow/skills/parallel-task-planner/agents/openai.yaml",
  "claude-code-market/skills/parallel-task-planner/agents/openai.yaml",
]) writeFileSync(join(root, relativePath), plannerYaml, "utf8");

const workerYaml = `interface:\n  display_name: "Owner 工作线程"\n  short_description: "执行一个脚本绑定的 Quick、DAG 或独立 Review run。"\n  default_prompt: "使用 $sub-thread-goal-worker，读取当前 run Binding 并通过固定动作提交结果。"\n\npolicy:\n  allow_implicit_invocation: false\n`;
for (const relativePath of [
  "codex-market/plugins/ghost-agent-workflow/skills/sub-thread-goal-worker/agents/openai.yaml",
  "claude-code-market/skills/sub-thread-goal-worker/agents/openai.yaml",
]) writeFileSync(join(root, relativePath), workerYaml, "utf8");

const reviewerYaml = `interface:\n  display_name: "DAG 规划审查"\n  short_description: "在 Plan 激活前审查最小 DAG 的真实并行度与结构复杂度。"\n  default_prompt: "使用 $planner-reviewer，审查当前最小 DAG 的并行度和结构复杂度。"\n\npolicy:\n  allow_implicit_invocation: false\n`;
for (const relativePath of [
  "codex-market/plugins/ghost-agent-workflow/skills/planner-reviewer/agents/openai.yaml",
  "claude-code-market/skills/planner-reviewer/agents/openai.yaml",
]) writeFileSync(join(root, relativePath), reviewerYaml, "utf8");

const setupYaml = `interface:\n  display_name: "子线程工作流设置"\n  short_description: "通过脚本配置五组模型 profile 和最多八路并发。"\n  default_prompt: "使用 $setup-sub-thread-workflow 初始化当前仓库的子线程模型与并行配置。"\n\npolicy:\n  allow_implicit_invocation: false\n`;
for (const relativePath of [
  "codex-market/plugins/ghost-agent-workflow/skills/setup-sub-thread-workflow/agents/openai.yaml",
  "claude-code-market/skills/setup-sub-thread-workflow/agents/openai.yaml",
]) {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, setupYaml, "utf8");
}

const supervisorMetadata = [
  {
    path: "codex-market/plugins/ghost-agent-workflow/skills/sub-thread-task-supervisor/agents/openai.yaml",
    shortDescription: "在原生 Goal 内静默监督 Main 已登记的最多八个执行线程。",
  },
  {
    path: "claude-code-market/skills/sub-thread-task-supervisor/agents/openai.yaml",
    shortDescription: "在宿主长期线程内静默监督 Main 已登记的最多八个执行线程。",
  },
];
for (const { path: relativePath, shortDescription } of supervisorMetadata) {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `interface:\n  display_name: "DAG 任务监督"\n  short_description: "${shortDescription}"\n  default_prompt: "使用 $sub-thread-task-supervisor，按脚本 action 静默等待并通知当前 DAG 执行线程。"\n\npolicy:\n  allow_implicit_invocation: false\n`, "utf8");
}

process.stdout.write(
  `thread workflow configs updated; versions codex=${codexManifest.version} ` +
  `claude=${claudeVersion} kimi=${kimiManifest.version}\n`,
);
