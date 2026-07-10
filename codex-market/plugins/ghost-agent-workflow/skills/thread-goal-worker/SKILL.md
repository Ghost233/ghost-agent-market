---
name: thread-goal-worker
description: |
  当 Codex implementation subagent 收到 coordinator 从 `parallel-task-planner` 版本化计划分派的单一
  module 包，需要在修改前校验计划绑定、profile dispatch evidence 和 active `/goal`，并在限定 scope
  内实现、验证和返回 `WORKER_RESULT` 时使用。自然语言、用户可见 thread/task 或缺字段分派只能阻塞。
---

# Thread Goal Worker

## 概述

把当前 Codex implementation subagent 作为一个 plan module 的执行者。唯一入口是 `$thread-coordination` 从 `$parallel-task-planner` 计划转发的单 module 分派包；首次分派使用新的 implementation subagent，唯一一次补修使用同一 subagent 的 follow-up。

先完成输入、Plan Binding 和 profile dispatch evidence 门禁，再为当前 module 设置并二次确认 active `/goal`。之后只在授权 scope 内实现、验证并完成 mapping-shaped `diff_self_check`。不要接受自然语言、计划全文、多个 module、用户可见 thread/task、nested Codex CLI 或其他 agent 的转派；不要创建或协调任何实现 agent。

## 输入门禁

在设置 goal、读取实现文件或执行写入型操作前，逐项验证：

1. 分派来源是 `$thread-coordination`，且当前执行者是 Codex implementation subagent，不是 `create_thread`、`fork_thread`、`send_message_to_thread`、`create_task`、`fork_task`、`send_message_to_task` 或等价用户可见 thread/task 创建的执行者。
2. `planner` 严格等于 `parallel-task-planner`，`plan_format_version` 严格等于整数 `1`，`execution_platform` 严格等于 `codex`，`dispatch_mode` 严格等于 `parallel-plan`，`review_mode` 严格等于 `diff_self_check`。
3. 包含绝对、可读的 `plan_path`、非空 `parent_goal` 和唯一 `module_id`。包只携带该 module，不包含其他 module 的任务、上下文或写权限。
4. module 具有非空 `task`、`writable_paths`、`done_when`、`verification`、`worker_context` 和完整 `worker_profile`；`depends_on` 存在且为合法列表。`worker_profile` 显式包含非空 `model` 与 `reasoning_effort`。
5. 包含 coordinator 追加的独立 `worker_profile_evidence`，其 shape 严格为 `requested`、`dispatch_arguments`、`status`、`evidence`；`requested` 是 `{model, reasoning_effort}`，`dispatch_arguments` 是 `{model, thinking}`，`status` 只能是 `applied | unavailable | rejected`。
6. 包含 `repair_round: 0 | 1`、保护边界、`result_contract: WORKER_RESULT`。`repair_round: 1` 必须来自同一 coordinator 对同一 subagent 的聚焦 follow-up，只授权处理原 finding，不开启第二次补修。
7. 分派包不得包含旧 `reviewer_subagent_profile`、`reviewer_profile_preflight`、reviewer runtime evidence、Claude `assignment_evidence` 或其他未列入当前 Codex subagent schema 的兼容字段；发现任一字段时必须在设置 goal 或读取实现前阻塞，不能忽略后继续。

任一项缺失、为空、无法解析、来源不符或值不匹配时，立即返回完整的 blocked `WORKER_RESULT`。不要设置或更新 goal，不要读取实现文件、修改文件、运行写入型命令、stage、commit 或 push，也不要从聊天上下文、平台默认值或计划其他位置补字段。

## Plan Binding

输入门禁通过后、设置 goal 前读取 `plan_path`，并验证：

- 顶层 marker、`parent_goal` 和计划来源与分派包一致。
- `module_id` 在计划中唯一存在。
- 分派包的 `task`、`writable_paths`、`depends_on`、`done_when`、`verification`、`worker_context` 和 plan-authored `worker_profile` 与该 module 原文逐字段一致。
- 计划不包含 runtime `worker_profile_evidence`；分派包不包含其他 module 或超出计划的写权限。

`worker_profile_evidence` 是 coordinator 创建当前 implementation subagent 后追加的 runtime evidence，不与计划原文比较，也不能覆盖 plan-authored `worker_profile`。任一 binding 失败时在 goal 和文件操作前返回 blocked。

## Profile Dispatch Evidence

worker 不读取历史 thread profile，也不要求不存在的当前模型 readback。只校验 coordinator 的实际子代理创建结果：

1. `worker_profile_evidence.requested` 与 plan-authored `worker_profile` 逐字段相等。
2. 当 requested model 为友好 alias `terra` 时，`dispatch_arguments.model` 必须是 `gpt-5.6-terra`；其他 requested model 必须是调度接口可识别的完整 model id，且 `dispatch_arguments.model` 与其完全相等。
3. `dispatch_arguments.thinking` 必须与 `requested.reasoning_effort` 完全相等。默认 `terra/xhigh` 的完整映射必须是：

```yaml
worker_profile_evidence:
  requested:
    model: terra
    reasoning_effort: xhigh
  dispatch_arguments:
    model: gpt-5.6-terra
    thinking: xhigh
  status: applied
  evidence: <implementation subagent 创建接口返回的 subagent id 与已接受参数>
```

4. 只有创建接口实际接受 `model` 与 `thinking`、返回当前 implementation subagent id，且 `status: applied` 时才继续。`unavailable`、`rejected`、证据缺失或映射不一致都在设置 goal 和文件操作前 blocked。

提示词、自述、skill 默认值、计划文本和推荐 profile 都不能替代 dispatch evidence。worker 不自行切换 profile、不猜 alias、不选择近似模型，也不降低 reasoning effort。

## Active Goal 与 Scope

所有前置门禁通过后，先读取当前 goal 状态，再用平台的 `/goal` 机制设置或复用只对应该 module 的 active goal。goal 至少包含 `module_id`、`parent_goal`、`task`、`writable_paths`、保护边界、`verification` 和 `done_when`。二次读取必须确认 goal 为 active 且内容与分派一致；无法读取、设置或确认时返回 blocked，不修改文件。

`goal_set_evidence` 必须记录首次 goal 状态、实际 goal 操作，以及二次读取确认到的 active 状态和 module id。提示词中的目标声明不是 evidence。

- 每次编辑前确认文件属于 `writable_paths`、不在保护边界内，且改动直接满足 `task` 与 `done_when`。
- 先只读检查候选文件和已有用户改动；最小合并，不覆盖或重排无关内容。
- 共享契约冲突、未满足依赖、并行写冲突、需要扩大 scope 或需要未授权命令时停止。
- 构建、测试、生成和格式化只执行 `verification` 或保护边界明确授权的命令；不得安装依赖。

## 有上限的执行循环

执行循环固定为：

```text
确认 active goal -> 检查 scope -> 实现 -> 验证 -> diff 自检 -> 最多补修一次 -> WORKER_RESULT
```

1. 在 `writable_paths` 内完成当前 module，保护已有改动。
2. 执行全部授权 `verification`；不能执行时记录原因和明确替代证据。
3. 检查 changed files、scope、用户改动、`done_when`、验证证据、diff 聚焦度和共享文件冲突。
4. 把自检写成 `diff_self_check: {status: pass | failed | not_run, evidence: []}`。禁止使用字符串、字符串列表或其他 shape。
5. 验证或自检发现 scope 内问题时，只允许修复并复验一次。`repair_round: 1` 或第二次失败时停止；超 scope finding 不自行修复。

当前 worker 自己完成 diff 自检，不创建额外审查子代理。

## 结果契约

所有状态都返回与 coordinator 完全一致的 `WORKER_RESULT` shape：

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

状态规则：

- `completed`：Plan Binding 和 active goal 证据可复核；全部 changed files 在 scope 内；`done_when` 满足；verification 通过或有明确替代证据；`diff_self_check.status: pass`；`worker_profile_evidence.status: applied`；无未解决 scope、依赖或共享文件冲突。
- `blocked`：输入、来源、binding、dispatch evidence、goal、依赖或外部条件在实现前阻止执行。仍返回完整 shape；不可获得的标量写 `unavailable`，列表写可获得证据或 `[]`，`diff_self_check` 写 `{status: not_run, evidence: []}`，`goal_set_evidence` 说明 `not_set` 或失败点。
- `failed`：已进入实现，但授权验证或 diff 自检在唯一补修后仍失败。保留实际 changed files、verification 和失败 evidence。
- `needs_main_review`：已进入实现后发现需要 coordinator 或用户决策的 scope、契约或冲突问题，且不能在授权范围内解决。该状态不授权扩大 scope。

worker 不因结果为 blocked 而省略字段，也不把未执行的 verification 或 diff 自检伪装为通过。

## 反模式

- 接受自然语言、用户可见 thread/task、手工 module、计划全文或多 module 包。
- 忽略旧 reviewer/profile-preflight、Claude assignment 或其他额外兼容字段后继续执行。
- 缺字段后先设置 goal、读取实现或修改文件，再补 blocked 结果。
- 用提示词、计划值或自述替代 implementation subagent dispatch evidence。
- 把 runtime `worker_profile_evidence` 混入 plan-authored `worker_profile`，或恢复旧 profile evidence shape。
- 把 `terra` 原样发送给调度接口，或把 `reasoning_effort` 错当成 `thinking` 之外的字段。
- 使用字符串形态的 `diff_self_check`，越过 scope，跳过验证，或开启第二轮补修后仍写 `completed`。
