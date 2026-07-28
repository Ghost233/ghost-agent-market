---
name: sub-thread-goal-worker
description: 仅供 sub-thread-coordination 向已登记的长期 Owner Worker 或独立 Implementation Review 子线程投递 canonical TASK_BINDING_V6 或脚本化 binding 获取指令时使用。执行一个 fenced attempt，通过脚本生成完整结果并只返回紧凑 receipt。
---

# 子线程 Worker

只执行当前 binding；不得使用 subagent 或继续委派。首次接收 binding 时完整读取 [最小输入模板](references/templates.md)，模板 digest 未变时不重复读取。

创建新线程前必须重新读取仓库配置：work 使用 `profiles.owner`，Implementation Review 使用 `profiles.review`；默认均为 `gpt-5.6-sol/high`。Worker 不自行选择或修改模型。Runtime gate 由脚本执行，不投递给本 Skill。

## 绑定门禁

- 如果收到 Supervisor 的 `dispatch`，先原样运行其中的 `supervisor-record ... binding` 命令取得完整 binding；不得直接读取 Plan、State 或 Registry。
- binding 同时由脚本保存到 receipt 的 `binding_ref`；不得在聊天中复述 binding 或脚本 JSON。
- 必须是完整 `TASK_BINDING_V6`，且 `run.executor` 等于当前真实 thread id。
- 核对 `task/run/thread/subject/scope/refs/review/policy/audit/output`；同一信息只出现一次，不接受旧平铺别名。
- 同一 attempt/token 的重投是幂等恢复；不重置进度，不覆盖 canonical result。
- 任一身份或 digest 不符时停止，不修改业务文件。

## 执行

- 只做 binding 的 task/done_when/定向 verification。
- work 只能修改 task 与 Owner scope 的交集；Review 不改业务文件。
- 只读取 binding 明确给出的依赖产物；不读取其他任务聊天。
- 不自行运行全仓测试、完整 Review 或重复 dry-run。
- JSON、状态和配置变更优先调用项目 domain command；没有 validator 时停止，不手写文件。

## 变化请求

- 需要拆成内部 DAG：不写 request JSON；在任何可归因修改前调用 `subgraph-request`，返回 receipt 后停止当前 attempt，等待 Composite Planner。
- scope 漏项：返回 `needs_repair + scope`，只写 `paths + reason`，不得先越界修改。
- 完成后发现公共接口、安全、并发、权限、兼容性、scope 扩张、测试不稳定或重复失败风险：在最小结果输入中填写一句 `review_upgrade`。不要创建或重连 Review 节点。

## 结果

不要构造 `WORKER_RESULT_V5`。只把 `TASK_RESULT_INPUT_V2` 的少量语义字段送入：

```text
goal-dag.mjs result-submit <plan> <state> <task_id> <token>
```

runtime 自动补齐 identity、Review binding、默认空字段、result path、digest 和 stored `WORKER_RESULT_V5`。stdout 的 `THREAD_TASK_RECEIPT_V1` 只作机器收据，不得复制到 commentary、final 或普通聊天。完整结果只落盘；线程结束由 Supervisor 根据脚本状态通知 Main。

Evidence 只写 `id`，需要时再加 `outcome/summary/artifact`；artifact digest 由脚本计算。发布物只写 `type/path/audience`。长任务 checkpoint 使用 `checkpoint-save`；source/diff/commit readiness 不由模型执行。

协调线程随后调用 `finish` 做 changed-file 归因、scope/identity 校验、evidence 登记和 Review 升级状态迁移。

线程之间只传必要标量、文件引用和不超过 100 字的脚本摘要。禁止粘贴完整 JSON、stdout、DAG、diff、日志或结果正文；错误只报告一句原因与脚本给出的日志路径。
