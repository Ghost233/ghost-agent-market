# Codex Marketplace

这个目录提供 Codex 可安装的 marketplace 条目，包含：

- `ghost-agent-workflow`
- `rtk-hook`

`ghost-agent-workflow` 包含以下三个 skill：

- `thread-coordination`
- `thread-goal-worker`
- `git-commit`

`rtk-hook` 基于 `Ghost233/rtk-hook`，通过 PreToolUse hook 对未通过 `rtk` 前缀执行的 shell 命令给出重试提示。

## 安装

把远程 marketplace 添加到 Codex：

```bash
codex plugin marketplace add Ghost233/ghost-agent-market --sparse codex-market
```

安装插件：

```bash
codex plugin add ghost-agent-workflow@ghost-agent-market
codex plugin add rtk-hook@ghost-agent-market
```

安装 `rtk-hook` 后，开启新的 Codex 线程并通过 `/hooks` 信任 `RTK Hook`。

Marketplace 文件位置：

```text
.agents/plugins/marketplace.json
```
