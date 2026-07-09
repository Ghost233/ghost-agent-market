# Ghost Agent Market

这是一个 agent marketplace 工作区，包含 Claude Code / Codex 可安装插件，并以 Git submodule 跟踪 Microsoft SkillOpt。

内置 skill：

- `thread-coordination`
- `thread-goal-worker`

上游子模块：

- `SkillOpt/`：`microsoft/SkillOpt`

仓库级说明使用标准文件名：`AGENTS.md` 和 `CLAUDE.md`。

## 目录结构

```text
ghost-agent-market/
├── SkillOpt/
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

在 Claude Code 里添加远程 marketplace：

```text
/plugin marketplace add Ghost233/ghost-agent-market --sparse claude-code-market
```

安装插件：

```text
/plugin install thread-goal-workflow@ghost-agent-market
```

如果需要使用 SSH 认证，把 `Ghost233/ghost-agent-market` 换成 `git@github.com:Ghost233/ghost-agent-market.git`。

## 安装 Codex Marketplace

把远程 marketplace 添加到 Codex：

```bash
codex plugin marketplace add Ghost233/ghost-agent-market --sparse codex-market
```

安装插件：

```bash
codex plugin add thread-goal-workflow@ghost-agent-market
```

如果需要使用 SSH 认证，把 `Ghost233/ghost-agent-market` 换成 `git@github.com:Ghost233/ghost-agent-market.git`。

Codex marketplace 文件位置：

```text
codex-market/.agents/plugins/marketplace.json
```
