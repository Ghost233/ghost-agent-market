import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const codexRoot = join(
  repositoryRoot,
  "codex-market/plugins/ghost-agent-workflow/skills",
);

const synchronizedFiles = [
  "parallel-task-planner/SKILL.md",
  "parallel-task-planner/references/templates.md",
  "planner-reviewer/SKILL.md",
  "setup-sub-thread-workflow/SKILL.md",
  "start-dag-dashboard/SKILL.md",
  "sub-thread-goal-worker/SKILL.md",
  "sub-thread-goal-worker/references/templates.md",
  "sub-thread-task-supervisor/SKILL.md",
  "sub-thread-coordination/references/owner-governance.md",
  "sub-thread-coordination/references/templates.md",
];

const targets = [
  {
    platform: "Claude Code",
    root: join(repositoryRoot, "claude-code-market/skills"),
  },
  {
    platform: "Kimi Code",
    root: join(repositoryRoot, "kimi-market/plugins/ghost-agent-workflow/skills"),
  },
];

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

for (const target of targets) {
  for (const relativePath of synchronizedFiles) {
    write(
      join(target.root, relativePath),
      readFileSync(join(codexRoot, relativePath), "utf8"),
    );
  }

  const coordinatorSource = readFileSync(
    join(codexRoot, "sub-thread-coordination/SKILL.md"),
    "utf8",
  );
  const platformBoundary = [
    "",
    `> 平台差异：${target.platform} 只有在宿主提供可创建、发送和等待的长期子线程 API 时才能执行本工作流。标准 Agent 不具备用户长期持有上下文与完成约束，禁止作为回退；缺少子线程 API 时必须在规划后 fail closed。本平台固定使用 \`standalone_thread\`，不包含原生 Goal 桥接。`,
    "",
  ].join("\n");
  write(
    join(target.root, "sub-thread-coordination/SKILL.md"),
    coordinatorSource
      .replace(
        "Codex 默认使用 `standalone_thread`；只有用户明确使用原生 Goal 时，DAG 才绑定 `codex_native`，并在本地结果完成后桥接。",
        "本平台固定使用 `standalone_thread`，不包含 Codex 原生 Goal 桥接。",
      )
      .replace(
        "# 子线程工作流协调器\n",
        `# 子线程工作流协调器\n${platformBoundary}`,
      ),
  );

  const goalContractSource = readFileSync(
    join(codexRoot, "sub-thread-coordination/references/goal-contract.md"),
    "utf8",
  );
  write(
    join(target.root, "sub-thread-coordination/references/goal-contract.md"),
    goalContractSource.replace(
      "Codex Quick 不创建原生 Goal。DAG 默认使用 `standalone_thread`；用户明确启动原生 Goal 时才使用 `codex_native`，并在本地 `result.json` 完成后桥接。等待 Owner 或 Review 不映射为原生 blocked。",
      `${target.platform} 固定使用 \`standalone_thread\`，不包含 Codex 原生 Goal 桥接。`,
    ),
  );
}

for (const relativePath of [
  "parallel-task-planner/agents/openai.yaml",
  "planner-reviewer/agents/openai.yaml",
  "setup-sub-thread-workflow/agents/openai.yaml",
  "start-dag-dashboard/agents/openai.yaml",
  "sub-thread-coordination/agents/openai.yaml",
  "sub-thread-goal-worker/agents/openai.yaml",
  "sub-thread-task-supervisor/agents/openai.yaml",
]) {
  write(
    join(repositoryRoot, "claude-code-market/skills", relativePath),
    readFileSync(join(codexRoot, relativePath), "utf8"),
  );
}

for (const skill of ["start-dag-dashboard"]) {
  const path = join(repositoryRoot, "claude-code-market/skills", skill, "SKILL.md");
  write(
    path,
    readFileSync(path, "utf8").replace("\n---\n", "\ndisable-model-invocation: true\n---\n"),
  );
}

const kimiDashboardPath = join(
  repositoryRoot,
  "kimi-market/plugins/ghost-agent-workflow/skills/start-dag-dashboard/SKILL.md",
);
write(
  kimiDashboardPath,
  readFileSync(kimiDashboardPath, "utf8")
    .replace(
      "\n---\n",
      "\nwhenToUse: 用户显式启动 Dashboard，或协调器在 Plan 激活后启动 Dashboard 时使用。\n---\n",
    )
    .replace(
      "node <plugin-root>/scripts/start-dashboard.mjs",
      "node ${KIMI_SKILL_DIR}/../../scripts/start-dashboard.mjs",
    ),
);

process.stdout.write("thread workflow skills synchronized\n");
