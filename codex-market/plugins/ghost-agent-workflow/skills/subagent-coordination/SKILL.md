---
name: subagent-coordination
description: 仅供 goal-dag-runner 内部使用：在已验证的 codex/subagent DAG_PLAN_V4 上先恢复 reservation，再按 Owner affinity 调度 Codex 子代理，并把 attempt 唯一结果交给 runtime 裁决。普通请求、仅规划、thread mode、非 v4 plan 或绕过 runner 的调用不得触发。
---

# Codex 子代理协调

## 边界

只调度、恢复和收集证据，不修改业务文件。逻辑 Owner 与 Capsule 是正确性真相源；物理 Agent 复用只是性能优化。不同 Goal 不复用 Agent。

Codex 子代理固定使用 `gpt-5.6-sol/medium`、`fork_turns: "none"`，schema 支持时使用 `agent_type: "worker"`。这是与 Claude Code 平台默认 profile 的有意差异。

进入 active 执行时读取 [references/templates.md](references/templates.md)；首次分发或裁决结果前再读取 `subagent-goal-worker/references/templates.md`。

## 每轮先恢复

严格按顺序运行：

```text
node <plugin-root>/scripts/goal-dag.mjs status <plan_path> <state_path>
node <plugin-root>/scripts/goal-dag.mjs reconcile <plan_path> <state_path>
```

先处理 `status`/`reconcile` 返回的每个 `active_reservations[]`，再运行 reserve。每项都携带 runtime 锁内重建的完整 canonical `binding` 以及 `action`/`phase`：`spawn_executor|reuse_executor` + `reserved_unbound`，或 `wait_or_redeliver` + `running_bound`。恢复分发只能使用这里的 binding；不要从聊天记忆或自行扫描 plan 重算 token、attempt、权限和路径。使用 `list_agents` 核验 executor 是否属于当前 Goal、generation/profile 是否匹配以及是否仍健康，不要因进程仍在运行而回收。

若 `status`/`reconcile` 返回 `source_drift_drain`，停止 reserve，只回收现有 reservation：健康 executor 继续到 canonical result 并 finish；丢失的 running executor 或 `reserved_unbound + reuse_executor` 目标先 reclaim，再停止返回的物理 Agent，确认确已停止后运行 `confirm-stale-executor`；`reserved_unbound + spawn_executor` 无匹配执行单元时只 abandon。只有 active reservation 与 stale executor 都清零后才把控制权交 runner 执行原子 `goal-refresh`。

需要安全回收同一 reservation 时运行：

```text
node <plugin-root>/scripts/goal-dag.mjs abandon <plan_path> <state_path> <task_id> <reservation_token> <reason>
node <plugin-root>/scripts/goal-dag.mjs reclaim <plan_path> <state_path> <task_id> <reservation_token> <reason>
node <plugin-root>/scripts/goal-dag.mjs confirm-stale-executor <plan_path> <state_path> <executor_id>
node <plugin-root>/scripts/goal-dag.mjs rotate-owner <plan_path> <state_path> <owner_id> <expected_generation> <reason>
```

`reclaim` 之后旧 executor 和迟到结果都被 reservation、attempt、generation、source revision fencing 拒绝。按 reference 中的 orphan、spawn-before-bind、bind-before-send、result-written-before-finish 矩阵恢复，不能跳过 reconcile 直接 reserve。

## reserve 与分发

```text
node <plugin-root>/scripts/goal-dag.mjs reserve <plan_path> <state_path> <available_capacity>
```

只处理 runtime 返回的 actions。新 reservation 使用 `reserve.actions[]` 的 binding；crash recovery 使用 `status`/`reconcile.active_reservations[]` 的 binding。两者都是该 attempt 的唯一 canonical 权限来源，不得用聊天记录、旧 prompt 或本地推导重建。

### spawn_executor

1. 把 action/binding 的 `executor_spawn_name` 原样作为 `spawn_agent.task_name`；不得自行截断、拼接 profile 或重算 Goal/Owner/generation/attempt 名称。它是 runtime 为 crash recovery 下发的 instance identity；同一 Agent 后续复用时保留原名，只以新 binding 切换权限。
2. 调用 `spawn_agent`，传入完整 `TASK_BINDING_V4`、`model: "gpt-5.6-sol"`、`reasoning_effort: "medium"`、`fork_turns: "none"`；schema 支持时使用 `agent_type: "worker"`，不创建启动握手回合。
3. 取得 canonical target 后立即运行 `bind`。worker 必须等 state 进入 running 后才能修改业务文件。

### reuse_executor

1. 用 `list_agents` 确认 action.executor_id 是当前 Goal/Owner 的 idle 健康 Agent。
2. 先运行 `bind`，再用 `followup_task` 发送原样完整 binding。
3. 不拼接旧 task prompt、权限或证据；Agent 从 Owner Capsule 恢复。

```text
node <plugin-root>/scripts/goal-dag.mjs bind <plan_path> <state_path> <task_id> <reservation_token> <agent_target>
```

`reserved_unbound + spawn_executor` 创建失败、无匹配 executor 或尚未 bind 时运行 `abandon`；runtime 尚不知道且无法唯一匹配的 orphan Agent 先停止后 abandon。`reserved_unbound + reuse_executor` 的 bound 目标确认丢失是窄例外：以当前 token `reclaim`，让 runtime 清除 binding 并登记 stale executor；已经 bind/running 后发送失败或 Agent 丢失也同样 reclaim。随后 `interrupt_agent` 停止返回的 executor_id，确认停止后运行 `confirm-stale-executor`。存在 stop-pending stale executor 时不得 reserve。普通物理丢失后在同一逻辑 Owner/generation 上换 Agent；只有污染、重复失败或 Capsule 语义确需隔离时才运行 `rotate-owner`。

## 回收、结果与追加 DAG

- 使用 `wait_agent` 低频等待；running 不是失败。
- 只接受 binding 指定的 `results/<task>/attempt-<attempt>-<token>.json`。同一 task 的其他路径、旧 token、旧 attempt 或旧 source revision 结果一律拒绝。audit task 的 evidence 还必须精确引用 binding `evidence_artifact_paths` 下发的路径并带 SHA-256 `artifact_digest`。
- worker 先写 result 再结束；结果出现后立即运行 `finish`，然后重新从 reconcile/reserve 循环推进，不等待并行兄弟。
- failed、blocked、needs_repair 交 planner 生成受影响子图 delta；无关 Owner 继续。
- DAG exhausted 但 `PLAN_COVERAGE_V1` 未达 100% 时生成 coverage delta，不得 finalize。

```text
node <plugin-root>/scripts/goal-dag.mjs finish <plan_path> <state_path> <task_id> <reservation_token> <result_path>
```

当 runtime 报告 coverage 100%、所有有效 task resolved 且 gate 证据齐全时，把控制权交还 runner 执行 finalize 和原生完成桥接；coordinator 不直接更新外层 Goal。
