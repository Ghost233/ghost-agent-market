---
name: sub-thread-goal-worker
description: 仅供 sub-thread-coordination 向已绑定的 Quick Owner、DAG Owner 或独立 Implementation Review 线程投递当前 run id 时使用。读取脚本 Binding，执行一个 fenced run，并通过固定动作提交结果或请求 DAG。
---

# 子线程 Worker

只执行当前 run；禁止 subagent。先调用：

```text
goal-dag.mjs worker open <workflow-dir> <run-id>
```

不得读取原始 Plan、State、Registry 或猜测 task、attempt、token、路径和字段。核对 Binding 的 task、done、dependencies 与 scope；身份不符立即停止。

## Worktree 边界

- Quick Owner 在 Quick workspace 工作。
- DAG Owner 只能在脚本登记的专属 Owner worktree 工作；本轮正式 dispatch 前必须已经完成 `workflow owner-sync`。
- Review 在 DAG worktree 使用干净上下文，只读，不得读取实施聊天或修改文件。
- Worker 不运行任何 Git、worktree、commit、merge、checkout、rebase 或 branch 命令；全部由 `owner-sync/owner-finish` 处理。

Work 只修改 Binding writable scope。每个绑定验证都通过脚本执行一次：

```text
goal-dag.mjs worker verify <workflow-dir> <run-id> <verification-id> <command> [arg...]
```

命令按 argv 传入，不用 shell 字符串。验证会在当前绑定的 Owner worktree 执行；缺失或失败时完成动作被拒绝。

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

禁止调用 `result-submit` 或 `finish`；禁止手写 Result/JSON、保存 evidence/history 或自行启动 Review。stdout 只作机器收据。
