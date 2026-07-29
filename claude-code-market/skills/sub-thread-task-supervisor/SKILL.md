---
name: sub-thread-task-supervisor
description: 仅供 sub-thread-coordination 在 DAG worktree 创建任务监督子线程时使用。必须在 Planner 前启动持续监督循环，持续等待 Main 已登记的 Planner、Reviewer、Owner 与 Review 线程，并在终态、挂死或需要调度时通知新 Main；Quick 不得启动。
---

# 任务监督子线程

> 平台差异：Claude Code 不提供 Codex 原生 Goal 工具，因此使用同一线程内的持续监督 turn；不得伪造原生 Goal 状态。

只用于 DAG，固定使用 `profiles.supervisor`，默认 `gpt-5.6-luna/medium`。Main 登记后立即创建，早于 Planner。唯一状态源是项目目录内的 `<goal-dir>`（位于 `.ghost-agent-workflow`）；禁止读取 Plan、State、Registry、Result、Worker 聊天、完整 DAG、业务代码或其他目录。

Main 必须逐字使用 `workflow supervisor-init` 返回的 target 和 dispatch，通过宿主长期 `create_thread` 在独立 worktree 创建 Supervisor。Supervisor 不创建或复用线程；Main 禁止 `fork_thread`、对话分叉或附加聊天历史。

Supervisor 逐字采用 `workflow supervisor-init` 收据的 `goal_objective` 作为监督目标并立即进入当前 active 批次。上下文压缩或恢复后，不从聊天重建状态，直接重新执行 `supervisor-next`。Main 启动的目标均由 runtime 投影到收据的 `status_document`；该文件只保存当前状态，Supervisor 不编辑或解析原始 JSON。

## 脚本循环

只运行 dispatch 指定的 Node CLI：

```text
goal-dag.mjs supervisor-next <goal-dir> --limit 8
goal-dag.mjs supervisor-ack <goal-dir> <action-id> [脚本要求的宿主标量]
```

action id 是不透明值。不得调用低层 `supervisor-record`，不得读取或编辑原始 JSON，不得手写参数、状态或结果。禁止 Orca、`$orchestration` 和 subagent。

每轮只执行一次 `supervisor-next` 并处理紧凑 action；`goal_action: continue` 继续监督，`goal_action: stop` 表示没有 active 任务并结束当前监督 turn。不得自行推断 active 状态。

同一 `task/attempt` 在一次收据中只能属于 `create`、`wait`、`stalled`、`notify` 之一；若脚本违反互斥约束，只向 Main 报告一次 CLI 契约错误并继续监督，不猜测该执行哪个动作。重复出现 `create` 或非终态 `main_action`，无论多少轮都不算阻塞，禁止因此停止监督。

- `wait`：一次最多八项交给一次 `wait_threads(timeoutMs=120000)`；每个 action 的 `timeout_ms` 必须等于 `120000`，否则按 CLI 契约错误停止本轮。按 `thread + host` 匹配每个 action 与 `polls[]`，不得依赖数组顺序；逐字复制匹配 poll 的 `cursor`（缺失用 `-`）和 `latestTurn.status`（缺失用 `-`），立即执行 `supervisor-ack <goal-dir> <action-id> <cursor|-> <latestTurn.status|->`。runtime 负责把宿主状态归一化；普通 wait 禁止传入 `thread.status.type`，尤其不能把 `idle` 当作任务终态。超时或非终态 poll 也必须 ack。
- 一次 wait 返回后，所有 wait action 都必须成功 ack，才能声称本轮已处理；不得因为首个线程完成而漏掉其他 poll。匹配不到 poll、存在对应 per-target error、字段非法或 ack 失败时，只向 Main 发送一次简短错误和日志路径，立即停止当前 turn；下一次仍按脚本状态继续监督；禁止继续调用 `supervisor-next`、声称成功或空转。
- `create`：不执行、不 ack；只把脚本给出的 action id、target、model、thinking、title、thread/host 和 prompt 直接发送给 Main，然后继续监督。
- 非终态 `main_action`：不执行、不 ack；把脚本 dispatch 直接发送给 Main，然后继续监督。Main 不负责重新唤醒 Supervisor。
- `main_action.action: owner_sync_required`：只通知 Main 执行显式 `workflow owner-sync`；Supervisor 不运行 Git，不创建、同步、提交或合并分支/worktree。
- `notify`：只把脚本提供的 task/thread/status/result_ref/summary 发给 Main，成功后 ack 并继续监督。用户可见文本不显示 `result_ref`。
- `stalled`：只会在脚本累计十次无 cursor 变化后出现。使用 `read_thread` 对 action 指定的 thread/host 做一次深入检查，只读取 action 的 `inspection_turn_limit` 指定的最近 turn；然后逐字把 `latestTurn.status`（缺失用 `-`）与 `thread.status.type` 传给 `supervisor-ack <goal-dir> <action-id> <latestTurn.status|-> <thread.status.type>`。只有深入检查允许传 `thread.status.type`。runtime 归一化有限结论；Supervisor 只把收据的 `task`、`attempt` 和 `report` 发给 Main，不自行判断是否在运行、卡死或该如何恢复，不关闭、不 reclaim，等待 Main 决定。
- 空 action：只允许在任务全部完成或监督已非 active 时出现，并且 `goal_action` 必须为 `stop`。监督 active 且仍有未完成任务时若所有 action 为空，视为 CLI 契约错误，只通知 Main，不得空转或猜测。
- `main_action.action: completed`：发送最终机器通知后结束当前监督 turn。

Planner 或 Planner Reviewer 正常结束不通知 Main，脚本自动推进。异常结束、缺少有效结果、Owner bootstrap、Owner 终态与集成修复全部按脚本 action 转发，不解析、不概括、不猜测恢复策略。`owner-finish` 失败时必须复用原 Owner 线程和 worktree，不得再次 `owner-sync`。

执行线程会在结果动作成功后，把 runtime 收据中的 `supervisor_notify.message` 主动发送到本 Supervisor。收到该消息后，如果上一监督 turn 已结束，则启动新监督 turn；随后执行一次 `supervisor-next`。不得把消息本身当作终态、结果或状态源。

任何 CLI 失败都只向 Main 报告简短错误和日志路径，不定位或修改脚本实现。Supervisor 只关注 `<goal-dir>` 下 `.ghost-agent-workflow` 的脚本投影。

脚本 JSON 只作机器收据，不复制到 commentary、final 或普通聊天。八个是上限，不是目标；无状态变化不产生用户可见消息。Main 不调用 `wait_threads`，只有 Supervisor 负责等待。
