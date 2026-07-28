---
name: parallel-task-planner
description: 仅供 sub-thread-coordination 内部使用：作为 Planner 或 Composite Planner，根据已验证 Goal/source/Owner 输入生成顶层 DAG、局部 Delta、显式 Review 节点或父节点内部子图。普通规划和已绑定 Worker task 不得触发。
---

# 子线程 DAG Planner

只做语义规划，不创建线程、不执行代码、不更新 runtime State。首次使用时完整读取 [最小契约](references/templates.md)，digest 未变时不重复读取。

协调器创建新线程前必须重新读取仓库配置，并使用 `profiles.planner`；默认 `gpt-5.6-sol/high`。Composite Planner 继承同一 profile。Planner 不自行选择或修改模型。

## 规划规则

- 读取 source blocks、approved Owner Registry 和必要 Capsule；不读取执行线程聊天。
- 初始只生成稳定的顶层节点，进入父 task 后再懒加载子图。
- 每个 task 的 `title` 必须是简短中文任务描述；不得把 task_id、owner_id 或英文责任域名当作可见标题。
- 业务和 Implementation Review task 只归属 approved Owner；机械 gate 由 runtime 脚本生成。
- Review 是显式 `role: review` 节点；机械验收不是 Review。
- work 只绑定定向验证；共享全仓验证使用 verify 节点。
- 只修改受影响闭包；无关 running 分支不等待、不替换。

## Review

- 普通局部修改：batch。
- 公共接口、共享基础设施、跨 Owner contract：immediate。
- 并发、安全、权限、凭据、迁移、持久化格式、不可逆副作用：high + immediate。
- 纯文档或确定性脚本产物：final_only 或 none。

runtime 返回 `review_upgrades[]` 时，`DAG_DELTA_INPUT_V1.review[]` 只写 `task + review_task + reason`，并在 `tasks` 放入精简 Review 节点。runtime 自动升级策略和重连下游；Planner 不手改旧 task/edge。

## 子图

收到脚本生成的 subgraph request 后以 Composite Planner 身份工作。保留父 id、Owner 和外层边，生成 `T2-1` 风格 children，声明内部依赖与 entry/exit。child 只依赖同一父节点内的兄弟；外层后继继续依赖父节点。内部 Review 也必须是 child。不得修改业务代码。

## Owner 与 source 变化

Owner 未经用户批准并 apply 时返回等待，不发明 Owner。批准后 delta 只包含必要 pending task rebindings。source refresh 必须显式 carry forward 或 invalidate；被审结果失效时对应 Review 一起失效。

只输出精简语义输入：

- 初始计划：`PLAN_INPUT_V1`，只含 `items`、`tasks` 和可选 safety，送入 `plan-create` 形成 draft。
- Planner Reviewer 要求修改：最多一次把新的 `PLAN_INPUT_V1` 送入 `plan-revise`。
- 局部变化：`DAG_DELTA_INPUT_V1`，只含变化的 `tasks/repairs/source/review/owner/items`，送入 `apply-delta ... -`。
- 子图：`TASK_SUBGRAPH_INPUT_V1`，只含 `children/entry/exit`，送入 `expand-subgraph ... -`。

不要输出 canonical Plan/Delta/Expansion，不调用 `json-write`。脚本 stdout JSON 只作机器收据，不复制到聊天。Owner 定义、机械 runtime tasks、identity、默认策略、revision、digest、路径、中文线程标题和状态迁移全部由脚本生成。
