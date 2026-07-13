---
name: parallel-task-planner
description: 当 Codex 主线程收到用户发起的顶层完整任务，或需要修订同一父目标的既有 v3 计划、按稳定 module 复用线程时使用；必须先按真实依赖生成并校验任务 DAG，再决定并行、串行或暂停复核。
---

# 任务 DAG 规划

## 职责

把用户发起的顶层完整 `parent_goal` 整理为简短、可机械校验的 v3 JSON 计划。每个顶层父目标都必须先形成 DAG，不得因为简单、单节点或只能串行而跳过规划。单节点、纯串行、并行和混合拓扑都是合理 DAG；实际并行度只由真实依赖决定。已绑定的 DAG task 不是新的父目标，只由 `$thread-goal-worker` 执行，不得再次进入本 skill 拆分。

`module` 是同一 `parent_goal` 生命周期内稳定的执行职责，不是阶段、角色或 DAG 节点；`task` 是 DAG 节点，也是一次性的执行结果，只通过 `module_id` 选择负责它的 module。线程归属由 `(parent_goal, module_id, thread_role)` 唯一确定；同一归属跨全部 revision 只能对应一个保留线程。

历史任一 revision 已有真实线程且当前没有活动 task 时，后续 task 必须复用。不得因为 revision、task id、`logical_id`、标题、任务文本、错误、终态、`worker_profile` 或 `worker_context` 变化而新建重复线程；profile 与 context 不属于线程身份，`worker_context` 仍只能描述领域边界和不变量。

只负责规划：不创建子线程，不写运行证据，不修改业务文件。用户授权以 `parent_goal` 为单位；同一父目标的安全修正版继承原授权。

## 输出

每次创建唯一计划目录：

```text
.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json
```

写计划前必须读取 [references/templates.md](references/templates.md)，根据“初始计划”或“修正版片段”填充模板。计划文件只写 JSON；执行模式提示和 Mermaid 仅在对话中展示，不写回计划，也不进入机器契约。

默认执行配置为 `gpt-5.6-terra/medium`。用户可为不同 `module` 指定完整的 `model` 与 `reasoning_effort`；不猜测别名，不降低强度。

## 规划顺序

1. 明确可验收的 `parent_goal`、工程现状、已知改动和总验证方式。
2. 按职责、共享契约和工具链划分稳定的领域 `module`。即使模型相同，不同领域也不得合并；不得使用 `implementation`、`review`、`verification`、`compile` 等阶段或角色名，也不得为每个 task 新建或复制近义 module。`worker_context` 只写领域边界和不变量，可随已确认事实更新，但动态错误、task 特有路径和修订说明必须放进 task。
3. 按可独立验收的结果拆分 `task`；不得为了制造并行度拆开真实串行职责，也不得为了减少节点合并本可独立验收的结果。正式实施、审查、验证、诊断和职责变化都必须成为 DAG task，不能留给协调线程临时分派。同一 task 的一次聚焦补修仍属于原职责。每项都写明窄化的 `writable_paths`、`done_when` 和 `verification`。
4. 显式设置 `thread_role`：`work` 正式实施且写域非空；`review` 只读形成审查判断；`verify` 只读执行 build、test 或 lint 并形成可复现证据。后二者的 `writable_paths` 必须为 `[]`，不得产生 tracked diff。工作线程仍需自检，不为重复自检额外创建审查任务。
5. 对初拆结果执行一次前置闭包审计：从每个改动追查调用方、消费者、共享契约、适配层、生成产物、构建入口、缓存与验证缺口。每个已确认影响必须并入唯一 owner task、抽成共享前置 task，或由依赖它的 `verify` task 覆盖；未知可能性不创建任务。
6. 为每项 task 生成当前 revision 内唯一的 `logical_id`；同一逻辑工作项跨 revision 续作时保持该值，职责交接或新工作项使用新值。它只决定 `continue | handoff`，不参与线程归属。另生成不超过 80 字符的可读 `title`，禁止使用“等待绑定包”、单独的 T 编号或其他占位标题。
7. 用 `depends_on` 表达真实依赖。同一 revision 中具有相同 `module_id + thread_role` 的 task 必须在 DAG 中可比；若确实可以同时执行，说明它们属于不同职责，应拆成不同 module。不同线程归属且写域、共享契约、生成产物和运行环境不冲突的 ready task 保持不可比并立即并行；共享职责由唯一前置 task 持有。
8. `project_verification` 只汇总父目标覆盖和已有 task 证据。需要实际运行的正式检查必须规划为 `verify` task，不得在顶层重复执行同一命令。
9. 至少存在两个不可比任务才标记 `parallel_safe`；单节点或纯串行图标记 `sequential_only`；存在真实用户边界时才标记 `needs_user_review`。普通工程证据不足时规划 `review`、`verify` 或诊断 task，不暂停父目标。前两种状态都是可执行计划，不能为了通过入口门禁伪造任务、删除依赖或篡改 safety。

## 修正版规划

收到旧计划、状态、子线程结果或当前差异时，按以下顺序处理：

1. 读取直接前版的 plan、state、任务结果文件和当前差异，确认 `parent_goal` 未变化。已完成与未完成任务产生的可归因改动都属于受控基线。
2. 等待旧计划没有 `running` 后进入静止点；一次性收集本 revision 的全部 `scope_request`、审查结论、验证失败、blocked/failed 证据和工程总验收缺口，只生成一个后继 revision。校验失败时修正同一候选，不增加 revision。
3. 对全部受控基线执行与初始计划相同的闭包审计，不能只检查未完成任务。把现有证据确认的缺口合并进同一 revision，不创建推测任务。
4. 让每项受控基线恰好归属一个新 task。交叉职责抽成唯一共享前置 task；已有唯一负责人时直接转交并重接依赖。验证失败需要代码修改时新建或重接 `work` task，并在其后安排 `verify` task。
5. 一个变化包含多个可独立验收、互不依赖且写域不冲突的结果时拆成不可比 task；真实依赖必须保留，不能按文件数量猜测规模。
6. `reviewed_task_ids` 和 `replacements` 只覆盖旧 state 的全部未完成任务；已完成 task 不重跑，但其改动和失败影响仍参加闭包审计。
7. 任务替代关系与线程归属关系正交：`reviewed_task_ids` 和 `replacements` 只说明未完成旧 task 由哪些新 task 覆盖，不能决定或限制线程复用。驱动器沿完整 continuation 历史自动查找同一 `(parent_goal, module_id, thread_role)` 的最近真实线程；来源为 `completed`、`needs_main_review`、`blocked` 或 `failed` 都必须复用。
8. 复用模式只由 `logical_id` 决定：相同为 `continue`，不同为 `handoff`。`continuation.reuse` 可省略；保留时仅是兼容性断言，空对象不能关闭自动复用，错误断言必须校验失败。一个保留线程任一时刻最多承接一个当前 task。
9. revision 只比直接前版增加 1。驱动器用唯一永久 claim 阻止分叉；不要手工创建、删除或改写 claim。

内部拆分、重接依赖和同父目标修订不要求用户确认。只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部副作用、权限升级或无法安全消歧时，才标记 `needs_user_review`。

审查任务发现需要修改时返回 `needs_main_review`；验证任务发现源码、配置或集成失败时返回 `failed` 与原始证据。两者都不得把自身改成写任务，由主线程在下一 revision 新建或重接 `work` 任务。

## 校验

定位当前 skill 所在插件根目录，运行：

```text
node <plugin-root>/scripts/thread-plan.mjs validate <absolute-plan.json>
```

脚本生成确定性 `dispatch.routes` 和同目录 `state.json`。校验失败时保留原始错误，不手改 route、safety 或运行状态。v1/v2 计划必须重新生成 v3。

每个初始计划和每个 revision 校验成功后立即运行一次：

```text
node <plugin-root>/scripts/thread-plan.mjs render <absolute-plan.json>
```

先按 [references/templates.md](references/templates.md) 提示执行模式，再把输出原样放入 `mermaid` fenced code block，作为当前 revision 的 DAG 展示。`plan.json` 始终是唯一规范来源；Mermaid 只是依赖图的只读投影，不参与 `validate`、`next`、`update`、线程绑定或结果判断。校验失败的候选计划不展示为正式 DAG。正常路径每版展示一次；`render` 首行的 `plan_digest=<digest> revision=<n> safety.status=<status>` 是当前会话的展示证据，计划摘要用于区分 revision 与 safety 相同的不同计划。若校验后、展示前中断，由协调器按完整 marker 补展示。

## 交接

用户以执行意图给出顶层完整任务时，该请求本身就是当前 `parent_goal` 的执行授权，不得二次询问；只有用户明确要求“只规划”或“只讨论”时才不自动交接。脚本校验成功后，初始计划与修正版使用相同交接规则：

- `parallel_safe`：提示并行模式、展示 Mermaid 后立即调用或恢复 `$thread-coordination`。
- `sequential_only`：明确提示将串行执行、展示 Mermaid 后立即调用或恢复 `$thread-coordination`，不等待确认或回复。
- `needs_user_review`：展示 Mermaid 和具体用户边界后暂停。

同父目标修正版继承原授权，不再次询问用户，也不只停在计划路径。计划生成不代表父目标已经完成。
