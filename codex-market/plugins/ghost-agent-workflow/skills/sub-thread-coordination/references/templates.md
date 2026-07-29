# 恢复与动作

聊天不是状态源；不得扫描、打开或拼接原始状态文件。

## Quick

Quick Main 丢失上下文后运行脚本返回的 `workflow step` 当前动作：dispatch/attach/observe/review。Quick Owner 可按 `preferred_thread` 复用；Review 必须使用干净线程。

## DAG 当前会话

首次只调用：

```text
goal-dag.mjs workflow start-dag <原始工作区> <development-key>
```

`development-key` 必须匹配 `^[a-z0-9][a-z0-9_-]{0,63}$`；用户提供时原样使用，否则根据需求生成稳定英文 key。收到 `handoff_required` 后只用 `create_thread` 和收据内含完整命令的 dispatch 创建全新 DAG worktree Main；禁止 `fork_thread` 和历史继承。然后当前会话永久停止，不得等待或继续执行。

## DAG 新 Main

首次把原目标通过 stdin 交给：

```text
goal-dag.mjs workflow start-dag <当前 DAG worktree> <相同 development-key>
```

新 worktree 允许从目标分支创建为 detached HEAD；认领脚本负责校验并附着 `ga/<key>/main`。认领成功后，先处理 `main_route_required`，再处理 `supervisor_init_required`。Supervisor 必须早于 Planner 创建。取得 `goal_dir` 后，恢复或推进只运行 `workflow step <goal-dir>`；`start-dag` 不再用于当前 Goal。Dashboard 和 native ack 只按收据执行。

Main 不调用 `wait_threads`。Supervisor 先执行 `supervisor start`，只在脚本确认存在 active 任务时运行原生 Goal；`supervisor next` 返回 `stop` 后用 `supervisor stop` 确认并 complete 当前 Goal。Main 遇到 `supervisor_required` 时逐字发送脚本 dispatch，新一批 active 任务会按需创建新 Goal。Worker 结果动作也会按脚本收据主动唤醒 Supervisor。

## Supervisor

Supervisor 每批 active 任务创建或复用原生 Goal；Goal 提示词运行期间不修改。丢失上下文后仍只运行：

```text
goal-dag.mjs supervisor next <goal-dir>
```

`next` 只返回 `create|wait|notify|stop`。所有动作只用不透明 action id 调用 `supervisor ack`；十轮无进度的 `notify/kind: inspect` 使用 `supervisor inspect`：

- create：Supervisor 不执行，只把脚本 action 的必要字段和 prompt 发送给 Main。Main 负责确定性调度，Supervisor Goal 保持 active。
- control：Main 只用 `create_thread` 创建全新 Planner/Planner Reviewer，或复用已登记线程；禁止 fork。Supervisor只等待终态。
- `owner_sync_required`：由 Main 显式执行 `workflow owner-sync`，再运行 `workflow step <goal-dir>` 投影下一动作；Supervisor 命令不得隐式操作 Git。
- 新 Owner worktree：Main 完成分支同步后，用 `create_thread` 按 action branch 创建全新线程，并以 `supervisor ack ... bootstrap` 登记 watch；Supervisor 只等待 bootstrap。结束后 Main 重新投影、复用同一线程完成普通 create ack 和正式 dispatch。
- 已有 Owner：复用原线程/worktree；每个新 run 先由 Main 显式执行 `owner-sync`。
- integration repair：复用原 Owner，禁止再次同步或新建 worktree。
- wait：固定使用 120 秒，按 thread/host 匹配 `wait_threads` poll，只把 `poll.cursor` 与 `poll.latestTurn.status` 交给 `supervisor ack`；普通 wait 禁止使用 `poll.thread.status.type`。
- notify/inspect：连续十轮无 cursor 变化后，Supervisor 用 `read_thread` 做一次深入检查，只把 `latestTurn.status` 与 `thread.status.type` 交给 `supervisor inspect`；脚本生成有限结论和 Main 报告，Supervisor 不自行诊断。Main 选择继续运行时只调用内部 `supervisor-resume <goal-dir> <task-id> <attempt>`，并把收据的 `thread_notify` 与可选 `supervisor_notify` 逐字发送给对应线程。
- notify/terminal：只传脚本要求的标量，不读取 Result 或 DAG；notify/main 只把 dispatch 原样发送给 Main。
- stop：用 `supervisor stop` 二次确认没有 active 任务，然后 complete 当前 Goal。最终交付和清理只能由 Main 执行。
- active Goal 仍有未完成 task 时，脚本禁止返回所有 action 为空；有 Result 就投影验收动作，无 Result 就等待或重新派发原线程。

控制线程 stalled/failed/cancelled 或未生成有效结果时，Main 等待用户确认关闭旧线程，再调用 `supervisor-recover <goal-dir> <planner|planner-reviewer> <attempt> <reason>`。脚本原子清除旧 route/watch；Supervisor 下一轮自行创建新 action。

## Owner 完成

Worker `complete` 后 task 仍为 running。新 Main 下一次 `workflow step <goal-dir>` 内部执行 `owner-finish`。只有脚本合并和集成验证通过才完成；失败时返回 Supervisor repair 动作，由原 Owner 原地修复。

Worker 每个 DAG 结果动作成功后，必须逐字发送收据中的 `supervisor_notify.message`；Main 不参与等待或转发。

若 Worker 返回 `blocked/failed/needs_repair`，`owner-finish` 只接受终态并交给 Main，不合并 Owner 分支。task scope 内的 Git submodule 由 `owner-sync/owner-finish` 自动初始化、提交和同步，任何模型线程都不直接操作。

Goal finalize 后脚本自动合并 DAG 分支到原始分支的最新 HEAD，保存最终结果与 DAG 日志，再删除全部 Owner/DAG worktree 和分支。冲突时停止清理并保留完整现场供继续修复。

## 清理

Binding、candidate、fence、artifact、checkpoint、临时集成 worktree 与 watch 由脚本管理。成功验收后立即删除当前临时文件；最终只在原始工作区保留 `result.json` 与 `events.jsonl`。
