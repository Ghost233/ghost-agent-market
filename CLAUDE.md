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

本地 market 部分分发 `thread-coordination` 和 `thread-goal-worker` 两个 skill。
