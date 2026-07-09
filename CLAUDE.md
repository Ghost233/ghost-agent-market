# CLAUDE.md

## Git 身份

在这个仓库工作时，所有提交的作者和提交者都必须是：

- 名称：`Ghost233`
- 邮箱：`only.yesc@gmail.com`

提交前设置或修正本地仓库身份：

```bash
git config user.name Ghost233
git config user.email only.yesc@gmail.com
```

不要使用其他名称或邮箱创建提交。

## 仓库用途

这个仓库用于维护本地 agent marketplace 相关内容：

- Claude Code 本地插件入口：`claude-code-market/`
- Codex 本地 marketplace/plugin 入口：`codex-market/`
- Microsoft SkillOpt 上游子模块：`SkillOpt/`

## Skill 同步规则

更新任意 skill 内容时，必须同时更新 Claude Code 和 Codex 两端对应内容：

- Claude Code：`claude-code-market/skills/<skill>/`
- Codex：`codex-market/plugins/ghost-agent-workflow/skills/<skill>/`

只有用户明确要求单端差异化实现时，才允许两端内容不同；这种差异必须在对应 skill 中写清平台原因。
