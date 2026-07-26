---
name: subagent-goal-worker
description: 仅供 subagent-coordination 分发完整 TASK_BINDING_V4 时内部使用，且 binding.executor_mode 必须为 subagent；执行同一 Goal/Owner 的一个 fenced attempt，从 Owner Capsule 恢复上下文并写入唯一 WORKER_RESULT_V4。普通请求、不完整绑定、其他 mode 或绕过 coordinator 的调用不得触发。
user-invocable: false
---

# Claude Code 子代理 Worker

## 边界

只执行一个 binding。逻辑 Owner 与 Capsule 是持久真相源。Owner 模型下，命名子代理（Agent 名 = `owner-<owner_id>`）的 owner_affinity 复用是承重机制（支撑 SendMessage 跨 attempt 稳定寻址做任务分发/状态查询；会话记忆/记忆汇总 via SendMessage 是可选增强），不是可选性能优化；仅跨 Goal 才不复用。「低频回收后台 Agent」仅指非 owner 的普通 executor。

不得创建或委派其他执行单元。不得修改 goal/coverage/plan/state/capsule，不得直接编辑 `capsule.json`，不得暂存、提交、推送或扩大 Goal。不得写 `owners/<id>/memory.md` 或 `requirements/`（controller owner-note 职责；worker 写入违反写白名单并触发 L3 per-owner scope audit 越界 fail）。协调元数据只允许写 binding 指定的 checkpoint_path、attempt 唯一 result_path，以及固定 audit binding 中非空的精确 `evidence_artifact_paths`（source proposal/runtime audit artifact）；其它 runtime 路径不可写。

Claude Code binding 的 runtime profile 为 `null`，由平台选择执行配置；Codex 固定 profile。这是有意的平台差异。每次接收 binding 时参考本 SKILL.md 末尾「## 契约与模板」节（TASK_BINDING_V4 / OWNER_CHECKPOINT_V1 / WORKER_RESULT_V4 等已内联，不再 Read references）。

## Owner 环境自检

命名子代理（Agent 名 = `owner-<owner_id>`，binding 含非空 `owner_exec`）开工前自检三项，任一不满足立即返回 `needs_repair`，不重试、不换路径绕过：

1. `owner_exec.agent_type` 必须为 `owner-<owner_id>`，与当前 Agent 的稳定身份一致。普通 executor 的 `owner_exec` 必须显式为 `null`，跳过本节 Owner 自检。
2. 实际 cwd 必须等于 `owner_exec.worktree_path`，当前 Git branch 必须等于 `owner_exec.owner_branch`，HEAD 必须满足 `base_oid`/已登记提交的 ancestry 预期，且可见范围覆盖 `owned_modules_glob`。runtime `bind` 只验证登记信息，不验证宿主进程的实际 cwd/branch/HEAD；因此这些检查由 worker 承担。宿主无法进入既有 runtime worktree、worktree 丢失或任一检查不符时返回 `needs_repair`，不得创建第二个 worktree或退回主 checkout。
3. Owner Agent 的 Bash 默认由 L1 hook 拒绝；文件修改只使用带结构化路径的写工具。L1 deny 时直接返回 `needs_repair`，不得换路径或通过 shell 绕过。L2 sparse 只是 visibility superset，最终授权以 L1/L3 exact matcher 为准。

## 绑定门禁

1. 要求完整 `TASK_BINDING_V4`，`executor_mode: subagent`，且 `executor_spawn_name`、`attempt`、`reservation_token`、`source_revision`、`worktree_baseline`、`source_blocks`、`coverage.{ref,digest,semantic_digest}`、非空 `plan_item_ids`、`coverage_effect`、goal constraints、side-effect policy、verification requirement descriptions、artifact path/contract maps 与唯一 result_path 全部存在。
2. 读取 state，等待 task 进入 running；核对 task、Owner、generation、executor_id、attempt、token、source revision 和 result_path。
3. 重新计算并核对 `worktree_baseline`、`source_blocks` 与 `coverage` 的绑定 digest/semantic digest；从 state 的 `result_ref/result_digest` 核对直接 `dependency_result_refs`。读取 Owner Capsule 时核对 ref、owner、generation、goal/source revision 和结构字段；binding 未提供 Capsule digest，不得假称已做 digest 校验。普通 task 不读取整篇 source 或无关 task；`source-coverage-audit` 例外，必须按 `SOURCE_BLOCKS_V1` 的全部 line span 读取 source，并从 `coverage.ref` 读取 required items↔source refs，校验 semantic digest 后逐块分类。使用 `plan_item_ids + coverage_effect` 维持本 task 与 required effect 的精确映射。
4. 任一身份或路径不一致时不修改业务文件，返回原始错误。同一 task/attempt/token 的完全相同 binding 是 crash recovery 重投：不得重置进度、并发重复执行或覆盖已有 canonical result；继续当前 attempt，结果已存在时只返回同一结果。只有 state 已进入新 attempt 且新 binding 完整通过门禁时，才替换旧 task 权限。同一 Agent 同时只能执行一个 binding。
5. 新 generation Agent 从 Capsule 的 decisions、invariants、progress、important_symbols 与 next_steps 恢复，不依赖旧 Agent 存活。

## 执行与副作用边界

- 只处理 binding 的 `plan_item_ids` 所映射范围，满足 task、done_when 与 `verification_requirements`；不得自行扩张到其他 coverage item。
- 只修改 `goal_constraints.scope` 与 `writable_paths` 的交集；不得违反 constraints/non_goals。
- `side_effect_policy` 未显式授权的部署或外部写入一律禁止。不要把验证命令解释成副作用授权。
- `work` 只修改 writable paths；`review` 和 `verify` 保持 changed_files 为空。
- 共享工作区中的并行兄弟改动不是本 task 产物。不得撤销或覆盖用户与其他 Owner 的合法改动。
- 需要越过 scope、non-goal 或 side-effect policy 时先停止，返回 `needs_repair` 与精确 scope_request；不得先做后报。
- 读业务源码用 `grep`/`Glob` 定位再精读相关段，不整篇 `Read` 大文件。
- 同一业务文件反复改 **>3 次**仍不收敛时回 `needs_repair`（注明反复改的文件与已尝试方案），让 `parallel-task-planner` 重判该闭包（拆分或换方案），不硬磨。
- 开工后若发现 task 实际复杂度远超单 task 合理粒度（多模块大面积改、多步骤耦合逻辑、或一个 task 含多个可独立验收的子目标），不要硬扛：返回 `needs_repair`，scope_request 注明「task 过大，建议拆分」并列出感知到的子目标与涉及模块。重拆**优先在同 owner 内拆成多个 task**；只有涉及跨 owner 模块边界、需新增功能域角色时，才在 scope_request 标注「建议 owner 拆分」（`owner-add`/`owner-split` 由 controller 经用户确认，worker 不直接做）。

## Checkpoint 与证据

在关键决策后、长验证前、感知上下文压力或准备轮换时写 `OWNER_CHECKPOINT_V1`，再调用 driver `checkpoint`。只保存恢复事实，不复制源码、完整日志或聊天历史。

每条 evidence 必须对应 binding 中的 requirement description，并记录可复核的命令/方法、outcome、关键输出摘要、`artifact_ref` 与 `artifact_digest`；没有 artifact 时两者都写 null，不能省字段或只写“已验证”。

- `source-coverage-audit`：把每个 block 的 `mapped`（精确 plan item ids）或 `non_requirement`（非空理由）proposal 写入 binding `evidence_artifact_paths` 的精确路径，再运行 runtime `source-audit`。不得遗漏 block 或自己伪造最终 `SOURCE_COVERAGE_AUDIT_V1`。
- `diff-scope-audit`：直接运行 runtime `diff-audit`。runtime 会扫描 Goal 初始 `WORKTREE_BASELINE_V1`、当前真实工作区和 accepted work results；不得只复述 `changed_files` 或手写 `DIFF_SCOPE_AUDIT_V1`。
- 两个命令 stdout 返回的 `artifact_ref` 与 SHA-256 `artifact_digest` 必须原样放入对应 evidence；不得换路径、重算到别的文件或复用旧 revision artifact。

## 结果

1. 完成最小完整实现或只读检查，逐项核对 plan items、done_when 与 verification requirements。
2. 做 diff_self_check，只归因当前 attempt 的 changed files，并显式记录 `blocking_findings`。
3. 构造一个 `WORKER_RESULT_V4`；task、Owner、generation、executor、attempt、token 与 source revision 必须与 binding/state 一致。
4. 先原子写入 binding 的唯一 result_path，再返回相同 JSON。不得覆盖其他 attempt 文件。
5. 把可复用决策、不变量和风险放入 `owner_updates`，由 driver 合并 per-Goal Capsule。`owner_updates` 与 evidence 只回决策/不变量/风险/命令/outcome 摘要与 artifact ref，**不贴源码片段**——源码留在 worker 自己 context，主线程靠 result 与 artifact ref 裁决，避免主 context 雪球。worker 绝不写 `owners/<id>/memory.md` 或 `requirements/`（controller 在主工作区经 owner-note 沉淀跨 Goal registry memory）。命名子代理 SendMessage 二次寻址做记忆汇总为可选增强，平台前提验证后启用；当前默认 controller 据 owner_updates + diff 自写 owner-note。

`completed` 必须为每个 verification id 提交 passed evidence，并完成 binding 声明的 coverage effect。两个固定 audit gate 只能由独立 audit binding 提交，且 artifact ref/digest 都非空；实施 worker 的 diff_self_check 不能代替它们。普通失败使用 failed/blocked；扩域或阻断审查使用 needs_repair。driver 的 `finish` 是身份、范围、revision、artifact 内容与证据的唯一机械裁决。

## 契约与模板

> 以下契约原存于 `references/templates.md`，现已内联于本节，worker 触发本 skill 即见，无需再 Read references。

### Subagent Worker 契约

#### TASK_BINDING_V4

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
  "owner_exec": {
    "agent_type": "owner-runtime-core",
    "worktree_path": "/absolute/repo/.ghost-agent-workflow/worktrees/0123456789/runtime-core",
    "owner_branch": "owner_runtime-core_0123456789",
    "base_oid": "<40-hex>",
    "owned_modules_glob": ["tooling/goal-dag/**"]
  },
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

字段说明（owner 模式相关）：

- `executor_spawn_name`：per-attempt reservation token（形如 `runtime-...-g2_a2_<hex>`），仅用作 executor_id / reservation token 绑定，绝不是 Agent 工具 spawn 的 name。Agent Spawn name = `owner-<owner_id>`（稳定，跨 attempt 不变，作 SendMessage 二次寻址句柄）。coordinator 以 `owner-<owner_id>` 为 Agent 名 spawn；`executor_spawn_name` 仅作 executor_id bind。
- `owner_exec`：字段始终存在；普通 executor 为 `null`，Owner work task 为对象，且精确包含 `agent_type`、`worktree_path`、`owner_branch`、`base_oid`、`owned_modules_glob`。它描述 registry/Goal 登记的执行环境，不证明宿主进程已进入该路径；worker 必须执行上方 cwd/branch/HEAD 自检。
- `writable_paths`：派生自 registry.owners[].owned_modules（经 owner-verify-plan 机械复核），与 `goal_constraints.scope` 取交集；worker 只写两者交集。

固定 audit task 的 binding 会把对应路径/contract 改为非空。`source-coverage-audit` worker 先把逐 block proposal 写到指定路径，再运行：

```text
node <plugin-root>/scripts/goal-dag.mjs source-audit <plan_path> <state_path> <task_id> <reservation_token> <classification_path>
node <plugin-root>/scripts/goal-dag.mjs diff-audit <plan_path> <state_path> <task_id> <reservation_token>
```

`source-audit` 生成 `SOURCE_COVERAGE_AUDIT_V1`；`diff-audit` 生成 `DIFF_SCOPE_AUDIT_V1`。只采用 stdout 返回的精确 artifact ref/digest。

#### OWNER_CHECKPOINT_V1

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

#### WORKER_RESULT_V4

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

#### needs_repair

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
