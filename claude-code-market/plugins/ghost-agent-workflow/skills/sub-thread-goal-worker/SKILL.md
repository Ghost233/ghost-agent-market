---
name: sub-thread-goal-worker
description: 仅供 sub-thread-coordination 向已绑定的 Quick Owner、DAG Owner 或独立 Implementation Review 线程投递当前 run id 时使用。读取脚本 Binding，执行一个 fenced run，并通过固定动作提交结果或请求 DAG。
---

# 子线程 Worker

只执行当前 run；禁止 subagent。先调用：

线程必须是 Main 通过 `create_thread` 创建的独立 worktree；禁止 fork Main。Goal 目录位于当前 worktree 之外时，对原始 Node CLI 使用宿主原生文件权限请求；Codex 使用 `require_escalated`。权限失败时停止并通知 Main，禁止直接编辑共享状态。

```text
goal-dag.mjs worker open <workflow-dir> <run-id>
```

不得读取原始 Plan、State、Registry 或猜测 task、attempt、token、路径和字段。核对 Binding 的 task、done、dependencies 与 scope；身份不符立即停止。

任何 runtime 命令失败时立即停止并通知 Main。禁止编辑、复制、替换或绕过工作流脚本，包括插件缓存和 `/tmp` 副本；禁止用内部命令、手写 JSON 或临时补丁继续。

## Worktree 边界

- Quick Owner 在 Quick workspace 工作。
- DAG Owner 只能在脚本登记的专属 Owner worktree 工作；本轮正式 dispatch 前必须已经完成 `workflow owner-sync`。
- Review 在从 DAG 分支创建的独立干净 worktree 中只读，不得读取实施聊天或修改文件。
- Worker 不运行任何 Git、worktree、commit、merge、checkout、rebase 或 branch 命令；全部由 `owner-sync/owner-finish` 处理。

Work 只修改 Binding writable scope。每个绑定验证都通过脚本执行一次：

```text
goal-dag.mjs worker verify <workflow-dir> <run-id> <verification-id>
```

DAG verification 的 argv 已由 Plan/Binding 绑定，runtime 按 id 执行。Worker 只逐字使用 Binding 中的 verification id，禁止追加命令参数、拼 shell 命令或把完整命令当作 id。Quick 的 `quick-check` 仍按脚本收据提供 argv。DAG 验证失败时 runtime 直接提交失败结果、把 task 收敛为 `task_failed/repair_task` 并返回 `supervisor_notify`；Worker 发送该通知后停止，不得再补调用 `worker fail`。

## 结果动作

摘要通过 stdin，最多 100 字：

```text
goal-dag.mjs worker complete <workflow-dir> <run-id>
goal-dag.mjs worker block <workflow-dir> <run-id>
goal-dag.mjs worker fail <workflow-dir> <run-id>
goal-dag.mjs worker request-dag <workflow-dir> <run-id>
```

`worker complete` 只生成结果候选，不表示 DAG task 完成。线程结束后，新 Main 的 `workflow start-dag` 会调用 `owner-finish`：脚本提交 Owner 修改，在临时集成 worktree 合并到最新 DAG、重跑绑定验证，再快进 DAG 并机械验收。只有该流程成功，task 才完成。

若收到集成修复 dispatch，必须继续使用当前 Owner 线程和 worktree，根据脚本给出的简短失败原因修复，重新运行全部绑定验证并再次 `worker complete`。不得重新同步、丢弃提交、切换分支或自行处理 Git。

`request-dag` 在 Quick 中验收安全边界后单向升级；在 DAG 父节点中请求 Composite Planner 展开内部子图。DAG 风险与 scope 固定动作见 [动作表](references/templates.md)。

DAG 的失败 `verify` 或 `complete/block/fail/complete-risk/request-scope/request-dag` 成功后，runtime 收据必须包含 `supervisor_notify`。立即使用 `send_message_to_thread`，把其中的 `message` 逐字发送到指定 `thread + host`，不得概括、追加 Result 或在当前聊天复述。发送失败时不得重跑结果命令，因为结果已经落盘；只向 Main 报告简短通知失败，Supervisor 的 120 秒轮询仍可恢复。Quick 不返回也不发送该通知。

禁止调用 `result-submit` 或 `finish`；禁止手写 Result/JSON、保存 evidence/history 或自行启动 Review。stdout 只作机器收据。
