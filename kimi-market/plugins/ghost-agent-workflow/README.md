# Ghost Agent Workflow Kimi 插件

包含六个 skill：`sub-thread-coordination`、`parallel-task-planner`、`sub-thread-goal-worker`、`sub-thread-task-supervisor`、`start-dag-dashboard` 和 `git-commit`。前四者组成持久子线程 DAG；`start-dag-dashboard` 只在后台启动只读进度页。

Kimi 推荐入口只有这一行：

```text
/skill:sub-thread-coordination 执行 `./plan.md`
```

Kimi 固定使用 `standalone_thread` 生命周期，不依赖原生 Goal。只有宿主提供可创建、发送和等待的长期子线程 API 时才能执行；标准 Agent 禁止作为回退，缺少能力时 fail closed。每个 Owner generation 复用一个长期子线程，并额外维护 `gpt-5.6-luna/low` 极简任务监督子线程与 DAG 视图子线程。监督子线程加载 `sub-thread-task-supervisor`，只等待结束并通知主线程检查。

active leaf 可在产生业务变化前 fenced 扩展为 composite 子 DAG：父 task 保留外层依赖边界，T2-1、T2-2…在内部形成可递归 DAG；dashboard 可折叠/展开并聚合父节点状态。

子线程系统 key 使用 `wf_<owner>_g<generation>_<goalkey>`；只允许小写字母、数字和下划线，禁止中括号、连字符、空格、中文与随机 UUID。用户可见标题使用 `[GA][TASK][OWNER] <owner_id>`、`[GA][TASK][RUNTIME] <runtime_actor_id>`、`[GA][TASK][SUPERVISOR] 任务监督` 或 `[GA][TASK][DAG_VIEW] DAG 视图`。主线程检查通知并完成机械验收后才报告 task 最终结果。

需要在浏览器持续观察时，运行 `/skill:start-dag-dashboard <plan.json绝对路径>`；它调用 `python3 ${KIMI_SKILL_DIR}/../../scripts/start-dashboard.py` 分离后台服务并返回 URL。runtime 脚本原子维护紧凑的 `progress.json` 当前快照和追加式 `events.jsonl` 历史；`/api/progress-document` 提供快照，`/api/progress-events` 提供分页事件。页面默认只监听 `127.0.0.1:7357`。

首次 `goal-validate` 保存轻量 `WORKSPACE_FENCE_V1`：Git tree/index digest 与当时的非 clean 项，不复制全部受管理文件。active leaf 可在任何可归因修改前扩展为 T2-1、T2-2…递归子 DAG，父 task 保持外层依赖边界。

Review 是显式 DAG 节点，而不是隐形默认步骤。每个 task 声明 risk、policy、batch 和阻塞范围；机械验收由 runtime 执行，共享验证由 verify 节点生成可复用 evidence。

所有 JSON、JSONL、YAML、TOML、配置、Plan、State、Result、Progress 与 Review 状态只通过脚本写入。完整 `WORKER_RESULT_V5` 只落盘，子线程聊天只返回紧凑 `THREAD_TASK_RECEIPT_V1`。

Owner 是仓库级永久代码模块主体。新增、分裂或 scope 变化必须由脚本验证并等待用户对精确 digest 的批准；等待用户操作时不启动空模型回合累计 blocked 次数。

只持久化并提交 `.ghost-agent-workflow/owners/**`；`.ghost-agent-workflow/runtime/**` 下的 Goal、Plan、coverage、delta、reservation、result、artifact 和 session Capsule 都是临时状态，不应提交。Owner 新增或分裂必须先由脚本验证 scope 冲突，再取得用户对精确 digest 的明确批准。

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
