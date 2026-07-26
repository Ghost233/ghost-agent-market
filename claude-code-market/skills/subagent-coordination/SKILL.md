---
name: subagent-coordination
description: 仅当用户显式运行 /ghost-agent-workflow:subagent-coordination，并要求从计划文档启动、继续、查看或修订 subagent-only 本地 Goal DAG 时使用；作为唯一公开控制器，创建或恢复 GOAL_CONTRACT_V1，调用 parallel-task-planner 生成 coverage、plan 或 delta，调度 subagent-goal-worker，并持续执行到本地硬终态。普通任务、普通讨论、文档审阅、仅写 $subagent-coordination 或未使用插件 skill 调用的请求不得触发。
disable-model-invocation: true
---

# Claude Code 本地子代理 DAG 控制器

## 公开入口与平台边界

Claude Code 没有 Codex 原生 Goal 外循环，因此明确使用 `lifecycle.controller: local_fallback`。公开 DAG 入口只有：

```text
/ghost-agent-workflow:subagent-coordination 执行 <开发文档路径>
```

`$subagent-coordination` 不是 Claude Code 插件 skill 的显式调用语法，不能据此启动。执行方式固定为 `subagent`。用户明确只规划时返回 coverage 与 DAG；否则持续推进执行。

本控制器只写 Goal/DAG 协调元数据并调度执行单元，**绝不直接修改业务文件**（`src/`、`test/`、`scripts/` 等实现产物），不暂存、提交或推送代码。所有正式实施、审查和验证都必须是 DAG task，由 worker 子代理完成。worker spawn 失败（含 503 通道错误、Agent 异常退出）时，按 `needs_repair` 停下并在 scope_request 注明通道/模型问题，等用户修复后用续跑命令恢复——**禁止主线程兜底自己 Edit/Write 业务文件**；主线程对 `.ghost-agent-workflow/` 下协调元数据（goal/plan/state/capsule/registry/results/owners）的**读与写一律经 goal-dag 命令**（`status`/`reserve`/`apply-delta`/`finish`/`owner-list` 等），**严禁直接 Read/Edit/Write 这些 json 文件**（见「守住主线程 context」映射表）。

Claude Code 子代理按任务难度选 **model alias**（`opus`/`sonnet`/`haiku`）spawn，**禁止填 `claude-*` 完整 model id**（如 `claude-opus-4-8`），也不指定 thinking/reasoning/effort。alias 经 `ANTHROPIC_DEFAULT_OPUS/SONNET/HAIKU_MODEL` 映射到本地实际模型；完整 id 绕过该映射直送上游通道，会因通道不可用（503 / `No available channel`）失败。难度选档：架构、跨模块审查、安全、迁移 → `opus`；常规实现、verify → `sonnet`；只读检索、grep、状态查询 → `haiku`。**自检**：spawn 后若 Agent 返回 503 / 通道错误，立即回看刚发出的 Agent 工具 input 是否误填了 `claude-*` 完整 id——若是，改回对应难度 alias 重发同一 binding，不换路径、不放弃 task、不自行兜底执行。Codex 固定 `gpt-5.6-sol/medium`，这是有意的平台差异。

## 守住主线程 context（防雪球）

主线程（controller）只持有协调元数据，业务源码与产物一律在 worker 子代理 context 内处理。主 context 不随业务膨胀，单 session token 有界。

**核心纪律：controller 的信息一律从 goal-dag 命令取，不从 Read 文件取。** 任何查看/改动协调元数据的冲动，先按下表用对应命令；表中没有的需求委派 worker 子代理，绝不自己 Read/Edit 文件。

| controller 需求 | 用这个命令（禁 Read 文件） |
|---|---|
| goal/plan 进度、task 状态计数、coverage%、next_action、owners generation/status | `goal-dag status <plan> <state>` |
| 下一动作、active reservations（轻量） | `goal-dag reconcile <plan> <state>` |
| owner 全表 / 覆盖域 / lifecycle | `goal-dag owner-list` / `owner-query` |
| 拿 task binding spawn worker | `goal-dag reserve`（输出完整 TASK_BINDING_V4 + task_id/owner_generation/executor_spawn_name/reservation_token） |
| 改 plan（失败/范围变/coverage pending） | `goal-dag apply-delta`（**禁 Edit plan.json**） |
| 收口裁决 | `goal-dag finish` |
| registry 写（add/split） | `owner-add`/`owner-split`（`--plan` + AskUserQuestion 确认） |

明确禁止：

- **Read/Edit/Write 协调元数据 json**：`plan.json`/`state.json`/`capsule.json`/`registry.json`/`source-blocks.json`/`coverage.json`/`goal.json`/`goal-state.json` 一律经上表命令，不直接动文件（glm 易把「可写协调元数据」误解为 Edit plan.json —— 禁止）。
- **Read/Edit 业务源码**（`src/`、`test/`、`scripts/` 等实现产物）：需核对业务时经 `Explore` 子代理或 `grep` 取摘要回传，不把源码拉进主 context；改动只能由 worker 经 DAG task 完成。
- **worker 结果只取结论**：收 worker 结果只读 result/summary/evidence 与 artifact ref，不要求 worker 回吐源码片段。

## worker 失败退避与续跑

worker spawn 失败（503 / `No available channel` / Agent 异常退出）时按退避重试，给通道恢复时间——不立即放弃，也不无限硬重试：

1. 首次失败：等 **10 秒**后用同一 binding + 正确难度 alias 重发（先按「公开入口与平台边界」自查 Agent input 是否误填 `claude-*` 完整 id）。
2. 再失败：等 **30 秒**重发。
3. 第三次失败：等 **60 秒**重发。
4. 三档退避走完（10+30+60s）仍失败：置 `needs_repair` 停下，scope_request 注明通道/模型问题，逐字返回 continuation_prompt 交用户用新 session 续跑——**禁止主线程兜底自己干业务**（见「守住主线程 context」）。

同一业务文件被反复改 **>3 次**仍不收敛，说明方案而非执行有问题：停下该闭包，回 `parallel-task-planner` 重判（出 `DAG_DELTA_V1` 拆分或换方案），不在主线程或单 worker 硬磨。

本控制器与 worker 的契约、模板（GOAL_CONTRACT_V1、Reservation 恢复矩阵、TASK_BINDING_V4 等）见本 SKILL.md 末尾「## 契约与模板」节（已内联，不再 Read references）。需要初始计划或局部修订时调用内部 `parallel-task-planner`，不得自行拼造 coverage、plan 或 delta。

## 本地 Goal 定位

为每个 Goal 创建：

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
├── results/<task_id>/attempt-<attempt>-<reservation_token>.json
└── owners/<owner_id>/{capsule.json,checkpoints/}
```

Claude Code 没有 native instance。默认 instance digest 为 `SHA-256(UTF-8(source 绝对路径 + "\n" + source digest))`，`goal_id` 和目录名必须包含至少前 12 位小写 hex。相同 path+digest 默认恢复同一本地 Goal；objective、mode、约束或副作用策略不同则停止，不能静默改写。重复执行相同 source 时，用户必须显式提供稳定 instance key，将它追加到 digest seed。任何首次调用都不得覆盖已有目录，短前缀碰撞时只延长同一 digest。

## 首次启动与规划

1. 从插件调用参数解析唯一计划文档路径，转为绝对路径，读取内容并计算 digest；缺失或歧义时停止。
2. 合并仓库强制策略、计划验收和用户追加要求。固定加入 required gate `source-coverage-audit` 与 `diff-scope-audit`；用户只能增加 gate 或授权副作用，不能移除强制项。
3. 按 reference 写入 `GOAL_CONTRACT_V1`：`execution_platform: claude_code`、`lifecycle.controller: local_fallback`、`native_goal: null`、`execution.mode: subagent`、绝对 workspace/source、scope、constraints、non-goals、side-effect policy 与 verification gates。
4. 运行 `goal-validate`。它必须先捕获 `WORKTREE_BASELINE_V1` 和 `SOURCE_BLOCKS_V1`，再写 goal state；baseline 之前不得分发业务 task。
5. 调用 `parallel-task-planner` 亲自读取 source 与 runtime source blocks，先生成 `PLAN_COVERAGE_V1`，再生成 `DAG_PLAN_V4`；运行 `validate` 和 `render`。不得把整篇 source 复制进 Goal Contract。
6. 用户明确只规划时返回 coverage 与 DAG；否则进入执行循环。

```text
node <plugin-root>/scripts/goal-dag.mjs goal-validate <goal.json>
node <plugin-root>/scripts/goal-dag.mjs validate <plan.json>
node <plugin-root>/scripts/goal-dag.mjs render <plan.json>
```

## 每次恢复、source refresh 与局部修订

续跑只接受调用参数中的绝对 `goal.json` 路径；读取后精确校验 `goal_id`、source path 与持久化 digest。严格按以下顺序恢复：

```text
node <plugin-root>/scripts/goal-dag.mjs goal-validate <goal.json>
node <plugin-root>/scripts/goal-dag.mjs status <plan_path> <state_path>
node <plugin-root>/scripts/goal-dag.mjs reconcile <plan_path> <state_path>
```

先按 reference 恢复每个 active reservation，再 reserve。`source_status: source_missing` 或 `next_action: user_blocked` 时保留状态并要求恢复同一绝对 source path；不得猜测新 source、改 path、调用 `goal-refresh` 或误报完成。

source digest 变化时停止新 reserve，只 drain 现有 reservation：健康 Agent 继续到 canonical result 并 finish；丢失 Agent 先 reclaim，再停止返回的物理 Agent，确认停止后运行 `confirm-stale-executor`。active reservation 与 stale executor 都清零后，由本 coordinator 运行 `goal-refresh`，再调用 planner 生成 `DAG_DELTA_V1` 并运行 `apply-delta`。旧 revision 的每个 live task 必须显式 `carry_forward` 或 `invalidate`；两个固定 audit task 都必须 invalidate 并替换。

failed、blocked、needs_repair 或 DAG exhausted 但 required effect coverage 未达 100% 时，只让 planner 修订受影响闭包。无关 Owner 继续，不能全量替换 active plan。只有父 objective 改变、未授权外部副作用、破坏性权限或无法安全消歧时请求用户决定。

```text
node <plugin-root>/scripts/goal-dag.mjs goal-refresh <goal.json> <goal-state.json> <plan.json> <state.json>
node <plugin-root>/scripts/goal-dag.mjs apply-delta <plan.json> <state.json> <delta.json>
```

## 用户可见的 DAG 与状态

用户可见进度由本控制器负责；planner 只生成结构化 coverage、plan 或 delta，worker 只执行绑定任务。

- 首次 `validate` 和 `render` 成功后，展示 `render` 产生的完整当前 DAG，不省略节点或依赖；同时说明 plan revision、planned coverage、completed coverage、首批 ready/running task 与下一步。
- 每次 `apply-delta` 成功后，重新运行 `validate` 和 `render`，展示修订后的完整 DAG，并说明相对上一 revision 新增、替换、失效、保留的 task、依赖变化及修订原因。
- task 从 ready 进入 running、完成、失败、阻塞、被替换，或 source revision、planned/completed coverage、required gate、`next_action` 发生变化时，基于当前 plan 与 runtime `status`/`reconcile` 输出简短状态快照；同一推进批次中的多项变化合并播报。
- wait、轮询或 reconcile 没有产生实质状态变化时不重复播报。不得根据聊天记忆手画状态、猜测进度，或把旧 revision 的结果写进当前快照。
- 面向用户只展示 task id/title、公开状态、覆盖率、门禁、变化原因与下一步；不输出 reservation token、完整 `TASK_BINDING_V4`、Owner Capsule、executor target 或内部 artifact 内容。
- 持续推进直到计划项 effect-aware coverage 达到 100%、所有 required gate 通过且 `finalize` 成功；最终回复展示终态快照和验收结论。

## Reservation 恢复与分发

`status`/`reconcile.active_reservations[]` 与 `reserve.actions[]` 都携带 runtime 锁内重建的完整 canonical `TASK_BINDING_V4`。分发只能使用返回的 binding；不得从聊天记忆、旧 prompt 或自行扫描 plan 重算 attempt、token、权限、result path 或 artifact path。

需要安全回收时使用：

```text
node <plugin-root>/scripts/goal-dag.mjs abandon <plan_path> <state_path> <task_id> <reservation_token> <reason>
node <plugin-root>/scripts/goal-dag.mjs reclaim <plan_path> <state_path> <task_id> <reservation_token> <reason>
node <plugin-root>/scripts/goal-dag.mjs confirm-stale-executor <plan_path> <state_path> <executor_id>
node <plugin-root>/scripts/goal-dag.mjs rotate-owner <plan_path> <state_path> <owner_id> <expected_generation> <reason>
node <plugin-root>/scripts/goal-dag.mjs reserve <plan_path> <state_path> <available_capacity>
```

- `spawn_executor`：把 binding 的 `executor_spawn_name` 原样作为 Agent 名称（仅适用非 owner 普通 executor；owner 命名子代理的 spawn name 见下文「owner 多代理 fan-out」），用完整 binding 创建后台 Agent；不创建启动握手回合。model 按上方「公开入口与平台边界」选难度 alias（`opus`/`sonnet`/`haiku`），禁 `claude-*` 完整 id；不指定 thinking/reasoning/effort。取得 agentId 后立即 `bind`。
- `reuse_executor`：确认目标是当前 Goal/Owner 的 idle 健康 Agent；先 `bind`，再用 `SendMessage({to: agentId})` 发送原样 binding。
- `reserved_unbound + spawn_executor` 无匹配 executor 时 `abandon`。复用目标或 running Agent 确认丢失时以当前 token `reclaim`，停止返回的 executor，确认停止后 `confirm-stale-executor`。存在 stop-pending stale executor 时不得 reserve。
- 物理 Agent 丢失后默认保持同一逻辑 Owner/generation；只有污染、重复失败或 Capsule 语义需要隔离时才 `rotate-owner`。owner 模型的 owner_affinity 复用 + 命名子代理完成后不回收，是承重机制（支撑 SendMessage 跨 attempt 稳定寻址做任务分发/状态查询），不是可选性能优化；记忆汇总 via SendMessage 是可选增强，不影响承重。仅跨 Goal 才不复用。

```text
node <plugin-root>/scripts/goal-dag.mjs bind <plan_path> <state_path> <task_id> <reservation_token> <agent_id>
```

## 结果、推进与完成

低频回收后台 Agent 仅限非 owner 的普通 executor；owner 命名子代理完成后不回收（承重机制，支撑 SendMessage 跨 attempt 稳定寻址做任务分发/状态查询；记忆汇总 via SendMessage 是可选增强）。running 不是失败。worker 必须先原子写 binding 指定的 attempt 唯一 result，再结束。只接受 task、Owner generation、attempt、token、source revision、result path 与 audit artifact 全部匹配的结果；迟到或旧 revision 结果只保留审计。

结果出现后立即运行 `finish`，再从 reconcile/reserve 继续，不等待无关并行兄弟：

```text
node <plugin-root>/scripts/goal-dag.mjs finish <plan_path> <state_path> <task_id> <reservation_token> <result_path>
```

只在当前 source digest/revision 仍冻结、effect-aware planned/completed coverage 都为 100%、所有有效 task resolved、required gate 证据通过且无阻断 finding 时运行：

```text
node <plugin-root>/scripts/goal-dag.mjs finalize <goal.json> <goal-state.json> <plan.json> <state.json>
```

`finalize` 会 fresh 读取 source，并要求两个固定 audit evidence 精确引用 runtime 绑定的 artifact ref/digest。对 `local_fallback`，只有它返回 `completed` 才结束本地 Goal；不得调用或模拟 Codex 原生 Goal 工具。

当前调用结束而本地 Goal 尚未完成时，逐字返回最近一次 runtime `status` 或 `goal-validate` 输出的 `continuation_prompt`；不要自行拼接、相对化或摘要。其值必须精确是一行：

```text
/ghost-agent-workflow:subagent-coordination 继续 `<goal.json绝对路径>`。
```

不要拼入计划、Goal Contract、DAG、Owner Capsule、worker prompt 或人工摘要。

## owner 多代理 fan-out（per-owner worktree 物理隔离）

当 Goal 涉及多个 owner 且要求严格文件隔离时，按 feature 分支 fan-out（不依赖实验性 agent teams，用原生命名子代理 + SendMessage + 共享 Task 板）。**入口前置**：首次判断 Goal 需要 owner 隔离时，controller 先确认 `.ghost-agent-workflow/owners/registry.json` 是否存在；不存在则跑 `owner-init`（一次性仓库级 setup），再进入下面的 `owner-query`——若直接 owner-query 而 registry 缺失会 fail。

1. 规划阶段调 `owner-query`；缺口先执行 `owner-add --plan`/`owner-split --plan`，向用户展示候选变化、`registry_digest` 和 `proposal_digest`。AskUserQuestion 明确确认后，以 `--confirm <proposal_digest>` 执行同一 proposal。digest 只绑定 proposal 与 registry freshness，不能证明 AskUserQuestion 或回答者身份。随后产 plan 并运行 `owner-verify-plan`。
2. 运行 `owner-bind-goal <goal.json> <goal-state.json> <plan.json> <state.json> <registry.json> <feature_branch>`，先为 required work Owner 冻结 `pending` delivery；再执行 `worktree-create <registry.json> <feature_branch> <owner_id>`，随后运行 `owner-delivery-reconcile`，验证 worktree identity/base/scope 后推进到 `active`。runtime worktree 是唯一载体；L2 只是 visibility superset。delta 若新增 live writable Owner，下一次 reconcile 会把它以 `pending` 纳入，创建并再次 reconcile 后才能 dispatch。
3. 以 `owner-<owner_id>` 为 Agent spawn name，让它直接在 canonical `owner_exec.worktree_path` 工作；不得创建第二个 isolation worktree或退回主 checkout。普通 task 的 `owner_exec` 为 `null`；Owner work task 包含 `agent_type`、`worktree_path`、`owner_branch`、`base_oid`、`owned_modules_glob`。runtime `bind` 不验证宿主进程的实际 cwd/branch/HEAD，worker 必须自检；宿主不支持既有路径或校验失败时返回 `unsupported`/`needs_repair`。Owner Bash 默认 deny。
4. worker 通过 `owner_updates` 回写 per-Goal Capsule；controller 在主工作区用 `owner-note` 沉淀 registry memory，worker 不写 registry memory。
5. work task accepted 后按 `status.next_action` 推进：`owner_commit_pending` 时逐 Owner 调 `worktree-commit <registry.json> <owner_id>` 后 reconcile；`owner_merge_pending` 时串行调 `worktree-merge-back <registry.json> <feature_branch> <owner_id>` 后再次 reconcile。commit 必须先于 merge，clean/branch/OID/exact scope 任一门禁失败都停止。
6. 所有 required Owner merged 后才运行 merge 后的 `diff-scope-audit`，再运行 `finalize`；成功后才能 `worktree-remove`。worktree 命令当前仍是 registry-first 旧 surface，由 bind+reconcile 同步 Goal，不是跨 Git/JSON 的原子命令，也没有完整 crash-intent journal。

```text
node <plugin-root>/scripts/goal-dag.mjs owner-list           <registry.json>
node <plugin-root>/scripts/goal-dag.mjs owner-query         <registry.json> <requirement.json>
node <plugin-root>/scripts/goal-dag.mjs owner-verify-plan   <registry.json> <plan.json>
node <plugin-root>/scripts/goal-dag.mjs owner-note          <registry.json> <owner_id> <note.json>
node <plugin-root>/scripts/goal-dag.mjs owner-bind-goal      <goal.json> <goal-state.json> <plan.json> <state.json> <registry.json> <feature_branch>
node <plugin-root>/scripts/goal-dag.mjs owner-delivery-reconcile <goal.json> <goal-state.json> <plan.json> <state.json> <registry.json>
node <plugin-root>/scripts/goal-dag.mjs worktree-create      <registry.json> <feature_branch> <owner_id>
node <plugin-root>/scripts/goal-dag.mjs worktree-commit      <registry.json> <owner_id>
node <plugin-root>/scripts/goal-dag.mjs worktree-merge-back  <registry.json> <feature_branch> <owner_id>
node <plugin-root>/scripts/goal-dag.mjs worktree-remove      <registry.json> <owner_id> [--force]
```

## 契约与模板

> 以下契约原存于 `references/`，现已内联于本节，controller 触发本 skill 即见，无需再 Read references 文件。

### Reservation 恢复契约

只在 coordinator 已运行 `status` 与 `reconcile` 后参考本节。runtime 的 active reservation、Owner Capsule 与 attempt 唯一路径是事实；executor 会话状态只用于选择恢复动作。

#### 定义

- **orphan reservation**：state 为 reserved/running，但无法证明一个健康 executor 正持有同一 goal、owner generation、task、attempt 与 reservation token，且 canonical result 尚不存在。
- **orphan executor**：已创建 executor，但 state 没有把它绑定到当前 reservation，或 reservation 已被 reclaim/替换。
- **canonical result**：binding 给出的 `results/<task_id>/attempt-<attempt>-<reservation_token>.json`。同一 task 的任何其他路径都不是该 attempt 的结果。
- **canonical spawn identity**：reserve action 与 binding 同时下发的 `executor_spawn_name`。spawn-before-bind 恢复只接受这个精确名字；协调器不得推导或改写。**owner 模型例外**：owner 命名子代理的 Agent spawn name 固定为 `owner-<owner_id>`（稳定，跨 attempt 不变，作 SendMessage 二次寻址句柄）；此时 `executor_spawn_name`（形如 `runtime-...-g2_a2_<hex>`）退化为 per-attempt executor_id / reservation token，仅用于 `bind`，绝不当 Agent spawn name。
- **canonical recovery binding**：`status`/`reconcile.active_reservations[]` 在 runtime 锁内从当前 plan/state 重建的完整 `TASK_BINDING_V4`。它与最初 reserve binding 等价，是崩溃恢复时唯一允许重新 bind/send 的输入。

Agent/执行单元复用只降低启动成本。不要从聊天记忆推断 task 身份、权限或完成状态；只信 Owner/Capsule、binding、state 与 canonical result。

`abandon` 只回滚 `reserved_unbound + spawn_executor`（Owner 尚无已绑定 executor）的 reservation；`reclaim` 处理 running/lost，以及 `reserved_unbound + reuse_executor` 的已绑定复用目标确认丢失这一安全例外，并把已知 executor 记入 `stale_executors: stop_pending`。两者都会清空 Capsule active task/checkpoint；旧 checkpoint 只保留历史。reclaim 后必须停止物理 executor，再 `confirm-stale-executor`，否则不得 reserve/refresh。

#### 恢复矩阵

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
| owner 模型恢复：per-owner worktree 重连 | `owner-list` 列出 registry active owner，逐 owner 校验 worktree 存在、runtime 登记的唯一 owner branch、base OID 与 sparse 范围；executor 健康则 `SendMessage({to: owner-<owner_id>})` 重连，executor 丢失则 `abandon` + 重新以 `owner-<owner_id>` spawn。worktree 丢失或 OID 无法证明时不得静默重建或降级到主 checkout，进入 `needs_repair`。 |

#### 顺序不变量

1. 每次进入都运行 `status`，再 `reconcile`。
2. 完成上表的恢复动作后才运行 `reserve`。
3. 分发只使用 `reserve.actions[]` 或 `status`/`reconcile.active_reservations[]` 返回的完整 canonical binding；禁止依赖聊天记忆或自行重算。非 owner executor 使用精确 `executor_spawn_name` spawn；owner 命名子代理以 `owner-<owner_id>` 为 Agent spawn name，`executor_spawn_name` 仅作 executor_id 用于 `bind`。每次 bind/send 都保持 attempt、token、result_path 与 artifact paths 不变。
4. worker 先原子写 canonical result；coordinator 再 `finish`。
5. `finish` 后重新 reconcile；`reclaim` 后必须 stop + `confirm-stale-executor`，stale 列表清零后才 reserve。
6. 只有 runtime 证明 coverage 100%、所有有效 task resolved 且 gate 通过时，coordinator 才运行 finalize；Codex 随后完成 native bridge，Claude Code 则确认本地 completed。

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

### GOAL_CONTRACT_V1 契约

仅在 `subagent-coordination` 创建或校验 Claude Code 本地 Goal 时参考本节。`goal.json`、`goal-state.json`、`coverage.json`、`plan.json` 与 `state.json` 必须位于同一目录。

#### GOAL_CONTRACT_V1

```json
{
  "contract": "GOAL_CONTRACT_V1",
  "goal_id": "runtime-owner-reuse--4cc8a51d904e",
  "execution_platform": "claude_code",
  "workspace": {
    "root": "/absolute/workspace/root"
  },
  "lifecycle": {
    "controller": "local_fallback",
    "native_goal": null
  },
  "source": {
    "path": "/absolute/path/to/plan.md",
    "digest": "<plan.md sha256>",
    "revision": 1
  },
  "objective": "完整执行计划且计划项覆盖率达到 100%",
  "scope": ["Goal、DAG runtime、skills 和测试"],
  "constraints": ["保留用户已有改动", "所有结果必须可复核"],
  "non_goals": ["部署", "发布"],
  "execution": {
    "mode": "subagent",
    "max_concurrency": 3,
    "reuse_policy": "owner_affinity"
  },
  "verification_gates": [
    {
      "id": "runtime-unit",
      "stage": "unit",
      "description": "runtime 单元测试通过",
      "required": true
    },
    {
      "id": "workflow-smoke",
      "stage": "smoke",
      "description": "真实 Goal DAG smoke 通过",
      "required": true
    },
    {
      "id": "source-coverage-audit",
      "stage": "pre-execution",
      "description": "独立 verify task 逐项分类 SOURCE_BLOCKS_V1，证明 source 没有遗漏且 required effects 已映射到 DAG",
      "required": true
    },
    {
      "id": "diff-scope-audit",
      "stage": "final",
      "description": "由独立 review/verify task 核对实际工作区差异均位于 Goal 授权 scope，并保存可复核 artifact",
      "required": true
    }
  ],
  "side_effects": {
    "deploy": "forbidden",
    "external_write": "forbidden"
  },
  "completion": {
    "plan_coverage_100": true,
    "all_tasks_completed": true,
    "required_gates_passed": true,
    "blocking_findings_zero": true,
    "diff_in_scope": true
  }
}
```

Claude Code 没有 native Goal identity。默认 local instance digest 定义为 `SHA-256(UTF-8(source.path + "\n" + source.digest))`；`goal_id` 和目录名都必须包含其至少前 12 位小写 hex，推荐形态为 `<可读-slug>--<digest-prefix>`。slug 要归一化并裁剪，使完整 id 匹配 `[A-Za-z0-9][A-Za-z0-9._-]{0,95}`；没有可用 slug 时使用 `goal`。同一 source path+digest 的普通首次调用默认恢复已有 instance，不得覆盖目录；恢复前还要核对当前调用的 objective、execution mode、constraints 与 side-effect policy，任何差异都必须停止并要求显式新实例。若用户要并行或重复执行完全相同的 source，必须显式提供稳定 `instance_key`，改用 `SHA-256(UTF-8(source.path + "\n" + source.digest + "\n" + instance_key))`。短前缀碰撞到不同契约时逐步延长同一 digest 前缀。续跑只接受 runtime 返回的绝对 `goal.json` 路径，并精确校验 `goal_id`、source path 与持久化 digest。

首次 `goal-validate` 会根据绝对 `workspace.root` 捕获排除 `.ghost-agent-workflow/` 的 `WORKTREE_BASELINE_V1`，并从当前 source 生成逐个非空行的 `SOURCE_BLOCKS_V1`。两者的绝对 ref 与 SHA-256 digest 只由 runtime 写入 `goal-state.json`；planner 与 worker 只能消费绑定，不得重建。

#### Gate 与约束合并

按顺序保留仓库强制 gate、加入计划验收、再加入插件调用参数明确追加的测试。相同语义使用稳定 id。固定 required gate `source-coverage-audit` 与 `diff-scope-audit` 都不得删除：前者只能由所有 work task 的独立 verify/audit 祖先覆盖，并用 runtime 生成的 `SOURCE_COVERAGE_AUDIT_V1` 证明每个 source block 已映射或有明确 non-requirement 理由；后者只能由独立 `review` 或 `verify` audit task 覆盖，并用 runtime 对 baseline 与当前真实工作区的扫描生成 `DIFF_SCOPE_AUDIT_V1`。两类 passed evidence 都必须携带 binding 指定的非空 `artifact_ref` 与 `artifact_digest`。其它 required gate 也必须由至少一个 task 的 `satisfies_goal_gates` 覆盖，并由对应 `WORKER_RESULT_V4.evidence` 提交可复核证据。

把 scope、constraints、non_goals 与 side_effects 原样下发到每次 `TASK_BINDING_V4`。任何 task 都不得越过它们；需要扩域时返回 `needs_repair`，由 planner 生成 delta。
