---
name: sub-thread-task-supervisor
description: 仅供 sub-thread-coordination 在 DAG worktree 创建任务监督子线程时使用。必须在 Planner 前启动，只等待 Main 已登记的 Planner、Reviewer、Owner 与 Review 线程，并在终态、挂死或需要调度时通知新 Main；Quick 不得启动。
---

# 任务监督子线程

只用于 DAG，固定使用 `profiles.supervisor`，默认 `gpt-5.6-luna/medium`。Main 登记后立即创建，早于 Planner。只接受 Goal 目录；禁止读取 Plan、State、Registry、Result、Worker 聊天和完整 DAG。线程创建、复用、Git、Dashboard 和 DAG 调度全部属于 Main。

Main 必须逐字使用 `workflow supervisor-init` 返回的 target 和 dispatch，通过 `create_thread` 在独立 worktree 创建 Supervisor。Supervisor 先设置脚本标题，再只循环：

```text
goal-dag.mjs supervisor-next <goal-dir> --limit 8
goal-dag.mjs supervisor-ack <goal-dir> <action-id> [宿主结果]
```

action id 是不透明值。不得调用低层 `supervisor-record`，禁止手写 JSON，禁止 Orca、`$orchestration` 和 subagent。

任何 runtime 命令失败时立即停止并通知 Main。禁止编辑、复制、替换或绕过工作流脚本，包括插件缓存和 `/tmp` 副本；禁止用内部命令、手写状态或临时补丁继续。

Goal 目录位于当前独立 worktree 之外时，对原始 Node CLI 使用宿主原生文件权限请求；Codex 使用 `require_escalated`。权限被拒绝才通知 Main，禁止 fork Main 或改用直接文件写入。

Supervisor 不创建或复用线程。Main 只能调用 `create_thread`，禁止 `fork_thread`、对话分叉或继承 Main/Supervisor 历史。action prompt 是新线程的完整首条输入，不得附加聊天历史。

## wait / notify

- `wait`：一次最多八项交给 `wait_threads(timeoutMs=60000)`，逐项沿用脚本 cursor；结果再用对应 action id ack。
- `create` 或 `main_action`：不执行 action，不创建或复用线程；只通知 Main 重新调用 `supervisor-next` 处理确定性调度，然后立即结束。不得复制机器 JSON。
- `main_action.action: owner_sync_required`：只通知 Main 执行显式 `workflow owner-sync`。Supervisor 不运行 Git，也不得通过 `supervisor-next` 或 ack 间接创建、同步、提交或合并分支/worktree。
- `stalled`：三次无 cursor 变化才通知 Main；不关闭、不 reclaim。用户确认关闭旧线程后，由 Main 调用脚本恢复并重新唤醒 Supervisor。
- `notify`：只把脚本提供的 task/thread/status/result_ref/summary 发给新 Main，成功后 ack。用户可见文本不显示 result_ref。
- Owner bootstrap 的 summary 为“Owner worktree 已登记”时同样通知并 ack；Main 随后重新运行 `supervisor-next`，复用该线程完成正式 binding。Supervisor 不解析或绑定任务。
- Planner 或 Planner Reviewer 异常结束或未生成有效结果时同样等待 Main 决策；Main 通过 `supervisor-recover <goal-dir> <planner|planner-reviewer> <attempt> <reason>` 清除旧 route/watch 后，下一次 `supervisor-next` 才创建替代线程。
- Planner 或 Planner Reviewer 正常结束不会通知 Main；`supervisor-next` 自动推进到下一控制动作。其他无动作时结束 turn，等待 Main 重新唤醒。

Worker 线程结束只表示“线程已结束”。新 Main 调用 `start-dag` 后，脚本会对 Owner 执行 `owner-finish`；只有 Owner 分支成功合并到 DAG 且集成验证通过，task 才完成。

Owner 的 `blocked/failed/needs_repair` 结果由 `owner-finish` 直接验收并路由 Main，不进入集成，也不生成 repair create action。Supervisor 只通知一次，不得因没有后续 create/wait 动作而猜测或重试。

若 `owner-finish` 失败，新 Main 会再次唤醒 Supervisor。下一次 `supervisor-next` 返回原 Owner 的 repair create action；Main 必须 ack 并把 repair dispatch 发回同一线程，不得再次 `owner-sync`。禁止创建新 attempt、线程或 worktree。

验证契约迁移后的 create action 必须复用收据中的原 thread、run 和 Owner worktree；只转发更新后的 Binding 让 Worker 继续验证，不得新建线程、重新实施或 reclaim attempt。

八个是上限，不是目标。Supervisor 不创建线程、不实施、不 Review、不验收、不概括结果、不决定恢复策略；无状态变化不产生用户消息。Main 不调用 `wait_threads`，只有 Supervisor 负责等待。
