# Planner 最小契约

不要复制完整 canonical schema。Planner 只提供脚本无法推导的语义；所有对象直接送入命令 stdin，不创建中间 JSON 文件。

## 顶层 Plan

- `PLAN_INPUT_V1.items[]`：`id/description/source_refs/effects`。
- `PLAN_INPUT_V1.tasks[]` 常用字段：`id/title/owner/work/after/write/done/verify/gates/items`。
- `role/actor/risk/review/review_batch/review_reason/reviews/priority/cost/parent/locks` 仅在默认值不合适时填写。
- 调用 `goal-dag.mjs plan-create <goal> <plan>`；脚本生成 `PLAN_COVERAGE_V1` 和 `DAG_PLAN_V5`。
- task 标题包含中文；work 有 writable scope，review/verify 没有 writable scope。
- immediate Review 节点依赖 subject，subject 的业务下游经过该 Review。

## Review 升级 Delta

`DAG_DELTA_INPUT_V1.review[]` 每项只有：

```json
{"task":"T2","review_task":"T2R","reason":"公共接口变化"}
```

`T2R` 同时出现在 `tasks`。通过 `goal-dag.mjs apply-delta <plan> <state> -` 应用；runtime 自动补元数据、修改 subject policy、重连下游并清除 pending 状态。

## 子图 Expansion

`TASK_SUBGRAPH_INPUT_V1` 只提供 `children/entry/exit` 和可选 safety。通过 `expand-subgraph ... -` 应用；父 id/token 来自命令参数，request/ref/digest/reason/revision 由 runtime 绑定。runtime 校验：

- 父仍是 running leaf，token/digest 匹配且没有越界修改；
- children 使用 `<parent>-<n>`，只依赖兄弟；
- entry/exit 与真实内部 DAG 一致；
- 外部边不穿透父节点。

## Owner transition

`DAG_DELTA_INPUT_V1.owner` 只写 `validation/approval/rebind`。Registry digest、文件 digest 和 Owner 定义由脚本读取，不能重复手写。
