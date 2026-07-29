# 生命周期契约

runtime 是唯一状态写入者。模型只调用领域命令，不手写状态、`reason` 或 `action`。

## 状态

| 对象 | 允许状态 |
|---|---|
| Workflow | `active`、`completed`、`stopped`、`cancelled` |
| Task | `pending`、`running`、`completed`、`stopped` |

`reserved` 由 `running + executor_id: null` 表达，不再是 Task 状态。`superseded` 由 `stopped + plan_invalid/revise_plan + replacement_task_id` 表达。`blocked`、`failed`、`needs_repair` 只允许作为 Worker 结果，验收后必须映射为下表中的停态。

## 停止矩阵

| reason | action | 处理方式 | 阻塞范围 |
|---|---|---|---|
| `input_missing` | `provide_input` | 补充缺失输入后由脚本恢复 | 当前 Task 或 Workflow |
| `decision_required` | `await_user` | 等待用户作出明确决定 | 受影响 Workflow 分支 |
| `task_failed` | `repair_task` | 原线程、原 run 和原 worktree 修复 | 当前 Task 及其下游 |
| `thread_failed` | `replace_thread` | 用户确认后由脚本废弃旧线程并重建 | 当前 Task |
| `plan_invalid` | `revise_plan` | Planner 通过脚本修订或替换节点 | 受影响 DAG 分支 |
| `runtime_failed` | `retry_runtime` | 修复运行环境后重试同一领域命令 | 当前脚本动作 |

这是完整有限集，不存在 `unknown`、自由文本 reason 或额外 action。`stopped` 必须同时包含表中精确配对的 `reason/action`；其他状态必须同时为 `null`。任意未知值、错配或缺字段都由 runtime 拒绝。

Worker 结果固定映射：

| Worker 结果 | Task 状态 | reason/action |
|---|---|---|
| `completed` | `completed` | `null/null` |
| `blocked` | `stopped` | `input_missing/provide_input` |
| `failed`、`needs_repair` | `stopped` | `task_failed/repair_task` |

Review 必须是显式 DAG 节点，不使用隐藏 Review 生命周期。reservation、notification、migration、reclaim、Owner phase、线程 `running/stalled`、Dashboard 事件和 `next_action` 都是执行元数据，不得扩展 Workflow/Task 状态集合。

## 脚本入口

```text
goal-dag.mjs workflow lifecycle-contract
goal-dag.mjs workflow migrate-lifecycle <goal-dir>
```

`lifecycle-contract` 输出 runtime 当前有限集，供测试和工具读取。`migrate-lifecycle` 原子把旧 `reserved/blocked/failed/needs_repair/superseded` 状态规范化；模型不得自行迁移 JSON。
