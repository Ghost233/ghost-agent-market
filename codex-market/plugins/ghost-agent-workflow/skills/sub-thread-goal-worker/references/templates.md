# 最小 Worker 输入

## TASK_BINDING_V6

binding 由 runtime 生成，Worker 不复制或补字段。重点核对：

- `task`：id/title/role/work/done/verify/items/risk/dependencies；
- `run`：attempt/token/source revision/generation/executor；
- `thread` 与 `subject`：路由、模型和 Owner/runtime 上下文；
- `scope`：统一的 read/exclude/write，不再重复 readable/searchable 字段；
- `refs`：plan/state/coverage/source blocks/Registry/Capsule/result 等路径；
- `review/policy/audit/output`：Review、Goal 边界、机械审计路径与 `TASK_RESULT_INPUT_V2`。

## TASK_RESULT_INPUT_V2

最小完成输入：

```json
{
  "contract": "TASK_RESULT_INPUT_V2",
  "status": "completed",
  "summary": "完成实现并通过定向验证",
  "evidence": [{"id":"state-unit"}]
}
```

只在需要时增加：

- `blocking`、`notes`、`follow_ups`；
- `scope: {paths, reason}`（仅 `needs_repair`）；
- `owner: {decisions, invariants, risks}`；
- `publish: [{type, path, audience}]`；
- `review_upgrade`（仅 completed work）。

Evidence 默认 passed，通常只写 `id`；按需增加 `outcome/summary/artifact`。runtime 计算 artifact digest。

不要填写 task identity、generation、thread id、token、attempt、revision、Review digests、changed files、默认空数组、路径、timestamp 或 digest；runtime 从 Plan/State/Workspace 自动生成。

Review 线程也使用同一最小输入，只写结论与 evidence。runtime 从 binding 自动绑定 reviewed results、plan digest 和 workspace digest，避免复用旧 Review。

## 子图请求

不写 `TASK_SUBGRAPH_REQUEST_V1`，只调用：

```text
goal-dag.mjs subgraph-request <plan> <state> <task_id> <token> <reason> [建议子任务]...
```

runtime 自动补 attempt、source revision、Owner generation、executor id、path 和 digest。

## Checkpoint 与 source audit

只有确需跨回合恢复长任务时，向 `checkpoint-save` stdin 提交 `CHECKPOINT_INPUT_V1`：`progress` 必填，`decisions/invariants/risks/symbols/next` 按需填写。不得手写 Owner identity、generation、token 或 checkpoint 文件。

source audit 向 `source-audit-auto` stdin 提交 `SOURCE_AUDIT_INPUT_V1`，只在 `non_requirements` 中填写未映射 source block 的理由；mapped 分类和完整证据由 runtime 生成。
