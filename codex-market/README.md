# Codex Marketplace

这个目录提供 Codex 可安装的 marketplace 条目：

- `ghost-agent-workflow`
- `rtk-hook`

`ghost-agent-workflow` 包含九个 skill：

- `parallel-task-planner`
- `planner-reviewer`
- `setup-sub-thread-workflow`
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

`sub-thread-coordination` 是唯一协调入口。`gpt-5.6-luna/medium` Supervisor 只通过脚本创建、等待和通知最多 8 个执行子线程；Main 负责 reserve 与结果验收。配置包含 Planner、Owner、Review、Supervisor 四组 profile；机械 gate 由脚本执行。

默认生命周期是 `standalone_thread`，不强制创建原生 Goal。只有用户已启动或明确要求 Goal 时才桥接 `codex_native`。Goal 模式遇到 Owner 变化时进入 `awaiting_owner_action`：通知用户暂停 Goal、完成精确批准与脚本应用，再提示“可以继续 Goal”；不会启动空回合累计 blocked 次数。

用户可见标题统一为 `[GA][任务][角色] <中文任务>`；新线程取得正式 threadId 后自行设置 canonical 标题。系统 key 只使用小写字母、数字和下划线，脚本 JSON 只作机器收据。

active leaf 可在产生业务变化前 fenced 扩展为 composite 子 DAG：父 task 保留外层入边/出边，内部使用 T2-1、T2-2…表达依赖并可递归扩展；Dashboard 支持折叠、展开与父状态聚合。

Review 是显式 DAG 节点，而不是每个 task 的隐形默认步骤。Planner 为每个 task 声明风险、策略、批次、阻塞范围和原因；机械验收由 runtime 执行，verify 证据由脚本登记且默认不跨 task 复用。

所有结构化文件与配置只通过脚本写入。完整 `WORKER_RESULT_V5` 落盘，子线程聊天只返回 `THREAD_TASK_RECEIPT_V1`。主线程不输出 Mermaid、DAG diff 或普通 running 状态，只向用户报告已经机械接受的 task 最终结果与追踪入口。

初始 DAG 通过机械校验后，由独立 Planner Reviewer 检查并行度和结构复杂度；Planner 最多修订一次。Plan/State 激活后，Main 调用 `$start-dag-dashboard` 的后台 Node 启动器；启动器从指定工作目录的 `.ghost-agent-workflow` 发现活动 Goal，并只报告一次 URL。网页通过文件监听和 SSE 接收 runtime 数据更新。持久化并提交 `.ghost-agent-workflow/config.json` 与 `.ghost-agent-workflow/owners/**`，runtime 状态应加入 `.gitignore`。

`git-commit` 固定使用 `gpt-5.6-sol/high` 的只读子代理分析当前变更，并禁止 fork 主线程上下文，再由主线程复核并完成 Git 写入；不依赖 Goal、Owner、DAG 或子线程工作流。`rtk-hook` 对未通过 `rtk` 前缀执行的 shell 命令给出重试提示。

`git-commit-direct-model-test` 是 Codex App 专用的只读运行时探测：严格串行直接测试 `spawn_agent` / `create_thread` 与 Spark / Luna 的四种组合，不读取自定义 agent 定义。

## 安装

```bash
codex plugin marketplace add Ghost233/ghost-agent-market --sparse codex-market
codex plugin add ghost-agent-workflow@ghost-agent-market
codex plugin add rtk-hook@ghost-agent-market
```

安装 `rtk-hook` 后，开启新的 Codex 线程并通过 `/hooks` 信任 `RTK Hook`。
