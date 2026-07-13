# Ghost Agent Workflow Codex 插件

包含以下 skill：

- `parallel-task-planner`
- `thread-coordination`
- `thread-goal-worker`
- `subagent-coordination`
- `subagent-goal-worker`
- `git-commit`

`parallel-task-planner` 生成经过校验的 v3 module/task DAG。`module` 只定义可复用的执行配置，`task` 才是 DAG 节点。

用户授权完整父目标后，可以选择 `thread-coordination` 的可见子线程模式，也可以选择 `subagent-coordination` 的子代理模式。两者消费同一份计划，并只在本次父目标内复用相同 module+role 的执行单元；新的顶层任务不会复用旧执行单元。

`thread-goal-worker` 和 `subagent-goal-worker` 分别在对应执行方式下负责单个任务的目标、写入范围、验证和差异自检。子代理模式不指定模型或思考强度。
