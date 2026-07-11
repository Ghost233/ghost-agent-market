---
name: thread-coordination
description: Use when a user authorizes Claude Code to execute an initial validated parallel_safe v3 plan with Agent or agent-team workers, or when the coordinator continues that same parent_goal through a validated parallel_safe or sequential_only revision in the current project workspace.
---

# Thread Coordination

## 目标

把当前 session 作为只读 coordinator，消费 v3 task DAG，把脚本返回的全部 ready actions 立即翻译为 Agent 或 agent-team teammate 操作。coordinator 不修改业务文件，不 stage、commit 或 push。

用户授权的是完整 `parent_goal`，不是某一版 plan 的冻结写域。worker 只是主 session 完成父目标的执行资源；`writable_paths` 是主 session 分配给 worker 的边界，不是要求用户逐次批准的边界。

## 入口门禁

1. 用户已明确授权执行该计划的 `parent_goal`；该授权自动覆盖同一父目标的安全修正版计划。
2. `plan_path` 是当前项目 `.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json` 的绝对路径。
3. 计划为 `planner: parallel-task-planner`、`plan_format_version: 3`、`execution_platform: claude_code`。首次计划必须是 `safety.status: parallel_safe`；带旧 plan、state 和执行证据的同父目标修正版可为 `parallel_safe` 或 `sequential_only`。
4. 同目录 `state.json` 可读，且以下命令成功：

```text
node <plugin-root>/scripts/thread-plan.mjs validate <plan_path>
```

5. 当前工作树中无法归因的用户改动不落入尚未执行 task 的 `writable_paths`；有 worker/task/changed-files 证据的本轮 worker 改动作为受控基线，不触发此门禁。

首次计划门禁失败时不执行、不修复计划，直接返回 `PARALLEL_PLAN_RESULT` 及原始证据。同父目标修正版若仅有计划结构或 safety 标注错误，由 coordinator 重新生成唯一 revision 并再校验一次，不升级为用户确认。

`validate` 只校验 profile 字段与 effort 枚举，输出 `profile_validation: syntax_only`；model/effort 组合是否可运行以平台创建 worker 的真实结果为准，不自动降级。

## DAG 执行

反复运行：

```text
node <plugin-root>/scripts/thread-plan.mjs next <plan_path> <state_path>
```

每次必须处理返回的全部 actions，再等待任何 worker result。不得因同次其他 task 仍在执行而延后已返回的 action。

- `create_thread`：从 task `module_id` 读取 module profile/context，以 `<plan_path>#<task_id>` 作为 `dispatch_key`，用 Agent 或 agent-team 创建新 worker，并原样检查平台返回的 worker id。
- `reuse_thread`：只使用 action 指定的原 worker id，不自行挑选其他 worker。

第一次未取得真实 worker id 且恢复查询为零匹配时，不运行 `update`，用相同 profile 和 `dispatch_key` 自动重试一次并再次查询。两次都失败才让 task 保持 `pending`，返回 `PARALLEL_PLAN_RESULT.status: dispatch_failed`、`dispatch_key` 和两次原始错误；不得要求用户批准重试，也不得把 profile、参数、网络或平台创建错误写成 task `blocked`。

取得真实 worker id 后，先把它原样写入统一 `thread_id` 字段：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> running <thread_id>
```

再发送完整分派包。发送失败时保留 `running/thread_id`，向同一 worker 自动重发一次；仍失败才返回 `dispatch_failed`。重新进入协调时只向原 worker 补发一次分派包，不创建替代 worker。状态不明或匹配不唯一时保留原状态并进入主 session 内部复核，不把内部复核写成用户批准步骤。

只有已经是 `running` 的 task 收到契约与绑定合法的 worker 结果后，才允许更新；完成条件是否合法决定终止状态，不影响记录 `needs_main_review`。

## 分派包

只发送当前 task：`plan_path`、`state_path`、`parent_goal`、`task_id`、`module_id`、`task`、`depends_on`、`writable_paths`、`done_when`、`verification`、module `worker_context`、实际 `thread_id`、profile/assignment evidence 和 `result_contract: WORKER_RESULT_V3`。不发送其他 task 的写权限。

## 主 session 自主修订

worker 返回 `scope_request`、生成器产生额外文件或实现证明原写域不足时，由 coordinator 决定扩写当前 task、转交其他 module，或在修正版 DAG 中增加依赖。只要父目标不变、改动可归因于本轮 worker、没有未知用户改动、敏感文件、破坏性操作、外部副作用或运行中写冲突，就不得向用户请求确认。

主 session 收到 scope 变化后立即做内部审查：

1. 变化只对应一个可独立验收结果，且不与其他 task 的路径、共享契约或生成产物交叉时，扩写原 task。
2. 变化包含至少两个写域不交叉、可分别验证且互不依赖的结果时，不让原 worker 包办；拆成多个不可比 task，使驱动器同时分派。
3. 变化与其他 task 的路径、共享契约或生成产物交叉时，不同时扩写两个 task。把交叉部分抽成新的共享前置 task，选择匹配该职责的 `module_id`，从下游 task 移除该写域，并让所有消费者依赖新节点；若交叉部分已由其他 task 唯一负责，则直接转交给该 task 并重接依赖。

每个受控 baseline path/change 必须恰好归属一个新 task 的复查范围；交叉基线只归共享前置 owner，不得双重分配。规模判断以“可独立验收结果”为单位，不以文件数量猜测。只有 scope、完成条件和验证都能分离的结果才并行拆分；真实依赖必须保留。

需要修订时，把当前执行产生的已知改动作为受控基线，自动生成新的唯一 v3 plan，重新校验 safety 和写域，在不延迟任何不可比 task 的前提下复用已创建 worker；同一 worker 任一时刻仍只绑定一个 active task。然后立即继续 `$thread-coordination`。旧 state 可保留为审计证据；不得把内部 plan revision 当成最终失败，也不得在 revision 之间返回最终 `PARALLEL_PLAN_RESULT`。

只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部系统副作用、权限升级，或主 session 无法安全消歧时才暂停并询问用户。

## 回收与补修

只接受与当前 `task_id` / `module_id` / `thread_id` 一致的 `WORKER_RESULT_V3`。合法 `completed` 必须满足：changed files 全部在 task scope；`done_when` 满足；verification 通过或有明确替代证据；`diff_self_check: pass`；profile/assignment evidence 可核对；无用户干预或共享文件冲突。

字段缺失、验证不足或普通 diff 自检失败时，仅向原 worker 发送一次聚焦补修。契约与绑定合法且带完整 `scope_request` 的越界结果不做无意义补修，直接更新为 `needs_main_review` 并执行“主 session 自主修订”。补修后仍不合法的结果也进入该内部复核；`needs_main_review` 本身不代表需要用户确认。用户插入新指令时才暂停当前循环，优先处理用户的新意图。

合法结果使用：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> completed|blocked|failed|needs_main_review
```

每次状态改变后立即再运行 `thread-plan.mjs next`。

## 总验收

只有当前 revision 全部 task 为 `completed` 时，才运行顶层 `project_verification`。验收通过才返回 `PARALLEL_PLAN_RESULT.status: completed`。内部 scope 修订、任务重分配或安全重规划必须继续执行，不返回最终 blocked。只有“主 session 自主修订”列出的真实用户边界或无法恢复的工程验收失败，才返回 `blocked` 及原始证据。

所有已创建 worker 保留，不自动关闭。
