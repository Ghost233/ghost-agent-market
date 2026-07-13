---
name: thread-coordination
description: 当用户已授权执行通过校验的 Codex v3 任务 DAG，需要由主线程在当前 parent_goal 内复用 module+role 子线程、推进全部 ready task 并一次性完成父目标时使用。
---

# 任务协调

## 职责

主线程是只读协调器：执行 DAG 调度、创建或复用子线程、回收结果、触发当前任务内修订并完成总验收。不得修改业务文件、暂存、提交或推送代码；所有正式实施、审查和验证都必须是 DAG task。所有创建的子线程保留，不自动归档。

本 skill 只负责子线程模式。执行开始前必须把 state 锁定为 `thread`；同一 `parent_goal` 已选择其他执行方式时不得接管或转换。

每次顶层任务都是新的 `parent_goal`。线程只在当前父目标内归属 `(module_id, thread_role)`：首次派发创建，后续 task 和 revision 复用；不得查询或复用其他父目标的线程。计划不预生成线程路由，`next` 只返回统一的 `dispatch_task`。

本 skill 由 `gpt-5.6-sol/xhigh` 主线程执行；子线程默认使用 `gpt-5.6-terra/medium`，实际配置以 module 中固定的 `worker_profile` 为准。

创建、绑定或验收前读取本 skill 的 [references/templates.md](references/templates.md) 和 `$thread-goal-worker` 的 `references/templates.md`。后者是绑定包、结果和补修契约的唯一规范来源。

## 入口

1. 用户以执行意图提交的完整任务已经授权整个 `parent_goal`；只有明确要求只规划或只讨论时不执行。
2. `plan_path` 位于当前项目 `.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json`，使用 `planner: parallel-task-planner`、`plan_format_version: 3` 和 `execution_platform: codex`。
3. `safety.status` 为 `parallel_safe` 或 `sequential_only`；两者都可执行。`needs_user_review` 才暂停。
4. 使用 `list_projects` 唯一解析当前目录，并固定 `environment: {type: local}`。
5. 运行：

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
4. 为每个 task 按“线程选择”取得真实 `thread_id`，设置 `[待命]` 标题，再运行：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> running <thread_id>
```

5. 使用 `send_message_to_thread` 发送唯一完整绑定包；成功后把标题更新为 `[执行]`。绑定首次失败只向同一线程重发一次，不创建替代线程。
6. 使用 `read_thread(includeOutputs: true)` 低频批量读取结果。线程运行中不是失败，不发送追问或转发过程信息。
7. 校验线程原子写入的 `WORKER_RESULT_V3`，再运行：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> completed|blocked|failed|needs_main_review <result_path>
```

8. 每次状态变化后回到 `next`，直到进入内部修订或总验收。

## 线程选择

`next` 已按当前 `parent_goal` 内的 `module_id + thread_role` 归属给出唯一决议：

1. action 的 `thread_id` 非空时，复用该线程。
2. action 的 `thread_id` 为 `null` 时，使用 module 初始固定的 `worker_profile` 创建线程。

线程选择只服从 `next`；协调器不手工扫描 plan 链，也不跨 `parent_goal` 搜索。线程 id 与归属冲突、线程仍有活动 task 或线程不可读取时停止分派并返回 `dispatch_failed`，不猜测、不另建。

`dispatch_key = <plan_path>#<task_id>` 只用于当前 task 的创建幂等。创建前用 `list_threads(query=<dispatch_key>)` 查找：唯一匹配则恢复，零匹配才调用 `create_thread`，多个匹配则停止。创建结果不明确时再查一次；仍为零匹配时以相同配置重试创建一次。

## 命名

统一调用 `set_thread_title`，格式：

```text
[GA][<用途>][<状态>] <logical_id> · <title>
```

用途固定映射为 `work -> 实施`、`review -> 审查`、`verify -> 验证`。状态固定为 `待命`、`执行`、`补修`、`完成`、`复核`、`阻塞` 或 `失败`。复用线程时只替换当前 task 的 logical id、标题和状态；命名失败只记录警告。

## 结果与补修

只接受与当前 `task_id`、`logical_id`、`module_id`、`thread_role`、`thread_id` 和 `result_path` 一致的结果。终态 result 必须由 driver 校验并内嵌进 state；不得根据聊天摘要补造。

字段缺失、验证不足或普通差异自检失败时，只向原线程发送一次 `WORKER_REPAIR_V3`。合法 `scope_request` 直接记录为 `needs_main_review`；审查发现缺陷和验证发现源码失败都保留原始证据，交下一 revision 处理。单个 task 失败只阻塞其后继，不影响无关分支。

## 当前任务内修订

当 actions 为空且没有 `running` 时到达静止点。若存在范围变化、失败、审查缺陷或总验收缺口，一次聚合当前 revision 的全部结果，调用 `$parallel-task-planner` 生成唯一下一 revision。新计划通过校验后，直接前版只保留为结果证据，不再运行 `next` 或 `update`；展示 Mermaid 后从新 revision 自动继续，不要求用户确认。

只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部副作用、权限升级或无法安全消歧时才暂停询问用户。

## 总验收

只有当前 revision 的所有 task 都是 `completed` 且具有合法 result，才汇总 `project_verification`、各 task 证据和最终差异。正式 build、test、lint 和审查必须来自 DAG task，主线程不临时重复执行。通过后按模板返回 `PARALLEL_PLAN_RESULT.status: completed`。

对用户只报告启动、必要的 revision 摘要、最终结果或真实用户边界，不逐 task 播报。
