# Ghost Agent Workflow Kimi 插件

包含八个 skill：`sub-thread-coordination`、`parallel-task-planner`、`planner-reviewer`、`sub-thread-goal-worker`、`sub-thread-task-supervisor`、`setup-sub-thread-workflow`、`start-dag-dashboard` 和 `git-commit`。

Kimi 推荐入口只有这一行：

```text
/skill:sub-thread-coordination 执行 `./plan.md`
```

Kimi 固定使用 `standalone_thread` 生命周期，不依赖原生 Goal。只有宿主提供可创建、发送和等待的长期子线程 API 时才能执行；标准 Agent 禁止作为回退，缺少能力时 fail closed。`gpt-5.6-luna/medium` Supervisor 只通过脚本创建、等待和通知最多 8 个执行子线程；配置包含四组 profile，机械 gate 由脚本执行。

active leaf 可在产生业务变化前 fenced 扩展为 composite 子 DAG：父 task 保留外层依赖边界，T2-1、T2-2…在内部形成可递归 DAG；dashboard 可折叠/展开并聚合父节点状态。

用户可见标题统一为 `[GA][任务][角色] <中文任务>`；新线程取得正式 threadId 后自行设置 canonical 标题。脚本 JSON 只作机器收据，主线程完成机械验收后才报告 task 最终结果。

初始 DAG 先机械校验，再由 Planner Reviewer 只检查并行度和结构复杂度；Planner 最多修订一次。Plan/State 激活后，Main 通过 `/skill:start-dag-dashboard` 调用后台 Node 启动器；启动器从工作目录的 `.ghost-agent-workflow` 发现活动 Goal，并只报告一次 URL。`progress.json` 与 `events.jsonl` 由 runtime 脚本维护，页面通过文件监听和 SSE 推送更新，默认只监听 `127.0.0.1:7357`。

首次 `goal-validate` 保存轻量 `WORKSPACE_FENCE_V1`：Git tree/index digest 与当时的非 clean 项，不复制全部受管理文件。active leaf 可在任何可归因修改前扩展为 T2-1、T2-2…递归子 DAG，父 task 保持外层依赖边界。

Review 是显式 DAG 节点，而不是隐形默认步骤。每个 task 声明 risk、policy、batch 和阻塞范围；机械验收由 runtime 执行，verify 证据由脚本登记且默认不跨 task 复用。

工作流自有的 JSON、JSONL、配置、Plan、State、Result、Progress 与 Review 状态只通过脚本写入；业务项目的 YAML/TOML 仍使用对应领域工具修改。完整 `WORKER_RESULT_V5` 只落盘，子线程聊天只返回紧凑 `THREAD_TASK_RECEIPT_V1`。

Owner 是仓库级永久代码模块主体。新增、分裂或 scope 变化必须由脚本验证并等待用户对精确 digest 的批准；等待用户操作时不启动空模型回合累计 blocked 次数。

持久化并提交 `.ghost-agent-workflow/config.json` 与 `.ghost-agent-workflow/owners/**`；`.ghost-agent-workflow/runtime/**` 下的 Goal、Plan、coverage、delta、reservation、result、artifact 和 session Capsule 都是临时状态，不应提交。Owner 新增或分裂必须先由脚本验证 scope 冲突，再取得用户对精确 digest 的明确批准。

## 安装

GitHub 一键安装（CI 从 `main` 构建的滚动 release zip）：

```text
/plugins install https://github.com/Ghost233/ghost-agent-market/releases/download/kimi-latest/ghost-agent-workflow-kimi.zip
```

或克隆本仓库后本地安装：

```text
/plugins install <仓库路径>/kimi-market/plugins/ghost-agent-workflow
```

插件安装在用户级，对全部项目生效；安装或更新后需 `/reload` 或开启新会话。本地安装会复制到 managed 目录，修改源目录后需重新安装。仓库整库 URL（含 `/tree/...`）不支持安装，monorepo 子目录的 manifest 不会被发现；zip 安装不参与自动更新检查，重新执行同一命令即可更新。Goal DAG 相关 skill 通过 `node` 执行 runtime 脚本，需要用户机器安装 Node.js（`git-commit` 不依赖）。
