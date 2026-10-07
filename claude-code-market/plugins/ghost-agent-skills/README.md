# Ghost Agent Skills Claude Code 插件

包含 \`configure-gh-account\`、\`git-commit\`、\`git-merge-conflict\` 和 \`spec-delivery\` 四个独立 skill。

推荐入口：

另提供 \`configure-gh-account\`，配置 Git 本地提交身份和 HTTPS 认证，复用已有 gh 登录并配置目标项目的 \`.codex/config.toml\`。项目 TOML 用于 Codex，不自动改变 Claude Code / ZCode 的命令环境。

\`\`\`text
/ghost-agent-skills:git-commit 检查当前改动并创建清晰的 Git 提交
/ghost-agent-skills:git-merge-conflict 考古两侧历史并解决当前严重的 Git 冲突
/ghost-agent-skills:configure-gh-account 为目标项目配置 Codex GitHub 账号环境
/ghost-agent-skills:spec-delivery 并行实施已确认 spec，逐阶段审查复盘并提交总 PR
\`\`\`

`spec-delivery` 依赖 `mattpocock-skills-zh` 插件。
