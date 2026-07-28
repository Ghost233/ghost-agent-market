# Ghost Agent Market

这是一个 agent marketplace 工作区，包含 Claude Code / Codex / Kimi Code 可安装插件，并以 Git submodule 跟踪 Microsoft SkillOpt。

内置 skill：

- `parallel-task-planner`
- `sub-thread-coordination`
- `sub-thread-goal-worker`
- `sub-thread-task-supervisor`
- `start-dag-dashboard`
- `git-commit`

Codex App 专用测试 skill：

- `git-commit-direct-model-test`

## Goal DAG 入口

Codex 默认不需要原生 `/goal`，直接输入：

```text
使用 $sub-thread-coordination，以持久子线程 DAG 完整执行 `./plan.md`。
```

`sub-thread-coordination` 是唯一协调入口。工作流为每个 Owner generation 维护一个可长期复用的子线程，并额外维护一个 `gpt-5.6-luna/low` 极简任务监督子线程和一个 DAG 视图子线程。监督子线程通过专用 `sub-thread-task-supervisor` Skill 只等待任务结束并通知主线程检查，不解析结果、不验收、不调度 Review。完整 DAG、进度与历史事件由网页 Dashboard 展示。

运行中的叶子任务如果发现需要插接多步工作，可在修改业务文件前发出 fenced 子图请求。runtime 原子把 T2 转成保留外层依赖边界的 composite，并在内部加入 T2-1、T2-2…递归 DAG；下游仍只依赖 T2，网页可折叠/展开子图并显示父节点聚合状态。

子线程系统 key 使用 `wf_<owner>_g<generation>_<goalkey>`；只允许小写字母、数字和下划线，禁止中括号、连字符、空格、中文与随机 UUID。用户可见标题使用 `[GA][TASK][OWNER] <owner_id>`、`[GA][TASK][RUNTIME] <runtime_actor_id>`、`[GA][TASK][SUPERVISOR] 任务监督` 或 `[GA][TASK][DAG_VIEW] DAG 视图`。

可用 `$start-dag-dashboard` 调用 `python3 <plugin-root>/scripts/start-dashboard.py <plan.json> [state.json]`，把零依赖、只读的实时页面放入独立后台进程；重复调用会复用同一服务并返回 URL。`progress.json` 只保存当前紧凑快照，历史写入追加式 `events.jsonl`，两者都由 runtime 脚本原子更新，模型不得直接编辑；`/api/progress-events` 提供分页抓取。页面默认监听 `127.0.0.1:7357`。

模型 Review 不再是每个 task 的隐式步骤。Planner 必须把 Review 设计为显式 DAG 节点，并为 task 声明风险、Review 策略、批次和阻塞范围。机械验收由脚本执行；全仓验证与 dry-run matrix 由独立 verify 节点生成可复用证据，最终门禁只补跑失效证据。

所有 JSON、JSONL、YAML、TOML、配置、Plan、State、Result、Progress 与 Review 状态都必须通过项目脚本或 runtime 命令写入。完整 `WORKER_RESULT_V5` 只落盘，子线程聊天只返回紧凑 `THREAD_TASK_RECEIPT_V1`。

原生 Goal 是可选桥接：默认使用 `standalone_thread`，用户可以直接回答 Owner 变化。只有用户已启动或明确要求 Goal 时才使用 `codex_native`。Goal 模式遇到 Owner 变化时进入 `awaiting_owner_action`，通知用户暂停 Goal 并处理精确变更；应用后提示“可以继续 Goal”，不通过空模型回合累计 blocked 次数。

Claude Code 与 Kimi Code 只有在宿主提供可创建、发送和等待的长期子线程 API 时才执行该工作流；标准 Agent 禁止作为回退，缺少能力时 fail closed。

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
│       ├── sub-thread-coordination/
│       ├── sub-thread-goal-worker/
│       ├── sub-thread-task-supervisor/
│       └── git-commit/
└── codex-market/
    ├── .agents/plugins/marketplace.json
    └── plugins/
        ├── ghost-agent-workflow/
        │   ├── .codex-plugin/plugin.json
        │   └── skills/
        │       ├── parallel-task-planner/
        │       ├── sub-thread-coordination/
        │       ├── sub-thread-goal-worker/
        │       ├── sub-thread-task-supervisor/
        │       ├── start-dag-dashboard/
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
            ├── sub-thread-coordination/
            ├── sub-thread-goal-worker/
            ├── sub-thread-task-supervisor/
            ├── start-dag-dashboard/
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
/skill:sub-thread-coordination 以持久子线程 DAG 执行 `./plan.md`。
```
