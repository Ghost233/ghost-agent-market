---
name: parallel-task-planner
description: Use when Codex must turn a natural-language request or an existing plan into a versioned, dependency-safe Codex parallel plan for user-visible module threads, or must decide that the work is unsafe or sequential.
---

# Parallel Task Planner

## 目标

把需求或已有计划整理为短小、可审计的 Codex v2 并发计划。planner 只负责 scope、依赖、写路径、worker profile、拓扑 batch 和安全判定；不创建模块子线程、不追加 runtime evidence，也不修改业务代码。

## 输入与输出

接受自然语言目标或绝对计划文档路径。只读取确认 module、依赖、可写范围、profile 和验证冲突所需的最少仓库内容。

每次规划写入：

```text
docs/parallel-task-plans/YYYY-MM-DD-<goal-slug>.md
```

计划必须使用下列 marker：

```yaml
planner: parallel-task-planner
plan_format_version: 2
execution_platform: codex
worker_runtime: codex_child_thread
dispatch_mode: parallel-plan
review_mode: diff_self_check
parent_goal: <一句话结果>
source: natural_language | <绝对计划来源>
worker_defaults:
  model: gpt-5.6-terra
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
    worker_context: <最少实现上下文>
    worker_profile:
      model: gpt-5.6-terra
      reasoning_effort: xhigh
safety:
  status: parallel_safe | sequential_only | needs_user_review
  reasons:
    - <判定证据>
dispatch:
  batches:
    - [M1, M2]
```

只写 plan-authored `worker_profile`。计划不得包含 `child_thread`、`worker_profile_evidence`、thread id 或任何 runtime profile/readback 字段。

## Profile 解析

1. 默认使用 `gpt-5.6-terra/xhigh`。顶层 `worker_defaults` 和 module `worker_profile` 可以分别覆盖 model 或 effort。
2. 为每个 module 写出解析后的完整 `worker_profile`；不保留继承缺口。
3. 默认 `gpt-5.6-terra/xhigh` 始终是有效的 plan-authored profile。自定义 profile 也只要求 `model` 和 `reasoning_effort` 非空、完整且不使用猜测 alias；字段不完整时才写 `needs_user_review`。
4. 不得检查 `spawn_agent`、`fork_thread` 或其他普通子代理接口。这些接口不创建 `codex_child_thread`，其参数缺失不能作为 profile、安全或并发门禁证据。
5. profile 的实际应用只由 `$thread-coordination` 通过 `create_thread` 负责。规划阶段不得因为运行时 thread 创建能力不可读、普通子代理参数不足或 profile evidence 尚不存在而写 `needs_user_review`。
6. 不把计划中的请求值、提示词或默认值写成已应用的 runtime evidence；不选择近似模型或降低 reasoning effort。

上述接口分离只适用于 Codex module：普通子代理接口不参与子线程计划判定。

## 依赖与安全门禁

- 每个 module 使用唯一 id，`depends_on` 只引用本计划 module，图必须无环。
- 按拓扑层生成 `dispatch.batches`，每个 id 恰好出现一次，依赖必须位于更早 batch。
- 同 batch 的 `writable_paths`、共享契约、验证产物、迁移、生成输出和环境不得冲突。精确路径、父子路径和相交 glob 都视为冲突。
- 至少一个 batch 宽度大于一，且每个 module 都有 `done_when`、`verification`、`worker_context`、完整 profile，并共同覆盖 `parent_goal` 时，才写 `parallel_safe`。
- 所有 batch 宽度都是一时写 `sequential_only`。范围、依赖、profile 字段完整性、共享契约或验证安全性不足时写 `needs_user_review`；普通子代理接口的能力不属于这些门禁。

## 交接

只在用户当前请求明确要求创建子线程并执行、且 `safety.status: parallel_safe` 时，调用 `$thread-coordination` 并传入绝对 `plan_path`。否则只返回计划路径和安全结论。

v1 计划与 v2 的 worker 身份和证据语义不兼容。不要手改旧计划或 safety；重新生成 v2 计划。

## 输出

返回绝对计划路径、格式版本、`worker_runtime`、safety 状态、完整 module profiles、拓扑 batch，以及是否已获得显式子线程执行授权。不要把“计划已生成”写成父目标已完成。
