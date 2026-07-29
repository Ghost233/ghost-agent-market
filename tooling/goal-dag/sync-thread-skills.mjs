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
        "业务 DAG 默认使用 `standalone_thread`；只有用户明确使用原生 Goal 时才绑定 `codex_native` 并在本地结果完成后桥接。与此独立，DAG Supervisor 在自己的线程内按需创建原生 Goal；没有 active 任务时立即 complete，后续新批次再从本地状态创建新 Goal。",
        "本平台固定使用 `standalone_thread`，不包含 Codex 原生 Goal 桥接；DAG Supervisor 按脚本结果启动或结束宿主监督 turn。",
      )
      .replace(
        "- `supervisor_init_required`：立即调用内部 `workflow supervisor-init`，逐字使用收据的 target 以 `create_thread` 创建独立 worktree 的唯一 Supervisor，使用 `gpt-5.6-luna/medium`；Supervisor 必须早于 Planner 创建。收据的 `status_document` 由脚本保存所有 Main 已启动目标及当前状态。Supervisor 先执行 dispatch 中的 `supervisor start`，只有脚本返回 `start` 才创建固定 objective 的原生 Goal；返回 `stop` 时不得创建。Main 不等待，也不负责周期唤醒。",
        "- `supervisor_init_required`：立即调用内部 `workflow supervisor-init`，逐字使用收据的 target 以宿主长期 `create_thread` 创建独立 worktree 的唯一 Supervisor，使用 `gpt-5.6-luna/medium`；Supervisor 必须早于 Planner 创建。收据的 `status_document` 由脚本保存所有 Main 已启动目标及当前状态。Supervisor 先执行 dispatch 中的 `supervisor start`，返回 `start` 时启动监督 turn，返回 `stop` 时保持停止。Main 不等待，也不负责周期唤醒。",
      )
      .replace(
        "- `supervisor_required`：逐字把脚本收据的 dispatch 发送给已登记 Supervisor。Supervisor 通过 `supervisor start` 从本地状态判断复用当前 Goal、按需新建 Goal 或保持停止。Worker 完成后也按脚本收据主动通知它。Main 不调用 `supervisor next` 或等待；只有 Supervisor 发来的 create/notify 才由 Main 处理。",
        "- `supervisor_required`：逐字把脚本收据的 dispatch 发送给已登记 Supervisor。Supervisor 通过 `supervisor start` 从本地状态判断继续或重启监督 turn。Worker 完成后也按脚本收据主动通知它。Main 不调用 `supervisor next` 或等待；只有 Supervisor 发来的 create/notify 才由 Main 处理。",
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
        "Codex Quick 不创建原生 Goal。业务 DAG 默认使用 `standalone_thread`；用户明确启动原生 Goal 时才使用 `codex_native`，并在本地 `result.json` 完成后桥接。DAG Supervisor 在自己的线程内按脚本状态按需创建原生 Goal，只轮询 `.ghost-agent-workflow`；等待 Owner、Review 或 Main 不映射为 blocked。",
        `${target.platform} 固定使用 \`standalone_thread\`，不包含 Codex 原生 Goal 桥接；Supervisor 只按脚本状态启动或结束宿主监督 turn。`,
      )
      .replace(
        "→ 新 Main 登记自身并立即创建 Supervisor 原生 Goal",
        "→ 新 Main 登记自身并立即创建 Supervisor",
      )
      .replace(
        "→ Supervisor Goal 持续等待 Main 已登记的线程并通知 Main",
        "→ Supervisor 只等待 Main 已登记的线程并通知 Main",
      )
      .replace(
        "公开的 `supervisor next` 只返回 `create|wait|notify|stop`；`stop` 必须再由 `supervisor stop` 确认后 complete 当前原生 Goal。",
        "公开的 `supervisor next` 只返回 `create|wait|notify|stop`；`stop` 必须再由 `supervisor stop` 确认后结束当前监督 turn。",
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
        "Main 不调用 `wait_threads`。Supervisor 先执行 `supervisor start`，只在脚本确认存在 active 任务时运行原生 Goal；`supervisor next` 返回 `stop` 后用 `supervisor stop` 确认并 complete 当前 Goal。Main 遇到 `supervisor_required` 时逐字发送脚本 dispatch，新一批 active 任务会按需创建新 Goal。Worker 结果动作也会按脚本收据主动唤醒 Supervisor。",
        "Main 不调用 `wait_threads`。Supervisor 先执行 `supervisor start`，只在脚本确认存在 active 任务时运行宿主长期监督 turn；`supervisor next` 返回 `stop` 后用 `supervisor stop` 确认并结束当前 turn。Main 遇到 `supervisor_required` 时逐字发送脚本 dispatch，新一批 active 任务会按需启动新 turn。Worker 结果动作也会按脚本收据主动唤醒 Supervisor。",
      )
      .replace(
        "Supervisor 每批 active 任务创建或复用原生 Goal；Goal 提示词运行期间不修改。丢失上下文后仍只运行：",
        "Supervisor 每批 active 任务启动或复用持续监督 turn；丢失上下文后仍只运行：",
      )
      .replace(
        "stop：用 `supervisor stop` 二次确认没有 active 任务，然后 complete 当前 Goal。最终交付和清理只能由 Main 执行。",
        "stop：用 `supervisor stop` 二次确认没有 active 任务，然后结束当前监督 turn。最终交付和清理只能由 Main 执行。",
      ),
  );

  const supervisorSource = readFileSync(
    join(codexRoot, "sub-thread-task-supervisor/SKILL.md"),
    "utf8",
  );
  const platformSupervisor = supervisorSource
    .replace(
      "没有活动任务时结束当前原生 Goal",
      "没有活动任务时结束当前监督 turn",
    )
    .replace(
      "# 任务监督子线程\n",
      `# 任务监督子线程\n\n> 平台差异：${target.platform} 不提供 Codex 原生 Goal 工具，因此使用同一线程内的持续监督 turn；不得伪造原生 Goal 状态。\n`,
    )
    .replace(
      /## 原生 Goal 生命周期\n\n[\s\S]*?\n## 公开脚本入口/u,
      "## 持续监督 turn\n\n每次收到 dispatch，先执行 `supervisor start`。返回 `start` 时启动或继续当前监督 turn；返回 `stop` 时保持停止。运行期间不改写监督目标。上下文压缩或恢复后不从聊天重建状态，只重新执行 `supervisor next`。Main 启动的目标均由 runtime 投影到 `status_document`，Supervisor 不编辑或解析原始 JSON。\n\n## 公开脚本入口",
    )
    .replace(
      "- `notify` 且 `kind: main`：只把脚本 dispatch 逐字发送给 Main，不 ack，不解析业务结果。发送成功后执行 `supervisor stop`；确认当前没有 active 监控动作后调用 `update_goal(status=complete)`。Owner 同步、验收、最终交付和清理仍由 Main 执行，产生新 active 任务时由新 dispatch 启动新 Goal。",
      "- `notify` 且 `kind: main`：只把脚本 dispatch 逐字发送给 Main，不 ack，不解析业务结果。发送成功后执行 `supervisor stop` 并结束当前监督 turn。Owner 同步、验收、最终交付和清理仍由 Main 执行，产生新 active 任务时由新 dispatch 启动新监督 turn。",
    )
    .replace(
      "- `stop`：立即执行 `supervisor stop` 二次确认。确认成功后调用 `update_goal(status=complete)` 并停止；不得继续等待，也不得立即创建新 Goal。后续 Main 或 Worker 通过脚本登记新 active 任务后，由新 dispatch 按需启动新的 Goal。",
      "- `stop`：立即执行 `supervisor stop` 二次确认并结束当前监督 turn；不得继续等待。后续 Main 或 Worker 通过脚本登记新 active 任务后，由新 dispatch 按需启动新的监督 turn。",
    )
    .replace(
      "若旧 Goal 已 complete，只在脚本返回 `start` 后创建新 Goal。",
      "若上一监督 turn 已结束，只在脚本返回 `start` 后启动新 turn。",
    );
  write(
    join(target.root, "sub-thread-task-supervisor/SKILL.md"),
    platformSupervisor,
  );
  if (target.platform === "Claude Code") {
    const supervisorMetadata = readFileSync(
      join(codexRoot, "sub-thread-task-supervisor/agents/openai.yaml"),
      "utf8",
    ).replace(
      "按需启动原生 Goal，脚本化监督最多八个执行线程。",
      "按需启动监督 turn，脚本化监督最多八个执行线程。",
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
