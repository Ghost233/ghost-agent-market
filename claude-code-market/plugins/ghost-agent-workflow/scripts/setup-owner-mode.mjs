#!/usr/bin/env node
// setup-owner-mode.mjs —— 把 owner 模式运行时文件铺设到目标项目。
//
// owner 模式（start-owner-team）依赖：
//   <project>/.claude/agents/owner-worker.md      （CC 只从项目 .claude/agents/ 加载 agent，且只有这里 frontmatter hooks 生效）
//   <project>/.ghost-agent-workflow/hooks/enforce-scope.sh  （owner-worker frontmatter hook 调用）
//   <project>/.ghost-agent-workflow/hooks/place-binding.sh  （owner-worker 首条指令自投放绑定指针）
//
// 这些文件作为 plugin 资源随插件发布（resources/），但不会自动落到用户项目——
// 因为 CC 会忽略 plugin agent 的 frontmatter hooks（见 CONTEXT.md 与 CC plugin 文档），
// 必须由本脚本复制进项目 .claude/agents/ 才能让 enforce-scope 真正触发。
//
// 用法： node setup-owner-mode.mjs [<project-root>]
//   <project-root> 默认 $CLAUDE_PROJECT_DIR，再退到 cwd。

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, "..");
const resourcesDir = join(pluginRoot, "resources");

const projectRoot = resolve(
  process.argv[2] || process.env.CLAUDE_PROJECT_DIR || process.cwd()
);

const targets = [
  {
    from: join(resourcesDir, "owner-worker.md"),
    to: join(projectRoot, ".claude", "agents", "owner-worker.md"),
    executable: false,
  },
  {
    from: join(resourcesDir, "hooks", "enforce-scope.sh"),
    to: join(projectRoot, ".ghost-agent-workflow", "hooks", "enforce-scope.sh"),
    executable: true,
  },
  {
    from: join(resourcesDir, "hooks", "place-binding.sh"),
    to: join(projectRoot, ".ghost-agent-workflow", "hooks", "place-binding.sh"),
    executable: true,
  },
];

function read(p) {
  return readFileSync(p, "utf8");
}

let createdAgentsDir = false;
const laid = [];
const differed = [];
const unchanged = [];

for (const t of targets) {
  if (!existsSync(t.from)) {
    console.error(`setup-owner-mode: 缺少资源文件 ${t.from}——插件包不完整`);
    process.exit(1);
  }
  const content = read(t.from);
  const isNewAgentsTarget = t.to.endsWith(join(".claude", "agents", "owner-worker.md"));
  const targetDirExisted = existsSync(dirname(t.to));
  if (existsSync(t.to) && read(t.to) === content) {
    unchanged.push(t.to);
    continue;
  }
  if (existsSync(t.to) && read(t.to) !== content) {
    differed.push(t.to);
    continue;
  }
  mkdirSync(dirname(t.to), { recursive: true });
  writeFileSync(t.to, content, "utf8");
  if (t.executable) chmodSync(t.to, 0o755);
  if (isNewAgentsTarget && !targetDirExisted) createdAgentsDir = true;
  laid.push(t.to);
}

console.log("setup-owner-mode: 项目根 = " + projectRoot);
if (laid.length) {
  console.log("已铺设：");
  for (const p of laid) console.log("  + " + p);
}
if (unchanged.length) {
  console.log("已就位（内容一致，跳过）：");
  for (const p of unchanged) console.log("  = " + p);
}
if (differed.length) {
  console.log("⚠️ 已存在但内容不同（未覆盖，需手动确认）：");
  for (const p of differed) console.log("  ! " + p);
}

if (createdAgentsDir) {
  console.log("");
  console.log("⚠️ 首次新建了 .claude/agents/ —— 必须重启 Claude Code 会话才能加载 owner-worker subagent。");
}
if (differed.length) {
  console.log("");
  console.log("存在内容冲突，owner 模式可能未就绪。请核对上述文件后重跑。");
  process.exit(2);
}
console.log("");
console.log("owner 模式文件就绪。下一步：在 .ghost-agent-workflow/owners/ 下建 owner 定义，然后跑 /start-owner-team。");
