---
name: subagent-coordination
description: 仅当用户消息或当前 Goal objective 显式要求使用 subagent-coordination，并要求从计划文档启动、继续、查看或修订 subagent-only 本地 Goal DAG 时使用；作为唯一公开控制器，创建或恢复 GOAL_CONTRACT_V1，调用 parallel-task-planner 生成 coverage、plan 或 delta，调度 subagent-goal-worker，并持续执行到本地硬终态。普通任务、普通讨论、文档审阅、仅写 $subagent-coordination 但未显式点名本 skill 的请求不得触发。
whenToUse: 用户显式运行 /skill:subagent-coordination 执行 <计划文档路径> 启动新 DAG，逐字使用 /skill:subagent-coordination 继续 <goal.json绝对路径> 续跑，或当前原生 /goal 的 objective 逐轮显式点名 subagent-coordination。其它场景不得触发。
---

# Kimi 本地子代理 DAG 控制器

## 公开入口与平台边界

Kimi 的原生 Goal 不向 skill 提供可用 instance identity（GetGoal 没有 threadId/createdAt），因此明确使用 `lifecycle.controller: local_fallback`。公开 DAG 入口只有：

```text
/skill:subagent-coordination 执行 <开发文档路径>
```

`$subagent-coordination` 不是 Kimi 的显式调用语法，不能据此启动。执行方式固定为 `subagent`。用户明确只规划时返回 coverage 与 DAG；否则持续推进执行。

用户可以用原生 `/goal` 包裹本 skill 获得自动外循环，此时每轮 objective 必须显式点名本 skill：

```text
/goal 每轮调用 subagent-coordination skill，以子代理 DAG 完整执行 `./plan.md`，直到计划项覆盖率 100% 且所有验收通过。
```

skill 本身不得调用 CreateGoal/UpdateGoal，也不要求原生 Goal 存在。

本控制器只写 Goal/DAG 协调元数据并调度执行单元，不修改业务文件，不暂存、提交或推送代码。所有正式实施、审查和验证都必须是 DAG task。

Kimi 子代理使用平台默认 profile；调用 Agent 时不得指定 model、thinking、reasoning 或 effort。Codex 固定 `gpt-5.6-sol/medium`，这是有意的平台差异。

首次创建 Goal 时读取 [references/goal-contract.md](references/goal-contract.md)。进入 active 执行时读取 [references/templates.md](references/templates.md)；首次分发或裁决结果前再读取 `subagent-goal-worker/references/templates.md`。需要初始计划或局部修订时调用内部 `parallel-task-planner`，不得自行拼造 coverage、plan 或 delta。

## 本地 Goal 定位

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

Kimi 没有可用的 native instance。默认 instance digest 为 `SHA-256(UTF-8(source 绝对路径 + "\n" + source digest))`，`goal_id` 和目录名必须包含至少前 12 位小写 hex。相同 path+digest 默认恢复同一本地 Goal；objective、mode、约束或副作用策略不同则停止，不能静默改写。重复执行相同 source 时，用户必须显式提供稳定 instance key，将它追加到 digest seed。任何首次调用都不得覆盖已有目录，短前缀碰撞时只延长同一 digest。

## 首次启动与规划

1. 从 skill 调用参数（`$ARGUMENTS`）解析唯一计划文档路径，转为绝对路径，读取内容并计算 digest；缺失或歧义时停止。
2. 合并仓库强制策略、计划验收和用户追加要求。固定加入 required gate `source-coverage-audit` 与 `diff-scope-audit`；用户只能增加 gate 或授权副作用，不能移除强制项。
3. 按 reference 写入 `GOAL_CONTRACT_V1`：`execution_platform: kimi`、`lifecycle.controller: local_fallback`、`native_goal: null`、`execution.mode: subagent`、绝对 workspace/source、scope、constraints、non-goals、side-effect policy 与 verification gates。
4. 运行 `goal-validate`。它必须先捕获 `WORKTREE_BASELINE_V1` 和 `SOURCE_BLOCKS_V1`，再写 goal state；baseline 之前不得分发业务 task。
5. 以 `<goal.json绝对路径>` 作为 skill 参数调用 `parallel-task-planner`，亲自读取 source 与 runtime source blocks，先生成 `PLAN_COVERAGE_V1`，再生成 `DAG_PLAN_V4`；运行 `validate` 和 `render`。不得把整篇 source 复制进 Goal Contract。
6. 用户明确只规划时返回 coverage 与 DAG；否则进入执行循环。

```text
node ${KIMI_SKILL_DIR}/../../scripts/goal-dag.mjs goal-validate <goal.json>
node ${KIMI_SKILL_DIR}/../../scripts/goal-dag.mjs validate <plan.json>
node ${KIMI_SKILL_DIR}/../../scripts/goal-dag.mjs render <plan.json>
```

## 每次恢复、source refresh 与局部修订

续跑只接受调用参数（`$ARGUMENTS`）中的绝对 `goal.json` 路径；读取后精确校验 `goal_id`、source path 与持久化 digest。严格按以下顺序恢复：

```text
node ${KIMI_SKILL_DIR}/../../scripts/goal-dag.mjs goal-validate <goal.json>
node ${KIMI_SKILL_DIR}/../../scripts/goal-dag.mjs status <plan_path> <state_path>
node ${KIMI_SKILL_DIR}/../../scripts/goal-dag.mjs reconcile <plan_path> <state_path>
```

先按 reference 恢复每个 active reservation，再 reserve。`source_status: source_missing` 或 `next_action: user_blocked` 时保留状态并要求恢复同一绝对 source path；不得猜测新 source、改 path、调用 `goal-refresh` 或误报完成。

source digest 变化时停止新 reserve，只 drain 现有 reservation：健康 Agent 继续到 canonical result 并 finish；丢失 Agent 先 reclaim，再用 `TaskStop` 停止返回的物理 Agent，确认停止后运行 `confirm-stale-executor`。active reservation 与 stale executor 都清零后，由本 coordinator 运行 `goal-refresh`，再调用 planner 生成 `DAG_DELTA_V1` 并运行 `apply-delta`。旧 revision 的每个 live task 必须显式 `carry_forward` 或 `invalidate`；两个固定 audit task 都必须 invalidate 并替换。

failed、blocked、needs_repair 或 DAG exhausted 但 required effect coverage 未达 100% 时，只让 planner 修订受影响闭包。无关 Owner 继续，不能全量替换 active plan。只有父 objective 改变、未授权外部副作用、破坏性权限或无法安全消歧时请求用户决定。

```text
node ${KIMI_SKILL_DIR}/../../scripts/goal-dag.mjs goal-refresh <goal.json> <goal-state.json> <plan.json> <state.json>
node ${KIMI_SKILL_DIR}/../../scripts/goal-dag.mjs apply-delta <plan.json> <state.json> <delta.json>
```

## Reservation 恢复与分发

`status`/`reconcile.active_reservations[]` 与 `reserve.actions[]` 都携带 runtime 锁内重建的完整 canonical `TASK_BINDING_V4`。分发只能使用返回的 binding；不得从聊天记忆、旧 prompt 或自行扫描 plan 重算 attempt、token、权限、result path 或 artifact path。

需要安全回收时使用：

```text
node ${KIMI_SKILL_DIR}/../../scripts/goal-dag.mjs abandon <plan_path> <state_path> <task_id> <reservation_token> <reason>
node ${KIMI_SKILL_DIR}/../../scripts/goal-dag.mjs reclaim <plan_path> <state_path> <task_id> <reservation_token> <reason>
node ${KIMI_SKILL_DIR}/../../scripts/goal-dag.mjs confirm-stale-executor <plan_path> <state_path> <executor_id>
node ${KIMI_SKILL_DIR}/../../scripts/goal-dag.mjs rotate-owner <plan_path> <state_path> <owner_id> <expected_generation> <reason>
node ${KIMI_SKILL_DIR}/../../scripts/goal-dag.mjs reserve <plan_path> <state_path> <available_capacity>
```

- `spawn_executor`：把 binding 的 `executor_spawn_name` 原样作为 Agent 调用的 `description`，以 `Agent(subagent_type: "coder", run_in_background: true)` 创建后台子代理，`prompt` 为固定分发前缀加完整 binding 原文；worker 需要 Write/Bash/Skill 工具，不得使用 explore/plan 类型，不创建启动握手回合，不指定 model 或思考参数。取得 agent id 后立即 `bind`。固定分发前缀逐字为：`你是 subagent-goal-worker 执行器。立即通过 Skill 工具调用 subagent-goal-worker skill 加载执行协议，并严格按协议处理以下 TASK_BINDING_V4：`
- `reuse_executor`：先用 `TaskList(active_only: false)` 确认目标是当前 Goal/Owner 的 idle 健康 Agent（默认 active_only=true 会隐藏已完成、可 resume 的实例）；先 `bind`，再用 `Agent(resume: <agent_id>)` 发送同一固定分发前缀加原样 binding。
- `reserved_unbound + spawn_executor` 无匹配 executor 时 `abandon`。复用目标或 running Agent 确认丢失时以当前 token `reclaim`，用 `TaskStop` 停止返回的 executor，确认停止后 `confirm-stale-executor`。存在 stop-pending stale executor 时不得 reserve。
- 物理 Agent 丢失后默认保持同一逻辑 Owner/generation；只有污染、重复失败或 Capsule 语义需要隔离时才 `rotate-owner`。不同 Goal 不复用 Agent；会话记忆和复用只是性能优化。

```text
node ${KIMI_SKILL_DIR}/../../scripts/goal-dag.mjs bind <plan_path> <state_path> <task_id> <reservation_token> <agent_id>
```

## 结果、推进与完成

后台 Agent 完成时平台自动把最终结果送回主代理，无需轮询；只允许低频非阻塞 `TaskOutput` 快照。running 不是失败。worker 必须先原子写 binding 指定的 attempt 唯一 result，再结束。只接受 task、Owner generation、attempt、token、source revision、result path 与 audit artifact 全部匹配的结果；迟到或旧 revision 结果只保留审计。

结果出现后立即运行 `finish`，再从 reconcile/reserve 继续，不等待无关并行兄弟：

```text
node ${KIMI_SKILL_DIR}/../../scripts/goal-dag.mjs finish <plan_path> <state_path> <task_id> <reservation_token> <result_path>
```

只在当前 source digest/revision 仍冻结、effect-aware planned/completed coverage 都为 100%、所有有效 task resolved、required gate 证据通过且无阻断 finding 时运行：

```text
node ${KIMI_SKILL_DIR}/../../scripts/goal-dag.mjs finalize <goal.json> <goal-state.json> <plan.json> <state.json>
```

`finalize` 会 fresh 读取 source，并要求两个固定 audit evidence 精确引用 runtime 绑定的 artifact ref/digest。对 `local_fallback`，只有它返回 `completed` 才结束本地 Goal；不得调用或模拟原生 Goal 工具（CreateGoal/UpdateGoal/SetGoalBudget）。

当前调用结束而本地 Goal 尚未完成时，逐字返回最近一次 runtime `status` 或 `goal-validate` 输出的 `continuation_prompt`；不要自行拼接、相对化或摘要。其值必须精确是一行：

```text
/skill:subagent-coordination 继续 `<goal.json绝对路径>`。
```

不要拼入计划、Goal Contract、DAG、Owner Capsule、worker prompt 或人工摘要。
