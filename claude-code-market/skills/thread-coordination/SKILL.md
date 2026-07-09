---
name: thread-coordination
description: |
  当用户希望 Claude Code 以 `/goal` 驱动主协调会话时使用：主会话负责拆分、分派、轮询和验收；
  实现由 Claude Code agent team 队员承担。需要按目标域 ownership 构建 team roster，通过稳定队员 name
  复用 teammate，并要求队员使用 `thread-goal-worker` 执行限定目标、自验证、自审查和结构化回报。
---

# Thread Coordination

## 概述

把当前 Claude Code 会话作为 coordinator：以用户提供或当前激活的 `/goal` 为唯一目标来源，先识别目标域 ownership，再为每个 owner domain 建立或复用一个稳定 team member。Claude Code agent team 启用时，每个会话有隐式 team；通过 Agent 工具的 `name` 参数直接派生或复用队员。

coordinator 职责是只读规划、队伍分派、状态轮询、总体验收、冲突判断和结果汇总。队员职责是实现、调查、验证、自审查和结构化回报。

## 协调契约

- 主会话职责边界：只读规划、分派、轮询和验收；写入动作只在用户明确解除协调模式后发生。
- `/goal` 是驱动源：先读取、确认或建立本轮目标；所有拆分、分派、验收和最终汇总都回扣这个目标。
- Claude Code 执行面是 agent team teammate。队员通过稳定 `name` 承担 owner domain。
- 队员按 owner domain 复用：同一职责域优先使用同一个稳定 `name`，例如 `owner-ui-state`、`owner-network-contract`、`owner-skill-docs`。
- 同一文件、同一 API 契约或同一状态迁移由一个队员负责；存在依赖时使用串行顺序。
- 队员使用 `thread-goal-worker` 执行分派任务，保持 scope，并把协调职责留给 coordinator。
- 队员提交给 coordinator 前完成授权验证、自审查、审查后修复和自验收。
- 验收发现问题时，把问题发回对应队员。
- 区分已验证事实和假设。证据不足时标记未验证。

## Team Roster

主会话在内存中维护一张轻量队员表：

| 字段 | 含义 |
| --- | --- |
| parent_goal | 本轮 `/goal` 的目标和完成定义。 |
| boundaries | 允许范围、保护范围、验证要求和用户偏好。 |
| owner_domain | 稳定职责域，例如 UI、Network、Build、某个 skill 目录或业务模块。 |
| teammate_name | 传给 Agent 工具的稳定队员名。 |
| scope | 队员允许读取、修改、验证的文件、模块或职责范围。 |
| recent_goal | 该队员最近一次承担的 goal 或职责。 |
| status | `pending`、`assigned`、`working`、`needs_fix`、`verified`、`blocked`。 |
| evidence | 队员返回的 `TEAMMATE_RESULT`、验证输出、diff 摘要或阻塞证据。 |

所有非阻塞 owner domain 达到 `verified`，且剩余阻塞项已经标明处理边界后，coordinator 才可以把父级 `/goal` 视为满足。

## Goal 启动门禁

- 进入协调前先读取当前 `/goal`。若缺少 active goal，根据用户输入建立或请求确认目标；目标不清晰时先补齐。
- 目标正文包含完成定义、允许范围、保护范围和验收要求。
- 每个子目标都能追溯到父级 `/goal` 的某一项完成定义。
- 每个子目标都有明确 `owner_domain`。只有 finding 没有 ownership 时，先做只读归类；归类不出来就问用户。

## Ownership 拆分门禁

- 拆分单位是目标域 ownership。finding 作为说明某个 owner domain 需要工作的证据。
- 同一 owner domain 下的多个 finding、review comment、报错或相邻文件改动合并给同一个队员。
- 一个 finding 横跨多个 owner domain 时，先识别主责域；确实需要多域协作时，按 owner domain 拆分并显式写出依赖或串行顺序。
- 以业务流、接口契约、状态机、skill 目录和验证入口的完整性作为拆分边界。
- 子目标命名体现 ownership，例如 `G1-ui-state`、`G2-network-contract`、`G3-skill-docs`。

## 主流程

1. 读取并确认主会话 `/goal`：目标、范围、保护边界、验收标准和完成定义。
2. 从 `/goal` 识别 owner domains，并为每个 owner domain 派生子目标、scope、boundaries、verification 和冲突风险。
3. 合并同 owner domain 或冲突子目标。
4. 建立或更新 team roster：优先复用当前会话中已有的 `teammate_name`；缺少合适队员时，用稳定 name 派生新队员。
5. 通过 Agent 工具按 `name` 分派任务；同一 owner domain 后续修复继续发给同名队员。
6. 轮询队员状态，只读取必要结果，等待 `TEAMMATE_RESULT`。
7. 主会话只读总验收：检查 owner-domain 覆盖、跨队员一致性、队员自审查证据和父级 `/goal` 满足度。
8. 验收问题发回对应队员继续修改。
9. 汇总队员完成情况、目标满足度、修改范围、验证结果、风险和等待审计。

## 分派提示词契约

每个分派给队员的任务都应包含：

- `parent_goal`：父级 `/goal` 摘要，只用于对齐。
- `owner_domain`：本队员负责的稳定职责域。
- `goal_id` 和 `child_goal`：本队员唯一派生目标。
- `scope`：允许读取、修改、验证的文件、模块或职责区域。
- `boundaries`：保护范围、用户改动保护、命令边界。
- `verification`：期望执行的验证，或可接受的替代证据。
- `worker_done_when`：scope 内任务完成、验证通过或有替代证据、自审查闭环完成。
- `result_contract`：队员必须返回的结果格式。
- `worker_skill`：使用 `thread-goal-worker`。

推荐分派消息骨架：

```text
请使用 $thread-goal-worker 作为当前 Claude Code agent team 队员执行。

parent_goal: <主会话目标摘要>
owner_domain: <目标域 ownership>
goal_id: <Gx-...>
child_goal: <本队员唯一子目标>
scope: <允许读取、修改、验证的文件/模块/职责面>
boundaries: <保护文件、用户改动保护、职责边界、命令边界>
verification: <需要运行的检查或替代证据>
worker_done_when: <工作完成 + 验证通过 + 自审查完成 + 审查问题已修复或已标明边界>
result_contract: 返回 TEAMMATE_RESULT，包含 changed_files、verification、self_review、goal_alignment、risks。
边界超出或目标不清时，返回 blocked，并说明需要 coordinator 裁决的事项。
```

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
    - "<发现或 none>"
  - fixes_after_review:
    - "<根据审查做了什么修复>"
  - final_worker_verdict: pass | needs_main_review | blocked
- goal_alignment:
  - "<本结果如何满足 child_goal 和父级 /goal>"
- risks:
  - "<剩余风险或开放问题>"
- needs_main_review: true | false
```

## 复用规则

- 先看 team roster，再派生新队员。已有队员职责、scope 或最近目标匹配时，复用其 `teammate_name`。
- 多个队员都可能匹配时，选择最近承担该职责且上下文最完整的队员。
- 缺少合适队员、旧职责明显不匹配或用户要求隔离时，使用新 `name`。
- 同一 owner domain 归属一个队员；修复也发回原队员。
- 最终回复记录 `teammate_name -> owner_domain -> status`，方便本会话后续复用。

## 只读验收

- 对照 `/goal` 检查返回文件、范围和目标满足度。
- 检查所有 owner domains 是否覆盖父级 `/goal` 的完成定义。
- 检查跨队员是否有文件、API 契约、状态迁移、验证入口或用户改动冲突。
- 检查队员是否提供 `TEAMMATE_RESULT`、验证证据、自审查结果和 `goal_alignment`。
- 适合时运行只读检查，例如 `git status`、`git diff`、`git diff --check`。
- 用户要求编译/测试/构建时，确认负责队员已运行并报告最终结果；主会话执行命令需要用户明确授权。
- 证据不足时，要求队员补充证明，或把该项标为未验证。

## 最终回复

默认用简洁中文。包含：

- team roster：队员名、职责和最终状态。
- `/goal` 状态：目标是否已满足、哪些子目标仍未验证。
- 主会话总审查：owner-domain 覆盖、跨域冲突、队员自审查证据、父级 `/goal` 满足度。
- 修改范围；如果 coordinator 只做协调，也要明确说明。
- 已执行验证，或未验证项的原因。
- 风险、阻塞项或假设。

## 正向检查清单

- 先确认 `/goal`，再拆分、分派和验收。
- 先建立 team roster，再按稳定队员名分派。
- owner domain 作为拆分单位。
- 单一文件、接口契约或状态迁移保持单队员 ownership。
- 队员回报使用 `TEAMMATE_RESULT`。
- 完成判断基于自审查、验证证据和目标对齐。
