# Codex Marketplace

这个目录提供 Codex 可安装的 marketplace 条目，包含 `thread-goal-workflow` 插件。

插件包含以下两个 skill：

- `thread-coordination`
- `thread-goal-worker`

## 安装

把远程 marketplace 添加到 Codex：

```bash
codex plugin marketplace add Ghost233/ghost-agent-market --sparse codex-market
```

安装插件：

```bash
codex plugin add thread-goal-workflow@ghost-agent-market
```

如果需要使用 SSH 认证，把 `Ghost233/ghost-agent-market` 换成 `git@github.com:Ghost233/ghost-agent-market.git`。

Marketplace 文件位置：

```text
.agents/plugins/marketplace.json
```
