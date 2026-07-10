---
name: thread-coordination
description: |
  当用户提供由 `parallel-task-planner` 生成、面向 Codex 且标记为 `parallel_safe` 的绝对 plan_path，
  需要按拓扑 batch 创建实现子代理、应用 worker profile、最多补修一次并只读汇总时使用。自然语言、
  手工 module、非法计划或要求使用用户可见 thread/task 执行时也会触发，但只能返回 `blocked`。
---

# Thread Coordination

## 概述

把当前 Codex task 作为只读 coordinator，只消费 `$parallel-task-planner` 写出的版本化并发计划。计划通过门禁后，严格按 `dispatch.batches` 为 ready module 创建实现子代理，追加调度 evidence，收集 `WORKER_RESULT`，最多向同一子代理补修一次，并对 `parent_goal` 做只读汇总。

Codex 实现 worker 只能是当前平台的 implementation subagent。禁止调用 `create_thread`、`fork_thread`、`send_message_to_thread`、`create_task`、`fork_task`、`send_message_to_task` 或任何等价的用户可见 thread/task 接口来执行 module；禁止把 nested Codex CLI、后台进程或 reviewer 伪装成实现 worker。

## 只读边界

- coordinator 只读取计划、工作区状态、子代理调度结果、worker 结果和验收证据。
- coordinator 不修改实现文件，不调用 `apply_patch`，不通过 shell 写文件，不 stage、commit、push，也不替 worker 运行修改型命令。
- 可以运行 `git status`、`git diff`、`git diff --check` 等只读总验收；构建、生成和测试由 module worker 执行。
- 计划是 scope、依赖和 batch 的唯一事实源。不要重新拆 ownership、补 module 或维护历史 thread/task affinity。
- 不创建额外 reviewer；每个实现 worker 自己完成 mapping-shaped `diff_self_check`。

## 计划入口门禁

分派任何实现子代理前，按顺序验证：

1. 输入包含绝对、可读的 `plan_path`。自然语言、active `/goal`、相对路径、手工 module 或普通 owner-domain 包都不是执行入口。
2. 顶层 `planner` 严格等于 `parallel-task-planner`，`plan_format_version` 严格等于整数 `1`，`execution_platform` 严格等于 `codex`，`dispatch_mode` 严格等于 `parallel-plan`，`review_mode` 严格等于 `diff_self_check`。
3. `parent_goal` 非空，`safety.status` 严格等于 `parallel_safe`，且 reasons 保留安全证据。
4. 至少两个 module；每个 module 具有唯一非空 `id` 和完整的 `task`、`writable_paths`、`depends_on`、`done_when`、`verification`、`worker_context`、`worker_profile`。
5. 每个 `worker_profile` 显式包含非空 `model` 与 `reasoning_effort`。计划不得包含 runtime `worker_profile_evidence` 或任何 reviewer profile/preflight 字段。
6. 依赖图无环；`dispatch.batches` 中每个 module id 恰好出现一次，每个依赖位于更早 batch，且至少一个 batch 宽度大于 `1`。所有 batch 宽度为 `1` 的计划应为 `sequential_only`，不得执行。
7. 重新检查当前工作区：同一 batch 的写路径、共享契约、验证产物和环境没有冲突；用户已有改动没有落入待写范围。无关 dirty 文件不单独构成冲突。
8. 计划内容未过期，调用摘要与计划一致，全部 module 合起来仍覆盖 `parent_goal`。证据不足按冲突处理。

任一条件失败时，不创建实现子代理、不设置 goal、不把输入发送给 worker、不修复计划，只返回：

```text
PARALLEL_PLAN_RESULT:
- status: blocked
- plan_path: "<absolute path | missing>"
- blocking_code: plan_required | invalid_plan | platform_mismatch | unsafe_plan | workspace_conflict | dispatch_unavailable
- reasons:
  - "<失败门禁和证据>"
- modules: []
```

## Coordinator Profile

Codex coordinator 推荐使用 `sol/xhigh`，运行时 canonical model 为 `gpt-5.6-sol`。skill 不切换当前主 task，也不要求读取当前主 task 或历史 thread 的 profile。若运行时主动提供 coordinator profile，可以作为信息记录；不可读本身不是永久阻塞条件，提示词和自述也不得伪装成 applied evidence。

## Worker Profile 映射

Codex 默认 module `worker_profile` 为 `terra/xhigh`。coordinator 不从默认值补 module 缺失字段，只转换计划中已经解析完整的值：

1. `worker_profile.model: terra` 映射为子代理调度参数 `model: gpt-5.6-terra`。
2. 其他 model 必须是当前实现子代理接口可识别的完整 model id，并原样用于 `model`；不要猜 alias、近似模型或回退值。
3. `worker_profile.reasoning_effort` 映射为调度参数 `thinking`，值原样传递；不得降低 effort。
4. 创建接口必须同时接受 `model` 与 `thinking`。接口不支持参数或无法调用时为 `unavailable`；接口明确拒绝参数或创建失败时为 `rejected`。

不要读取或复用历史 thread profile。只在实现子代理创建接口实际接受调度参数并返回新 subagent id 后，记录 `applied`：

```yaml
worker_profile_evidence:
  requested:
    model: terra
    reasoning_effort: xhigh
  dispatch_arguments:
    model: gpt-5.6-terra
    thinking: xhigh
  status: applied | unavailable | rejected
  evidence: <实现子代理创建接口的实际结果或拒绝原因>
```

`requested` 必须逐字段等于 plan-authored `worker_profile`；`dispatch_arguments` 必须等于确定性映射结果。`status: applied` 是分派和完成的必要条件。`unavailable` 或 `rejected` 时不启动替代 worker、不静默降级、不消耗补修次数；直接把该 module 和受其依赖的后续 module 标为 blocked。

## 实现子代理选择

- 每个首次 ready module 创建一个新的实现子代理；不要用用户可见 thread/task，也不要把同一 subagent 分给多个 module。
- 同一 batch 的 ready modules 可以并发创建；每次创建都携带该 module 的 `model` 与 `thinking` 调度参数。
- 当前计划内该 module 的唯一补修使用同一 subagent 的 follow-up 机制；不要为补修新建第二个 subagent。
- 实现子代理不能创建、协调或转派其他实现 agent。子代理不可用或失联时记录 blocked，不由 coordinator 接管实现。

## 分派包

只向 profile evidence 为 `applied` 且依赖已完成的 module 分派。每个包只包含一个 module，并原样携带：

- `planner: parallel-task-planner`
- `plan_format_version: 1`
- `execution_platform: codex`
- `dispatch_mode: parallel-plan`
- `review_mode: diff_self_check`
- 绝对 `plan_path`、`parent_goal`、单个 `module_id`
- `task`、`writable_paths`、`depends_on`、`done_when`、`verification`、`worker_context`
- plan-authored `worker_profile`
- coordinator 追加的独立 `worker_profile_evidence`
- `repair_round: 0 | 1`、保护边界、`result_contract: WORKER_RESULT` 和使用 `$thread-goal-worker` 的要求

不得发送计划全文、其他 module 的写权限或完整聊天记录。worker 必须在设置 active goal 或修改文件前完成来源、Plan Binding 和 dispatch evidence 门禁。

## Worker 结果

要求 worker 返回：

```text
WORKER_RESULT:
- status: completed | blocked | failed | needs_main_review
- module_id: "<Mx>"
- dispatch_mode: parallel-plan
- review_mode: diff_self_check
- goal_set_evidence: "<Codex active goal evidence>"
- changed_files:
  - "<path>"
- verification:
  - "<定向检查、结果或替代证据>"
- diff_self_check:
  status: pass | failed | not_run
  evidence:
    - "<scope、done_when、验证和 diff 证据>"
- worker_profile:
  model: "<plan value>"
  reasoning_effort: "<plan value>"
- worker_profile_evidence:
  requested: {model: "<plan value>", reasoning_effort: "<plan value>"}
  dispatch_arguments: {model: "<canonical model>", thinking: "<effort>"}
  status: applied | unavailable | rejected
  evidence: "<dispatch evidence>"
- goal_alignment:
  - "<done_when 与 parent_goal 对齐证据>"
- risks:
  - "<none 或剩余风险>"
```

对所有状态先校验 module id、marker、字段 shape、plan-authored `worker_profile`，以及 `worker_profile_evidence` 是否与分派记录逐字段一致。合法 blocked 结果直接汇总原因，不进入实现补修或完成门禁；shape/evidence 不一致同样汇总为 blocked schema 原因，不消耗补修次数。

非 blocked 结果若缺字段、越界、验证不足、`diff_self_check.status` 不是 `pass`、profile evidence 不是 `applied` 或 goal evidence 不可复核，则为 `needs_fix`，不能记为 completed。

## Batch 与一次补修

1. 严格按 batch 顺序执行。一个 batch 只并发创建依赖已 completed 且调度 evidence 可 applied 的 module。
2. 等待当前 batch 所有结果后再进入下一 batch；依赖 blocked、failed 或 needs_main_review 的 module 不得放行其 dependents。
3. 合法 blocked 结果直接汇总。其他不完整或定向验收失败的结果，只向同一 implementation subagent 发送一次聚焦 follow-up，保持相同 module、scope、profile 与 `repair_round: 1`。
4. profile unavailable/rejected 不是实现补修问题。一次补修仍失败时停止该 module；不创建替代 subagent，不增加轮次。

## 只读总验收

所有可执行 batch 结束后检查：

- 每个 module 的 `done_when`、verification、goal alignment、mapping-shaped `diff_self_check` 和 profile evidence 完整。
- changed files 全部位于对应 `writable_paths`，跨 module 没有未计划的共享文件或用户改动冲突。
- 依赖严格按 batch 完成；blocked module 的 dependents 未被执行。
- 全部 module 合起来覆盖 `parent_goal`，未解决项没有被包装成完成。

只有 goal evidence 可复核、验证通过、`diff_self_check.status: pass`、`worker_profile_evidence.status: applied` 且无 scope/依赖冲突的 module 才能 completed。

最终返回：

```text
PARALLEL_PLAN_RESULT:
- status: completed | partial | blocked
- plan_path: "<absolute path>"
- plan_format_version: 1
- execution_platform: codex
- dispatch_mode: parallel-plan
- review_mode: diff_self_check
- modules:
  - id: M1
    subagent: "<implementation subagent id | unavailable>"
    repair_round: 0 | 1
    status: completed | needs_fix | blocked | needs_main_review
    worker_profile: {model: "<plan value>", reasoning_effort: "<plan value>"}
    worker_profile_evidence:
      requested: {model: "<plan value>", reasoning_effort: "<plan value>"}
      dispatch_arguments: {model: "<canonical model>", thinking: "<effort>"}
      status: applied | unavailable | rejected
      evidence: "<dispatch evidence>"
    diff_self_check:
      status: pass | failed | not_run
      evidence:
        - "<摘要>"
    verification:
      - "<摘要>"
- completion_check:
  parent_goal_coverage: pass | partial | blocked
  writable_path_conflicts: none | found
  dependency_status: satisfied | blocked
  unresolved_items:
    - "<none 或摘要>"
```
