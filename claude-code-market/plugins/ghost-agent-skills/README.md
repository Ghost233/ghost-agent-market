# Ghost Agent Skills Claude Code 插件

包含 Git 提交、复杂合并冲突、项目 GitHub 账号配置、spec 开发交付、容器化开发、本机 Apple 容器操作和中文技术文档写作七个独立 skill。

推荐入口：

另提供 \`configure-gh-account\`，配置 Git 本地提交身份和 HTTPS 认证，复用已有 gh 登录并配置目标项目的 \`.codex/config.toml\`。项目 TOML 用于 Codex，不自动改变 Claude Code / ZCode 的命令环境。

\`\`\`text
/ghost-agent-skills:git-commit 检查当前改动并创建清晰的 Git 提交
/ghost-agent-skills:git-merge-conflict 考古两侧历史并解决当前严重的 Git 冲突
/ghost-agent-skills:configure-gh-account 为目标项目配置 Codex GitHub 账号环境
/ghost-agent-skills:spec-delivery 并行实施已确认 spec，逐阶段审查复盘并提交总 PR
/ghost-agent-skills:container-dev-workflow 按项目容器入口完成依赖准备、构建、验证和产物更新
/ghost-agent-skills:apple-container 使用本机 Apple container 与 Orchard 运行、构建和诊断容器
/ghost-agent-skills:zh-tech-writing 编写或修改中文技术文档
\`\`\`

`spec-delivery` 依赖 `mattpocock-skills-zh` 插件。

`zh-tech-writing` 引自 [leter/zh-tech-writing](https://github.com/leter/zh-tech-writing)，同步自上游 [ffda935](https://github.com/leter/zh-tech-writing/commit/ffda9353768dece8aabd26ccb3a4978025e9437c)。保留原始 skill、参考文档和 MIT 许可文件。`autocorrect` 是可选工具；未安装时按 skill 规则手动检查排版。
