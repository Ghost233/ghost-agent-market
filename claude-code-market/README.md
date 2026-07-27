# Claude Code Market

这个目录提供 Claude Code 可安装插件，包含四个 skill：

- `parallel-task-planner`
- `subagent-coordination`
- `subagent-goal-worker`
- `git-commit`

Claude Code 没有 Codex 原生 `/goal`、`get_goal` 或 `update_goal` 生命周期，因此明确使用 `lifecycle.controller: local_fallback`。默认本地实例由 source 绝对路径+digest 的 SHA-256 短摘要定位；相同输入默认恢复同一实例，若要重复或并行执行完全相同的 source，必须显式提供稳定的新 instance key，且不得覆盖已有目录。首次运行使用平台的显式 skill 调用：

```text
/ghost-agent-workflow:subagent-coordination 执行 `./plan.md`
```

若一轮尚未完成，skill 原样返回 runtime 生成的一行短续跑提示：

```text
/ghost-agent-workflow:subagent-coordination 继续 `<goal.json绝对路径>`。
```

短提示必须逐字使用 runtime 输出，不携带计划、DAG、Owner Capsule 或 worker prompt；下一轮从 `.ghost-agent-workflow/` 恢复全部持久状态。首次运行会冻结工作区 baseline、生成 `SOURCE_BLOCKS_V1`，并以 source refs × implementation/verification effects 追踪 coverage；独立 source audit 与真实工作区 diff audit 都产生带 digest 的 runtime artifact。

`status`/`reconcile` 会为每个 active reservation 重建完整 canonical binding，spawn/bind/send 崩溃或上下文压缩后都不依赖聊天记忆。source drift 会先停止新 reserve 并 drain active reservation，之后由 runtime 事务原子刷新 source revision、blocks、coverage/state 与 Capsule 绑定；invalidated task 的当前 Capsule 证据不可沿用。当前 DAG 耗尽但 required effect coverage 未达到 100% 时进入 `needs_delta`，required gate 或执行结果有问题时进入 `repair`。

`subagent-coordination` 使用 `DAG_PLAN_V5`：首次显示完整 DAG，后续 delta 默认只显示 DAG diff。Owner 是跨 Goal 永久模块并受仓库级 lease 互斥；三个机械 runtime actor 不属于 owners。runtime 自动归因 changes、按 workspace sequence 失效旧证据，并生成 Owner attestations 驱动的 delivery manifest。

Claude Code Owner 的 `runtime_profile` 为 `null`，执行单元使用平台默认配置；skill 不向 Agent 传模型或思考强度。只持久化并提交 `.ghost-agent-workflow/owners/**`；`.ghost-agent-workflow/runtime/**` 是临时执行状态，应加入 `.gitignore`。Owner 新增或分裂必须经脚本冲突验证和用户对精确 digest 的明确批准。

## 安装

在 Claude Code 里添加远程 marketplace：

```text
/plugin marketplace add Ghost233/ghost-agent-market --sparse claude-code-market
```

安装插件：

```text
/plugin install ghost-agent-workflow@ghost-agent-market
```
