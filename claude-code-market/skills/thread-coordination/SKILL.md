---
name: thread-coordination
description: |
  当用户提供由 `parallel-task-planner` 生成、面向 Claude Code 且标记为 `parallel_safe` 的绝对
  `plan_path`，并要求按 batch 协调 agent team、最多补修一次和只读总验收时使用。用户只给自然语言、
  owner-domain 任务、手工 worker 包或不完整计划并要求协调执行时也使用，但此类入口只能被阻塞。
---

# Thread Coordination

## 概述

把当前 Claude Code 会话作为只读 coordinator，只消费 `$parallel-task-planner` 写出的版本化并发计划。唯一执行入口是一个绝对 `plan_path`；计划通过全部门禁后，按 `dispatch.batches` 把完整 module 原样分派给 agent team teammate，汇总 `WORKER_RESULT`，最多向原 teammate 补修一次，并对 `parent_goal` 做只读总验收。

不要从自然语言建立 `/goal`、拆 owner domain、生成 module、补全计划或手工组织 worker 包。不要把 `sequential_only` 或 `needs_user_review` 改成串行执行。入口不合法时只返回 `blocked`，引导用户先使用 `$parallel-task-planner`。

## 只读边界

- coordinator 只读取计划、运行时 profile、agent 状态、worker 结果和验收证据。
- coordinator 不修改实现文件，不调用 `apply_patch`，不通过 shell 写文件，不 stage、commit、push，也不替 worker 运行修改型命令。
- 在验收范围内可以运行 `git status`、`git diff`、`git diff --check` 等只读检查；构建、生成和测试由对应 worker 执行并回报。
- 计划是唯一 scope 与依赖事实源。不得重新按 ownership 拆分，也不得维护长期 owner registry。
- Claude Code 的执行面是 agent team teammate；临时 subagent 不能替代实现 worker。

## 计划入口门禁

分派任何 teammate 前，按顺序验证全部条件：

1. 输入包含一个绝对、可读的 `plan_path`。相对路径、自然语言任务、active `/goal`、owner-domain 摘要或手工 module 包都不是执行入口。
2. 顶层 `planner` 必须严格等于 `parallel-task-planner`，`plan_format_version` 必须严格等于整数 `1`，`execution_platform` 必须严格等于 `claude_code`。
3. `parent_goal` 必须非空；`safety.status` 必须严格等于 `parallel_safe`，并保留 planner 写出的判定理由。`sequential_only` 和 `needs_user_review` 一律不分派。
4. `modules` 至少包含两个可执行 module。每个 module 必须有唯一非空 `id`，以及完整的 `task`、`writable_paths`、`depends_on`、`done_when`、`verification`、`worker_context`、`worker_profile` 和 `reviewer_subagent_profile`。
5. 每个 `worker_profile` 和 `reviewer_subagent_profile` 都必须显式包含非空 `model` 与 `reasoning_effort`；coordinator 不继承默认值、不猜测、不补字段。
6. `depends_on` 只能引用计划内 module，依赖图无环。`dispatch.batches` 必须存在，每个 module id 恰好出现一次，且依赖 module 位于更早 batch。
7. 用当前工作区重新检查安全证据：同一 batch 的可写路径没有精确、父子或 glob 相交；没有共享 API、迁移、生成输出、全局配置或验证环境冲突；现有用户改动没有落入将被写入的范围。无关 dirty 文件不单独构成冲突。
8. 计划内容与调用摘要一致，计划未过期，全部 module 合起来仍覆盖 `parent_goal`。证据不足按冲突处理，不允许凭感觉继续。

任一条件失败时，不创建或复用 teammate，不设置 `/goal`，不把输入送给 worker，也不尝试修复计划。只返回：

```text
PARALLEL_PLAN_RESULT:
- status: blocked
- plan_path: "<absolute path | missing>"
- blocking_code: plan_required | invalid_plan | platform_mismatch | unsafe_plan | workspace_conflict | profile_unverified
- reasons:
  - "<失败的具体门禁和证据>"
- modules: []
```

直接自然语言场景必须命中 `plan_required`。不要同时输出 owner-domain 拆分、候选 teammate 或可执行子任务；用户需要先运行 `$parallel-task-planner` 生成新计划。

## Profile 预检

### 主协调会话

分派前先验证当前会话自身 profile，不能由 skill 在运行中静默切换：

```yaml
main_thread_profile:
  requested:
    model: opus
    reasoning_effort: max
  effective:
    model: <运行时实际值>
    reasoning_effort: <运行时实际值>
  status: applied | unavailable | mismatch
  evidence: <运行时或会话接口返回的可复核证据>
```

只有 `effective` 与 `opus/max` 完全一致且 `status: applied` 才能继续。主协调 profile 不接受用户覆盖；无法读取任一字段、运行时不支持 `opus/max` 或任一实际值不匹配时，返回 `profile_unverified`，并说明用户需要以 `opus/max` 创建或重启协调 task。提示词里的模型声明、skill 默认值和自述都不是运行时 evidence。

### Module profile

Claude Code 计划的默认 worker 与 reviewer profile 是 `sonnet/max`。module 可以在 planner 阶段显式覆盖 worker profile；coordinator 只执行计划中已经解析完成的值。`reviewer_subagent_profile` 必须完整且严格等于 `sonnet/max`；其他值说明计划没有满足当前 planner 契约，返回 `invalid_plan`。

`reviewer_profile_preflight` 是 coordinator 在分派前生成的运行时证据，不属于 planner 计划。普通 module 只有在 reviewer 执行面确认能应用并读取 `sonnet/max` 时才写 `status: ready`；已预建并确认实际 profile 时可写 `applied`。只有 `parallel-plan` 的 `diff_self_check` 例外可写 `not_required`，并必须记录例外证据。无法生成可信 preflight 时不分派。

对每个 ready module，在创建或复用 teammate 前验证调度接口能应用并读取所请求的 `model` 与 `reasoning_effort`：

- 已有 teammate 只有在实际 profile 两个字段都可读且与请求完全一致时才能复用。
- profile 不一致时，只能在接口能显式携带两个字段创建匹配 teammate 时创建新的稳定 `name`；不能复用后靠提示词要求 teammate 自行切换。
- 接口无法设置、读取或证明任一字段，模型或 effort 不可用，或有效值不匹配时，停止该 module 和后续 batch，整体返回 `blocked`。
- 不得选择近似模型、降低 effort、回退平台默认值或把 requested 值伪装成 effective 值。

逐 module 保存以下证据：

```yaml
worker_profile:
  requested:
    model: <plan.modules[].worker_profile.model>
    reasoning_effort: <plan.modules[].worker_profile.reasoning_effort>
  effective:
    model: <调度接口实际值>
    reasoning_effort: <调度接口实际值>
  status: applied | unavailable | mismatch
  evidence: <Agent 创建或复用接口的实际返回>
```

`status: applied` 是分派和完成的必要条件。`reviewer_subagent_profile` 使用同样的 `requested`、`effective`、`status`、`evidence` 四字段证据；若 `parallel-plan` worker 按契约只做 `diff_self_check` 而不创建 reviewer subagent，则结果必须写 `status: not_required` 并说明例外证据，不能伪造 `applied`。

## 分派包

只对当前 batch 中依赖已满足且 profile 为 `applied` 的 module 分派。使用稳定 teammate `name` 方便一次补修，但稳定名只服务当前计划。每个分派包必须原样包含：

- `planner: parallel-task-planner`
- `plan_format_version: 1`
- `execution_platform: claude_code`
- 绝对 `plan_path`、`parent_goal` 和单个 `module_id`
- `task`、`writable_paths`、`depends_on`、`done_when`、`verification`、`worker_context`
- 完整 `worker_profile`、`reviewer_subagent_profile` 与 coordinator 获得的 profile evidence
- `reviewer_profile_preflight`（requested/effective/status/evidence）
- `repair_round: 0 | 1`、保护边界、结果契约和使用 `$thread-goal-worker` 的要求

worker 必须先按 `$thread-goal-worker` 校验来源链和 profile，再设置单 module `/goal`。不得把计划全文、其他 module 的写权限或完整聊天记录交给 worker。

要求 worker 返回：

```text
WORKER_RESULT:
- status: completed | blocked | failed | needs_main_review
- module_id: "<Mx>"
- goal_set_evidence: "<单 module goal 的运行时证据>"
- changed_files:
  - "<path>"
- verification:
  - "<定向检查和结果>"
- diff_self_check:
  - "<scope、无关改动和完成条件检查>"
- worker_profile:
  requested: {model: "<requested>", reasoning_effort: "<requested>"}
  effective: {model: "<effective>", reasoning_effort: "<effective>"}
  status: applied | unavailable | mismatch
  evidence: "<运行时证据>"
- reviewer_subagent_profile:
  requested: {model: "sonnet", reasoning_effort: "max"}
  effective: {model: "<effective | not_required>", reasoning_effort: "<effective | not_required>"}
  status: applied | unavailable | mismatch | not_required
  evidence: "<运行时证据或 parallel-plan diff_self_check 例外>"
- reviewer_profile_preflight: {requested: "<requested>", effective: "<effective>", status: ready | applied | not_required, evidence: "<preflight evidence>"}
- goal_alignment:
  - "<如何满足 module done_when 和 parent_goal>"
- risks:
  - "<剩余风险或 none>"
```

普通完成叙述、module id 不匹配、越界文件、缺少验证或 `diff_self_check`、worker profile 不是 `applied`、profile evidence 不匹配、reviewer_profile_preflight 缺失或与计划不一致，都视为 `needs_fix`，不能记为完成。

## Batch 与一次补修

1. 严格按 `dispatch.batches` 顺序执行；同一 batch 只并发分派门禁通过的 ready modules。
2. 等待当前 batch 全部 `WORKER_RESULT` 后再进入下一 batch。依赖未完成时不得提前分派。
3. 每个 module 记录 `repair_round: 0 | 1`。结果不完整或定向验收失败时，只向原 teammate 发送一次聚焦补修，保持相同 module scope 和 profile。
4. profile 不可用或不匹配不是可补修的实现问题，立即阻塞；不得通过第二个 teammate 规避 profile 门禁。
5. 一次补修后仍不满足时，将 module 标为 `blocked` 或 `needs_main_review`。coordinator 不亲自修改、不重新拆 module、不增加补修次数。

## 只读总验收

所有 batch 结束后，只读检查：

- 每个 module 的 `done_when`、定向 verification、`diff_self_check`、goal 对齐和 profile evidence 是否完整。
- `changed_files` 是否都落在对应 `writable_paths`，跨 module 是否出现未计划的文件、共享契约或用户改动冲突。
- 全部 module 是否覆盖 `parent_goal`；阻塞项是否影响父目标完成定义。
- 只有 module 的 worker profile 为 `applied`，reviewer profile 为 `applied` 或合法 `not_required`，且实现与验证证据通过时，才能记为 `completed`。
- 证据不足时标记未验证或阻塞，不替 worker 补做局部实现审查，不把文件数量当作完成证据。

最终返回：

```text
PARALLEL_PLAN_RESULT:
- status: completed | partial | blocked
- plan_path: "<absolute path>"
- plan_format_version: 1
- execution_platform: claude_code
- main_thread_profile:
  requested: {model: opus, reasoning_effort: max}
  effective: {model: "<effective>", reasoning_effort: "<effective>"}
  status: applied | unavailable | mismatch
  evidence: "<运行时证据>"
- modules:
  - id: M1
    teammate: "<stable name>"
    repair_round: 0 | 1
    status: completed | needs_fix | blocked | needs_main_review
    worker_profile:
      requested: {model: "<requested>", reasoning_effort: "<requested>"}
      effective: {model: "<effective>", reasoning_effort: "<effective>"}
      status: applied | unavailable | mismatch
      evidence: "<运行时证据>"
    reviewer_subagent_profile:
      requested: {model: sonnet, reasoning_effort: max}
      effective: {model: "<effective | not_required>", reasoning_effort: "<effective | not_required>"}
      status: applied | unavailable | mismatch | not_required
      evidence: "<运行时证据或例外>"
    verification: "<摘要>"
- completion_check:
  parent_goal_coverage: pass | partial | blocked
  writable_path_conflicts: none | found
  unresolved_items:
    - "<none 或摘要>"
```

只有全部必要证据通过且父目标覆盖为 `pass` 时返回 `completed`。任何非法入口只能返回前述空 modules 的 `blocked` 结果。
