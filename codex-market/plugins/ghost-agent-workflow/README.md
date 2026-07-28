# Ghost Agent Workflow Codex 插件

包含九个 skill：`sub-thread-coordination`、`parallel-task-planner`、`planner-reviewer`、`sub-thread-goal-worker`、`sub-thread-task-supervisor`、`setup-sub-thread-workflow`、`start-dag-dashboard`、`git-commit` 和 Codex App 专用的 `git-commit-direct-model-test`。

Codex 推荐入口只有这一行：

```text
使用 $sub-thread-coordination，以持久子线程 DAG 完整执行 `./plan.md`。
```

默认使用 `standalone_thread`，不要求原生 `/goal`。只有用户已启动或明确要求 Goal 时才桥接 `codex_native`。`gpt-5.6-luna/medium` Supervisor 只通过脚本创建、等待和通知最多 8 个执行子线程；Main 负责 reserve 与结果验收。配置包含四组 profile，机械 gate 由脚本执行。

active leaf 可在产生业务变化前 fenced 扩展为 composite 子 DAG：父 task 保留外层依赖边界，T2-1、T2-2…在内部形成可递归 DAG；dashboard 可折叠/展开并聚合父节点状态。

用户可见标题统一为 `[GA][任务][角色] <中文任务>`，例如 `[GA][任务][责任域] 实现用户登录接口`；新线程取得正式 threadId 后自行设置 canonical 标题。系统 key 只使用小写字母、数字和下划线，脚本 JSON 只作机器收据。

初始 DAG 先机械校验，再由 Planner Reviewer 只检查并行度和结构复杂度；Planner 最多修订一次。Plan/State 激活后，Main 调用 `$start-dag-dashboard` 的后台 Node 启动器；启动器从工作目录的 `.ghost-agent-workflow` 发现活动 Goal，并只报告一次 URL。`progress.json` 与 `events.jsonl` 由 runtime 脚本维护，页面通过文件监听和 SSE 推送更新，默认只监听 `127.0.0.1:7357`。

首次 `goal-validate` 保存轻量 `WORKSPACE_FENCE_V1`：Git tree/index digest 与当时的非 clean 项，不复制全部受管理文件。planner 为每个 plan item 写 source refs 和 required effects；active leaf 可在任何可归因修改前扩展为 T2-1、T2-2…递归子 DAG，父节点保留外层依赖边界。

Review 与机械验收分离：每个 task 声明 risk、policy、batch、阻塞范围和原因，Planner 把 Review 设计成显式 DAG node。共享全仓测试和 dry-run matrix 由 verify 节点生成可复用 evidence；最终门禁只补跑缺失或失效证据。

所有 JSON、JSONL、YAML、TOML、配置、Plan、State、Result、Progress 与 Review 状态只通过脚本写入。完整 `WORKER_RESULT_V5` 只落盘，子线程聊天只返回 `THREAD_TASK_RECEIPT_V1`。主线程不输出 DAG 图或普通 running 状态，只报告已经机械接受的 task 最终结果。

Owner 变化必须由脚本验证并等待用户对精确 digest 批准。Goal 模式下 runtime 进入 `awaiting_owner_action`，提示用户暂停 Goal 完成操作；应用后明确提示“可以继续 Goal”，不会用空模型回合累计 blocked 次数。

持久化并提交 `.ghost-agent-workflow/config.json` 与 `.ghost-agent-workflow/owners/**`；`.ghost-agent-workflow/runtime/**` 下的 Goal、Plan、coverage、delta、reservation、result、artifact 和 session Capsule 都是临时状态，不应提交。Owner 新增或分裂必须先由脚本验证 scope 冲突，再取得用户对精确 digest 的明确批准。
