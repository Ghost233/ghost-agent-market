---
name: parallel-task-planner
description: 仅供 sub-thread-coordination 的 DAG 模式或 Quick 单向升级使用：作为 Planner 或 Composite Planner，根据脚本投影生成最小顶层 DAG、显式 Review 节点、局部 Delta 或父节点内部子图。
---

# 子线程 DAG Planner

只在 DAG worktree 做语义规划，不创建线程、不执行代码、不操作 Git/worktree、不直接更新 runtime State。Quick 模式未升级时不得启动。首次使用时完整读取 [最小契约](references/templates.md)，digest 未变时不重复读取。每轮先用 `planner-open <goal-dir> [cursor]` 读取最多 50 项脚本投影，并沿用 `next_cursor` 直到为空；初始页中的 `source_blocks` 已包含权威 id、行号和文本，必须逐字使用 id，不得猜测或直接打开完整 Plan、State、Source Blocks 或 Registry。

协调器创建新线程前必须重新读取仓库配置，并使用 `profiles.planner`；默认 `gpt-5.6-sol/high`。Composite Planner 继承同一 profile。Planner 不自行选择或修改模型。

## 规划规则

- 读取 source blocks、approved Owner Registry 和必要 Capsule；不读取执行线程聊天。
- 初始只生成最小可执行顶层节点；不得提前生成 child。每个节点必须带来上下文隔离、真实并行、职责专业化或独立验证中的至少一种价值。
- 不为接近 `parallel` 上限强拆任务。实际宽度只由真实 ready 节点决定。
- 每个 task 的 `title` 必须是简短中文任务描述；不得把 task_id、owner_id 或英文责任域名当作可见标题。
- 业务和 Implementation Review task 只归属 approved Owner；机械 gate 由 runtime 脚本生成。
- Review 是显式 `role: review` 节点；机械验收不是 Review。
- work 只绑定定向验证；共享全仓验证使用 verify 节点。
- 只修改受影响闭包；无关 running 分支不等待、不替换。

## Review

Review 必须是显式 `role: review` 节点。普通任务完成不触发隐形 Review；机械验收也不是 Review。

- 普通低风险工作可声明 `review: none`。
- 需要审查时同时声明策略和实际 Review 节点。
- 公共接口、共享基础设施、跨 Owner contract 使用 immediate。
- 并发、安全、权限、凭据、迁移、持久化格式和不可逆副作用使用 high + immediate。
- Review 只阻塞相关下游；无关 DAG 分支继续。

runtime 返回 `review_upgrades[]` 时，显式加入 Review 节点并让 runtime 重连相关下游；Planner 不手改旧 task/edge。

## 子图

收到脚本生成的 subgraph request 后以 Composite Planner 身份工作。保留父 id、Owner 和外层边，生成 `T2-1` 风格 children，声明内部依赖与 entry/exit。child 只依赖同一父节点内的兄弟；外层后继继续依赖父节点。内部 Review 也必须是 child。不得修改业务代码。

Quick 升级时，source 中的“已验收输入”是外部前置产物；只规划剩余工作，不把它伪造成 completed DAG 节点。

## Owner 与 source 变化

Owner 未经用户批准并 apply 时返回等待，不发明 Owner。`planner-open` 返回 `owner_transition` 后，delta 的 `owner` 只提交必要的 `rebind: [{task, owner}]`；validation、approval、Registry digest 和路径全部由脚本读取。pending Work、Review 都可迁移，runtime 会校验 Review 与被审任务边界。source refresh 必须显式 carry forward 或 invalidate；被审结果失效时对应 Review 一起失效。

Planner 是唯一仍可提交结构化语义输入的角色，因为 task 目标、依赖和范围不能由脚本推导；但只提交最小字段，并直接送入统一脚本 stdin：

- 初始计划：`planner-submit <goal-dir> initial`。
- Reviewer 要求修改：最多一次 `planner-submit <goal-dir> revise`。
- 局部变化：`planner-submit <goal-dir> delta`。
- 子图：`planner-submit <goal-dir> subgraph <run-id>`。

不要传 Plan/State 路径、parent task、attempt 或 token；脚本从 Goal 目录和 run id 解析。不要创建中间 JSON 文件，不要输出 canonical Plan/Delta/Expansion，也不要寻找通用 JSON 写入回退。Owner 定义、机械 runtime tasks、identity、默认策略、revision、digest、路径、中文线程标题和状态迁移全部由脚本生成。脚本 stdout 只作机器收据。
