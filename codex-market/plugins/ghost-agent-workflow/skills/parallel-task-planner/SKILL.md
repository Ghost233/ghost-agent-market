---
name: parallel-task-planner
description: 仅当用户已经说明完当前任务、明确要求对它进行 DAG 或并行规划，并且唯一选择子线程或子代理模式时，用于生成初始 v3 计划；也用于同一 parent_goal 的内部修订。任务只需有可识别的规划对象，不要求用户预先给出验收标准。背景说明、尚未说完或准备继续补充的需求，以及普通实施、修复、审查或讨论请求不得触发。
---

# 任务 DAG 规划

## 职责

初始规划必须同时满足：用户已完成当前任务说明、明确要求现在进行 DAG 或并行规划，并且明确且唯一选择子线程或子代理模式。用户在同一条消息末尾发出规划指令即可视为当前说明已收口；若用户表示尚未说完、稍后补充或当前只是在介绍背景，则不得规划。任务只需有可识别的规划对象，不要求用户预先写出验收标准，规划器负责从任务意图补全 task 级 `done_when` 和验证方式。

任一初始门禁缺失时都不得创建 `plan.json`、运行 driver 或调用协调器。普通请求继续走普通流程，不为了使用本 skill 追问执行方式；只有用户已经明确要求 DAG 或并行规划时，才用一次简短问题补齐缺失的任务对象或唯一执行方式。`都可以`、`你决定` 或同时允许两种方式都不算唯一选择。

满足门禁后为当前任务创建新的 `parent_goal`。单节点、纯串行、并行和混合拓扑都合理，不得因为任务简单或只能串行而跳过规划。已绑定的 DAG task 只由当前执行方式对应的 goal worker 执行，不得再次拆成新的父目标。

`module` 是当前 `parent_goal` 内稳定的领域职责；`task` 是一次性 DAG 节点，只通过 `module_id` 选择负责人。执行归属为当前父目标内的 `(module_id, thread_role)`：首次派发创建执行单元，后续 task 和 revision 复用；不同 `parent_goal` 之间绝不复用。

初始计划确定 module 后，其 `id`、`worker_profile` 和 `worker_context` 在当前父目标内固定。需要不同职责或执行配置时定义新 module，不修改已有 module。计划不包含线程路由；驱动器在 `next` 时按当前父目标内的 `(module_id, thread_role)` 归属计算 `action.thread_id`。

本 skill 只规划，不创建执行单元、不修改业务文件。用户明确要求只规划时，展示计划后停止；只有用户同时明确要求规划后执行，才把计划交给所选协调器。同一 `parent_goal` 的后继 revision 继承已经明确的授权和执行方式，不重新询问。

## 输出

在项目中创建：

```text
.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json
```

写入前读取 [references/templates.md](references/templates.md)。计划文件只写 JSON；执行模式和 Mermaid 只在对话中展示。

Codex module 配置固定为 `gpt-5.6-sol/medium`，用于子线程创建和绑定校验；不得省略、覆盖、猜测别名或自动降级。子代理模式不消费该字段，但使用相同的固定运行 profile。

每个 task 的 `title` 必须是能直接说明工作的简洁中文名称，至少包含一个中文汉字，不得只写英文、路径、编号或内部标识。`task_id`、`logical_id`、`module_id` 和子代理 canonical target 只作机器标识，不得代替面向用户的任务名称。

## 执行方式

同一份 plan 可以选择两种执行方式，选择不写入 plan：

- 用户明确选择子线程模式时，交给 `$thread-coordination`，task 由 `$thread-goal-worker` 执行。
- 用户明确选择子代理模式时，交给 `$subagent-coordination`，task 由 `$subagent-goal-worker` 执行。
- 不设默认方式，不根据任务规模或可用工具代替用户选择。初始规划缺少唯一选择时不得生成计划。

执行开始后由 driver 锁定 `executor_mode`，同一 `parent_goal` 不得中途混用或切换。后继 revision 继承该锁；子代理模式仍使用相同 plan，但不消费 module 的 `worker_profile`。

## 规划流程

1. 确认当前任务说明已收口且规划对象可识别，再提炼 `parent_goal`、当前工程状态和父目标总验证方式；不得要求用户先提供验收标准。
2. 按稳定领域职责定义 module。不得使用 `implementation`、`review`、`verification`、`compile` 等阶段名，也不得为每个 task 复制近义 module。`worker_context` 只写领域边界和长期不变量。
3. 按可独立验收的结果拆分 task。不得为制造并行度拆开真实串行职责，也不得合并本可独立验收的结果。每项都写明 `logical_id`、`title`、`thread_role`、`writable_paths`、`done_when` 和 `verification`。
4. `work` 负责正式修改且 `writable_paths` 非空；`review` 只读审查；`verify` 只读执行 build、test 或 lint。后两者的 `writable_paths` 必须为 `[]`，不得产生 tracked diff。
5. 检查任务闭包：task 引用的测试、门禁或配置如果需要修改，必须位于某个 `work` task 的 `writable_paths`，并由当前 task 自己负责，或由它明确依赖且先完成的前置 task 负责。否则不得生成依赖该检查的 `review` 或 `verify` task。
6. 用 `depends_on` 表达真实依赖。同一 revision 中相同 `module_id + thread_role` 的 task 必须在 DAG 中可比；不同归属且写域、共享契约、生成产物和运行环境不冲突的 ready task 保持不可比并立即并行。
7. `project_verification` 只汇总父目标覆盖和 task 证据。需要实际运行的正式检查必须成为 `verify` task。
8. 至少两个不可比 task 时使用 `parallel_safe`；单节点或纯串行图使用 `sequential_only`；只有真实用户边界使用 `needs_user_review`。前两者都可执行，不能为了通过门禁伪造并行任务。

## 当前任务内修订

只有当前 plan 没有 `running` task 时才修订：

1. 读取直接前版 plan、state、完整 task result 和当前差异。
2. 一次聚合当前静止点的全部范围变化、审查结论、验证失败和总验收缺口。
3. 已完成 task 不重跑；把尚未闭环的事实重新整理为一个后继 DAG。
4. 新计划只用 `continuation.previous_plan_path` 指向直接前版；保持同一 `parent_goal`，`revision` 增加 1。
5. 完整保留前版全部 module 定义，可按需增加新 module。线程复用不写入计划，也不由 task id 或 `logical_id` 决定。
6. 后继计划校验成功后，直接前版只保留为结果证据，不再执行；协调器从后继 revision 继续。

内部拆分、依赖重接和同父目标修订沿用原执行方式与授权，不询问用户。只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部副作用、权限升级或无法安全消歧时，才使用 `needs_user_review`。

## 校验与展示

定位当前插件根目录并运行：

```text
node <plugin-root>/scripts/thread-plan.mjs validate <absolute-plan.json>
node <plugin-root>/scripts/thread-plan.mjs render <absolute-plan.json>
```

`validate` 只校验计划和初始化 state，不生成执行路由。校验失败时保留原始错误并修正候选计划。`render` 成功后，按模板提示 DAG 拓扑、用户选择的执行方式和是否执行，并把标准输出原样放入 `mermaid` fenced code block。每个 revision 正常展示一次；Mermaid 不是机器输入。

## 交接

- `parallel_safe`：明确提示存在可并行节点；仅在用户已授权规划后执行时，调用或恢复已选定的 coordination skill。
- `sequential_only`：明确提示当前是合理的串行 DAG，不会因此阻塞；仅在用户已授权规划后执行时，调用或恢复已选定的 coordination skill。
- `needs_user_review`：展示具体用户边界后暂停。

用户要求只规划时，无论 `parallel_safe` 还是 `sequential_only`，展示后都停止，不锁定 `executor_mode`，不调用协调器。

计划生成不代表父目标完成。
