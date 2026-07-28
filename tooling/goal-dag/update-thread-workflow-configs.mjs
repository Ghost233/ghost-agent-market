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
codexManifest.description = "以长期 Codex 子线程执行 Owner DAG、显式 Review、递归子图和脚本生成的精简契约；原生 Goal 为可选桥接。";
codexManifest.keywords = [...new Set([
  ...codexManifest.keywords,
  "sub-thread-coordination",
  "thread-coordination",
  "explicit-review-dag",
  "task-supervisor",
])];
codexManifest.interface.shortDescription = "长期子线程 Owner DAG；契约和状态由脚本生成。";
codexManifest.interface.longDescription = "默认 standalone_thread，不强制 /goal。每个 Owner generation 复用长期子线程；gpt-5.6-luna/low 监督线程只等待结束或挂死并通知主线程。Review 显式入图，T2 可展开为 T2-1 子图。模型只提交最小语义输入，identity、digest、状态迁移、Registry、Result、Progress 和 Owner 变化均由脚本生成或应用。";
codexManifest.interface.defaultPrompt[0] = "使用 $sub-thread-coordination，以长期子线程完整执行 `./plan.md`；默认不创建 Goal。";
writeJson(codexManifestPath, codexManifest);

const claudePluginPath = "claude-code-market/.claude-plugin/plugin.json";
const claudePlugin = readJson(claudePluginPath);
const claudeVersion = bumpRequested ? bumpBase(claudePlugin.version) : baseVersion(claudePlugin.version);
claudePlugin.version = claudeVersion;
claudePlugin.description = "长期子线程 Owner DAG、显式 Review、递归子图与脚本化状态；缺少持久子线程 API 时 fail closed。";
claudePlugin.keywords.push("sub-thread-coordination", "thread-coordination", "explicit-review-dag");
claudePlugin.keywords.push("task-supervisor");
claudePlugin.keywords = [...new Set(claudePlugin.keywords)];
writeJson(claudePluginPath, claudePlugin);

const claudeMarketplacePath = "claude-code-market/.claude-plugin/marketplace.json";
const claudeMarketplace = readJson(claudeMarketplacePath);
const claudeEntry = claudeMarketplace.plugins.find((item) => item.name === "ghost-agent-workflow");
claudeEntry.version = claudeVersion;
claudeEntry.description = "Persistent sub-thread Owner DAGs with explicit Review nodes and script-managed state; fails closed without durable sub-thread APIs.";
claudeEntry.keywords.push("sub-thread-coordination", "thread-coordination", "explicit-review-dag");
claudeEntry.keywords.push("task-supervisor");
claudeEntry.keywords = [...new Set(claudeEntry.keywords)];
writeJson(claudeMarketplacePath, claudeMarketplace);

const kimiManifestPath = "kimi-market/plugins/ghost-agent-workflow/kimi.plugin.json";
const kimiManifest = readJson(kimiManifestPath);
kimiManifest.version = bumpRequested ? bumpBase(kimiManifest.version) : baseVersion(kimiManifest.version);
kimiManifest.description = "长期子线程 Owner DAG、显式 Review、递归子图与脚本化状态；缺少持久子线程 API 时 fail closed。";
kimiManifest.keywords.push("sub-thread-coordination", "thread-coordination", "explicit-review-dag");
kimiManifest.keywords.push("task-supervisor");
kimiManifest.keywords = [...new Set(kimiManifest.keywords)];
kimiManifest.interface.shortDescription = "持久子线程 Owner DAG；Review 显式入图，结构化状态只由脚本写入。";
kimiManifest.interface.longDescription = "默认 standalone_thread，不强制 Goal。支持 Owner 亲和、递归 composite 子图、显式 Review、gpt-5.6-luna/low 极简任务监督和独立 DAG 视图；模型只提交最小语义输入，契约与状态由脚本生成。";
writeJson(kimiManifestPath, kimiManifest);

const openaiYaml = `interface:\n  display_name: "子线程 DAG 控制器"\n  short_description: "长期 Owner 子线程、显式 Review、递归子图和只读进度页。"\n  default_prompt: "使用 $sub-thread-coordination，以长期子线程完整执行 ./plan.md；默认不创建 Goal。"\n\npolicy:\n  allow_implicit_invocation: false\n`;
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

const supervisorYaml = `interface:\n  display_name: "任务监督子线程"\n  short_description: "只等待任务结束或挂死，并通知主线程检查。"\n  default_prompt: "使用 $sub-thread-task-supervisor，持续等待已登记任务结束或挂死，并只通知主线程检查。"\n\npolicy:\n  allow_implicit_invocation: false\n`;
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
