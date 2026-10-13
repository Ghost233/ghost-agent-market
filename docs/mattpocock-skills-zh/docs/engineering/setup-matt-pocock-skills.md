## 它的作用

`setup-matt-pocock-skills` 回答一个仓库的三个问题：issues 在哪里、分诊标签叫什么、领域文档放在哪里。答案记录为 `docs/agents/` 下的 Markdown。

只有这些文件因仓库而异，skills 本身到处相同，运行时读 `docs/agents/issue-tracker.md` 按其执行。因此整套不绑定 GitHub，也不需编辑 skill 来切换跟踪器。调用时说“把 skills 接到自定义跟踪器”，任何可程序连接的系统都能工作，无需改 skills。

它由提示驱动，不是确定性脚本。读 `git remote`、`CLAUDE.md`、`GLOSSARY.md`，展示所发现的建议，写任何内容前等待确认。

## 何时使用

输入 `/setup-matt-pocock-skills`；[代理](https://www.aihero.dev/ai-coding-dictionary/agent)不会自行使用。元数据有意标为不可自动调用，其他 skills 也不能替你触发。

每仓库一次，在首次使用其他工程 skill 前。若 [triage](https://aihero.dev/skills-triage)、[to-spec](https://aihero.dev/skills-to-spec)、[to-tickets](https://aihero.dev/skills-to-tickets)、[wayfinder](https://aihero.dev/skills-wayfinder) 开始猜 issues 位置或用不存在标签，表示尚未配置。项目中途也能跑，它读取已有内容，不丢失先前工作。

## 前提条件

写入运行所在仓库：

| 写入内容 | 位置 |
| --- | --- |
| `issue-tracker.md` | `docs/agents/` |
| `domain.md` | `docs/agents/` |
| `triage-labels.md` | `docs/agents/`，仅安装 `triage` 时 |
| `## Agent skills` 块 | 已存在的 `CLAUDE.md` 或 `AGENTS.md` |

全部以 Markdown 提交，没有用户级或全局模式。配置位于仓库，每个仓库一份。

## 三项决策

每部分以推荐答案开始，探索已回答的问题跳过。多数运行只需两次确认。

| 决策 | 建议 | 何时询问 |
| --- | --- | --- |
| **工单跟踪器** | 与 `git remote` 匹配的系统 | 总会询问，这是唯一真正选择 |
| **分诊标签** | 保留五个标准名称：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix` | 仅安装 `triage` 时 |
| **领域文档** | 单上下文：根目录 `GLOSSARY.md` 加 `docs/adr/` | 仅发现 monorepo 信号时，提议多上下文 `GLOSSARY-MAP.md` |

跟踪器选项：

| 选项 | issues 位置 | 需要 |
| --- | --- | --- |
| **GitHub** | 仓库 GitHub Issues | `gh` CLI |
| **GitLab** | 仓库 GitLab Issues | `glab` CLI |
| **本地 Markdown** | 仓库 `.scratch/<feature>/` 文件 | 无需任何东西，连 remote 都不需 |
| **其他** | 你指定的位置 | 一段工作流说明 |

前三项附模板，开箱即用。本地 Markdown 是完整选项，不是后备，支持没有 remote 的个人项目。注意：使用 GitHub 就不要同时用本地 Markdown，两者是替代方案，应选一个。

“其他”同样完整。Jira、Linear、Azure DevOps、Beads 都这样接入：你描述，skill 写进 `docs/agents/issue-tracker.md`，下游照文字执行。用户已实现基于 [MCP](https://www.aihero.dev/ai-coding-dictionary/mcp) 的 Jira、类似 `gh` 的 Gitea CLI、手建本地 dashboard。

## 常见问题

**必须 GitHub 吗？**

不。GitHub、GitLab、`.scratch/` 本地 Markdown 有现成模板，其余走“其他”。这是最反复被问的问题：是否硬绑定 GitHub，能否 GitLab／Jira／Azure DevOps。答案始终是 setup 选跟踪器，而非 skill。

**更新 skills 后需重跑吗？**

v1.1 后直接答复是需要，但 skill 结束消息更宽松，仅切换或重新开始时重跑。两者有理由：种子模板随版本变，旧 `docs/agents/issue-tracker.md` 可能与新 skills 不一致。下游行为与文档不符时重跑，成本很低。

**我用 Codex，它却写 `CLAUDE.md`。**

这是仍开放的缺口。规则是存在 `CLAUDE.md` 就编辑，否则 `AGENTS.md`；检查文件存在，而非当前[运行框架](https://www.aihero.dev/ai-coding-dictionary/harness)。遗留 Claude Code 文件时，会把 `## Agent skills` 写到 Codex 不读的 `CLAUDE.md`。可手移到 `AGENTS.md`，或以 `AGENTS.md` 为权威、让 `CLAUDE.md` 只含指针。都不存在时会询问创建哪个，不自行选择，这让预期它决定的用户困惑。

**没有创建分诊标签。**

确实不会。`docs/agents/triage-labels.md` 是*映射*，告诉 `/triage` 跟踪器字符串对应五个标准角色，不运行 `gh label create`。新 GitHub 仓库标签未创建，多次被报告为缺陷。两点后果：

- 已用标准名称时，映射是恒等表，无需配置，这是预期常态，不是漏步骤。
- 也不创建 [wayfinder](https://aihero.dev/skills-wayfinder) 的 `wayfinder:map`、`wayfinder:<type>`；`gh issue create --label <missing>` 会失败，不会创建标签。首次 wayfinder 前手工创建。

**能在这里配置其他 skills 的[追问](https://www.aihero.dev/ai-coding-dictionary/grilling)节奏、问题格式、语气吗？**

不能，只配置跟踪器、标签、文档布局。用户要求个人偏好入口，答复是 skills 保留主张，不接个人配置。偏好写成 `CLAUDE.md` 普通指令，每个 skill 已读取。

**可放 `~/.claude`，而非每仓库提交吗？**

目前不能。多仓库用户有开放请求，尚无用户级模式。每仓库自己的 `docs/agents/`。

**用一个 skill 配置其他 skills，不奇怪吗？**

长期批评认为让 LLM 配置自己的 skills 不合适。权衡真实：无 setup，每个接触 issues 的 skill 都需复制跟踪器指令。产出是可读可改 Markdown，限制风险。读取每个文件、手改。日常修改这样做，不再跑一次 setup。

## 正常工作的表现

- `docs/agents/issue-tracker.md`、`docs/agents/domain.md` 存在，安装 `triage` 时还有 `triage-labels.md`。
- 框架读取的指引文件出现 `## Agent skills`，各文件有一行摘要与指针。
- 建议跟踪器匹配 remote，标签字符串匹配实际标签。
- 随后 `/to-tickets` 发布不再问位置，`/triage` 使用而非发明标签。
- skill 文件无变化。Setup 编辑 `SKILL.md` 就是出错。

## 它在流程中的位置

`setup-matt-pocock-skills` 是工程流程的**一次性配置**，其他工具假定的前提，而非链中步骤。邻居是读取者：[triage](https://aihero.dev/skills-triage) 用标签词汇，[to-spec](https://aihero.dev/skills-to-spec)、[to-tickets](https://aihero.dev/skills-to-tickets) 向指定跟踪器发布，[wayfinder](https://aihero.dev/skills-wayfinder) 读同一文件的“Wayfinding operations”部分学习如何存地图、子[工单](https://www.aihero.dev/ai-coding-dictionary/ticket)。[domain-modeling](https://aihero.dev/skills-domain-modeling) 之后填充记录的文档布局，只在确定词或决策时创建 `GLOSSARY.md` 与 ADR，所以 setup 后没有领域文档正常。下一步用哪个由 [ask-matt](https://aihero.dev/skills-ask-matt) 路由。
