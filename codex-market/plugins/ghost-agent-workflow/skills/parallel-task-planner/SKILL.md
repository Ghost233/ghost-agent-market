---
name: parallel-task-planner
description: 当 Codex 需要把自然语言目标或现有方案整理为可校验的 v3 任务 DAG、修订同一父目标的既有计划、规划跨版本线程复用，或判断任务应并行、串行还是暂停复核时使用。
---

# 并行任务规划

## 职责

把输入整理为简短、可机械校验的 v3 JSON 计划。`module` 定义跨 revision 稳定的领域执行能力，不是阶段、角色或 DAG 节点；`task` 是 DAG 节点，通过 `module_id` 选择领域上下文与执行配置。

只负责规划：不创建子线程，不写运行证据，不修改业务文件。用户授权以 `parent_goal` 为单位；同一父目标的安全修正版继承原授权。

## 输出

每次创建唯一计划目录：

```text
.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json
```

写计划前必须读取 [references/templates.md](references/templates.md)，根据“初始计划”或“修正版片段”填充模板。只输出 JSON；自然语言和 Markdown 只能作为输入。

默认执行配置为 `gpt-5.6-terra/medium`。用户可为不同 `module` 指定完整的 `model` 与 `reasoning_effort`；不猜测别名，不降低强度。

## 规划顺序

1. 明确可验收的 `parent_goal`、工程现状、已知改动和总验证方式。
2. 按职责、共享契约和工具链划分稳定的领域 `module`。即使模型相同，不同领域也不得合并；不得使用 `implementation`、`review`、`verification`、`compile` 等阶段或角色名，也不得为每个 task 新建 module。`worker_context` 只写跨 revision 稳定的领域边界和不变量，动态错误与路径放进 task。
3. 按可独立验收的结果拆分 `task`；正式实施、审查、验证、诊断和职责变化都必须成为 DAG task，不能留给协调线程临时分派。同一 task 的一次聚焦补修仍属于原职责。每项都写明窄化的 `writable_paths`、`done_when` 和 `verification`。
4. 显式设置 `thread_role`：`work` 正式实施且写域非空；`review` 只读形成审查判断；`verify` 只读执行 build、test 或 lint 并形成可复现证据。后二者的 `writable_paths` 必须为 `[]`，不得产生 tracked diff。工作线程仍需自检，不为重复自检额外创建审查任务。
5. 对初拆结果执行一次前置闭包审计：从每个改动追查调用方、消费者、共享契约、适配层、生成产物、构建入口、缓存与验证缺口。每个已确认影响必须并入唯一 owner task、抽成共享前置 task，或由依赖它的 `verify` task 覆盖；未知可能性不创建任务。
6. 为每项任务生成同一父目标内唯一且跨 revision 稳定的 `logical_id`，并生成不超过 80 字符的可读 `title`。禁止使用“等待绑定包”、单独的 T 编号或其他占位标题。
7. 用 `depends_on` 表达真实依赖。无依赖且写域、共享契约、生成产物和运行环境不冲突的任务保持不可比；共享职责由唯一前置 task 持有。
8. `project_verification` 只汇总父目标覆盖和已有 task 证据。需要实际运行的正式检查必须规划为 `verify` task，不得在顶层重复执行同一命令。
9. 至少存在两个不可比任务才标记 `parallel_safe`；纯串行图标记 `sequential_only`；证据不足或存在真实用户边界时标记 `needs_user_review`。

## 修正版规划

收到旧计划、状态、子线程结果或当前差异时，按以下顺序处理：

1. 读取直接前版的 plan、state、任务结果文件和当前差异，确认 `parent_goal` 未变化。已完成与未完成任务产生的可归因改动都属于受控基线。
2. 等待旧计划没有 `running` 后进入静止点；一次性收集本 revision 的全部 `scope_request`、审查结论、验证失败、blocked/failed 证据和工程总验收缺口，只生成一个后继 revision。校验失败时修正同一候选，不增加 revision。
3. 对全部受控基线执行与初始计划相同的闭包审计，不能只检查未完成任务。把现有证据确认的缺口合并进同一 revision，不创建推测任务。
4. 让每项受控基线恰好归属一个新 task。交叉职责抽成唯一共享前置 task；已有唯一负责人时直接转交并重接依赖。验证失败需要代码修改时新建或重接 `work` task，并在其后安排 `verify` task。
5. 一个变化包含多个可独立验收、互不依赖且写域不冲突的结果时拆成不可比 task；真实依赖必须保留，不能按文件数量猜测规模。
6. `reviewed_task_ids` 和 `replacements` 只覆盖旧 state 的全部未完成任务；已完成 task 不重跑，但其改动和失败影响仍参加闭包审计。
7. 同一 `logical_id` 的续作使用 `continue`；从已完成任务移交给不同职责时使用 `handoff`。只有 `thread_role`、module、profile、context 和真实线程 id 均匹配时才复用；一个旧线程最多映射一个当前任务。
8. revision 只比直接前版增加 1。驱动器用唯一永久 claim 阻止分叉；不要手工创建、删除或改写 claim。

内部拆分、重接依赖和同父目标修订不要求用户确认。只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部副作用、权限升级或无法安全消歧时，才标记 `needs_user_review`。

审查任务发现需要修改时返回 `needs_main_review`；验证任务发现源码、配置或集成失败时返回 `failed` 与原始证据。两者都不得把自身改成写任务，由主线程在下一 revision 新建或重接 `work` 任务。

## 校验

定位当前 skill 所在插件根目录，运行：

```text
node <plugin-root>/scripts/thread-plan.mjs validate <absolute-plan.json>
```

脚本生成确定性 `dispatch.routes` 和同目录 `state.json`。校验失败时保留原始错误，不手改 route、safety 或运行状态。v1/v2 计划必须重新生成 v3。

## 交接

首次计划只有在用户明确授权执行、脚本校验成功且 `safety.status` 为 `parallel_safe` 时，才调用 `$thread-coordination`。

由协调线程请求的同父目标修正版在校验成功后直接恢复 `$thread-coordination`，不再次询问用户，也不只停在计划路径。计划生成不代表父目标已经完成。
