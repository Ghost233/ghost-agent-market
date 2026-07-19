---
name: subagent-coordination
description: 仅当当前 Codex 原生 Goal 的 objective 显式包含 $subagent-coordination，并要求从计划文档启动、继续、查看或修订 subagent-only Goal DAG 时使用；作为唯一公开控制器，创建或恢复 GOAL_CONTRACT_V1，调用 parallel-task-planner 生成 coverage、plan 或 delta，调度 subagent-goal-worker，并在本地硬终态后桥接原生 Goal。普通任务、普通讨论、文档审阅、仅出现 /goal 但 objective 未点名本 skill 的请求不得触发。
---

# Codex 原生 Goal 的子代理 DAG 控制器

## 公开入口与平台边界

公开 DAG 入口只有本 skill。推荐由用户输入：

```text
/goal 每轮使用 $subagent-coordination，以子代理 DAG 完整执行 `./plan.md`，直到计划项覆盖率 100% 且所有验收通过。
```

不要解析 `/goal` 命令；平台已经把它转换为原生 Goal objective。不要调用 `create_goal`，不要改写 objective。只依据每轮第一个 `get_goal` 返回的原始 objective 与 native instance identity 触发和绑定。

执行方式固定为 `subagent`。Codex Owner 与新建子代理固定使用 `gpt-5.6-sol/medium`；`spawn_agent` 使用 `fork_turns: "none"`，schema 支持时使用 `agent_type: "worker"`。Claude Code 使用平台默认 profile，是有意的平台差异。

本控制器只写 Goal/DAG 协调元数据并调度执行单元，不修改业务文件，不暂存、提交或推送代码。所有正式实施、审查和验证都必须是 DAG task。

首次创建 Goal 时读取 [references/goal-contract.md](references/goal-contract.md)。进入 active 执行时读取 [references/templates.md](references/templates.md)；首次分发或裁决结果前再读取 `subagent-goal-worker/references/templates.md`。需要初始计划或局部修订时调用内部 `parallel-task-planner`，不得自行拼造 coverage、plan 或 delta。

## 每轮生命周期入口

严格按以下顺序开始每一轮：

1. 首先调用 `get_goal`，只读取得当前原生 Goal 的 `threadId`、`createdAt`、`status` 与 objective 原文。
2. 要求 objective 原文显式包含 `$subagent-coordination`。正常执行只接受 `active`；`complete` 只允许用于同一 native instance 的本地 `native_completion_pending` 收尾。
3. 对 objective 原文计算 SHA-256，并把 `threadId + createdAt` 作为 native instance identity。首次启动时把三者原样写入本地契约；恢复时全部精确一致，不使用摘要、`updatedAt` 或目录名代替。
4. 以 `SHA-256(UTF-8(threadId + "\n" + String(createdAt)))` 的前 12 位小写 hex 作为最短 instance suffix。`goal_id` 和目录名都必须包含它；短前缀碰撞时只延长同一 digest，绝不覆盖不同 instance。
5. 用 suffix 定位候选 `goal.json` 后，仍读取契约并精确校验完整 native identity 与 objective digest。相同 objective 的新 native instance 必须创建独立目录。
6. 已有 Goal 先运行 `goal-validate` 恢复未完成事务。本地已 completed 且 native sync pending 时直接跳到“原生完成桥接”，复用同一 completion token；不得再运行 status、reconcile、finalize 或复核此后可变的 source/worktree。
7. 其它 active Goal 才继续规划或执行。在 `goal-validate` 之前不得 reserve、bind 或分发。

objective 缺少显式 skill 名、digest 不匹配或无法唯一绑定时停止，不修改本地状态，也不替用户创建新的外层 Goal。

## 新 Goal 与初始计划

为每个 Goal 创建：

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
└── owners/<owner_id>/{capsule.json,checkpoints/}
```

1. 从 objective 解析唯一计划文档路径，转为绝对路径，读取内容并计算 digest；缺失或歧义时停止。
2. 合并仓库强制策略、计划验收和 objective 追加要求。固定加入 required gate `source-coverage-audit` 与 `diff-scope-audit`；objective 只能增加 gate 或授权副作用，不能移除强制项。
3. 按 reference 写入 `GOAL_CONTRACT_V1`：`execution_platform: codex`、`lifecycle.controller: codex_native`、完整 native identity、未经改写的 objective、`execution.mode: subagent`、绝对 workspace/source、scope、constraints、non-goals、side-effect policy 与 verification gates。
4. 运行 `goal-validate`。它必须先捕获 `WORKTREE_BASELINE_V1` 和 `SOURCE_BLOCKS_V1`，再写 goal state；baseline 之前不得分发业务 task。
5. 调用 `parallel-task-planner` 亲自读取 source 与 runtime source blocks，先生成 `PLAN_COVERAGE_V1`，再生成 `DAG_PLAN_V4`；运行 `validate` 和 `render`。不得把整篇 source 复制进 Goal Contract。
6. objective 明确只规划时返回 coverage 与 DAG；否则进入执行循环。

```text
node <plugin-root>/scripts/goal-dag.mjs goal-validate <goal.json>
node <plugin-root>/scripts/goal-dag.mjs validate <plan.json>
node <plugin-root>/scripts/goal-dag.mjs render <plan.json>
```

## 恢复、source refresh 与局部修订

已有 active Goal 在 `goal-validate` 后严格运行：

```text
node <plugin-root>/scripts/goal-dag.mjs status <plan_path> <state_path>
node <plugin-root>/scripts/goal-dag.mjs reconcile <plan_path> <state_path>
```

先按 reference 恢复每个 active reservation，再 reserve。`source_status: source_missing` 或 `next_action: user_blocked` 时保留状态并要求恢复同一绝对 source path；不得猜测新 source、改 path、调用 `goal-refresh` 或误报完成。

source digest 变化时停止新 reserve，只 drain 现有 reservation：健康 executor 继续到 canonical result 并 finish；丢失 executor 先 reclaim，再 `interrupt_agent`，确认停止后运行 `confirm-stale-executor`。active reservation 与 stale executor 都清零后，由本 coordinator 运行 `goal-refresh`，再调用 planner 生成 `DAG_DELTA_V1` 并运行 `apply-delta`。旧 revision 的每个 live task 必须显式 `carry_forward` 或 `invalidate`；两个固定 audit task 都必须 invalidate 并替换。

failed、blocked、needs_repair 或 DAG exhausted 但 required effect coverage 未达 100% 时，只让 planner 修订受影响闭包。无关 Owner 继续，不能全量替换 active plan。只有父 objective 改变、未授权外部副作用、破坏性权限或无法安全消歧时请求用户决定。

```text
node <plugin-root>/scripts/goal-dag.mjs goal-refresh <goal.json> <goal-state.json> <plan.json> <state.json>
node <plugin-root>/scripts/goal-dag.mjs apply-delta <plan.json> <state.json> <delta.json>
```

## Reservation 恢复与分发

`status`/`reconcile.active_reservations[]` 与 `reserve.actions[]` 都携带 runtime 锁内重建的完整 canonical `TASK_BINDING_V4`。分发只能使用返回的 binding；不得从聊天记忆、旧 prompt 或自行扫描 plan 重算 attempt、token、权限、result path 或 artifact path。

需要安全回收时使用：

```text
node <plugin-root>/scripts/goal-dag.mjs abandon <plan_path> <state_path> <task_id> <reservation_token> <reason>
node <plugin-root>/scripts/goal-dag.mjs reclaim <plan_path> <state_path> <task_id> <reservation_token> <reason>
node <plugin-root>/scripts/goal-dag.mjs confirm-stale-executor <plan_path> <state_path> <executor_id>
node <plugin-root>/scripts/goal-dag.mjs rotate-owner <plan_path> <state_path> <owner_id> <expected_generation> <reason>
node <plugin-root>/scripts/goal-dag.mjs reserve <plan_path> <state_path> <available_capacity>
```

- `spawn_executor`：把 binding 的 `executor_spawn_name` 原样作为 `spawn_agent.task_name`；传入完整 binding、`model: "gpt-5.6-sol"`、`reasoning_effort: "medium"`、`fork_turns: "none"`，支持时加 `agent_type: "worker"`。取得 canonical target 后立即 `bind`，不创建启动握手回合。
- `reuse_executor`：用 `list_agents` 确认目标是当前 Goal/Owner 的 idle 健康 Agent；先 `bind`，再用 `followup_task` 发送原样 binding。
- `reserved_unbound + spawn_executor` 无匹配 executor 时 `abandon`。复用目标或 running executor 确认丢失时以当前 token `reclaim`，停止返回的 executor，确认停止后 `confirm-stale-executor`。存在 stop-pending stale executor 时不得 reserve。
- 物理 Agent 丢失后默认保持同一逻辑 Owner/generation；只有污染、重复失败或 Capsule 语义需要隔离时才 `rotate-owner`。不同 Goal 不复用 Agent；会话记忆和复用只是性能优化。

```text
node <plugin-root>/scripts/goal-dag.mjs bind <plan_path> <state_path> <task_id> <reservation_token> <agent_target>
```

## 结果、推进与完成

使用 `wait_agent` 低频等待；running 不是失败。worker 必须先原子写 binding 指定的 attempt 唯一 result，再结束。只接受 task、Owner generation、attempt、token、source revision、result path 与 audit artifact 全部匹配的结果；迟到或旧 revision 结果只保留审计。

结果出现后立即运行 `finish`，再从 reconcile/reserve 继续，不等待无关并行兄弟：

```text
node <plugin-root>/scripts/goal-dag.mjs finish <plan_path> <state_path> <task_id> <reservation_token> <result_path>
```

只在当前 source digest/revision 仍冻结、effect-aware planned/completed coverage 都为 100%、所有有效 task resolved、required gate 证据通过且无阻断 finding 时运行：

```text
node <plugin-root>/scripts/goal-dag.mjs finalize <goal.json> <goal-state.json> <plan.json> <state.json>
```

`finalize` 会 fresh 读取 source，并要求两个固定 audit evidence 精确引用 runtime 绑定的 artifact ref/digest。普通 DAG 失败不得映射为原生 blocked。

## 原生完成桥接

对 `codex_native`，`finalize` 先持久化 `native_completion_pending`，返回 `native_action: update_goal` 与稳定 `completion_token`，随后严格执行：

1. `finalize` 成功后立即再次调用 `get_goal`，重验同一 `threadId + createdAt + objective digest`。同一 instance 仍为 active 时调用 `update_goal({status: "complete"})`；已经 complete 时视为上次更新已成功。
2. `update_goal` 返回成功后再次调用 `get_goal`。只有 fresh 状态确认同一 instance 已 complete，才运行 `native-confirm`；pre-update 已 complete 时该次读取可直接充当确认。

```text
node <plugin-root>/scripts/goal-dag.mjs native-confirm <goal.json> <goal-state.json> <completion_token>
```

更新、fresh 确认或 confirm 失败时保留同一 token。下一轮先 `get_goal` 校验 identity/objective 后直接幂等恢复 bridge；不能重新 status、reconcile、finalize，不能复核 mutable source/worktree，也不能签发新 token。
