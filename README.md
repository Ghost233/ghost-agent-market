# Ghost Agent Market

这是一个 agent marketplace 工作区，包含 Claude Code / Codex / Kimi Code 可安装插件，并以 Git submodule 跟踪 Microsoft SkillOpt。

内置 skill：

- `parallel-task-planner`
- `subagent-coordination`
- `subagent-goal-worker`
- `git-commit`

Codex App 专用测试 skill：

- `git-commit-direct-model-test`

## Goal DAG 入口

Codex 推荐直接输入这一行：

```text
/goal 每轮使用 $subagent-coordination，以子代理 DAG 完整执行 `./plan.md`，直到计划项覆盖率 100% 且所有验收通过。
```

Codex 原生 `/goal` 是持久外循环；`$subagent-coordination` 使用 `DAG_PLAN_V5` 调度永久模块 Owner 与三个机械 runtime actor。source audit 在修改前证明覆盖，diff audit 核对 runtime 自动归因，commit-readiness 最后生成 `DELIVERY_MANIFEST_V1`。首次展示完整 DAG，后续 delta 默认只展示 DAG diff。

Claude Code 没有 Codex 原生 Goal 生命周期，因此使用 `local_fallback`：默认实例由 source 绝对路径+digest 定位；重复执行完全相同的 source 必须显式提供新 instance key，且永不覆盖已有目录。首次显式调用 `/ghost-agent-workflow:subagent-coordination` 执行 `./plan.md`，之后逐字使用 runtime 返回的一行同名 skill 提示和其中的 `goal.json` 绝对路径续跑。长上下文始终从本地状态恢复，不进入续跑提示。

逻辑 Owner 以代码模块为边界，在仓库中跨 Goal 永久存在；开发、查资料、搜索、审查、修复和建议都只能由该模块 Owner 完成。Registry V2 以 include/exclude 表达 scope，所有新增、分裂、扩张、收缩、转移和合并都先经脚本验证，再等待用户对精确 digest 批准。仓库级 lease 阻止两个 Goal 同时使用同一 Owner；跨 Owner 只能消费发布的 interface/handoff。物理 Agent 只是可替换执行载体。

使用工作流的项目只持久化并提交 `.ghost-agent-workflow/owners/**`；`.ghost-agent-workflow/runtime/**` 下的 Goal、Plan、结果和审计产物都应加入 `.gitignore`。

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
│       ├── parallel-task-planner/
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
        │       ├── subagent-coordination/
        │       ├── subagent-goal-worker/
        │       ├── git-commit/
        │       └── git-commit-direct-model-test/
        └── rtk-hook/
            ├── .codex-plugin/plugin.json
            ├── hooks/
            ├── scripts/
            └── rules.json
```

`kimi-market/` 提供 Kimi Code 可安装插件：

```text
kimi-market/
├── .kimi-plugin/marketplace.json
└── plugins/
    └── ghost-agent-workflow/
        ├── kimi.plugin.json
        ├── scripts/goal-dag.mjs
        └── skills/
            ├── parallel-task-planner/
            ├── subagent-coordination/
            ├── subagent-goal-worker/
            └── git-commit/
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

## 安装 Kimi Code Market

GitHub 一键安装（CI 从 `main` 分支构建的滚动 release zip，免克隆）：

```text
/plugins install https://github.com/Ghost233/ghost-agent-market/releases/download/kimi-latest/ghost-agent-workflow-kimi.zip
```

或克隆本仓库后本地安装：

```text
/plugins install <仓库路径>/kimi-market/plugins/ghost-agent-workflow
```

也可以通过 marketplace 清单安装（远程用 `kimi-market/.kimi-plugin/marketplace-remote.json` 的 raw URL，本地用 `marketplace.json`）。注意 Kimi 不支持仓库整库 URL（含 `/tree/...`）安装 monorepo 子目录插件，必须走 release zip 或本地路径。

插件为用户级安装，对所有项目生效；安装或更新后需要 `/reload` 或开启新会话。Goal DAG 相关 skill 需要用户机器安装 Node.js（`git-commit` 不依赖）。推荐入口：

```text
/skill:subagent-coordination 执行 `./plan.md`，以子代理 DAG 完整执行，直到计划项覆盖率 100% 且所有验收通过。
```
