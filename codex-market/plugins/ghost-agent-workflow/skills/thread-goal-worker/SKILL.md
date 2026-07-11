---
name: thread-goal-worker
description: Use when a user-visible Codex child thread receives a bound v3 task from a validated parallel-task plan in the current local workspace.
---

# Thread Goal Worker

## 目标

当前子线程可以顺序执行同一 module 的多个 task，但任一时刻只能有一个 active task。每个 task 负责自己的独立 goal、scope、实现、验证和 diff 自检。

## 预备与绑定

收到预备 prompt 时只确认 `task_id` 和 `module_id`，然后等待带真实 `thread_id` 的绑定包。此前不设置 goal、不读写实现文件、不运行命令。复用线程收到新绑定包时，上一 task 必须已返回终止结果。

实现前验证：

1. `plan_path` 是绝对可读 v3 JSON，标记为 `planner: parallel-task-planner`、`plan_format_version: 3`、`execution_platform: codex`。
2. 绑定包只包含一个 `task_id`，并含 `module_id`、`task`、`depends_on`、`writable_paths`、`done_when`、`verification`、`worker_context`、`thread_id` 和 `result_contract: WORKER_RESULT_V3`。
3. `task_id` 在计划中唯一存在；绑定字段与该 task 原文逐字段一致；task `module_id` 指向存在的 module。
4. module `worker_profile` 与创建证据一致，实际 `thread_id` 与绑定包一致。不猜 alias，不降级 effort。
5. 当前没有另一个未终止 active task。

任一项失败时不设置 goal、不修改文件，返回字段完整的 blocked `WORKER_RESULT_V3`。

## Goal 与 Scope

首次执行 task 时创建绑定 `task_id`、`module_id` 和 `writable_paths` 的独立 goal，并在编辑前二次确认。补修时恢复当前 task goal，不为同一 task 创建第二个实现 goal。

只允许修改 `writable_paths` 内且直接服务当前 `task` / `done_when` 的文件。共享契约冲突、未满足依赖、现有用户改动冲突或需要扩大 scope 时停止，不自行修改计划。

## 执行

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
  "thread_id": "<bound thread id>",
  "changed_files": ["<path>"],
  "verification": ["<command and result>"],
  "diff_self_check": "pass",
  "summary": "<result or blocking evidence>"
}
```

`status` 只能是 `completed | blocked | failed | needs_main_review`。`completed` 必须同时满足：Plan Binding 通过；changed files 全部在 scope；`done_when` 满足；verification 通过或有明确替代证据；`diff_self_check` 为 `pass`；无未解决依赖、共享文件冲突或用户干预。

外部基线失败必须清楚区分“当前 task 验证通过”与“工程总验收受阻”，不伪造 completed。
