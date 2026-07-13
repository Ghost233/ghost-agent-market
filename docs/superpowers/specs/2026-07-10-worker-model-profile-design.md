# Worker 模型配置设计

> 本文保留早期 profile 设计背景；其中 batch、module 作为执行节点和旧平台调度描述已由 [Task DAG 驱动与线程复用设计](2026-07-11-task-dag-driver-design.md) 取代。当前实现以 v3 task DAG、领域 module 和 `work | review | verify` 为准。

## 目标

为 `$parallel-task-planner`、`$thread-coordination` 和 `$thread-goal-worker` 提供轻量、可执行的并发契约：planner 负责生成版本化计划，coordinator 负责按 batch 调度实现 worker，worker 负责限定 scope、验证和 diff 自检。

`$thread-coordination` 只能消费 `$parallel-task-planner` 生成的计划，不允许跳过规划直接从自然语言拆分和执行。Codex 使用实现子代理，不创建或复用用户可见子 task/thread；Claude Code 使用 Agent/agent team teammate。两端都不再创建额外 reviewer，worker 自己完成 diff 自检。

本次修复将 Codex 插件基础版本更新为 `0.3.1`，发布构建使用单个 `+codex.<UTC 时间戳>` cachebuster。

## 平台默认值

```yaml
execution_defaults:
  codex:
    coordinator:
      model: sol
      runtime_model: gpt-5.6-sol
      reasoning_effort: xhigh
    worker_subagent:
      model: gpt-5.6-terra
      reasoning_effort: xhigh
  claude_code:
    coordinator:
      model: opus
      reasoning_effort: max
    worker_agent:
      model: sonnet
      reasoning_effort: max
```

coordinator profile 是平台默认运行建议，不是无法读取就永久阻塞的运行时门禁。skill 不能静默切换当前主 task/session，也不能把提示词声明伪装成实际 profile evidence。

worker profile 是实际调度参数。planner 接受可选顶层 `worker_defaults` 和 module 级 `worker_profile` 覆盖，module 可以覆盖任一字段；计划必须写出每个 module 解析后的完整值。

Codex worker 默认直接使用 canonical model id `gpt-5.6-terra`，不在计划层使用 `terra` alias。coordinator 将该 model id 原样传给子代理接口，并把 `reasoning_effort` 映射为调度参数 `thinking`。其他用户指定模型同样必须是当前子代理接口可识别的完整 model id，不猜测近似模型。

Claude Code 使用 Agent 工具支持的 `sonnet`/`opus` alias。worker effort 继承或显式设置为 `max`；若平台提供 `CLAUDE_EFFORT` 或等价运行时证据，worker 必须确认它是 `max`。

## 计划契约

```yaml
planner: parallel-task-planner
plan_format_version: 1
execution_platform: codex | claude_code
dispatch_mode: parallel-plan
review_mode: diff_self_check
parent_goal: <一句话结果>
worker_defaults:
  model: gpt-5.6-terra | sonnet | <runtime model id>
  reasoning_effort: xhigh | max | <supported effort>
modules:
  - id: M1
    task: <单一可执行结果>
    writable_paths: [<窄路径>]
    depends_on: []
    done_when: [<可观察条件>]
    verification: [<定向检查>]
    worker_context: <最少上下文>
    worker_profile:
      model: gpt-5.6-terra | sonnet | <runtime model id>
      reasoning_effort: xhigh | max | <supported effort>
safety:
  status: parallel_safe | sequential_only | needs_user_review
  reasons: [<判定证据>]
dispatch:
  batches:
    - [M1, M2]
```

计划不包含 runtime evidence，也不再包含 `reviewer_subagent_profile` 或 `reviewer_profile_preflight`。实现 worker 本身就是 Codex 子代理或 Claude teammate，`worker_profile` 已覆盖需要配置的执行角色。

依赖 DAG 可以进入并发执行。`parallel_safe` 要求依赖拓扑正确，且至少一个 batch 含两个以上可同时执行的 module。只有每个 batch 都只能执行一个 module、因共享写范围无法形成任何并发 batch 时，才标记 `sequential_only`。

## 运行时证据

coordinator 在成功创建实现 worker 后追加独立证据：

```yaml
worker_profile_evidence:
  requested:
    model: gpt-5.6-terra
    reasoning_effort: xhigh
  dispatch_arguments:
    model: gpt-5.6-terra
    thinking: xhigh
  status: applied | unavailable | rejected
  evidence: <coordinator 生成的 dispatch request id 与原子调度结果>
```

coordinator 在调用前生成唯一 dispatch/assignment id，并在同一次原子调用中同时传入完整 module 包、model 和 effort 参数。只有调用接受参数时 worker 才会收到包；返回的 subagent/task id 由 coordinator 在调用完成后单独记录，不是首次分派包或 `worker_profile_evidence` 的前置字段，因此不存在“先取得 id 才能构造首包”的循环依赖。

Claude Code 的 `dispatch_arguments` 保留平台字段名称；例如 Agent `model: sonnet`，effort 使用平台支持的显式参数或继承的 session `max`。只有调度接口接受所请求参数，且 worker 能确认必要 effort 时才写 `applied`。不要求不存在的“读取历史 thread profile”或“读取当前主 task model”接口。

## 平台执行模型

### Codex

coordinator 使用当前平台的 subagent/agent-team 工具为每个 ready module 创建一个实现子代理。禁止用 `create_thread`、`fork_thread`、`send_message_to_thread` 或用户可见 task 代替实现子代理。补修通过同一子代理的 follow-up 机制进行，最多一次。

本 skill 面向能够在一次 implementation-subagent 调用中同时接收 `model`、`thinking` 和初始 prompt 的新版 Codex 子代理接口。接口 schema 缺少任一参数时返回 `dispatch_unavailable` 并提示升级客户端；禁止回退到 thread/task。

Codex worker 子代理在任何文件修改前验证计划绑定和 profile dispatch evidence，然后为自己的单 module 设置并二次确认 active `/goal`。该 goal 只属于当前子代理，不承担跨 thread 所有权管理。

### Claude Code

coordinator 使用 Agent 或 agent team teammate 执行 module。Claude worker 不依赖 Codex `/goal` 能力；它通过 coordinator 分派包、Agent/team task id 和 module id 建立 `assignment_evidence`，并在修改前完成计划绑定。

## Worker 结果契约

两端共用以下核心结构；Codex 返回 `goal_set_evidence`，Claude Code 返回 `assignment_evidence`：

```yaml
WORKER_RESULT:
  status: completed | blocked | failed | needs_main_review
  module_id: M1
  dispatch_mode: parallel-plan
  review_mode: diff_self_check
  goal_set_evidence: <Codex only>
  assignment_evidence: <Claude Code only>
  changed_files: []
  verification: []
  diff_self_check:
    status: pass | failed | not_run
    evidence: []
  worker_profile:
    model: gpt-5.6-terra
    reasoning_effort: xhigh
  worker_profile_evidence:
    requested: {model: gpt-5.6-terra, reasoning_effort: xhigh}
    dispatch_arguments: {model: gpt-5.6-terra, thinking: xhigh}
    status: applied | unavailable | rejected
    evidence: <dispatch evidence>
  goal_alignment: []
  risks: []
```

plan-authored `worker_profile` 与 runtime `worker_profile_evidence` 永远使用不同 key。`diff_self_check` 在 worker、coordinator 和最终汇总中统一使用 `{status, evidence}` mapping。

blocked 结果仍返回完整可获得的 shape；缺失值写 `unavailable`。coordinator 对 blocked 结果只校验 module id、marker、shape 和已分派证据，然后汇总阻塞原因，不进入实现补修或完成门禁。

## 完成门禁

module 只有同时满足以下条件才能完成：

1. 计划来源、版本、平台和 module binding 通过。
2. Codex goal 或 Claude assignment evidence 可复核。
3. changed files 全部位于 `writable_paths`。
4. `done_when` 已满足，verification 通过或有明确替代证据。
5. `diff_self_check.status: pass`。
6. `worker_profile_evidence.status: applied`。
7. 没有未解决的 scope、依赖或共享文件冲突。

## 失败处理

- 缺少 planner 来源或版本：coordinator/worker 在任何实现动作前 `blocked`。
- worker profile 为空或不受调度接口支持：planner `needs_user_review`，coordinator 不分派。
- 子代理/Agent 调度拒绝 model 或 effort：module `blocked`，不静默降级。
- 当前主 coordinator profile 无法读取：记录 `unavailable`，但不把不可读本身作为永久阻塞；用户仍应按平台默认值启动 coordinator。
- 计划只有串行链：保存为 `sequential_only`，不交给 coordinator。
- 有拓扑依赖但存在并行 batch：保持 `parallel_safe`，严格按 batch 顺序执行。

## 验证要求

实施后必须验证：

1. 六份 `SKILL.md` 和 metadata 均通过 Skill Creator validator。
2. Codex 默认 `gpt-5.6-terra/xhigh` 能原样映射到 `model: gpt-5.6-terra` + `thinking: xhigh` 的子代理分派参数。
3. Codex coordinator 明确拒绝 thread/task 工具作为实现 worker。
4. Claude worker 不再要求 `/goal`，并能用 assignment evidence 通过输入门禁。
5. worker 与 coordinator 的 `diff_self_check` shape 完全一致。
6. 不存在 reviewer dead branch 或 reviewer profile/preflight 残留。
7. 含依赖且至少一个 batch 可并发的 DAG 为 `parallel_safe`；纯串行 DAG 为 `sequential_only`。
8. 缺少 planner 来源、profile 不受支持和调度拒绝时都在实现前阻塞。
9. plugin version 为 `0.3.2+codex.<UTC 时间戳>`，manifest 合法。
