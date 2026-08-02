# Worker 动作表

Worker 只接收 `<workflow-dir> + <run-id>`，先调用 `worker open`。不得读取原始 Plan、State、Registry 或构造 Binding/Result。

DAG Work 的工作目录由 `owner-sync` 固定为 Owner 专属 worktree。Worker 不执行 Git；`worker complete` 只写结果候选，`owner-finish` 合并并通过集成验证后 runtime 才更新 task 完成状态。集成失败时原 run 保持 running，由同一 Owner worktree 修复后重提。

| 意图 | 公共命令 | stdin |
|---|---|---|
| 执行 DAG 绑定验证 | `worker verify <dir> <run> <verification-id>` | 无；失败时脚本自动提交 `task_failed/repair_task` |
| 完成 | `worker complete` | 百字内摘要 |
| 真实阻塞 | `worker block` | blocker |
| 执行失败 | `worker fail` | 失败原因 |
| Quick 升级或 DAG 拆父节点 | `worker request-dag` | 已完成部分与拆解原因 |

DAG 风险升级和同 Owner scope 修复仍使用脚本固定动作：

```text
worker complete-risk <goal-dir> <run-id> <risk-code>
worker request-scope <goal-dir> <run-id> <path>...
```

Quick 不使用 scope 动作；Owner 边界变化必须停下交给用户。Quick 的 `block/fail` 不能留下未验收文件变化。

脚本从 run id 解析身份、scope、结果路径和验证项。验证命令按 argv 传入，不使用 shell 字符串；完成动作只接受脚本实际执行且通过的当前验证。stdout 只作机器收据。禁止调用低层 `bind/result-submit/finish/checkpoint`。
