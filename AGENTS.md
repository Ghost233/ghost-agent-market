# AGENTS.md

## Git 身份

这个仓库里的所有提交都必须使用下面这组本地 Git 身份：

```bash
git config user.name Ghost233
git config user.email only.yesc@gmail.com
```

在暂存或提交之前，先确认：

```bash
git config user.name
git config user.email
```

如果任意一项不是 `Ghost233` 或 `only.yesc@gmail.com`，不要提交。

## 范围

这个仓库当前包含：

- `claude-code-market/`：Claude Code 本地插件入口
- `codex-market/`：Codex 本地 marketplace/plugin 入口
- `SkillOpt/`：`microsoft/SkillOpt` Git submodule

本地 market 部分分发 `thread-coordination` 和 `thread-goal-worker` 两个 skill。
