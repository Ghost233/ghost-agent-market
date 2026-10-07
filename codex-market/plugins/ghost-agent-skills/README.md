# Ghost Agent Skills：Codex

包含 Git 提交、复杂合并冲突与项目 GitHub 账号配置三个独立 skill。

| 入口 | 职责 |
| --- | --- |
| `$git-commit` | 检查改动并通过安全脚本创建 Git 提交 |
| `$git-merge-conflict` | 考古两侧历史并解决严重 Git 冲突 |
| `$configure-gh-account` | 配置项目的 Codex GitHub 账号环境 |

每个技能目录自包含：必需规则位于自己的 `SKILL.md`，配套参考和脚本位于技能内部，可单独复制使用。

`$configure-gh-account` 为目标项目的 `.codex/config.toml` 配置 `GH_CONFIG_DIR`，并将提交姓名、邮箱及 GitHub HTTPS 认证写入 Git 本地配置。它复用已登录的 gh 凭据并验证实际身份；账号目录保存在用户目录，多个仓库可以使用不同账号并行操作 GitHub。

更新安装后在新任务中调用这些入口。现有任务可能仍持有旧版技能上下文。
