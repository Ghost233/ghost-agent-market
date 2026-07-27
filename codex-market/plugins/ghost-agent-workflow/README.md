# Ghost Agent Workflow Codex 插件

包含五个 skill：`subagent-coordination`、`parallel-task-planner`、`subagent-goal-worker`、`git-commit` 和 Codex App 专用的 `git-commit-direct-model-test`。前三者组成 subagent-only Goal DAG；最后一个只读、严格串行探测四种直接模型与执行载体组合。

Codex 推荐入口只有这一行：

```text
/goal 每轮使用 $subagent-coordination，完整执行 `./plan.md`。
```

原生 `/goal` 是持久外循环；`$subagent-coordination` 生成 `GOAL_CONTRACT_V1`、coverage 与 `DAG_PLAN_V5`。Owner 是仓库级永久模块；三个机械 runtime actor 与 Owner 分离，仓库级 lease 防止跨 Goal 并发占用。首次显示完整 DAG，后续默认显示 delta diff；Goal/Plan/runtime 不进 Git，交付由 Owner attestation 与 `DELIVERY_MANIFEST_V1` 驱动。

首次 `goal-validate` 会冻结 `WORKTREE_BASELINE_V1` 并生成 `SOURCE_BLOCKS_V1`。planner 为每个 plan item 写 source refs 和 required effects，task 用 `coverage_effect` 精确覆盖；独立 source audit 必须先于所有 work，最终 diff audit 由 runtime 扫描 baseline、真实工作区与 accepted results，两个 artifact 都用 SHA-256 绑定。

每轮恢复先 `reconcile` 再 reserve；`status`/`reconcile` 为每个 active reservation 返回完整 canonical binding 与 action/phase，使 spawn/bind/send 崩溃后无需聊天记忆或自行重算。source drift 时停止 reserve、drain active reservation，再事务刷新 source revision、blocks、coverage/state 与 Capsule；invalidated task 的当前证据不可沿用。DAG 耗尽但 required effect coverage 不足 100% 时返回 `needs_delta`。

只有 coverage 达到 100%、当前 revision 的 task 与 required gate 证据全部有效，且其它 completion invariant 均成立时，`finalize` 才返回 `completed`。skill 随后只执行 `update_goal(status: complete)` 并确认原生终态；确认失败时下轮幂等重试 completion bridge，不重跑已经完成的本地 DAG。

Owner 是仓库级、跨 Goal 永久存在的代码功能模块主体。模块开发、查找资料、审查、修复和建议都只能由同一 Owner 完成，其他 Owner 只能消费它发布的接口或结论；纯 source/diff audit 使用无代码 scope 的机械 runtime actor，不创建 Owner。Agent 只是可替换执行载体，Codex 子代理固定使用 `gpt-5.6-sol/high`，不同 Goal 不复用物理 Agent。

只持久化并提交 `.ghost-agent-workflow/owners/**`；`.ghost-agent-workflow/runtime/**` 下的 Goal、Plan、coverage、delta、reservation、result、artifact 和 session Capsule 都是临时状态，不应提交。Owner 新增或分裂必须先由脚本验证 scope 冲突，再取得用户对精确 digest 的明确批准。
