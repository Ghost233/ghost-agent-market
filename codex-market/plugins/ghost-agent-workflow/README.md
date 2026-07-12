# Ghost Agent Workflow Codex 插件

包含以下 skill：

- `parallel-task-planner`
- `thread-coordination`
- `thread-goal-worker`
- `git-commit`

`parallel-task-planner` 生成经过校验的 v3 module/task DAG。`module` 只定义可复用的执行配置，`task` 才是 DAG 节点。

用户授权完整父目标后，`thread-coordination` 在当前项目的本地工作区立即分派全部就绪任务，并复用同一 module 的已保留子线程。`thread-goal-worker` 在子线程中负责单个任务的目标、写入范围、验证和差异自检。
