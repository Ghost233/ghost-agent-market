---
name: thread-coordination
description: Use when a user explicitly authorizes Codex to execute a validated parallel_safe v3 plan in the current local project workspace.
---

# Thread Coordination

## 目标

把当前 task 作为只读 coordinator，消费 v3 task DAG，把脚本返回的全部 ready actions 立即翻译为用户可见子线程操作。coordinator 不修改业务文件，不 stage、commit 或 push。

## 入口门禁

创建或发送子线程前验证：

1. 用户已明确授权执行该计划。
2. `plan_path` 是当前项目 `.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json` 的绝对路径。
3. 计划为 `planner: parallel-task-planner`、`plan_format_version: 3`、`execution_platform: codex`，且 `safety.status: parallel_safe`。
4. 同目录 `state.json` 可读，且以下命令成功：

```text
node <plugin-root>/scripts/thread-plan.mjs validate <plan_path>
```

5. 当前工作树的用户改动不落入尚未执行 task 的 `writable_paths`。
6. 用 `list_projects` 唯一解析当前目录的 project，并使用 `environment: {type: local}`。

任一门禁失败时不执行、不修复计划，直接返回 `PARALLEL_PLAN_RESULT` 及原始证据。

## DAG 执行

反复运行：

```text
node <plugin-root>/scripts/thread-plan.mjs next <plan_path> <state_path>
```

每次必须处理返回的全部 actions，再等待任何 worker result。不得因同次其他 task 仍在执行而延后已返回的 action。

### create_thread

从 action 的 `module_id` 读取 module `worker_profile` 和 `worker_context`，创建预备线程：

```text
create_thread(
  target={type: project, projectId: <project id>, environment: {type: local}},
  model=<module.worker_profile.model>,
  thinking=<module.worker_profile.reasoning_effort>,
  prompt=<task_id + module_id + 等待绑定包>
)
```

获得真实 thread id 后，用 `send_message_to_thread` 发送完整绑定包，再运行：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> running <thread_id>
```

### reuse_thread

只使用 action 中的 thread id，通过 `send_message_to_thread` 发送新 task 绑定包，再以相同 id 更新 `running`。不自行挑选其他线程。

创建或发送失败时更新为 `blocked`：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> blocked
```

## 绑定包

只发送当前 task：`plan_path`、`state_path`、`parent_goal`、`task_id`、`module_id`、`task`、`depends_on`、`writable_paths`、`done_when`、`verification`、module `worker_context`、实际 `thread_id`、profile 创建证据和 `result_contract: WORKER_RESULT_V3`。不发送其他 task 的写权限。

## 回收与补修

用 `read_thread(includeOutputs: true)` 低频读取已运行线程。运行中不算失败。只接受与当前 `task_id` / `module_id` / `thread_id` 一致的 `WORKER_RESULT_V3`。

合法 `completed` 必须满足：changed files 全部在 task scope；`done_when` 满足；verification 通过或有明确替代证据；`diff_self_check: pass`；无用户干预或共享文件冲突。

字段缺失、验证不足或 diff 自检失败时，仅向原 thread id 发送一次聚焦补修。仍不合法、越界或用户插入新指令时更新为 `needs_main_review`。

合法结果使用三命令中的 update：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> completed|blocked|failed|needs_main_review
```

每次状态改变后立即再运行 `thread-plan.mjs next`。

## 总验收

只有 state 中全部 task 为 `completed` 时，才运行顶层 `project_verification`。验收通过才返回 `PARALLEL_PLAN_RESULT.status: completed`。若无 ready/running task 且仍有未完成项，或工程验收失败，返回 `blocked` 及 task 状态、命令和原始失败证据。

所有创建过的子线程保留，不自动归档。
