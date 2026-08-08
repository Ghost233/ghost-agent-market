# Ghost Agent Market

这是一个 agent marketplace 工作区，包含 Claude Code / Codex 可安装插件，并以 Git submodule 跟踪 Microsoft SkillOpt。

`ghost-agent-workflow` 内置工作流 skill：

- `parallel-task-planner`
- `planner-reviewer`
- `setup-sub-thread-workflow`
- `sub-thread-coordination`
- `sub-thread-goal-worker`
- `sub-thread-task-supervisor`
- `start-dag-dashboard`

`ghost-agent-skills` 内置普通 skill：

- `git-commit`
- `git-merge-conflict`

`mattpocock-skills-zh` 是 Matt Pocock《Skills for Real Engineers》的非官方中文翻译版，收录上游发布的 25 个稳定 skill。推荐整包安装这个 plugin，无需逐个复制 skill 目录。

上面列出的 workflow 是 Claude Code 与 Codex 共享的版本。

## 共享 Workflow 入口（Claude Code / Codex）

以下 Goal DAG 说明针对 Claude Code 与 Codex 共享 workflow。

Codex 默认不需要原生 `/goal`，直接输入：

```text
使用 $sub-thread-coordination，以 Owner 工作流完整执行 `./plan.md`；如果未指定 Quick 或 DAG，先让我选择运行模式。
```

`sub-thread-coordination` 是唯一协调入口，用户必须先明确选择模式。Quick 由 Main 严格串行调度 Owner 和显式 Review，不启动 Planner、Supervisor 或 Dashboard；DAG 使用最小顶层图，Codex Supervisor 以脚本驱动的按需原生 Goal 监督最多 8 个已登记线程，没有 active 任务就 complete，其他平台使用同一脚本契约的宿主长期监督循环。当前 Goal 建立后只用 `workflow step <goal-dir>` 恢复，不再通过 DAG worktree 路径重复调用 `start-dag`。新线程只能通过 `create_thread` 创建，禁止 fork Main 历史；Owner Git 同步由 Main 显式执行 `workflow owner-sync`。`setup-sub-thread-workflow` 配置并行上限与五组 profile；机械 gate 与 Worker 定向验证由脚本实际执行。

DAG 使用 `workflow start-dag <workspace> <development-key>`，脚本创建 `ga/<key>/main` 集成分支和 `ga/<key>/<owner_id>` Owner 分支。首次启动若配置不存在，只在内存读取默认值；配置会在 DAG worktree 认领后创建并提交，不会先弄脏原始工作区。原始工作区始终停留在用户分支并允许继续提交；最终合并面向其最新 HEAD，冲突时保留全部分支与 worktree。

运行中的叶子任务如果发现需要插接多步工作，可在修改业务文件前发出 fenced 子图请求。runtime 原子把 T2 转成保留外层依赖边界的 composite，并在内部加入 T2-1、T2-2…递归 DAG；下游仍只依赖 T2，网页可折叠/展开子图并显示父节点聚合状态。

子线程系统 key 只允许小写字母、数字和下划线。用户可见标题统一为 `[GA][任务][角色] <中文任务>`，中文后缀最多 32 个字符且不包含路径列表；每个新线程取得正式 threadId 后自行调用 `set_thread_title`。脚本 JSON 只作机器收据，不复制到聊天。

初始 DAG 先由 runtime 机械校验，再由独立 Planner Reviewer 只审查并行度和结构复杂度；最多允许 Planner 修订一次。Plan/State 激活后，Main 用 `$start-dag-dashboard` 调用后台 Node 启动器；启动器从指定工作目录的 `.ghost-agent-workflow` 发现活动 Goal，并只报告一次 URL。`progress.json` 与 `events.jsonl` 均由 runtime 脚本维护，模型不得直接编辑；网页通过文件监听和 SSE 推送更新，默认监听 `127.0.0.1:57357`。

模型 Review 不再是每个 task 的隐式步骤。Planner 必须把 Review 设计为显式 DAG 节点，并为 task 声明风险、Review 策略、批次和阻塞范围。机械验收由脚本执行；每个验证只保留当前运行日志，不保存或复用 evidence history。

工作流自有的 JSON、JSONL、配置、Plan、State、Result、Progress 与 Review 状态都通过项目脚本或 runtime 命令写入；业务项目的 YAML/TOML 使用对应领域工具修改。完整 `WORKER_RESULT_V5` 只落盘，子线程聊天只返回紧凑 `THREAD_TASK_RECEIPT_V1`。

生命周期保持有限：Workflow 只有 `active/completed/stopped/cancelled`，Task 只有 `pending/running/completed/stopped`。停止态必须使用固定的 `reason/action` 矩阵，未知值直接拒绝；reservation、Owner phase、线程状态、Worker 结果和调度命令只属于执行元数据。可用 `workflow lifecycle-contract` 查看权威契约；不提供迁移命令，不符合当前 Plan 契约的 Goal 由 runtime 拒绝。

原生 Goal 是可选桥接：默认使用 `standalone_thread`，用户可以直接回答 Owner 变化。只有用户已启动或明确要求 Goal 时才使用 `codex_native`。Goal 模式遇到 Owner 变化时返回 `owner_action_required`，通知用户暂停 Goal 并处理精确变更；应用后提示“可以继续 Goal”，不通过空模型回合累计 blocked 次数。

Claude Code 只有在宿主提供可创建、发送和等待的长期子线程 API 时才执行该工作流；标准 Agent 禁止作为回退，缺少能力时 fail closed。

初始化脚本会生成 `.ghost-agent-workflow/.gitignore`，只保留自身、`config.json` 与 `owners/**`，并忽略 `runtime/**` 和临时 Owner interface；已有文件不覆盖。使用工作流的项目应提交这份 `.gitignore`、配置与 Owner 数据。

上游子模块：

- `SkillOpt/`：`microsoft/SkillOpt`

Codex hook 插件：

- `rtk-hook`：基于 `Ghost233/rtk-hook` 的 PreToolUse hook，通过 `rtk rewrite` 透明改写 RTK 支持的 shell 命令，不支持的命令原样放行

仓库级说明使用标准文件名：`AGENTS.md` 和 `CLAUDE.md`。

## 目录结构

```text
ghost-agent-market/
├── SkillOpt/
├── claude-code-market/
│   ├── .claude-plugin/plugin.json
│   ├── .claude-plugin/marketplace.json
│   ├── skills/
│   │   ├── parallel-task-planner/
│   │   ├── planner-reviewer/
│   │   ├── setup-sub-thread-workflow/
│   │   ├── sub-thread-coordination/
│   │   └── sub-thread-goal-worker/
│   └── plugins/
│       ├── ghost-agent-skills/
│           ├── .claude-plugin/plugin.json
│           └── skills/
│               ├── git-commit/
│               └── git-merge-conflict/
└── codex-market/
    ├── .agents/plugins/marketplace.json
    └── plugins/
        ├── ghost-agent-workflow/
        │   ├── .codex-plugin/plugin.json
        │   └── skills/
        │       ├── parallel-task-planner/
        │       ├── planner-reviewer/
        │       ├── setup-sub-thread-workflow/
        │       ├── sub-thread-coordination/
        │       ├── sub-thread-goal-worker/
        │       └── start-dag-dashboard/
        ├── ghost-agent-skills/
        │   ├── .codex-plugin/plugin.json
        │   └── skills/
        │       ├── git-commit/
        │       └── git-merge-conflict/
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
/plugin install ghost-agent-skills@ghost-agent-market
/plugin install mattpocock-skills-zh@ghost-agent-market
```

## 安装 Codex Marketplace

把远程 marketplace 添加到 Codex：

```bash
codex plugin marketplace add Ghost233/ghost-agent-market
```

安装插件：

```bash
codex plugin add ghost-agent-workflow@ghost-agent-market
codex plugin add ghost-agent-skills@ghost-agent-market
codex plugin add mattpocock-skills-zh@ghost-agent-market
codex plugin add rtk-hook@ghost-agent-market
```

安装或更新 `mattpocock-skills-zh` 后，请新开一个 Claude Code 会话或 Codex 任务，让 25 个 skill 重新加载。

安装 `rtk-hook` 后，开启新的 Codex 线程并通过 `/hooks` 信任 `RTK Hook`。

Codex marketplace 文件位置：

```text
codex-market/.agents/plugins/marketplace.json
```
