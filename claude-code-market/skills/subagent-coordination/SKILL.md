---
name: subagent-coordination
description: 仅当用户为当前已校验的 Claude Code v3 任务 DAG 明确选择子代理模式并明确要求执行，或恢复 state 已锁定为 subagent 的同一 parent_goal 时使用；普通任务、仅规划请求、未选择执行方式或选择执行线程模式时不得触发。不创建独立执行线程，也不指定模型或思考强度。
---

# 子代理任务协调

## 职责

主会话是业务只读协调器：消费 `$parallel-task-planner` 生成的同一份 v3 plan，推进 DAG、创建或复用子代理、回收结果、触发当前任务内修订并完成总验收。可以通过 driver 写 plan/state/result 协调元数据，但不得修改业务文件、暂存、提交或推送代码；所有正式实施、审查和验证都必须是 DAG task。

本模式首次派发使用 `Agent`，复用已有子代理使用 `SendMessage({to: agentId})`。不得创建独立执行线程。调用 Agent 工具时只提供平台要求的任务、标识和后台执行字段，不得传入 `model`、thinking、reasoning 或 effort 参数；子代理使用平台默认配置。

初次进入时不得根据任务复杂度、DAG 拓扑或缺省习惯推断子代理模式。必须具有用户对当前计划的明确执行授权和唯一模式选择；同一 `parent_goal` 的后继 revision 继承已锁定模式和既有授权，可直接恢复。

计划中的 `worker_profile` 只供执行线程模式使用。本 skill 不读取、不校验、不传递该字段，也不把它作为完成条件。每次进入本 coordination 时先读取一次本 skill 的 [references/templates.md](references/templates.md) 与 `$subagent-goal-worker` 的 `references/templates.md`；后者是绑定包、结果和补修契约的唯一规范来源。同一次执行及其 revision 中模板未变化时不得按 task 重读，确有变化时才在下一次绑定前重新读取。

## 入口

1. 用户已为当前计划明确选择子代理模式并要求执行，或者 state 已在同一 `parent_goal` 中锁定为 `subagent`。仅完成规划、未选择模式、“都可以”或“你决定”都不构成入口授权。
2. `plan_path` 位于当前项目 `.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json`，使用 `planner: parallel-task-planner`、`plan_format_version: 3` 和当前平台。
3. `safety.status` 为 `parallel_safe` 或 `sequential_only`；`needs_user_review` 才暂停。
4. 运行以下命令锁定执行方式。同值可重复，已选执行线程模式时必须拒绝切换：

```text
node <plugin-root>/scripts/thread-plan.mjs validate <plan_path>
node <plugin-root>/scripts/thread-plan.mjs mode <plan_path> <state_path> subagent
```

5. state 中非空的 `thread_id` 在本模式表示真实 `agentId`，只是共享 driver 的标识字段，不会创建执行线程。恢复时确认这些 id 属于当前主会话创建的子代理；缺失或冲突时返回 `executor_mode_mismatch`，不得创建替代执行单元。

## 执行循环

1. 读取 plan 和 state；已有 `running` task 时先回收，不因上下文中断询问用户。
2. 运行：

```text
node <plugin-root>/scripts/thread-plan.mjs next <plan_path> <state_path>
```

3. 立即处理返回的全部 `dispatch_task`。不同 `module_id + thread_role` 的 ready task 独立推进；`sequential_only` 自然一次只返回一个。平台暂时无法创建更多子代理时保留 task 为 `pending`，先回收已有结果再重试，不改变 DAG。
4. 按“子代理选择”取得真实 `agentId`，再运行：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> running <agentId>
```

5. 使用 `SendMessage` 向该子代理发送唯一完整绑定包。绑定首次失败只向同一 id 重试一次，不创建替代子代理。
6. 低频回收后台 Agent 结果；运行中不是失败。任一结果到达即可推进其依赖，不等待无关的 `running` task，因而不得引入批次屏障。以原子写入的 `result_path` 为事实来源，不根据消息摘要补造结果。
7. 对同一次回收中已经到达的全部终态，逐个只读取 `status` 与 `result_path` 并运行终态更新，然后再调用一次 `next`。`update` 是结果结构、身份、范围和状态的唯一机械裁决；协调器不得预先人工重复校验全部字段：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> completed|blocked|failed|needs_main_review <result_path>
```

`update` 成功即接受该终态；失败时保留 driver 的具体错误，只向原子代理发送最多一次聚焦补修。

## 子代理选择

`next.action.thread_id` 是当前 `parent_goal` 内 `module_id + thread_role` 的唯一归属决议：

1. 非空时，它就是既有 `agentId`。确认该子代理已空闲后，用 `SendMessage({to: agentId})` 恢复；不要向 `Agent` 传 resume 参数。
2. 为 `null` 时，先按稳定名称 `ga_<plan_token>_<module_token>_<role>` 核对当前会话已创建的子代理。`plan_token` 取 `plan.json` 父目录名，`module_token` 取 `module_id`；两者都转为小写，把每段连续的非 `[a-z0-9]` 字符替换为一个下划线并去掉首尾下划线，空值分别回退为 `plan` 和 `module`。唯一匹配则恢复；零匹配才调用 `Agent`；多个匹配则停止。
3. 首次 Agent 提示只包含 `dispatch_key` 和启动门禁，要求加载 `$subagent-goal-worker`、返回 `READY` 且不执行或修改业务文件。取得非空 `agentId` 并确认空闲后，才更新 task 为 `running` 并发送完整绑定包。

名称只使用小写字母、数字和下划线。该稳定名称仅为内部技术标识，不得出现在面向用户的报告或标题中；对用户只显示 task 的中文 `title`，不显示 `logical_id` 或 `module_id`。子代理归属只在当前主会话和 `parent_goal` 内复用；不得跨父目标搜索。

## 结果与修订

共享结果字段 `thread_id` 必须填写该 `agentId`，`profile_evidence` 固定为 `subagent-defaults`，不代表模型检查。协调器只读取结果声明的 `status` 和既定 `result_path`，由 driver `update` 机械裁决 task、module、role、agent、范围和结构；不得提前重复实现这些校验。driver 报告字段缺失、验证不足或差异自检错误时，把原始错误放入唯一一次 `WORKER_REPAIR_V3`。

`work` 完成定向 verification 与差异自检后默认闭环，不因缺少独立 review 补造 task。`review` 的非阻断建议必须随 `completed` 保留，不触发 revision；只有阻断缺陷才使用 `needs_main_review`，并按 worker 契约携带 `diff_self_check: scope_exception` 与指向后继 work 精确修复路径的 `scope_request`。合法范围变化、阻断缺陷和验证失败在静止点一次聚合，交 `$parallel-task-planner` 生成唯一下一 revision；重复自检、非阻断建议或缺少独立 review 不构成修订理由，不得补造 `review` 或 `verify`。新计划校验并继承 `subagent` 模式后自动继续，不要求用户确认。

共享工作区中的差异按当前 task 的 `writable_paths`、依赖结果中的 `changed_files`、受审风险边界和 driver 已接受的 result 归因。其他并行兄弟 task 的合法改动不是冲突，也不触发补修或 revision；只有无法归因且确实进入当前授权路径或受审边界的改动才升级。

只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部副作用、权限升级或无法安全消歧时才暂停。

## 总验收

只有当前 revision 的全部 task 都是 `completed` 且 result 已被 driver 接受，才汇总 `project_verification`、task 证据和最终差异。work verification 与差异自检是默认闭环证据；只有计划中风险触发的 review 或非重复集成 verify 才额外参与总验收。主会话不得重复 work verification，也不得因计划没有独立审查而补造。通过后按模板返回 `PARALLEL_PLAN_RESULT.status: completed`。

对用户只报告启动、必要的 revision 摘要、最终结果或真实用户边界，不逐 task 播报。
