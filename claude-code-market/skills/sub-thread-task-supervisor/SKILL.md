---
name: sub-thread-task-supervisor
description: 仅供 sub-thread-coordination 在 DAG worktree 按需启动任务监督线程时使用。通过固定脚本入口监督 Main 登记的活动线程；最多等待 120 秒，十轮无进度后脚本化检查，没有活动任务时结束当前监督 turn。Quick 不得启动。
---

# 任务监督子线程

> 平台差异：Claude Code 不提供 Codex 原生 Goal 工具，因此使用同一线程内的持续监督 turn；不得伪造原生 Goal 状态。

只用于 DAG，固定使用 `profiles.supervisor`，默认 `gpt-5.6-luna/medium`。唯一状态源是当前项目 `.ghost-agent-workflow` 下的 `<goal-dir>`。禁止读取 Plan、State、Registry、Binding、Result、Progress、完整 DAG、Worker 聊天、业务代码或其他项目目录。

Supervisor 不创建或复用执行线程。Main 只能用 `create_thread` 创建独立 worktree 线程，禁止 `fork_thread`、对话分叉或携带 Main 历史。Main 不调用 `wait_threads`、sleep 或轮询；只有 Supervisor 负责等待。

## 固定目标

每个 Supervisor Goal 的 objective 必须逐字使用脚本给出的以下固定文本：

> 持续监督当前项目 .ghost-agent-workflow 中由 Main 通过脚本登记的活动任务。按脚本返回的动作创建、等待和检查线程；线程结束后通知 Main 验收。不得读取或推断完整 DAG，不处理业务内容，不自行修改任务状态。没有活动任务时立即结束当前 Goal。

Main 启动的 Main、Planner、Planner Reviewer、Owner、Implementation Review 与 Supervisor 目标，必须先通过脚本登记。目标、线程、角色和当前状态由 runtime 原子投影到 `status_document`；Supervisor 不直接读取或编辑该文件，也不得只依靠聊天消息恢复状态。

## 持续监督 turn

每次收到 dispatch，先执行 `supervisor start`。返回 `start` 时启动或继续当前监督 turn；返回 `stop` 时保持停止。运行期间不改写监督目标。上下文压缩或恢复后不从聊天重建状态，只重新执行 `supervisor next`。Main 启动的目标均由 runtime 投影到 `status_document`，Supervisor 不编辑或解析原始 JSON。

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
- `notify` 且 `kind: main`：只把脚本 dispatch 逐字发送给 Main，不 ack，不解析业务结果。发送成功后执行 `supervisor stop` 并结束当前监督 turn。Owner 同步、验收、最终交付和清理仍由 Main 执行，产生新 active 任务时由新 dispatch 启动新监督 turn。
- `notify` 且 `kind: inspect`：这表示脚本已经累计十轮无 cursor 变化。按 action 的 thread/host 和 `inspection_turn_limit` 调用一次 `read_thread`，只取 `latestTurn.status` 与 `thread.status.type`，随后调用 `supervisor inspect`。只把脚本返回的结论通知 Main，由 Main 决定继续等待、reclaim、关闭或重建；Supervisor 不自行判断或执行恢复。
- `stop`：立即执行 `supervisor stop` 二次确认并结束当前监督 turn；不得继续等待。后续 Main 或 Worker 通过脚本登记新 active 任务后，由新 dispatch 按需启动新的监督 turn。

连续等待次数保存在本地状态并由脚本累计，Supervisor 不自行计数。执行线程结束后必须把 runtime 收据中的 `supervisor_notify.message` 主动发送到本 Supervisor；收到通知后立即从 `supervisor start` 重新检查本地状态。若上一监督 turn 已结束，只在脚本返回 `start` 后启动新 turn。

`owner-finish` 失败时复用原 Owner 线程、run、attempt、binding 和 worktree，不得再次 `owner-sync` 或重新实施。任何 CLI、poll 匹配或 ack 失败都只报告简短原因和脚本日志路径，停止当前 turn；禁止输出完整 JSON、DAG、Result、diff 或原始日志。

脚本 JSON 只作机器收据，不复制到 commentary、final 或普通聊天。八个是上限，不是目标；没有状态变化时保持静默。
