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
    executionPlatform: "claude_code",
    root: join(repositoryRoot, "claude-code-market/skills"),
  },
  {
    platform: "Kimi Code",
    executionPlatform: "kimi",
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
  const platformCoordinator = coordinatorSource
    .replace(
      "默认 `standalone_thread`，不调用原生 Goal。只有用户已经启动或明确要求 Goal 时使用 `codex_native`。Owner 变化等待用户时不要把 Goal 标为 blocked；应用成功后提示用户可以继续 Goal。",
      `本平台固定使用 \`standalone_thread\`，不调用 Codex 原生 Goal。Owner 变化等待用户时保持本地工作流暂停；应用成功后提示用户可以继续执行。`,
    )
    .replace(
      "所有执行单元必须是可长期持有上下文的 Codex 子线程。",
      "所有执行单元必须是宿主提供的、可长期持有上下文的子线程。",
    )
    .replace(
      "standalone 模式直接等待用户回答。codex_native 模式提示用户先暂停 Goal，在主线程处理/批准 Owner 变化；只有 Registry 与 DAG transition 都成功后才明确提示“Owner 变化已应用，可以继续 Goal”。",
      "等待用户在主线程明确回答；只有 Registry 与 DAG transition 都成功后才提示“Owner 变化已应用，可以继续执行”。",
    )
    .replace(
      "2. 创建 `GOAL_CONTRACT_V1`，`execution.mode` 固定为 `thread`。standalone 使用 `lifecycle.controller: standalone_thread` 与 `native_goal: null`；原生 Goal 才使用 `codex_native`。",
      "2. 创建 `GOAL_CONTRACT_V1`，`execution.mode` 固定为 `thread`，并固定使用 `lifecycle.controller: standalone_thread` 与 `native_goal: null`。",
    )
    .replace(
      "创建成功后立即调用宿主 `set_thread_title` 设置 canonical `thread_title`",
      "创建成功后立即调用宿主 set-title API 设置 canonical `thread_title`",
    )
    .replace(
      "只有 coverage 100%、所有 required Review/verify 节点 accepted、blocking finding 为 0、scope 与 delivery gate 通过时运行 `finalize`。standalone 到此完成；codex_native 再执行原生完成桥接。任何模式都保留 compact final task receipts 与完整落盘结果。",
      "只有 coverage 100%、所有 required Review/verify 节点 accepted、blocking finding 为 0、scope 与 delivery gate 通过时运行 `finalize`。本平台到此完成，并保留 compact final task receipts 与完整落盘结果。",
    );
  write(
    join(target.root, "sub-thread-coordination/SKILL.md"),
    platformCoordinator
      .replace(
        "# 子线程 DAG 协调器\n",
        `# 子线程 DAG 协调器\n${platformBoundary}`,
      ),
  );

  const goalContractSource = readFileSync(
    join(codexRoot, "sub-thread-coordination/references/goal-contract.md"),
    "utf8",
  );
  write(
    join(target.root, "sub-thread-coordination/references/goal-contract.md"),
    goalContractSource
      .replace('"execution_platform": "codex"', `"execution_platform": "${target.executionPlatform}"`)
      .replace(
        /## 原生 Goal 差异\n[\s\S]*?(?=## Gate 与 Review)/u,
        `## 生命周期限制\n\n${target.platform} 固定使用 \`standalone_thread + native_goal: null\`，不得调用 Codex Goal 工具。\n\n`,
      )
      .replace(
        "在 codex_native 下等待批准时保留 Goal active，状态记为 `awaiting_owner_action`，通知用户暂停并处理；Registry 和 DAG transition 都完成后才明确提示可继续 Goal，不用空回合累计 blocked。",
        "等待批准时本地状态记为 `awaiting_owner_action`；Registry 和 DAG transition 都完成后才明确提示可继续执行，不用空回合累计 blocked。",
      ),
  );

  const ownerGovernanceSource = readFileSync(
    join(codexRoot, "sub-thread-coordination/references/owner-governance.md"),
    "utf8",
  );
  write(
    join(target.root, "sub-thread-coordination/references/owner-governance.md"),
    ownerGovernanceSource.replace(
      "standalone 直接等待用户回答；codex_native 友好提示用户暂停 Goal 并在主线程处理。",
      "直接等待用户在主线程回答；本平台不包含原生 Goal 桥接。",
    ),
  );
}

for (const relativePath of [
  "planner-reviewer/agents/openai.yaml",
  "setup-sub-thread-workflow/agents/openai.yaml",
  "start-dag-dashboard/agents/openai.yaml",
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
