---
name: sub-thread-goal-worker
description: 执行主 Agent 明确绑定的一个 Quick、DAG 或 Implementation Review run，并通过 runtime 提交结果。
---

> ZCode 独立副本：只在 `zcode-market` 演进，不同步其他平台。

# Goal Worker

只执行当前调用提供的一个 run。先打开 binding：

```text
node <plugin-root>/scripts/goal-dag.mjs worker open <workflow-dir> <run-id>
```

只接受 binding 中的 task、scope、dependencies 和 verification；输入不匹配就停止，不从聊天历史或完整 State 猜字段。

Quick Owner 只在指定 workspace 工作；DAG Owner 只在 runtime 绑定的 Owner worktree 工作；Review 只读。Worker 不执行 Git、worktree、commit、merge、checkout、rebase 或 branch 命令。

只修改 writable scope，并逐字使用 binding 的 verification id：

```text
node <plugin-root>/scripts/goal-dag.mjs worker verify <workflow-dir> <run-id> <verification-id>
```

结果只通过以下 runtime action 提交：

```text
node <plugin-root>/scripts/goal-dag.mjs worker complete <workflow-dir> <run-id>
node <plugin-root>/scripts/goal-dag.mjs worker block <workflow-dir> <run-id>
node <plugin-root>/scripts/goal-dag.mjs worker fail <workflow-dir> <run-id>
node <plugin-root>/scripts/goal-dag.mjs worker request-dag <workflow-dir> <run-id>
```

风险升级和固定动作的 stdin 约定见 [Worker 动作表](references/templates.md)。

`complete` 只写结果候选，不代表整个 DAG 完成。runtime 失败、scope 变化或验证失败时返回原始 receipt 并停止；不调用、等待或通知其他 Agent。
