# Codex Goal Contract

仅在创建或校验 Codex 本地 Goal 时读取本文件。`goal.json`、`goal-state.json`、`coverage.json`、`plan.json` 与 `state.json` 必须位于同一目录。

## GOAL_CONTRACT_V1

```json
{
  "contract": "GOAL_CONTRACT_V1",
  "goal_id": "runtime-owner-reuse--7fa3c2d91e04",
  "execution_platform": "codex",
  "workspace": {
    "root": "/absolute/workspace/root"
  },
  "lifecycle": {
    "controller": "codex_native",
    "native_goal": {
      "thread_id": "<get_goal.goal.threadId>",
      "created_at": 1780000000
    }
  },
  "source": {
    "path": "/absolute/path/to/plan.md",
    "digest": "<plan.md sha256>",
    "revision": 1
  },
  "objective": "<get_goal 返回的 objective 原文，不得摘要或改写>",
  "scope": ["Goal、DAG runtime、skills 和测试"],
  "constraints": ["保留用户已有改动", "所有结果必须可复核"],
  "non_goals": ["部署", "发布"],
  "execution": {
    "mode": "subagent",
    "max_concurrency": 3,
    "reuse_policy": "owner_affinity"
  },
  "verification_gates": [
    {
      "id": "runtime-unit",
      "stage": "unit",
      "description": "runtime 单元测试通过",
      "required": true
    },
    {
      "id": "workflow-smoke",
      "stage": "smoke",
      "description": "真实 Goal DAG smoke 通过",
      "required": true
    },
    {
      "id": "source-coverage-audit",
      "stage": "pre-execution",
      "description": "独立 verify task 逐项分类 SOURCE_BLOCKS_V1，证明 source 没有遗漏且 required effects 已映射到 DAG",
      "required": true
    },
    {
      "id": "diff-scope-audit",
      "stage": "final",
      "description": "由独立 review/verify task 核对实际工作区差异均位于 Goal 授权 scope，并保存可复核 artifact",
      "required": true
    }
  ],
  "side_effects": {
    "deploy": "forbidden",
    "external_write": "forbidden"
  },
  "completion": {
    "plan_coverage_100": true,
    "all_tasks_completed": true,
    "required_gates_passed": true,
    "blocking_findings_zero": true,
    "diff_in_scope": true
  }
}
```

把 `get_goal` 返回的 objective 原文逐字写入 `goal.objective`，并把同一次返回的 `threadId`、`createdAt` 写入 `lifecycle.native_goal`。`goal-validate` 计算 objective digest 并写入 `goal-state.native_sync.objective_digest`；不要把用户输入的 `/goal` 命令、自然语言摘要、`updatedAt` 或本地 continuation 文本作为 identity。相同 objective 可以被再次创建，必须用 `threadId + createdAt` 区分 Goal instance。

新 Goal 的 instance digest 定义为 `SHA-256(UTF-8(threadId + "\n" + String(createdAt)))`。`goal_id` 与 `.ghost-agent-workflow/goals/<goal_id>/` 目录名都必须包含该 digest 的至少前 12 位小写 hex，推荐形态为 `<可读-slug>--<digest-prefix>`；slug 只改善可读性，不参与 identity。slug 要归一化为 ASCII runtime identifier 并裁剪，使完整 id 匹配 `[A-Za-z0-9][A-Za-z0-9._-]{0,95}`；没有可用 slug 时使用 `goal`。首次创建不得覆盖已有目录：目标目录已存在时先读取并精确校验完整 native identity 与 objective digest；若它属于不同 instance，则逐步延长同一个 digest 前缀后创建新目录。恢复时可按 suffix 扫描候选，但必须再次精确校验 `thread_id`、`created_at` 与 objective digest，不能仅凭目录名或短摘要接受候选。

`workspace.root` 必须是 Goal 开始时的绝对工作区根目录。首次 `goal-validate` 会在业务执行前捕获排除 `.ghost-agent-workflow/` 的 `WORKTREE_BASELINE_V1`，并从当前 source 生成逐个非空行的 `SOURCE_BLOCKS_V1`；两者的绝对 ref 与 SHA-256 digest 只写入 `goal-state.json`，不得由 planner 或 worker 重建。

`goal-state.native_sync` 由 runtime 管理，形态为：

```json
{
  "status": "not_started | pending | confirmed",
  "completion_token": "<opaque token or null>",
  "objective_digest": "<goal.objective sha256>",
  "confirmed_at": null
}
```

## Gate 与约束合并

按顺序保留仓库强制 gate、加入计划验收、再加入 objective 明确追加的测试。相同语义使用稳定 id。固定 required gate `source-coverage-audit` 与 `diff-scope-audit` 都不得删除：前者只能由所有 work task 的独立 verify/audit 祖先覆盖，并用 runtime 生成的 `SOURCE_COVERAGE_AUDIT_V1` 证明每个 source block 已映射或有明确 non-requirement 理由；后者只能由独立 `review` 或 `verify` audit task 覆盖，并用 runtime 对 baseline 与当前真实工作区的扫描生成 `DIFF_SCOPE_AUDIT_V1`。两类 passed evidence 都必须携带 binding 指定的非空 `artifact_ref` 与 `artifact_digest`。其它 required gate 也必须由至少一个 task 的 `satisfies_goal_gates` 覆盖，并由对应 `WORKER_RESULT_V4.evidence` 提交可复核证据。

把 scope、constraints、non_goals 与 side_effects 原样下发到每次 `TASK_BINDING_V4`。任何 task 都不得越过它们；需要扩域时返回 `needs_repair`，由 planner 生成 delta。

## 原生桥接不变量

- `get_goal` 必须是每轮第一个生命周期调用；恢复前校验 threadId、createdAt 与 objective digest。
- `goal-state.json` 记录本地状态和 `native_completion_pending`，原生 Goal 记录外层状态，两者不可互相伪造。
- 本地已 completed 且 native sync pending 时，恢复只校验 goal/native token/objective/native_goal identity 并直接 bridge；不得依赖此后可变的 live source、worktree baseline、source blocks 或 Owner Capsule 仍可读取。
- `finalize` 只在 `PLAN_COVERAGE_V1` 为 100% 且本地验收全部通过后产生一个持久 completion token。
- `finalize` 后必须 fresh `get_goal` 并重验 instance identity/objective digest；只有同一 instance 仍 active 才调用 `update_goal({status: "complete"})`。
- `update_goal` 成功后必须再次 fresh `get_goal`，确认同一 instance 已 complete，才用该 token 运行 `native-confirm`；pre-update 读取已经是 complete 时可直接作为该确认。
- 更新或确认失败时复用同一 token 幂等重试；不得提前确认、重新签发 token 或返回人工续跑 prompt。
- 普通 task 的 failed、blocked、needs_repair 留在 DAG/result/delta。只有满足平台对持续外部阻塞的严格语义时才考虑原生 blocked，不能把它当作普通错误上报。
