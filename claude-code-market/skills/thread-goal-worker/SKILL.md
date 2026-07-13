---
name: thread-goal-worker
description: 当 Claude Code 执行单元收到已绑定的 v3 单任务分派包，需要在固定 module+role 下顺序实施、审查或验证、自检并持久化结构化结果时使用。
---

# 任务执行单元

## 职责与边界

当前执行单元固定归属一个 `(parent_goal, module_id, thread_role)`，可以按 DAG 顺序承接该归属的多个 task，但任一时刻只能有一个活动任务（task）。每个 task 独立管理目标、写入范围、实现、验证和差异自检；新分派不得继承上一 task 的权限、结果路径或完成证据。

复用执行单元接收新 task 时，上一 task 必须已经返回 `completed`、`needs_main_review`、`blocked` 或 `failed` 终态。新分派必须保持 `parent_goal`、`module_id` 和 `thread_role`，`logical_id` 可以变化。

不修改计划，不扩充自己的权限，不暂存、提交或推送代码。唯一允许写到业务 `writable_paths` 以外的内容，是绑定的 `result_path` 协调元数据文件；必须原子写入完整 `WORKER_RESULT_V3`。校验分派包或返回结构化结果前，必须读取 [references/templates.md](references/templates.md)。

Mermaid 只是主会话对已校验 `plan.json` 的只读展示，不是分派输入或机器契约。执行单元不得读取、解析 Mermaid，也不得从图形文本推断依赖、写入范围、完成条件或执行状态；这些信息只以计划 JSON 和输入绑定包为准。已绑定 task 不是新的顶层父目标，不得再次调用规划或协调 skill。

## 分派门禁

实现前逐项确认：

1. `plan_path` 是绝对可读的 v3 JSON，且使用 `planner: parallel-task-planner`、`plan_format_version: 3` 和 `execution_platform: claude_code`。
2. 分派包只包含一个任务，并具有模板“输入绑定包”章节列出的全部字段及 `result_contract: WORKER_RESULT_V3`。
3. `task_id` 和 `logical_id` 在计划中唯一；`thread_role` 只能是 `work | review | verify`；分派字段与计划中的任务逐字段一致；`module_id` 指向存在的领域模块。
4. 实际执行单元 id 与统一的 `thread_id` 字段一致。首次创建时 `worker_profile` 必须有真实创建证据；复用时继承已有执行单元的实际配置，module 的 profile 或 context 更新不改变执行单元归属，也不构成拒绝分派或新建替代执行单元的理由；不猜测别名，不降低强度。
5. `result_path` 精确等于当前计划目录 `results/<task_id>.json`，分派证据可核对，当前没有其他未终止的活动任务。

任一项失败时，不修改业务文件；按模板生成 `blocked` 结果，原子写入 `result_path` 并返回同一 JSON。

## 写入范围

首次执行 task 时创建绑定 `task_id`、`logical_id`、`thread_role`、`module_id`、`writable_paths` 和 `result_path` 的独立目标。承接新 task 时替换全部 task 局部字段并创建新的独立目标；补修时只恢复当前目标。收到 `WORKER_REPAIR_V3` 后无法补齐成功证据时，也必须返回身份正确、契约合法并保留原始原因的 `failed` 结果。

`work` 是正式实施任务，只修改 `writable_paths` 内且直接服务当前 `task` 与 `done_when` 的业务文件。

`review` 是严格只读审查，要求 `writable_paths: []`，不得编辑、格式化或生成业务文件，只能读取和运行不改动 tracked files 的检查。

`verify` 用于编译、类型检查和集成验证，同样要求 `writable_paths: []` 且不得改动 tracked files；允许验证命令写入忽略的构建缓存、临时日志和其他非 tracked 产物。三种角色都可原子写唯一的 `result_path`。

发现未满足依赖、共享契约冲突或现有用户改动冲突时停止，不自行改写计划。

## 执行顺序

1. 读取候选文件和现有改动，确认写入范围与受控基线。
2. `work` 实现满足完成条件的最小完整结果；`review` 收集可定位的审查证据；`verify` 执行完整验证并保留原始退出码、源码错误和日志路径。三者都保留无关改动。
3. 运行任务级 `verification`，不安装依赖。
4. 检查 tracked changed files、`done_when`、验证证据、差异聚焦度和用户改动。包装摘要不得覆盖更具体的原始失败。
5. 按模板构造唯一终态 `WORKER_RESULT_V3`，先原子写入 `result_path`，再在消息中原样返回同一 JSON。不要发送过程性总结或向用户请求内部修订授权。

## 范围变化

预知生成、格式化或实现会写出授权范围时，在执行前返回 `needs_main_review` 和 `scope_request`。已授权命令意外产生可归因的越界文件时，不自动撤销；保留并完整报告，交主会话修订计划。

审查任务发现缺陷或需要修改时，也返回 `needs_main_review` 和 `scope_request`，由主会话生成或重接 `work` 任务；不得把当前审查任务自行升级为实施任务。验证任务发现源码、配置或集成失败时，返回 `failed` 和完整原始证据，不自行修改。

`scope_request` 必须写明路径、原因、与完成条件的关系、建议领域 module 或 `logical_id`，以及可选的 `split_hints` 和 `overlap_hints`。前者只列可独立验收的结果，后者只列已知交叉路径、契约或生成产物；最终拆分和 DAG 判断由主会话完成。

此时 `diff_self_check` 使用 `scope_exception`，表示唯一例外已经完整声明。`scope_request` 是内部重规划通知，不是用户确认请求。

## 结果判定

`status` 只能是 `completed | blocked | failed | needs_main_review`。`diff_self_check` 只能是 `pass | fail | scope_exception`；`scope_exception` 必须同时具有非空 `scope_request` 和 `needs_main_review`。

`completed` 必须满足：计划绑定校验通过；模型与分派证据可核对；tracked changed files 全部在写入范围内；`review` 与 `verify` 的 changed files 必须为 `[]`；`done_when` 已满足；验证通过或有明确替代证据；差异自检为 `pass`；不存在未解决依赖、共享文件冲突或用户干预。

外部基线失败时，清楚区分“当前任务验证通过”和“工程总验收受阻”，不得伪造 `completed`。执行单元内部辅助过程不形成独立正式证据，统一汇总到当前结果。
