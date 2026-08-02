---
description: 为当前 workflow action 选择一个对应的 ZCode role agent。
---

只处理 runtime receipt 指定的一个 bounded action，按下面映射选择一个 agent：

- 模式和 task package：`sub-thread-coordination`
- 最小 DAG、delta、subgraph：`parallel-task-planner`
- Plan 激活前审查：`planner-reviewer`
- 一个实现/验证 run：`sub-thread-goal-worker`
- 仓库 workflow 配置：`setup-sub-thread-workflow`
- 只读 DAG 看板：`start-dag-dashboard`

选中的 agent 必须先加载同名 skill，再执行该 skill 的固定流程。一次调用只返回一个 receipt；不得调用、等待或通知其他 agent，不得手写状态、JSON 或替代 task graph。

runtime 是 workflow 状态的唯一写入者。receipt 过期、输入缺失或 runtime 失败时停止并返回原始结果，由主 ZCode Agent 决定是否开始下一次独立 action。
