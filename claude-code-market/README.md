# Claude Code Market

这个目录提供 Claude Code 可安装插件，包含八个 skill：

- `parallel-task-planner`
- `planner-reviewer`
- `setup-sub-thread-workflow`
- `sub-thread-coordination`
- `sub-thread-goal-worker`
- `sub-thread-task-supervisor`
- `start-dag-dashboard`
- `git-commit`

Claude Code 没有 Codex 原生 `/goal` 生命周期，工作流固定使用 `standalone_thread`。首次运行使用平台的显式 skill 调用：

```text
/ghost-agent-workflow:sub-thread-coordination 执行 `./plan.md`
```

只有宿主提供可创建、发送和等待的长期子线程 API 时才能执行。标准 Agent 不具备用户长期持有上下文与完成约束，禁止作为回退；缺少子线程 API 时在规划后 fail closed。

若一轮尚未完成，skill 原样返回 runtime 生成的一行短续跑提示：

```text
/ghost-agent-workflow:sub-thread-coordination 继续 `<goal.json绝对路径>`。
```

短提示必须逐字使用 runtime 输出，不携带计划、DAG、Owner Capsule 或 worker prompt；下一轮从 `.ghost-agent-workflow/` 恢复全部持久状态。`gpt-5.6-luna/medium` Supervisor 只通过脚本创建、等待和通知最多 8 个执行子线程；配置包含四组 profile，机械 gate 由脚本执行。

用户可见标题统一为 `[GA][任务][角色] <中文任务>`；新线程取得正式 threadId 后自行设置 canonical 标题。脚本 JSON 只作机器收据，主线程完成机械验收后才报告 task 最终结果。

`sub-thread-coordination` 是唯一协调入口。Planner 把 Review 设计为显式 DAG 节点，为每个 task 声明风险、策略、批次和阻塞范围；机械验收由 runtime 执行，verify 证据由脚本登记且默认不跨 task 复用。

active leaf 可在产生业务变化前 fenced 扩展为 composite 子 DAG：父 task 保留外层依赖边界，T2-1、T2-2…在内部形成可递归 DAG；dashboard 可折叠/展开并聚合父节点状态。

初始 DAG 通过机械校验后，由独立 Planner Reviewer 检查并行度和结构复杂度；Planner 最多修订一次。Plan/State 激活后，Main 通过 `/ghost-agent-workflow:start-dag-dashboard` 调用后台 Node 启动器；启动器从工作目录的 `.ghost-agent-workflow` 发现活动 Goal，并只报告一次 URL。`progress.json` 与 `events.jsonl` 由 runtime 脚本维护，页面通过文件监听和 SSE 推送更新，默认只监听 `127.0.0.1:7357`。

所有结构化文件和配置都通过脚本写入；完整 `WORKER_RESULT_V5` 只落盘，聊天只返回紧凑 receipt。runtime 使用轻量 workspace fence，不复制所有受管理文件。只持久化并提交 `.ghost-agent-workflow/owners/**`；runtime 状态应加入 `.gitignore`。Owner 新增、分裂或 scope 变化必须经脚本冲突验证和用户对精确 digest 的明确批准。

## 安装

在 Claude Code 里添加远程 marketplace：

```text
/plugin marketplace add Ghost233/ghost-agent-market --sparse claude-code-market
```

安装插件：

```text
/plugin install ghost-agent-workflow@ghost-agent-market
```
