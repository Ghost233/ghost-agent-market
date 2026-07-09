# Codex Marketplace

这个目录提供 Codex 可安装的 marketplace 条目，包含：

- `ghost-agent-workflow`
- `rtk-hook`

`ghost-agent-workflow` 包含以下三个 skill：

- `thread-coordination`
- `thread-goal-worker`
- `git-commit`

`rtk-hook` 调用 RTK 原生 `rtk hook codex` PreToolUse hook，通过 Codex `updatedInput` 改写 Bash 命令。

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

`rtk-hook` 依赖包含 `rtk hook codex` 的 RTK 版本或本地构建版。安装后，在 Codex 配置中开启 hooks：

```toml
[features]
hooks = true
```

然后开启新的 Codex 线程，并通过 `/hooks` 信任 `RTK Hook`。

Marketplace 文件位置：

```text
.agents/plugins/marketplace.json
```
