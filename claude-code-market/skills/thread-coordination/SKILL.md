---
name: thread-coordination
description: |
  当用户提供由 `parallel-task-planner` 生成、面向 Claude Code 且标记为 `parallel_safe` 的绝对
  `plan_path`，并要求按拓扑 batch 协调 Agent 或 agent team teammate、最多补修一次和只读总验收时使用。
  用户只给自然语言、owner-domain 任务、手工 worker 包或不完整计划并要求协调执行时也使用，但此类入口只能被阻塞。
---

# Thread Coordination

## 概述

把当前 Claude Code session 作为只读 coordinator，只消费 `$parallel-task-planner` 写出的版本化并发计划。唯一执行入口是一个绝对 `plan_path`；计划通过全部门禁后，按 `dispatch.batches` 使用 Agent 或 agent team teammate 执行单个 module，汇总 `WORKER_RESULT`，最多向原 teammate 补修一次，并对 `parent_goal` 做只读总验收。

不要从自然语言建立执行任务、拆 owner domain、生成 module、补全计划或手工组织 worker 包。不要把 `sequential_only` 或 `needs_user_review` 改成串行执行。入口不合法时只返回 `blocked`，引导用户先使用 `$parallel-task-planner`。

## 只读边界

- coordinator 只读取计划、Agent/team 调度结果、worker 状态、结构化结果和验收证据。
- coordinator 不修改实现文件，不调用 `apply_patch`，不通过 shell 写文件，不 stage、commit、push，也不替 worker 运行修改型命令。
- 构建、生成和测试由对应 worker 执行并回报；coordinator 只可运行 `git status`、`git diff`、`git diff --check` 等只读验收。
- 计划是唯一 scope、依赖和 batch 事实源；不得重新按 ownership 拆分或维护长期 owner registry。
- Claude Code 的实现执行面是 Agent 或 agent team teammate；一次分派只绑定一个 module。

## 计划入口门禁

分派任何 teammate 前，按顺序验证全部条件：

1. 输入包含一个绝对、可读的 `plan_path`。相对路径、自然语言任务、active goal、owner-domain 摘要或手工 module 包都不是执行入口。
2. 顶层 `planner` 严格等于 `parallel-task-planner`，`plan_format_version` 严格等于整数 `1`，`execution_platform` 严格等于 `claude_code`，`dispatch_mode` 严格等于 `parallel-plan`，`review_mode` 严格等于 `diff_self_check`。
3. `parent_goal` 非空，`safety.status` 严格等于 `parallel_safe`。`sequential_only` 和 `needs_user_review` 一律不分派。
4. `modules` 至少包含两个可执行 module。每个 module 有唯一非空 `id`，以及完整的 `task`、`writable_paths`、`depends_on`、`done_when`、`verification`、`worker_context` 和 `worker_profile`。
5. 每个 `worker_profile` 显式包含非空 `model` 与 `reasoning_effort`；coordinator 不继承计划外默认值、不猜测、不补字段。计划不得包含 runtime `worker_profile_evidence`、`reviewer_subagent_profile`、`reviewer_profile_preflight` 或其他 reviewer runtime 字段。
6. `depends_on` 只能引用计划内 module，依赖图无环。`dispatch.batches` 中每个 module id 恰好出现一次，依赖 module 位于更早 batch。
7. 至少一个 batch 含两个以上可同时执行的 module；若每个 batch 宽度都为 `1`，该计划应是 `sequential_only`，不能执行。
8. 用当前工作区重新检查安全证据：同一 batch 的可写路径没有精确、父子或 glob 相交；没有共享 API、迁移、生成输出、全局配置、验证环境或现有用户改动冲突。
9. 计划内容与调用摘要一致，计划未过期，全部 modules 合起来仍覆盖 `parent_goal`。证据不足按冲突处理。

任一条件失败时，不创建或分派 Agent/teammate，不把输入送给 worker，也不尝试修复计划。只返回：

```text
PARALLEL_PLAN_RESULT:
- status: blocked
- plan_path: "<absolute path | missing>"
- blocking_code: plan_required | invalid_plan | platform_mismatch | unsafe_plan | workspace_conflict | profile_unverified
- reasons:
  - "<失败的具体门禁和证据>"
- modules: []
```

直接自然语言场景必须命中 `plan_required`，且不能同时输出 owner-domain 拆分、候选 teammate 或可执行子任务。

## 平台 Profile

Claude Code coordinator 的平台建议默认值是 `opus/max`，worker 默认值是 `sonnet/max`。

- skill 不静默切换当前 coordinator session，也不把提示词中的 `opus/max` 声明写成实际 evidence。
- 不要求读取当前主 session model，也不因缺少这种读取接口永久阻塞。若存在可靠运行时证据，可记录实际值；不可读时记录 `unavailable` 并在最终风险中说明。
- 不要求读取历史 teammate profile。每次 module 分派都以本次 Agent/team 调用实际接受的参数为准。
- module 可以使用 planner 已解析的其他完整 worker profile；不允许选择近似 model、降低 effort 或回退平台默认值。

## Worker 调度证据

对当前 batch 中依赖已满足的每个 module，生成唯一、非空的 `coordinator_assignment_id`，然后使用 Agent 或 agent team teammate 分派。调度调用必须显式携带计划中的 model；effort 使用平台支持的显式参数，或由可验证的 `CLAUDE_EFFORT=max` / 等价 session 证据继承。

成功创建实现 worker 后保存：

```yaml
worker_profile_evidence:
  requested:
    model: <plan.modules[].worker_profile.model>
    reasoning_effort: <plan.modules[].worker_profile.reasoning_effort>
  dispatch_arguments:
    model: <实际 Agent/team model 参数>
    effort: <实际 effort 参数 | inherited>
  status: applied | unavailable | rejected
  evidence: <Agent/team 调度返回、task id 和 effort 证据>
```

只有 Agent/team 调度接口接受 requested model，且所需 effort 已由显式参数、`CLAUDE_EFFORT` 或等价证据确认时，才写 `status: applied` 并允许实现。参数不可表达或证据不可得时写 `unavailable`；调用拒绝参数时写 `rejected`。两者都阻塞该 module，不静默降级。

`worker_profile` 始终是 plan-authored `{model, reasoning_effort}`；runtime 数据只写入 `worker_profile_evidence`。`dispatch_arguments` 必须记录本次实际调用字段，不伪造历史 teammate profile readback。

## 分派包

严格按拓扑 batch 顺序执行；同一 batch 只并发分派依赖已满足且 profile dispatch 为 `applied` 的 modules。每个分派包必须包含：

- `planner: parallel-task-planner`
- `plan_format_version: 1`
- `execution_platform: claude_code`
- 从计划原样传递的 `dispatch_mode: parallel-plan` 与 `review_mode: diff_self_check`
- 绝对 `plan_path`、`parent_goal` 和单个 `module_id`
- `task`、`writable_paths`、`depends_on`、`done_when`、`verification`、`worker_context`
- plan-authored 完整 `worker_profile` 和独立 `worker_profile_evidence`
- coordinator 生成的 `coordinator_assignment_id`
- Agent/team 返回的 `agent_task_id` 或 `team_task_id`；至少一个必须非空且可复核
- `repair_round: 0 | 1`、保护边界、`result_contract: WORKER_RESULT` 和使用 `$thread-goal-worker` 的要求

worker 必须先按 `$thread-goal-worker` 完成来源链、Plan Binding、assignment 和 profile evidence 校验，再执行任何文件操作。不得把计划全文、其他 module 的写权限或完整聊天记录交给 worker。

要求 worker 返回：

```yaml
WORKER_RESULT:
  status: completed | blocked | failed | needs_main_review
  module_id: M1
  dispatch_mode: parallel-plan
  review_mode: diff_self_check
  assignment_evidence:
    coordinator_assignment_id: <assigned id>
    agent_task_id: <Agent id | unavailable>
    team_task_id: <team task id | unavailable>
    status: confirmed | unavailable | mismatch
    evidence: <assignment evidence>
  changed_files: []
  verification: []
  diff_self_check:
    status: pass | failed | not_run
    evidence: []
  worker_profile: {model: <plan value>, reasoning_effort: <plan value>}
  worker_profile_evidence:
    requested: {model: <requested>, reasoning_effort: <requested>}
    dispatch_arguments: {model: <Agent model>, effort: <max | inherited>}
    status: applied | unavailable | rejected
    evidence: <dispatch evidence>
  goal_alignment: []
  risks: []
```

## 结果校验与补修

对任何 `WORKER_RESULT.status`，先校验完整 shape、module id、两个 marker、plan-authored `worker_profile`、`assignment_evidence` 和 `worker_profile_evidence` 是否与分派记录一致。

- `blocked`：只校验上述 shape 与已分派证据；一致时汇总 worker 阻塞原因，不一致时汇总 schema/evidence mismatch。两者都不进入补修或完成门禁。
- 其他状态：非结构化完成、assignment 不匹配、越界文件、缺少 verification、`diff_self_check` 不是完整 mapping、profile evidence 不一致或 status 不是 `applied`，均视为 `needs_fix`，不能完成。
- 实现或验证问题只向原 Agent/teammate follow-up 一次，保持相同 module、assignment、scope 和 profile，记录 `repair_round: 1`。
- profile `unavailable/rejected` 或 assignment `unavailable/mismatch` 不是可补修的实现问题，立即阻塞。

## Batch 与只读总验收

1. 严格按 `dispatch.batches` 顺序执行；等待当前 batch 全部结果后再进入下一 batch。
2. 只有依赖 module 已完成，后续 module 才可分派。有依赖不影响前后 batch 中其他独立 modules 并发。
3. 一次补修后仍不满足时，将 module 标为 `blocked` 或 `needs_main_review`；coordinator 不亲自修改或重新拆 module。
4. 所有 batch 结束后检查 `done_when`、verification、`diff_self_check`、assignment、profile evidence、changed files scope 和父目标覆盖。
5. module 只有 assignment 为 `confirmed`、`diff_self_check.status: pass`、`worker_profile_evidence.status: applied`，且实现与验证证据通过时才能记为 `completed`。

最终返回：

```yaml
PARALLEL_PLAN_RESULT:
  status: completed | partial | blocked
  plan_path: <absolute path>
  plan_format_version: 1
  execution_platform: claude_code
  dispatch_mode: parallel-plan
  review_mode: diff_self_check
  coordinator_profile:
    requested: {model: opus, reasoning_effort: max}
    effective: {model: <runtime value | unavailable>, reasoning_effort: <runtime value | unavailable>}
    status: applied | unavailable | mismatch
    evidence: <runtime evidence or unavailable reason>
  modules:
    - id: M1
      teammate: <Agent/team task id>
      repair_round: 0 | 1
      status: completed | needs_fix | blocked | needs_main_review
      assignment_evidence: {coordinator_assignment_id: <id>, agent_task_id: <id | unavailable>, team_task_id: <id | unavailable>, status: confirmed | unavailable | mismatch, evidence: <evidence>}
      worker_profile: {model: <plan value>, reasoning_effort: <plan value>}
      worker_profile_evidence:
        requested: {model: <requested>, reasoning_effort: <requested>}
        dispatch_arguments: {model: <Agent model>, effort: <max | inherited>}
        status: applied | unavailable | rejected
        evidence: <dispatch evidence>
      diff_self_check:
        status: pass | failed | not_run
        evidence: []
      verification: []
  completion_check:
    parent_goal_coverage: pass | partial | blocked
    writable_path_conflicts: none | found
    unresolved_items: []
```

`coordinator_profile.status: unavailable` 只表示当前 session profile 无法通过运行时接口读取，不单独阻塞计划。只有全部必要 module 证据通过且父目标覆盖为 `pass` 时返回 `completed`。
