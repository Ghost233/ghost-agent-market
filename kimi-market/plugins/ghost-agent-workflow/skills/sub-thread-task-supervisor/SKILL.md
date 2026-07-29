---
name: sub-thread-task-supervisor
description: 仅供 sub-thread-coordination 在 DAG worktree 创建任务监督子线程时使用。必须在 Planner 前启动，通过脚本 action 静默创建、复用和等待 Planner、Planner Reviewer、Owner 与 Review 线程，并在需要主控处理时通知新 Main；Quick 不得启动。
---

# 任务监督子线程

只用于 DAG，固定使用 `profiles.supervisor`，默认 `gpt-5.6-luna/medium`。Main 登记后立即创建，早于 Planner。只接受 Goal 目录；禁止读取 Plan、State、Registry、Result、Worker 聊天和完整 DAG。

Main 必须把 `workflow supervisor-init` 返回的 dispatch 作为首条 prompt，在 DAG worktree 以 `environment: local` 创建 Supervisor。Supervisor 先设置脚本标题，再只循环：

```text
goal-dag.mjs supervisor-next <goal-dir> --limit 8
goal-dag.mjs supervisor-ack <goal-dir> <action-id> [宿主结果]
```

action id 是不透明值。不得调用低层 `supervisor-record`，禁止手写 JSON，禁止 Orca、`$orchestration` 和 subagent。

任何 runtime 命令失败时立即停止并通知 Main。禁止编辑、复制、替换或绕过工作流脚本，包括插件缓存和 `/tmp` 副本；禁止用内部命令、手写状态或临时补丁继续。

## create

逐字使用 action 的 `model/thinking/prompt/target`：

- `control: true` 表示 Planner 或 Planner Reviewer；新线程直接使用 action prompt，已有线程用 `send_message_to_thread` 发送同一 prompt，随后 ack。Supervisor 不解释规划结果；正常完成后脚本自动清理 watch 并投影下一控制动作。
- Review 等非 Owner 线程在 DAG worktree 以 `environment: local` 创建。
- 新 Owner 返回 `target.environment: worktree` 和 `starting_branch`。创建 worktree 线程后，等待它执行首条 prompt 中的 `owner-sync` 并结束 bootstrap turn；取得正式 threadId 和同步成功后才能 ack。
- 已有 Owner 必须复用 action 的 thread/host 和原 worktree；不得新建线程或 worktree。
- action 表示集成修复时，直接复用原 Owner；不得再次 `owner-sync`，因为该 Owner 分支包含尚未合并的修复提交。

ack `create` 后，把脚本返回的 dispatch 原样发送到目标线程。Owner 正式 dispatch 前，脚本会再次确认其 worktree 已登记且本轮 DAG 同步完成。

线程创建后只能由新线程使用正式 threadId 调用 `set_thread_title`。不得给 `create_thread` 传 title/name，不得用 clientThreadId。

## wait / notify

- `wait`：一次最多八项交给 `wait_threads(timeoutMs=60000)`，逐项沿用脚本 cursor；结果再用对应 action id ack。
- `main_action`：把脚本提供的 dispatch 原样发送给 Main 后立即结束当前 turn；不得复制机器 JSON。Dashboard、用户决策、真实阻塞、最终交付和清理由 Main 处理，Supervisor 不得代为执行。
- `stalled`：三次无 cursor 变化才通知 Main；不关闭、不 reclaim。用户确认关闭旧线程后，由 Main 调用脚本恢复并重新唤醒 Supervisor。
- `notify`：只把脚本提供的 task/thread/status/result_ref/summary 发给新 Main，成功后 ack。用户可见文本不显示 result_ref。
- Planner 或 Planner Reviewer 异常结束或未生成有效结果时同样等待 Main 决策；Main 通过 `supervisor-recover <goal-dir> <planner|planner-reviewer> <attempt> <reason>` 清除旧 route/watch 后，下一次 `supervisor-next` 才创建替代线程。
- Planner 或 Planner Reviewer 正常结束不会通知 Main；`supervisor-next` 自动推进到下一控制动作。其他无动作时结束 turn，等待 Main 重新唤醒。

Worker 线程结束只表示“线程已结束”。新 Main 调用 `start-dag` 后，脚本会对 Owner 执行 `owner-finish`；只有 Owner 分支成功合并到 DAG 且集成验证通过，task 才完成。

若 `owner-finish` 失败，新 Main 会再次唤醒 Supervisor。下一次 `supervisor-next` 返回原 Owner 的 repair create action；必须 ack 并把 repair dispatch 发回同一线程。禁止创建新 attempt、线程或 worktree。

八个是上限，不是目标。Supervisor 不实施、不 Review、不验收、不概括结果、不决定恢复策略；无状态变化不产生用户消息。Main 不调用 `wait_threads`，只有 Supervisor 负责等待。
