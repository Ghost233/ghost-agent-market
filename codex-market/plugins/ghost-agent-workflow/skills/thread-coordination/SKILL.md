---
name: thread-coordination
description: 仅当用户已明确选择子线程模式并授权执行通过校验的 Codex v3 任务 DAG，或恢复 executor_mode 已锁定为 thread 的同一 parent_goal 时使用；所有新建子线程固定使用 gpt-5.6-sol/medium，只规划请求或未明确执行方式时不得使用。
---

# 任务协调

## 职责

主线程是只读协调器：执行 DAG 调度、创建或复用子线程、回收结果、触发当前任务内修订并完成总验收。不得修改业务文件、暂存、提交或推送代码；所有正式实施、审查和验证都必须是 DAG task。所有创建的子线程保留，不自动归档。

本 skill 只负责子线程模式。初次执行必须有用户明确且唯一的子线程选择和规划后执行授权，不能把空模式默认成 `thread`。后继 revision 或中断恢复可以沿用 state 中已锁定的 `thread`；同一 `parent_goal` 已选择其他执行方式时不得接管或转换。

每个通过初始规划门禁的任务对应新的 `parent_goal`。线程只在当前父目标内归属 `(module_id, thread_role)`：首次派发创建，后续 task 和 revision 复用；不得查询或复用其他父目标的线程。计划不预生成线程路由，`next` 只返回统一的 `dispatch_task`。

本 skill 创建的全部子线程固定使用 `gpt-5.6-sol/medium`。这是 Codex 平台专属的子线程运行约束；module 中固定的 `worker_profile` 必须精确匹配，不得省略、继承主线程配置、静默降级或改用其他 profile。

每次进入 coordination 时只读取一次本 skill 的 [references/templates.md](references/templates.md) 和 `$thread-goal-worker` 的 `references/templates.md`；模板文件未变化时不得按 task 重读。后者是绑定包、结果和补修契约的唯一规范来源。

## 入口

1. 初次进入时，用户已明确选择子线程并要求规划后执行；仅要求规划、模式缺失或选择含糊时停止，不调用 `mode`。恢复同一 `parent_goal` 时，state 的 `executor_mode` 必须已经是 `thread`。
2. `plan_path` 位于当前项目 `.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json`，使用 `planner: parallel-task-planner`、`plan_format_version: 3` 和 `execution_platform: codex`。
3. `safety.status` 为 `parallel_safe` 或 `sequential_only`；两者都可执行。`needs_user_review` 才暂停。
4. 每个 task 的 `title` 必须至少包含一个中文汉字并能直接说明当前工作；英文内部标识不能代替任务名称。
5. 每个 module 的 `worker_profile` 必须精确等于 `model: gpt-5.6-sol` 和 `reasoning_effort: medium`；不匹配时返回 `executor_mode_mismatch`，不得创建或复用线程。
6. 使用 `list_projects` 唯一解析当前目录，并固定 `environment: {type: local}`。
7. 运行：

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
6. 使用 `wait_threads` 对全部活动线程做低频批量等待并携带各自 cursor。线程运行中不是失败，不发送追问或转发过程信息；原子写入的 `result_path` 才是结果事实来源。
7. 某次等待快照出现终态时，只读取其 `status` 和 `result_path`，把当前快照中已就绪的终态逐一交给 driver：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> completed|blocked|failed|needs_main_review <result_path>
```

8. `update` 是结果结构、身份和范围的唯一机械裁决。若它返回具体契约错误，只把原始错误发送给对应线程做最多一次 `WORKER_REPAIR_V3`，不得先人工重复校验全部字段。
9. 当前快照的已就绪终态全部 `update` 后只调用一次 `next`；不等待仍在运行的并行兄弟，因此每个已完成结果都能立即放行后继。持续循环直到进入内部修订或总验收。

## 线程选择

`next` 已按当前 `parent_goal` 内的 `module_id + thread_role` 归属给出唯一决议：

1. action 的 `thread_id` 非空时，复用该线程。
2. action 的 `thread_id` 为 `null` 时，显式使用 `model: gpt-5.6-sol` 和 `thinking: medium` 创建线程，并把该调用参数作为 profile evidence。

线程选择只服从 `next`；协调器不手工扫描 plan 链，也不跨 `parent_goal` 搜索。复用线程必须具有当前父目标内记录的 `create_thread:gpt-5.6-sol/medium` profile evidence。线程 id 与归属冲突、profile 不匹配、线程仍有活动 task 或线程不可读取时停止分派并返回 `dispatch_failed`，不猜测、不另建。

`dispatch_key = <plan_path>#<task_id>` 只用于当前 task 的创建幂等。创建前用 `list_threads(query=<dispatch_key>)` 查找：唯一匹配则恢复，零匹配才调用 `create_thread`，多个匹配则停止。创建结果不明确时再查一次；仍为零匹配时以相同配置重试创建一次。

## 命名

统一调用 `set_thread_title`，格式：

```text
[GA][<用途>][<状态>] <中文任务名>
```

用途固定映射为 `work -> 实施`、`review -> 审查`、`verify -> 验证`。状态固定为 `待命`、`执行`、`补修`、`完成`、`复核`、`阻塞` 或 `失败`。中文任务名取当前 task 的 `title`；不得显示 `logical_id`、`module_id` 或其他英文内部标识。复用线程时只替换当前任务名和状态；命名失败只记录警告。

## 结果与补修

只接受与当前 `task_id`、`logical_id`、`module_id`、`thread_role`、`thread_id` 和 `result_path` 一致的结果。终态 result 必须由 driver 校验并内嵌进 state；不得根据聊天摘要补造。

driver 判定字段缺失、验证不足或普通差异自检失败时，只向原线程发送一次 `WORKER_REPAIR_V3`。合法 `scope_request` 直接记录为 `needs_main_review`；review 的非阻断建议随 `completed` 汇报且不触发 revision，只有阻断缺陷使用 `needs_main_review`。验证发现源码失败保留原始证据，交下一 revision 处理。单个 task 失败只阻塞其后继，不影响无关分支。

work 的 task verification 与 `diff_self_check` 是默认闭环。协调器只消费计划已有的风险触发 review 和未覆盖集成 verify，不得因缺少独立审查而补造 task，也不得让 verify 重复 work verification。review 与 verify 同时存在时按计划作为共同 work 后的并列节点推进。

## 当前任务内修订

当 actions 为空且没有 `running` 时到达静止点。若存在范围变化、失败、阻断缺陷或总验收缺口，一次聚合当前 revision 的全部结果，调用 `$parallel-task-planner` 生成唯一下一 revision。非阻断建议不进入修订条件。新计划通过校验后，直接前版只保留为结果证据，不再运行 `next` 或 `update`；后继 revision 继承当前 `thread` 模式和执行授权，展示 Mermaid 后自动继续，不要求用户重新选择。

只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部副作用、权限升级或无法安全消歧时才暂停询问用户。

## 总验收

只有当前 revision 的所有 task 都是 `completed` 且具有合法 result，才汇总 `project_verification`、各 task 证据和最终差异。总验收优先消费 work 默认闭环，只消费计划已有的独立 review/verify；主线程不得临时补造审查、重复 work verification 或重复执行已有检查。通过后按模板返回 `PARALLEL_PLAN_RESULT.status: completed`。

对用户只报告启动、必要的 revision 摘要、最终结果或真实用户边界，不逐 task 播报。
