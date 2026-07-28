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

Work 只修改 writable scope。Review 使用干净上下文、不得读取实施聊天、不得修改文件。只运行 Binding `task.verify` 中的定向验证；机械验收由脚本完成，不属于模型 Review。

每个绑定验证必须通过脚本实际执行一次：

```text
goal-dag.mjs worker verify <workflow-dir> <run-id> <verification-id> <command> [arg...]
```

命令使用 argv，不使用 shell 字符串。一个 verification id 只保存当前一次日志；重跑会覆盖旧结果。`worker complete`、`complete-risk` 和 `request-dag` 会拒绝缺失或失败的验证，Worker 不得伪造 pass/evidence。

## 动作

摘要通过 stdin，控制在 100 字内：

```text
goal-dag.mjs worker complete <workflow-dir> <run-id>
goal-dag.mjs worker block <workflow-dir> <run-id>
goal-dag.mjs worker fail <workflow-dir> <run-id>
goal-dag.mjs worker request-dag <workflow-dir> <run-id>
```

`request-dag` 在 Quick 中验收安全边界并单向升级，只规划剩余工作；在 DAG 父节点中请求 Composite Planner 展开内部子图。

Quick 的 `block/fail` 前必须恢复未验收文件修改；需要保留已完成部分时使用 `request-dag`。DAG 的固定风险与 scope 动作见 [动作表](references/templates.md)。

命令生成 changed files、identity、结果候选和 digest。禁止调用 `result-submit`、手写 Result/JSON、保存 evidence/history 或自行启动 Review。stdout 只作机器收据；线程结束后由 Main 或 Supervisor 调用 `workflow step` 机械验收。
