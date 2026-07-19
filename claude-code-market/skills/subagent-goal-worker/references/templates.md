# Claude Code Subagent Worker 契约

## TASK_BINDING_V4

协调器把 `reserve.actions[]` 或 `status`/`reconcile.active_reservations[]` 返回的完整 canonical binding 原样发送。result_path 由 runtime 首次 reserve 时按 attempt/token 唯一生成，crash recovery 不得重算或换路径。

```json
{
  "contract": "TASK_BINDING_V4",
  "goal_id": "runtime-owner-reuse",
  "goal_objective": "完整执行计划并通过所有验收",
  "plan_path": "/absolute/goal/plan.json",
  "state_path": "/absolute/goal/state.json",
  "executor_mode": "subagent",
  "executor_spawn_name": "runtime-owner-reuse_runtime-core_g2_a2_0123456789ab",
  "worktree_baseline": {
    "ref": "/absolute/goal/worktree-baseline.json",
    "digest": "<sha256>"
  },
  "source_blocks": {
    "ref": "/absolute/goal/source-blocks.json",
    "digest": "<sha256>"
  },
  "coverage": {
    "ref": "/absolute/goal/coverage.json",
    "digest": "<coverage.json sha256>",
    "semantic_digest": "<source/revision/required-items semantic sha256>"
  },
  "task_id": "T1",
  "logical_id": "runtime.owner-state",
  "title": "实现 Owner 状态机",
  "display_name": "[GA][实施][执行] 实现 Owner 状态机",
  "role": "work",
  "owner_id": "runtime-core",
  "owner_generation": 2,
  "owner_responsibility": "负责任务状态机与并发不变量",
  "owner_context": "保持 reservation、attempt、source revision 与 Capsule 更新原子",
  "owner_capsule_ref": "/absolute/goal/owners/runtime-core/capsule.json",
  "checkpoint_path": "/absolute/goal/owners/runtime-core/checkpoints/T1.json",
  "reservation_token": "<uuid>",
  "attempt": 2,
  "source_revision": 3,
  "task": "实现 Owner affinity、generation fencing 和 Capsule checkpoint",
  "writable_paths": ["tooling/goal-dag/**"],
  "resource_locks": ["goal-dag-runtime"],
  "done_when": ["Owner 可复用也可安全换 Agent"],
  "verification_ids": ["runtime-unit"],
  "satisfies_goal_gates": ["runtime-unit"],
  "plan_item_ids": ["PI-owner-state"],
  "coverage_effect": "implementation",
  "goal_constraints": {
    "scope": ["Goal DAG runtime、skills 和测试"],
    "non_goals": ["部署", "发布"],
    "constraints": ["保留用户已有改动", "结果证据可复核"]
  },
  "side_effect_policy": {
    "deploy": "forbidden",
    "external_write": "forbidden"
  },
  "verification_requirements": {
    "done_when": ["Owner 可复用也可安全换 Agent"],
    "verification_ids": ["runtime-unit"],
    "goal_gates": [
      {
        "id": "runtime-unit",
        "stage": "unit",
        "description": "runtime 单元测试通过",
        "required": true
      }
    ],
    "completion": {
      "all_tasks_completed": true,
      "plan_coverage_100": true,
      "required_gates_passed": true,
      "blocking_findings_zero": true,
      "diff_in_scope": true
    }
  },
  "dependency_result_refs": [],
  "result_path": "/absolute/goal/results/T1/attempt-2-<uuid>.json",
  "result_contract": "WORKER_RESULT_V4",
  "evidence_artifact_paths": {
    "diff-scope-audit": null,
    "source-coverage-audit": null
  },
  "evidence_artifact_contracts": {
    "diff-scope-audit": null,
    "source-coverage-audit": null
  },
  "runtime_profile": null
}
```

固定 audit task 的 binding 会把对应路径/contract 改为非空。`source-coverage-audit` worker 先把逐 block proposal 写到指定路径，再运行：

```text
node <plugin-root>/scripts/goal-dag.mjs source-audit <plan_path> <state_path> <task_id> <reservation_token> <classification_path>
node <plugin-root>/scripts/goal-dag.mjs diff-audit <plan_path> <state_path> <task_id> <reservation_token>
```

`source-audit` 生成 `SOURCE_COVERAGE_AUDIT_V1`；`diff-audit` 生成 `DIFF_SCOPE_AUDIT_V1`。只采用 stdout 返回的精确 artifact ref/digest。

## OWNER_CHECKPOINT_V1

```json
{
  "contract": "OWNER_CHECKPOINT_V1",
  "task_id": "T1",
  "owner_id": "runtime-core",
  "owner_generation": 2,
  "reservation_token": "<uuid>",
  "progress": "已完成 reservation 状态机，正在补 source fencing 测试",
  "decisions": ["Owner 身份与 executor_id 分离"],
  "invariants": ["迟到结果必须匹配 generation、attempt、token 和 source revision"],
  "risks": ["并发 rotate 需要 state lock"],
  "important_symbols": ["reserveCommand", "reconcileCommand"],
  "next_steps": ["补充并发测试", "运行 runtime-unit"]
}
```

先原子写 checkpoint_path，再运行：

```text
node <plugin-root>/scripts/goal-dag.mjs checkpoint <plan_path> <state_path> <task_id> <reservation_token> <checkpoint_path>
```

## WORKER_RESULT_V4

```json
{
  "contract": "WORKER_RESULT_V4",
  "status": "completed",
  "task_id": "T1",
  "logical_id": "runtime.owner-state",
  "role": "work",
  "owner_id": "runtime-core",
  "owner_generation": 2,
  "executor_id": "<state 中的真实 executor_id>",
  "reservation_token": "<uuid>",
  "attempt": 2,
  "source_revision": 3,
  "changed_files": ["tooling/goal-dag/goal-dag.ts"],
  "blocking_findings": [],
  "evidence": [
    {
      "verification_id": "runtime-unit",
      "outcome": "passed",
      "summary": "运行 `python -m unittest tests.test_goal_dag_cli`，exit 0，全部用例通过",
      "artifact_ref": "/absolute/goal/artifacts/T1-attempt-2-runtime-unit.log",
      "artifact_digest": "<artifact sha256>"
    }
  ],
  "diff_self_check": "pass",
  "scope_request": null,
  "summary": "完成 Owner 状态机与 source fencing 测试",
  "owner_updates": {
    "decisions": ["Owner 身份与 executor_id 分离"],
    "invariants": ["finish 必须匹配 generation、attempt、token 和 source revision"],
    "risks": []
  }
}
```

每条 evidence 都必须同时包含 `artifact_ref` 与 `artifact_digest`；没有独立 artifact 时两者均为 null，长日志则写入对应 artifact。`completed` 必须覆盖全部 verification_ids。`source-coverage-audit` 与 `diff-scope-audit` 只允许出现在独立 verify/audit binding 中，passed evidence 必须引用 runtime 生成的固定 audit artifact，并提供非空 ref 与 digest。

## needs_repair

需要扩域时保持 changed_files 为空，并返回精确 scope_request：

```json
{
  "contract": "WORKER_RESULT_V4",
  "status": "needs_repair",
  "task_id": "T1",
  "logical_id": "runtime.owner-state",
  "role": "work",
  "owner_id": "runtime-core",
  "owner_generation": 2,
  "executor_id": "<executor_id>",
  "reservation_token": "<uuid>",
  "attempt": 2,
  "source_revision": 3,
  "changed_files": [],
  "blocking_findings": [],
  "evidence": [],
  "diff_self_check": "scope_exception",
  "scope_request": {
    "paths": ["tooling/goal-dag/build.mjs"],
    "reason": "生成器也必须同步 runtime",
    "required_for_done_when": "分发脚本包含新命令",
    "suggested_owner": "runtime-core",
    "split_hints": ["更新生成器"],
    "overlap_hints": ["goal-dag runtime bundle"]
  },
  "summary": "当前写域不足，未越界修改",
  "owner_updates": {
    "decisions": [],
    "invariants": [],
    "risks": ["生成器与源文件必须同步"]
  }
}
```

所有终态先原子写入 binding 给出的 result_path，再返回相同 JSON。
