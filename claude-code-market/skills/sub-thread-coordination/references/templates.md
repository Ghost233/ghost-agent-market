# 线程恢复与收据

聊天不是事实源。Main 恢复时通过 runtime 命令读取 State，并把 result_ref 交给 `finish`，不得直接读取 canonical result；Supervisor 恢复时只调用 `supervisor-next`，不得直接读取任何原始文件。

## THREAD_REGISTRY_V1

Registry 只保留五项：`contract`、`goal_id`、`main`、`threads`、`watches`。模型不得创建或替换它。

```text
thread-registry init <path> <goal_id> <main_id> <main_host>
thread-registry put-thread <path> <key> <thread_id> <host> <role> <status>
thread-registry set-status <path> <key> <status>
thread-registry put-watch <path> <task_id> <attempt> <key> [cursor|-]
thread-registry remove-watch <path> <task_id> <attempt> <key>
thread-registry show <path>
```

每个 thread 只保存 `thread_id`、`host_id`、`role`、`status`；每个 watch 只保存 `task_id`、`attempt`、`thread_key`、`cursor`、`unchanged_waits`。标题、模型配置、generation 和 receipt digest 可由 Plan/binding/宿主查询得到，不重复写入 Registry。

## 恢复动作

| 状态 | 动作 |
|---|---|
| `reserved` 且未 bind | 创建/找到登记线程，bind 后投递 canonical binding |
| `reserved` 且 action 为 `run_script` | Main 直接调用 `runtime-execute`，不创建线程 |
| `running` 且无结果 | wait；投递不确定时只重发同一 binding |
| canonical result 已存在 | 直接 `finish` |
| Supervisor 上下文恢复 | 重新调用 `supervisor-next <goal-dir> --limit 8` |
| 三次 wait 无 cursor 变化 | Supervisor 通知 Main 并记录 `stalled-notified` |
| 用户确认线程丢失且 Main 已关闭线程 | `supervisor-recover <goal-dir> <task> <attempt> <reason>` |
| 用户让 attention/stalled 线程继续 | `supervisor-record <goal-dir> resumed <task> <attempt>` |
| source 变化 | drain active，`goal-refresh`，应用局部 delta |
| Owner 变化 | 暂停当前 DAG，等待用户批准并完成 transition |

任何恢复都先运行 `status -> reconcile`。不得从聊天推算 attempt、token、路径或 scope。

## 收据

`result-submit` 返回 `THREAD_TASK_RECEIPT_V1`，只含：`status`、`task_id`、`attempt`、`result_ref`、`result_digest`、`blocking_count`。完整 `WORKER_RESULT_V5` 只保存在 `result_ref`；Binding 同样由脚本保存到 `bindings/`。

所有脚本 JSON 都是机器收据，不复制到聊天。Main 最终只使用 `finish.user_message` 报告已接受的 task 结果；Dashboard URL 只报告一次，不复制 Mermaid 或完整 DAG。
