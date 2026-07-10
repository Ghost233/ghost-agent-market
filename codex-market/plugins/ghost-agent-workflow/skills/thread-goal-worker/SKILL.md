---
name: thread-goal-worker
description: Use when a user-visible Codex module thread receives a bound v2 `parallel-task-planner` dispatch package and must implement one scoped module, manage its own goal, and return a verified result.
---

# Thread Goal Worker

## 目标

把当前用户可见 Codex 模块子线程作为单个 plan module 的 owner。coordinator 先创建预备线程，随后把带真实 thread id 的绑定包发送到同一线程；只有绑定包可以启动实现。

模块子线程负责 goal、scope、实现、验证、diff 自检和 `WORKER_RESULT`。它可以自行使用普通子代理协助，但这些内部子代理不属于主线程的调度、模型配置或身份映射。

## 预备与绑定

收到预备包时，只确认其中的 `dispatch_request_id` 和 `module_id`，然后等待绑定包。预备阶段不得设置 goal、读取实现文件、修改文件、运行命令或创建内部子代理。

收到绑定包后，在任何实现动作前验证：

1. 包含与预备包相同的 `dispatch_request_id`、唯一 `module_id`、绝对 `plan_path` 和非空 `parent_goal`。
2. marker 严格为 `planner: parallel-task-planner`、`plan_format_version: 2`、`execution_platform: codex`、`worker_runtime: codex_child_thread`、`dispatch_mode: parallel-plan`、`review_mode: diff_self_check`。
3. 包只携带一个 module，并包含 `task`、`writable_paths`、`depends_on`、`done_when`、`verification`、`worker_context`、完整 `worker_profile`、`child_thread`、`worker_profile_evidence`、`repair_round: 0 | 1` 和 `result_contract: WORKER_RESULT`。
4. `child_thread.id` 非空且 `environment: local`。当前线程把这个绑定 id 原样用于结果；coordinator 负责将它与创建记录核对，worker 不伪造或替换该值。
5. `worker_profile_evidence.requested` 与 module `worker_profile` 逐字段相等；`dispatch_arguments.model` 等于 requested model；`dispatch_arguments.thinking` 等于 requested reasoning effort；`status: applied`，并有创建请求和 thread id evidence。
6. `repair_round: 1` 必须来自当前 module 的同一绑定线程，且只处理 coordinator 指出的 finding；不启动第二次补修。

任何字段缺失、预备与绑定 request id 不一致、Plan Binding 失败、profile evidence 非 `applied` 或 scope 不可核对时，返回完整 blocked `WORKER_RESULT`。不要设置 goal、读取实现文件、修改文件、stage、commit 或 push。

## Plan Binding

输入门禁通过后、设置 goal 前读取 `plan_path` 并验证：

- 顶层 marker、`parent_goal` 和计划来源与绑定包一致。
- `module_id` 在计划中唯一存在。
- `task`、`writable_paths`、`depends_on`、`done_when`、`verification`、`worker_context` 和 plan-authored `worker_profile` 与该 module 原文逐字段一致。
- 计划不包含 runtime `child_thread` 或 `worker_profile_evidence`；绑定包不包含其他 module 的任务、上下文或写权限。

绑定包中的 profile evidence 是 coordinator 的创建记录，不能覆盖计划 profile。提示词、默认值或自述不能替代该 evidence；不要猜 model alias 或降低 reasoning effort。

## Goal 与 Scope

Plan Binding 通过后，读取当前 goal。若当前 active goal 已绑定相同 `module_id`、scope 和 repair round，则恢复它；否则为当前 module 创建 goal 并二次确认。首次执行完成后更新 goal。补修时无法恢复原 goal 才在同一子线程创建绑定相同 module 的 repair goal。

返回结构化 evidence：

```yaml
goal_set_evidence:
  child_thread_id: <bound thread id>
  module_id: M1
  repair_round: 0
  action: created | resumed | repair_created
  goal_id: <goal id>
  status: active | complete | blocked
```

每次编辑前确认文件属于 `writable_paths`，不在保护边界内，并直接服务于 `task` 和 `done_when`。先只读检查候选文件和已有用户改动；遇到依赖未完成、共享冲突、需要扩大 scope 或未授权命令时停止并返回对应状态。

## 内部子代理

模块子线程可以自行调用普通子代理进行读取、实现建议或受限辅助。所有内部子代理必须服从当前 module 的 goal、`writable_paths`、保护边界、verification 和 done_when，不得创建用户可见 thread，不得扩大 scope。

不要在结果中配置、枚举或伪造内部子代理的 model、thinking、thread id 或 profile evidence。无论内部代理数量如何，模块子线程自己对实际修改、验证、diff 自检和最终结果负责。

## 执行与自检

执行循环固定为：

```text
确认 goal -> 检查 scope -> 实现 -> 验证 -> diff 自检 -> WORKER_RESULT
```

1. 在 `writable_paths` 内完成当前 module，保护已有改动。
2. 执行授权 `verification`；不能执行时记录原因和明确替代证据。
3. 检查 changed files、scope、用户改动、done_when、验证证据、diff 聚焦度和共享文件冲突。
4. 使用 `diff_self_check: {status: pass | failed | not_run, evidence: []}`，不得改为字符串或列表。
5. scope 内问题在本轮修复并复验；`repair_round: 1` 仍失败或出现超 scope finding 时停止。

## 结果契约

所有状态返回：

```text
WORKER_RESULT:
- status: completed | blocked | failed | needs_main_review
- module_id: "<module id>"
- dispatch_mode: parallel-plan
- review_mode: diff_self_check
- child_thread: {id: "<bound thread id>", environment: local}
- goal_set_evidence:
    child_thread_id: "<bound thread id>"
    module_id: "<module id>"
    repair_round: 0 | 1
    action: created | resumed | repair_created
    goal_id: "<goal id | unavailable>"
    status: active | complete | blocked
- changed_files: ["<path>"]
- verification: ["<result or alternative evidence>"]
- diff_self_check: {status: pass | failed | not_run, evidence: ["<summary>"]}
- worker_profile: {model: "<plan value>", reasoning_effort: "<plan value>"}
- worker_profile_evidence:
    requested: {model: "<plan value>", reasoning_effort: "<plan value>"}
    dispatch_arguments: {model: "<canonical model>", thinking: "<effort>"}
    status: applied | rejected | unavailable
    evidence: "<create_thread evidence>"
- goal_alignment: ["<done_when to parent_goal evidence>"]
- risks: ["<none or remaining risk>"]
```

`completed` 要求 goal、scope、verification、`done_when`、diff self-check 和 applied profile evidence 全部通过。`blocked` 表示实现前的输入、binding、goal、依赖或外部阻塞；不可获得字段写 `unavailable`。`failed` 表示进入实现后验证或自检失败。`needs_main_review` 表示用户干预、共享冲突、越界修改或需要主线程决策；不得自行扩大 scope。
