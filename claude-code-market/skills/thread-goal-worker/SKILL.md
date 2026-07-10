---
name: thread-goal-worker
description: |
  当 Claude Code Agent 或 agent team teammate 收到 coordinator 从 `parallel-task-planner` 版本化计划
  派发的单一 module assignment，需要校验来源、assignment、profile、scope、验证和 diff，并返回结构化
  `WORKER_RESULT` 时使用。自然语言、普通 owner-domain 或缺字段分派也会触发，但只能返回 `blocked`。
---

# Thread Goal Worker

## 概述

把当前 Claude Code Agent 或 agent team teammate 作为 coordinator 派发的单一 plan module 执行者。唯一执行入口是 coordinator 从 `$parallel-task-planner` 计划原样转发的 assignment 包。先校验计划绑定、Agent/team assignment 和调度 profile evidence；全部通过后才修改 scope 内文件、验证并完成 diff 自检。

本 skill 不依赖 Codex 专属的目标状态机制，也不把自然语言目标声明当作 assignment evidence。不要接受自然语言任务、普通 owner-domain 包、手工 module、计划全文或多个 module；不要补计划字段、切换 profile、降低 reasoning effort、创建或协调其他 worker。入口不合法时必须在任何实现或写入操作前返回 `blocked`。

## 输入门禁

执行任何实现或写入操作前，逐项验证：

1. `planner` 严格等于 `parallel-task-planner`，`plan_format_version` 严格等于整数 `1`，`execution_platform` 严格等于 `claude_code`，`dispatch_mode` 严格等于 `parallel-plan`，`review_mode` 严格等于 `diff_self_check`。
2. 包含绝对、可读的 `plan_path`，非空 `parent_goal` 和唯一 `module_id`；只包含该 module 的权限，不携带其他 module 的写入范围。
3. module 包含非空 `task`、`writable_paths`、`done_when`、`verification` 和 `worker_context`；`depends_on` 必须存在且为合法列表，允许 `[]`。`writable_paths` 是唯一可写 scope。
4. 包含 plan-authored 完整 `worker_profile: {model, reasoning_effort}`，以及独立 `worker_profile_evidence`。后者必须且只能用 `requested`、`dispatch_arguments`、`status` 和 `evidence` 表达调度证据。
5. 包含 coordinator 生成的非空 `coordinator_assignment_id`，以及 Agent/team 调度返回的 `agent_task_id` 或 `team_task_id`；至少一个 task id 必须非空且可复核。worker 输出时不得自行生成或替换这些 id。
6. 包含 `repair_round: 0 | 1`、保护边界和 `result_contract: WORKER_RESULT`。`repair_round: 1` 只授权处理 coordinator 指出的原 finding，不开启新的补修轮次。
7. 分派包不得包含旧 `reviewer_subagent_profile`、`reviewer_profile_preflight`、reviewer runtime evidence、Codex `goal_set_evidence`、active goal 指令或其他未列入当前 assignment schema 的兼容字段；发现任一字段时必须在实现前阻塞，不能忽略后继续。

任一必需字段缺失、为空、无法解析、值不匹配或来源不是 coordinator 分派时，立即返回完整 blocked shape。不要修改文件、运行写入型命令、stage、commit 或 push，也不要从聊天上下文、平台默认值或计划其他位置补齐缺失字段。

## Plan Binding

在实现前读取绝对 `plan_path`。验证顶层 `planner`、`plan_format_version`、`execution_platform`、`dispatch_mode`、`review_mode` 和 `parent_goal`，并逐字段比较 `module_id` 对应原文的 `task`、`writable_paths`、`depends_on`、`done_when`、`verification`、`worker_context` 与 plan-authored `worker_profile`。

手工包、过期计划或任一字段与计划原文不一致时返回 `blocked`。`coordinator_assignment_id`、Agent/team task id 和 `worker_profile_evidence` 是 coordinator 追加的 runtime evidence，只校验 shape、值和分派记录，不与计划原文比较，也不能替代 plan-authored `worker_profile`。

## Assignment 与 Profile 门禁

### Assignment Evidence

确认当前 Agent/team assignment 与输入一致后形成：

```yaml
assignment_evidence:
  coordinator_assignment_id: <输入中的 assignment id>
  agent_task_id: <Agent id | unavailable>
  team_task_id: <team task id | unavailable>
  status: confirmed | unavailable | mismatch
  evidence: <Agent/team assignment 的可复核证据>
```

只有 `coordinator_assignment_id` 非空、至少一个 task id 非空、输入 id 与 coordinator 分派记录一致，且当前 Agent/team assignment 可确认时，才写 `confirmed`。证据不可得写 `unavailable`，值不一致写 `mismatch`；两者都必须在实现前 `blocked`。提示词自述、module id 或 worker 自建 id 不算 assignment evidence。

### Worker Profile Evidence

Claude Code worker 默认请求是 `sonnet/max`，planner module 可以提供 Agent 接口支持的其他完整 profile。输入必须使用以下 shape：

```yaml
worker_profile_evidence:
  requested:
    model: <plan worker_profile.model>
    reasoning_effort: <plan worker_profile.reasoning_effort>
  dispatch_arguments:
    model: <实际 Agent/team model 参数>
    effort: <实际 effort 参数 | inherited>
  status: applied | unavailable | rejected
  evidence: <Agent/team 调度结果、task id 和 effort 证据>
```

`requested` 必须严格等于 plan-authored `worker_profile`。只有 Agent/team 调度接口接受 requested model，且 requested effort 已由显式参数、`CLAUDE_EFFORT` 或等价 session 证据确认时，`status` 才能为 `applied` 并允许实现。参数不可表达或 effort 无法确认时写 `unavailable`；调度拒绝参数时写 `rejected`。两者都在实现前 `blocked`，不得静默使用默认值、近似模型或较低 effort。

不要求不存在的历史 teammate profile readback，也不把提示词、自述、skill 默认值或计划文本当作 runtime evidence。worker 不修改 coordinator 提供的 `worker_profile_evidence`，只校验它与计划、assignment 和实际分派记录一致。

## Blocked 结果

输入、Plan Binding、assignment 或 profile 门禁失败时仍返回与正常结果相同的字段；未知值写 `unavailable`，列表字段保留为空或记录未执行原因：

```yaml
WORKER_RESULT:
  status: blocked
  module_id: <Mx | unavailable>
  dispatch_mode: <parallel-plan | unavailable>
  review_mode: <diff_self_check | unavailable>
  assignment_evidence:
    coordinator_assignment_id: <assigned id | unavailable>
    agent_task_id: <Agent id | unavailable>
    team_task_id: <team task id | unavailable>
    status: confirmed | unavailable | mismatch
    evidence: <assignment evidence 或精确失败原因>
  changed_files: []
  verification:
    - "not_run: input, plan, assignment, or profile gate failed"
  diff_self_check:
    status: not_run
    evidence: []
  worker_profile:
    model: <plan value | unavailable>
    reasoning_effort: <plan value | unavailable>
  worker_profile_evidence:
    requested: {model: <requested | unavailable>, reasoning_effort: <requested | unavailable>}
    dispatch_arguments: {model: <dispatch value | unavailable>, effort: <dispatch value | unavailable>}
    status: applied | unavailable | rejected
    evidence: <dispatch evidence 或精确失败原因>
  goal_alignment:
    - not_started
  risks:
    - <blocking reason>
```

blocked 结果不要求完成门禁已经满足，但必须保留所有可获得的 plan、assignment 和 profile evidence；不得省略字段或退回旧 shape。

## Scope 与执行循环

通过全部门禁后按固定循环执行：

```text
确认 assignment -> 检查 scope -> 实现 -> 验证 -> diff 自检 -> 最多补修一次 -> WORKER_RESULT
```

1. 编辑前读取候选文件和现有用户改动；每个目标文件必须属于 `writable_paths`、不在保护边界内，并直接满足 `task` 与 `done_when`。
2. 最小合并已有改动，不覆盖或重排无关内容。共享契约冲突、未满足依赖、并行写冲突或需要扩大 scope 时停止并返回非完成状态。
3. 只执行 `verification` 或保护边界明确授权的构建、测试、生成和格式化命令；不得安装依赖。
4. 检查 changed files、scope、用户改动、`done_when`、验证证据、diff 聚焦度和共享文件冲突，并记录 mapping-shaped `diff_self_check`。
5. scope 内问题只允许修复并复验一次。`repair_round: 1` 或第二次失败时停止；超 scope finding 不自行修复。

## 结果契约

所有状态只返回同一个 `WORKER_RESULT` shape：

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
  worker_profile:
    model: <plan value>
    reasoning_effort: <plan value>
  worker_profile_evidence:
    requested: {model: <plan value>, reasoning_effort: <plan value>}
    dispatch_arguments: {model: <Agent model>, effort: <max | inherited>}
    status: applied | unavailable | rejected
    evidence: <dispatch evidence>
  goal_alignment:
    - <done_when 与 parent_goal 的满足证据>
  risks:
    - <none 或剩余风险>
```

`completed` 必须同时满足：Plan Binding 通过；`assignment_evidence.status: confirmed`；全部 changed files 在 scope 内；`done_when` 已满足；verification 通过或有明确替代证据；`diff_self_check.status: pass`；`worker_profile_evidence.status: applied`；没有未解决的 scope、依赖或共享文件冲突；唯一补修上限未被突破。

`blocked` 只校验 marker、module id、完整 shape 和已经分派的 assignment/profile evidence，然后回报阻塞原因；不要为 blocked 结果进入实现补修或伪造完成证据。`failed` 表示已授权执行失败且无法在允许轮次内修复；`needs_main_review` 表示需要 coordinator 或用户处理的超 scope 风险。

## 反模式

- 依赖 Codex 专属目标状态，或返回额外的目标设置证据字段。
- 接受没有 planner 来源链、assignment id 或 Agent/team task id 的包。
- 忽略旧 reviewer/profile-preflight、`goal_set_evidence` 或其他额外兼容字段后继续执行。
- 用旧 `effective` profile shape、非 mapping 的 `diff_self_check` 或提示词自述代替 runtime evidence。
- 自行生成 assignment id、改写 plan-authored profile 或创建额外审查 Agent。
- 越过 scope、跳过验证或 diff 自检、开启第二轮补修后仍写 `completed`。
