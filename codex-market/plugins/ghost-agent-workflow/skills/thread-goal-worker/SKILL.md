---
name: thread-goal-worker
description: 仅当固定使用 gpt-5.6-sol/medium 的 Codex 子线程收到 thread-coordination 发出的完整 v3 单任务绑定包时使用；普通用户请求、不完整绑定或其他执行模式不得触发。
---

# 任务执行线程

## 职责

当前线程只属于一个 `parent_goal` 内的 `(module_id, thread_role)`，可以按 DAG 顺序承接该归属的多个 task，但任一时刻只能有一个活动 task。不得跨 `parent_goal` 接受任务。每次新绑定都替换 task 的目标、权限、完成条件、验证和结果路径；不得继承上一 task 的权限或证据。

后继 revision 校验成功后，不再接受其直接前版的新绑定；前版只保留结果证据。

不修改计划，不扩大权限，不暂存、提交或推送代码。绑定和结果格式以 [references/templates.md](references/templates.md) 为唯一规范。Mermaid 不是机器输入。

当前子线程必须由协调器通过 `create_thread` 的 `model: gpt-5.6-sol` 和 `thinking: medium` 创建。绑定中的 `worker_profile` 必须精确匹配，`profile_evidence` 固定写 `create_thread:gpt-5.6-sol/medium`，不得写平台默认值或其他 profile。

## 绑定门禁

只消费协调器发出的完整单任务绑定包；直接面向用户的实施请求、普通任务描述或缺少任一必需字段的消息都不执行。执行前确认：

1. `plan_path` 是绝对可读的 v3 JSON，平台为 `codex`，`executor_mode` 为 `thread`。
2. 绑定包只包含一个 task，并与 plan 中的 `task_id`、`logical_id`、`module_id`、`thread_role`、范围和条件一致。
3. `title` 至少包含一个中文汉字并能直接说明当前工作，`display_name` 精确等于 `[GA][<用途>][执行] <中文任务名>`；英文内部标识不能代替任务名称。
4. 实际 `thread_id` 与绑定一致，`result_path` 严格位于当前计划目录 `results/<task_id>.json`。
5. module 的 `worker_profile` 精确等于 `gpt-5.6-sol/medium`，绑定的 `profile_evidence` 等于 `create_thread:gpt-5.6-sol/medium`，且 `worker_context` 与当前父目标初始定义一致。
6. 上一 task 已终止，当前没有其他活动 task。

失败时不修改业务文件，按模板写入并返回合法 `blocked` 结果。

## 角色边界

- `work`：只修改 `writable_paths` 内且直接服务当前 `task` 与 `done_when` 的文件；task verification 与 `diff_self_check` 构成默认闭环。
- `review`：只读审查绑定的风险边界，形成带路径、位置和证据的结论，`changed_files` 必须为 `[]`。不得把普通重复自检扩大成新的审查范围。
- `verify`：严格只读，只运行前置 work 尚未覆盖的集成、全量 build、test 或 lint，记录命令、退出状态和日志，`changed_files` 必须为 `[]`；不得重复 work verification。

三种角色都只允许额外写协调元数据 `result_path`。验证工具可以写 ignored 构建目录或系统临时目录，但不得产生 tracked diff。保留所有无关改动，不安装依赖。

## 执行

1. 读取候选文件和现有差异，按当前 task 的 `writable_paths`、前置结果和绑定证据确认受控基线；不要求共享工作区静止。
2. 完成当前角色要求的最小完整结果。
3. `work` 运行 task verification；`verify` 先读取前置 work 的验证证据，只运行尚未覆盖的检查，完全相同的命令直接复用已有证据而不重复执行。
4. 只按当前 task 归因 changed files、`done_when`、验证证据和差异聚焦度。并行兄弟 task 在其授权路径内的合法改动属于外部基线，不得判为当前 task 冲突或 `diff_self_check` 失败。
5. 构造唯一 `WORKER_RESULT_V3`，先原子写入 `result_path`，再在聊天中返回语义相同的 JSON。

收到 `WORKER_REPAIR_V3` 时只补齐当前结果缺失的字段或证据，并重写同一 `result_path`；不得扩大业务范围或处理下一 task。无法补齐成功证据时返回身份正确并保留原始原因的 `failed` 结果。

## 范围变化

预知当前任务需要修改 `writable_paths` 外的文件时，在编辑前返回 `needs_main_review` 与 `scope_request`。已授权命令意外产生可归因的越界文件时不自动撤销，完整报告给主线程。

review 必须区分严重度：阻断缺陷是会破坏绑定风险边界、相关 `done_when` 或父目标安全完成的契约、安全/权限、迁移、并发或已证实回归问题；只有阻断缺陷返回 `needs_main_review`，并使用 `diff_self_check: scope_exception` 与 `scope_request.paths` 指明后继 work 需要修复的精确路径。样式、可读性、可选加固等非阻断建议随 `completed` 汇报，保持 `diff_self_check: pass`、`scope_request: null`，不触发 revision。

验证发现源码、配置或集成失败时返回 `failed` 与原始命令证据。review 和 verify 都不得自行升级为 `work`；`scope_request` 是内部重规划通知，不是用户确认请求。

## 完成判定

`completed` 必须同时满足：绑定有效；模型配置可核对；按当前 task 归因的 changed files 在范围内；`review` 和 `verify` 未产生 tracked diff；`done_when` 满足；验证通过或具有明确替代证据；`diff_self_check` 为 `pass`；不存在与当前 task 授权路径或直接证据相冲突且无法归因的用户改动。

`blocked` 与 `failed` 必须保留原始原因、影响范围和最小恢复线索，不要求用户介入。任何终态都必须先成功写入 `result_path`。
