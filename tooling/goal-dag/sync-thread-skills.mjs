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
  "sub-thread-coordination/references/lifecycle-contract.md",
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
        "业务 DAG 默认使用 `standalone_thread`；只有用户明确使用原生 Goal 时才绑定 `codex_native` 并在本地结果完成后桥接。与此独立，DAG Supervisor 必须在自己的线程内创建原生 Goal，持续监督到脚本报告 DAG 终态。",
        "本平台固定使用 `standalone_thread`，不包含 Codex 原生 Goal 桥接。",
      )
      .replace(
        "- `supervisor_init_required`：立即调用内部 `workflow supervisor-init`，逐字使用收据的 target 以 `create_thread` 创建独立 worktree 的唯一 Supervisor，使用 `gpt-5.6-luna/medium`；Supervisor 必须早于 Planner 创建，并立即创建自己的原生 Goal。登记后 Supervisor 持续运行 `supervisor-next`；Main 不等待，也不负责周期唤醒。",
        "- `supervisor_init_required`：立即调用内部 `workflow supervisor-init`，逐字使用收据的 target 以宿主长期 `create_thread` 创建独立 worktree 的唯一 Supervisor，使用 `gpt-5.6-luna/medium`；Supervisor 必须早于 Planner 创建并持续运行监督循环。登记后 Main 不等待，也不负责周期唤醒。",
      )
      .replace(
        "- `supervisor_required`：已登记 Supervisor 的原生 Goal 会自行轮询；Main 不再调用 `supervisor-next`、发送普通监督 dispatch 或重新唤醒。只有 Supervisor 发来的 create/main_action 才由 Main 处理。",
        "- `supervisor_required`：已登记 Supervisor 会自行轮询；Main 不再调用 `supervisor-next`、发送普通监督 dispatch 或重新唤醒。只有 Supervisor 发来的 create/main_action 才由 Main 处理。",
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
    goalContractSource
      .replace(
        "Codex Quick 不创建原生 Goal。业务 DAG 默认使用 `standalone_thread`；用户明确启动原生 Goal 时才使用 `codex_native`，并在本地 `result.json` 完成后桥接。DAG Supervisor 独立创建自己的原生 Goal，只负责持续轮询 `.ghost-agent-workflow`；等待 Owner、Review 或 Main 不映射为 blocked。",
        `${target.platform} 固定使用 \`standalone_thread\`，不包含 Codex 原生 Goal 桥接；Supervisor 使用宿主长期线程内的持续监督循环。`,
      )
      .replace(
        "→ 新 Main 登记自身并立即创建 Supervisor 原生 Goal",
        "→ 新 Main 登记自身并立即创建 Supervisor",
      )
      .replace(
        "→ Supervisor Goal 持续等待 Main 已登记的线程并通知 Main",
        "→ Supervisor 只等待 Main 已登记的线程并通知 Main",
      ),
  );

  const templatesSource = readFileSync(
    join(codexRoot, "sub-thread-coordination/references/templates.md"),
    "utf8",
  );
  write(
    join(target.root, "sub-thread-coordination/references/templates.md"),
    templatesSource
      .replace(
        "Main 不调用 `wait_threads`。Supervisor 在自己的原生 Goal 内持续运行 `supervisor-next`；Main 只逐字执行 Supervisor 发来的 create/main_action，建立 watch 后结束 turn，不再唤醒 Supervisor。",
        "Main 不调用 `wait_threads`。Supervisor 在宿主长期线程内持续运行 `supervisor-next`；Main 只逐字执行 Supervisor 发来的 create/main_action，建立 watch 后结束 turn，不再唤醒 Supervisor。",
      )
      .replace(
        "Supervisor 首次创建原生 Goal；每个 Goal turn 只投影一次，丢失上下文后仍只运行：",
        "Supervisor 丢失上下文后只运行：",
      )
      .replace(
        "create：Supervisor 不执行，只把脚本 action 的必要字段和 prompt 发送给 Main；main_action 只发送脚本 dispatch。Main 负责确定性调度，Supervisor Goal 保持 active。",
        "create：Supervisor 不执行，只把脚本 action 的必要字段和 prompt 发送给 Main；main_action 只发送脚本 dispatch。Main 负责确定性调度，Supervisor 持续监督。",
      )
      .replace(
        "main_action：把脚本 dispatch 原样发送给 Main 后结束当前 Goal turn，但不结束 Goal；最终交付和清理只能由 Main 执行。",
        "main_action：把脚本 dispatch 原样发送给 Main 后继续监督；最终交付和清理只能由 Main 执行。",
      ),
  );

  const supervisorSource = readFileSync(
    join(codexRoot, "sub-thread-task-supervisor/SKILL.md"),
    "utf8",
  );
  const platformSupervisor = supervisorSource
    .replace(
      "必须在 Planner 前启动原生 Goal",
      "必须在 Planner 前启动持续监督循环",
    )
    .replace(
      "# 任务监督子线程\n",
      `# 任务监督子线程\n\n> 平台差异：${target.platform} 不提供 Codex 原生 Goal 工具，因此使用同一线程内的持续监督 turn；不得伪造原生 Goal 状态。\n`,
    )
    .replace(
      "通过 `create_thread` 在独立 worktree 创建 Supervisor",
      "通过宿主长期 `create_thread` 在独立 worktree 创建 Supervisor",
    )
    .replace(
      /## 原生 Goal\n\n[\s\S]*?\n## 脚本循环/u,
      "Supervisor 逐字采用 `workflow supervisor-init` 收据的 `goal_objective` 作为持续监督目标并立即进入循环。普通等待、Main 正在处理 action、线程 running 或无状态变化都不得结束监督 turn。上下文压缩或恢复后，不从聊天重建状态，直接重新执行 `supervisor-next`。Main 启动的目标均由 runtime 投影到收据的 `status_document`；该文件只保存当前状态，Supervisor 不编辑或解析原始 JSON。\n\n## 脚本循环",
    )
    .replace(
      "每个 Goal turn 只执行一次 `supervisor-next`，处理该次紧凑 action 后立即让出当前 turn；下一次 continuation 再读取本地状态：",
      "每轮只处理脚本返回的紧凑 action：",
    )
    .replace(
      "若脚本违反互斥约束，只向 Main 报告一次 CLI 契约错误并保持 Goal active，不猜测该执行哪个动作。重复出现 `create` 或非终态 `main_action`，无论多少轮都不算阻塞，禁止因此调用 `update_goal(status=blocked)`。",
      "若脚本违反互斥约束，只向 Main 报告一次 CLI 契约错误并继续监督，不猜测该执行哪个动作。重复出现 `create` 或非终态 `main_action`，无论多少轮都不算阻塞，禁止因此停止监督。",
    )
    .replaceAll("用对应 action id ack 后让出当前 turn", "用对应 action id ack 后继续监督")
    .replaceAll("然后让当前 Goal turn 结束但保持 Goal active", "然后继续监督")
    .replace("成功后 ack 并让出当前 turn", "成功后 ack 并继续监督")
    .replace("空 action：不产生消息，不结束 Goal；下一次 Goal continuation 重新运行 `supervisor-next`。", "空 action：不产生消息，继续运行 `supervisor-next`。")
    .replace("发送最终机器通知后调用 `update_goal(status=complete)`，结束 Supervisor。", "发送最终机器通知后结束 Supervisor。");
  write(
    join(target.root, "sub-thread-task-supervisor/SKILL.md"),
    platformSupervisor,
  );
  if (target.platform === "Claude Code") {
    const supervisorMetadata = readFileSync(
      join(codexRoot, "sub-thread-task-supervisor/agents/openai.yaml"),
      "utf8",
    ).replace(
      "在原生 Goal 内静默监督 Main 已登记的最多八个执行线程。",
      "在宿主长期线程内静默监督 Main 已登记的最多八个执行线程。",
    );
    write(
      join(target.root, "sub-thread-task-supervisor/agents/openai.yaml"),
      supervisorMetadata,
    );
  }
}

for (const relativePath of [
  "parallel-task-planner/agents/openai.yaml",
  "planner-reviewer/agents/openai.yaml",
  "setup-sub-thread-workflow/agents/openai.yaml",
  "start-dag-dashboard/agents/openai.yaml",
  "sub-thread-coordination/agents/openai.yaml",
  "sub-thread-goal-worker/agents/openai.yaml",
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
