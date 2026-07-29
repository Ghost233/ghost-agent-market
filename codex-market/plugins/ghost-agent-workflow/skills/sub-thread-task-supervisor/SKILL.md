---
name: sub-thread-task-supervisor
description: 仅供 sub-thread-coordination 在 DAG worktree 创建任务监督子线程时使用。必须在 Planner 前启动原生 Goal，持续等待 Main 已登记的 Planner、Reviewer、Owner 与 Review 线程，并在终态、挂死或需要调度时通知新 Main；Quick 不得启动。
---

# 任务监督子线程

只用于 DAG，固定使用 `profiles.supervisor`，默认 `gpt-5.6-luna/medium`。Main 登记后立即创建，早于 Planner。唯一状态源是项目目录内的 `<goal-dir>`（位于 `.ghost-agent-workflow`）；禁止读取 Plan、State、Registry、Result、Worker 聊天、完整 DAG、业务代码或其他目录。

Main 必须逐字使用 `workflow supervisor-init` 返回的 target 和 dispatch，通过 `create_thread` 在独立 worktree 创建 Supervisor。Supervisor 不创建或复用线程；Main 禁止 `fork_thread`、对话分叉或附加聊天历史。

## 原生 Goal

首次运行时：

1. 设置脚本给出的线程标题。
2. 调用 `get_goal`；不存在未完成 Goal 时，调用 `create_goal`，其 objective 必须逐字使用 `workflow supervisor-init` 收据的 `goal_objective`，不得概括或改写，也不设置 token budget。
3. 立即进入监督循环。

已有未完成 Goal 时禁止重复创建。普通等待、Main 正在处理 action、线程 running 或无状态变化都不是 blocked。只有同一个真实 runtime/权限阻塞连续三个 Goal turn 未变化时才可标记 blocked；脚本报告 DAG `completed` 后才标记 complete。

Goal 只负责持续唤醒。上下文压缩或恢复后，不从聊天重建状态，直接重新执行 `supervisor-next`。

Main 启动的 Main、Planner、Planner Reviewer、Owner、Implementation Review 与 Supervisor 目标，均由 runtime 投影到收据给出的 `status_document`。该文件只保存当前状态，由脚本原子更新；Supervisor 不编辑它，也不通过读取原始 JSON 恢复状态。

## 脚本循环

只运行 dispatch 指定的 Node CLI：

```text
goal-dag.mjs supervisor-next <goal-dir> --limit 8
goal-dag.mjs supervisor-ack <goal-dir> <action-id> [脚本要求的宿主标量]
```

action id 是不透明值。不得调用低层 `supervisor-record`，不得读取或编辑原始 JSON，不得手写参数、状态或结果。禁止 Orca、`$orchestration` 和 subagent。

每个 Goal turn 只执行一次 `supervisor-next`，处理该次紧凑 action 后立即让出当前 turn；下一次 continuation 再读取本地状态：

同一 `task/attempt` 在一次收据中只能属于 `create`、`wait`、`stalled`、`notify` 之一；若脚本违反互斥约束，只向 Main 报告一次 CLI 契约错误并保持 Goal active，不猜测该执行哪个动作。重复出现 `create` 或非终态 `main_action`，无论多少轮都不算阻塞，禁止因此调用 `update_goal(status=blocked)`。

- `wait`：一次最多八项交给一次 `wait_threads(timeoutMs=120000)`；每个 action 的 `timeout_ms` 必须等于 `120000`，否则按 CLI 契约错误停止本轮。按 `thread + host` 匹配每个 action 与 `polls[]`，不得依赖数组顺序；逐字复制匹配 poll 的 `cursor`（缺失用 `-`）和 `latestTurn.status`（缺失用 `-`），立即执行 `supervisor-ack <goal-dir> <action-id> <cursor|-> <latestTurn.status|->`。runtime 负责把宿主状态归一化；普通 wait 禁止传入 `thread.status.type`，尤其不能把 `idle` 当作任务终态。超时或非终态 poll 也必须 ack。
- 一次 wait 返回后，所有 wait action 都必须成功 ack，才能声称本轮已处理；不得因为首个线程完成而漏掉其他 poll。匹配不到 poll、存在对应 per-target error、字段非法或 ack 失败时，只向 Main 发送一次简短错误和日志路径，立即停止当前 turn 并保持 Goal active；禁止继续调用 `supervisor-next`、声称成功或空转。
- `create`：不执行、不 ack；只把脚本给出的 action id、target、model、thinking、title、thread/host 和 prompt 直接发送给 Main，然后让当前 Goal turn 结束但保持 Goal active。
- 非终态 `main_action`：不执行、不 ack；把脚本 dispatch 直接发送给 Main，然后让当前 Goal turn 结束但保持 Goal active。Main 不负责重新唤醒 Supervisor。
- `main_action.action: owner_sync_required`：只通知 Main 执行显式 `workflow owner-sync`；Supervisor 不运行 Git，不创建、同步、提交或合并分支/worktree。
- `notify`：只把脚本提供的 task/thread/status/result_ref/summary 发给 Main，成功后 ack 并让出当前 turn。用户可见文本不显示 `result_ref`。
- `stalled`：只会在脚本累计十次无 cursor 变化后出现。使用 `read_thread` 对 action 指定的 thread/host 做一次深入检查，只读取 action 的 `inspection_turn_limit` 指定的最近 turn；然后逐字把 `latestTurn.status`（缺失用 `-`）与 `thread.status.type` 传给 `supervisor-ack <goal-dir> <action-id> <latestTurn.status|-> <thread.status.type>`。只有深入检查允许传 `thread.status.type`。runtime 归一化有限结论；Supervisor 只把收据的 `task`、`attempt` 和 `report` 发给 Main，不自行判断是否在运行、卡死或该如何恢复，不关闭、不 reclaim，等待 Main 决定。
- 空 action：不产生消息，不结束 Goal；下一次 Goal continuation 重新运行 `supervisor-next`。
- `main_action.action: completed`：发送最终机器通知后调用 `update_goal(status=complete)`，结束 Supervisor。

Planner 或 Planner Reviewer 正常结束不通知 Main，脚本自动推进。异常结束、缺少有效结果、Owner bootstrap、Owner 终态与集成修复全部按脚本 action 转发，不解析、不概括、不猜测恢复策略。`owner-finish` 失败时必须复用原 Owner 线程和 worktree，不得再次 `owner-sync`。

执行线程会在结果动作成功后，把 runtime 收据中的 `supervisor_notify.message` 主动发送到本 Supervisor。收到该消息只表示应立即继续现有 Goal 并执行一次 `supervisor-next`；不得把消息本身当作终态、结果或状态源。

任何 CLI 失败都只向 Main 报告简短错误和日志路径，不定位或修改脚本实现。Supervisor 只关注 `<goal-dir>` 下 `.ghost-agent-workflow` 的脚本投影。

脚本 JSON 只作机器收据，不复制到 commentary、final 或普通聊天。八个是上限，不是目标；无状态变化不产生用户可见消息。Main 不调用 `wait_threads`，只有 Supervisor 负责等待。
