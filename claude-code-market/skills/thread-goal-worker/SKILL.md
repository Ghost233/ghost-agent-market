---
name: thread-goal-worker
description: Use when a Claude Code Agent or agent-team worker receives a bound v3 task from a validated parallel-task plan in the current project workspace.
---

# Thread Goal Worker

## 目标

当前 worker 可以顺序执行同一 module 的多个 task，但任一时刻只能有一个 active task。每个 task 独立管理 scope、实现、验证和 diff 自检。

## 分派门禁

实现前验证：

1. `plan_path` 是绝对可读 v3 JSON，标记为 `planner: parallel-task-planner`、`plan_format_version: 3`、`execution_platform: claude_code`。
2. 分派包只包含一个 `task_id`，并含 `module_id`、`task`、`depends_on`、`writable_paths`、`done_when`、`verification`、`worker_context`、`thread_id`、profile/assignment evidence 和 `result_contract: WORKER_RESULT_V3`。
3. `task_id` 在计划中唯一存在；分派字段与该 task 原文逐字段一致；task `module_id` 指向存在的 module。
4. module `worker_profile` 与 profile evidence 一致，实际 worker id 与统一 `thread_id` 字段一致。不猜 alias，不降级 effort。
5. assignment evidence 可核对，当前没有另一个未终止 active task。

任一项失败时不修改文件，返回字段完整的 blocked `WORKER_RESULT_V3`。

## Scope 与执行

只允许修改 `writable_paths` 内且直接服务当前 `task` / `done_when` 的文件。共享契约冲突、未满足依赖、现有用户改动冲突或需要扩大 scope 时停止，不自行修改计划。

1. 读取候选文件与现有改动，确认 scope。
2. 实现最小完整结果，保留无关改动。
3. 运行 task `verification`；不安装依赖，不运行未授权的全局生成或格式化。
4. 检查 changed files、`done_when`、验证证据、diff 聚焦度和用户改动。
5. 返回 `WORKER_RESULT_V3`。worker 不 stage、commit 或 push。

## 结果契约

```json
{
  "contract": "WORKER_RESULT_V3",
  "status": "completed",
  "task_id": "T1",
  "module_id": "implementation",
  "thread_id": "<assigned worker id>",
  "changed_files": ["<path>"],
  "verification": ["<command and result>"],
  "diff_self_check": "pass",
  "summary": "<result or blocking evidence>"
}
```

`status` 只能是 `completed | blocked | failed | needs_main_review`。`completed` 必须同时满足：Plan Binding 通过；assignment/profile evidence 可核对；changed files 全部在 scope；`done_when` 满足；verification 通过或有明确替代证据；`diff_self_check` 为 `pass`；无未解决依赖、共享文件冲突或用户干预。

外部基线失败必须清楚区分“当前 task 验证通过”与“工程总验收受阻”，不伪造 completed。
