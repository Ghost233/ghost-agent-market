---
name: subagent-coordination
description: 仅当用户已明确选择子代理模式并授权执行通过校验的 Codex v3 任务 DAG，或恢复 executor_mode 已锁定为 subagent 的同一 parent_goal 时使用；只规划请求或未明确执行方式时不得使用。
---

# 子代理任务协调

## 职责

主线程是业务只读协调器：消费 `$parallel-task-planner` 生成的同一份 v3 plan，推进 DAG、创建或复用子代理、回收结果、触发当前任务内修订并完成总验收。可以通过 driver 写 plan/state/result 协调元数据，但不得修改业务文件、暂存、提交或推送代码；所有正式实施、审查和验证都必须是 DAG task。

进行子代理生命周期操作时只使用 `list_agents`、`spawn_agent`、`followup_task` 和 `wait_agent`。driver 命令与协调元数据读写不受此列表限制。不得调用 `create_thread`、`fork_thread`、`list_threads`、`read_thread`、`send_message_to_thread` 或标题/归档工具。调用 `spawn_agent` 时不得传入模型、思考强度或推理参数；子代理使用平台默认配置。

计划中的 `worker_profile` 只供子线程模式使用。本 skill 不读取、不校验、不传递该字段，也不把它作为完成条件。创建和验收前读取本 skill 的 [references/templates.md](references/templates.md) 与 `$subagent-goal-worker` 的 `references/templates.md`；后者是绑定包、结果和补修契约的唯一规范来源。

初次执行必须有用户明确且唯一的子代理选择和规划后执行授权，不能把空模式默认成 `subagent`。后继 revision 或中断恢复可以沿用 state 中已锁定的 `subagent`；已锁定其他模式时不得接管或转换。

## 入口

1. 初次进入时，用户已明确选择子代理并要求规划后执行；仅要求规划、模式缺失或选择含糊时停止，不调用 `mode`。恢复同一 `parent_goal` 时，state 的 `executor_mode` 必须已经是 `subagent`。
2. `plan_path` 位于当前项目 `.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json`，使用 `planner: parallel-task-planner`、`plan_format_version: 3` 和当前平台。
3. `safety.status` 为 `parallel_safe` 或 `sequential_only`；`needs_user_review` 才暂停。
4. 运行以下命令锁定执行方式。同值可重复，已选子线程模式时必须拒绝切换：

```text
node <plugin-root>/scripts/thread-plan.mjs validate <plan_path>
node <plugin-root>/scripts/thread-plan.mjs mode <plan_path> <state_path> subagent
```

5. state 中非空的 `thread_id` 在本模式表示 `followup_task` 可接受的 canonical agent target，只是共享 driver 的标识字段，不会创建子线程。恢复时用 `list_agents` 确认这些 target 属于当前根任务树；缺失或冲突时返回 `executor_mode_mismatch`，不得创建替代执行单元。

## 执行循环

1. 读取 plan 和 state；已有 `running` task 时先回收，不因上下文中断询问用户。
2. 运行：

```text
node <plugin-root>/scripts/thread-plan.mjs next <plan_path> <state_path>
```

3. 立即处理返回的全部 `dispatch_task`。不同 `module_id + thread_role` 的 ready task 独立推进；`sequential_only` 自然一次只返回一个。平台暂时无法创建更多子代理时保留 task 为 `pending`，先回收已有结果再重试，不改变 DAG。
4. 按“子代理选择”取得 canonical `agent_target`，再运行：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> running <agent_target>
```

5. 使用 `followup_task` 向该子代理发送唯一完整绑定包。绑定首次失败只向同一 id 重试一次，不创建替代子代理。
6. 使用 `wait_agent` 低频批量等待状态变化；子代理运行中不是失败。以原子写入的 `result_path` 为事实来源，不根据 mailbox 摘要补造结果。
7. 校验 `WORKER_RESULT_V3` 后运行终态更新，再回到 `next`：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> completed|blocked|failed|needs_main_review <result_path>
```

## 子代理选择

`next.action.thread_id` 是当前 `parent_goal` 内 `module_id + thread_role` 的唯一归属决议：

1. 非空时，它就是既有 `agent_target`。确认该子代理已空闲后，用 `followup_task` 继续执行。
2. 为 `null` 时，先用稳定名称 `ga_<plan_token>_<module_token>_<role>` 查询当前 agent tree。`plan_token` 取 `plan.json` 父目录名，`module_token` 取 `module_id`；两者都转为小写，把每段连续的非 `[a-z0-9]` 字符替换为一个下划线并去掉首尾下划线，空值分别回退为 `plan` 和 `module`。唯一匹配则恢复；零匹配才调用 `spawn_agent`；多个匹配则停止。
3. 首次 `spawn_agent` 使用 `fork_turns: "none"`，只发送包含 `dispatch_key` 的启动包，要求加载 `$subagent-goal-worker`、返回 `READY` 且不执行或修改业务文件。取得返回的 canonical `task_name` 作为 `agent_target` 并确认空闲后，才更新 task 为 `running` 并发送完整绑定包。

名称只使用小写字母、数字和下划线。子代理归属只在当前根任务树和 `parent_goal` 内复用；不得跨父目标搜索。

## 结果与修订

只接受与当前 task、module、role、`agent_target` 和 `result_path` 一致的结果。共享结果字段 `thread_id` 必须填写该 `agent_target`，`profile_evidence` 固定为 `subagent-defaults`，不代表模型检查。

字段缺失、验证不足或普通差异自检失败时，只向原子代理发送一次 `WORKER_REPAIR_V3`。合法 `scope_request`、审查缺陷和验证失败在静止点一次聚合，交 `$parallel-task-planner` 生成唯一下一 revision；新计划继承当前 `subagent` 模式和执行授权，校验后自动继续，不要求用户重新选择。

只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部副作用、权限升级或无法安全消歧时才暂停。

## 总验收

只有当前 revision 的全部 task 都是 `completed` 且 result 合法，才汇总 `project_verification`、task 证据和最终差异。正式 build、test、lint 和审查必须来自 DAG task。通过后按模板返回 `PARALLEL_PLAN_RESULT.status: completed`。

对用户只报告启动、必要的 revision 摘要、最终结果或真实用户边界，不逐 task 播报。
