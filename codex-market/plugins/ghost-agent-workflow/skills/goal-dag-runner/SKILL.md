---
name: goal-dag-runner
description: 仅当当前 Codex 原生 Goal 的 objective 显式包含 $goal-dag-runner，并要求从计划文档启动、继续、查看或修订 Goal DAG 时使用；把原生 Goal 作为外循环，把带计划覆盖率、Owner Capsule 和可复核证据的本地 DAG 作为内循环。普通任务、普通讨论、文档审阅、仅出现 /goal 但 objective 未点名本 skill 的请求不得触发。
---

# Codex 原生 Goal 的 DAG 内循环

## 平台边界

把 Codex 原生 Goal 作为唯一外层生命周期控制器，把本地 Goal DAG 作为可恢复执行内循环。公开入口只有本 skill。推荐由用户输入：

```text
/goal 每轮使用 $goal-dag-runner，以子代理 DAG 完整执行 `./plan.md`，直到计划项覆盖率 100% 且所有验收通过。
```

不要解析 `/goal` 命令；平台已经把它转换为原生 Goal objective。不要创建原生 Goal，不要改写 objective。只依据 `get_goal` 返回的当前 objective 触发和绑定。

Codex 与 Claude Code 有意不同：Codex 使用 `lifecycle.controller: codex_native` 并桥接原生 Goal；Claude Code 没有这组生命周期工具，使用 `local_fallback` 和显式插件 skill 续跑。

## 每轮入口

严格按以下顺序开始每一轮：

1. 首先调用 `get_goal`，只读取得当前原生 Goal 的 `threadId`、`createdAt`、`status` 与 objective 原文。
2. 要求 objective 原文显式包含 `$goal-dag-runner`。正常执行只接受 `active`；`complete` 只允许用于同一原生 Goal instance 的本地 `native_completion_pending` 收尾。
3. 对 objective 原文计算 SHA-256，并把 `threadId + createdAt` 作为原生 Goal instance identity。首次启动时把三者原样写入本地契约；恢复时全部精确一致。不要用摘要、续跑文本、`updatedAt` 或路径重写它。
4. 以 `SHA-256(UTF-8(threadId + "\n" + String(createdAt)))` 的前 12 位小写 hex 作为 instance suffix；新 `goal_id` 和目录名都必须包含该 suffix，可在前面加可读 slug，不能只用 objective 或标题命名。首次创建不得覆盖现有目录；若短前缀碰撞到不同 identity，逐步延长同一 digest 的前缀。
5. 用 instance suffix 扫描或定位 `goal.json` 后，仍必须读取候选契约并精确校验完整 `threadId + createdAt` 和 objective digest；目录名只是定位索引，不能只按 objective digest 或短 suffix 复用旧 Goal。相同 objective 的新原生 instance 必须创建独立目录。已有 Goal 先运行 `goal-validate`，机械恢复未完成事务。
6. 若返回的本地状态已经 completed/native pending，立即跳到“原生完成桥接”，使用已持久化的同一 completion token 收尾；不要运行 status/reconcile/finalize，也不要重新校验此后可能变化的 source 或 worktree。
7. 其它 active Goal 才继续运行 `status`、`reconcile`。在三者之前不要 reserve、bind 或分发。

```text
node <plugin-root>/scripts/goal-dag.mjs goal-validate <goal.json>
node <plugin-root>/scripts/goal-dag.mjs status <plan_path> <state_path>
node <plugin-root>/scripts/goal-dag.mjs reconcile <plan_path> <state_path>
```

objective 缺少显式 skill 名、digest 不匹配或无法唯一绑定时停止，不修改本地状态，也不代替用户创建新外层目标。

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

Codex 的 `<goal_id>` 形如 `<可读-slug>--<native-instance-sha256-prefix>`；suffix 至少 12 位，且只由 `threadId + "\n" + createdAt` 计算。slug 必须归一化为 runtime identifier 允许的 ASCII 字符并裁剪，使完整 id 匹配 `[A-Za-z0-9][A-Za-z0-9._-]{0,95}`；无法生成可读 slug 时使用 `goal`。同 objective 可以产生多个独立 native instance，因此 objective slug 不能充当唯一目录名。

首次创建前读取 [references/goal-contract.md](references/goal-contract.md)。需要规划时再加载内部 `parallel-task-planner`；需要执行时只加载契约 mode 对应的 coordinator。

## 首次启动

1. 从 objective 解析唯一计划文档路径，解析为绝对路径，读取内容并计算 digest；缺失或歧义时停止。按本轮 native instance digest 生成不覆盖既有目录的 `goal_id`。
2. 合并仓库强制策略、计划验收和 objective 追加要求。固定加入 required gate `source-coverage-audit` 与 `diff-scope-audit`；objective 只能增加 gate 或授权副作用，不能移除强制项。
3. 写入 `GOAL_CONTRACT_V1`：`execution_platform: codex`、绝对 `workspace.root`、`lifecycle.controller: codex_native`、`lifecycle.native_goal.thread_id/created_at`、未经改写的原生 objective、`source.revision: 1`、scope、constraints、non-goals、side-effect policy 与 verification gates。
4. 运行 `goal-validate`。它必须先捕获 `WORKTREE_BASELINE_V1` 和 `SOURCE_BLOCKS_V1`，再写入带 ref/digest 的 goal state；不得把整篇计划复制进 Goal Contract，也不得在 baseline 之前分发业务 task。
5. 让 planner 亲自读取 source 和 runtime 生成的 source blocks，先生成带 `source_refs`/`required_effects` 的 `PLAN_COVERAGE_V1`，再生成带 `coverage_effect` 的 `DAG_PLAN_V4`。运行 `validate` 和 `render`。
6. 若 objective 明确只规划，返回计划和覆盖率；否则按 mode 调用 coordinator。

```text
node <plugin-root>/scripts/goal-dag.mjs goal-validate <goal.json>
node <plugin-root>/scripts/goal-dag.mjs validate <plan.json>
node <plugin-root>/scripts/goal-dag.mjs render <plan.json>
```

## 恢复、刷新与修订

- 每轮的 `status` 后立即运行 `reconcile <plan> <state>`，按 coordinator 恢复矩阵处理 active reservation，再 reserve。
- `source_status: source_missing` / `next_action: user_blocked` 时停止新 reserve，保留现有状态并要求恢复同一绝对 source path；不得猜测新计划、改 `source.path`、调用 `goal-refresh` 或误报完成。已运行 task 只可按 canonical result 安全收口。
- `status`/`reconcile` 报告 `source_changed` 时立即停止 reserve。若返回 `source_drift_drain`，只等待或 finish 已有 reservation；执行单元丢失则先 reclaim，再停止返回的物理 executor，并运行 `confirm-stale-executor`。active reservation 和 stale executor 都清零后才运行 `goal-refresh`。
- `goal-refresh` 必须以一个 runtime 事务原子更新 goal/source revision、`SOURCE_BLOCKS_V1`、plan/coverage 绑定、state 与 Capsule digest，然后进入 `needs_delta`；不得手改这些文件，也不得边跑旧 task 边刷新。
- planner 随后生成 `DAG_DELTA_V1`。对旧 revision 的每个 live task 显式写 `carry_forward` 或 `invalidate`；`source-coverage-audit` 与 `diff-scope-audit` 都必须 invalidate 并由新 revision audit task 替换。invalidated task 的当前完成、result/evidence refs、active checkpoint 必须从 Capsule 当前视图移除，历史 attempt 文件只保留审计。
- DAG 暂时耗尽但 required effect pair 仍为 pending 时生成追加 delta，不得 finalize。
- failed、blocked、needs_repair 只修订受影响子图；普通 task 失败保留在本地 DAG/result，不把原生 Goal 标成 blocked。
- 只有破坏性操作、未授权外部副作用、父 objective 变化或无法安全消歧时请求用户决定。

```text
node <plugin-root>/scripts/goal-dag.mjs goal-refresh <goal.json> <goal-state.json> <plan.json> <state.json>
node <plugin-root>/scripts/goal-dag.mjs apply-delta <plan.json> <state.json> <delta.json>
```

不要返回人工续跑 prompt。原生 Goal 外循环负责下一轮。

## 原生完成桥接

只在当前 source digest/revision 仍冻结、effect-aware planned/completed coverage 都为 100%、所有有效 task resolved、required gate 证据通过且无阻断 finding 时运行。`source-coverage-audit` 与 `diff-scope-audit` 都必须有 runtime 绑定的 artifact ref/digest；后者必须来自对 Goal 初始 baseline 与当前真实工作区的独立扫描，而不是实施 worker 自报：

```text
node <plugin-root>/scripts/goal-dag.mjs finalize <goal.json> <goal-state.json> <plan.json> <state.json>
```

对 `codex_native`，`finalize` 必须先持久化 `native_completion_pending` 并返回 `native_action: update_goal` 与 `completion_token`。随后严格执行：

1. `finalize` 本身重新读取并校验 source digest；发现任何未刷新的 drift 都必须拒绝，不能冻结旧 revision。`finalize` 成功后立即再次调用 `get_goal`，重新核对 `threadId + createdAt + objective digest`。若同一 instance 仍为 `active`，调用 `update_goal({status: "complete"})`；若已为 `complete`，视为上次原生更新已成功，不重复更新。
2. `update_goal` 返回成功后再次调用 `get_goal`；只有同一 instance 的 fresh 状态确认为 `complete` 才运行：

```text
node <plugin-root>/scripts/goal-dag.mjs native-confirm <goal.json> <goal-state.json> <completion_token>
```

若第 1 步的 fresh 状态已是 `complete`，该次读取同时充当第 2 步确认。不得在 finalize 前更新原生 Goal，不得把普通 DAG 失败升级为原生 blocked。若更新、fresh 确认或 confirm 失败，保留 `native_completion_pending` 和同一 token；可恢复轮次先用 `get_goal` 校验 threadId、createdAt 与 objective digest，再直接根据原生 active/complete 状态幂等收尾，不能重新 status/reconcile/finalize、复核 mutable source/worktree 或生成新 token。
