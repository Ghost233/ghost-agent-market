# 工单跟踪器

> 调研时间为 2026 年 10 月，不保证仍然准确。先用它了解分类，再自行调研当前选项：产品、价格、限制和 beta 状态变化很快。

工单跟踪器是工厂与人交互的界面。下面每种类型都是调研起点：先了解它是什么、何时选用，再按[继续调研](#继续调研)中的问题核查示例。

## 类型

### 1. Git 平台内置跟踪器

跟踪器内置于 Git 平台，工单、分支和 PR 共用产品、权限模型和身份。工厂规模较小、团队已经使用该平台，或仓库公开时可选用。这是“全部使用 GitHub”的方案：Git 平台的 CI 无需额外连接就能充当编排器。状态位于独立看板，标签因此是更可靠的路由方式。外部开发者可在代码所在处提交工单；非开发者需要账号，可以由反馈按钮调用 API 代为创建。自托管 Git 平台也携带自己的跟踪器。

- [GitHub Issues](https://docs.github.com/en/copilot/concepts/agents/about-third-party-agents)：默认选择；可将任务分配给 Copilot、Claude 和 Codex。
- [GitLab Issues](https://about.gitlab.com/blog/how-to-use-a-work-item-created-trigger/)：从工作项触发 Duo Agent Platform 流程。
- [Forgejo](https://forgejo.org/2026-10-release-v17-0/)：自托管，兼容 Actions。

需要核查：哪些指派给代理的能力仍处于预览、包含在何种套餐中；原生代理读取后续评论，还是只读取分配时的工单（截至 2026 年 10 月，Copilot 只读取分配时的内容）。

### 2. 面向代理的开发跟踪器

独立的软件团队 SaaS 跟踪器，把代理视为一等受理者，提供代理 API 和自己的编码代理。产品、支持或设计人员负责安排工作、团队已经使用该工具，或用户需要完善的分诊和规划视图时可选用。这是“使用 Linear 工单”的方案。状态和工作流是一等概念，因此“移到 Ready”是清晰的触发器。代理表现为人可以委派的应用用户，运行可持续把进展写入工单。这一类型的原生代理集成最深，也可以部分承担编排器和运行器角色。

- [Linear](https://linear.app/developers/agents)：最以代理为中心的跟踪器。
- [Jira](https://support.atlassian.com/jira-software-cloud/docs/collaborate-on-work-items-with-ai-agents/)：按状态触发代理，适合已经使用 Atlassian 的组织。
- [Shortcut](https://www.shortcut.com/help/integrations/using-ai-agents)：分配 story 或在评论中提及代理。
- [YouTrack](https://www.jetbrains.com/youtrack/)：工作流即代码，支持自托管。

需要核查：代理 API 状态（截至 2026 年 10 月，Linear 为开发者预览）、原生代理运行的计量和价格、代理席位费用、代理 webhook 的确认期限、客户表单由哪个套餐提供，以及自托管版本的停止支持日期。

### 3. 开源开发跟踪器

可以运行在自有基础设施上的 Linear 风格跟踪器，同时提供云版本。数据必须留在内部（隔离网络或受监管环境），或用户希望在购买产品的同时能够阅读并修改跟踪器源码时可选用。状态、标签和自定义属性的路由方式与第二类类似；原生代理能力较新。

- [Plane](https://developers.plane.so/dev-tools/agents/overview)：类似 Linear，每个应用可有机器人用户，代理在评论中回复。
- [Huly](https://github.com/hcengineering/huly-selfhost)：一体化工作区，与 GitHub 双向同步，运维栈较重。
- [OpenProject](https://www.openproject.org/)：成熟的传统项目管理工具。

需要核查：代理功能状态（截至 2026 年 10 月，Plane 为 beta）、哪些版本提供访客角色和接收表单、许可及自托管栈的运维成本。

### 4. 通用工作工具

工作管理或文档工具的数据库、任务列表兼作跟踪器。非工程团队已经使用该工具，或工单主要涉及内容、运营、调研而非代码时可选用。表单是优势：任何拥有链接的人都能提交。路由依赖灵活的数据库属性，每个工厂都需要自行设计 schema。diff 和 PR 等开发上下文位于 Git 平台，需要再点击一次。仅提供 SaaS。

- [Notion](https://www.notion.com/help/custom-agents)：数据库充当跟踪器，数据库变化触发代理。
- [Asana](https://asana.com/product/ai/ai-teammates)：AI Teammates 处理分配的任务。
- [ClickUp](https://clickup.com/brain/cloud-agents)：Cloud Agents 在任务会话中返回 PR。
- [Trello](https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/)：看板和列表，通过 webhook 与 Butler 自动化连接。

需要核查：webhook 延迟和粒度（截至 2026 年 10 月，Notion 批量处理内容更新，延迟约一两分钟），以及哪个套餐包含代理。

### 5. 仓库原生跟踪器

工单以 JSONL 或 Markdown 文件存放在仓库中，代理通过 CLI 或 MCP 服务编辑，像代码一样合并。单个开发者在本机驱动代理并希望将计划保存在 Git 中，或把它作为运行旁边的工作记忆配合正式跟踪器使用时可选用。推送到 Git 平台是唯一触发器，因此编排器通过比较文件找出变化；身份沿用 Git 平台。外部提交工单需要 commit 或 PR，是各类型中最弱的方式，有其他人提交工单时通常应升级到 Git 平台内置跟踪器。

- [Beads](https://github.com/steveyegge/beads)：使用 JSONL 和依赖跟踪，让运行领取下一张无阻塞工单。
- [Backlog.md](https://github.com/MrLesk/Backlog.md)：Markdown 任务，附 Kanban 视图和 MCP 服务。

### 6. 自建

工厂自己的应用把工单放在自己的数据库中，通常与编排器相邻。这是“自建跟踪器”方案。跟踪器本身就是产品，例如内部平台或面向客户的支持工厂，或现成模型都不合适时可选用。触发器变为函数调用；下面问题涉及的每项能力都需要编写和维护，因此该 skill 倾向购买现成产品。带 webhook 的 [Airtable](https://airtable.com/developers/web/api/webhooks-overview) 数据库是半自建的中间方案。

## 继续调研

逐项核查候选产品：

- **触发器**：哪些工单变化（创建、添加标签、改变状态、分配、评论、提及）发出编排器可转换为运行的 webhook 或事件？速度和粒度如何？
- **路由**：运行读取哪些标签、状态或字段来识别自身类型，例如探索、实施或返工？
- **会话**：人能否在评论中回答代理，回复是否触发下一次运行？
- **身份**：是否同时提供 API 和机器人身份，让运行以自身身份行动，并让人区分代理与同事？机器人是否占用付费席位？
- **原生代理**：工单能否直接分配给代理？支持哪些代理、哪个套餐、如何计量？代理读取分配时的工单，还是完整评论会话？
- **外部提交**：工单来源或客户通过表单、邮件、聊天还是 API 创建工单？哪个套餐提供这些方式？
- **托管**：只提供 SaaS，还是可以自托管？采用什么许可？

答案应从一手资料获取：API 与 webhook 参考（事件、载荷、投递和重试规则）、代理或应用开发文档、价格与套餐对照，以及变更日志或发行说明。优先于博客和比较网站。

最容易过时的是代理功能及其预览或 beta 状态、代理计量和积分价格、代理与表单的套餐限制、速率限制，以及自托管版本的收购、关闭和停止支持日期。Webhook 事件列表和路由模型变化较慢。

## 长期容易踩的坑

依赖这些结论之前确认仍然成立：

- **GitHub `GITHUB_TOKEN` 陷阱**：默认 `GITHUB_TOKEN` 所做的变更不会触发新的 workflow 运行。需要通过添加标签或评论触发下一次运行时，使用 GitHub App token。
- **分配时的上下文**：部分原生代理只在分配时读取工单，因此之后新增的上下文需要写到 PR。
- **代理 webhook 需要快速确认**：编排器先立即确认，再启动运行。
- **通用工作工具可能批量发送 webhook**，导致事件延迟；需要及时运行的工厂应监听属性变化或选择其他类型。
