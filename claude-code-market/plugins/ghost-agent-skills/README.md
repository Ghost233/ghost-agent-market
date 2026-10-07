# Ghost Agent Skills Claude Code 插件

包含与 Owner/DAG 工作流解耦的 \`ghost-implement-spec\`、\`compile-feature-knowledge\`、\`git-commit\` 和 \`git-merge-conflict\` skill。\`ghost-implement-spec\` 复用 Matt 的 \`implement-spec\`，只覆盖全部子代理为 Sonnet。

推荐入口：

另提供 \`configure-gh-account\`，复用已有 gh 登录并配置目标项目的 \`.codex/config.toml\`。该配置用于 Codex，不自动改变 Claude Code / ZCode 的命令环境。

\`\`\`text
/ghost-agent-skills:ghost-implement-spec 按关联工单实施这份规格
/ghost-agent-skills:compile-feature-knowledge 整理当前功能知识
/ghost-agent-skills:git-commit 检查当前改动并创建清晰的 Git 提交
/ghost-agent-skills:git-merge-conflict 考古两侧历史并解决当前严重的 Git 冲突
/ghost-agent-skills:configure-gh-account 为目标项目配置 Codex GitHub 账号环境
\`\`\`
