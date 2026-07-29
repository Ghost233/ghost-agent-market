# 运行模式

用户每次必须明确选择 Quick 或 DAG。两者共用 Owner、run-id、Binding、scope、脚本验证与最终 Result，不共用调度位置。

Claude Code 固定使用 `standalone_thread`，不包含 Codex 原生 Goal 桥接。

## Quick

Quick 是原地串行模式：始终使用启动时的当前工作区和当前分支，不创建或操作任何 Git 分支/worktree。它不创建 Planner、Plan、Supervisor 或 Dashboard；Main 串行 dispatch Owner，脚本机械验收后显式启动独立 Review。跨 Owner 只消费脚本 handoff，不读取前一线程聊天。

## DAG handoff

```text
原始用户会话
→ workflow start-dag 创建 DAG 分支并返回 handoff
→ 宿主以该分支创建 DAG worktree 和新 Main
→ 新 Main 再次 start-dag，认领分支并创建 Goal
→ 原始会话停止
```

首次 `start-dag` 不创建 Goal 或状态。新 Main 认领后，Goal、Dashboard、Plan、State、Result、progress 与 events 只存在于 DAG worktree。原始工作区只保留原始分支，直到最终交付。

Planner 只生成最小顶层图；初始 child 被拒绝。父节点不能直接完成时再由 Composite Planner 展开子图。Planner Reviewer 是激活前门禁；Implementation Review 是显式 DAG 节点。

## Owner 集成

每个 Owner 在当前 Goal 内复用自己的分支、worktree 与线程：

```text
owner-sync <goal-dir> <owner-id>
→ Owner 在专属 worktree 实施并验证
→ worker complete 生成候选
→ owner-finish <goal-dir> <run-id>
→ 临时 worktree 合并 + 重跑验证
→ DAG 分支快进 + task 完成
```

`owner-sync` 是每轮任务的前置门禁。Owner 分支可能并行基于同一 DAG HEAD；`owner-finish` 总是在最新 DAG HEAD 上做临时集成，因此冲突或失败不会污染 DAG。失败时保留 Owner 分支、原 worktree 和 running task，清除候选，原 Owner 继续修复。

下游只在前置 task 已合并 DAG 后 ready。Goal finalize 后，脚本先把 DAG 分支合并回启动时记录的原始分支，再保存最终结果和 DAG 日志，最后删除全部 Owner/DAG worktree 与分支；任一步失败都不得声称交付完成。

## 持久化

- Quick：当前 workflow 状态、Owner 当前上下文、最终结果。
- DAG 运行中：DAG worktree 内的当前 Plan/State、`progress.json`、`events.jsonl`、worktree 路由和最终结果。
- DAG 成功交付后：原始工作区 `.ghost-agent-workflow/result.json` 与 `.ghost-agent-workflow/events.jsonl`；执行状态随 DAG worktree 删除。

事务恢复文件成功后立即清理。禁止 attempt、Review、evidence、recovery 和聊天 history。
