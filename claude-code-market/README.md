# Claude Code Market

这个目录提供 Claude Code 可安装插件，包含六个 skill：

- `parallel-task-planner`
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

短提示必须逐字使用 runtime 输出，不携带计划、DAG、Owner Capsule 或 worker prompt；下一轮从 `.ghost-agent-workflow/` 恢复全部持久状态。每个 Owner generation 使用一个可长期复用的子线程，并额外维护 `gpt-5.6-luna/low` 极简任务监督子线程和 DAG 视图子线程。监督子线程加载 `sub-thread-task-supervisor`，只等待结束并通知主线程检查。

子线程系统 key 使用 `wf_<owner>_g<generation>_<goalkey>`；只允许小写字母、数字和下划线，禁止中括号、连字符、空格、中文与随机 UUID。用户可见标题使用 `[GA][TASK][OWNER] <owner_id>`、`[GA][TASK][RUNTIME] <runtime_actor_id>`、`[GA][TASK][SUPERVISOR] 任务监督` 或 `[GA][TASK][DAG_VIEW] DAG 视图`。主线程检查通知并完成机械验收后才报告 task 最终结果。

`sub-thread-coordination` 是唯一协调入口。Planner 把 Review 设计为显式 DAG 节点，为每个 task 声明风险、策略、批次和阻塞范围；机械验收由 runtime 执行，共享验证由 verify 节点生成可复用 evidence。

active leaf 可在产生业务变化前 fenced 扩展为 composite 子 DAG：父 task 保留外层依赖边界，T2-1、T2-2…在内部形成可递归 DAG；dashboard 可折叠/展开并聚合父节点状态。

需要在浏览器持续观察时，运行 `/ghost-agent-workflow:start-dag-dashboard <plan.json绝对路径>`；它调用 Python 启动器分离后台服务并返回 URL。runtime 脚本原子维护紧凑的 `progress.json` 当前快照和追加式 `events.jsonl` 历史；`/api/progress-document` 提供当前快照，`/api/progress-events` 提供分页事件。页面默认只监听 `127.0.0.1:7357`。

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
