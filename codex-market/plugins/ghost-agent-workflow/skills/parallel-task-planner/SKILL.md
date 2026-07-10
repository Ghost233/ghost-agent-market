---
name: parallel-task-planner
description: |
  当用户要求把自然语言需求或已有计划文档拆成 Codex 并发模块、整理依赖 DAG、判断并发安全性，
  或生成并立即执行版本化并发计划时使用。范围、依赖或 profile 无法确认，以及任务只能串行时也使用。
---

# Parallel Task Planner

## 目标

把具备可执行信息的需求或计划文档整理为短小、可审计的并发 module 计划。planner 只负责输入归一化、最少冲突检查、profile 解析、拓扑 batch、计划写入和安全交接；不创建实现子代理、不追加 runtime evidence，也不替 coordinator 或 worker 修改业务代码。

## 输入与最少检查

接受以下任一输入：

- 自然语言：目标、已知范围、完成条件、依赖、约束和验证偏好。
- 计划文档绝对路径：保留已经确定的决策，只提取可执行 module。

`execution_platform` 固定为 `codex`。读取可选顶层 `worker_defaults` 与 module 级 `worker_profile` 覆盖；未显式覆盖时使用 `terra/xhigh`。只读取确认目标文件、依赖、可写范围、profile 和验证冲突所需的最少仓库内容。不要为制造并发而扩张需求、猜测隐式接口或猜测模型标识。

## 计划契约

每次规划写入：

```text
docs/parallel-task-plans/YYYY-MM-DD-<goal-slug>.md
```

计划使用以下 schema：

```yaml
planner: parallel-task-planner
plan_format_version: 1
execution_platform: codex
dispatch_mode: parallel-plan
review_mode: diff_self_check
parent_goal: <一句话结果>
source: natural_language | <计划文档路径>
worker_defaults:
  model: terra
  reasoning_effort: xhigh
modules:
  - id: M1
    task: <单一可执行结果>
    writable_paths:
      - <窄路径或 glob>
    depends_on: []
    done_when:
      - <可观察完成条件>
    verification:
      - <定向命令或替代证据>
    worker_context: <实现所需的最少上下文>
    worker_profile:
      model: terra
      reasoning_effort: xhigh
safety:
  status: parallel_safe | sequential_only | needs_user_review
  reasons:
    - <判定证据>
dispatch:
  batches:
    - [M1, M2]
```

计划只包含 plan-authored `worker_profile`。不要写 `worker_profile_evidence` 或任何 reviewer profile、reviewer preflight、reviewer 分支；实现 worker 自己执行 `diff_self_check`。

## Profile 解析

写入计划前按顺序解析：

1. 从 Codex 默认 `worker_defaults: terra/xhigh` 开始。顶层覆盖和 module 覆盖都可单独覆盖 `model` 或 `reasoning_effort`，计划顶层始终写出完整默认值。
2. 每个 module 将覆盖合并到已解析的 `worker_defaults`，再写出完整、不可继承的 `worker_profile`。
3. `terra` 是允许的友好 alias；coordinator 分派时负责映射到 `gpt-5.6-terra`。其他模型必须是当前 Codex 实现子代理接口可识别的完整 model id。
4. `model` 与 `reasoning_effort` 必须非空且可由当前子代理调度接口支持。空值、未知值、平台不匹配或字段不完整时写 `needs_user_review`，并说明具体字段。

计划中的 profile 是请求约束，不是运行时 evidence。不要把 alias 展开结果、推荐值、提示词声明或假定的 effective profile 写成已经应用；不允许选择近似模型或降低 reasoning effort。

## 依赖与 Batch

- 每个 module 使用唯一非空 `id`；`depends_on` 只能引用同一计划中的 id，依赖图必须无环。
- 按拓扑层生成 `dispatch.batches`。每个 module id 恰好出现一次，所有依赖 module 必须位于更早 batch。
- 同一 batch 内的 `writable_paths`、验证产物和共享环境不得冲突。精确路径、父子路径、相交 glob、共享 API、迁移、生成输出和全局配置均按潜在冲突处理。
- 非空 `depends_on` 本身不表示只能串行。有拓扑依赖但至少一个 batch 含两个以上可安全同时执行的 module 时，仍可为 `parallel_safe`。
- 只有每个 batch 宽度都为 `1`、不存在任何安全并发层时，才写 `sequential_only`。

## 安全门禁

只有以下条件全部成立，`safety.status` 才能写 `parallel_safe`：

1. 至少两个可执行 module，且至少一个 batch 宽度大于 `1`。
2. 依赖图无环，batch 是合法拓扑顺序，每个依赖位于更早 batch。
3. 同一 batch 的可写路径、共享契约、验证产物和环境互不冲突。
4. 每个 module 都有明确 `done_when`、定向 `verification`、最小 `worker_context` 和完整 `worker_profile`。
5. 全部 module 合起来覆盖 `parent_goal`。
6. 来源、格式版本、平台、`dispatch_mode: parallel-plan` 与 `review_mode: diff_self_check` 完整可解析。

所有 batch 宽度为 `1` 时写 `sequential_only` 并保留拓扑证据。范围、依赖、profile、共享契约或验证安全性无法确认时写 `needs_user_review`。两种状态都不得自动交给 coordinator。

## 自动交接

计划写入并复查后，只有 `safety.status: parallel_safe` 才调用 `$thread-coordination`，传入绝对 `plan_path`。不要重复拆 module、创建实现子代理、追加 profile evidence 或转发完整聊天记录。

Codex coordinator 使用实现子代理按 batch 执行；planner 不使用 `create_thread`、`fork_thread`、`send_message_to_thread` 或其他用户可见 task/thread 工具，也不决定补修。

## 输出

最终说明计划绝对路径、格式版本、平台、marker、safety 状态、完整 module profiles、拓扑 batch、自动交接是否发生及未交接原因。自动执行后只以 coordinator 的 `PARALLEL_PLAN_RESULT` 判断父目标状态，不把“计划已生成”写成目标已完成。
