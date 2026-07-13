---
name: parallel-task-planner
description: 当 Claude Code 需要把自然语言目标或现有方案整理为可校验的 v3 任务 DAG、按领域组织执行配置、修订同一父目标的既有计划、规划跨版本执行单元复用，或判断任务应并行、串行还是暂停复核时使用。
---

# 并行任务规划

## 职责

把输入整理为简短、可机械校验的 v3 JSON 计划。`module` 定义稳定的领域职责、执行配置和共享上下文，不是 DAG 节点；`task` 是 DAG 节点，通过 `module_id` 选择负责该结果的领域。

只负责规划：不创建执行单元，不写运行证据，不修改业务文件。用户授权以 `parent_goal` 为单位；同一父目标的安全修正版继承原授权。

## 输出

每次创建唯一计划目录：

```text
.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json
```

写计划前必须读取 [references/templates.md](references/templates.md)，根据“初始计划”或“修正版片段”填充模板。只输出 JSON；自然语言和 Markdown 只能作为输入。

默认执行配置为 `sonnet/max`。用户可为不同 `module` 指定完整的 `model` 与 `reasoning_effort`；不猜测别名，不降低强度。

## 规划顺序

1. 明确可验收的 `parent_goal`、工程现状、已知改动和总验证方式。
2. 做一次初始闭包审计，覆盖入口、调用方、消费者、共享契约、适配层、生成产物、构建接入和验证环境；把证据已经确认的缺口一次纳入计划，不创建推测任务。
3. 按领域职责拆分 `module`，并保持 id 跨 revision 稳定。禁止用 `implementation`、`review`、`compile` 这类任务阶段代替领域；同一领域仅在 profile 或上下文确实不同且不能安全共享时再拆分。
4. 按可独立验收的结果拆分 `task`；每项都写明窄化的 `writable_paths`、`done_when` 和 `verification`。
5. 显式设置 `thread_role`：`work` 表示正式实施且 `writable_paths` 非空；`review` 表示只读审查；`verify` 表示编译、类型检查或集成验证。后两者都要求 `writable_paths: []`，不得产生 tracked file 改动。
6. 为每项任务生成同一父目标内唯一且跨 revision 稳定的 `logical_id`，并生成不超过 80 字符的可读 `title`。禁止占位标题。
7. 用 `depends_on` 表达真实依赖。无依赖且写域不冲突的任务保持不可比，不增加人工容量判断或全局阶段屏障。
8. 检查写路径、共享契约、生成产物和环境冲突；需要排序的任务必须显式连边。跨领域审查采用各自的“审查 -> 修复 -> 复审”链，只有真实交叉才互相依赖。
9. 任何会影响父目标完成判定的实现、诊断、审查和验证都必须是 DAG task；工作执行单元仍需自检，不为重复自检额外创建审查任务。正式编译等重验证应由 `verify` task 完成。
10. 完整任务集合必须覆盖父目标，并设置 `project_verification`。至少存在两个不可比任务才标记 `parallel_safe`；纯串行图标记 `sequential_only`；存在真实用户边界时标记 `needs_user_review`。

## 修正版规划

收到旧计划、状态、执行结果或当前差异时，只在静止点生成一个下一 revision。静止点要求旧 state 没有 `running`，同一执行波次的终态结果已经完整内嵌到 `state.tasks.<id>.result`。

按以下顺序修订：

1. 读取直接前版的 plan、state 及每个终态任务内嵌的完整 `WORKER_RESULT_V3`，确认 `parent_goal` 未变化，并把可由执行单元、任务、文件和结果证据归因的改动视为受控基线。
2. 对全部未完成任务和当前失败做一次修订闭包审计，覆盖调用方、消费者、共享契约、适配层、生成产物、构建接入与工程验证缺口；把同一静止点已确认的问题合并到唯一 revision。
3. 让每项受控基线恰好归属一个新任务。交叉职责抽成唯一共享前置任务；已有唯一负责人时直接转交并重接依赖。
4. `needs_main_review`、同父目标内可恢复的 `failed`、内部依赖或环境 `blocked`、以及工程总验收失败，都转换为所需的诊断、修复和 `verify` 任务；不把它们直接升级为用户确认。
5. 一个变化包含多个可独立验收、互不依赖且写域不冲突的结果时拆成不可比任务；真实依赖必须保留，不能按文件数量猜测规模。
6. `reviewed_task_ids` 和 `replacements` 覆盖旧 state 的全部未完成任务。旧计划仍有 `running` 或终态结果尚未内嵌时，不生成 revision。
7. 同一 `logical_id` 的续作使用 `continue`；从已完成任务移交给不同职责时使用 `handoff`。只有 `thread_role`、module、profile、context 和真实执行单元 id 均匹配时才复用；一个旧执行单元最多映射一个当前任务。
8. revision 只比直接前版增加 1。驱动器用唯一永久 claim 阻止分叉；不要手工创建、删除或改写 claim。

内部拆分、重接依赖和同父目标修订不要求用户确认。只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部副作用、权限升级或无法安全消歧时，才标记 `needs_user_review`。

审查任务发现需要修改时，不把自身改成写任务，也不直接修改文件；它返回审查证据，由主会话在下一 revision 新建或重接 `work` 任务，并在修复后复用原审查职责复审。

## 校验

定位当前 skill 所在插件根目录，运行：

```text
node <plugin-root>/scripts/thread-plan.mjs validate <absolute-plan.json>
```

脚本生成确定性 `dispatch.routes` 和同目录 `state.json`。校验失败时保留原始错误，不手改 route、safety 或运行状态。v1/v2 计划必须重新生成 v3。

## 交接

首次计划只有在用户明确授权执行、脚本校验成功且 `safety.status` 为 `parallel_safe` 时，才调用 `$thread-coordination`。

由协调会话请求的同父目标修正版在校验成功后直接恢复 `$thread-coordination`，不再次询问用户，也不只停在计划路径。计划生成不代表父目标已经完成。
