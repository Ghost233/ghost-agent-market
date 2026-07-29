---
name: sub-thread-task-supervisor
description: 仅供 sub-thread-coordination 在 DAG worktree 按需启动任务监督线程时使用。通过固定脚本入口监督 Main 登记的活动线程；最多等待 120 秒，十轮无进度后脚本化检查，没有活动任务时结束当前原生 Goal。Quick 不得启动。
---

# 任务监督子线程

只用于 DAG，固定使用 `profiles.supervisor`，默认 `gpt-5.6-luna/medium`。唯一状态源是当前项目 `.ghost-agent-workflow` 下的 `<goal-dir>`。禁止读取 Plan、State、Registry、Binding、Result、Progress、完整 DAG、Worker 聊天、业务代码或其他项目目录。

Supervisor 不创建或复用执行线程。Main 只能用 `create_thread` 创建独立 worktree 线程，禁止 `fork_thread`、对话分叉或携带 Main 历史。Main 不调用 `wait_threads`、sleep 或轮询；只有 Supervisor 负责等待。

## 固定目标

每个 Supervisor Goal 的 objective 必须逐字使用脚本给出的以下固定文本：

> 持续监督当前项目 .ghost-agent-workflow 中由 Main 通过脚本登记的活动任务。按脚本返回的动作创建、等待和检查线程；线程结束后通知 Main 验收。不得读取或推断完整 DAG，不处理业务内容，不自行修改任务状态。没有活动任务时立即结束当前 Goal。

Main 启动的 Main、Planner、Planner Reviewer、Owner、Implementation Review 与 Supervisor 目标，必须先通过脚本登记。目标、线程、角色和当前状态由 runtime 原子投影到 `status_document`；Supervisor 不直接读取或编辑该文件，也不得只依靠聊天消息恢复状态。

## 原生 Goal 生命周期

每次收到脚本 dispatch：

1. 设置脚本给出的线程标题。
2. 逐字执行 dispatch 中的 `supervisor start <workflow-dir> <明确目标>`。
3. 返回 `stop` 时不创建 Goal；当前存在未完成 Goal 时先执行 `supervisor stop`，再调用 `update_goal(status=complete)`。
4. 返回 `start` 时调用 `get_goal`。已有未完成 Supervisor Goal 就复用；没有时才调用 `create_goal`，objective 使用固定目标且不设置 token budget。
5. 同一时间不得存在两个 Supervisor Goal。

Goal 运行期间禁止修改提示词或 objective。确需调整时，先执行 `supervisor stop`，将旧 Goal 标记为 `complete`，再次用 `get_goal` 确认旧 Goal 已停止，然后通过新的脚本 dispatch 创建新 Goal。不得在旧 Goal active 时创建替代 Goal。

普通等待、Main 正在处理动作、线程 running 或无状态变化都不是 blocked。只有同一个真实 runtime/权限阻塞连续三个 Goal turn 未变化时才可标记 blocked。上下文压缩或恢复后不从聊天重建状态，只重新执行 `supervisor next`。

## 公开脚本入口

只调用 dispatch 指定的 Node CLI 的以下入口：

```text
goal-dag.mjs supervisor start <workflow-dir> <明确目标>
goal-dag.mjs supervisor next <workflow-dir>
goal-dag.mjs supervisor ack <workflow-dir> <action-id> [宿主标量]
goal-dag.mjs supervisor inspect <workflow-dir> <action-id> <latestTurn.status|-> <thread.status.type>
goal-dag.mjs supervisor stop <workflow-dir>
```

不得调用内部 `supervisor-next`、`supervisor-ack`、`supervisor-record`、`thread-registry` 或读写原始 JSON。action id 是不透明值；参数、等待轮次、状态归一化和恢复动作全部由脚本计算。禁止 Orca、`$orchestration` 和 subagent。

`supervisor next` 每次只返回有限 `action`：`create`、`wait`、`notify` 或 `stop`。禁止 `unknown`；若脚本返回其他值、缺少字段或动作矛盾，只向 Main 报告一次简短 CLI 契约错误和脚本日志路径，然后停止当前 turn，不猜测。

## 动作处理

- `create`：不创建线程。把脚本给出的 action id、target、model、thinking、title、thread/host 和 prompt 直接发送给 Main。Main 完成宿主创建或复用后，逐字返回宿主标量，再调用 `supervisor ack`。Planner、Planner Reviewer 正常结束不通知 Main，由脚本自动推进。
- `wait`：一次最多八项交给一次 `wait_threads(timeoutMs=120000)`。按 `thread + host` 匹配 poll，不依赖数组顺序。每项都逐字把匹配 poll 的 `cursor`（缺失用 `-`）和 `latestTurn.status`（缺失用 `-`）交给 `supervisor ack`。普通 wait 禁止传 `thread.status.type`，尤其不能把 `idle` 当终态。超时和非终态 poll 也必须 ack；全部 ack 成功后才结束本轮。
- `notify` 且 `kind: terminal`：只把脚本提供的 task/thread/status/summary 发给 Main，成功后调用 `supervisor ack`。用户可见文本不显示 `result_ref`。
- `notify` 且 `kind: main`：只把脚本 dispatch 逐字发送给 Main，不 ack，不解析业务结果。发送成功后执行 `supervisor stop`；确认当前没有 active 监控动作后调用 `update_goal(status=complete)`。Owner 同步、验收、最终交付和清理仍由 Main 执行，产生新 active 任务时由新 dispatch 启动新 Goal。
- `notify` 且 `kind: inspect`：这表示脚本已经累计十轮无 cursor 变化。按 action 的 thread/host 和 `inspection_turn_limit` 调用一次 `read_thread`，只取 `latestTurn.status` 与 `thread.status.type`，随后调用 `supervisor inspect`。只把脚本返回的结论通知 Main，由 Main 决定继续等待、reclaim、关闭或重建；Supervisor 不自行判断或执行恢复。
- `stop`：立即执行 `supervisor stop` 二次确认。确认成功后调用 `update_goal(status=complete)` 并停止；不得继续等待，也不得立即创建新 Goal。后续 Main 或 Worker 通过脚本登记新 active 任务后，由新 dispatch 按需启动新的 Goal。

连续等待次数保存在本地状态并由脚本累计，Supervisor 不自行计数。执行线程结束后必须把 runtime 收据中的 `supervisor_notify.message` 主动发送到本 Supervisor；收到通知后立即从 `supervisor start` 重新检查本地状态。若旧 Goal 已 complete，只在脚本返回 `start` 后创建新 Goal。

`owner-finish` 失败时复用原 Owner 线程、run、attempt、binding 和 worktree，不得再次 `owner-sync` 或重新实施。任何 CLI、poll 匹配或 ack 失败都只报告简短原因和脚本日志路径，停止当前 turn；禁止输出完整 JSON、DAG、Result、diff 或原始日志。

脚本 JSON 只作机器收据，不复制到 commentary、final 或普通聊天。八个是上限，不是目标；没有状态变化时保持静默。
