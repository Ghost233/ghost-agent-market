---
name: thread-goal-worker
description: |
  当 Codex worker thread 收到 coordinator 从 `parallel-task-planner` 版本化计划派发的单一 module 包，
  需要校验来源链、运行时 profile、active `/goal`、scope、验证与 diff，并返回带 profile evidence 的
  `WORKER_RESULT` 时使用。自然语言、普通 owner-domain 或缺字段分派也会触发，但只能返回 `blocked`。
---

# Thread Goal Worker

## 概述

把当前 Codex worker thread 作为 coordinator 派发的单一 plan module 执行者。唯一执行入口是 coordinator 从 `$parallel-task-planner` 计划原样转发的单 module 包。先校验来源链、平台、module 边界和运行时 profile；全部通过后才设置 active `/goal`、修改 scope 内文件、验证、自检或审查，并返回 `WORKER_RESULT`。

不要接受自然语言任务、普通 owner-domain 包、手工 module、计划全文或多个 module。不要自行补计划字段、切换 profile、选择替代模型、降低 reasoning effort、创建或协调其他 thread。入口不合法时必须在设置 goal 或修改文件前返回 `blocked`。

## 输入门禁

执行任何 goal 或文件操作前，逐项验证：

1. `planner` 严格等于 `parallel-task-planner`，`plan_format_version` 严格等于整数 `1`，`execution_platform` 严格等于 `codex`。
2. 包含绝对、可读的 `plan_path`，以及非空 `parent_goal` 和唯一 `module_id`；只包含该 `module_id` 的权限，不携带其他 module 的写入范围。
3. module 包含非空 `task`、`writable_paths`、`done_when`、`verification` 和 `worker_context`；`depends_on` 字段必须存在且为合法列表（允许 `[]`）。`writable_paths` 是唯一可写 scope；`done_when` 和 `verification` 都必须可执行或可观察。
4. 包含完整 `worker_profile` 和 `reviewer_subagent_profile`；两者都显式给出非空 `model` 与 `reasoning_effort`。同时包含 coordinator/thread 运行时提供的 worker profile evidence。
4a. 包含 `reviewer_profile_preflight`（requested/effective/status/evidence）；普通 module 在设置 goal 前必须为 ready/applied 且 effective 为 terra/xhigh，parallel-plan diff_self_check 例外为 not_required 并有证据。
5. `reviewer_subagent_profile` 必须严格等于 Codex 平台固定默认值 `terra/xhigh`。planner 可以为 module 完整覆盖 `worker_profile`，worker 不把 `terra/xhigh` 强加给 worker 覆盖。
6. 包含 `repair_round: 0 | 1`、保护边界和 `result_contract: WORKER_RESULT`。`repair_round: 1` 只授权处理 coordinator 指出的原 finding，不开启新的补修轮次。

任一必需字段缺失、为空、无法解析、值不匹配或来源不是 coordinator 分派时，立即返回 blocked 结果。此时不要读取、设置或更新 `/goal`，不要修改文件、运行写入型命令、stage、commit 或 push。不要从聊天上下文、平台默认值或计划其他位置补齐缺失字段。

## Plan Binding

在设置 goal 或任何文件操作前，读取绝对 `plan_path`。验证顶层 `planner`、`plan_format_version`、`execution_platform`、`parent_goal`，并逐字段比较 `module_id` 对应原文的 `task`、`writable_paths`、`depends_on`、`done_when`、`verification`、`worker_context`、`worker_profile`、`reviewer_subagent_profile`。手工包或任一字段与计划原文不一致时返回 blocked。

真实回归场景：缺少 planner 来源链、profile 和计划字段的包必须返回 `WORKER_RESULT` blocked、`goal_set_evidence: not_set`、`changed_files: []`。

## Profile 门禁

Codex worker 默认请求是 `terra/xhigh`，但 planner module 可以提供完整的其他 worker profile。coordinator 传入的 worker profile evidence 必须完整包含 `requested`、`effective`、`status` 和 `evidence`：requested 与 module 的 `worker_profile` 完全一致，effective 与当前 worker 的实际 model 和 reasoning effort 完全一致，status 为 `applied`，evidence 来自可读取两个实际字段的 thread 创建或复用接口，才允许继续。

提示词、自述、skill 默认值、计划文本和“推荐模型”都不是运行时 evidence。任一实际字段不可读时用 `unavailable`；实际值与 requested 不一致时用 `mismatch`。两种状态都必须在设置 goal 或修改文件前 `blocked`。worker 不得自行切换 profile，也不得静默使用默认值、近似模型或较低 reasoning effort。

普通修改型 module 必须使用只读 reviewer subagent，requested profile 固定为 `terra/xhigh`。启动 reviewer 后记录其实际 profile；只有 evidence 完整、effective 完全匹配且 status 为 `applied` 才能接受审查结论。reviewer profile 不接受 planner module 覆盖，不能由 worker 自行改成其他值，无法应用或证明时返回 `blocked` 或 `needs_main_review`，不得完成。

只有 coordinator 明确标记为 `parallel-plan` 且要求本 worker 执行 `diff_self_check` 的 module，才不创建 reviewer subagent。此例外必须把 reviewer effective 两字段和 status 写为 `not_required`，evidence 明确写 `parallel-plan diff_self_check exception`；不能伪造 reviewer `applied` evidence。

入口 profile 失败时使用下列结果形状；缺失值写 `unavailable`，不要省略 profile 块：

```text
WORKER_RESULT:
- status: blocked
- module_id: "<Mx | unavailable>"
- goal_set_evidence: "not_set: input/profile gate failed"
- changed_files: []
- verification:
  - "not_run: input/profile gate failed"
- diff_self_check: "not_run"
- worker_profile:
  requested: {model: "<requested | unavailable>", reasoning_effort: "<requested | unavailable>"}
  effective: {model: "<effective | unavailable>", reasoning_effort: "<effective | unavailable>"}
  status: applied | unavailable | mismatch
  evidence: "<runtime evidence or exact missing/mismatch reason>"
- reviewer_subagent_profile:
  requested: {model: "terra", reasoning_effort: "xhigh"}
  effective: {model: "<effective | unavailable | not_required>", reasoning_effort: "<effective | unavailable | not_required>"}
  status: applied | unavailable | mismatch | not_required
  evidence: "<runtime evidence, exact gate reason, or parallel-plan exception>"
- goal_alignment:
  - "not_started"
- risks:
  - "<blocking reason>"
```

## Active Goal 与 Scope

通过输入和 worker profile 门禁后，先读取当前 goal 状态，再设置或复用只对应该 module 的 active `/goal`。goal 至少包含 `module_id`、`parent_goal`、`task`、`writable_paths`、保护边界、`verification` 和 `done_when`。二次读取必须确认 active goal 与分派一致；无法读取、设置或确认时返回 `blocked`，不要修改文件。

`goal_set_evidence` 必须记录首次 goal 状态、使用的 goal 机制，以及二次读取确认到的 module id 和 active 状态。自然语言里的目标声明不算 evidence。

- 每次编辑前确认文件属于 `writable_paths`，不是禁止文件，并且改动直接满足 `task` 与 `done_when`。
- 先只读检查候选文件和已有用户改动；最小合并，不覆盖或重排无关内容。
- 共享契约冲突、未满足依赖、并行 owner 冲突、需要扩大 scope 或运行未授权命令时停止并返回非完成状态。
- 构建、测试、生成或格式化只能使用 `verification` 或保护边界明确授权的命令；不得安装依赖。

## 有上限的执行循环

执行循环固定为：

```text
确认 active goal -> 检查 scope -> 实现 -> 验证 -> diff 自检或只读 reviewer -> 最多补修一次 -> WORKER_RESULT
```

1. 在 `writable_paths` 内实现当前 module，保护已有改动。
2. 执行全部授权 `verification`；不能执行时记录原因和明确替代证据。
3. `parallel-plan` module 自检 changed files、scope、用户改动、`done_when`、验证证据、diff 聚焦度和共享文件冲突，并记录 `diff_self_check`。
4. 非 `parallel-plan` 修改型 module 使用固定 `terra/xhigh` 的只读 reviewer；reviewer 不修改文件、不扩大 scope、不创建 thread、不接管最终回报。
5. 验证、自检或 reviewer 发现 scope 内问题时，只允许修复并复验一次。`repair_round: 1` 或第二次失败时停止；超 scope finding 不自行修复。

## 结果契约

最终只返回 `WORKER_RESULT`：

```text
WORKER_RESULT:
- status: completed | blocked | failed | needs_main_review
- module_id: "<Mx>"
- goal_set_evidence: "<active goal runtime evidence>"
- changed_files:
  - "<path>"
- verification:
  - "<command or alternative evidence and result>"
- diff_self_check: "<pass | failed, with scope/done_when evidence>"
- worker_profile:
  requested: {model: "<plan value>", reasoning_effort: "<plan value>"}
  effective: {model: "<runtime value>", reasoning_effort: "<runtime value>"}
  status: applied | unavailable | mismatch
  evidence: "<runtime evidence>"
- reviewer_subagent_profile:
  requested: {model: "terra", reasoning_effort: "xhigh"}
  effective: {model: "<runtime value | not_required>", reasoning_effort: "<runtime value | not_required>"}
  status: applied | unavailable | mismatch | not_required
  evidence: "<runtime evidence or parallel-plan diff_self_check exception>"
- reviewer_profile_preflight: {requested: "<requested>", effective: "<effective>", status: ready | applied | not_required, evidence: "<preflight evidence>"}
- goal_alignment:
  - "<how done_when and parent_goal are satisfied>"
- risks:
  - "<none or remaining risk>"
```

`completed` 必须同时满足：active goal 已确认；全部 changed files 在 scope 内；`done_when` 已满足；验证通过或有明确替代证据；`diff_self_check` 通过；worker profile 为 `applied`；普通修改型 module 的 reviewer profile 为 `applied` 且审查通过，或 `parallel-plan` reviewer 明确为 `not_required`；唯一补修上限未被突破。任何必需 profile 为 `unavailable` 或 `mismatch` 时都不能完成。

## 反模式

- 接受没有 planner 来源链的自然语言、owner-domain 或手工 module 包。
- 缺字段后先设置 goal、查看实现或改文件，再补 blocked 结果。
- 用提示词、自述或计划值代替实际 profile evidence。
- 把 planner 的 worker override 改回平台默认，或把 reviewer 改成非 `terra/xhigh`。
- `parallel-plan` 没启动 reviewer，却伪造 reviewer `applied`。
- 越过 scope、跳过验证或 diff 自检、开启第二轮补修后仍写 `completed`。
