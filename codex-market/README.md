# Codex Marketplace

这个目录提供 Codex 可安装的 marketplace 条目：

- `ghost-agent-workflow`
- `rtk-hook`

`ghost-agent-workflow` 包含七个 skill：

- `goal-dag-runner`
- `parallel-task-planner`
- `thread-coordination`
- `thread-goal-worker`
- `subagent-coordination`
- `subagent-goal-worker`
- `git-commit`

## 推荐入口

```text
/goal 每轮使用 $goal-dag-runner，以子代理 DAG 完整执行 `./plan.md`，直到计划项覆盖率 100% 且所有验收通过。
```

Codex 原生 `/goal` 提供持久外循环，显式 `$goal-dag-runner` 提供本地内循环。本地 `goal_id`/目录包含 `threadId + createdAt` 的稳定 SHA-256 短摘要，恢复时仍精确校验完整 instance 与 objective digest；相同 objective 的不同 instance 不会互相覆盖。首次运行先冻结工作区 baseline、生成 `SOURCE_BLOCKS_V1`；coverage 按 source refs × implementation/verification effects 计算，独立 source audit 在 work 前证明无遗漏，最终 diff audit 由 runtime 扫描 baseline 与真实工作区并固化 artifact digest。插件不调用 `create_goal`，不重写原生 objective，也不生成 continuation prompt。只有本地 `finalize` 得到硬终态，才以 fresh `get_goal` 校验同一 instance、调用 `update_goal(status: complete)`，再用同一 token `native-confirm`。

DAG 已耗尽但 required effect coverage 仍低于 100% 时进入 `needs_delta`。`status`/`reconcile` 为 active reservation 重建完整 canonical binding，崩溃恢复不依赖聊天记忆。source drift 先 drain active reservation，再事务刷新 source/blocks/coverage/state；invalidated task 的当前 Capsule evidence 被清除。结果按 task attempt 独立保存，并受 source revision、attempt、reservation token、Owner generation 和 artifact digest fencing 约束。

Owner 是稳定的逻辑责任域，Agent 只是软亲和执行载体。runtime 为 spawn 下发 canonical `executor_spawn_name`，协调器不得自行生成；正确性只依赖持久状态，不依赖 Agent 会话记忆。Codex 子代理和子线程固定使用 `gpt-5.6-sol/medium`，不同 Goal 不复用 Agent。

`.ghost-agent-workflow/` 只保存本地 runtime state，不应提交；请在使用插件的项目中将它加入 `.gitignore`。

`git-commit` 使用只读 `git_commit_worker` 分析 checkout，再由主线程完成 Git 写入。`rtk-hook` 对未通过 `rtk` 前缀执行的 shell 命令给出重试提示。

## 安装

```bash
codex plugin marketplace add Ghost233/ghost-agent-market --sparse codex-market
codex plugin add ghost-agent-workflow@ghost-agent-market
codex plugin add rtk-hook@ghost-agent-market
```

安装 `rtk-hook` 后，开启新的 Codex 线程并通过 `/hooks` 信任 `RTK Hook`。
