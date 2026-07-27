---
name: parallel-task-planner
description: 仅供 subagent-coordination 内部使用：在已验证的 GOAL_CONTRACT_V1 下读取计划源文件，创建 PLAN_COVERAGE_V1 与 DAG_PLAN_V5，或为同一 active Goal 创建覆盖率、失败或源修订所需的 DAG_DELTA_V1。普通用户规划请求、未收口需求、文档审阅和已绑定 worker task 不得触发。
---

# 计划覆盖率与 v5 DAG

## 边界

只生成结构化 coverage、Owner/task 拓扑和局部 delta。不要创建执行单元、选择 Agent、生成完整 worker prompt、复制整篇 source 或把 Mermaid 写入契约。

本 skill 是 Codex `subagent-coordination` 自动调用的内部能力，不是公开入口。Codex plan 的 Owner profile 固定为 `gpt-5.6-sol/high`；Claude Code 因平台模型选择机制不同而使用 `null`。这是有意的平台差异。

写入任何产物前读取 [references/templates.md](references/templates.md) 与 [永久 Owner 治理](../subagent-coordination/references/owner-governance.md)。

## 先建立覆盖率

1. 读取 `goal.json`、approved Owner Registry 与每个相关永久 Capsule，再亲自读取 `goal.source.path` 指向的计划文件；不能只根据 Goal 摘要规划。同时读取 `goal-state.source_blocks.ref` 指向的 runtime `SOURCE_BLOCKS_V1` 并校验其 digest/revision。
2. 把 source 拆为稳定、原子、可验收的 required plan items。每个 item 都必须有非空 `source_refs`，只引用当前 source block id；并声明非空 `required_effects`，值只能是 `implementation` 或 `verification`。
3. 先形成 `PLAN_COVERAGE_V1.required_plan_items`，再按 `(plan_item_id, required_effect)` 设计 Owner 和 task。写入 plan 后，把 coverage 的 plan path/digest/revision 绑定到该 plan。
4. 在 `DAG_PLAN_V5.plan_source` 原样记录 source path/digest/revision，并写入绝对 `coverage_path`。
5. 要求每个 task 的 `plan_item_ids` 为非空数组并声明一个 `coverage_effect`：work 必须为 `implementation`；review/verify 可为 `verification` 或 `audit`，不能为 implementation。初始 DAG 必须覆盖每个 required effect pair，而不只是出现一次 item id。

coverage 是完成判定的一部分，不是说明文档。DAG 无 ready/running task 而 required effect pair 仍 pending 时，生成追加 `DAG_DELTA_V1`；不得 finalize。

## Owner 与 task

- `owner_id` 表示仓库级永久代码功能模块，不是 Goal 生命周期内角色，也不表示物理 Agent。Plan 只能引用 approved Registry 中的 active Owner，并逐字复制其 scope、responsibility、worker_context 与 runtime_profile。
- 同一模块的 work、review、verify、research、repair 和建议都绑定同一 Owner；可为冷启动复核更换物理 executor，但不能新建 review/repair Owner，也不能让另一个模块 Owner 读取、搜索或审查内部代码。
- 一个 Owner 可跨 Goal 连续承担多个 task；同一时刻只运行一个。Agent 复用只是性能优化，永久 `OWNER_CAPSULE_V2` 才是跨 Goal 真相源。
- 每个 task 只产生一个可验收结果。模块 Owner 的 task write scope 必须包含于 approved `scope_patterns - scope_excludes`；read/search 同样不得越界。review/verify task 写域为空但仍由同一 Owner 执行。
- 跨模块需求必须按永久 Owner 拆 task，只通过 `OWNER_INTERFACE_V1`/`OWNER_HANDOFF_V1` 交换公开信息。Planner 不得扫描模块代码替 Owner 做调研；未覆盖或多重匹配必须退回 coordinator 走用户批准的治理流程。
- `runtime_actors[]` 必须精确包含 `source-audit`、`diff-audit`、`commit-readiness`。它们不是 Owner，不得形成模块建议、读取模块内部代码或更新永久 Capsule；task 的 `owner_id` 与 `runtime_actor_id` 必须恰有一个非空。
- `depends_on` 只表达数据依赖；写域或运行资源冲突写入 `resource_locks`。
- 为每个 `verification_id` 保留 Goal gate 的完整 description；覆盖 Goal gate 时同时写 `satisfies_goal_gates`。
- 固定 `source-coverage-audit` 只能交给独立 `verify` task，且 `coverage_effect: audit`。它必须是每个 work task 的祖先，在业务修改前逐项分类全部 `SOURCE_BLOCKS_V1` block；artifact 由 runtime 根据 classification proposal 与当前 coverage 生成。
- 固定 `diff-scope-audit` 只能交给独立 `review` 或 `verify` task，且 `coverage_effect: audit`。它必须在 work 结果之后运行 `diff-audit`，由 runtime 扫描初始 baseline、当前真实工作区和 accepted work results 生成非空 artifact；不能复用实施 worker 的自报 diff。
- 每个有 changed files 的永久 Owner 必须在 diff audit 前完成自己的 review/verify task，发布 current-sequence `COMMIT_ATTESTATION_V1`，文件集合覆盖本 Owner 全部 accepted changes；同一次原子交付的 Owner 必须同意相同 commit message。
- 固定 `commit-readiness` 只能交给同名 runtime actor，必须是 `diff-scope-audit` 的唯一后继终端 task，生成 `DELIVERY_MANIFEST_V1`。它不能修改文件或承担模块审查。
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
3. 普通失败通过 `repairs` 把失败 task 指向新增 replacement；replacement 必须沿用失败 task 的永久模块 Owner，新增 task 仍须有非空 `plan_item_ids`。同 Owner 精确 write-path 漏项优先由 runtime `expand-task-scope` 处理，不生成 delta；`add_owners` 只能引用已批准 Owner，绝不表示创建 Owner。
4. source revision 变化时只在 coordinator 已 drain active reservations 并由 `goal-refresh` 原子刷新 goal/source blocks/绑定后重新读取 source。对每个旧 revision 的 live task 在 `source_dispositions` 中显式选择 `carry_forward` 或 `invalidate`；三个固定 runtime actor task 都必须 invalidate 并替换。
5. 为每个 invalidated task 新增 superseding task，并把所有依赖它的未完成后继一并 invalidate 或改为依赖 replacement。已接受的旧 revision result 只能在明确 carry-forward 后继续作为证据；runtime 会从 Capsule 当前视图移除 invalidated task 的完成、result/evidence refs 和 checkpoint，planner 不得手改 Capsule。
6. source 删除 requirement 时，从新 coverage 移除对应 plan item，并 invalidate 仍引用它的每个 live task；旧 item 只能留在 superseded 历史 task 中。任何 carry-forward live task 继续引用已删除 item 都是非法 delta。
7. 不等待无关 running Owner；delta 只触及受影响闭包。不得全量替换 active plan 或手改 state。
8. 运行 `apply-delta`；校验失败时修正 delta。

```text
node <plugin-root>/scripts/goal-dag.mjs apply-delta <plan.json> <state.json> <delta.json>
```

只有父 objective 改变、Owner 覆盖缺口/冲突、Owner 新增/分裂、未授权外部副作用、破坏性权限或无法安全消歧时退回 coordinator 请求用户决定。
