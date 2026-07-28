---
name: sub-thread-coordination
description: 当用户明确要求用长期子线程、Owner DAG、可展开子图、显式 Review 和网页进度执行计划时使用。默认不要求原生 Goal；只有用户已启动或明确要求 Goal 才桥接。所有执行单元均为可长期持有上下文的子线程。
---

# 子线程 DAG 协调器

这是唯一协调入口。运行时禁止使用 subagent 接口，也禁止把临时执行单元伪装成长期子线程。

首次进入时完整读取 [Owner 治理](references/owner-governance.md)、[运行契约](references/goal-contract.md) 和 [恢复约定](references/templates.md)。只有引用文件 digest 改变或进入对应流程时才重读。Planner 必须显式使用 `$parallel-task-planner`，Worker 使用 `$sub-thread-goal-worker`，监督线程使用 `$sub-thread-task-supervisor`。

## 硬规则

1. 模型只提供业务判断和最小语义输入。ID、attempt、token、revision、digest、timestamp、路径、默认字段、状态迁移和文件写入均由脚本生成。
2. 有 domain command 时必须使用；不得手写完整 JSON，也不得用 `json-write --replace` 模拟状态更新。
3. `state.json`、`goal-state.json`、`threads.json`、`progress.json`、`events.jsonl`、Registry 和 Capsule 只能由脚本更新。
4. Goal、Plan、Delta、Expansion、Checkpoint、source audit 和 result 都有精简输入命令；正常流程禁止 `json-write`。旧完整契约只作为只读兼容输入。
5. 聊天只传 binding、最小输入和紧凑 receipt。完整结果与证据只落盘。

## 生命周期

默认 `standalone_thread`，不调用原生 Goal 工具。只有用户已经启动或明确要求 Goal 时使用 `codex_native`；Owner 变化等待用户时不要把 Goal 标为 blocked，应用完成后提示用户可继续 Goal。

创建时把 `GOAL_INPUT_V1` 和 `PLAN_INPUT_V1` 直接送入脚本 stdin，不先创建中间 JSON：

```text
goal-dag.mjs goal-create <goal.json> <workspace_root>
goal-dag.mjs goal-validate <goal.json>
goal-dag.mjs plan-create <goal.json> <plan.json>
goal-dag.mjs validate <plan.json>
```

## 主线程与线程登记

主线程发现不使用 nonce：

1. 把当前任务标题设为 `[GA][TASK][MAIN] <goal_id>`。
2. 扫描当前 workspace 的任务。
3. 标题完全匹配且未结束的 Main 必须恰好一个；零个或多个立即停止本工作流，不创建任何子线程。
4. 用脚本持久化该 `thread_id + host_id`：

```text
goal-dag.mjs thread-registry init <threads.json> <goal_id> <main_id> <main_host>
```

其他变更只调用：

```text
goal-dag.mjs thread-registry put-thread <threads.json> <key> <thread_id> <host> <role> <idle|running|lost>
goal-dag.mjs thread-registry set-status <threads.json> <key> <idle|running|lost>
goal-dag.mjs thread-registry put-watch <threads.json> <task_id> <attempt> <key> [cursor|-]
goal-dag.mjs thread-registry remove-watch <threads.json> <task_id> <attempt> <key>
```

系统 key 使用 `wf_<role>_<goalkey>` 风格，只含小写字母、数字和下划线。可见标题使用 `[GA][TASK][ROLE] 名称`：

- `[GA][TASK][SUPERVISOR] 任务监督`
- `[GA][TASK][DAG_VIEW] DAG 视图`
- `[GA][TASK][OWNER] <owner_id>`
- `[GA][TASK][RUNTIME] <actor_id>`
- `[GA][TASK][REVIEW] <task_id>`

## 固定子线程

- 监督线程：固定 `gpt-5.6-luna/low`，加载 `$sub-thread-task-supervisor`；只等待和通知。
- DAG 视图线程：只启动/读取 Dashboard，不向主线程输出图。
- Owner/Runtime 线程：同一 Owner generation 长期复用；只在丢失或上下文不可恢复时轮换。
- Review 线程：执行显式 Review 节点，不复用实现线程的聊天上下文。

## 规划与调度

初始计划只生成稳定的顶层节点。Review 是 `role: review` 的普通 DAG 节点；机械验收不是 Review。每轮严格执行：

```text
status -> reconcile -> recovery/apply -> reserve
```

创建或复用线程后先 `bind`，再发送未经修改的精简 canonical binding `TASK_BINDING_V6`，固定 envelope 为：

```text
使用 $sub-thread-goal-worker；执行以下 canonical TASK_BINDING_V6：
```

随后用 `thread-registry put-watch` 登记，并把同一 watch 交给监督线程。监督线程只通知主线程检查；Worker 聊天只返回 `THREAD_TASK_RECEIPT_V1`。主线程读取 canonical result、调用 `finish`，然后只向用户报告已经机械接受的 task 最终结果。

## Review 升级

Worker 只在结果最小输入中填写可选 `review_upgrade`。`finish` 自动将该 task 置为待升级；`reconcile` 返回 `review_upgrades[]` 并暂停其下游。

Planner 的 delta 只增加一个简短映射：

```json
{"task":"T2","review_task":"T2R","reason":"公共接口变化"}
```

同时在 `tasks` 中提供精简 Review 节点，并把 `DAG_DELTA_INPUT_V1` 从 stdin 交给 `apply-delta ... -`。runtime 自动补 revision/digest/默认数组、把 subject 改为 immediate、重连直接下游并清除待升级状态。

## 子 DAG

leaf 需要拆解时，Worker 不写 request JSON，只调用：

```text
goal-dag.mjs subgraph-request <plan> <state> <task_id> <token> <reason> [建议子任务]...
```

Planner 只生成 `TASK_SUBGRAPH_INPUT_V1` 的 children、entry、exit 和可选 safety，再通过 `expand-subgraph ... -` 应用。runtime 自动绑定 request、token、revision、digest 和父节点。child 使用 `T2-1` 风格，内部仍是 DAG；外部依赖始终指向父节点。

## Owner 变化

Owner 变化是用户决策，流程期间暂停整个当前 DAG，避免设计多套局部暂停状态：

```text
request -> validate-change -> 用户确认 -> approve-change -> apply-change -> owner transition delta
```

批准文件必须由 `owner-registry.mjs approve-change` 生成，不能手写。应用和 transition 均成功后恢复调度；详见 Owner 治理。

## 进度、挂死与完成

每个 runtime mutation 都自动刷新固定 `progress.json` 并追加 `events.jsonl`；模型和 DAG 视图线程不得写这两个文件。主线程不输出 Mermaid 或 DAG diff，只给 Dashboard URL 和最终 task 结果。

监督线程连续三次 bounded wait 都没有状态或 cursor 变化时发送一次 `TASK_STALLED`，保留 watch。主线程确认后可 reclaim、将旧线程标为 lost/archived，再创建新 generation；监督线程不得自行关闭或重启任务。

Evidence 只有 runtime 返回单一 `cache_key` 时才允许复用；没有 key 就执行验证，禁止模型拼接多个 digest。

只有 coverage、Review/verify、blocking findings、scope 和 delivery gate 全部通过时运行 `finalize`。standalone 到此完成；codex_native 再桥接原生 Goal。
