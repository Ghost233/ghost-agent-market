---
name: thread-coordination
description: |
  当用户希望 Codex 以 `/goal` 驱动主协调线程时使用：主线程只分派、轮询和只读验收，不直接实现；
  需要按目标域 ownership 拆分任务、复用已有 Codex 子线程/会话、强制子线程先设置 active `/goal`、
  要求 worker 自审查自验收、汇总执行结果或防止越权。
---

# Thread Coordination

## 概述

把当前线程作为协调线程使用：以用户提供或当前激活的 `/goal` 为唯一目标来源，先识别目标域 ownership，再从 ownership 拆出可并行子任务，并遍历可用 Codex 子线程/会话复用匹配线程。由子线程执行修改、验证、只读子代理审查和自验收，主线程只读取必要信息、对照 `/goal` 做总任务审查并汇总结果。自然语言说明目标不等于目标已激活；主线程和子线程都必须留下可验收的 `/goal` 设置证据。

## 协调契约

- 主线程默认只读：不要编辑文件、调用 `apply_patch`、通过 shell 写入文件、运行构建/生成/测试命令、stage、commit、push，或打开 worktree；除非用户明确解除协调模式。
- `/goal` 是驱动源：主线程先读取、确认或建立本轮目标；所有拆分、分派、验收和最终汇总都必须回扣这个目标。没有可用 `/goal` 时，先让目标清晰下来，不开始分派执行。
- 子线程也必须使用 `/goal` 机制：分派时要明确要求子线程先设置 active `/goal`，自然语言说明不等于目标已设置。子线程无法设置或确认 `/goal` 时，应阻塞而不是执行。
- 本 workflow 的执行面是持久 Codex 子线程/会话，不是临时子代理。不要把实现任务交给一次性的 subagent；子代理只允许作为 worker 内部的只读审查者。
- 子任务必须从 `/goal` 派生，并按目标域 ownership 拆分。主线程先识别 owner domain，再派生子目标；不要按单点 finding、单条评论、单个报错或单个文件行号拆任务。
- 拆分后遍历当前工作区可用的 Codex thread / 会话，优先复用职责匹配的已有子线程。只有没有可访问的合适子线程，或用户明确要求新建时，才创建新的用户可见 thread。
- 除非用户明确要求独立 worktree，否则执行面使用当前 checkout / same-directory 上下文。
- 同一文件、同一 API 契约或同一状态迁移不要并行分派；把冲突任务合并给一个子线程，或明确串行顺序。
- worker 子线程必须在提交给主线程前完成自己的工作、自验证、只读子代理审查和自验收；主线程审查的是父级 `/goal` 的整体覆盖、跨域一致性和证据完整性，不替 worker 做局部实现审查。
- 验收发现问题时，把问题发回对应子线程修复；协调线程不绕过子线程直接补丁。
- 区分已验证事实和假设。证据不足时标记为未验证，不要替执行面粉饰结论。

## 术语边界

| 术语 | 含义 | 不能替代 |
| --- | --- | --- |
| owner domain | 一个稳定目标域或职责域，能独立拥有 scope、完成定义和验收证据。 | 单条 finding、单行报错、单个 review comment。 |
| worker thread | 持久 Codex 子线程/会话，拥有一个 owner domain 的执行权。 | 临时子代理、后台模型调用、nested CLI。 |
| reviewer subagent | worker 内部一次性只读审查者，只看 scope 内结果并提出 findings。 | worker、主线程、修复执行者。 |
| main total review | 主线程对父级 `/goal` 的整体审查。 | worker 的局部实现审查。 |

## /goal 状态模型

主线程维护一张轻量目标表，不需要写文件，除非用户要求持久化：

| 字段 | 含义 |
| --- | --- |
| parent_goal | 本轮 `/goal` 的一句话目标和完成定义。 |
| constraints | 禁止事项、不可触碰范围、验证要求和用户偏好。 |
| subgoals | 从父级 `/goal` 派生的子目标编号，例如 `G1-ui`、`G2-build`。 |
| owner_domain | 子目标的目标域 ownership，例如 UI、Network、Logging、Build、某个 skill 目录或业务模块。 |
| finding_evidence | 触发该 owner_domain 的 finding、报错、review comment 或需求证据；只作为拆分依据，不作为分派单位。 |
| owner_thread | 每个子目标绑定的 Codex 子线程 id 或可读标签。 |
| status | `pending`、`assigned`、`working`、`needs_fix`、`verified`、`blocked`。 |
| goal_set_evidence | 主线程和子线程如何设置或确认 active `/goal`，以及匹配的 `goal_id`。 |
| worker_self_review | worker 是否完成验证、只读子代理审查、审查后修复和最终自验收。 |
| evidence | 子线程返回的 `goal_alignment`、验证输出、diff 摘要或阻塞证据。 |

只有所有非阻塞子目标都达到 `verified`，并且剩余阻塞项已经明确不属于本轮完成定义时，主线程才可以把父级 `/goal` 视为完成。

## Goal 启动门禁

- 进入协调前先读取当前 `/goal`。如果没有 active goal，根据用户输入建立或激活目标；无法建立时停止并请求用户确认，不分派。
- 目标正文必须包含完成定义、允许范围、禁止事项和验收要求；缺少这些信息时先补齐或阻塞。
- 记录 `goal_set_evidence`：包括读取或设置 active `/goal` 的工具结果、目标摘要和 `goal_id`。不要把“我会以此为目标”当作证据。
- 每个子目标都必须能追溯到父级 `/goal` 的某一项完成定义；无法追溯的工作不分派。
- 每个子目标都必须有明确 `owner_domain`。只有 finding 没有 ownership 时，先做只读归类；归类不出来就阻塞或问用户。

## Ownership 拆分门禁

- 拆分单位是目标域 ownership，不是 finding。finding 只是证据，用来说明为什么某个 owner domain 需要工作。
- 同一 owner domain 下的多个 finding、review comment、报错或相邻文件改动合并给同一个 worker 子线程。
- 一个 finding 横跨多个 owner domain 时，先识别主责域；确实需要多域协作时，按 owner domain 拆分并显式写出依赖或串行顺序。
- 不要为了“并行更多”把同一业务流、同一 API 契约、同一 UI 状态机、同一 skill 目录或同一验证入口拆成多个 worker。
- 子目标命名应体现 ownership，例如 `G1-ui-state`、`G2-network-contract`、`G3-conso-log-guide`；不要命名成 `G1-finding-1`。
- 分派前先生成 owner-domain 摘要：`owner_domain -> finding_evidence -> scope -> done_when -> conflict_risk`。没有这张表或等价摘要时，不开始创建或复用子线程。

常见归类：

| 输入形态 | 拆分方式 |
| --- | --- |
| 多条 review comment 都在同一页面状态机 | 一个 UI/state owner domain。 |
| 一个报错牵涉 API 字段、UI 展示和日志 | 先派主责 API/Network owner；UI/Logging 只有在需要改各自职责时再拆。 |
| 同一 skill 文档里有触发、流程、返回格式问题 | 一个 skill-owner domain，不按段落拆。 |
| 同一测试失败需要多个模块配合 | 按 owner domain 串行，先修契约或数据事实源，再修消费者。 |

## 主流程

1. 读取并确认主线程 `/goal`：目标、范围、禁止事项、验收标准和完成定义。
2. 如果没有可用 `/goal`，先根据用户输入建立或请求确认目标；目标不清晰时不要分派执行。
3. 从 `/goal` 识别 owner domains，再为每个 owner domain 派生子目标，并标注 finding 证据、文件范围、验收标准和冲突风险。
4. 合并同 owner domain 或冲突子目标：同一文件、同一接口契约、同一迁移链路或同一测试入口只能由一个子线程负责，或明确串行。
5. 遍历当前工作区已知/可用的 Codex 子线程，包括用户指定 thread、历史记录中的 thread id、标题、最近目标和职责说明。
6. 为每个子目标匹配子线程；匹配依据是职责、文件范围、业务域、最近上下文、可访问状态以及与 `/goal` 的相关性。
7. 复用匹配子线程，并要求它使用 `thread-goal-worker` 先设置派生 active `/goal`；没有匹配线程时，按用户授权创建新 thread 并记录职责边界。
8. 轮询子线程状态，只读最小状态面，等待 `COORDINATOR_RESULT`。
9. 主线程只读总验收：检查 owner-domain 覆盖、跨子线程一致性、worker 自审查证据和父级 `/goal` 满足度。验收不通过时，将具体问题发回对应子线程继续修改。
10. 汇总所有子线程完成情况、目标满足度、修改范围、验证结果、风险和等待审计。

## 分派决策

| 情况 | 默认动作 |
| --- | --- |
| 用户指定已有 thread，或要求复用/继续/查看 | 使用对应 thread 工具；不要新建 thread。 |
| 用户明确要求新建 thread | 创建 thread，并记录 thread id 与职责边界。 |
| 用户要求实现，但要求主线程只协调 | 先确认 `/goal`，再拆成子任务并分派给匹配 Codex 子线程；主线程只验收。 |
| 涉及多个独立业务域 | 按 owner domain 和 `/goal` 的验收面拆分，并分别分派给对应子线程。 |
| 职责归属不清楚 | 先做最小只读检查；仍不清楚时问一个聚焦问题。 |
| 需要追溯历史原因 | 查可读/归档 thread、提交记录、diff 和会话证据，并说明置信度。 |

## 分派前检查

1. 复述 `/goal` 中的目标、范围、禁止事项和验收标准。
2. 生成 owner-domain 摘要，并确认每个 finding 只作为证据归入某个 owner domain。
3. 检查已知 thread id、thread 标题、历史职责、最近上下文和当前仓库状态。
4. 选择执行面：已有 thread、新 thread，或本地只读验收；不要选择临时子代理作为实现面。
5. 定义从 `/goal` 派生出来的职责边界，避免多个执行面重复工作或互相覆盖。
6. 只传必要上下文：父级 `/goal` 摘要、owner domain、子目标、相关 finding 证据、限制条件、输出契约和验收预期。不要转发完整聊天记录或无关私密路径。

## 子线程盘点

分派前先做线程盘点，并把决策压缩成一张表或等价摘要：

| 字段 | 记录内容 |
| --- | --- |
| thread | thread id、标题或用户可识别标签。 |
| recent_goal | 最近一次可见 `/goal` 或该线程负责的职责面。 |
| scope | 最近处理的文件、模块、业务域或验证入口。 |
| owner_domain_fit | 是否匹配本轮 owner domain，而不是只匹配某个 finding。 |
| availability | 可访问、已归档、上下文过期、需要用户确认。 |
| decision | `reuse`、`skip`、`needs_user`、`create_if_allowed`。 |
| reason | 为什么匹配或不匹配本轮子目标。 |

不要发明 thread。只能使用工具可列出的 thread、用户显式给出的 thread，或当前会话已经记录过的 thread id。

## 复用与创建门禁

- 新建 thread 是用户可见副作用。只有用户明确要求新建，或盘点后没有合适 thread 且用户授权创建时，才调用创建工具。
- 如果用户禁止创建其他 thread，或要求只使用指定 thread，严格遵守；没有可用执行面时返回 blocked 或 needs_user，不要绕过限制。
- 不要把多代理、临时 subagent、nested `codex` 执行、后台模型调用或其他一次性执行器当作 Codex 子线程替代品。
- 复用前确认 thread 可访问且职责未过期；证据不足时标记 `needs_user`，不要猜测 thread 内容或 owner。

## 分派提示词契约

每个分派给子线程的实现或调查任务都应包含：

- `parent_goal`：父级 `/goal` 摘要，只用于对齐，不允许子线程改写。
- `owner_domain`：本子线程负责的目标域 ownership，必须比单个 finding 更稳定。
- `finding_evidence`：归入该 owner domain 的 finding、报错、review comment 或需求证据；只作为输入证据。
- `goal_id` 和 `child_goal`：本子线程唯一派生目标。
- `scope`：允许读取、修改、验证的文件、模块或职责区域。
- `constraints`：禁止触碰的内容、用户改动保护、是否允许编辑和命令限制。
- `verification`：期望执行的验证，或不应执行验证的原因。
- `result_contract`：子线程如何证明结果满足父级 `/goal` 的对应部分。
- `worker_self_review_required`：修改型任务默认 `true`；worker 提交前必须完成验证、只读子代理审查、审查后修复和自验收。
- `worker_done_when`：scope 内任务完成、验证通过或有替代证据、worker 自审查闭环完成、active `/goal` 可标记 complete。
- `main_acceptance_hint`：主线程最终只检查哪些总体验收面，避免 worker 误以为主线程会替它做局部代码审查。
- 明确要求使用 `thread-goal-worker`，并在执行前设置 active `/goal`；自然语言描述目标不算完成设置。
- 要求子线程在无法设置或确认 active `/goal` 时返回 blocked，不要修改文件。
- 必须返回的最终结果块：

推荐分派消息骨架：

```text
请使用 $thread-goal-worker。
第一步必须通过 `/goal` 机制设置或激活下面的子目标；不要只把它当作普通聊天说明。

父级 /goal: <主线程目标摘要>
owner_domain: <目标域 ownership，不是单点 finding>
finding_evidence: <归入该 owner domain 的 finding / 报错 / review comment / 需求证据>
goal_id: <Gx-...>
child_goal: <本线程唯一子目标，只负责这一项>
scope: <允许触碰的文件/模块/职责面>
constraints: <不要触碰的文件、用户改动、无关重构、命令限制>
verification: <需要运行或明确不能运行的检查>
worker_self_review_required: true
worker_done_when: <工作完成 + 验证通过 + 只读子代理审查完成 + 审查问题已修复或明确超 scope + active /goal complete>
main_acceptance_hint: <主线程只检查 owner-domain 覆盖、跨域一致性、worker 自审查证据和父级 /goal 满足度>
result_contract: <必须返回 goal_set_evidence、changed_files、verification、worker_self_review、goal_alignment、risks>
如果无法设置或确认 active /goal，请返回 blocked，不要修改文件。
返回要求: 完成后返回 COORDINATOR_RESULT，并解释 goal_set_evidence 和 goal_alignment。
```

```text
COORDINATOR_RESULT:
- status: completed | blocked | failed | needs_main_review
- goal_id: "<Gx-...>"
- goal_status: active | completed | blocked | not_set
- goal_set_evidence:
  - "<子线程如何设置/确认 active /goal>"
- changed_files:
  - "<path/to/file>"
- verification:
  - "<已执行或明确跳过的检查>"
- worker_self_review:
  - reviewer: subagent | unavailable
  - status: passed | findings_fixed | unresolved | unavailable
  - findings:
    - "<发现或 none>"
  - fixes_after_review:
    - "<根据审查做了什么修复>"
  - final_worker_verdict: pass | needs_main_review | blocked
- goal_alignment:
  - "<本结果如何满足父级 /goal 或对应子目标>"
- risks:
  - "<剩余风险或开放问题>"
- needs_main_review: true | false
```

## 轮询与读取

- 长任务要克制轮询。任务越久，等待间隔越长；避免忙等。
- 工作运行中，只读取最小状态面。优先状态级读取，不展开工具输出、diff 或中间实现，除非用户要求。
- 不总结未完成实现，不催促子线程提前收口。
- 只有子线程返回 `COORDINATOR_RESULT` 或进入最终状态后，才读取完整结果正文。
- 每次轮询只记录 `thread`、`goal_id`、状态、等待间隔和下一步；不要把中间猜测写成验收事实。
- 子线程返回非结构化“完成了”时视为 `needs_fix`：要求补充 `COORDINATOR_RESULT`、`goal_status` 和 `goal_set_evidence`。
- 用户可见 thread 只有在用户要求或工作流需要时才归档/关闭。

## 只读验收

验收结果时保持只读。主线程做的是总任务审查，不替 worker 做局部实现审查：

- 对照 `/goal` 检查返回文件、范围和目标满足度。
- 对照子目标表确认每个 `goal_id` 都有 owner domain、owner thread、状态、证据和 `goal_alignment`。
- 如果子线程缺少 `goal_status` 或 `goal_set_evidence`，验收不通过；把问题发回子线程补充或重跑。
- 如果修改型子线程缺少 `worker_self_review`，或 `final_worker_verdict` 不是 `pass`，验收不通过；把问题发回该 worker 继续自审查、修复或说明阻塞。
- 如果 `goal_status` 是 `not_set`、`blocked`，或 `goal_id` 与分派不一致，验收不通过；不要把文件改动数量当作目标完成证据。
- 检查所有 owner domains 是否覆盖父级 `/goal` 的完成定义；检查 finding 是否都归入 owner domain，且没有按单点 finding 漏派或重复派。
- 检查跨子线程是否有文件、API 契约、状态迁移、验证入口或用户改动冲突。
- 检查声明的 diff 或摘要中是否有无关改动、重复定义、残留旧字段、旧路径或旧接口。
- 适合时运行只读检查，例如 `git status`、`git diff`、`git diff --check`。
- 如果用户要求编译/测试/构建，只确认负责子线程是否已运行并报告最终结果。除非用户明确授权协调线程执行，否则主线程不自行运行；用户只授权只读验收时，不把构建/生成命令升级为主线程动作。
- 证据不足时，要求子线程补充证明，或把该项标为未验证。

总审查输出应覆盖：

```text
main_total_review:
- owner_domain_coverage: pass | missing | duplicated
- cross_domain_conflicts: none | needs_fix
- worker_self_review_evidence: complete | incomplete
- parent_goal_alignment: pass | partial | blocked
- unresolved_items:
  - "<需要发回 worker 或向用户确认的事项>"
```

如果某个 worker 的 `worker_self_review.status` 是 `unavailable`，主线程不要替它补做局部审查；默认发回 worker 或把该 owner domain 标为未完成，除非父级 `/goal` 明确允许跳过 worker 自审查。

## Thread 复用规则

- 复用前先遍历当前工作区可用 thread：用户显式提到的 thread、当前会话记录过的 thread id、标题/职责匹配的历史 thread。
- 当职责、标题、最近上下文、记录的 thread id 或历史目标与本轮 `/goal` 匹配时，复用对应 thread。
- 多个 thread 都可能匹配时，选择最近承担该职责且上下文最完整的 thread。
- 只有用户要求新建、没有合适 thread、旧 thread 已归档/不可访问，或旧上下文明显错误时，才新建 thread。
- 选定或创建 thread 后，在协调记录或最终回复中记录 thread id 和职责，方便未来同类任务复用。

## 最终回复

默认用简洁中文。包含：

- 分派图：子线程 thread id 或标签、职责和最终状态。
- `/goal` 状态：目标是否已满足、哪些子目标仍未验证。
- 子目标表：`goal_id`、owner thread、状态、证据摘要。
- 主线程总审查：owner-domain 覆盖、跨域冲突、worker 自审查证据、父级 `/goal` 满足度。
- 修改范围；如果协调线程没有改文件，也要明确说明。
- 主线程只读验收项目和结果。
- 已执行验证，或明确未执行验证的原因。
- 风险、阻塞项或假设。
- 等待审计：是否轮询、轮询了哪些 thread id、等待间隔、读取是否最小化、何时读取结果正文。
- 如果上游要求特定结构化返回格式，严格按该格式输出；字段缺失时标为 `unavailable` 或 `not_run`，不要用额外闲聊代替。
- 需要记录优化、分派或验收迭代时，使用 `round_log` 逐条写清 `observation -> edit/dispatch -> gate -> result`。

## 反模式

- 在“只协调”模式下编辑文件。
- 不读取或确认 `/goal` 就拆任务、分派或验收。
- 只用自然语言告诉子线程“你的目标是...”，但没有要求它设置 active `/goal`。
- 把实现任务交给临时子代理，而不是 Codex 子线程/会话。
- 把 worker 内部只读子代理审查误当成执行面，或让子代理替 worker 修改、扩 scope、回报最终结果。
- 不拆分任务就直接把整个大需求塞给一个 thread。
- 按单点 finding、单条 review comment、单个报错或单个文件行拆子线程，而不是按 owner domain 拆。
- 把会互相覆盖的文件或接口契约拆给多个子线程并行修改。
- 不遍历可用 thread 就直接新建 thread。
- 明明有匹配 thread，却重复创建新 thread。
- 子线程只说“完成了”，主线程就直接认定完成。
- 子线程目标脱离父级 `/goal`，缺少 `goal_set_evidence`，或验收只看完成声明不看目标满足度。
- 轮询时阅读大段中间输出，并提前形成结论。
- 转发完整聊天记录，而不是整理后的上下文。
- 没有记录哪个子线程负责哪些文件。
- 最终结论混淆已验证事实和猜测。
