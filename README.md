# Ghost Agent Market

这是一个合并仓库，同时提供 Claude Code 和 Codex 的本地 market / marketplace。

内置 skill：

- `thread-coordination`
- `thread-goal-worker`

仓库级说明使用标准文件名：`AGENTS.md` 和 `CLAUDE.md`。

## 目录结构

```text
ghost-agent-market/
├── claude-code-market/
│   ├── .claude-plugin/plugin.json
│   └── skills/
│       ├── thread-coordination/
│       └── thread-goal-worker/
└── codex-market/
    ├── .agents/plugins/marketplace.json
    └── plugins/thread-goal-workflow/
        ├── .codex-plugin/plugin.json
        └── skills/
            ├── thread-coordination/
            └── thread-goal-worker/
```

## 安装 Claude Code Market

先克隆仓库：

```bash
git clone https://github.com/Ghost233/ghost-agent-market.git
```

然后在 Claude Code 里添加 Claude Code market：

```text
/plugin marketplace add /path/to/ghost-agent-market/claude-code-market
```

安装内置插件：

```text
/plugin install thread-goal-workflow
```

如果你把仓库克隆在当前项目旁边，也可以使用相对路径：

```text
/plugin marketplace add ./ghost-agent-market/claude-code-market
```

## 安装 Codex Marketplace

先克隆仓库：

```bash
git clone https://github.com/Ghost233/ghost-agent-market.git
```

把 Codex marketplace 添加到 Codex：

```bash
codex plugin marketplace add /path/to/ghost-agent-market/codex-market
```

如果你把仓库克隆在当前项目旁边，也可以使用相对路径：

```bash
codex plugin marketplace add ./ghost-agent-market/codex-market
```

然后打开 Codex 插件市场，安装 `thread-goal-workflow`。

Codex marketplace 文件位置：

```text
codex-market/.agents/plugins/marketplace.json
```
