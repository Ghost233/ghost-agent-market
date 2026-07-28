# Goal DAG v5 子线程设计

更新：2026-07-28

## 目标

把计划编译为可恢复的 Owner/task DAG，并用长期子线程执行。主线程只报告已经机械接受的 task 最终结果；完整 DAG、进度和历史由外置 Dashboard 展示。

## 五条不变量

1. 执行单元是长期子线程，不是 subagent。
2. Review 是 DAG 节点；机械验收不是 Review。
3. 父 task 可在运行时展开为内部子 DAG，外层边始终指向父节点。
4. 模型只给最小语义输入；契约补全、状态迁移和文件写入由脚本完成。
5. `progress.json` 与 `events.jsonl` 是固定抓取入口，模型不得写。

## 生命周期

默认 `standalone_thread`，不要求 `/goal`。只有用户已启动或明确要求 Goal 时使用 `codex_native`。Owner 变化等待用户不是 technical blocked；应用成功后提示用户继续 Goal。

## 线程

可见标题：

- `[GA][TASK][MAIN] <goal_id>`
- `[GA][TASK][SUPERVISOR] 任务监督`
- `[GA][TASK][DAG_VIEW] DAG 视图`
- `[GA][TASK][OWNER] <owner_id>`
- `[GA][TASK][RUNTIME] <actor_id>`
- `[GA][TASK][REVIEW] <task_id>`

系统 key 只含小写字母、数字和下划线。Main 发现不用 nonce：设置 canonical 标题后扫描 workspace，必须恰好一个 active Main，否则停止整个工作流。

`THREAD_REGISTRY_V1` 只有 main、threads、watches 三类运行信息。初始化、登记、状态和 watch 变化都用 `thread-registry` 命令，不允许整份替换。

## 脚本优先

脚本负责：

- identity、revision、attempt、token、path、timestamp、digest 和默认字段；
- Plan/State/Registry/Capsule/Progress/Event 的校验与写入；
- task result 的完整 `WORKER_RESULT_V5` 生成；
- 子图 request、Review 升级、Owner approval 和 DAG 边重连。

模型只保留不可推导语义：任务内容、依赖、scope、完成条件、验证结论、Review 原因和用户决策。Goal、Plan、Delta、Expansion、Checkpoint、source audit 和 result 均使用精简 input contract 直接送入 domain command；正常流程不再使用 `json-write`。canonical 文件仍保留完整审计字段，但只由脚本生成。

精简输入为 `GOAL_INPUT_V1`、`PLAN_INPUT_V1`、`DAG_DELTA_INPUT_V1`、`TASK_SUBGRAPH_INPUT_V1`、`CHECKPOINT_INPUT_V1`、`SOURCE_AUDIT_INPUT_V1` 和 `TASK_RESULT_INPUT_V2`。脚本统一补齐 Owner/runtime actor、identity、revision、token、路径、digest、默认数组和状态迁移。

## 调度

每轮：

```text
status -> reconcile -> recovery/apply -> reserve
```

同一 Owner generation 复用同一工作线程。Review 使用独立 Review 线程。`gpt-5.6-luna/low` 监督线程只 wait/notifies，不读结果；连续三次等待没有 state/cursor 变化时发 `TASK_STALLED`，由主线程决定 reclaim、关闭旧线程和新建 generation。

## Review

初始策略由 Planner 写进 DAG：普通局部任务 batch；公共接口/共享基础设施 immediate；安全、权限、迁移等 high + immediate；确定性文档可 final_only/none。

运行中升级只增加三个语义字段：subject task、Review task id、reason。runtime 自动：

1. 暂停 subject 下游；
2. 将 subject 标为 immediate；
3. 插入 Review 节点；
4. 重连直接下游；
5. 清除 pending upgrade。

## 子图

Worker 调用 `subgraph-request`，脚本自动生成 request。Planner 只规划 children/内部边，runtime 用 `expand-subgraph` 原子应用。

```text
T1 -> T2 -> T3
      ├─ T2-1
      ├─ T2-2
      └─ T2-3
```

children 只依赖兄弟；entry/exit 必须与内部 DAG 一致；父节点完成等于 required children 完成；child 可递归展开。

## Owner 变化

为避免复杂局部状态，当前 Goal 在 Owner 变化期间暂停全部新 reserve：

```text
request-change -> validate-change -> 用户确认 -> approve-change -> apply-change -> transition delta
```

request、validation、approval 和 Registry 都由 Owner 脚本生成/写入。用户没有明确批准时停止；成功后恢复 DAG。

## Progress 与 Evidence

每次 runtime mutation 自动更新当前快照并追加 task/DAG/result 事件。Dashboard 只读这两个文件。主线程不复制 DAG 图。

Evidence 默认不缓存。只有 runtime 返回一个完整 `cache_key` 时才复用；模型不得自行拼 digest。这样避免不安全复用，也不引入四五个公开字段。

## 完成

coverage、required task、Review/verify、blocking findings、scope 和 delivery gate 全部通过后才 finalize。standalone 直接结束；codex_native 再完成原生 Goal。
