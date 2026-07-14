# Ghost Agent Workflow Codex 插件

包含以下 skill：

- `parallel-task-planner`
- `thread-coordination`
- `thread-goal-worker`
- `subagent-coordination`
- `subagent-goal-worker`
- `git-commit`

只有用户已经完成当前任务说明、明确要求对该任务进行 DAG 或并行规划，并且唯一选择子线程或子代理执行方式时，`parallel-task-planner` 才生成经过校验的 v3 module/task DAG。任务不必预先包含验收标准；背景介绍、设想、尚未说完或准备继续补充的需求，以及普通实施请求都不会自动触发规划。执行方式没有默认值。

`module` 只定义可复用的执行配置，`task` 才是 DAG 节点。

用户明确选择后，可以使用 `thread-coordination` 的可见子线程模式，或 `subagent-coordination` 的子代理模式。两者消费同一份计划，并只在本次父目标内复用相同 module+role 的执行单元；新的顶层任务不会复用旧执行单元。

`thread-goal-worker` 和 `subagent-goal-worker` 分别在对应执行方式下负责单个任务的目标、写入范围、验证和差异自检。协调器和 worker 只由经过授权的计划内部调用，不是独立的用户入口。子代理模式不指定模型或思考强度。
