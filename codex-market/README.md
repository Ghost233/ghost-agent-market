# Codex Marketplace

这个目录提供 Codex 可安装的 marketplace 条目：

- `ghost-agent-workflow`
- `rtk-hook`

`ghost-agent-workflow` 包含五个 skill：

- `parallel-task-planner`
- `subagent-coordination`
- `subagent-goal-worker`
- `git-commit`
- `git-commit-direct-model-test`

## 推荐入口

```text
/goal 每轮使用 $subagent-coordination，以子代理 DAG 完整执行 `./plan.md`，直到计划项覆盖率 100% 且所有验收通过。
```

Codex 原生 `/goal` 提供持久外循环，`$subagent-coordination` 使用 `DAG_PLAN_V5`。模块 Owner 跨 Goal 永久存在并受仓库级 lease 互斥；source/diff/commit-readiness 是独立机械 actor。runtime 自动计算 task changed files、用 workspace sequence 管理证据新鲜度，并生成 Owner attestations 驱动的 delivery manifest。

DAG 已耗尽但 required effect coverage 仍低于 100% 时进入 `needs_delta`。`status`/`reconcile` 为 active reservation 重建完整 canonical binding，崩溃恢复不依赖聊天记忆。source drift 先 drain active reservation，再事务刷新 source/blocks/coverage/state；invalidated task 的当前 Capsule evidence 被清除。结果按 task attempt 独立保存，并受 source revision、attempt、reservation token、Owner generation 和 artifact digest fencing 约束。

Owner 是仓库级、跨 Goal 永久存在的代码功能模块主体；同一模块的开发、资料查找、审查、修复和建议永远回到同一 Owner，其他 Owner 不得读取其内部代码。Agent 只是可替换执行载体；执行模式固定为 `subagent`，Codex 子代理固定使用 `gpt-5.6-sol/high`，不同 Goal 不复用物理 Agent。

只持久化并提交 `.ghost-agent-workflow/owners/**`；`.ghost-agent-workflow/runtime/**` 是临时执行状态，应加入 `.gitignore`。Owner 新增或分裂必须经脚本冲突验证和用户对精确 digest 的明确批准。

`git-commit` 先按当前注册工具选择 `multi_agent_v1` 的 Spark/xhigh 或直接 `spawn_agent` 的 Sol/high，只运行一个只读分析子代理，再由主线程完成 Git 写入。`rtk-hook` 对未通过 `rtk` 前缀执行的 shell 命令给出重试提示。

`git-commit-direct-model-test` 是 Codex App 专用的只读运行时探测：严格串行直接测试 `spawn_agent` / `create_thread` 与 Spark / Luna 的四种组合，不读取自定义 agent 定义。

## 安装

```bash
codex plugin marketplace add Ghost233/ghost-agent-market --sparse codex-market
codex plugin add ghost-agent-workflow@ghost-agent-market
codex plugin add rtk-hook@ghost-agent-market
```

安装 `rtk-hook` 后，开启新的 Codex 线程并通过 `/hooks` 信任 `RTK Hook`。
