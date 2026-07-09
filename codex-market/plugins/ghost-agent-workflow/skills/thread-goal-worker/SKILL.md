---
name: thread-goal-worker
description: |
  当 Codex 子线程/会话收到主协调线程分派的限定任务，并且必须先通过 `/goal` 机制设置 active goal 后再执行时使用。
  用于防止子线程把自然语言说明当作目标、跳过读取/确认 goal、扩大 scope、创建/协调其他线程、
  跳过 worker 自审查自验收，或缺少 goal_set_evidence、worker_self_review、goal_alignment、COORDINATOR_RESULT 就汇报完成。
---

# Thread Goal Worker

## 概述

把当前会话作为子执行线程使用：先用 Codex 的 `/goal` 机制设置或激活主线程分派的子目标，再在授权范围内实现、调查或验证。修改完成后，worker 必须完成自己的验证、只读子代理审查、审查后修复和自验收，再提交给主线程。自然语言说明只是设置 `/goal` 的输入材料，不等于目标已经设置。

## 硬门禁

- 必须先读取当前 goal 状态，再设置或激活 active `/goal`。没有 active `/goal`、`goal_id` 不一致、或无法确认 `/goal` 已设置时，不要修改文件、运行写入型命令、stage、commit、push，或宣称开始执行。
- 自然语言目标不算 `/goal`。不要把“我会以 X 为目标”当作完成设置；必须使用当前环境提供的 `/goal` 指令或目标工具。
- 如果环境无法设置或读取 `/goal`，立即返回 `COORDINATOR_RESULT`，`status: blocked`，`goal_status: not_set`，说明缺少的机制。
- 只执行主协调线程分派的子目标。不要重写父级 `/goal`、扩大 scope、重新拆全局任务、创建新 thread，或把执行任务转交临时子代理。
- 修改型任务完成后必须使用只读子代理审查本次 scope 内改动。审查子代理不是 owner，不允许改文件、扩大 scope、创建 thread、替代当前 worker 回报最终结果，或接管后续修复。
- 除非分派明确允许，否则不要触碰禁止文件、无关模块、用户未授权的重构、全局格式化、依赖安装、stage、commit、push。
- 完成声明必须以 `COORDINATOR_RESULT` 为准；普通“完成了”不是有效回报。

## 输入契约

收到分派后，提取以下字段；缺少关键字段时先阻塞，不要猜：

| 字段 | 必需性 | 用途 |
| --- | --- | --- |
| parent_goal | 必需 | 父级 `/goal` 的摘要；只用于对齐，不可改写。 |
| owner_domain | 修改型任务必需 | 本 worker 负责的目标域 ownership；缺失时只能从 `child_goal` / `scope` 做一次保守推断，无法推断就阻塞。 |
| finding_evidence | 可选 | 归入本 owner domain 的 finding、报错或需求证据；只作为输入证据。 |
| goal_id | 必需 | 本子线程负责的目标编号。 |
| child_goal | 必需 | 要设置为 active `/goal` 的子目标正文。 |
| scope | 必需 | 允许读取、修改、验证的文件/模块/职责范围。 |
| constraints | 必需 | 禁止事项、用户改动保护、命令限制。 |
| verification | 必需 | 需要执行或明确跳过的检查。 |
| worker_self_review_required | 修改型任务默认必需 | 是否要求 worker 在提交前完成只读子代理审查和自验收；未给出时按 `true` 处理。 |
| main_acceptance_hint | 可选 | 主线程最终总审查会看的证据面；只用于让 worker 补齐证据，不代表主线程会替 worker 审局部实现。 |
| result_contract | 必需 | 主线程要求的最终结果格式。 |

常见中文字段等价于上表：`父级 /goal` -> `parent_goal`，`目标域` / `职责域` -> `owner_domain`，`证据` / `finding` -> `finding_evidence`，`范围` -> `scope`，`禁止事项` -> `constraints`，`验证要求` -> `verification`，`自审查要求` -> `worker_self_review_required`，`返回要求` -> `result_contract`。如果分派包在 XML、Markdown 或列表里，先做字段映射再判断是否缺失，不要因为字段名语言不同而误判阻塞。

## 运行流程

1. 解析分派，确认 `goal_id`、`child_goal`、owner domain、scope、constraints、verification 和 self-review 要求。
2. 读取当前 goal 状态并记录证据；如果已有 active goal 与 `goal_id` 和 `child_goal` 一致，可以继续使用，否则使用 `/goal` 机制设置 active goal。
3. 目标正文必须包含 `goal_id`、owner domain、子目标、scope、禁止事项、验收标准。
4. 再次读取 active `/goal` 并检查与分派一致；不一致时修正一次，仍不一致就阻塞。
5. 在 scope 内做必要只读检查，保护用户已有改动。
6. 按 active `/goal` 执行修改或调查。发现需要扩大范围时，停止并请求主线程确认。
7. 执行被授权的验证；不能执行时说明原因和替代证据。
8. 如果产生了修改，启动只读子代理审查本次 diff、scope、goal alignment、验证证据和风险。
9. 处理审查结果：scope 内问题必须修复并复验；超出 scope、无法判断或无可用审查机制时，返回 `needs_main_review` 或 `blocked`，不要写 completed。
10. 根据验证和 worker 自审查结果更新 goal 状态：全部完成才标记 complete；阻塞或失败时标记 blocked/failed 或保持 active 并说明。
11. 返回 `COORDINATOR_RESULT`，包含 goal 状态、修改范围、验证、worker 自审查和目标对齐证据。

## `/goal` 模板

设置 active goal 时使用这种结构；不要只把它写在普通回复里：

```text
/goal
goal_id: <Gx-...>
parent_goal: <父级目标摘要，只读对齐>
owner_domain: <本线程负责的目标域 ownership>
child_goal: <本线程唯一目标>
scope: <允许触碰的文件/模块/职责面>
constraints:
- <禁止事项>
verification:
- <验收检查>
done_when:
- <完成定义>
```

如果当前客户端把 `/goal` 暴露为工具而不是文本指令，使用对应目标工具建立同等内容。

`goal_set_evidence` 至少说明三件事：首次读取到的 goal 状态、用于设置或复用 active goal 的机制、二次读取确认到的 `goal_id` 和状态。

## Scope 控制

- 修改前先确认每个候选文件都属于 scope；不属于就不要改。
- 修改前用只读方式检查候选文件状态；如果已有用户改动，只在同一文件内最小合并，不覆盖、不重排无关内容，并在结果中说明。
- 同一文件或接口契约如果看起来被其他线程负责，先阻塞并报告冲突。
- 需要新增文件时，确认它属于本子目标的职责面。
- 需要运行构建、测试、生成或格式化命令时，确认分派允许；未授权时只说明建议命令。
- 发现父级目标、子目标或限制互相冲突时，不自行裁决，返回 `blocked`。

## 授权门禁

- 每次编辑前确认：文件在 `scope` 内、不是禁止文件、改动直接服务 `child_goal`。
- 每次命令前确认：命令属于 `verification` 或必要只读检查，不会安装依赖、生成项目产物、调用外部模型、创建 thread、stage、commit、push。
- 如果必须扩大 scope 或运行未授权命令，先停止并返回 `needs_main_review`；不要用“顺手修复”或“验证需要”绕过限制。

## Worker 自审查与自验收

- worker 是本子目标 owner。子代理只做只读审查，不接管实现，不修改文件，不创建或协调 thread。
- 审查发生在 worker 完成修改和初次验证之后、标记 `/goal` complete 之前。
- 审查输入只给必要上下文：`goal_id`、owner domain、scope、父级 `/goal` 摘要、本次 diff 摘要、验证输出和 constraints。不要转发完整聊天记录。
- 审查重点：是否越过 scope、是否满足 child_goal、是否破坏 constraints、是否缺少验证、是否引入无关改动、是否存在明显 bug 或遗漏。
- 审查发现 scope 内问题时，worker 必须修复、重新运行授权验证，并在 `fixes_after_review` 记录处理结果。
- 审查发现超 scope 问题时，不要自行扩大修改；在 `out_of_scope` 和 `risks` 中说明，并把 `status` 设为 `needs_main_review`。
- 如果环境没有可用子代理审查机制，修改型任务不能写 `completed`；返回 `needs_main_review`，并在 `worker_self_review.status` 写 `unavailable`。
- 没有文件修改的调查型任务可以不启动子代理，但必须在 `worker_self_review` 里说明 `not_required` 的原因。

只读审查子代理提示词使用这种形状，避免把执行权交出去：

```text
你是只读 reviewer，不是执行者。不要修改文件、不要创建 thread、不要扩大 scope。
审查 goal_id=<...> owner_domain=<...> 的本次结果。
输入：parent_goal 摘要、child_goal、scope、constraints、changed_files、diff 摘要、verification 输出。
输出：
- verdict: pass | findings
- findings:
  - severity: P0 | P1 | P2 | P3
    scope: in_scope | out_of_scope
    issue: <具体问题>
    required_action: <worker 应修复、复验、或交给主线程判断>
```

自验收门禁：

| 审查结果 | worker 动作 | 最终状态 |
| --- | --- | --- |
| `pass` | 记录 `findings: none`，可标记 `/goal` complete。 | `completed` |
| `findings` 且全在 scope 内 | 修复、复验、记录 fixes。 | 修复成功后 `completed` |
| 有 out-of-scope finding | 不扩 scope，记录风险。 | `needs_main_review` |
| reviewer 不可用 | 记录 unavailable。 | `needs_main_review` |
| 验证失败或未授权验证缺替代证据 | 不标 complete。 | `failed` 或 `needs_main_review` |

## 回报契约

最终回复遵守 `result_contract`；如果主协调线程要求“最终只返回 COORDINATOR_RESULT”，不要添加寒暄、过程旁白或额外 Markdown。结果块必须保留协调线程要求的额外字段，例如 `round_log`、`needs_main_review` 或特定验收摘要。

```text
COORDINATOR_RESULT:
- status: completed | blocked | failed | needs_main_review
- goal_id: "<Gx-...>"
- goal_status: active | completed | blocked | not_set
- goal_set_evidence:
  - "<如何设置/确认 active /goal；无法确认则写 unavailable>"
- changed_files:
  - "<path/to/file>"
- verification:
  - "<已执行检查、结果，或明确跳过原因>"
- worker_self_review:
  - reviewer: subagent | unavailable | not_required
  - status: passed | findings_fixed | unresolved | unavailable | not_required
  - findings:
    - "<审查发现或 none>"
  - fixes_after_review:
    - "<根据审查做了什么修复；没有则写 none>"
  - final_worker_verdict: pass | needs_main_review | blocked
- goal_alignment:
  - "<本结果如何满足 child_goal 和父级 /goal 的对应部分>"
- out_of_scope:
  - "<未处理但可能相关的事项>"
- risks:
  - "<剩余风险或阻塞>"
- extra_fields_from_result_contract:
  - "<如 round_log；未要求时省略>"
- needs_main_review: true | false
```

如果没有修改文件，`changed_files` 写空列表并说明原因。只有 active goal 已确认、scope 内工作完成、授权验证通过或有明确替代证据、worker 子代理审查通过或问题已修复、并且 `final_worker_verdict: pass` 时，`status` 才能写 `completed`。验收失败、验证未运行、goal 未确认、自审查不可用或已有部分工作时，`status` 用 `needs_main_review`、`blocked` 或 `failed`，不要伪装成完成。

`needs_main_review` 不是成功状态，只表示 worker 已停在授权边界，等待主线程做总任务判断或重新分派。除非 `final_worker_verdict: pass`，不要把 `needs_main_review: false` 和 `status: completed` 写在一起。

## Parallel-plan Worker 模式

收到协调线程基于 `parallel-plan` 分派的单个 module 时，使用这个轻量模式。输入必须包含 `module_id`、`task`、`writable_paths`、`done_when`、`verification`、`worker_context` 和 `parent_goal`；缺少任一字段时返回 `blocked`，不要推断。

执行循环严格限定为：

```text
设置或确认 child goal -> 检查 scope -> 实现 -> 验证 -> 检查自身 diff -> 最多修复一次 -> WORKER_RESULT
```

- 仍必须遵循现有 active `/goal` 读取、设置和二次确认门禁；`writable_paths` 是本模式唯一可写范围。
- 跨 scope、共享契约冲突、未完成依赖和未经授权的命令必须返回 `needs_fix` 或 `blocked`。
- 本模式以自检替代额外 reviewer-subagent：检查 changed files 是否都在 scope 内、`done_when` 是否满足、验证是否通过或有明确替代证据、diff 是否聚焦且不覆盖用户改动。
- 验证或 `diff_self_check` 失败时最多修复一次。第二次失败、范围不清或依赖缺失时停止并返回非完成状态。
- 该例外只适用于带 `parallel-plan` 标记的模块，不改变普通分派任务的既有只读 reviewer-subagent 审查门禁。

```text
WORKER_RESULT:
- module_id: "M1"
- status: completed | needs_fix | blocked
- changed_files:
  - "<path>"
- verification:
  - "<命令或替代证据及结果>"
- diff_self_check: pass | failed
- goal_alignment: "<done_when 如何被满足>"
- risks:
  - "<none 或剩余风险>"
```

只有 active goal 已确认、验证已通过或有明确替代证据，并且 `diff_self_check: pass` 时才可返回 `completed`。不要以 `COORDINATOR_RESULT` 替代该结果；协调线程仍可在普通模式消费 `COORDINATOR_RESULT`。

## 反模式

- 收到自然语言分派后直接开始改文件，没有先设置 active `/goal`。
- 回复“我会以这个为目标”，但没有使用 `/goal` 机制。
- 把父级 `/goal` 重新解释成更大的任务。
- 越过 scope 修复顺手看到的问题。
- 创建、复用、协调其他 thread；这是主协调线程职责。
- 把执行任务交给子代理，或让审查子代理修改文件、扩大 scope、代替 worker 做最终回报。
- 修改后跳过只读子代理审查、自验收或审查后复验就写 `completed`。
- 缺少 `goal_set_evidence` 或 `goal_alignment` 就报告完成。
- 缺少 `worker_self_review`、审查不可用或审查仍有未解决问题时仍写 `completed`。
- 验证失败、未运行验证或无法确认 `/goal` 时仍写 `completed`。
