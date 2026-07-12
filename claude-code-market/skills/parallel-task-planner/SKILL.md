---
name: parallel-task-planner
description: 当 Claude Code 需要把自然语言目标或现有方案整理为可校验的 v3 任务 DAG、修订同一父目标的既有计划、规划跨版本执行单元复用，或判断任务应并行、串行还是暂停复核时使用。
---

# 并行任务规划

## 职责

把输入整理为简短、可机械校验的 v3 JSON 计划。`module` 定义可复用的执行配置，不是 DAG 节点；`task` 是 DAG 节点，通过 `module_id` 选择执行配置。

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
2. 仅在执行配置或共享上下文确实不同时拆分 `module`。
3. 按可独立验收的结果拆分 `task`；每项都写明窄化的 `writable_paths`、`done_when` 和 `verification`。
4. 为每项任务生成同一父目标内唯一且跨 revision 稳定的 `logical_id`，并生成不超过 80 字符的可读 `title`。禁止使用“等待绑定包”、单独的 T 编号或其他占位标题。
5. 用 `depends_on` 表达真实依赖。无依赖且写域不冲突的任务保持不可比，不人为串行化。
6. 检查写路径、共享契约、生成产物和环境冲突；需要排序的任务必须显式连边。
7. 完整任务集合必须覆盖父目标，并设置 `project_verification`。
8. 至少存在两个不可比任务才标记 `parallel_safe`；纯串行图标记 `sequential_only`；证据不足或存在真实用户边界时标记 `needs_user_review`。

## 修正版规划

收到旧计划、状态、执行结果或当前差异时，按以下顺序处理：

1. 读取直接前版的 plan 和 state，确认 `parent_goal` 未变化，并把可由执行单元、任务、文件和执行记录归因的改动视为受控基线。
2. 对全部未完成任务做一次闭包审查，覆盖调用方、消费者、共享契约、适配层、生成产物和当前工程验证缺口；把已有证据能确认的缺口合并到同一 revision，不创建推测任务。
3. 让每项受控基线恰好归属一个新任务。交叉职责抽成唯一共享前置任务；已有唯一负责人时直接转交并重接依赖。
4. 一个变化包含多个可独立验收、互不依赖且写域不冲突的结果时拆成不可比任务；真实依赖必须保留，不能按文件数量猜测规模。
5. `reviewed_task_ids` 和 `replacements` 覆盖旧 state 的全部未完成任务。旧计划仍有 `running` 时先回收，不生成 revision。
6. 同一 `logical_id` 的续作使用 `continue`；从已完成任务移交给不同职责时使用 `handoff`。只有 module、profile、context 和真实执行单元 id 均匹配时才复用；一个旧执行单元最多映射一个当前任务。
7. revision 只比直接前版增加 1。驱动器用唯一永久 claim 阻止分叉；不要手工创建、删除或改写 claim。

内部拆分、重接依赖和同父目标修订不要求用户确认。只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部副作用、权限升级或无法安全消歧时，才标记 `needs_user_review`。

## 校验

定位当前 skill 所在插件根目录，运行：

```text
node <plugin-root>/scripts/thread-plan.mjs validate <absolute-plan.json>
```

脚本生成确定性 `dispatch.routes` 和同目录 `state.json`。校验失败时保留原始错误，不手改 route、safety 或运行状态。v1/v2 计划必须重新生成 v3。

## 交接

首次计划只有在用户明确授权执行、脚本校验成功且 `safety.status` 为 `parallel_safe` 时，才调用 `$thread-coordination`。

由协调会话请求的同父目标修正版在校验成功后直接恢复 `$thread-coordination`，不再次询问用户，也不只停在计划路径。计划生成不代表父目标已经完成。
