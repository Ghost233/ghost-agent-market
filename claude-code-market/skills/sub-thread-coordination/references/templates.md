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

新 worktree 允许从目标分支创建为 detached HEAD；认领脚本负责校验并附着 `ga/<key>/main`。认领成功后，先处理 `main_route_required`，再处理 `supervisor_init_required`。Supervisor 必须早于 Planner 创建。恢复或推进仍只运行同一命令；Dashboard 和 native ack 只按收据执行。

Main 不调用 `wait_threads`。Supervisor 在宿主长期线程内持续运行 `supervisor-next`；Main 只逐字执行 Supervisor 发来的 create/main_action，建立 watch 后结束 turn，不再唤醒 Supervisor。

## Supervisor

Supervisor 丢失上下文后只运行：

```text
goal-dag.mjs supervisor-next <goal-dir> --limit 8
```

所有动作只用不透明 action id 调用 `supervisor-ack`：

- create：Supervisor 不执行，只把脚本 action 的必要字段和 prompt 发送给 Main；main_action 只发送脚本 dispatch。Main 负责确定性调度，Supervisor 持续监督。
- control：Main 只用 `create_thread` 创建全新 Planner/Planner Reviewer，或复用已登记线程；禁止 fork。Supervisor只等待终态。
- `owner_sync_required`：由 Main 显式执行 `workflow owner-sync`；`supervisor-next` 和 ack 不得隐式操作 Git。
- 新 Owner worktree：Main 完成分支同步后，用 `create_thread` 按 action branch 创建全新线程，并以 `supervisor-ack ... bootstrap` 登记 watch；Supervisor 只等待 bootstrap。结束后 Main 重新投影、复用同一线程完成普通 create ack 和正式 dispatch。
- 已有 Owner：复用原线程/worktree；每个新 run 先由 Main 显式执行 `owner-sync`。
- integration repair：复用原 Owner，禁止再次同步或新建 worktree。
- wait/notify/stalled：只传宿主标量和 cursor，不读取 Result 或 DAG。
- main_action：把脚本 dispatch 原样发送给 Main 后继续监督；最终交付和清理只能由 Main 执行。

控制线程 stalled/failed/cancelled 或未生成有效结果时，Main 等待用户确认关闭旧线程，再调用 `supervisor-recover <goal-dir> <planner|planner-reviewer> <attempt> <reason>`。脚本原子清除旧 route/watch；Supervisor 下一轮自行创建新 action。

## Owner 完成

Worker `complete` 后 task 仍为 running。新 Main 下一次 `start-dag` 内部执行 `owner-finish`。只有脚本合并和集成验证通过才完成；失败时返回 Supervisor repair 动作，由原 Owner 原地修复。

若 Worker 返回 `blocked/failed/needs_repair`，`owner-finish` 只接受终态并交给 Main，不合并 Owner 分支。task scope 内的 Git submodule 由 `owner-sync/owner-finish` 自动初始化、提交和同步，任何模型线程都不直接操作。

Goal finalize 后脚本自动合并 DAG 分支到原始分支的最新 HEAD，保存最终结果与 DAG 日志，再删除全部 Owner/DAG worktree 和分支。冲突时停止清理并保留完整现场供继续修复。

## 清理

Binding、candidate、fence、artifact、checkpoint、临时集成 worktree 与 watch 由脚本管理。成功验收后立即删除当前临时文件；最终只在原始工作区保留 `result.json` 与 `events.jsonl`。
