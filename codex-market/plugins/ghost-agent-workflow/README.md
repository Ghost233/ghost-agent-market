# Ghost Agent Workflow Codex 插件

包含七个 skill：`sub-thread-coordination`、`parallel-task-planner`、`sub-thread-goal-worker`、`sub-thread-task-supervisor`、`start-dag-dashboard`、`git-commit` 和 Codex App 专用的 `git-commit-direct-model-test`。前四者组成持久子线程 DAG；`start-dag-dashboard` 只在后台启动只读进度页。

Codex 推荐入口只有这一行：

```text
使用 $sub-thread-coordination，以持久子线程 DAG 完整执行 `./plan.md`。
```

默认使用 `standalone_thread`，不要求原生 `/goal`。只有用户已启动或明确要求 Goal 时才桥接 `codex_native`。每个 Owner generation 对应一个长期子线程；同一 Owner 的后续 task 复用该子线程。固定的 `gpt-5.6-luna/low` 任务监督子线程加载 `sub-thread-task-supervisor`，只等待任务结束并通知主线程检查，不读取结果、不验收、不调度 Review。DAG 视图子线程只维护 Dashboard 和 revision diff。

active leaf 可在产生业务变化前 fenced 扩展为 composite 子 DAG：父 task 保留外层依赖边界，T2-1、T2-2…在内部形成可递归 DAG；dashboard 可折叠/展开并聚合父节点状态。

子线程系统 key 使用 `wf_<owner>_g<generation>_<goalkey>`；只允许小写字母、数字和下划线，禁止中括号、连字符、空格、中文与随机 UUID。用户可见标题使用 `[GA][TASK][OWNER] <owner_id>`、`[GA][TASK][RUNTIME] <runtime_actor_id>`、`[GA][TASK][SUPERVISOR] 任务监督` 或 `[GA][TASK][DAG_VIEW] DAG 视图`。

需要在浏览器持续观察时，使用 `$start-dag-dashboard <plan.json绝对路径>`；它调用 `python3 <plugin-root>/scripts/start-dashboard.py` 分离后台服务并返回 URL。`progress.json` 只保存当前紧凑快照，历史写入追加式 `events.jsonl`，两者都由 runtime 脚本原子更新；`/api/progress-events` 提供分页抓取。页面默认只监听 `127.0.0.1:7357`。

首次 `goal-validate` 保存轻量 `WORKSPACE_FENCE_V1`：Git tree/index digest 与当时的非 clean 项，不复制全部受管理文件。planner 为每个 plan item 写 source refs 和 required effects；active leaf 可在任何可归因修改前扩展为 T2-1、T2-2…递归子 DAG，父节点保留外层依赖边界。

Review 与机械验收分离：每个 task 声明 risk、policy、batch、阻塞范围和原因，Planner 把 Review 设计成显式 DAG node。共享全仓测试和 dry-run matrix 由 verify 节点生成可复用 evidence；最终门禁只补跑缺失或失效证据。

所有 JSON、JSONL、YAML、TOML、配置、Plan、State、Result、Progress 与 Review 状态只通过脚本写入。完整 `WORKER_RESULT_V5` 只落盘，子线程聊天只返回 `THREAD_TASK_RECEIPT_V1`。主线程不输出 DAG 图或普通 running 状态，只报告已经机械接受的 task 最终结果。

Owner 变化必须由脚本验证并等待用户对精确 digest 批准。Goal 模式下 runtime 进入 `awaiting_owner_action`，提示用户暂停 Goal 完成操作；应用后明确提示“可以继续 Goal”，不会用空模型回合累计 blocked 次数。

只持久化并提交 `.ghost-agent-workflow/owners/**`；`.ghost-agent-workflow/runtime/**` 下的 Goal、Plan、coverage、delta、reservation、result、artifact 和 session Capsule 都是临时状态，不应提交。Owner 新增或分裂必须先由脚本验证 scope 冲突，再取得用户对精确 digest 的明确批准。
