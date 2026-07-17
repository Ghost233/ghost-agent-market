# Codex Marketplace

这个目录提供 Codex 可安装的 marketplace 条目，包含：

- `ghost-agent-workflow`
- `rtk-hook`

`ghost-agent-workflow` 包含以下六个 skill：

- `parallel-task-planner`
- `thread-coordination`
- `thread-goal-worker`
- `subagent-coordination`
- `subagent-goal-worker`
- `git-commit`

只有用户已经完成当前任务说明、明确要求对该任务进行 DAG 或并行规划，并且唯一选择子线程或子代理执行方式时，`parallel-task-planner` 才生成 v3 module/task DAG。任务不必预先包含验收标准；背景介绍、设想、尚未说完或准备继续补充的需求，以及普通实施请求都不会自动触发规划。执行方式没有默认值。

选择子线程时，任务保留在侧边栏；选择子代理时，不创建独立可见线程，并固定使用 `gpt-5.6-terra/xhigh`。两种方式共享当前项目工作区和同一份 DAG。协调器和 worker 只由经过授权的计划内部调用，不是独立的用户入口。

`rtk-hook` 基于 `Ghost233/rtk-hook`，通过 PreToolUse hook 对未通过 `rtk` 前缀执行的 shell 命令给出重试提示。

## 安装

把远程 marketplace 添加到 Codex：

```bash
codex plugin marketplace add Ghost233/ghost-agent-market --sparse codex-market
```

安装插件：

```bash
codex plugin add ghost-agent-workflow@ghost-agent-market
codex plugin add rtk-hook@ghost-agent-market
```

安装 `rtk-hook` 后，开启新的 Codex 线程并通过 `/hooks` 信任 `RTK Hook`。

Marketplace 文件位置：

```text
.agents/plugins/marketplace.json
```
