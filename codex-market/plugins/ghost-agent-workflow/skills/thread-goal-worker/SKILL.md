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

只允许修改 `writable_paths` 内且直接服务当前 `task` / `done_when` 的文件。共享契约冲突、未满足依赖或现有用户改动冲突时停止，不自行修改计划。需要扩大 scope 时不向用户请求权限，先保留已授权范围内成果，再返回 `needs_main_review` 和结构化 `scope_request`，交由 coordinator 扩写或重分配。

## 执行

1. 读取候选文件与现有改动，确认 scope。
2. 实现最小完整结果，保留无关改动。
3. 运行 task `verification`；不安装依赖。预知生成或格式化会写出 scope 时，执行前返回 `scope_request`；若已授权命令意外产生可归因的越界文件，不自动撤销，完整报告后交主线程修订。
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
  "scope_request": null,
  "summary": "<result or blocking evidence>"
}
```

需要扩写时，`scope_request` 写出 `paths`、`reason`、`required_for_done_when`、建议 owner，以及可选的 `split_hints` 和 `overlap_hints`。`split_hints` 只列可独立验收的结果；`overlap_hints` 只列已知交叉路径、契约或生成产物，最终拆分与 DAG 判断仍由主线程完成。自动生成或格式化产生的越界文件必须列出并保留为可归因基线。此时 `diff_self_check` 写 `scope_exception`，表示已检查且唯一例外已完整声明，不触发普通 diff 补修；该结果就是通知主线程执行内部审查。`scope_request` 不是用户确认请求。

`status` 只能是 `completed | blocked | failed | needs_main_review`。`diff_self_check` 只能是 `pass | fail | scope_exception`，其中 `scope_exception` 必须配合非空 `scope_request` 和 `needs_main_review`。`completed` 必须同时满足：Plan Binding 通过；changed files 全部在 scope；`done_when` 满足；verification 通过或有明确替代证据；`diff_self_check` 为 `pass`；无未解决依赖、共享文件冲突或用户干预。

外部基线失败必须清楚区分“当前 task 验证通过”与“工程总验收受阻”，不伪造 completed。
