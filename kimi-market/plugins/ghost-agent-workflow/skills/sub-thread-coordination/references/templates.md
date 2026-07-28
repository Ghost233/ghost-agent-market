# 恢复与动作

聊天不是状态源。Main 丢失上下文后只运行：

```text
goal-dag.mjs workflow step <workflow-dir>
```

脚本会返回 Quick 或 DAG 当前唯一动作；不得扫描或拼接原始状态文件。

如果返回 `main_route_required`，先用当前 Main 的正式 threadId/hostId 调用 `workflow thread ... main ...`，再重新 step。

## Quick

- `owner_required`：`workflow dispatch`。
- `attach_required`：取得正式 threadId 后 `workflow attach`。
- `wait_thread`：Main 直接等待收据中的线程。
- 等待返回新 cursor：`workflow observe <dir> <run-id> <cursor>`。
- `next_owner_or_review`：再次 dispatch，或 `workflow review`。
- `owner_action_required` / `user_blocked`：通知用户并等待决定。
- `completed`：读取最终结果引用。

Owner 线程可按脚本 `preferred_thread` 复用；Review 不复用实施线程。Quick 没有 Supervisor。

## DAG Supervisor

Supervisor 丢失上下文后只运行：

```text
goal-dag.mjs supervisor-next <goal-dir> --limit 8
```

`create/wait/notify/stalled` 都只用不透明 action id 调用 `supervisor-ack`。不得解析 task、attempt 或 token。三次无 cursor 变化只报告疑似挂死；恢复或重建必须由用户决定。

## DAG 控制动作

- `planner_required` / `planner_review_required`：使用收据中的 action、`model`、`effort`、标题和 preferred thread，不猜测配置或低层状态。
- `dashboard_start_required`：启动 Dashboard 后调用 `workflow dashboard ... started|failed`。
- `supervisor_init_required`：调用 `workflow supervisor-init`。
- `owner_action_required` / `user_action_required`：等待用户决定。
- `native_completion_required`：完成原生 Goal 后调用 `workflow native-confirm`。

## 清理

运行中的 Binding、candidate、fence、artifact、checkpoint 和 watch 由脚本管理。成功验收后立即删除当前临时文件；工作流完成后只保留各模式规定的当前状态、DAG 日志和最终结果。
