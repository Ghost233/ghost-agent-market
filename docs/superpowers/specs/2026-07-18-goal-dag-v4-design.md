# Goal DAG v4 设计

日期：2026-07-18

## 目标与不变量

Goal DAG v4 把一份可版本化的计划文档编译为持久 coverage 和 Owner/task DAG，在执行中持续补齐计划覆盖、保存证据并恢复失败工作。

架构必须保持以下不变量：

- Codex 原生 `/goal` 是持久外循环，本地 coverage、DAG、Owner、Capsule 和 result 是内循环。
- Codex 每个原生 Goal 轮次都显式使用 `$goal-dag-runner`；插件不依赖隐式 skill 触发。
- 插件不调用 `create_goal`，不缩写、替换或覆盖原生 objective，也不把本地短提示写回 objective。
- Codex 不需要用户复制 continuation prompt。只有本地终态成立后，插件才调用一次语义上的 `update_goal(status: complete)`。
- Codex 本地 `goal_id`/目录必须包含 `threadId + createdAt` 的稳定 SHA-256 短摘要；objective 相同但 native instance 不同的 Goal 永不共用目录。
- Claude Code 没有 Codex 原生 Goal 生命周期，必须明确使用 `local_fallback` 和平台正确的显式 skill 调用。
- Agent 复用只是 Owner 软亲和优化。正确性只依赖磁盘上的 coverage、DAG state、Owner Capsule、checkpoint 和 attempt-scoped result。
- 当前 source revision、执行 attempt、reservation token 和 Owner generation 必须同时通过 fencing，结果才能改变当前状态。
- `goal-validate` 必须在任何业务 task 前冻结工作区 baseline，并把 source 转换为 digest 绑定的 `SOURCE_BLOCKS_V1`。
- coverage 按 `(plan_item_id, required_effect)` 计算；独立 source coverage audit 和真实工作区 diff audit 都必须由 runtime 生成并绑定 artifact digest。

## 两层循环

### Codex：原生持久外循环

Codex 推荐入口必须是一行：

```text
/goal 每轮使用 $goal-dag-runner，以子代理 DAG 完整执行 `./plan.md`，直到计划项覆盖率 100% 且所有验收通过。
```

`/goal` 由 Codex 自身创建并持久化 objective。objective 中的“每轮使用 `$goal-dag-runner`”确保每个外循环轮次都显式载入 skill；不是由插件解析或模拟 `/goal`。

每轮顺序为：

1. 用 `get_goal` 只读取得原生 Goal。以 `SHA-256(UTF-8(threadId + "\n" + String(createdAt)))` 的至少前 12 位小写 hex 定位本地目录，再精确校验完整 `threadId + createdAt` instance、同一 objective 和 objective digest；不能只按可能重复的 objective 或短摘要复用旧本地 Goal。
2. 从 `.ghost-agent-workflow/` 恢复本地 Goal、coverage、plan、run state 和 Capsule。
3. 运行 `status`，再运行 `reconcile`；处理仍存活或需要安全回收的 reservation。
4. 继续 reserve、bind、checkpoint、finish 和必要的局部 delta，直到本轮容量耗尽或本地终态成立。
5. 未完成时直接结束本轮，让 Codex 原生 Goal 安排下一轮；不向用户生成或索要 continuation prompt。
6. 本地 `finalize` 进入 native completion bridge 后，才调用 `update_goal(status: complete)`，随后用 completion token 确认桥接。

`update_goal` 只用于最终的 `complete` 状态。它不得用来改 objective，也不得把普通 task 失败映射为原生 Goal 的 `blocked`。

### Claude Code：本地 fallback

Claude Code 的 Goal Contract 使用：

```json
{
  "lifecycle": {
    "controller": "local_fallback"
  }
}
```

首次入口使用 Claude Code 的 namespaced skill 调用：

```text
/ghost-agent-workflow:goal-dag-runner 执行 `./plan.md`，以子代理 DAG 完整执行，直到计划项覆盖率 100% 且所有验收通过。
```

一轮未完成时只返回：

```text
/ghost-agent-workflow:goal-dag-runner 继续 `<goal.json绝对路径>`。
```

短提示只负责重新定位本地 Goal；计划、coverage、DAG、Capsule、gate 和 worker prompt 均从磁盘恢复。Claude Code 不调用 `get_goal` 或 `update_goal`，`finalize` 验收成功后直接把本地 Goal 标记为 `completed`。

Claude local fallback 的默认目录 suffix 是 `SHA-256(UTF-8(source absolute path + "\n" + source digest))` 的至少前 12 位。相同 path+digest 默认恢复同一实例；若要重复或并行执行完全相同的 source，首次调用必须显式提供稳定 instance key，并把它追加到 digest seed。两种平台都禁止覆盖已存在但 identity 不同的目录；短前缀碰撞时延长同一 digest 前缀。

## 持久状态

每个 Goal 使用独立目录：

```text
.ghost-agent-workflow/goals/<goal_id>/
├── goal.json
├── goal-state.json
├── worktree-baseline.json
├── source-blocks.json
├── coverage.json
├── plan.json
├── state.json
├── artifacts/
├── results/
│   └── <task_id>/
│       └── attempt-<n>-<reservation_token>.json
└── owners/<owner_id>/
    ├── capsule.json
    └── checkpoints/
```

`<goal_id>` 可包含可读 slug，但 slug 不参与正确性。Codex 必须含 native instance digest suffix；Claude 必须含默认 local instance 或显式 instance-key digest suffix。恢复时目录名只负责缩小候选范围，最终都以契约中的完整 identity/source 绑定为准。

这些文件的职责为：

| 文件 | 职责 |
| --- | --- |
| `goal.json` | `GOAL_CONTRACT_V1`；保存 source path、digest、revision，`lifecycle.controller`、Codex 原生 Goal instance identity、constraints、执行策略和验收 gate。 |
| `goal-state.json` | 本地 Goal 的 `active \| completed` 生命周期、completion token 与 `native_sync` bridge 状态。 |
| `worktree-baseline.json` | `WORKTREE_BASELINE_V1`；在首次业务修改前保存 workspace HEAD，以及排除 runtime 目录后的 tracked/untracked/dirty 工作树内容与 Git index `mode/object_id/stage` snapshot。 |
| `source-blocks.json` | `SOURCE_BLOCKS_V1`；保存当前 source revision 每个非空行的稳定 block id、行号与 text digest。 |
| `coverage.json` | `PLAN_COVERAGE_V1`；保存 source/plan 版本、source refs 和 required effect 清单。 |
| `plan.json` | `DAG_PLAN_V4`；保存 `coverage_path`、`source_revision`、Owner/task 拓扑和 gate 映射。 |
| `state.json` | `DAG_RUN_STATE_V4`；保存 task attempt、reservation、Owner generation、绑定和已接受 result_ref。 |
| `capsule.json` / checkpoint | 保存 Owner 决策、不变量、进度、风险和可恢复检查点。 |
| audit artifact | runtime 生成的 `SOURCE_COVERAGE_AUDIT_V1` / `DIFF_SCOPE_AUDIT_V1` 及 accepted copy；由 SHA-256 绑定。 |
| attempt result | 每次执行尝试的不可覆盖结果与证据；evidence 同时保存 artifact ref/digest，旧 attempt 保留为审计历史。 |

`.ghost-agent-workflow/` 是本地 runtime state，不应提交到版本库；仓库和使用插件的项目都应将它加入 `.gitignore`。

涉及 plan、coverage、state、goal-state 或 Capsule 的多文件更新使用可回滚向前的事务 journal。每个命令必须在读取任一参与文件前恢复未完成事务；故障发生在任意写入位置时，重试先完成同一事务再解释 revision/digest。`finish` 的 accepted result 仍不可覆盖，但同一路径已有完全相同内容时按同一 attempt 幂等续提交 state/Capsule。

## Coverage 契约

`coverage.json` 使用 `PLAN_COVERAGE_V1`，顶层字段为：

```json
{
  "contract": "PLAN_COVERAGE_V1",
  "source_path": "/absolute/path/to/plan.md",
  "source_digest": "<sha256>",
  "source_revision": 1,
  "plan_path": "/absolute/path/to/plan.json",
  "plan_digest": "<sha256>",
  "plan_revision": 1,
  "required_plan_items": [
    {
      "id": "stable-plan-item-id",
      "description": "可独立追踪的计划项",
      "source_refs": ["L12-0123456789ab"],
      "required_effects": ["implementation", "verification"]
    }
  ]
}
```

planner 必须把每个 required plan item 绑定到当前 `SOURCE_BLOCKS_V1` 的非空 `source_refs`，并把每个 required effect 映射到一个或多个当前有效 task。`required_effects` 只允许 `implementation`、`verification`；每个 task 的 `plan_item_ids` 都必须非空，并声明一个 `coverage_effect`。work 只能是 implementation；review/verify 可是 verification 或 audit。

coverage summary 同时计算：

- `planned`：每个 `(item, required_effect)` 至少映射到一个非 superseded 的 live task。
- `completed`：每个 required effect pair 已由当前 `source_revision` 的 accepted completed result 覆盖。

对外所说的 coverage `percent` 和“计划项覆盖率 100%”指 required effect pairs 的 `planned`。它是计划到 DAG 的结构完整性门禁，不代替执行完成门禁：`finalize` 还要求 `completed` 也达到 100%、当前有效 task 全部 resolved、required gate 证据通过且其它 completion invariant 成立。`audit` task 完成固定 gate，但不伪装成 implementation/verification coverage。

固定 `source-coverage-audit` 必须由独立 verify/audit task 在任何 work 前完成。它逐项分类所有 source block：有 `source_refs` 的 block 必须精确映射到 plan item ids；无映射的 block 必须标记 `non_requirement` 并给非空理由。runtime 将 proposal 与真实 source blocks、coverage digest 和 required effects 对比后生成 `SOURCE_COVERAGE_AUDIT_V1`。

coverage 同时绑定 source 与生成 plan 的 path、digest、revision。任何一侧发生变化，都必须先刷新并重新校验，不能继续使用旧 coverage 冒充当前计划。

## 每轮恢复、reconcile 与调度

每轮恢复必须先执行：

```text
status → reconcile → reserve
```

`reconcile <plan> <state>` 列出当前 active reservation。协调器根据实际 Agent 状态逐个决定：

- 执行单元仍健康且任务仍运行：保留 reservation。
- 执行单元已丢失、任务不可恢复或绑定已失效：使用原 task id、reservation token 和原因调用 `reclaim`。

`status` 与 `reconcile` 的每个 `active_reservations[]` 都必须在 runtime 锁内重建并返回完整 canonical `TASK_BINDING_V4`，同时带确定的 `action`/`phase`：未 bind 的 reservation 为 `spawn_executor|reuse_executor` + `reserved_unbound`，已 bind 的 running reservation 为 `wait_or_redeliver` + `running_bound`。因此 reserve→spawn/bind、reuse bind→send 或上下文压缩后，协调器只使用 reserve 或 recovery response 返回的 binding 继续同一 attempt；禁止依赖聊天记忆或自行重算 token、权限、result/artifact 路径。
- 状态不确定：不猜测完成，也不盲目创建重复 worker；保留或进一步检查。

`reclaim <plan> <state> <task> <token> <reason>` 是 token-fenced 且幂等的安全回收。旧 token 不能回收新 reservation；重复提交同一回收不会递增两次 attempt 或破坏已接受结果。回收会解除物理 executor 绑定，并把 Capsule 的 active task/checkpoint ref 清空；历史 checkpoint 保留审计但不会下发给新 attempt。下一 attempt 可以在同一逻辑 Owner/generation 上直接绑定替代 Agent，只有污染、重复失败或语义隔离需要时才额外 rotate Owner。

完成 reconcile 后，runtime 才按依赖、关键路径、并发容量、资源锁、写域冲突和 Owner 状态 reserve ready task。协调器 bind 新建或复用的执行单元；不存在把会话存活误当作 task 完成的路径。

每个 `spawn_executor` action 与 `TASK_BINDING_V4` 同时携带 runtime 生成的 `executor_spawn_name`。协调器必须原样用作 canonical spawn identity，不能自行截断或拼接 Goal/Owner/profile。binding 还包含 worktree baseline ref/digest、source blocks ref/digest、唯一 `coverage.{ref,digest,semantic_digest}`、`coverage_effect` 和两个固定 audit 的 artifact path/contract map。semantic digest 只覆盖 source identity/revision 与 required items，使普通 repair delta 改 plan binding 时不会错误废弃仍有效的 source audit。

## Attempt-scoped result 与 fencing

每次成功 reserve 都确定一个新的 attempt 和 reservation token。binding 同时携带：

- `task_id`
- `owner_id` 与 `owner_generation`
- `attempt`
- `reservation_token`
- `source_revision`
- runtime `executor_spawn_name`
- worktree baseline / source blocks ref 与 digest、`coverage.{ref,digest,semantic_digest}`
- `plan_item_ids` 与 `coverage_effect`
- audit `evidence_artifact_paths` / `evidence_artifact_contracts`
- 唯一 result 路径 `results/<task_id>/attempt-<n>-<token>.json`

worker 只能写当前 binding 指定的 result 文件，不得覆盖该 task 的先前 attempt。runtime 接受 finish/result 前必须同时核对 task、attempt、token、Owner generation 和 source revision。

因此，超时 worker 的迟到结果、Agent 轮换前的结果、已 reclaim attempt 的结果和旧 source revision 的结果都只能作为历史证据保留，不能写入当前 `result_ref`、coverage、gate 或完成状态。

## Source revision fencing

`goal.source.revision` 是 source digest 的单调版本。`plan.plan_source.revision`、coverage 的 `source_revision`、每个 binding 和 worker result 都必须与当前 revision 一致。

source digest 变化时：

1. `status/reconcile` 返回 `source_drift_drain` 时停止 reserve；健康 executor 完成并 finish，丢失 executor 先 reclaim，再停止 runtime 返回的 stale physical executor 并 `confirm-stale-executor`。
2. active reservation 与 stale executor 都清零后，`goal-refresh` 以一个事务原子更新 goal/source revision、`SOURCE_BLOCKS_V1`、plan/coverage 绑定、state 和全部 Capsule 的 goal/source digest，并置 `goal_refresh_pending`。
3. planner 生成 `DAG_DELTA_V1`，而不是无历史地全量覆盖 plan。
4. delta 的 `source_dispositions` 必须对上一 revision 的每个 live task明确选择 `carry_forward` 或 `invalidate`；旧 `source-coverage-audit` 与 `diff-scope-audit` 都必须 invalidate 并 replacement。
5. `carry_forward` 只复用仍被新 source 支持的工作和证据；`invalidate` 要求 replacement，并由 `apply-delta` 从 Capsule 当前视图删除该 task 的 completed/result/evidence refs 和 active checkpoint。历史 attempt/artifact 文件保留审计。
6. delta 的 `coverage_update.required_plan_items` 写入新 revision 的完整 source refs 与 required effects，再重新计算 coverage。source 删除 requirement 时，旧 plan item 只允许留在 superseded 历史 task 中；任何 live task 继续引用已删除 item 都必须拒绝。

没有明确 disposition 的旧 task 不能隐式沿用。refresh 前必须完成 drain，因此不存在允许跨 refresh 继续运行的 task；任何旧 executor 的迟到结果仍被 revision/attempt/token fence 拒绝。

## `needs_delta`

active Goal 在 `goal_refresh_pending` 时直接返回 `needs_delta`。除此之外，当 DAG 已耗尽、没有可 reserve task，而 required effect pair 的 `planned` coverage 仍低于 100% 时，runtime 也必须返回 `needs_delta`，不能返回完成或空闲。典型原因包括 required effect 从未映射到 live task，或 source refresh invalidated 旧 task 后尚未加入 replacement。

planner 只追加必要的 replacement 或补漏 task，并随 delta 提交 coverage update 与 source dispositions。failed、blocked、`needs_repair` 和缺 gate 证据仍按各自修订或验证路径处理，不能仅因为 `planned` 已达 100% 就误报完成。无关的 completed/running task 和 Owner Capsule 保持有效；delta 不能静默重写正在执行的整个 DAG。

`status` 的 next action 按以下优先级决策：

1. 本地 completed 且 native sync pending：`native_completion_pending`。
2. 本地 completed 且无需或已经完成 native sync：`completed`。
3. source path 缺失：`user_blocked`；只允许恢复同一路径并重试，不能 refresh 到猜测路径。
4. active 且 `goal_refresh_pending`：`needs_delta`。
5. 存在 reserved、running 或 pending task：`execute`。
6. 存在 blocked、failed、`needs_repair`、blocking finding、gate 或 diff 问题：`repair`。
7. DAG exhausted 且 required effect pairs 的 `planned < 100%`：`needs_delta`。
8. 全部 completion invariant 已满足：`finalize`。

## Owner、Capsule 与 Agent 软亲和

`owner_id` 是 Goal 内稳定的逻辑责任域；`executor_id` 是可替换载体。runtime 会优先把同一 Owner 的后续 task 交给健康、idle 且 profile 匹配的 Agent，这只是降低上下文重建成本的软亲和。

Agent 单纯丢失时对 running reservation 先 reclaim，再停止 runtime 登记的 stale physical Agent 并 `confirm-stale-executor`，之后在同一逻辑 Owner/generation 上以新 `executor_spawn_name` 换 Agent。`reserved_unbound + spawn_executor` 无匹配执行单元时用 abandon 回滚；`reserved_unbound + reuse_executor` 的既有 bound 目标确认丢失是窄例外，必须 reclaim 以清除死 binding、登记 stale ledger，再 stop→confirm，generation 保持不变。污染、重复失败或上下文压力过高且需要隔离旧 Capsule 语义时，才在 reclaim 后递增 Owner generation。新 Agent 从已清理的 Capsule、有效 checkpoint、直接 dependency result_ref 和当前 binding 恢复。

因此 Agent 会话记忆是性能缓存，不是真相源。不同 Goal 不复用执行单元；独立 review 使用不同 Owner，避免实施上下文自我确认。

## 终态与 native completion bridge

`finalize` 只有同时满足以下条件才可通过：

- 当前 source 文件仍与冻结的 source digest/revision 一致；`finalize` fresh 读取并拒绝未刷新的 drift。
- required effect pairs 的 `planned` 与 `completed` coverage 都为 100%。
- 所有当前有效 task 已完成，或被成功 replacement 的节点已明确 superseded。
- 所有 required gate 都有当前 revision、已接受 attempt 的 passed evidence。
- blocking finding 为零、没有 active reservation。
- 固定 `source-coverage-audit` 由独立 verify/audit task 通过，artifact 覆盖全部 source blocks 且 omissions 为空。
- 固定 `diff-scope-audit` 由独立 review/verify audit task 调用 runtime `diff-audit`：比较初始 baseline 与当前真实工作区和 Git index，核对每个 observed file 都由 accepted work result 声明且落在 task/Owner 写域，同时禁止 Goal 期间更改 Git HEAD。即使 porcelain XY 与工作树字节未变，index blob/mode/stage 的变化也必须被识别；不能只信实施 worker 自报。
- 两个 audit evidence 都必须精确引用 binding 指定的 artifact path，并带匹配的 SHA-256 digest；finish 固化 accepted artifact/result 后才成为完成证据。

当前 DAG 耗尽且 required effect pairs 的 `planned < 100%` 时必须进入 `needs_delta`；failed、blocked、`needs_repair`、gate/audit 问题或仅有旧 revision 证据进入 `repair`，都不是终态。

Codex `codex_native` 的 `native_sync` 在 active 阶段为 `not_started`，完成桥接分两阶段：

1. `finalize` 原子把 `goal-state.status` 写为硬终态 `completed`，同时写入稳定 `completion_token` 和 `native_sync.status: pending`。返回值中的 `native_action` 为 `{ "action": "update_goal", "status": "complete", "completion_token": "...", "objective_digest": "..." }`。此后本地 DAG 不得重跑。
2. skill 在 `finalize` 后 fresh 读取同一原生 Goal instance 并重验 `threadId + createdAt + objective digest`：仍为 active 时调用 `update_goal(status: complete)`，不得附带新 objective；已经 complete 时视为上次原生更新成功。update 返回成功后再次 fresh 读取并确认同一 instance 已 complete（pre-update 已 complete 时该次读取即可充当确认），随后才调用 `native-confirm <goal> <goal-state> <completion-token>`，把 `native_sync.status` 置为 `confirmed`。

因此 `status` 在本地已完成但同步待办时返回 next action `native_completion_pending`；`native_sync` 已 confirmed，或 controller 为 `local_fallback` 且同步为 `not_required` 时，才向协调器报告最终 `completed`。

completed/native pending 是冻结态恢复路径：runtime 仍严格校验 goal、plan/coverage/state、completion token、objective digest 与 native Goal identity，但不得因完成后 live source/worktree、source blocks 或 Owner Capsule 发生变化而阻塞外层 bridge。

若原生更新或本地确认中断，下一轮在首个 `get_goal` 后读取已持久化的同一 token/native action，直接恢复 bridge；不再运行 status/reconcile、重新扫描 mutable source/worktree 或重新执行 DAG。不得生成新的 completion token 掩盖未知结果。`objective_digest` 让 bridge 在最终更新前再次确认原生 objective 从未被替换。

Claude Code `local_fallback` 没有 bridge。相同 completion invariant 通过后，`finalize` 直接写入本地 `completed`。

## 平台差异

| 语义 | Codex | Claude Code |
| --- | --- | --- |
| 生命周期 controller | `codex_native` | `local_fallback` |
| 外循环 | Codex 原生 `/goal` | 用户按短提示再次显式调用 skill |
| 推荐首次入口 | `/goal 每轮使用 $goal-dag-runner，…` | `/ghost-agent-workflow:goal-dag-runner 执行 …` |
| 每轮 skill 触发 | 原生 objective 明确要求每轮显式 `$goal-dag-runner` | namespaced skill 命令显式触发 |
| 人工 continuation | 不需要 | 逐字返回 runtime `continuation_prompt` 的一行绝对 `goal.json` 路径 |
| 原生 Goal 工具 | 只读 `get_goal`；最终 `update_goal(status: complete)` | 不使用 |
| objective | 原样保留，不由插件创建或覆盖 | 由本地 `goal.json` 持久化 |
| 完成 | `finalize` → pending → update → `native-confirm` | `finalize` 直接本地 completed |

两端共享相同 coverage、DAG、Owner/Capsule、delta、attempt result 和 fencing 语义；只替换外层生命周期 controller 与显式调用方式。
