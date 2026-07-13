---
name: parallel-task-planner
description: 当 Codex 主线程收到新的顶层完整任务，或需要在同一 parent_goal 内修订当前 v3 计划时使用；把任务按稳定 module 拆成可校验 DAG，并判断应并行、串行或暂停复核。
---

# 任务 DAG 规划

## 职责

每次用户发起的顶层完整任务都是新的 `parent_goal`，必须先形成 v3 DAG。单节点、纯串行、并行和混合拓扑都合理，不得因为任务简单或只能串行而跳过规划。已绑定的 DAG task 只由当前执行方式对应的 goal worker 执行，不得再次拆成新的父目标。

`module` 是当前 `parent_goal` 内稳定的领域职责；`task` 是一次性 DAG 节点，只通过 `module_id` 选择负责人。执行归属为当前父目标内的 `(module_id, thread_role)`：首次派发创建执行单元，后续 task 和 revision 复用；不同 `parent_goal` 之间绝不复用。

初始计划确定 module 后，其 `id`、`worker_profile` 和 `worker_context` 在当前父目标内固定。需要不同职责或执行配置时定义新 module，不修改已有 module。计划不包含线程路由；驱动器在 `next` 时按当前父目标内的 `(module_id, thread_role)` 归属计算 `action.thread_id`。

本 skill 只规划，不创建线程、不修改业务文件。用户对顶层任务的执行请求就是整个 `parent_goal` 的授权；同一父目标的内部修订继承该授权。

## 输出

在项目中创建：

```text
.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json
```

写入前读取 [references/templates.md](references/templates.md)。计划文件只写 JSON；执行模式和 Mermaid 只在对话中展示。

Codex 默认 module 配置为 `gpt-5.6-terra/medium`。用户可以为初始 module 指定完整 `model` 与 `reasoning_effort`；不猜测别名，不自动降级。

## 执行方式

同一份 plan 可以选择两种执行方式，选择不写入 plan：

- 用户明确选择子线程模式时，交给 `$thread-coordination`，task 由 `$thread-goal-worker` 执行。
- 用户明确选择子代理模式时，交给 `$subagent-coordination`，task 由 `$subagent-goal-worker` 执行。
- 用户未指定时默认子线程模式，不额外询问。

执行开始后由 driver 锁定 `executor_mode`，同一 `parent_goal` 不得中途混用或切换。子代理模式仍使用相同 plan，但不消费 module 的 `worker_profile`。

## 规划流程

1. 明确可验收的 `parent_goal`、当前工程状态和父目标总验证方式。
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

内部拆分、依赖重接和同父目标修订不询问用户。只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部副作用、权限升级或无法安全消歧时，才使用 `needs_user_review`。

## 校验与展示

定位当前插件根目录并运行：

```text
node <plugin-root>/scripts/thread-plan.mjs validate <absolute-plan.json>
node <plugin-root>/scripts/thread-plan.mjs render <absolute-plan.json>
```

`validate` 只校验计划和初始化 state，不生成线程路由。校验失败时保留原始错误并修正候选计划。`render` 成功后，按模板提示执行模式，并把标准输出原样放入 `mermaid` fenced code block。每个 revision 正常展示一次；Mermaid 不是机器输入。

## 交接

- `parallel_safe`：展示后立即调用或恢复已选定的 coordination skill。
- `sequential_only`：明确提示串行执行，展示后立即调用或恢复已选定的 coordination skill，不等待确认。
- `needs_user_review`：展示具体用户边界后暂停。

计划生成不代表父目标完成。
