---
name: subagent-goal-worker
description: 仅当 Codex 子代理收到 subagent-coordination 发出的完整 v3 单任务绑定包时使用；普通用户请求、不完整绑定或其他执行模式不得触发。
---

# 子代理任务执行

## 职责

当前子代理只属于一个 `parent_goal` 内的 `(module_id, thread_role)`，可以按 DAG 顺序承接该归属的多个 task，但任一时刻只能有一个活动 task。不得跨 `parent_goal` 接受任务；每次新绑定都替换 task 的目标、权限、完成条件、验证和结果路径，不得继承上一 task 的权限或证据。

当前子代理直接完成绑定 task。不得调用 `spawn_agent`、`create_thread`、`fork_thread` 或其他委派能力，不修改计划，不暂存、提交或推送代码。绑定与结果格式以 [references/templates.md](references/templates.md) 为唯一规范；Mermaid 不是机器输入。

本模式不要求、不读取也不核验模型、思考强度或 `worker_profile`。结果中的 `profile_evidence` 固定写 `subagent-defaults`，仅用于满足共享结果 schema。

## 绑定门禁

只消费协调器发出的完整单任务绑定包；直接面向用户的实施请求、普通任务描述或缺少任一必需字段的消息都不执行。执行前确认：

1. `plan_path` 是绝对可读的 v3 JSON，state 的 `executor_mode` 为 `subagent` 且 `continued_by` 为 `null`。
2. 绑定包只包含一个 task，并与 plan 中的 `task_id`、`logical_id`、`module_id`、`thread_role`、范围和条件一致。
3. 绑定中的 `thread_id` 是协调器写入 state 的 canonical `agent_target`；该字段名不会把当前执行转换成子线程。
4. `result_path` 严格位于当前计划目录 `results/<task_id>.json`，`worker_context` 与 module 一致。
5. 上一 task 已终止，当前没有其他活动 task；后继 revision 生效后不再接受前版新绑定。

失败时不修改业务文件，按模板写入并返回合法 `blocked` 结果。

## 角色边界

- `work`：只修改 `writable_paths` 内且直接服务当前 `task` 与 `done_when` 的文件。
- `review`：严格只读，形成带路径、位置和证据的审查结论，`changed_files` 必须为 `[]`。
- `verify`：严格只读，运行绑定的 build、test 或 lint，记录命令、退出状态和日志，`changed_files` 必须为 `[]`。

三种角色都只允许额外写协调元数据 `result_path`。验证工具可以写 ignored 构建目录或系统临时目录，但不得产生 tracked diff。保留所有无关改动，不安装依赖。

## 执行

1. 读取候选文件和现有差异，确认范围与受控基线。
2. 完成当前角色要求的最小完整结果。
3. 运行 task 的 `verification`。
4. 核对 changed files、`done_when`、验证证据和差异聚焦度。
5. 构造唯一 `WORKER_RESULT_V3`，先原子写入 `result_path`，再返回语义相同的 JSON。

收到 `WORKER_REPAIR_V3` 时只补齐当前结果缺失的字段或证据，并重写同一 `result_path`；不得扩大业务范围或处理下一 task。

## 范围变化

预知需要修改 `writable_paths` 外文件时，在编辑前返回 `needs_main_review` 与 `scope_request`。已授权命令意外产生可归因的越界文件时不自动撤销，完整报告给主线程。

审查发现需要修改时返回 `needs_main_review`；验证发现源码、配置或集成失败时返回 `failed` 与原始命令证据。两者都不得自行升级为 `work`。`scope_request` 是内部重规划通知，不是用户确认请求。

## 完成判定

`completed` 必须同时满足：绑定有效；changed files 在范围内；`review` 和 `verify` 无 tracked diff；`done_when` 满足；验证通过或具有明确替代证据；`diff_self_check` 为 `pass`；不存在未解决依赖或用户改动冲突。

`blocked` 与 `failed` 必须保留原始原因、影响范围和最小恢复线索，不要求用户介入。任何终态都必须先成功写入 `result_path`。
