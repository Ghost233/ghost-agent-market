---
name: goal-dag-runner
description: 仅当用户显式运行 /ghost-agent-workflow:goal-dag-runner，并要求从计划文档启动、继续、查看或修订本地 Goal DAG 时使用；把计划编译为带覆盖率、Owner Capsule 和可复核证据的持久 DAG。普通任务、普通讨论、文档审阅、仅写 $goal-dag-runner 或未使用插件 skill 调用的请求不得触发。
disable-model-invocation: true
---

# Claude Code 本地 Goal DAG

## 平台边界

Claude Code 平台没有 Codex 原生 Goal 外循环，因此明确使用 `lifecycle.controller: local_fallback`。这是有意的平台差异，不伪装成原生 Goal，也不引用 Codex 的生命周期工具。

公开入口只有：

```text
/ghost-agent-workflow:goal-dag-runner 执行 <开发文档路径>
```

`$goal-dag-runner` 不是 Claude Code 插件 skill 的显式调用语法，不能据此启动。用户写“仅规划”时只规划；默认 mode 为 `subagent`，只有用户明确要求时才使用 `thread`。

## 本地文件

为新目标创建：

```text
.ghost-agent-workflow/goals/<goal_id>/
├── goal.json
├── goal-state.json
├── worktree-baseline.json
├── source-blocks.json
├── coverage.json
├── plan.json
├── state.json
├── artifacts/
├── results/<task_id>/attempt-<attempt>-<reservation_token>.json
└── owners/<owner_id>/
    ├── capsule.json
    └── checkpoints/
```

Claude Code 没有 native instance。默认 `<goal_id>` 形如 `<可读-slug>--<local-instance-sha256-prefix>`，suffix 至少为 `SHA-256(UTF-8(source 绝对路径 + "\n" + source digest))` 的前 12 位小写 hex。slug 必须归一化并裁剪，使完整 id 匹配 `[A-Za-z0-9][A-Za-z0-9._-]{0,95}`；无可用 slug 时使用 `goal`。相同 path+digest 默认定位并恢复同一本地 Goal；若当前调用的 objective、mode、约束或副作用策略与已有契约不同，则停止并要求显式新实例，不能静默改写。要再次执行同一份完全相同的 source，用户必须明确写“新建实例 <稳定 instance key>”，digest seed 再追加 `"\n" + instance key`。任何首次调用都不得覆盖已有目录。

首次创建前读取 [references/goal-contract.md](references/goal-contract.md)。需要规划时再加载内部 `parallel-task-planner`；需要执行时只加载契约 mode 对应的 coordinator。

## 首次启动

1. 解析插件调用参数中的唯一计划文档路径，转为绝对路径，读取内容并计算 digest；缺失或歧义时停止。按 source path+digest 生成默认 local instance；若同一默认 instance 已存在则恢复它，只有用户显式提供稳定的新 instance key 时才创建同 source 的另一目录。
2. 合并仓库强制策略、计划验收与用户追加要求。固定加入 required gate `source-coverage-audit` 与 `diff-scope-audit`；用户只能增加 gate 或显式授权副作用，不能移除强制项。
3. 写入 `GOAL_CONTRACT_V1`：`execution_platform: claude_code`、绝对 `workspace.root`、`lifecycle.controller: local_fallback`、`lifecycle.native_goal: null`、`source.revision: 1`、scope、constraints、non-goals、side-effect policy 与 verification gates。
4. 运行 `goal-validate`；它先捕获 `WORKTREE_BASELINE_V1` 和 `SOURCE_BLOCKS_V1`，再写入带 ref/digest 的 goal state。不得把整篇计划复制进 Goal Contract，也不得在 baseline 之前分发业务 task。
5. 让 planner 亲自读取 source 和 runtime 生成的 source blocks，先生成带 `source_refs`/`required_effects` 的 `PLAN_COVERAGE_V1`，再生成带 `coverage_effect` 的 `DAG_PLAN_V4`。运行 `validate` 和 `render`。
6. 若用户明确只规划，返回计划和覆盖率；否则按 mode 调用 coordinator。

```text
node <plugin-root>/scripts/goal-dag.mjs goal-validate <goal.json>
node <plugin-root>/scripts/goal-dag.mjs validate <plan.json>
node <plugin-root>/scripts/goal-dag.mjs render <plan.json>
```

## 每次恢复

1. 从插件调用参数中的绝对 `goal.json` 路径定位状态；没有唯一路径时要求补充。读取候选后仍精确校验 `goal_id`、source path 与已持久化 digest，不能只凭 slug 或短 suffix 接受。
2. 先运行 `goal-validate <goal>`，机械复核平台、source 与本地生命周期绑定并恢复未完成事务；成功后再运行 `status`、`reconcile <plan> <state>`。按 coordinator 恢复矩阵处理 active reservation 后才能 reserve。
3. `source_status: source_missing` / `next_action: user_blocked` 时停止新 reserve，保留现有状态并要求恢复同一绝对 source path；不得猜测新计划、改 `source.path`、调用 `goal-refresh` 或误报完成。已运行 task 只可按 canonical result 安全收口。
4. source digest 变化时停止 reserve；先 drain 已有 reservation（完成则 finish；丢失则先 reclaim，再停止返回的物理 executor，并运行 `confirm-stale-executor`）。active reservation 与 stale executor 清零后运行 `goal-refresh`，由 runtime 事务原子更新 goal/source revision、`SOURCE_BLOCKS_V1`、plan/coverage 绑定、state 与 Capsule digest，再生成 `DAG_DELTA_V1`。不得边跑旧 task 边刷新。
5. source delta 对旧 revision 的每个 live task 显式写 `carry_forward` 或 `invalidate`；`source-coverage-audit` 与 `diff-scope-audit` 都必须 invalidate 并替换。invalidated task 的当前完成、result/evidence refs 与 active checkpoint 必须从 Capsule 当前视图移除，历史 attempt 文件只保留审计。
6. DAG 暂时耗尽但 coverage 仍有 pending effect 时生成追加 delta，不得 finalize。
7. failed、blocked、needs_repair 只修订受影响子图；普通失败保留在本地 DAG/result。

```text
node <plugin-root>/scripts/goal-dag.mjs goal-validate <goal.json>
node <plugin-root>/scripts/goal-dag.mjs status <plan_path> <state_path>
node <plugin-root>/scripts/goal-dag.mjs reconcile <plan_path> <state_path>
node <plugin-root>/scripts/goal-dag.mjs goal-refresh <goal.json> <goal-state.json> <plan.json> <state.json>
node <plugin-root>/scripts/goal-dag.mjs apply-delta <plan.json> <state.json> <delta.json>
```

当前调用结束而本地 Goal 尚未完成时，逐字返回最近一次 runtime `status` 或 `goal-validate` 输出的 `continuation_prompt`；不要自行拼接、相对化或摘要。其值必须精确是一行：

```text
/ghost-agent-workflow:goal-dag-runner 继续 `<goal.json绝对路径>`。
```

不要拼入计划、Goal Contract、DAG、Owner Capsule、worker prompt 或人工摘要。

## 完成

只在当前 source digest/revision 仍冻结、effect-aware planned/completed coverage 都为 100%、所有有效 task resolved、required gate 证据通过且无阻断 finding 时运行。`source-coverage-audit` 与 `diff-scope-audit` 都必须有 runtime 绑定的 artifact ref/digest；后者必须来自对初始 baseline 与当前真实工作区的独立扫描。`finalize` 会重新读取 source，任何未刷新的 drift 都必须拒绝：

```text
node <plugin-root>/scripts/goal-dag.mjs finalize <goal.json> <goal-state.json> <plan.json> <state.json>
```

对 `local_fallback`，只有 `finalize` 返回 `completed` 才结束本地 Goal。不得调用任何 Codex 原生 Goal 桥接；若尚未完成，继续返回固定短提示。
