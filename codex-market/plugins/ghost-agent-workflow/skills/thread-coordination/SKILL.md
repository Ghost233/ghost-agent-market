---
name: thread-coordination
description: Use when a user explicitly authorizes Codex to execute a `parallel_safe` v2 `parallel-task-planner` plan with user-visible module threads that share the current local project workspace.
---

# Thread Coordination

## 目标

把当前 task 作为只读 coordinator，只消费 `$parallel-task-planner` 生成的 Codex v2 计划。按拓扑 batch 创建模块子线程，保存 `module_id -> thread_id`，回收 `WORKER_RESULT`，最多向原线程补修一次，再汇总完成度。

模块与当前项目共享 `local` 工作区。计划中的写路径和依赖是唯一 ownership 边界；coordinator 不修改实现文件、不 stage、commit 或 push，也不接管失败 module。

## 入口门禁

创建前依次验证：

1. 当前用户明确要求使用子线程执行该计划，或明确调用 `$thread-coordination` 执行该 v2 plan。否则返回 `thread_authorization_required`。
2. 输入是绝对、可读的 `plan_path`；自然语言、相对路径、active goal 或手工 module 不能执行。
3. 顶层字段严格为 `planner: parallel-task-planner`、`plan_format_version: 2`、`execution_platform: codex`、`worker_runtime: codex_child_thread`、`dispatch_mode: parallel-plan`、`review_mode: diff_self_check`。
4. `parent_goal` 非空，`safety.status: parallel_safe`，至少两个 module，且至少一个 batch 宽度大于一。
5. 每个 module 具有唯一 id、`task`、`writable_paths`、`depends_on`、`done_when`、`verification`、`worker_context` 与完整 `worker_profile`。
6. 依赖图无环；每个 module 在 `dispatch.batches` 恰好出现一次，依赖位于更早 batch。
7. 每个 profile 的完整 model id 和 reasoning effort 可由当前 `create_thread` 接口接收；不得猜 alias 或降低 effort。
8. 当前工作区仍安全：同 batch 没有写路径、共享契约、验证产物或环境冲突；已有用户改动没有落入待写范围。
9. 用 `list_projects` 唯一解析当前工作目录对应的 Codex project，并确认可使用本地环境。

任一门禁失败时，不创建子线程、不修复计划、不回退到其他执行方式：

```text
PARALLEL_PLAN_RESULT:
- status: blocked
- plan_path: "<absolute path | missing>"
- blocking_code: thread_authorization_required | plan_required | invalid_plan | platform_mismatch | unsafe_plan | workspace_conflict | project_unavailable | dispatch_unavailable
- reasons:
  - "<失败门禁和证据>"
- modules: []
```

v1 计划必须重新由 planner 生成 v2，不要手改。

## 创建与绑定

每个 ready module 先创建一个预备子线程。预备 prompt 只含唯一 `dispatch_request_id`、`module_id`、禁止修改的边界，以及等待绑定包前不得设置 goal、读取或修改文件的指令。

```text
create_thread(
  target={
    type: project,
    projectId: <resolved project id>,
    environment: {type: local}
  },
  model=<module.worker_profile.model>,
  thinking=<module.worker_profile.reasoning_effort>,
  prompt=<preflight package>
)
```

同 batch 的 ready module 可以并发创建。接口接受 model、thinking 和预备 prompt 并返回 thread id 后，profile 才是 `applied`。创建拒绝或不可用时记录为 blocked，不创建替代线程，也不降低 profile。

创建返回后，立即用同一 id 发送唯一可执行的初始绑定包：

```text
send_message_to_thread(
  threadId=<created thread id>,
  prompt=<dispatch_request_id + complete single-module package + child_thread + profile evidence + repair_round: 0>
)
```

绑定发送失败时保留该线程并将 module 标为 blocked；不要新建替代线程。coordinator 保存：

```yaml
child_thread:
  id: <thread id>
  environment: local
worker_profile_evidence:
  requested:
    model: gpt-5.6-terra
    reasoning_effort: xhigh
  dispatch_arguments:
    model: gpt-5.6-terra
    thinking: xhigh
  status: applied | rejected | unavailable
  evidence: <create_thread request id, arguments, and returned thread id>
```

`requested` 必须逐字段等于 plan-authored profile，`dispatch_arguments` 必须逐字段等于确定性映射。主线程推荐 `gpt-5.6-sol/xhigh`；主线程 profile 不可读不构成永久阻塞。

## 分派包

绑定包只含一个 module，并携带：

- `dispatch_request_id`、v2 marker、绝对 `plan_path`、`parent_goal`、`module_id`。
- 该 module 的 `task`、`writable_paths`、`depends_on`、`done_when`、`verification`、`worker_context`、`worker_profile`。
- coordinator 保存的 `child_thread`、`worker_profile_evidence` 和 `repair_round: 0`。
- `result_contract: WORKER_RESULT`、保护边界、使用 `$thread-goal-worker` 的要求。

不得发送其他 module 的写权限、完整计划或完整聊天记录。worker 收到绑定包前不得执行，收到后先验证计划和 scope。

## 回收、补修与用户干预

按 batch 顺序运行；当前 batch 的全部子线程进入稳定状态并返回结果后才处理下一 batch。低频、退避式使用 `read_thread(includeOutputs: true)` 读取状态和最后一个 plan-bound `WORKER_RESULT`；运行中不算失败。

只接受 `module_id -> thread_id` 映射一致、marker 和 profile evidence 可核对的结果。合法 blocked 结果直接汇总；缺字段、验证不足、goal evidence 不完整或 `diff_self_check.status` 非 `pass` 时，仅向原 thread id 发送一次聚焦补修：

```text
send_message_to_thread(
  threadId=<original thread id>,
  prompt=<same module, same scope, repair_round: 1, focused findings>
)
```

补修不得传入或改变 model、thinking，也不得新建第二个 thread；一次仍失败即停止该 module。

coordinator 记录预备、初始绑定和补修消息。绑定后出现其他用户新指令时，module 标为 `needs_main_review`，其 dependents 不再自动放行。仅查看子线程不影响执行。

越界文件、未计划共享产物、范围扩大或用户已有改动冲突同样为 `needs_main_review`；不要自动回滚共享工作区内容。所有创建过的子线程都保留。

## 只读总验收

只有同时满足以下条件的 module 才能 completed：

1. v2 Plan Binding、module id 和保存的 thread id 一致。
2. `worker_profile_evidence.status: applied`，且与创建调用逐字段一致。
3. 子线程返回的 goal evidence、repair round、changed files、verification 和 `diff_self_check` 完整。
4. changed files 全部位于该 module 的 `writable_paths`。
5. `done_when` 满足，verification 通过或有明确替代证据，`diff_self_check.status: pass`。
6. 没有未解决的依赖、共享文件、用户干预或 scope 冲突。

最终返回：

```text
PARALLEL_PLAN_RESULT:
- status: completed | partial | blocked
- plan_path: "<absolute path>"
- plan_format_version: 2
- execution_platform: codex
- worker_runtime: codex_child_thread
- dispatch_mode: parallel-plan
- review_mode: diff_self_check
- modules:
  - id: M1
    child_thread: {id: "<thread id>", environment: local}
    repair_round: 0 | 1
    status: completed | blocked | failed | needs_main_review
    worker_profile: {model: "<plan value>", reasoning_effort: "<plan value>"}
    worker_profile_evidence:
      requested: {model: "<plan value>", reasoning_effort: "<plan value>"}
      dispatch_arguments: {model: "<canonical model>", thinking: "<effort>"}
      status: applied | rejected | unavailable
      evidence: "<create_thread evidence>"
    diff_self_check: {status: pass | failed | not_run, evidence: ["<summary>"]}
    verification: ["<summary>"]
- completion_check:
  parent_goal_coverage: pass | partial | blocked
  writable_path_conflicts: none | found
  dependency_status: satisfied | blocked
  unresolved_items: ["<none or summary>"]
```
