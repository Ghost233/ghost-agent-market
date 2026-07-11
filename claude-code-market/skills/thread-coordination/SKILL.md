---
name: thread-coordination
description: Use when a user explicitly authorizes Claude Code to execute a validated parallel_safe v3 plan with Agent or agent-team workers in the current project workspace.
---

# Thread Coordination

## 目标

把当前 session 作为只读 coordinator，消费 v3 task DAG，把脚本返回的全部 ready actions 立即翻译为 Agent 或 agent-team teammate 操作。coordinator 不修改业务文件，不 stage、commit 或 push。

## 入口门禁

1. 用户已明确授权执行该计划。
2. `plan_path` 是当前项目 `.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json` 的绝对路径。
3. 计划为 `planner: parallel-task-planner`、`plan_format_version: 3`、`execution_platform: claude_code`，且 `safety.status: parallel_safe`。
4. 同目录 `state.json` 可读，且以下命令成功：

```text
node <plugin-root>/scripts/thread-plan.mjs validate <plan_path>
```

5. 当前工作树的用户改动不落入尚未执行 task 的 `writable_paths`。

任一门禁失败时不执行、不修复计划，直接返回 `PARALLEL_PLAN_RESULT` 及原始证据。

`validate` 只校验 profile 字段与 effort 枚举，输出 `profile_validation: syntax_only`；model/effort 组合是否可运行以平台创建 worker 的真实结果为准，不自动降级。

## DAG 执行

反复运行：

```text
node <plugin-root>/scripts/thread-plan.mjs next <plan_path> <state_path>
```

每次必须处理返回的全部 actions，再等待任何 worker result。不得因同次其他 task 仍在执行而延后已返回的 action。

- `create_thread`：从 task `module_id` 读取 module profile/context，以 `<plan_path>#<task_id>` 作为 `dispatch_key`，用 Agent 或 agent-team 创建新 worker，并原样检查平台返回的 worker id。
- `reuse_thread`：只使用 action 指定的原 worker id，不自行挑选其他 worker。

未取得真实 worker id 时不运行 `update`，task 保持 `pending`，返回 `PARALLEL_PLAN_RESULT.status: dispatch_failed`、`dispatch_key` 和原始错误。不得把 profile、参数、网络或平台创建错误写成 task `blocked`。

取得真实 worker id 后，先把它原样写入统一 `thread_id` 字段：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> running <thread_id>
```

再发送完整分派包。发送失败时保留 `running/thread_id` 并返回 `dispatch_failed`；重新进入协调时只向原 worker 补发一次分派包，不创建替代 worker。状态不明或匹配不唯一时保留原状态并要求主 session 复核。

只有已经是 `running` 的 task 收到合法 worker 结果后，才允许更新为 `blocked`、`failed` 或 `needs_main_review`。

## 分派包

只发送当前 task：`plan_path`、`state_path`、`parent_goal`、`task_id`、`module_id`、`task`、`depends_on`、`writable_paths`、`done_when`、`verification`、module `worker_context`、实际 `thread_id`、profile/assignment evidence 和 `result_contract: WORKER_RESULT_V3`。不发送其他 task 的写权限。

## 回收与补修

只接受与当前 `task_id` / `module_id` / `thread_id` 一致的 `WORKER_RESULT_V3`。合法 `completed` 必须满足：changed files 全部在 task scope；`done_when` 满足；verification 通过或有明确替代证据；`diff_self_check: pass`；profile/assignment evidence 可核对；无用户干预或共享文件冲突。

字段缺失、验证不足或 diff 自检失败时，仅向原 worker 发送一次聚焦补修。仍不合法、越界或用户插入新指令时更新为 `needs_main_review`。

合法结果使用：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> completed|blocked|failed|needs_main_review
```

每次状态改变后立即再运行 `thread-plan.mjs next`。

## 总验收

只有 state 中全部 task 为 `completed` 时，才运行顶层 `project_verification`。验收通过才返回 `PARALLEL_PLAN_RESULT.status: completed`。若无 ready/running task 且仍有未完成项，或工程验收失败，返回 `blocked` 及 task 状态、命令和原始失败证据。

所有已创建 worker 保留，不自动关闭。
