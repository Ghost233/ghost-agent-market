# Ghost Agent Market

这是一个 agent marketplace 工作区，包含 Claude Code / Codex 可安装插件，并以 Git submodule 跟踪 Microsoft SkillOpt。

内置 skill：

- `parallel-task-planner`
- `thread-coordination`
- `thread-goal-worker`
- `subagent-coordination`
- `subagent-goal-worker`
- `git-commit`

任务规划采用显式门禁：只有用户已经完成当前任务说明、明确要求对该任务进行 DAG 或并行规划，并且唯一选择子线程或子代理执行方式时，才会生成计划。任务不必预先包含验收标准；背景介绍、设想、尚未说完或准备继续补充的需求，以及普通实施请求都不会自动触发规划。执行方式没有默认值。

上游子模块：

- `SkillOpt/`：`microsoft/SkillOpt`

Codex hook 插件：

- `rtk-hook`：基于 `Ghost233/rtk-hook` 的 PreToolUse hook，对未通过 `rtk` 前缀执行的 shell 命令给出重试提示

仓库级说明使用标准文件名：`AGENTS.md` 和 `CLAUDE.md`。

## 目录结构

```text
ghost-agent-market/
├── SkillOpt/
├── claude-code-market/
│   ├── .claude-plugin/plugin.json
│   └── skills/
│       ├── parallel-task-planner/
│       ├── thread-coordination/
│       ├── thread-goal-worker/
│       ├── subagent-coordination/
│       ├── subagent-goal-worker/
│       └── git-commit/
└── codex-market/
    ├── .agents/plugins/marketplace.json
    └── plugins/
        ├── ghost-agent-workflow/
        │   ├── .codex-plugin/plugin.json
        │   └── skills/
        │       ├── parallel-task-planner/
        │       ├── thread-coordination/
        │       ├── thread-goal-worker/
        │       ├── subagent-coordination/
        │       ├── subagent-goal-worker/
        │       └── git-commit/
        └── rtk-hook/
            ├── .codex-plugin/plugin.json
            ├── hooks/
            ├── scripts/
            └── rules.json
```

## 安装 Claude Code Market

在 Claude Code 里添加远程 marketplace：

```text
/plugin marketplace add Ghost233/ghost-agent-market --sparse claude-code-market
```

安装插件：

```text
/plugin install ghost-agent-workflow@ghost-agent-market
```

## 安装 Codex Marketplace

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

Codex marketplace 文件位置：

```text
codex-market/.agents/plugins/marketplace.json
```
