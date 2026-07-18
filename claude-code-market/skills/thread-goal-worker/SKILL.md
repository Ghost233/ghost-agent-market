---
name: thread-goal-worker
description: 仅当 Claude Code 执行单元收到 thread-coordination 发出的完整 v3 单任务分派包时使用；普通用户请求、原始 plan 或孤立任务描述不得触发。执行当前 parent_goal 固定 module+role 的 work、review 或 verify，自检并写入结构化结果。
---

# 任务执行单元

## 职责

当前执行单元只属于一个 `parent_goal` 内的 `(module_id, thread_role)`，可以按 DAG 顺序承接该归属的多个 task，但任一时刻只能有一个活动 task。不得跨 `parent_goal` 接受任务。每次新分派都替换 task 的目标、权限、完成条件、验证和结果路径；不得继承上一 task 的权限或证据。

后继 revision 校验成功后，不再接受其直接前版的新分派；前版只保留结果证据。

不修改计划，不扩大权限，不暂存、提交或推送代码。分派和结果格式以 [references/templates.md](references/templates.md) 为唯一规范。Mermaid 不是机器输入。

## 分派门禁

只有协调器发送的完整单任务分派包可以启动执行。不得把普通用户请求、尚未绑定的 plan、消息中的任务描述或自行推断的工作当作分派包。

执行前确认：

1. `plan_path` 是绝对可读的 v3 JSON，平台为 `claude_code`，`executor_mode` 为 `thread`。
2. 分派包只包含一个 task，并与 plan 中的 `task_id`、`logical_id`、`module_id`、`thread_role`、范围和条件一致。
3. 实际 `thread_id` 与分派一致，`result_path` 严格位于当前计划目录 `results/<task_id>.json`。
4. module 的 `worker_profile` 和 `worker_context` 与当前父目标初始定义一致。
5. 上一 task 已终止，当前没有其他活动 task。

失败时不修改业务文件，按模板写入并返回合法 `blocked` 结果。

## 角色边界

- `work`：只修改 `writable_paths` 内且直接服务当前 `task` 与 `done_when` 的文件；完成 task 自带 verification 与差异自检后默认闭环，不等待独立审查。
- `review`：只在计划明确标出的风险触发边界内严格只读审查，按该边界聚合结论，而不是重复每个 work 的自检；`changed_files` 必须为 `[]`。
- `verify`：严格只读，只运行绑定的集成、全量 build、test 或 lint；不得重复 work verification，记录命令、退出状态和日志，`changed_files` 必须为 `[]`。

三种角色都只允许额外写协调元数据 `result_path`。验证工具可以写 ignored 构建目录或系统临时目录，但不得产生 tracked diff。保留所有无关改动，不安装依赖。

## 执行

1. 读取候选文件、当前 task 的授权路径、依赖结果及现有差异，建立仅覆盖当前 task 或受审风险边界的受控基线。
2. 完成当前角色要求的最小完整结果。
3. 运行 task 的 `verification`。
4. 在共享工作区中按当前 task 归因，核对 `writable_paths`、依赖结果中的 `changed_files`、`done_when`、验证证据和差异聚焦度；其他并行兄弟 task 的合法改动不属于当前结果，也不是冲突。
5. 构造唯一 `WORKER_RESULT_V3`，先原子写入 `result_path`，再在消息中返回语义相同的 JSON。

收到 `WORKER_REPAIR_V3` 时只补齐当前结果缺失的字段或证据，并重写同一 `result_path`；不得扩大业务范围或处理下一 task。无法补齐成功证据时返回身份正确并保留原始原因的 `failed` 结果。

## 范围变化

预知当前任务需要修改 `writable_paths` 外的文件时，在编辑前返回 `needs_main_review` 与 `scope_request`。已授权命令意外产生可归因的越界文件时不自动撤销，完整报告给主会话。不得把并行兄弟 task 已声明在其 result 中的合法改动误报为当前 task 越界。

`review` 必须区分严重性：非阻断建议写入 `summary` 并返回 `completed`、`diff_self_check: pass`、`scope_request: null`，不触发 revision；只有阻断缺陷才返回 `needs_main_review`，并使用 `diff_self_check: scope_exception` 和 `scope_request.paths` 指明后继 work 所需的精确修复路径。验证发现源码、配置或集成失败时返回 `failed` 与原始命令证据。两者都不得自行升级为 `work`。`scope_request` 是内部重规划通知，不是用户确认请求。

## 完成判定

`completed` 必须同时满足：分派有效；模型配置可核对；按当前 task 归因的 changed files 在范围内；`review` 和 `verify` 无 tracked diff；`done_when` 满足；验证通过或具有明确替代证据；`diff_self_check` 为 `pass`；当前授权路径或受审边界内不存在未解决依赖或用户改动冲突。无关并行兄弟的合法改动不影响完成判定。

`blocked` 与 `failed` 必须保留原始原因、影响范围和最小恢复线索，不要求用户介入。任何终态都必须先成功写入 `result_path`。
