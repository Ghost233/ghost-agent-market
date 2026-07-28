# Codex Marketplace

这个目录提供 Codex 可安装的 marketplace 条目：

- `ghost-agent-workflow`
- `rtk-hook`

`ghost-agent-workflow` 包含七个 skill：

- `parallel-task-planner`
- `sub-thread-coordination`
- `sub-thread-goal-worker`
- `sub-thread-task-supervisor`
- `start-dag-dashboard`
- `git-commit`
- `git-commit-direct-model-test`

## 推荐入口

```text
使用 $sub-thread-coordination，以持久子线程 DAG 完整执行 `./plan.md`。
```

`sub-thread-coordination` 是唯一协调入口。每个 Owner generation 对应一个长期子线程，同一 Owner 后续 task 复用该子线程；固定的 `gpt-5.6-luna/low` 任务监督子线程加载 `sub-thread-task-supervisor`，只等待任务结束并通知主线程检查，不解析结果、不验收、不调度 Review。独立 DAG 视图子线程负责 Dashboard 与变化投影。

默认生命周期是 `standalone_thread`，不强制创建原生 Goal。只有用户已启动或明确要求 Goal 时才桥接 `codex_native`。Goal 模式遇到 Owner 变化时进入 `awaiting_owner_action`：通知用户暂停 Goal、完成精确批准与脚本应用，再提示“可以继续 Goal”；不会启动空回合累计 blocked 次数。

子线程系统 key 使用 `wf_<owner>_g<generation>_<goalkey>`，只允许小写字母、数字和下划线，不使用中括号、连字符、空格、中文或随机 UUID。用户可见标题使用 `[GA][TASK][OWNER] <owner_id>`、`[GA][TASK][RUNTIME] <runtime_actor_id>`、`[GA][TASK][SUPERVISOR] 任务监督` 或 `[GA][TASK][DAG_VIEW] DAG 视图`。

active leaf 可在产生业务变化前 fenced 扩展为 composite 子 DAG：父 task 保留外层入边/出边，内部使用 T2-1、T2-2…表达依赖并可递归扩展；Dashboard 支持折叠、展开与父状态聚合。

Review 是显式 DAG 节点，而不是每个 task 的隐形默认步骤。Planner 为每个 task 声明风险、策略、批次、阻塞范围和原因；机械验收由 runtime 执行，共享验证由 verify 节点生成以 tree/scope/command/config digest 为键的可复用 evidence。

所有结构化文件与配置只通过脚本写入。完整 `WORKER_RESULT_V5` 落盘，子线程聊天只返回 `THREAD_TASK_RECEIPT_V1`。主线程不输出 Mermaid、DAG diff 或普通 running 状态，只向用户报告已经机械接受的 task 最终结果与追踪入口。

需要实时只读进度页时，使用 `$start-dag-dashboard <plan.json绝对路径>`。后台 Python 服务读取由 runtime 原子维护的紧凑 `progress.json` 和追加式 `events.jsonl`；网页 `/api/progress-document` 提供当前快照，`/api/progress-events` 提供分页事件。只持久化并提交 `.ghost-agent-workflow/owners/**`，runtime 状态应加入 `.gitignore`。

`git-commit` 先按当前注册工具选择 `multi_agent_v1` 或直接 `spawn_agent`，只运行一个明确禁用上下文 fork、沿用当前执行模型与推理配置的只读分析子代理，再由主线程完成 Git 写入。`rtk-hook` 对未通过 `rtk` 前缀执行的 shell 命令给出重试提示。

`git-commit-direct-model-test` 是 Codex App 专用的只读运行时探测：严格串行直接测试 `spawn_agent` / `create_thread` 与 Spark / Luna 的四种组合，不读取自定义 agent 定义。

## 安装

```bash
codex plugin marketplace add Ghost233/ghost-agent-market --sparse codex-market
codex plugin add ghost-agent-workflow@ghost-agent-market
codex plugin add rtk-hook@ghost-agent-market
```

安装 `rtk-hook` 后，开启新的 Codex 线程并通过 `/hooks` 信任 `RTK Hook`。
