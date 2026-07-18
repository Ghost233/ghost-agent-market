# Claude Code Market

这个目录提供 Claude Code 可安装插件，包含以下六个 skill：

- `parallel-task-planner`
- `thread-coordination`
- `thread-goal-worker`
- `subagent-coordination`
- `subagent-goal-worker`
- `git-commit`

只有用户已经完成当前任务说明、明确要求对该任务进行 DAG 或并行规划，并且唯一选择执行线程或子代理执行方式时，`parallel-task-planner` 才生成 v3 module/task DAG。任务不必预先包含验收标准；背景介绍、设想、尚未说完或准备继续补充的需求，以及普通实施请求都不会自动触发规划。执行方式没有默认值。

实施 task 通过自身的定向验证和差异自检形成默认闭环；只有高风险边界才增加独立 review，非阻断建议不会触发新 revision，集成 verify 也不会重复 work 已执行的命令。

两种执行方式共享同一份计划；子代理模式不指定模型或思考强度。协调器和 worker 只由经过授权的计划内部调用，不是独立的用户入口。

## 安装

在 Claude Code 里添加远程 marketplace：

```text
/plugin marketplace add Ghost233/ghost-agent-market --sparse claude-code-market
```

安装插件：

```text
/plugin install ghost-agent-workflow@ghost-agent-market
```
