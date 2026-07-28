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
codexManifest.description = "以最多八个长期 Codex 子线程执行 Owner DAG、Planner Reviewer、显式 Review 和递归子图；脚本化 Supervisor 静默创建、中文命名、等待和通知。";
codexManifest.keywords = [...new Set([
  ...codexManifest.keywords,
  "sub-thread-coordination",
  "thread-coordination",
  "explicit-review-dag",
  "workflow-setup",
  "planner-reviewer",
  "task-supervisor",
])];
codexManifest.interface.shortDescription = "脚本化 Supervisor 静默管理八个中文命名子线程。";
codexManifest.interface.longDescription = "默认 standalone_thread，不强制 /goal。Main 直接启动后台 Dashboard；gpt-5.6-luna/medium Supervisor 只消费机器收据，静默创建、中文命名、等待和通知最多八个执行子线程。Planner Reviewer 在激活前检查 DAG 结构，机械 gate 不创建模型线程。";
codexManifest.interface.defaultPrompt[0] = "使用 $sub-thread-coordination，以长期子线程完整执行 `./plan.md`；默认不创建 Goal。";
if (!codexManifest.interface.defaultPrompt.some((prompt) => prompt.includes("$setup-sub-thread-workflow"))) {
  codexManifest.interface.defaultPrompt.push("使用 $setup-sub-thread-workflow 初始化当前仓库的子线程模型与八路并行配置。");
}
writeJson(codexManifestPath, codexManifest);

const claudePluginPath = "claude-code-market/.claude-plugin/plugin.json";
const claudePlugin = readJson(claudePluginPath);
const claudeVersion = bumpRequested ? bumpBase(claudePlugin.version) : baseVersion(claudePlugin.version);
claudePlugin.version = claudeVersion;
claudePlugin.description = "脚本化 Supervisor 静默管理最多八个中文命名长期子线程的 Owner DAG、Planner Reviewer、显式 Review 和递归子图；缺少持久子线程 API 时 fail closed。";
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
claudeEntry.description = "A script-driven Supervisor manages up to eight persistent sub-threads with a pre-activation Planner Reviewer and explicit Review nodes.";
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
kimiManifest.description = "脚本化 Supervisor 静默管理最多八个中文命名长期子线程的 Owner DAG、Planner Reviewer、显式 Review 和递归子图；缺少持久子线程 API 时 fail closed。";
kimiManifest.keywords.push("sub-thread-coordination", "thread-coordination", "explicit-review-dag");
kimiManifest.keywords = [...new Set([
  ...kimiManifest.keywords,
  "workflow-setup",
  "planner-reviewer",
  "task-supervisor",
])];
kimiManifest.interface.shortDescription = "脚本化 Supervisor 静默管理八个中文命名子线程。";
kimiManifest.interface.longDescription = "默认 standalone_thread，不强制 Goal。Main 直接启动后台 Dashboard；gpt-5.6-luna/medium Supervisor 只消费机器收据，静默创建、中文命名、等待和通知最多八个执行子线程。Planner Reviewer 在激活前检查 DAG 结构，机械 gate 不创建模型线程。";
writeJson(kimiManifestPath, kimiManifest);

const openaiYaml = `interface:\n  display_name: "子线程 DAG 控制器"\n  short_description: "最多八个长期子线程、显式 Review、递归子图和进度页。"\n  default_prompt: "使用 $sub-thread-coordination，以长期子线程完整执行 ./plan.md；默认不创建 Goal。"\n\npolicy:\n  allow_implicit_invocation: false\n`;
for (const relativePath of [
  "codex-market/plugins/ghost-agent-workflow/skills/sub-thread-coordination/agents/openai.yaml",
  "claude-code-market/skills/sub-thread-coordination/agents/openai.yaml",
]) writeFileSync(join(root, relativePath), openaiYaml, "utf8");

const plannerYaml = `interface:\n  display_name: "并行任务规划器"\n  short_description: "供子线程控制器生成 coverage、Owner/task DAG 与局部修订。"\n\npolicy:\n  allow_implicit_invocation: false\n`;
for (const relativePath of [
  "codex-market/plugins/ghost-agent-workflow/skills/parallel-task-planner/agents/openai.yaml",
  "claude-code-market/skills/parallel-task-planner/agents/openai.yaml",
]) writeFileSync(join(root, relativePath), plannerYaml, "utf8");

const workerYaml = `interface:\n  display_name: "子线程 Goal Worker"\n  short_description: "在已绑定的持久子线程内执行一个 fenced task attempt。"\n\npolicy:\n  allow_implicit_invocation: false\n`;
for (const relativePath of [
  "codex-market/plugins/ghost-agent-workflow/skills/sub-thread-goal-worker/agents/openai.yaml",
  "claude-code-market/skills/sub-thread-goal-worker/agents/openai.yaml",
]) writeFileSync(join(root, relativePath), workerYaml, "utf8");

const reviewerYaml = `interface:\n  display_name: "Planner Reviewer"\n  short_description: "在 Plan 激活前审查 DAG 的并行度与结构复杂度。"\n  default_prompt: "使用 $planner-reviewer 审查当前 DAG draft 的并行度与结构复杂度。"\n\npolicy:\n  allow_implicit_invocation: false\n`;
for (const relativePath of [
  "codex-market/plugins/ghost-agent-workflow/skills/planner-reviewer/agents/openai.yaml",
  "claude-code-market/skills/planner-reviewer/agents/openai.yaml",
]) writeFileSync(join(root, relativePath), reviewerYaml, "utf8");

const setupYaml = `interface:\n  display_name: "子线程工作流设置"\n  short_description: "通过脚本配置四组模型 profile 和最多八路并发。"\n  default_prompt: "使用 $setup-sub-thread-workflow 初始化当前仓库的子线程模型与并行配置。"\n\npolicy:\n  allow_implicit_invocation: false\n`;
for (const relativePath of [
  "codex-market/plugins/ghost-agent-workflow/skills/setup-sub-thread-workflow/agents/openai.yaml",
  "claude-code-market/skills/setup-sub-thread-workflow/agents/openai.yaml",
]) {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, setupYaml, "utf8");
}

const supervisorYaml = `interface:\n  display_name: "任务监督子线程"\n  short_description: "静默创建、中文命名并等待最多八个执行线程。"\n  default_prompt: "使用 $sub-thread-task-supervisor，通过机器收据静默监督当前 Goal 的执行线程。"\n\npolicy:\n  allow_implicit_invocation: false\n`;
for (const relativePath of [
  "codex-market/plugins/ghost-agent-workflow/skills/sub-thread-task-supervisor/agents/openai.yaml",
  "claude-code-market/skills/sub-thread-task-supervisor/agents/openai.yaml",
]) {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, supervisorYaml, "utf8");
}

process.stdout.write(
  `thread workflow configs updated; versions codex=${codexManifest.version} ` +
  `claude=${claudeVersion} kimi=${kimiManifest.version}\n`,
);
