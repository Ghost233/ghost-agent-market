# Ghost Agent Market

这是一个 agent marketplace 工作区，包含 Claude Code / Codex 可安装插件，并以 Git submodule 跟踪 Microsoft SkillOpt。

内置 skill：

- `goal-dag-runner`
- `parallel-task-planner`
- `thread-coordination`
- `thread-goal-worker`
- `subagent-coordination`
- `subagent-goal-worker`
- `git-commit`

## Goal DAG 入口

Codex 推荐直接输入这一行：

```text
/goal 每轮使用 $goal-dag-runner，以子代理 DAG 完整执行 `./plan.md`，直到计划项覆盖率 100% 且所有验收通过。
```

Codex 原生 `/goal` 是持久外循环；`$goal-dag-runner` 每轮显式恢复并推进本地内循环。每个本地 `goal_id`/目录含 `threadId + createdAt` 的稳定 SHA-256 短摘要，因此相同 objective 的不同原生 instance 不会碰撞。恢复时仍精确校验完整 native identity 与 objective digest。首次校验先冻结工作区 baseline，并把计划文档生成 `SOURCE_BLOCKS_V1`；planner 以 source refs 和 implementation/verification effects 建立 coverage，独立 source audit 在业务修改前证明无遗漏，最终 diff audit 再由 runtime 扫描 baseline 与真实工作区。插件不会调用 `create_goal`，不会缩写或覆盖原生 objective；只有本地硬终态成立后，才调用 `update_goal` 将原生 Goal 标记为 `complete`，再用同一 completion token 执行 `native-confirm`。

Claude Code 没有 Codex 原生 Goal 生命周期，因此使用 `local_fallback`：默认实例由 source 绝对路径+digest 定位；重复执行完全相同的 source 必须显式提供新 instance key，且永不覆盖已有目录。首次显式调用 `/ghost-agent-workflow:goal-dag-runner` 执行 `./plan.md`，之后逐字使用 runtime 返回的一行 `/ghost-agent-workflow:goal-dag-runner` 提示和其中的 `goal.json` 绝对路径续跑。长上下文始终从本地状态恢复，不进入续跑提示。

逻辑 Owner 在单个 Goal 内稳定；物理 Agent 或子线程仅按 Owner 做软亲和复用，runtime 为每次 spawn 下发唯一 identity，并在 `status`/`reconcile` 为每个 active reservation 重建完整 canonical binding，供崩溃或上下文压缩后继续同一 attempt。source drift 先 drain active reservation，再以事务刷新 source/blocks/coverage/state；invalidated task 的当前 Capsule 证据会被清除。正确性只依赖持久 coverage、DAG state、Capsule、checkpoint、artifact digest 和 attempt-scoped result。

`.ghost-agent-workflow/` 是本地 runtime state，不应提交到版本库；在使用插件的项目中也应把它加入 `.gitignore`。

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
│   ├── .claude-plugin/marketplace.json
│   └── skills/
│       ├── goal-dag-runner/
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
        │       ├── goal-dag-runner/
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
