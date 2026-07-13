---
name: thread-goal-worker
description: 当 Codex 可见子线程收到已绑定的 v3 单任务分派包，需要按 work、review 或 verify 角色执行、自检并持久化结构化结果时使用。
---

# 任务执行线程

## 职责与边界

当前子线程可以顺序执行同一 `module` 的多个任务，但任一时刻只能有一个活动任务。每个任务独立管理目标、写入范围、实现、验证和差异自检。

不修改计划，不扩充自己的权限，不暂存、提交或推送代码。可以使用线程内部辅助过程，但当前线程必须统一控制范围、汇总证据并独立返回唯一正式结果。校验绑定包或返回结构化结果前，必须读取 [references/templates.md](references/templates.md)。

## 预备状态

收到预备提示时，只确认 `task_id`、`logical_id`、`thread_role` 和 `module_id`，然后等待包含真实 `thread_id` 的完整绑定包。此前不创建目标、不读取或修改实现文件、不运行命令。

复用线程接收新任务时，上一任务必须已经返回终止结果。

## 绑定门禁

实现前逐项确认：

1. `plan_path` 是绝对可读的 v3 JSON，且使用 `planner: parallel-task-planner`、`plan_format_version: 3` 和 `execution_platform: codex`。
2. 绑定包只包含一个任务，并具有模板“输入绑定包”章节列出的全部字段及 `result_contract: WORKER_RESULT_V3`。
3. `task_id` 和 `logical_id` 在计划中唯一；`thread_role` 只能是 `work | review | verify`；绑定字段与计划中的任务逐字段一致；`module_id` 指向存在的稳定领域模块。
4. 模块的 `worker_profile` 与创建或继承证据一致，实际线程 id 与绑定包一致；不猜测别名，不降低强度。
5. `result_path` 严格等于当前 plan 目录下 `results/<task_id>.json`，且当前没有其他未终止的活动任务。

任一项失败时，不创建目标、不修改文件，按模板返回 `blocked` 结果和原始证据。

## 目标与写入范围

首次执行任务时，创建绑定 `task_id`、`logical_id`、`thread_role`、`module_id`、`writable_paths` 和 `result_path` 的独立目标，并在编辑前再次核对。补修时恢复当前目标，不为同一 `logical_id` 创建第二个并行目标。

`work` 是正式实施任务，只修改 `writable_paths` 内且直接服务当前 `task` 与 `done_when` 的文件。`review` 是严格只读的判断任务，只形成带文件、位置和证据的审查结论。`verify` 是严格只读的命令任务，执行绑定的 build、test 或 lint，并记录完整命令、退出状态和日志证据。后二者要求 `writable_paths: []` 且 tracked changed files 必须为空；允许验证工具写入忽略目录或系统临时目录。

唯一额外写入例外是协调元数据 `result_path`。它不属于业务 `writable_paths`，不能被计入 `changed_files`。发现未满足依赖、共享契约冲突或现有用户改动冲突时停止，不自行改写计划。

## 执行顺序

1. 读取候选文件和现有改动，确认写入范围与受控基线。
2. `work` 实现最小完整结果；`review` 形成审查判断；`verify` 运行指定检查。所有角色都保留无关改动。
3. 运行任务级 `verification`，不安装依赖；线程内部辅助过程的发现必须由当前线程复核并合并，不能单独作为正式结果。
4. 检查 changed files、`done_when`、验证证据、差异聚焦度和用户改动。`verify` 必须记录实际命令、退出状态和可定位日志，不能只转述成功或失败。
5. 生成一个完整 `WORKER_RESULT_V3`，原子写入 `result_path`，再在聊天中返回语义相同的 JSON；不得只返回摘要或路径。

## 范围变化

预知生成、格式化或实现会写出授权范围时，在执行前返回 `needs_main_review` 和 `scope_request`。已授权命令意外产生可归因的越界文件时，不自动撤销；保留并完整报告，交主线程修订计划。

审查任务发现缺陷或需要修改时，返回 `needs_main_review` 和 `scope_request`，由主线程生成或重接 `work` 任务。验证任务发现源码、配置或集成失败时返回 `failed`，保留原始命令、退出状态、具体工程错误和日志路径。两者都不得把当前任务自行升级为实施任务。

`scope_request` 必须写明路径、原因、与完成条件的关系、建议负责人，以及可选的 `split_hints` 和 `overlap_hints`。前者只列可独立验收的结果，后者只列已知交叉路径、契约或生成产物；最终拆分和 DAG 判断由主线程完成。

此时 `diff_self_check` 使用 `scope_exception`，表示唯一例外已经完整声明。`scope_request` 是内部重规划通知，不是用户确认请求。

## 结果判定

`status` 只能是 `completed | blocked | failed | needs_main_review`。`diff_self_check` 只能是 `pass | fail | scope_exception`；`scope_exception` 必须同时具有非空 `scope_request` 和 `needs_main_review`。

`completed` 必须满足：计划绑定校验通过；模型配置证据可核对；changed files 全部在写入范围内；`review` 与 `verify` 的 changed files 必须为 `[]`；`done_when` 已满足；验证通过或有明确替代证据；差异自检为 `pass`；不存在未解决依赖、共享文件冲突或用户干预。

`blocked` 与 `failed` 必须在 `summary` 和 `verification` 中保留原始原因、影响范围和最小恢复线索，不要求用户介入，也不自行创建计划外工作。主线程会把可恢复失败合并进下一 revision。

外部基线失败时，清楚区分“当前任务验证通过”和“工程总验收受阻”，不得伪造 `completed`。任何终态结果都必须先成功写入 `result_path`；该文件由 driver 校验后内嵌到 `state.tasks.<task_id>.result`。
