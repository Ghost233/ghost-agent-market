# 恢复与动作

聊天不是状态源；不得扫描、打开或拼接原始状态文件。

## Quick

Quick Main 丢失上下文后运行脚本返回的 `workflow step` 当前动作：dispatch/attach/observe/review。Quick Owner 可按 `preferred_thread` 复用；Review 必须使用干净线程。

## DAG 当前会话

首次只调用：

```text
goal-dag.mjs workflow start-dag <原始工作区> <development-key>
```

`development-key` 必须匹配 `^[a-z0-9][a-z0-9_-]{0,63}$`；用户提供时原样使用，否则根据需求生成稳定英文 key。收到 `handoff_required` 后逐字使用收据内含完整命令的 dispatch 创建 DAG worktree 新 Main，然后当前会话永久停止。不得等待或继续执行。

## DAG 新 Main

首次把原目标通过 stdin 交给：

```text
goal-dag.mjs workflow start-dag <当前 DAG worktree> <相同 development-key>
```

新 worktree 允许从目标分支创建为 detached HEAD；认领脚本负责校验并附着 `dev/<key>/main`。认领成功后，恢复或推进仍只运行同一命令；脚本会返回当前唯一动作。`main_route_required`、Dashboard、Supervisor 和 native ack 只按收据执行。

Main 不调用 `wait_threads`。创建或唤醒 Supervisor 后立即结束 turn。

## Supervisor

Supervisor 丢失上下文后只运行：

```text
goal-dag.mjs supervisor-next <goal-dir> --limit 8
```

所有动作只用不透明 action id 调用 `supervisor-ack`：

- 新 Owner worktree：按 action branch 创建线程，等待其 bootstrap `owner-sync` 结束，再 ack 和发送正式 dispatch。
- 已有 Owner：复用原线程/worktree；每个新 run 已由脚本先 `owner-sync`。
- integration repair：复用原 Owner，禁止再次同步或新建 worktree。
- wait/notify/stalled：只传宿主标量和 cursor，不读取 Result 或 DAG。

## Owner 完成

Worker `complete` 后 task 仍为 running。新 Main 下一次 `start-dag` 内部执行 `owner-finish`。只有脚本合并和集成验证通过才完成；失败时返回 Supervisor repair 动作，由原 Owner 原地修复。

Goal finalize 后脚本自动合并 DAG 分支到原始分支的最新 HEAD，保存最终结果与 DAG 日志，再删除全部 Owner/DAG worktree 和分支。冲突时停止清理并保留完整现场供继续修复。

## 清理

Binding、candidate、fence、artifact、checkpoint、临时集成 worktree 与 watch 由脚本管理。成功验收后立即删除当前临时文件；最终只在原始工作区保留 `result.json` 与 `events.jsonl`。
