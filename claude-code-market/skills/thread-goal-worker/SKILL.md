---
name: thread-goal-worker
description: |
  当 Claude Code agent team 队员收到 coordinator 分派的限定任务时使用：先确认 parent_goal、owner_domain、goal_id、scope、
  boundaries 和 verification，再在授权范围内实现、调查或验证；完成后自验证、自审查、自验收并返回 TEAMMATE_RESULT。
  适用于强化队员 scope、验证、自审查、目标对齐证据和结构化回报。
---

# Thread Goal Worker

## 概述

把当前 Claude Code agent team 队员作为某个 owner domain 的执行者。队员拥有 coordinator 分派的 scope，按 `child_goal` 执行实现、调查或验证。完成修改或调查后，队员验证、自审查、修复 scope 内问题，并用 `TEAMMATE_RESULT` 回报。

## 执行门禁

- 先解析分派，再执行。缺少 `parent_goal`、`goal_id`、`child_goal`、`scope`、`boundaries` 或 `verification` 时，返回 `blocked` 并列出缺失字段。
- 只执行本队员的 `child_goal`，保持 owner domain 和 scope。
- 操作范围来自 `scope`、`boundaries` 和 `verification`。
- 修改型任务完成后进行自审查：检查 diff 是否保持 scope、是否满足 child_goal、是否符合 boundaries、验证证据是否充分、改动是否聚焦。
- scope 内自审查问题需要修复并复验；超出 scope 的问题记录风险并返回 `needs_main_review`。
- 完成声明以 `TEAMMATE_RESULT` 为准。

## 输入契约

| 字段 | 必需性 | 用途 |
| --- | --- | --- |
| parent_goal | 必需 | 父级 `/goal` 摘要；用于对齐。 |
| owner_domain | 修改型任务必需 | 本队员负责的目标域 ownership。 |
| goal_id | 必需 | 本队员负责的目标编号。 |
| child_goal | 必需 | 本队员唯一目标。 |
| scope | 必需 | 允许读取、修改、验证的文件/模块/职责范围。 |
| boundaries | 必需 | 保护范围、用户改动保护、命令边界。 |
| verification | 必需 | 需要执行的检查或替代证据。 |
| worker_done_when | 可选 | 完成定义。 |
| result_contract | 必需 | coordinator 要求的最终结果格式。 |

中文字段等价于上表：`父级目标` -> `parent_goal`，`目标域` / `职责域` -> `owner_domain`，`范围` -> `scope`，`保护边界` / `边界` -> `boundaries`，`验证要求` -> `verification`。

## 运行流程

1. 解析分派，确认 `goal_id`、`child_goal`、owner domain、scope、boundaries、verification 和完成定义。
2. 在 scope 内做必要只读检查，保护用户已有改动。
3. 按 `child_goal` 执行修改、调查或验证。需要 coordinator 裁决时返回 `needs_main_review`。
4. 执行授权验证；受限时说明原因和替代证据。
5. 如果产生修改，进行自审查：scope、目标满足度、boundaries、验证证据、改动聚焦度和明显风险。
6. 修复 scope 内自审查发现的问题，并重新运行授权验证或说明复验证据。
7. 返回 `TEAMMATE_RESULT`，包含状态、修改范围、验证、自审查、目标对齐和风险。

## Scope 控制

- 修改前确认每个候选文件都属于 scope。
- 修改前用只读方式检查候选文件状态；已有用户改动时，在同一文件内最小合并，保留既有内容和顺序，并在结果中说明。
- 同一文件或接口契约看起来由其他队员负责时，返回 `needs_main_review` 并说明冲突。
- 新增文件需要属于本 owner domain。
- 构建、测试、生成或格式化命令需要匹配 `verification` 或 coordinator 授权。
- 父级目标、子目标或边界互相冲突时，返回 `blocked` 并说明冲突点。

## 自审查与自验收

自审查重点：

- 修改文件是否都在 scope 内。
- 结果是否直接满足 `child_goal`。
- 结果是否符合 boundaries 和用户已有改动保护。
- 验证或替代证据是否充分。
- 改动是否聚焦，是否存在重复定义、旧路径、旧字段或明显 bug。

自验收门禁：

| 审查结果 | 队员动作 | 最终状态 |
| --- | --- | --- |
| 无问题 | 记录 `findings: none`。 | `completed` |
| scope 内问题 | 修复、复验、记录 fixes。 | 修复成功后 `completed` |
| 超 scope 问题 | 记录风险。 | `needs_main_review` |
| 验证失败或缺替代证据 | 记录失败证据。 | `failed` 或 `needs_main_review` |

## 回报契约

最终回复遵守 `result_contract`；如果 coordinator 要求最终只返回结果块，则回复仅包含 `TEAMMATE_RESULT`。

```text
TEAMMATE_RESULT:
- status: completed | blocked | failed | needs_main_review
- goal_id: "<Gx-...>"
- owner_domain: "<domain>"
- changed_files:
  - "<path/to/file>"
- verification:
  - "<已执行检查、结果，或替代证据>"
- self_review:
  - status: passed | findings_fixed | unresolved | not_required
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
- needs_main_review: true | false
```

如果没有修改文件，`changed_files` 写空列表并说明原因。只有 scope 内工作完成、授权验证通过或有明确替代证据、自审查通过或问题已修复、并且 `final_worker_verdict: pass` 时，`status` 才能写 `completed`。

## 正向检查清单

- 先解析分派字段，再执行。
- 以 `child_goal`、owner domain 和 scope 作为执行边界。
- 修改前检查候选文件状态。
- 验证后自审查。
- scope 内问题修复后复验。
- 回报使用 `TEAMMATE_RESULT`。
