---
name: sub-thread-goal-worker
description: 仅供 sub-thread-coordination 向已登记的长期 Owner、Runtime 或 Review 子线程投递 canonical TASK_BINDING_V6 时使用。执行一个 fenced attempt，通过脚本生成完整结果并只返回紧凑 receipt。
---

# 子线程 Worker

只执行当前 binding；不得使用 subagent 或继续委派。首次接收 binding 时完整读取 [最小输入模板](references/templates.md)，模板 digest 未变时不重复读取。

## 绑定门禁

- 必须是完整 `TASK_BINDING_V6`，且 `run.executor` 等于当前真实 thread id。
- 核对 `task/run/thread/subject/scope/refs/review/policy/audit/output`；同一信息只出现一次，不接受旧平铺别名。
- 同一 attempt/token 的重投是幂等恢复；不重置进度，不覆盖 canonical result。
- 任一身份或 digest 不符时停止，不修改业务文件。

## 执行

- 只做 binding 的 task/done_when/定向 verification。
- work 只能修改 task 与 Owner scope 的交集；Review/verify 不改业务文件。
- 只读取 binding 明确给出的依赖产物；不读取其他任务聊天。
- 不自行运行全仓测试、完整 Review 或重复 dry-run。
- JSON、状态和配置变更优先调用项目 domain command；没有 validator 时停止，不手写文件。

## 变化请求

- 需要拆成内部 DAG：不写 request JSON；在任何可归因修改前调用 `subgraph-request`，返回 receipt 后结束本次执行。
- scope 漏项：返回 `needs_repair + scope`，只写 `paths + reason`，不得先越界修改。
- 完成后发现公共接口、安全、并发、权限、兼容性、scope 扩张、测试不稳定或重复失败风险：在最小结果输入中填写一句 `review_upgrade`。不要创建或重连 Review 节点。

## 结果

不要构造 `WORKER_RESULT_V5`。只把 `TASK_RESULT_INPUT_V2` 的少量语义字段送入：

```text
goal-dag.mjs result-submit <plan> <state> <task_id> <token>
```

runtime 自动补齐 identity、Review binding、默认空字段、result path、digest 和 stored `WORKER_RESULT_V5`。聊天只能返回 stdout 的 `THREAD_TASK_RECEIPT_V1`。

Evidence 只写 `id`，需要时再加 `outcome/summary/artifact`；artifact digest 由脚本计算。发布物只写 `type/path/audience`。长任务 checkpoint 使用 `checkpoint-save`，source audit 使用 `source-audit-auto`，不要自行创建对应 JSON。

协调线程随后调用 `finish` 做 changed-file 归因、scope/identity 校验、evidence 登记和 Review 升级状态迁移。
