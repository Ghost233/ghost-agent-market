# Kimi Code Coverage、Plan 与 Delta 模板

## PLAN_COVERAGE_V1

先读取 runtime 生成并由 `goal-state.source_blocks` 绑定的 `SOURCE_BLOCKS_V1`。每个计划项都要引用至少一个当前 block，并声明完成它真正需要的 effect：

```json
{
  "contract": "PLAN_COVERAGE_V1",
  "source_path": "/absolute/path/to/plan.md",
  "source_digest": "<plan.md sha256>",
  "source_revision": 1,
  "plan_path": "/absolute/goal/plan.json",
  "plan_digest": "<plan.json sha256>",
  "plan_revision": 1,
  "required_plan_items": [
    {
      "id": "PI-owner-state",
      "description": "实现并验证 Owner affinity、generation fencing 与 Capsule checkpoint",
      "source_refs": ["L12-0123456789ab", "L13-abcdef012345"],
      "required_effects": ["implementation", "verification"]
    },
    {
      "id": "PI-workflow-proof",
      "description": "以完整 smoke 证明覆盖率、证据和完成顺序",
      "source_refs": ["L28-fedcba987654"],
      "required_effects": ["verification"]
    }
  ]
}
```

`source_refs` 只能引用当前 `SOURCE_BLOCKS_V1.blocks[].id`。`required_effects` 只能包含 `implementation`、`verification`；`audit` 是 gate task 的 effect，不是 coverage requirement。coverage 按 `(item, effect)` 计数，不能用一个 implementation task 冒充 verification。

## DAG_PLAN_V4

```json
{
  "contract": "DAG_PLAN_V4",
  "planner": "parallel-task-planner",
  "plan_format_version": 4,
  "revision": 1,
  "execution_platform": "kimi",
  "goal_contract_path": "/absolute/goal/goal.json",
  "goal_digest": "<goal.json sha256>",
  "goal_id": "runtime-owner-reuse",
  "plan_source": {"path": "/absolute/path/to/plan.md", "digest": "<plan.md sha256>", "revision": 1},
  "coverage_path": "/absolute/goal/coverage.json",
  "owners": [
    {
      "id": "source-audit", "role": "verify",
      "responsibility": "在业务修改前独立证明 source blocks 没有遗漏",
      "writable_paths": [],
      "worker_context": "分类全部 SOURCE_BLOCKS_V1，并让 runtime 校验 coverage effects",
      "runtime_profile": null, "reuse_policy": "owner_affinity"
    },
    {
      "id": "runtime-core", "role": "work",
      "responsibility": "负责任务状态机与并发不变量",
      "writable_paths": ["tooling/goal-dag/**", "tests/test_goal_dag_cli.py"],
      "worker_context": "保持 reservation、attempt、source revision 与 Capsule 更新原子",
      "runtime_profile": null, "reuse_policy": "owner_affinity"
    },
    {
      "id": "runtime-verification", "role": "verify",
      "responsibility": "负责只读 smoke 与最终真实工作区审计",
      "writable_paths": [],
      "worker_context": "验证 required effects，并调用 runtime 生成审计 artifact",
      "runtime_profile": null, "reuse_policy": "owner_affinity"
    }
  ],
  "tasks": [
    {
      "id": "T0", "logical_id": "source.coverage-audit", "title": "审计源计划覆盖",
      "role": "verify", "owner_id": "source-audit",
      "task": "分类全部 source blocks，并运行 source-audit 生成 artifact",
      "depends_on": [], "writable_paths": [], "resource_locks": ["source-coverage-audit"],
      "done_when": ["每个 source block 已映射或有明确 non-requirement 理由"],
      "verification_ids": ["source-coverage-audit"], "satisfies_goal_gates": ["source-coverage-audit"],
      "plan_item_ids": ["PI-owner-state", "PI-workflow-proof"], "coverage_effect": "audit",
      "priority": 30, "estimated_cost": 1
    },
    {
      "id": "T1", "logical_id": "runtime.owner-state", "title": "实现 Owner 状态机",
      "role": "work", "owner_id": "runtime-core",
      "task": "实现 Owner affinity、generation fencing 和 Capsule checkpoint",
      "depends_on": ["T0"],
      "writable_paths": ["tooling/goal-dag/**", "tests/test_goal_dag_cli.py"],
      "resource_locks": ["goal-dag-runtime"], "done_when": ["Owner 可复用也可安全换 Agent"],
      "verification_ids": ["runtime-unit"], "satisfies_goal_gates": ["runtime-unit"],
      "plan_item_ids": ["PI-owner-state"], "coverage_effect": "implementation",
      "priority": 20, "estimated_cost": 5
    },
    {
      "id": "T2", "logical_id": "runtime.verify-flow", "title": "验证 Goal 执行流程",
      "role": "verify", "owner_id": "runtime-verification", "task": "只读运行完整 Goal DAG smoke",
      "depends_on": ["T1"], "writable_paths": [], "resource_locks": ["goal-dag-smoke"],
      "done_when": ["计划项 required effects 为 100% 且完成顺序正确"],
      "verification_ids": ["workflow-smoke"], "satisfies_goal_gates": ["workflow-smoke"],
      "plan_item_ids": ["PI-owner-state", "PI-workflow-proof"], "coverage_effect": "verification",
      "priority": 20, "estimated_cost": 2
    },
    {
      "id": "T3", "logical_id": "runtime.diff-scope-audit", "title": "审计真实工作区差异",
      "role": "verify", "owner_id": "runtime-verification",
      "task": "运行 diff-audit，核对 baseline、真实工作区与 accepted work results",
      "depends_on": ["T2"], "writable_paths": [], "resource_locks": ["diff-scope-audit"],
      "done_when": ["runtime 生成的 DIFF_SCOPE_AUDIT_V1 通过"],
      "verification_ids": ["diff-scope-audit"], "satisfies_goal_gates": ["diff-scope-audit"],
      "plan_item_ids": ["PI-owner-state", "PI-workflow-proof"], "coverage_effect": "audit",
      "priority": 10, "estimated_cost": 1
    }
  ],
  "safety": {
    "status": "sequential_only",
    "reasons": ["source audit 必须先于 work，最终 audit 必须晚于 accepted work results"]
  }
}
```

Kimi Code 每个 Owner 的 `runtime_profile` 必须为 `null`（平台默认 profile，Agent 工具不接受模型参数）；Codex 固定 `gpt-5.6-sol/medium` 是有意的平台差异。每个 work task 必须依赖当前 `source-coverage-audit`；所有 task 都必须有非空 `plan_item_ids` 和合法 `coverage_effect`。

## DAG_DELTA_V1：source revision 刷新

只有 `goal-refresh` 已完成原子刷新并令 state 进入 `goal_refresh_pending` 后，才生成 source delta：

```json
{
  "contract": "DAG_DELTA_V1",
  "base_plan_digest": "<当前 plan.json sha256>",
  "revision": 2,
  "coverage_update": {
    "required_plan_items": [
      {
        "id": "PI-owner-state",
        "description": "实现并验证 Owner affinity、generation fencing 与 Capsule checkpoint",
        "source_refs": ["L14-111111111111"],
        "required_effects": ["implementation", "verification"]
      },
      {
        "id": "PI-workflow-proof",
        "description": "以完整 smoke 证明覆盖率、证据和完成顺序",
        "source_refs": ["L31-222222222222"],
        "required_effects": ["verification"]
      }
    ]
  },
  "source_dispositions": [
    {"task_id": "T0", "action": "invalidate", "replacement_task_id": "T4"},
    {"task_id": "T1", "action": "invalidate", "replacement_task_id": "T5"},
    {"task_id": "T2", "action": "invalidate", "replacement_task_id": "T6"},
    {"task_id": "T3", "action": "invalidate", "replacement_task_id": "T7"}
  ],
  "add_owners": [],
  "add_tasks": [
    {
      "id": "T4", "logical_id": "source.coverage-audit-r2", "title": "重审源计划覆盖",
      "role": "verify", "owner_id": "source-audit", "task": "分类 revision 2 的全部 source blocks",
      "depends_on": [], "writable_paths": [], "resource_locks": ["source-coverage-audit"],
      "done_when": ["revision 2 的 source blocks 无遗漏"],
      "verification_ids": ["source-coverage-audit"], "satisfies_goal_gates": ["source-coverage-audit"],
      "plan_item_ids": ["PI-owner-state", "PI-workflow-proof"], "coverage_effect": "audit",
      "priority": 40, "estimated_cost": 1
    },
    {
      "id": "T5", "logical_id": "runtime.owner-state-r2", "title": "更新 Owner 状态机",
      "role": "work", "owner_id": "runtime-core", "task": "按 revision 2 更新实现",
      "depends_on": ["T4"], "writable_paths": ["tooling/goal-dag/**", "tests/test_goal_dag_cli.py"],
      "resource_locks": ["goal-dag-runtime"], "done_when": ["实现符合 revision 2"],
      "verification_ids": ["runtime-unit"], "satisfies_goal_gates": ["runtime-unit"],
      "plan_item_ids": ["PI-owner-state"], "coverage_effect": "implementation",
      "priority": 30, "estimated_cost": 3
    },
    {
      "id": "T6", "logical_id": "runtime.verify-flow-r2", "title": "复验 Goal 执行流程",
      "role": "verify", "owner_id": "runtime-verification", "task": "验证 revision 2",
      "depends_on": ["T5"], "writable_paths": [], "resource_locks": ["goal-dag-smoke"],
      "done_when": ["revision 2 required effects 全部完成"],
      "verification_ids": ["workflow-smoke"], "satisfies_goal_gates": ["workflow-smoke"],
      "plan_item_ids": ["PI-owner-state", "PI-workflow-proof"], "coverage_effect": "verification",
      "priority": 20, "estimated_cost": 2
    },
    {
      "id": "T7", "logical_id": "runtime.diff-scope-audit-r2", "title": "复审真实工作区差异",
      "role": "verify", "owner_id": "runtime-verification", "task": "运行 revision 2 diff-audit",
      "depends_on": ["T6"], "writable_paths": [], "resource_locks": ["diff-scope-audit"],
      "done_when": ["revision 2 DIFF_SCOPE_AUDIT_V1 通过"],
      "verification_ids": ["diff-scope-audit"], "satisfies_goal_gates": ["diff-scope-audit"],
      "plan_item_ids": ["PI-owner-state", "PI-workflow-proof"], "coverage_effect": "audit",
      "priority": 10, "estimated_cost": 1
    }
  ],
  "repairs": [],
  "safety": {"status": "sequential_only", "reasons": ["revision 2 重新执行 source audit、work、verify 与 diff audit"]}
}
```

source refresh delta 必须 disposition 每个 live task，且旧 `source-coverage-audit`、`diff-scope-audit` 都必须 invalidate。`apply-delta` 会原子清除 invalidated task 在 Capsule 当前视图中的 completed/result/evidence/checkpoint 引用。非 source refresh 的 repair/coverage delta 必须逐字段原样保留当前 `required_plan_items`（包括 `source_refs` 与 `required_effects`）。
