---
name: parallel-task-planner
description: 仅供 subagent-coordination 内部使用：在已验证的 GOAL_CONTRACT_V1 下读取计划源文件，创建 PLAN_COVERAGE_V1 与 DAG_PLAN_V4，或为同一 active Goal 创建覆盖率、失败或源修订所需的 DAG_DELTA_V1。普通用户规划请求、未收口需求、文档审阅和已绑定 worker task 不得触发。
user-invocable: false
---

# 计划覆盖率与 v4 DAG

## 边界

只生成结构化 coverage、Owner/task 拓扑和局部 delta。不要创建执行单元、选择 Agent、生成完整 worker prompt、复制整篇 source 或把 Mermaid 写入契约。

本 skill 是 Claude Code `subagent-coordination` 自动调用的内部能力，不是公开入口。Claude Code 由平台选择 worker profile，因此 Owner 的 `runtime_profile` 必须为 `null`；Codex 则固定模型和 reasoning effort。这是有意的平台差异。

写入任何产物前参考本 SKILL.md 末尾「## 契约与模板」节（PLAN_COVERAGE_V1 / DAG_PLAN_V4 / DAG_DELTA_V1 已内联，不再 Read references）。

## 先建立覆盖率

1. 读取 `goal.json`，再亲自读取 `goal.source.path` 指向的计划文件；不能只根据 Goal 摘要规划。同时读取 `goal-state.source_blocks.ref` 指向的 runtime `SOURCE_BLOCKS_V1` 并校验其 digest/revision。
2. 把 source 拆为稳定、原子、可验收的 required plan items。每个 item 都必须有非空 `source_refs`，只引用当前 source block id；并声明非空 `required_effects`，值只能是 `implementation` 或 `verification`。
3. 先形成 `PLAN_COVERAGE_V1.required_plan_items`，再按 `(plan_item_id, required_effect)` 设计 Owner 和 task。若 Goal 关联 owner 注册表，先用只读 `owner-query` 检查 active Owner 覆盖；retired tombstone 只保留历史，不提供覆盖，`depends_on_owners` 必须引用 active Owner 且无自依赖/环。`can_cover=false` 时交 controller 运行 `--plan`，展示 proposal 后由用户确认，再以 `--confirm <proposal_digest>` 落盘；digest 只绑定 proposal/registry freshness，不能证明 AskUserQuestion。写入 plan 后绑定 coverage 的 plan path/digest/revision。
4. 在 `DAG_PLAN_V4.plan_source` 原样记录 source path/digest/revision，并写入绝对 `coverage_path`。
5. 要求每个 task 的 `plan_item_ids` 为非空数组并声明一个 `coverage_effect`：work 必须为 `implementation`；review/verify 可为 `verification` 或 `audit`，不能为 implementation。初始 DAG 必须覆盖每个 required effect pair，而不只是出现一次 item id。
6. 产出 `DAG_PLAN_V4` 后，若 Goal 关联 owner 注册表，后置调只读 `owner-verify-plan` 机械复核（owner 未注册或 writable 越界即 `fail`），通过后才交 runtime。

coverage 是完成判定的一部分，不是说明文档。DAG 无 ready/running task 而 required effect pair 仍 pending 时，生成追加 `DAG_DELTA_V1`；不得 finalize。

## Owner 与 task

- 用稳定 `owner_id` 表示 Goal 生命周期内的领域责任，不表示永久 Agent。
- 把共享代码边界、长期不变量和连续决策放入同一 Owner；work、review、verify 使用不同 Owner。
- 一个 Owner 可连续承担多个 task，但同一时刻只运行一个。`owner_affinity` 复用 + 命名子代理完成后不回收，是 owner 模型的承重机制（支持 SendMessage 跨 attempt 稳定寻址做任务分发/状态查询；记忆汇总 via SendMessage 是可选增强），不是可选性能优化；Owner Capsule 是持久真相源。仅跨 Goal 才不复用，同一 Goal 内命名子代理稳定存活以承接二次寻址。
- 每个 task 只产生一个可验收结果。`work.writable_paths` 必须包含于 Owner 写域；review/verify 写域为空。
- `depends_on` 只表达数据依赖；写域或运行资源冲突写入 `resource_locks`。
- 为每个 `verification_id` 保留 Goal gate 的完整 description；覆盖 Goal gate 时同时写 `satisfies_goal_gates`。
- 固定 `source-coverage-audit` 只能交给独立 `verify` task，且 `coverage_effect: audit`。它必须是每个 work task 的祖先，在业务修改前逐项分类全部 `SOURCE_BLOCKS_V1` block；artifact 由 runtime 根据 classification proposal 与当前 coverage 生成。
- 固定 `diff-scope-audit` 只能交给独立 `review` 或 `verify` task，且 `coverage_effect: audit`。它必须在 work 结果之后运行 `diff-audit`，由 runtime 扫描初始 baseline、当前真实工作区和 accepted work results 生成非空 artifact；不能复用实施 worker 的自报 diff。
- 低风险 work 自验闭环。只为跨边界、安全、迁移、并发语义或显式要求增加独立 review。
- 有无冲突并行节点时使用 `parallel_safe`；否则用 `sequential_only`。未授权破坏性或外部副作用使用 `needs_user_review`。

```text
node <plugin-root>/scripts/goal-dag.mjs validate <absolute-plan.json>
node <plugin-root>/scripts/goal-dag.mjs render <absolute-plan.json>
```

## 局部修订与 source fencing

失败、范围变化、coverage pending 或 source revision 变化时只生成 `DAG_DELTA_V1`：

1. 读取当前 goal、coverage、plan/state、受影响 result、Owner Capsule 与直接依赖 result refs。
2. 使用当前 plan SHA-256 作为 `base_plan_digest`，revision 增加 1；通过 `coverage_update.required_plan_items` 提交完整新覆盖集合。
3. 普通失败通过 `repairs` 把失败 task 指向新增 replacement；新增 task 仍须有非空 `plan_item_ids`。
4. source revision 变化时只在 coordinator 已 drain active reservations 并由 `goal-refresh` 原子刷新 goal/source blocks/绑定后重新读取 source。对每个旧 revision 的 live task 在 `source_dispositions` 中显式选择 `carry_forward` 或 `invalidate`；当前 `source-coverage-audit` 与 `diff-scope-audit` 都必须 invalidate 并由新 audit 替换。
5. 为每个 invalidated task 新增 superseding task，并把所有依赖它的未完成后继一并 invalidate 或改为依赖 replacement。已接受的旧 revision result 只能在明确 carry-forward 后继续作为证据；runtime 会从 Capsule 当前视图移除 invalidated task 的完成、result/evidence refs 和 checkpoint，planner 不得手改 Capsule。
6. source 删除 requirement 时，从新 coverage 移除对应 plan item，并 invalidate 仍引用它的每个 live task；旧 item 只能留在 superseded 历史 task 中。任何 carry-forward live task 继续引用已删除 item 都是非法 delta。
7. 不等待无关 running Owner；delta 只触及受影响闭包。不得全量替换 active plan 或手改 state。
8. 运行 `apply-delta`；校验失败时修正 delta。

```text
node <plugin-root>/scripts/goal-dag.mjs apply-delta <plan.json> <state.json> <delta.json>
```

worker 因同一业务文件反复改 >3 次回 `needs_repair` 时，按方案问题重判该闭包：拆分 task、调整 coverage 或换实现路径，而非简单 `repairs` 换一个同质 replacement 让 worker 继续硬磨。

worker 因 task 实际复杂度远超单 task 粒度回 `needs_repair` 时，优先在同 owner 内拆成多个 task（每个有独立 `plan_item_ids` 与可验收 `done_when`）；只有涉及跨 owner 模块边界、需新增功能域角色时，才建议 owner 拆分（`owner-split`/`owner-add`，须 controller 经 AskUserQuestion 用户确认）。

只有父 objective 改变、未授权外部副作用、破坏性权限或无法安全消歧时退回 coordinator 请求用户决定。

## owner 覆盖检查（功能域角色）

若 Goal 关联了 owner 注册表（`.ghost-agent-workflow/owners/registry.json`），planner 在规划期单点调用两个 in-scope 只读校验：

- 前置 `owner-query`：只允许 active Owner 覆盖需求；retired tombstone 不参与。`can_cover=false` 时 planner 不写 registry，交 controller 执行 `--plan` → AskUserQuestion → `--confirm <proposal_digest>`。
- 后置 `owner-verify-plan`：产出 plan 后机械复核 active owner、writable scope 和 dependency graph；失败即停止。
- 只有带非空可写 work task 的 active Owner 进入 `owner_delivery`；review/verify-only Owner 不阻塞 commit/merge。planner 不自行发明 Goal-aware worktree 参数，使用 runtime 的 registry-first worktree surface，由 controller 通过 `owner-bind-goal` 与 `owner-delivery-reconcile` 同步。

`owner-query`、`owner-verify-plan` 是只读操作，在本 skill 内执行；`owner-add`、`owner-split` 是写操作，由 controller 驱动，不在本 skill 内执行。plan 的 `owners[].id` 必须引用 registry `lifecycle=active` 的 owner，`writable_paths` 由其 `owned_modules` 派生（review/verify owner 派生为空）。

```text
node <plugin-root>/scripts/goal-dag.mjs owner-query <registry.json> <requirement.json>
node <plugin-root>/scripts/goal-dag.mjs owner-verify-plan <registry.json> <plan.json>
```

## 契约与模板

> 以下模板原存于 `references/templates.md`，现已内联于本节，planner 触发本 skill 即见，无需再 Read references。

### Coverage、Plan 与 Delta 模板

#### PLAN_COVERAGE_V1

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

#### DAG_PLAN_V4

```json
{
  "contract": "DAG_PLAN_V4",
  "planner": "parallel-task-planner",
  "plan_format_version": 4,
  "revision": 1,
  "execution_platform": "claude_code",
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

Claude Code 每个 Owner 的 `runtime_profile` 必须为 `null`，由平台选择实际模型。每个 work task 必须依赖当前 `source-coverage-audit`；所有 task 都必须有非空 `plan_item_ids` 和合法 `coverage_effect`。

若 Goal 关联 owner 注册表，`owners[].id` 必须引用 registry `lifecycle=active` 的 owner，`writable_paths` 由该 owner 的 `owned_modules` 派生（review/verify owner 派生为空）；产 plan 后由 planner 调只读 `owner-verify-plan` 复核。`owner-query` 的输入 `requirement.json` 最小样例见下节。

#### requirement.json（owner-query 输入，最小样例）

`owner-query` 用 requirement.json 描述本 Goal 需要覆盖的写入模块与能力，registry 据此判断现有 active owner 能否覆盖：

```json
{
  "requirement_id": "req-runtime-owner-state",
  "modules": ["tooling/goal-dag/**", "tests/test_goal_dag_cli.py"],
  "capabilities": ["reservation", "attempt", "capsule-checkpoint"],
  "notes": "覆盖 Owner 状态机所需的写入范围与能力"
}
```

`modules` 即候选 owner 的 `owned_modules` 比对范围；`capabilities` 是非必需的语义标签。`can_cover=false` 时 planner 不得自行写 registry，交 controller 经 `--plan` + `AskUserQuestion` 执行 `owner-add`/`owner-split`。

#### DAG_DELTA_V1：source revision 刷新

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
