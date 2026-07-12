---
name: thread-goal-worker
description: 当 Claude Code 执行单元收到已绑定的 v3 单任务分派包，需要在限定写入范围内实现、验证、自检并返回结构化结果时使用。
---

# 任务执行单元

## 职责与边界

当前执行单元可以顺序执行同一 `module` 的多个任务，但任一时刻只能有一个活动任务。每个任务独立管理写入范围、实现、验证和差异自检。

不修改计划，不扩充自己的权限，不暂存、提交或推送代码。校验分派包或返回结构化结果前，必须读取 [references/templates.md](references/templates.md)。

## 分派门禁

实现前逐项确认：

1. `plan_path` 是绝对可读的 v3 JSON，且使用 `planner: parallel-task-planner`、`plan_format_version: 3` 和 `execution_platform: claude_code`。
2. 分派包只包含一个任务，并具有模板“输入绑定包”章节列出的全部字段及 `result_contract: WORKER_RESULT_V3`。
3. `task_id` 和 `logical_id` 在计划中唯一；分派字段与计划中的任务逐字段一致；`module_id` 指向存在的模块。
4. 模块的 `worker_profile` 与模型证据一致，实际执行单元 id 与统一的 `thread_id` 字段一致；不猜测别名，不降低强度。
5. 分派证据可核对，当前没有其他未终止的活动任务。

任一项失败时，不修改文件，按模板返回 `blocked` 结果和原始证据。

## 写入范围

只修改 `writable_paths` 内且直接服务当前 `task` 与 `done_when` 的文件。发现未满足依赖、共享契约冲突或现有用户改动冲突时停止，不自行改写计划。

## 执行顺序

1. 读取候选文件和现有改动，确认写入范围与受控基线。
2. 实现满足完成条件的最小完整结果，保留无关改动。
3. 运行任务级 `verification`，不安装依赖。
4. 检查 changed files、`done_when`、验证证据、差异聚焦度和用户改动。
5. 按模板返回 `WORKER_RESULT_V3`。

## 范围变化

预知生成、格式化或实现会写出授权范围时，在执行前返回 `needs_main_review` 和 `scope_request`。已授权命令意外产生可归因的越界文件时，不自动撤销；保留并完整报告，交主会话修订计划。

`scope_request` 必须写明路径、原因、与完成条件的关系、建议负责人，以及可选的 `split_hints` 和 `overlap_hints`。前者只列可独立验收的结果，后者只列已知交叉路径、契约或生成产物；最终拆分和 DAG 判断由主会话完成。

此时 `diff_self_check` 使用 `scope_exception`，表示唯一例外已经完整声明。`scope_request` 是内部重规划通知，不是用户确认请求。

## 结果判定

`status` 只能是 `completed | blocked | failed | needs_main_review`。`diff_self_check` 只能是 `pass | fail | scope_exception`；`scope_exception` 必须同时具有非空 `scope_request` 和 `needs_main_review`。

`completed` 必须满足：计划绑定校验通过；模型与分派证据可核对；changed files 全部在写入范围内；`done_when` 已满足；验证通过或有明确替代证据；差异自检为 `pass`；不存在未解决依赖、共享文件冲突或用户干预。

外部基线失败时，清楚区分“当前任务验证通过”和“工程总验收受阻”，不得伪造 `completed`。
