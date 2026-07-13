# Claude Code Market

这个目录提供 Claude Code 可安装插件，包含以下六个 skill：

- `parallel-task-planner`
- `thread-coordination`
- `thread-goal-worker`
- `subagent-coordination`
- `subagent-goal-worker`
- `git-commit`

`parallel-task-planner` 只生成一份 v3 module/task DAG。执行时可以选择执行线程模式，也可以选择子代理模式；子代理模式不指定模型或思考强度。

## 安装

在 Claude Code 里添加远程 marketplace：

```text
/plugin marketplace add Ghost233/ghost-agent-market --sparse claude-code-market
```

安装插件：

```text
/plugin install ghost-agent-workflow@ghost-agent-market
```
