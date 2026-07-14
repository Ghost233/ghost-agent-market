---
name: thread-coordination
description: 仅当用户为当前已校验的 Claude Code v3 任务 DAG 明确选择执行线程模式并明确要求执行，或恢复 state 已锁定为 thread 的同一 parent_goal 时使用；普通任务、仅规划请求、未选择执行方式或选择子代理模式时不得触发。
---

# 任务协调

## 职责

主会话是只读协调器：执行 DAG 调度、创建或复用执行单元、回收结果、触发当前任务内修订并完成总验收。不得修改业务文件、暂存、提交或推送代码；所有正式实施、审查和验证都必须是 DAG task。所有创建的执行单元保留，不自动关闭。

本 skill 只负责执行线程模式。执行开始前必须把 state 锁定为 `thread`；同一 `parent_goal` 已选择其他执行方式时不得接管或转换。

初次进入时不得根据任务复杂度、DAG 拓扑或缺省习惯推断执行线程模式。必须具有用户对当前计划的明确执行授权和唯一模式选择；同一 `parent_goal` 的后继 revision 继承已锁定模式和既有授权，可直接恢复。

每个通过初始规划门禁的任务对应新的 `parent_goal`。执行单元只在当前父目标内归属 `(module_id, thread_role)`：首次派发创建，后续 task 和 revision 复用；不得查询或复用其他父目标的执行单元。计划不预生成执行单元路由，`next` 只返回统一的 `dispatch_task`。

本 skill 由 `opus/max` 主会话执行；执行单元默认使用 `sonnet/max`，实际配置以 module 中固定的 `worker_profile` 为准。

创建、绑定或验收前读取本 skill 的 [references/templates.md](references/templates.md) 和 `$thread-goal-worker` 的 `references/templates.md`。后者是分派包、结果和补修契约的唯一规范来源。

## 入口

1. 用户已为当前计划明确选择执行线程模式并要求执行，或者 state 已在同一 `parent_goal` 中锁定为 `thread`。仅完成规划、未选择模式、“都可以”或“你决定”都不构成入口授权。
2. `plan_path` 位于当前项目 `.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json`，使用 `planner: parallel-task-planner`、`plan_format_version: 3` 和 `execution_platform: claude_code`。
3. `safety.status` 为 `parallel_safe` 或 `sequential_only`；两者都可执行。`needs_user_review` 才暂停。
4. 运行：

```text
node <plugin-root>/scripts/thread-plan.mjs validate <plan_path>
node <plugin-root>/scripts/thread-plan.mjs mode <plan_path> <state_path> thread
```

校验失败时保留原始错误，交 `$parallel-task-planner` 修正当前候选，不手改机器字段。进入 revision 时若缺少对应 `plan_digest` marker 或 Mermaid，补运行一次 `render` 展示后立即继续。

## 执行循环

1. 读取 plan 和 state。已有 `running` task 时先回收，不因上下文中断询问用户。
2. 运行：

```text
node <plugin-root>/scripts/thread-plan.mjs next <plan_path> <state_path>
```

3. 立即处理返回的全部 `dispatch_task`。不同 `module_id + thread_role` 的 ready task 全部并行；同一归属已由 DAG 保证串行。`sequential_only` 使用同一循环，自然一次推进一个 task。
4. 为每个 task 按“执行单元选择”取得真实 id，显示 `[待命]` 名称，再运行：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> running <thread_id>
```

5. 发送唯一完整分派包；成功后显示 `[执行]`。分派首次失败只向同一执行单元重发一次，不创建替代执行单元。
6. 低频批量回收结果。运行中不是失败，不发送追问或转发过程信息。
7. 校验执行单元原子写入的 `WORKER_RESULT_V3`，再运行：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> completed|blocked|failed|needs_main_review <result_path>
```

8. 每次状态变化后回到 `next`，直到进入内部修订或总验收。

## 执行单元选择

`next` 已按当前 `parent_goal` 内的 `module_id + thread_role` 归属给出唯一决议：

1. action 的 `thread_id` 非空时，复用该执行单元。
2. action 的 `thread_id` 为 `null` 时，使用 module 初始固定的 `worker_profile` 创建执行单元。

执行单元选择只服从 `next`；协调器不手工扫描 plan 链，也不跨 `parent_goal` 搜索。执行单元 id 与归属冲突、仍有活动 task 或不可读取时停止分派并返回 `dispatch_failed`，不猜测、不另建。

`dispatch_key = <plan_path>#<task_id>` 只用于当前 task 的创建幂等。创建前使用平台可用的列表或查询能力查找该 key：唯一匹配则恢复，零匹配才创建，多个匹配则停止。创建结果不明确时再查一次；仍为零匹配时以相同配置重试创建一次。

## 命名

统一格式：

```text
[GA][<用途>][<状态>] <logical_id> · <title>
```

用途固定映射为 `work -> 实施`、`review -> 审查`、`verify -> 验证`。状态固定为 `待命`、`执行`、`补修`、`完成`、`复核`、`阻塞` 或 `失败`。复用执行单元时只替换当前 task 的 logical id、标题和状态；命名失败只记录警告。

## 结果与补修

只接受与当前 `task_id`、`logical_id`、`module_id`、`thread_role`、`thread_id` 和 `result_path` 一致的结果。终态 result 必须由 driver 校验并内嵌进 state；不得根据消息摘要补造。

字段缺失、验证不足或普通差异自检失败时，只向原执行单元发送一次 `WORKER_REPAIR_V3`。合法 `scope_request` 直接记录为 `needs_main_review`；审查发现缺陷和验证发现源码失败都保留原始证据，交下一 revision 处理。单个 task 失败只阻塞其后继，不影响无关分支。

## 当前任务内修订

当 actions 为空且没有 `running` 时到达静止点。若存在范围变化、失败、审查缺陷或总验收缺口，一次聚合当前 revision 的全部结果，调用 `$parallel-task-planner` 生成唯一下一 revision。新计划通过校验后，直接前版只保留为结果证据，不再运行 `next` 或 `update`；展示 Mermaid 后从新 revision 自动继续，不要求用户确认。

只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部副作用、权限升级或无法安全消歧时才暂停询问用户。

## 总验收

只有当前 revision 的所有 task 都是 `completed` 且具有合法 result，才汇总 `project_verification`、各 task 证据和最终差异。正式 build、test、lint 和审查必须来自 DAG task，主会话不临时重复执行。通过后按模板返回 `PARALLEL_PLAN_RESULT.status: completed`。

对用户只报告启动、必要的 revision 摘要、最终结果或真实用户边界，不逐 task 播报。
