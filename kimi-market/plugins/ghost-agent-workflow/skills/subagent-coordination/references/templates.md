# Reservation 恢复契约

只在 coordinator 已运行 `status` 与 `reconcile` 后读取本文件。runtime 的 active reservation、Owner Capsule 与 attempt 唯一路径是事实；executor 会话状态只用于选择恢复动作。

## 定义

- **orphan reservation**：state 为 reserved/running，但无法证明一个健康 executor 正持有同一 goal、owner generation、task、attempt 与 reservation token，且 canonical result 尚不存在。
- **orphan executor**：已创建 executor，但 state 没有把它绑定到当前 reservation，或 reservation 已被 reclaim/替换。
- **canonical result**：binding 给出的 `results/<task_id>/attempt-<attempt>-<reservation_token>.json`。同一 task 的任何其他路径都不是该 attempt 的结果。
- **canonical spawn identity**：reserve action 与 binding 同时下发的 `executor_spawn_name`。spawn-before-bind 恢复只接受这个精确名字；协调器不得推导或改写。
- **canonical recovery binding**：`status`/`reconcile.active_reservations[]` 在 runtime 锁内从当前 plan/state 重建的完整 `TASK_BINDING_V4`。它与最初 reserve binding 等价，是崩溃恢复时唯一允许重新 bind/send 的输入。

Agent/执行单元复用只降低启动成本。不要从聊天记忆推断 task 身份、权限或完成状态；只信 Owner/Capsule、binding、state 与 canonical result。

`abandon` 只回滚 `reserved_unbound + spawn_executor`（Owner 尚无已绑定 executor）的 reservation；`reclaim` 处理 running/lost，以及 `reserved_unbound + reuse_executor` 的已绑定复用目标确认丢失这一安全例外，并把已知 executor 记入 `stale_executors: stop_pending`。两者都会清空 Capsule active task/checkpoint；旧 checkpoint 只保留历史。reclaim 后必须停止物理 executor，再 `confirm-stale-executor`，否则不得 reserve/refresh。

## 恢复矩阵

| 观测状态 | 必须动作 |
|---|---|
| `reserved_unbound` + `spawn_executor`，未发现匹配 executor，result 不存在 | 用同一 token `abandon`，再由后续 reserve 产生新 attempt；不得把聊天记忆当作已 spawn 证据。 |
| spawn-before-bind：发现唯一、健康且精确匹配 `executor_spawn_name` 的 executor，state 仍 reserved | 使用 recovery item 的同一 token 与 canonical binding 执行 `bind`；无法唯一证明身份时先停止 runtime 尚未知的 orphan executor，再 `abandon`。 |
| `reserved_unbound` + `reuse_executor`，目标健康 | 核验 recovery item 的 `executor_id` 仍是 Owner 已绑定 executor，使用同一 token `bind`，再发送该 item 的 canonical binding。 |
| `reserved_unbound` + `reuse_executor`，复用目标确认丢失 | 以同一 token `reclaim`；runtime 清除 Owner binding 并把该 executor 写入 stop-pending ledger，随后 stop → `confirm-stale-executor`。不得 abandon 后继续复用死 id，也不得 rotate generation。 |
| bind-before-send：`running_bound` + `wait_or_redeliver` 且 executor 匹配，但消息未送达 | 向同一 executor 重发 recovery item 的 canonical binding。executor 丢失时先 `reclaim`，再停止返回的 executor_id，确认停止后 `confirm-stale-executor`。 |
| result-written-before-finish：canonical result 已存在，state 仍 reserved/running | 校验 task、owner、generation、attempt、token、source revision 与 result_path 后立即 `finish`；executor 是否已结束不影响裁决。 |
| reserved/running，executor 健康且 result 尚不存在 | 继续等待；运行中、上下文压缩或暂时无输出都不是 orphan。 |
| canonical result 字段不匹配或证据不可复核 | 不调用 finish；保留原始文件供审计，reclaim 或生成 repair delta。 |
| reservation 已 reclaim/替换后旧 result 到达 | 按 attempt/token/source revision fencing 拒绝，不移动到新路径、不人工合并。 |
| task 为 failed/blocked/needs_repair | 保留 attempt result，交 planner 生成局部 delta；不影响无关 running Owner。 |
| 无 active/ready task，但 required effect pair 仍为 pending | 生成追加 `DAG_DELTA_V1`，不得 finalize。 |
| `source_status: source_changed` 且仍有 active reservation | `source_drift_drain`：停止 reserve；健康 executor finish；丢失 executor reclaim → stop → confirm。active/stale 清零后才 `goal-refresh`。 |
| audit binding 下发 artifact path/contract | worker 只在精确 `evidence_artifact_paths` 写 proposal/运行 runtime audit，并在 evidence 同时返回 `artifact_ref` 与 `artifact_digest`。 |

## 顺序不变量

1. 每次进入都运行 `status`，再 `reconcile`。
2. 完成上表的恢复动作后才运行 `reserve`。
3. 分发只使用 `reserve.actions[]` 或 `status`/`reconcile.active_reservations[]` 返回的完整 canonical binding；禁止依赖聊天记忆或自行重算。spawn 使用精确 `executor_spawn_name`，每次 bind/send 都保持 attempt、token、result_path 与 artifact paths 不变。
4. worker 先原子写 canonical result；coordinator 再 `finish`。
5. `finish` 后重新 reconcile；`reclaim` 后必须 stop + `confirm-stale-executor`，stale 列表清零后才 reserve。
6. 只有 runtime 证明 coverage 100%、所有有效 task resolved 且 gate 通过时，coordinator 才运行 finalize；Codex 随后完成 native bridge，Kimi 使用 local_fallback，确认本地 completed。

最终协调摘要可使用：

```json
{
  "contract": "GOAL_DAG_RESULT_V1",
  "status": "completed | active | needs_user_review",
  "goal_id": "<goal_id>",
  "executor_mode": "subagent",
  "plan_path": "<绝对 plan 路径>",
  "revision": 2,
  "evidence_refs": ["<attempt 唯一 result_ref>"],
  "summary": "<本地 DAG 状态>"
}
```
