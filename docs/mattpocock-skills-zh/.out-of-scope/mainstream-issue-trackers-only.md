# Issue tracker 集成：只支持 GitHub、GitLab 和本地 Markdown

`setup-matt-pocock-skills` 对三种 issue tracker 提供正式支持，每一种对应 `skills/engineering/setup-matt-pocock-skills/` 中的一份初始化模板：

- **GitHub**（`issue-tracker-github.md`，通过 `gh`）。
- **GitLab**（`issue-tracker-gitlab.md`，通过 `glab`）。
- **本地 Markdown**（`issue-tracker-local.md`，文件放在 `.scratch/`）。

要求为其他 tracker 新增正式后端，不属于维护范围，包括 Jira、Linear、Azure DevOps、Trello、YouTrack 和新的面向代理的 tracker。

## 不属于维护范围的原因

每个 issue tracker 后端都将 CLI 的形态硬编码进 skills，包括命令、参数和输出解析。每增加一个后端，就永久增加一份维护工作：CLI 演变时必须继续工作，也必须持续针对 `/to-spec`、`/to-tickets`、`/triage` 等验证。我使用 GitHub，所以真正能保证正确的是这个后端。GitLab 的形态足够接近，可以一起维护；本地 Markdown 完全不需要 CLI。

流行程度不会改变这个判断。Jira 很常用，也有官方 CLI（`acli`），仍不会提供模板。我不用这个后端，却要持续测试它自己的链接语义、工作流状态和 CLI 特性。不论工具是否主流，成本都由我承担。

其他 tracker 都通过 `/setup-matt-pocock-skills` 的 **Other** 选项处理：用一段话描述工作流，skill 将其记录为 `docs/agents/issue-tracker.md` 中的说明。该文件由你拥有。若你完善了可用的 Jira 或 Linear 工作流，将它保留在自己的仓库或发布，并让 setup 指向它。

## 既往请求

- #99：“添加 dex 作为 issue tracker 后端”（请求时 dex 约创建 3 个月、约有 300 个 stars）。
- #258：“通过 Rovo MCP 将 Jira 作为正式 issue tracker”。
- #1137：“通过 Atlassian 官方 CLI（`acli`）将 Jira 作为正式 issue tracker”。
