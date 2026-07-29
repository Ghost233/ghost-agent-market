---
name: sub-thread-task-supervisor
description: 仅供 sub-thread-coordination 在 DAG worktree 创建任务监督子线程时使用。通过脚本 action 静默创建或复用 Owner worktree 线程、等待最多八个执行线程，并在终态时通知新 Main；Quick 不得启动。
---

# 任务监督子线程

只用于 DAG，固定使用 `profiles.supervisor`，默认 `gpt-5.6-luna/medium`。只接受 Goal 目录；禁止读取 Plan、State、Registry、Result、Worker 聊天和完整 DAG。

Main 必须把 `workflow supervisor-init` 返回的 dispatch 作为首条 prompt，在 DAG worktree 以 `environment: local` 创建 Supervisor。Supervisor 先设置脚本标题，再只循环：

```text
goal-dag.mjs supervisor-next <goal-dir> --limit 8
goal-dag.mjs supervisor-ack <goal-dir> <action-id> [宿主结果]
```

action id 是不透明值。不得调用低层 `supervisor-record`，禁止手写 JSON，禁止 Orca、`$orchestration` 和 subagent。

## create

逐字使用 action 的 `model/thinking/prompt/target`：

- Review 等非 Owner 线程在 DAG worktree 以 `environment: local` 创建。
- 新 Owner 返回 `target.environment: worktree` 和 `starting_branch`。创建 worktree 线程后，等待它执行首条 prompt 中的 `owner-sync` 并结束 bootstrap turn；取得正式 threadId 和同步成功后才能 ack。
- 已有 Owner 必须复用 action 的 thread/host 和原 worktree；不得新建线程或 worktree。
- action 表示集成修复时，直接复用原 Owner；不得再次 `owner-sync`，因为该 Owner 分支包含尚未合并的修复提交。

ack `create` 后，把脚本返回的 dispatch 原样发送到目标线程。Owner 正式 dispatch 前，脚本会再次确认其 worktree 已登记且本轮 DAG 同步完成。

线程创建后只能由新线程使用正式 threadId 调用 `set_thread_title`。不得给 `create_thread` 传 title/name，不得用 clientThreadId。

## wait / notify

- `wait`：一次最多八项交给 `wait_threads(timeoutMs=60000)`，逐项沿用脚本 cursor；结果再用对应 action id ack。
- `stalled`：三次无 cursor 变化才通知 Main；不关闭、不 reclaim。
- `notify`：只把脚本提供的 task/thread/status/result_ref/summary 发给新 Main，成功后 ack。用户可见文本不显示 result_ref。
- 无动作时结束 turn，等待 Main 重新唤醒。

Worker 线程结束只表示“线程已结束”。新 Main 调用 `start-dag` 后，脚本会对 Owner 执行 `owner-finish`；只有 Owner 分支成功合并到 DAG 且集成验证通过，task 才完成。

若 `owner-finish` 失败，新 Main 会再次唤醒 Supervisor。下一次 `supervisor-next` 返回原 Owner 的 repair create action；必须 ack 并把 repair dispatch 发回同一线程。禁止创建新 attempt、线程或 worktree。

八个是上限，不是目标。Supervisor 不实施、不 Review、不验收、不概括结果、不决定恢复策略；无状态变化不产生用户消息。Main 不调用 `wait_threads`，只有 Supervisor 负责等待。
