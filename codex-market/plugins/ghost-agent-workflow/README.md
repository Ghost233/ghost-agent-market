# Ghost Agent Workflow Codex 插件

包含七个工作流 skill：`sub-thread-coordination`、`parallel-task-planner`、`planner-reviewer`、`sub-thread-goal-worker`、`sub-thread-task-supervisor`、`setup-sub-thread-workflow` 和 `start-dag-dashboard`。

通用 `git-commit` 与 Codex App 专用的 `git-commit-direct-model-test` 已迁移到独立的 `ghost-agent-skills` 插件。

Codex 推荐入口只有这一行：

```text
使用 $sub-thread-coordination，以 Owner 工作流完整执行 `./plan.md`；如果未指定 Quick 或 DAG，先让我选择运行模式。
```

业务 DAG 默认使用 `standalone_thread`，不要求用户启动原生 `/goal`。启动前必须由用户明确选择模式；Quick 由 Main 串行执行 Owner 与显式 Review；DAG 移交后的 Main 使用 `gpt-5.6-sol/xhigh`，Supervisor 使用 `gpt-5.6-luna/medium` 和脚本驱动的按需原生 Goal 监督最多 8 个 ready 线程，没有 active 任务就 complete。当前 Goal 建立后统一用 `workflow step <goal-dir>` 恢复。配置包含五组 profile，机械 gate 与定向验证由脚本执行。

DAG 使用 `workflow start-dag <workspace> <development-key>`，由脚本生成 `ga/<key>/main` 与 `ga/<key>/<owner_id>`。原始工作区不切换分支并允许并行提交；最终合并基于原始分支最新 HEAD，冲突时不清理任何现场。

active leaf 可在产生业务变化前 fenced 扩展为 composite 子 DAG：父 task 保留外层依赖边界，T2-1、T2-2…在内部形成可递归 DAG；dashboard 可折叠/展开并聚合父节点状态。

用户可见标题统一为 `[GA][任务][角色] <中文任务>`，例如 `[GA][任务][责任域] 实现用户登录接口`；新线程取得正式 threadId 后自行设置 canonical 标题。系统 key 只使用小写字母、数字和下划线，脚本 JSON 只作机器收据。

初始 DAG 先机械校验，再由 Planner Reviewer 只检查并行度和结构复杂度；Planner 最多修订一次。Plan/State 激活后，Main 调用 `$start-dag-dashboard` 的后台 Node 启动器并只报告一次共享 URL。所有项目竞争 `127.0.0.1:57357`，首个成功者作为主看板，其他参与者推送变化；主看板退出后自动重新选举。页面顶部按工作区文件夹提供项目 Tab，`progress.json` 与 `events.jsonl` 仍由 runtime 脚本维护。

首次 `goal-validate` 保存轻量 `WORKSPACE_FENCE_V1`：Git tree/index digest 与当时的非 clean 项，不复制全部受管理文件。planner 为每个 plan item 写 source refs 和 required effects；active leaf 可在任何可归因修改前扩展为 T2-1、T2-2…递归子 DAG，父节点保留外层依赖边界。

Review 与机械验收分离：每个 task 声明 risk、policy、batch、阻塞范围和原因，Planner 把 Review 设计成显式 DAG node。验证由脚本真实执行，只保留当前日志，不保存或复用历史证据。

工作流自有的 JSON、JSONL、配置、Plan、State、Result、Progress 与 Review 状态只通过脚本写入；业务项目的 YAML/TOML 仍使用对应领域工具修改。完整 `WORKER_RESULT_V5` 只落盘，子线程聊天只返回 `THREAD_TASK_RECEIPT_V1`。主线程不输出 DAG 图或普通 running 状态，只报告已经机械接受的 task 最终结果。

Owner 变化必须由脚本验证并等待用户对精确 digest 批准。Goal 模式下 runtime 返回 `owner_action_required`，提示用户暂停 Goal 完成操作；应用后明确提示“可以继续 Goal”，不会用空模型回合累计 blocked 次数。

初始化脚本自动生成 `.ghost-agent-workflow/.gitignore`，只跟踪自身、`config.json` 与 `owners/**`，并忽略 runtime 和临时 Owner interface；已有文件不覆盖。Owner 新增或分裂必须先由脚本验证 scope 冲突，再取得用户对精确 digest 的明确批准。
