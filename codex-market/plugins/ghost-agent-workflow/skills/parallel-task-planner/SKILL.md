---
name: parallel-task-planner
description: 仅供 goal-dag-runner 内部使用：在已验证的 GOAL_CONTRACT_V1 下读取计划源文件，创建 PLAN_COVERAGE_V1 与 DAG_PLAN_V4，或为同一 active Goal 创建覆盖率/失败/源修订所需的 DAG_DELTA_V1。普通用户规划请求、未收口需求、文档审阅和已绑定 worker task 不得触发。
---

# 计划覆盖率与 v4 DAG

## 边界

只生成结构化 coverage、Owner/task 拓扑和局部 delta。不要创建执行单元、选择 Agent、生成完整 worker prompt、复制整篇 source 或把 Mermaid 写入契约。

本 skill 是 Codex runner 自动调用的内部能力，不是公开入口。Codex plan 的 Owner profile 固定为 `gpt-5.6-sol/medium`；Claude Code 因平台模型选择机制不同而使用 `null`。这是有意的平台差异。

写入任何产物前读取 [references/templates.md](references/templates.md)。

## 先建立覆盖率

1. 读取 `goal.json`，再亲自读取 `goal.source.path` 指向的计划文件；不能只根据 Goal 摘要规划。同时读取 `goal-state.source_blocks.ref` 指向的 runtime `SOURCE_BLOCKS_V1` 并校验其 digest/revision。
2. 把 source 拆为稳定、原子、可验收的 required plan items。每个 item 都必须有非空 `source_refs`，只引用当前 source block id；并声明非空 `required_effects`，值只能是 `implementation` 或 `verification`。
3. 先形成 `PLAN_COVERAGE_V1.required_plan_items`，再按 `(plan_item_id, required_effect)` 设计 Owner 和 task。写入 plan 后，把 coverage 的 plan path/digest/revision 绑定到该 plan。
4. 在 `DAG_PLAN_V4.plan_source` 原样记录 source path/digest/revision，并写入绝对 `coverage_path`。
5. 要求每个 task 的 `plan_item_ids` 为非空数组并声明一个 `coverage_effect`：work 必须为 `implementation`；review/verify 可为 `verification` 或 `audit`，不能为 implementation。初始 DAG 必须覆盖每个 required effect pair，而不只是出现一次 item id。

coverage 是完成判定的一部分，不是说明文档。DAG 无 ready/running task 而 required effect pair 仍 pending 时，生成追加 `DAG_DELTA_V1`；不得 finalize。

## Owner 与 task

- 用稳定 `owner_id` 表示 Goal 生命周期内的领域责任，不表示永久 Agent。
- 把共享代码边界、长期不变量和连续决策放入同一 Owner；work、review、verify 使用不同 Owner。
- 一个 Owner 可连续承担多个 task，但同一时刻只运行一个。Agent 复用只是性能优化，Owner Capsule 才是持久真相源。
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
4. source revision 变化时只在 runner 已 drain active reservations 并由 `goal-refresh` 原子刷新 goal/source blocks/绑定后重新读取 source。对每个旧 revision 的 live task 在 `source_dispositions` 中显式选择 `carry_forward` 或 `invalidate`；当前 `source-coverage-audit` 与 `diff-scope-audit` 都必须 invalidate 并由新 audit 替换。
5. 为每个 invalidated task 新增 superseding task，并把所有依赖它的未完成后继一并 invalidate 或改为依赖 replacement。已接受的旧 revision result 只能在明确 carry-forward 后继续作为证据；runtime 会从 Capsule 当前视图移除 invalidated task 的完成、result/evidence refs 和 checkpoint，planner 不得手改 Capsule。
6. source 删除 requirement 时，从新 coverage 移除对应 plan item，并 invalidate 仍引用它的每个 live task；旧 item 只能留在 superseded 历史 task 中。任何 carry-forward live task 继续引用已删除 item 都是非法 delta。
7. 不等待无关 running Owner；delta 只触及受影响闭包。不得全量替换 active plan 或手改 state。
8. 运行 `apply-delta`；校验失败时修正 delta。

```text
node <plugin-root>/scripts/goal-dag.mjs apply-delta <plan.json> <state.json> <delta.json>
```

只有父 objective 改变、未授权外部副作用、破坏性权限或无法安全消歧时退回 runner 请求用户决定。
