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

`validate` 只校验 profile 字段与 effort 枚举，输出 `profile_validation: syntax_only`；model/effort 组合是否可运行以 `create_thread` 的真实结果为准，不因工具说明推断成功，也不自动降级。

## DAG 执行

反复运行：

```text
node <plugin-root>/scripts/thread-plan.mjs next <plan_path> <state_path>
```

每次必须处理返回的全部 actions，再等待任何 worker result。不得因同次其他 task 仍在执行而延后已返回的 action。

### create_thread

从 action 的 `module_id` 读取 module `worker_profile` 和 `worker_context`。以 `<plan_path>#<task_id>` 作为 `dispatch_key`，创建预备线程：

```text
create_thread(
  target={type: project, projectId: <project id>, environment: {type: local}},
  model=<module.worker_profile.model>,
  thinking=<module.worker_profile.reasoning_effort>,
  prompt=<dispatch_key + task_id + module_id + 等待绑定包>
)
```

单独调用并原样检查返回值。只接受对象中的非空 `threadId`，或内容本身是 JSON 对象且含非空 `threadId` 的字符串；普通错误文本不得传给 `JSON.parse`。返回不明确时用 `list_threads(query=<dispatch_key>)` 恢复：唯一匹配才采用，零个或多个匹配都视为未取得 thread id。

未取得真实 thread id 时，不运行 `update`，task 保持 `pending`，返回 `PARALLEL_PLAN_RESULT.status: dispatch_failed`、`dispatch_key` 和原始错误。不得把 profile、参数、网络或工具返回错误写成 task `blocked`。

取得真实 thread id 后，先持久化线程归属：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> running <thread_id>
```

再用 `send_message_to_thread` 发送完整绑定包。发送失败时保留 `running/thread_id` 并返回 `dispatch_failed`；后续协调只向该 thread id 重发绑定，不再创建线程。

### reuse_thread

只使用 action 中的 thread id，先以相同 id 更新 `running`，再通过 `send_message_to_thread` 发送新 task 绑定包。不自行挑选其他线程。发送失败时保留 `running/thread_id`，后续只重发绑定。

### 分派恢复

重新进入协调时，若 `running` 线程只有对应 `dispatch_key` 的预备消息、没有完整绑定包或 worker 活动，则向原 thread id 补发一次绑定包。状态不明或出现多个匹配时返回 `dispatch_failed`，保留原状态并要求主任务复核；不得创建替代线程。

## 绑定包

只发送当前 task：`plan_path`、`state_path`、`parent_goal`、`task_id`、`module_id`、`task`、`depends_on`、`writable_paths`、`done_when`、`verification`、module `worker_context`、实际 `thread_id`、profile 创建证据和 `result_contract: WORKER_RESULT_V3`。不发送其他 task 的写权限。

## 回收与补修

用 `read_thread(includeOutputs: true)` 低频读取已运行线程。运行中不算失败。只接受与当前 `task_id` / `module_id` / `thread_id` 一致的 `WORKER_RESULT_V3`。

合法 `completed` 必须满足：changed files 全部在 task scope；`done_when` 满足；verification 通过或有明确替代证据；`diff_self_check: pass`；无用户干预或共享文件冲突。

字段缺失、验证不足或 diff 自检失败时，仅向原 thread id 发送一次聚焦补修。仍不合法、越界或用户插入新指令时更新为 `needs_main_review`。

只有已经是 `running` 的 task 收到合法 worker 结果后，才使用三命令中的 update：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> completed|blocked|failed|needs_main_review
```

每次状态改变后立即再运行 `thread-plan.mjs next`。

## 总验收

只有 state 中全部 task 为 `completed` 时，才运行顶层 `project_verification`。验收通过才返回 `PARALLEL_PLAN_RESULT.status: completed`。若无 ready/running task 且仍有未完成项，或工程验收失败，返回 `blocked` 及 task 状态、命令和原始失败证据。

所有创建过的子线程保留，不自动归档。
