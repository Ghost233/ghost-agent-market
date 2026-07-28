# 线程恢复与收据

聊天不是事实源。恢复只读取 runtime State、`threads.json`、canonical result 和 Owner Capsule。

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

每个 thread 只保存 `thread_id`、`host_id`、`role`、`status`；每个 watch 只保存 `task_id`、`attempt`、`thread_key`、`cursor`。标题、模型配置、generation 和 receipt digest 可由 Plan/binding/宿主查询得到，不重复写入 Registry。

## 恢复动作

| 状态 | 动作 |
|---|---|
| `reserved` 且未 bind | 创建/找到登记线程，bind 后投递 canonical binding |
| `running` 且无结果 | wait；投递不确定时只重发同一 binding |
| canonical result 已存在 | 直接 `finish` |
| 三次等待无变化 | 监督线程发 `TASK_STALLED`；主线程检查 |
| 线程确认丢失 | `reclaim`，旧线程标 `lost`，再创建新 generation |
| source 变化 | drain active，`goal-refresh`，应用局部 delta |
| Owner 变化 | 暂停当前 DAG，等待用户批准并完成 transition |

任何恢复都先运行 `status -> reconcile`。不得从聊天推算 attempt、token、路径或 scope。

## 监督线程通知

只允许两种通知，均不含结果内容：

```text
[GA][TASK][SUPERVISOR] TASK_END task_id=<id> attempt=<n> thread_id=<id> state=<state>；请主线程检查。
[GA][TASK][SUPERVISOR] TASK_STALLED task_id=<id> attempt=<n> thread_id=<id>；连续三次等待无变化，请主线程检查。
```

## 收据

`result-submit` 返回 `THREAD_TASK_RECEIPT_V1`，只含：`status`、`task_id`、`attempt`、`result_ref`、`result_digest`、`blocking_count`。完整 `WORKER_RESULT_V5` 只保存在 `result_ref`。

主线程最终只报告已经 `finish` 接受的 task 结果；DAG 视图线程只报告 Dashboard URL，不向主线程复制 Mermaid 或完整 DAG。
