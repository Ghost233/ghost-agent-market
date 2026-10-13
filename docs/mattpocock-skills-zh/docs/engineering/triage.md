## 作用

`triage` 处理项目 tracker 上的 issues，将每个条目推进一个由**triage 角色**组成的小型状态机，每个条目具有一个分类角色和一个状态角色。最终，每个 issue 都会成为代理可执行的简报、给报告者的具体问题，或记录了关闭原因的已关闭 issue。

它只用于**不是你创建**的 issues，包括原始缺陷报告、收到的功能请求，或未事先沟通就提交的外部 PR。这些工作从外部进入 tracker，保留报告者原本提供的形式。由 [to-tickets](https://aihero.dev/skills-to-tickets) 生成的 [tickets](https://www.aihero.dev/ai-coding-dictionary/ticket) 已经可供代理执行，再对它们运行 `triage` 会浪费已有工作。规则很简单：`/triage` 只处理收到的 issues，不处理你自己创建的 issues。

它与手动打标签也不同，因为它先推荐，再等待。它说明推荐的分类和状态、理由，以及在代码库中发现的内容，等你明确要求后才应用。

## 使用时机

输入 `/triage`，再用普通语言描述需求。[代理](https://www.aihero.dev/ai-coding-dictionary/agent) 不会自主使用它。例如：“显示需要我关注的内容”“看看 #42”“把 #42 移到 ready-for-agent”。

| 当前情况 | 使用入口 |
| --- | --- |
| Tracker 中有许多其他人提交的原始报告 | `/triage` |
| 自己有一个粗略想法，还未写下 | [grill-with-docs](https://aihero.dev/skills-grill-with-docs) |
| 已讨论清楚，要转成 [spec](https://www.aihero.dev/ai-coding-dictionary/spec) | [to-spec](https://aihero.dev/skills-to-spec) |
| 有一份 spec，要拆成代理可执行的 tickets | [to-tickets](https://aihero.dev/skills-to-tickets) |
| 已确认缺陷，需要查明根因而非打标签 | [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs) |

## 前提

`triage` 会读写 issue tracker，因此先用 [setup-matt-pocock-skills](https://aihero.dev/skills-setup-matt-pocock-skills) 配置 tracker 和标签词汇。下面的角色名称是**规范名称**。Tracker 中的标签字符串可能不同，setup 会提供映射。若 tracker 已完全采用规范名称，就无需映射，也无需初始化。

Tracker 配置也决定是否把外部 PR 纳入请求范围，以及谁算外部贡献者。该开关默认关闭，setup 已不再询问它。要处理 PR，在 `docs/agents/issue-tracker.md` 中开启。

## 状态机

每个经过 triage 的条目，最终恰有一个分类角色和一个状态角色。分类有两种：`bug`（内容损坏）和 `enhancement`（新功能或改进）。状态有五种：

| 状态 | 含义 |
| --- | --- |
| `needs-triage` | 需要你评估。没有标签的 issue 通常先进入这里。 |
| `needs-info` | 等待报告者回复。回复后回到 `needs-triage`。 |
| `ready-for-agent` | 要求已明确，附有代理简报。[AFK](https://www.aihero.dev/ai-coding-dictionary/afk) 代理可接手。 |
| `ready-for-human` | 附有同样的简报，并说明代理无法处理的原因：判断、外部访问或手动测试。 |
| `wontfix` | 已关闭，并记录原因。 |

这些就是全部词汇。每个条目恰有一个状态角色，让查询保持简单。状态也是这个 [skill](https://www.aihero.dev/ai-coding-dictionary/skill) 最常收到请求的部分。用户希望增加已明确要求、却被其他 issue 阻塞的状态，等待未来触发条件的 `deferred` 状态，以及最终的 `implemented` 状态。这些都尚未发布，见下面的问题。

`wontfix` 有三种情况。只有其中一种会写入知识库，所以区别很重要：

| 关闭原因 | 处理方式 |
| --- | --- |
| 已经实现 | 评论指出功能已存在于哪里。不写入 `.out-of-scope/`，因为这是已构建的功能，并未拒绝；在该目录写文件会破坏去重检查。 |
| 拒绝修复缺陷 | 礼貌解释，再关闭。 |
| 拒绝功能改进 | 在 `.out-of-scope/` 写文件，在关闭评论中链接到它，再关闭。 |

`.out-of-scope/` 按被拒绝的**概念**保存 Markdown 文件，而非每个 issue 一份。每份是短设计文档，不是数据库行，说明拒绝了什么、原因，并列出所有提出该请求的 issues。`triage` 在评估任何内容前，先读完整个目录，按概念而非关键词匹配，例如“夜间主题”会匹配 `dark-mode.md`。找到匹配时，展示旧决策，询问你是否仍同意，不从头重新争论请求。

## 编写简报前先验证

任何 [grilling](https://www.aihero.dev/ai-coding-dictionary/grilling) 之前，`triage` 先检查主张是否成立。缺陷按报告者步骤复现；PR 则检出分支、运行相关测试。然后报告三种结果之一：

- 已确认，并提供代码路径。
- 未能复现。
- 细节不足，无法尝试。这是最强的 `needs-info` 信号。

同一轮中，还针对代码库做两项检查。**重复功能**检查判断功能是否已实现，按领域概念搜索，而非照报告者的用词。**既往拒绝**检查判断 `.out-of-scope/` 是否已作出拒绝。两项检查成本都低，任一命中都会得到 `wontfix`。

所有工作都是为了做好一个产物：**代理简报**。这是 issue 移到 `ready-for-agent` 时，由 `triage` 发布的结构化评论。`triage` 发布后，简报成为契约，原始报告仅作为背景。简报追求**持久有效**，而非定位精确，因为 issue 可能在 `ready-for-agent` 停留数周，代码期间不断改变。简报因此使用类型、签名和行为契约，绝不使用文件路径或行号。经确认的复现，比猜测能产生更可靠的简报。

## PR 是附有代码的 issue

Tracker 把外部 PR 视为请求入口时，它们走同样的状态机，具有相同分类、状态和转移。状态作用于 diff。`ready-for-agent` 表示已附简报，代理应对代码执行下一步；`ready-for-human` 表示人类可合并。PR 上的简报描述现有 diff 还要做什么，不描述如何从零构建。

发现列表仅显示**外部** PR，因为协作者开发中的分支不是 triage 工作。这个过滤只作用于发现阶段。你明确指定 PR 时，无论作者是谁，`triage` 都会处理。

## 常见问题

**我运行了 `/to-spec` 和 `/to-tickets`，那些 tickets 现在还没经过 triage。要再运行 `/triage` 吗？**

不用。它们已经可供代理执行。`to-tickets` 发布时添加 `ready-for-agent` 标签，AFK 执行器可直接接手。有用户完成 spec 流程，却看到输出上有 `needs-triage`，AFK 执行器因此全部忽略。`triage` 是外部工作进入系统的入口，spec 流程处理你自己发起的工作。两者在 `ready-for-agent` 汇合，不提前汇合。

**已有 `to-spec` → `to-tickets` → `implement` 流程，`triage` 还需要吗？**

只有收到外部工作时需要。`triage` 比该流程更早出现，工作也不同，处理其他人提交的报告。Tracker 中全是自己规划的工作时，很少会用它。维护公开项目，或团队向你报告缺陷时，这些工作从这里开始。主要用途是接收外部贡献者 issues 的开源仓库。

**代理尝试添加 `ready-for-agent`，但 `gh` 提示标签不存在。**

这是已知的未解决缺陷（[#616](https://github.com/mattpocock/skills/issues/616)）。`setup-matt-pocock-skills` 将标签词汇写入 `docs/agents/triage-labels.md`，却不在 tracker 中创建标签。用 `gh label create` 或 tracker UI，手动创建五个状态标签和两个分类标签，一次即可消除错误。Issue 链接了一条尚未合并的社区修复分支。

**五种状态不够。被阻塞、延期或已实现怎么办？**

这是该 skill 收到最多报告的缺口，分为三种：

- Issue 已完全明确，但要等另一个 issue 关闭（[#139](https://github.com/mattpocock/skills/issues/139)）。报告者说，此时 `ready-for-agent` 在“技术上正确”，却会误导代理接手后陷入阻塞。
- 计划中的未来工作等待触发条件，暂时无法行动（[#297](https://github.com/mattpocock/skills/issues/297)）。
- 需要表示“已实现，等待验证”的最终状态。没有它，AFK 执行器可能再次排入已完成 tickets。

阻塞场景已被认可为真实问题，但名称未定，可能是 `blocked` 或 `paused`。这些均尚未发布。现有变通方式是在分类旁加一个仓库本地标签，状态栏仍保持准确值，但 skill 不知道额外标签。某个社区 fork 进一步增加了 `needs-slicing`、`tracking` 和工作量标签。这可以工作，但属于该 fork，不属于原 skill。

**与 `/diagnosing-bugs` 有什么不同？**

这里的验证步骤刻意保持浅层，只回答“问题是否真实，大致在哪里”，不寻找根因。按报告者步骤几分钟内无法复现时，使用 `needs-info`；想立即调查时，用 [diagnosing-bugs](https://aihero.dev/skills-diagnosing-bugs)。两份 skill 文本尚未提及对方，有用户报告了这个缺口，仍未解决。

**能让它处理整个积压列表并自主运行吗？**

可以要求，但要关注它读取什么。“显示需要关注的内容”只是一轮成本较低的列表查询，用于**选择**。你选定一个 issue 后，`triage` 才收集该 issue 的完整[上下文](https://www.aihero.dev/ai-coding-dictionary/context)。一次处理二十个 issues 时，代理可能只凭低成本列表作判断，却不告诉你。列表返回 issue 正文，不返回评论。有用户遇到三个 issues 已有“已修复，建议关闭”的评论，结果三个都被添加了新代理简报。批量处理时，明确要求它阅读每个 issue 的评论。

**支持 Linear 或 GitHub Issues 以外的系统吗？**

支持。Tracker 来自配置，不是硬编码假设。有人通过 `linear` CLI 用 Linear，也有人用 GitLab 或 `.scratch/` 下的普通 Markdown 文件。常见划分是 Linear 管 issues 和规划，GitHub 管代码和 PR。提及“issue tracker”的 skills 对应 Linear，提及“PR”的 skills 对应 GitHub。本地 Markdown tracker 有一个未解决的模板缺陷：生成文件可能重复写验收条件，一次在顶层，一次在代理简报内（[#200](https://github.com/mattpocock/skills/issues/200)）。

## 生效迹象

- 每个处理的条目最终恰有一个分类角色和一个状态角色，既不是零个，也不是两个冲突状态。
- 给出带理由的推荐后停止，不会自行改标签并继续。
- 到达 `ready-for-agent` 前，已复现缺陷，或检出并运行 PR。
- 简报使用类型和行为，不含文件路径或行号。
- 六个月前拒绝的请求再次出现时，会提醒并引用旧理由，不重新 triage。
- 发布的每条评论都以 `> *This was generated by AI during triage.*` 开头。

## 所处位置

`triage` 是**工作入口**，不是主流程中的步骤。主流程从你自己的想法开始：grilling、spec、tickets、implement、review。`triage` 是处理别人工作的一条并行通道。两条通道最终都得到附有简报、标记 `ready-for-agent` 的 issue。[implement](https://aihero.dev/skills-implement) 接手它，与接手 [to-tickets](https://aihero.dev/skills-to-tickets) 的 ticket 相同。请求需要补充细节才能让 `triage` 编写简报时，`triage` 同时使用 [grilling](https://aihero.dev/skills-grilling) 和 [domain-modeling](https://aihero.dev/skills-domain-modeling)，一次一轮问题，随你作出决策而记录进 `GLOSSARY.md` 和 ADR。不确定自己在哪条通道时，由 [ask-matt](https://aihero.dev/skills-ask-matt) 路由。
