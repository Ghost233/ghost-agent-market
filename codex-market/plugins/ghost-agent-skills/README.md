# Ghost Agent Skills：Codex

包含 Git 提交、复杂合并冲突、项目 GitHub 账号配置、spec 开发交付、容器化开发、本机 Apple 容器操作和中文技术文档写作七个独立 skill。

| 入口 | 职责 |
| --- | --- |
| `$git-commit` | 检查改动并通过安全脚本创建 Git 提交 |
| `$git-merge-conflict` | 考古两侧历史并解决严重 Git 冲突 |
| `$configure-gh-account` | 配置项目的 Codex GitHub 账号环境 |
| `$spec-delivery` | 并行实施 spec，逐阶段审查复盘并提交总 PR；依赖 `mattpocock-skills-zh` |
| `$container-dev-workflow` | 使用项目容器入口，按输入变化准备依赖、构建、验证和更新产物 |
| `$apple-container` | 使用本机 Apple container 与 Orchard 运行、构建和诊断容器 |
| `$zh-tech-writing` | 编写和修改中文技术文档，检查句子、结构、排版和 AI 腔 |

每个技能目录自包含：必需规则位于自己的 `SKILL.md`，配套参考和脚本位于技能内部，可单独复制使用。

`$configure-gh-account` 为目标项目的 `.codex/config.toml` 配置 `GH_CONFIG_DIR`，并将提交姓名、邮箱及 GitHub HTTPS 认证写入 Git 本地配置。它复用已登录的 gh 凭据并验证实际身份；账号目录保存在用户目录，多个仓库可以使用不同账号并行操作 GitHub。

更新安装后在新任务中调用这些入口。现有任务可能仍持有旧版技能上下文。

`zh-tech-writing` 引自 [leter/zh-tech-writing](https://github.com/leter/zh-tech-writing)，同步自上游 [ffda935](https://github.com/leter/zh-tech-writing/commit/ffda9353768dece8aabd26ccb3a4978025e9437c)。保留原始 skill、参考文档和 MIT 许可文件。`autocorrect` 是可选工具；未安装时按 skill 规则手动检查排版。
