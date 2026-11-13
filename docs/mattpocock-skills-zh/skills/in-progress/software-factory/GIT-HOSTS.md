# Git 托管平台

> 调研时间为 2026 年 10 月，不保证仍然准确。先用它了解分类，再自行调研当前选项：产品、价格、限制和 beta 状态变化很快。

## 类型

### 一体化平台

Git 托管平台与工单跟踪器、充当编排器的 CI 系统和托管运行器打包，共享一条事件流和一套权限模型。一个产品填充 Git 托管平台、工单跟踪器、编排器和运行器四个位置，CI 运行页面通常也足以承担可观测性平台。每个 PR、审查、标签和检查事件既是 webhook，也能作为原生触发器，因此这类平台的触发器最丰富。

**适用时机**：工厂刚起步、代码已经在该平台，或用户希望只有一份账单和一次登录。这是 [SKILL.md](SKILL.md) 中“全部使用 GitHub”的方案。厂商也提供自己的代理，它们可能与用户的运行竞争，也可能作为其中一种运行加入。

- [GitHub](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)：默认选择；包含 Issues、Actions、Apps 和最大的集成生态。
- [GitLab](https://about.gitlab.com/pricing/)：在同一产品提供 issue、合并请求、CI/CD 和运行器，可使用 SaaS 或自托管。

### 套件中的 Git 托管平台

Git 托管平台作为更大套件中的一个模块出售，工单跟踪器是通过链接和 webhook 连接的其他产品，例如 Jira、Azure Boards。跟踪器事件来自第二条事件流，因此编排器需要汇合两个事件来源。

**适用时机**：组织已经使用该套件，成员日常使用 Jira 或 Azure Boards。工厂沿用该跟踪器作为与人交互的界面。

- [Bitbucket Cloud](https://support.atlassian.com/bitbucket-cloud/docs/api-request-limits/)：Atlassian 的 Git 托管平台，搭配 Jira 和 Bitbucket Pipelines。
- [Azure DevOps（Azure Repos）](https://learn.microsoft.com/en-us/azure/devops/integrate/concepts/rate-limits)：同一组织提供 Repos、Boards、Pipelines 和 Entra 身份，因此能填充全部四个位置。
- [AWS CodeCommit](https://aws.amazon.com/blogs/devops/aws-codecommit-returns-to-general-availability/)：使用 IAM 身份的基础 Git 托管平台；需搭配外部跟踪器和 CI。

### 自托管 Git 平台

用户在自己的基础设施上运行 Git 托管平台，通常与编排器和运行器处于同一网络。运营者自行设置速率限制，上限取决于硬件；所填充位置的升级、备份和可用性由用户负责。

**适用时机**：代码必须留在本地或隔离网络中，用户不希望承担按席位计费，或 SaaS API 配额限制了繁忙的工厂。Forgejo 和 Gitea 适合小团队，内置 issue 和兼容 GitHub Actions 的 CI；GitLab 自托管版与 GitHub Enterprise Server 适合组织，并保留 Apps 和服务账号能力。

- [Forgejo](https://forgejo.org/2026-10-release-v17-0/)：社区治理、轻量，带 Forgejo Actions。
- [Gitea](https://about.gitea.com/)：轻量，带 Gitea Actions，也提供托管版。
- [GitLab 自托管版](https://about.gitlab.com/install/) 和 [GitHub Enterprise Server](https://docs.github.com/en/enterprise-server@latest)：在用户基础设施上运行的完整平台。

### 审查优先和去中心化平台

这类平台的审查模型不同于分支加 PR：可能使用逐提交 patchset 和投票标签，也可能让用户运行的节点之间联邦共享仓库。大多数工厂工具假设 PR 模型，因此需要开发更多连接逻辑。在 Gerrit 中，自动检查通过机器人账号投 `Verified`，人投 `Code-Review`。

**适用时机**：团队已经采用这种审查方式，或比起生态更重视联邦化。

- [Gerrit](https://www.gerritcodereview.com/)：通过标签投票审查 patchset，Android 和 Chromium 使用此模型。
- [Tangled](https://blog.tangled.org/ci/)：基于 AT Protocol 的 Git 托管平台，支持堆叠 PR 和自己的 CI 运行器。

### 面向代理的新型 Git 平台

这类新平台以代理为主要作者，强调高提交吞吐、服务端读取代替克隆，以及按代理归属变更。截至 2026 年 10 月，整类产品仍处早期，门禁和速率限制可能尚未公开，需要询问厂商。

**适用时机**：工厂针对一个大型仓库并发执行大量运行，且克隆时间或 API 限额成为主要瓶颈。先在单个仓库的镜像上试点，并保留 GitHub 作为后备。

- [Cursor Origin](https://cursor.com/origin)：来自 Graphite 团队，支持 GitHub 同步及带签名的 PR、审查和推送 webhook。
- [GitLab 新一代 SCM](https://about.gitlab.com/blog/gitlab-next-gen-scm/)：重建后的 GitLab 后端，提供无需克隆的代理 API。

### 用于运行的 Git 存储

可批量创建、无界面且以 API 为主的 Git 仓库，提供分支、提交和 diff，但没有 PR、审查或门禁。它只填充该位置的一部分，每次运行获得按仓库签发的短期 token。

**适用时机**：运行需要低成本的单次临时仓库或 fork，例如每张工单一个 fork、保存代理工作状态，而最终 PR 仍提交到上述完整 Git 平台。

- [Cloudflare Artifacts](https://www.cloudflare.com/product/artifacts/)：Workers 上的 Git 兼容存储，可为每项任务 fork 基线。
- [Pierre code.storage](https://code.storage/docs)：支持临时分支的白标 Git API。

## 继续调研

逐项核查候选产品：

1. **触发器**：哪些事件（PR 创建、推送、提交审查、添加标签、检查完成）以 webhook 发送给编排器，投递是否有签名？
2. **身份**：运行能否使用专用机器人或应用身份？这决定运行是否可归属、自动审查能否批准另一个身份创建的 PR，以及运行自己的推送能否触发下一次运行。
3. **门禁**：用户的套餐和仓库可见性是否支持必需检查、必需审批和分支保护，机器人能否进入绕过名单？
4. **速率限制**：所有运行器上的运行共享多少 API 配额，配额按安装、token、用户还是工作区计算，如何扩容？
5. **覆盖位置**：同一产品还承担工单跟踪器、编排器、运行器和可观测性平台中的哪些位置？

从一手资料查找答案：REST API 与 webhook 参考、速率限制页面、价格和套餐比较、访问 token 或应用文档，以及变更日志或发行说明。

最容易过时的是 beta 和预览状态（整个代理原生及 Git 存储类别都如此）、速率限制数值、解锁门禁的套餐，以及收购、关闭和重新开放后的可用性。例如，截至 2026 年 10 月，AWS CodeCommit 已重新向新客户开放，Bitbucket Data Center 仅作为与 Cloud 捆绑的混合许可销售。

## 长期容易踩的坑

设计依赖这些结论之前，逐项确认仍然成立。

- **GitHub `GITHUB_TOKEN` 会中断链条。** 内置 Actions token 产生的事件不会启动新的 workflow 运行（`workflow_dispatch` 和 `repository_dispatch` 除外），所以运行使用它推送时，下一次运行可能静默停止。从一开始就给运行使用 GitHub App 身份。
- **门禁常受付费套餐限制。** 截至 2026 年 10 月，GitHub 私有仓库 rulesets 需要 Pro、Team 或 Enterprise；GitLab 审批规则需要 Premium；强制执行的 Bitbucket 合并检查需要 Premium。
- **速率限制按身份计算，机器人类型会改变配额。** 截至 2026 年 10 月，GitHub App 安装每小时 5,000 次请求，而 `GITHUB_TOKEN` 为 1,000 次；Bitbucket 用户 token 保持基础速率，访问 token 可扩展；Azure DevOps 随机器人的访问级别增加配额。
- **套件中的跟踪器带来两条事件流。** 编排器需要自行汇合 Git 平台和工单跟踪器的事件。
