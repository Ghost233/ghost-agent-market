# Ghost Agent Workflow Codex 插件

包含七个 skill：`goal-dag-runner`、`parallel-task-planner`、`thread-coordination`、`thread-goal-worker`、`subagent-coordination`、`subagent-goal-worker` 和 `git-commit`。

Codex 推荐入口只有这一行：

```text
/goal 每轮使用 $goal-dag-runner，以子代理 DAG 完整执行 `./plan.md`，直到计划项覆盖率 100% 且所有验收通过。
```

原生 `/goal` 是持久外循环；每轮显式 `$goal-dag-runner` 是内循环入口。skill 只读取并校验原生 objective，不调用 `create_goal`，也不通过 `update_goal` 覆盖 objective。每个本地 `goal_id`/目录都包含 `threadId + createdAt` 的稳定 SHA-256 短摘要；恢复时再精确校验完整 native identity 与 objective digest，因此相同 objective 可以安全重复创建。它从计划文档生成 `GOAL_CONTRACT_V1`、`PLAN_COVERAGE_V1` 和 v4 `DAG_PLAN_V4`，在本地推进 coverage、Owner、Capsule、checkpoint、reservation 与证据。Codex 不需要人工 continuation prompt。

首次 `goal-validate` 会冻结 `WORKTREE_BASELINE_V1` 并生成 `SOURCE_BLOCKS_V1`。planner 为每个 plan item 写 source refs 和 required effects，task 用 `coverage_effect` 精确覆盖；独立 source audit 必须先于所有 work，最终 diff audit 由 runtime 扫描 baseline、真实工作区与 accepted results，两个 artifact 都用 SHA-256 绑定。

每轮恢复先 `reconcile` 再 reserve；`status`/`reconcile` 为每个 active reservation 返回完整 canonical binding 与 action/phase，使 spawn/bind/send 崩溃后无需聊天记忆或自行重算。source drift 时停止 reserve、drain active reservation，再事务刷新 source revision、blocks、coverage/state 与 Capsule；invalidated task 的当前证据不可沿用。DAG 耗尽但 required effect coverage 不足 100% 时返回 `needs_delta`。

只有 coverage 达到 100%、当前 revision 的 task 与 required gate 证据全部有效，且其它 completion invariant 均成立时，`finalize` 才返回 `completed`。skill 随后只执行 `update_goal(status: complete)` 并确认原生终态；确认失败时下轮幂等重试 completion bridge，不重跑已经完成的本地 DAG。

Owner 是稳定逻辑责任域，Agent 或子线程只是软亲和执行载体。runtime 为每次新建下发 canonical `executor_spawn_name`，协调器不得自行重算；正确性只依赖 `.ghost-agent-workflow/` 中的持久状态。Codex 执行单元固定使用 `gpt-5.6-sol/medium`，独立 audit 使用不同 Owner，不同 Goal 不复用执行单元。

`.ghost-agent-workflow/` 是本地 runtime state，不应提交到版本库。
