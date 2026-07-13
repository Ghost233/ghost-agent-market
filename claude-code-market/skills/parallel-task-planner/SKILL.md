---
name: parallel-task-planner
description: 当 Claude Code 主会话收到用户发起的顶层完整目标，或需要修订同一父目标的既有 v3 计划、按稳定 module 复用执行单元时使用；必须先按真实依赖生成并校验任务 DAG，再决定并行、串行或暂停复核。
---

# 任务 DAG 规划

## 职责

把用户发起的顶层完整 `parent_goal` 整理为简短、可机械校验的 v3 JSON 计划。`module` 是同一 `parent_goal` 生命周期内稳定的执行职责，不是阶段、角色或 DAG 节点；`task` 是 DAG 节点，也是一次性的执行结果，只通过 `module_id` 选择负责它的 module。执行单元归属由 `(parent_goal, module_id, thread_role)` 唯一确定；同一归属跨全部 revision 只能对应一个保留执行单元。

历史任一 revision 已有真实执行单元且当前没有活动 task 时，后续 task 必须复用。不得因为 revision、task id、`logical_id`、标题、任务文本、错误、终态、`worker_profile` 或 `worker_context` 变化而新建重复执行单元；profile 与 context 不属于执行单元身份，`worker_context` 仍只能描述领域边界和不变量。

所有顶层父目标都必须先表示为 DAG：单个原子结果是单节点 DAG，具有真实依赖的结果可以组成纯串行 DAG，彼此不可比的结果形成并行或混合 DAG。不得因为任务简单或拓扑只能串行而跳过规划，也不得为制造并行度而拆出虚假任务、删除真实依赖或改写 `safety`。已绑定的 DAG task 不是新的父目标，只由 `$thread-goal-worker` 执行，不得再次进入本 skill 拆分。

只负责规划：不创建执行单元，不写运行证据，不修改业务文件。用户授权以 `parent_goal` 为单位；同一父目标的安全修正版继承原授权。

## 输出

每次创建唯一计划目录：

```text
.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json
```

写计划前必须读取 [references/templates.md](references/templates.md)，根据“初始计划”或“修正版片段”填充模板。计划文件只写 JSON；校验成功后的执行模式与 Mermaid 只用于会话展示，不写入计划或机器契约。

默认执行配置为 `sonnet/max`。用户可为不同 `module` 指定完整的 `model` 与 `reasoning_effort`；不猜测别名，不降低强度。

## 规划顺序

1. 明确可验收的 `parent_goal`、工程现状、已知改动和总验证方式。
2. 做一次初始闭包审计，覆盖入口、调用方、消费者、共享契约、适配层、生成产物、构建接入和验证环境；把证据已经确认的缺口一次纳入计划，不创建推测任务。
3. 按领域职责拆分 `module`，并保持 id 跨 revision 稳定。禁止用 `implementation`、`review`、`compile` 这类任务阶段代替领域，也不得为每个 task 新建或复制近义 module。`worker_context` 只写领域边界和不变量，可随已确认事实更新，但动态错误、task 特有路径和修订说明必须放进 task；profile 与 context 变化不能成为新建执行单元的理由。
4. 按可独立验收的结果拆分 `task`；每项都写明窄化的 `writable_paths`、`done_when` 和 `verification`。
5. 显式设置 `thread_role`：`work` 表示正式实施且 `writable_paths` 非空；`review` 表示只读审查；`verify` 表示编译、类型检查或集成验证。后两者都要求 `writable_paths: []`，不得产生 tracked file 改动。
6. 为每项 task 生成当前 revision 内唯一的 `logical_id`；同一逻辑工作项跨 revision 续作时保持该值，职责交接或新工作项使用新值。它只决定 `continue | handoff`，不参与执行单元归属。另生成不超过 80 字符的可读 `title`，禁止占位标题。
7. 用 `depends_on` 表达真实依赖。同一 revision 中具有相同 `module_id + thread_role` 的 task 必须在 DAG 中可比；若确实可以同时执行，说明它们属于不同职责，应拆成不同 module。不同执行单元归属且写域不冲突的 ready task 保持不可比并立即并行，不增加人工容量判断或全局阶段屏障。
8. 检查写路径、共享契约、生成产物和环境冲突；需要排序的任务必须显式连边。跨领域审查采用各自的“审查 -> 修复 -> 复审”链，只有真实交叉才互相依赖。
9. 任何会影响父目标完成判定的实现、诊断、审查和验证都必须是 DAG task；工作执行单元仍需自检，不为重复自检额外创建审查任务。正式编译等重验证应由 `verify` task 完成。
10. 完整任务集合必须覆盖父目标，并设置 `project_verification`。顶层验收只聚合父目标覆盖、DAG task 证据和最终差异；需要实际运行的 build、test、lint 或正式审查必须规划为 `verify` 或 `review` task，不得在顶层重复执行。至少存在两个不可比任务才标记 `parallel_safe`；单节点或纯串行图标记 `sequential_only`；存在真实用户边界时标记 `needs_user_review`。三者描述拓扑或用户边界，不取代 `validate` 的结构校验；前两者都是可执行 DAG。

## 修正版规划

收到旧计划、状态、执行结果或当前差异时，只在静止点生成一个下一 revision。静止点要求旧 state 没有 `running`，同一执行波次的终态结果已经完整内嵌到 `state.tasks.<id>.result`。

按以下顺序修订：

1. 读取直接前版的 plan、state 及每个终态任务内嵌的完整 `WORKER_RESULT_V3`，确认 `parent_goal` 未变化，并把可由执行单元、任务、文件和结果证据归因的改动视为受控基线。
2. 对全部受控基线做一次修订闭包审计，包括已完成 producer 的改动、全部未完成任务和当前失败，覆盖调用方、消费者、共享契约、适配层、生成产物、构建接入与工程验证缺口；把同一静止点已确认的问题合并到唯一 revision。
3. 让每项受控基线恰好归属一个新任务。交叉职责抽成唯一共享前置任务；已有唯一负责人时直接转交并重接依赖。
4. `needs_main_review`、同父目标内可恢复的 `failed`、内部依赖或环境 `blocked`、以及工程总验收失败，都转换为所需的诊断、修复和 `verify` 任务；不把它们直接升级为用户确认。
5. 一个变化包含多个可独立验收、互不依赖且写域不冲突的结果时拆成不可比任务；真实依赖必须保留，不能按文件数量猜测规模。
6. `reviewed_task_ids` 和 `replacements` 覆盖旧 state 的全部未完成任务。旧计划仍有 `running` 或终态结果尚未内嵌时，不生成 revision。
7. 任务替代关系与执行单元归属关系正交：`reviewed_task_ids` 和 `replacements` 只说明未完成旧 task 由哪些新 task 覆盖，不能决定或限制执行单元复用。驱动器沿完整 continuation 历史自动查找同一 `(parent_goal, module_id, thread_role)` 的最近真实执行单元；来源为 `completed`、`needs_main_review`、`blocked` 或 `failed` 都必须复用。
8. 复用模式只由 `logical_id` 决定：相同为 `continue`，不同为 `handoff`。`continuation.reuse` 可省略；保留时仅是兼容性断言，空对象不能关闭自动复用，错误断言必须校验失败。一个保留执行单元任一时刻最多承接一个当前 task。
9. revision 只比直接前版增加 1。驱动器用唯一永久 claim 阻止分叉；不要手工创建、删除或改写 claim。

内部拆分、重接依赖和同父目标修订不要求用户确认。只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部副作用、权限升级或无法安全消歧时，才标记 `needs_user_review`。普通工程证据不足时规划 `review`、`verify` 或诊断 task，不暂停父目标。

审查任务发现需要修改时，不把自身改成写任务，也不直接修改文件；它返回审查证据，由主会话在下一 revision 新建或重接 `work` 任务，并在修复后复用原审查职责复审。

## 校验

定位当前 skill 所在插件根目录，运行：

```text
node <plugin-root>/scripts/thread-plan.mjs validate <absolute-plan.json>
```

脚本生成确定性 `dispatch.routes` 和同目录 `state.json`。校验失败时保留原始错误，不手改 route、safety 或运行状态。v1/v2 计划必须重新生成 v3。

`validate` 成功后立即运行：

```text
node <plugin-root>/scripts/thread-plan.mjs render <absolute-plan.json>
```

`render` 只从当前 `plan.json` 生成 Mermaid 展示。把它的标准输出原样放入 `mermaid` fenced code block；不写入计划文件，也不参与校验、调度、结果回收或完成判定。正常路径每个初始计划和每个 revision 展示一次；首行的 `plan_digest=<digest> revision=<n> safety.status=<status>` 是当前会话的展示证据，计划摘要用于区分 revision 与 safety 相同的不同计划。若校验后、展示前中断，由协调器按完整 marker 补展示。

展示顺序固定为执行模式提示、`render` 返回的 Mermaid、自动交接或真实用户边界。`parallel_safe` 使用简短并行提示；`sequential_only` 必须原样提示：

```text
执行模式：串行 DAG（sequential_only）
当前计划已通过校验，将按依赖顺序自动执行全部任务，无需确认或介入。
```

提示后不等待回复。`needs_user_review` 仍展示有效计划，但必须说明真实用户边界并暂停；校验失败的候选计划不得作为正式 DAG 展示。

## 交接

用户以执行意图给出顶层完整目标时，该请求本身就是当前 `parent_goal` 的执行授权，不得二次询问；只有用户明确要求“只规划”或“只讨论”时才不自动交接。初始计划和修正版使用同一交接规则：脚本校验成功，且 `safety.status` 为 `parallel_safe` 或 `sequential_only` 时，在完成一次模式提示与 Mermaid 展示后立即调用 `$thread-coordination`。`sequential_only` 只表示协调器将按依赖串行执行，不构成阻塞，也不需要用户再次确认。

同父目标修正版继承原授权，在展示后直接恢复 `$thread-coordination`。只有 `needs_user_review` 或校验失败才暂停。计划生成和展示都不代表父目标已经完成。
