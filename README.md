# Ghost Agent Market

这是一个 agent marketplace 工作区，包含 Claude Code / Codex / Kimi Code / ZCode 可安装插件，并以 Git submodule 跟踪 Microsoft SkillOpt。

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

上面列出的 workflow 是 Claude Code / Codex / Kimi Code 的共享版本；ZCode 使用后文
单独维护的副本，副本不包含监督 skill。

## 共享 Workflow 入口（Claude Code / Codex / Kimi Code）

以下 Goal DAG 说明针对三端共享 workflow，不适用于 ZCode 的独立副本；ZCode 入口与 agent 映射见后文的 ZCode 说明。

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

Claude Code 与 Kimi Code 只有在宿主提供可创建、发送和等待的长期子线程 API 时才执行该工作流；标准 Agent 禁止作为回退，缺少能力时 fail closed。

初始化脚本会生成 `.ghost-agent-workflow/.gitignore`，只保留自身、`config.json` 与 `owners/**`，并忽略 `runtime/**` 和临时 Owner interface；已有文件不覆盖。使用工作流的项目应提交这份 `.gitignore`、配置与 Owner 数据。

上游子模块：

- `SkillOpt/`：`microsoft/SkillOpt`

Codex hook 插件：

- `rtk-hook`：基于 `Ghost233/rtk-hook` 的 PreToolUse hook，通过 `rtk rewrite` 透明改写 RTK 支持的 shell 命令，不支持的命令原样放行

仓库级说明使用标准文件名：`AGENTS.md` 和 `CLAUDE.md`。

ZCode 使用仓库根目录的 `AGENTS.md` 作为工作区说明，并通过根目录的
`marketplace.json` 发布两个独立插件。ZCode 插件和 skill 副本位于
`zcode-market/plugins/`，初始从 Claude Code skill 复制，之后可以单独修改；
不会自动同步回 Claude Code、Codex 或 Kimi Code。ZCode 的每个 plugin-level agent
都与一个同名 skill 一一对应，agent 的第一条规则是先加载该 skill；一次调用只
完成一个 bounded action，不创建、等待或转发给其他 agent。workflow plugin 提供
`parallel-task-planner`、`planner-reviewer`、`setup-sub-thread-workflow`、
`start-dag-dashboard`、`sub-thread-coordination` 和 `sub-thread-goal-worker`
六个 agent，普通 skills plugin 提供 `git-commit` 和 `git-merge-conflict` 两个
agent；workflow 入口 command 是 `/parallel-workflow`。

## 目录结构

```text
ghost-agent-market/
├── SkillOpt/
├── marketplace.json                  # ZCode marketplace
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
│       └── ghost-agent-skills/
│           ├── .claude-plugin/plugin.json
│           └── skills/
│               ├── git-commit/
│               └── git-merge-conflict/
├── zcode-market/
│   └── plugins/
│       ├── ghost-agent-workflow/
│       │   ├── .zcode-plugin/plugin.json
│       │   ├── agents/
│       │   │   ├── parallel-task-planner.md
│       │   │   ├── planner-reviewer.md
│       │   │   ├── setup-sub-thread-workflow.md
│       │   │   ├── start-dag-dashboard.md
│       │   │   ├── sub-thread-coordination.md
│       │   │   └── sub-thread-goal-worker.md
│       │   ├── commands/parallel-workflow.md
│       │   ├── scripts/
│       │   ├── assets/
│       │   └── skills/
│       │       ├── parallel-task-planner/
│       │       ├── planner-reviewer/
│       │       ├── setup-sub-thread-workflow/
│       │       ├── sub-thread-coordination/
│       │       ├── sub-thread-goal-worker/
│       │       └── start-dag-dashboard/
│       └── ghost-agent-skills/
│           ├── .zcode-plugin/plugin.json
│           ├── agents/
│           │   ├── git-commit.md
│           │   └── git-merge-conflict.md
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

`kimi-market/` 提供 Kimi Code 可安装插件：

```text
kimi-market/
├── .kimi-plugin/marketplace.json
└── plugins/
    ├── ghost-agent-workflow/
    │   ├── kimi.plugin.json
    │   ├── scripts/goal-dag.mjs
    │   └── skills/
    │       ├── parallel-task-planner/
    │       ├── planner-reviewer/
    │       ├── setup-sub-thread-workflow/
    │       ├── sub-thread-coordination/
    │       ├── sub-thread-goal-worker/
    │       └── start-dag-dashboard/
    └── ghost-agent-skills/
        ├── kimi.plugin.json
        └── skills/
            ├── git-commit/
            └── git-merge-conflict/
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
codex plugin add rtk-hook@ghost-agent-market
```

安装 `rtk-hook` 后，开启新的 Codex 线程并通过 `/hooks` 信任 `RTK Hook`。

Codex marketplace 文件位置：

```text
codex-market/.agents/plugins/marketplace.json
```

## 安装 ZCode Marketplace

在 ZCode 中打开 `Settings -> Plugins -> Create -> Add marketplace`，添加在线 GitHub
marketplace `Ghost233/ghost-agent-market`，或输入完整地址
`https://github.com/Ghost233/ghost-agent-market`。找到
`ghost-agent-workflow` 和 `ghost-agent-skills` 后分别点击 `Get` 安装并启用。

安装后，ZCode 会从这两个独立插件中加载全部 skill；在任务输入框使用 `/` 的 Skills
分组，或输入 `$sub-thread-coordination`、`$git-commit`、
`$git-merge-conflict` 等名称调用；对应的 plugin-level agent 会强制先加载同名
skill。workflow 插件还可以使用 `/parallel-workflow` 作为统一入口。修改 skill、agent
或 runtime 后，在 ZCode 的 Marketplace 来源处刷新，再重新加载插件。后续只修改
`zcode-market/plugins/` 下的副本即可。

## 在线部署 ZCode Marketplace

ZCode 不需要单独的服务器或构建产物，也不需要用户下载或选择本地仓库。根目录的
`marketplace.json` 是在线插件目录，`zcode-market/plugins/` 是两个插件的实际内容；
把这两个部分推送到公开 GitHub 仓库后，ZCode 就可以在线读取并安装。详细的目录和
字段约束见
[ZCode Plugin 文档](https://zcode.z.ai/en/docs/plugin)。

### 发布前校验

维护者在提交到 GitHub 前，在仓库根目录执行：

```bash
python3 -m unittest tests.test_zcode_marketplace -v
python3 -m json.tool marketplace.json >/dev/null
```

如果修改了某个 plugin，必须同时更新该 plugin 的
`.zcode-plugin/plugin.json` 和根目录 `marketplace.json` 中的 `version`。按照本仓库
约定，每次 plugin 修改将基础版本增加 `0.0.1`；只修改 README 或测试时不需要增加
plugin 版本。

### 推送到 GitHub

确认本次改动都属于当前发布范围后，在仓库根目录执行：

```bash
git status -sb
git pull --ff-only origin main
python3 -m unittest tests.test_zcode_marketplace -v
git add README.md marketplace.json zcode-market tests/test_zcode_marketplace.py
git commit -m "feat(zcode): publish marketplace"
git push origin main
```

如果使用功能分支，将最后一条改为 `git push -u origin <branch>`，合并到默认分支
后再发布。推送成功后，GitHub 仓库中的 `marketplace.json` 和插件目录即为最新版本。

### 在 ZCode 中在线安装和更新

1. 打开 `Settings -> Plugins -> Create -> Add marketplace`。
2. 添加在线地址 `Ghost233/ghost-agent-market`，或
   `https://github.com/Ghost233/ghost-agent-market`。不要选择本地目录或本地
   `marketplace.json` 作为部署来源。
3. 在 Personal marketplace 中点击刷新，安装并启用
   `ghost-agent-workflow` 与 `ghost-agent-skills`。
4. 后续发布新版本后，在 Marketplace sources 中点击 Refresh，再点击插件详情里的
   `Check for updates`。如果 plugin 内容发生变化，先确认 plugin 版本已递增，再
   重新加载 Agent。

启用第三方 plugin 等同于授予其脚本本地执行权限；部署前应检查 `agents/`、`skills/`
和 `scripts/` 内容，只启用信任的来源。

## 安装 Kimi Code Market

GitHub 一键安装（CI 从 `main` 分支构建的滚动 release zip，免克隆）：

```text
/plugins install https://github.com/Ghost233/ghost-agent-market/releases/download/kimi-latest/ghost-agent-workflow-kimi.zip
/plugins install https://github.com/Ghost233/ghost-agent-market/releases/download/kimi-latest/ghost-agent-skills-kimi.zip
```

或克隆本仓库后本地安装：

```text
/plugins install <仓库路径>/kimi-market/plugins/ghost-agent-workflow
/plugins install <仓库路径>/kimi-market/plugins/ghost-agent-skills
```

也可以通过 marketplace 清单安装（远程用 `kimi-market/.kimi-plugin/marketplace-remote.json` 的 raw URL，本地用 `marketplace.json`）。注意 Kimi 不支持仓库整库 URL（含 `/tree/...`）安装 monorepo 子目录插件，必须走 release zip 或本地路径。

插件为用户级安装，对所有项目生效；安装或更新后需要 `/reload` 或开启新会话。只有 `ghost-agent-workflow` 的 Goal DAG skill 需要用户机器安装 Node.js。推荐入口：

```text
/skill:sub-thread-coordination 以 Owner 工作流执行 `./plan.md`；需要时单向升级为最小 DAG。
```
