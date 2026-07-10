---
name: parallel-task-planner
description: |
  将自然语言需求或已有计划文档转换为带来源版本和完整 worker/reviewer profiles 的可执行并发模块计划，
  并在安全门禁通过后自动调用 `thread-coordination` 的 `parallel-plan` 模式。用户要求拆分已知可并发任务、
  从 plan 提取执行模块、判断并发安全性或生成并立即执行并发计划时使用；无法证明安全时只交付计划。
---

# Parallel Task Planner

## 目标

把一个已经具备可执行信息的需求或计划文档，整理为短小、可审计的并发模块计划。规划器只负责输入归一化、最少量的冲突检查、计划写入和安全分派；不维护长期模块归属，也不替 coordinator 或 worker 实现业务改动。

## 输入与最少检查

接受以下任一种输入：

- 自然语言：目标、已知范围、完成条件、约束或验证偏好。
- 计划文档路径：保留其中已经确定的决策，只将可执行工作提取为模块。

同时确认 `execution_platform`，并读取可选的顶层 `worker_defaults` 与 module 级 `worker_profile` 覆盖。Claude Code 计划的 `execution_platform` 必须是 `claude_code`；未显式覆盖时，worker 默认使用 `sonnet/max`，reviewer subagent 固定使用 `sonnet/max`。

只读取确认目标文件、可写范围、依赖、profile 和验证冲突所需的最少仓库内容。不要为了制造并发而扩张需求、猜测隐式接口或猜测模型标识；无法确认时保留证据并输出 `needs_user_review`。

## 并发计划契约

每次规划都写入：

```text
docs/parallel-task-plans/YYYY-MM-DD-<goal-slug>.md
```

计划必须使用以下字段：

```yaml
planner: parallel-task-planner
plan_format_version: 1
execution_platform: claude_code
parent_goal: <一句话结果>
source: natural_language | <计划文档路径>
worker_defaults:
  model: sonnet
  reasoning_effort: max
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
    worker_context: <执行所需的最少上下文>
    worker_profile:
      model: sonnet
      reasoning_effort: max
    reviewer_subagent_profile:
      model: sonnet
      reasoning_effort: max
    reviewer_profile_preflight: {requested: sonnet/max, effective: sonnet/max, status: ready, evidence: <preflight>}
safety:
  status: parallel_safe | sequential_only | needs_user_review
  reasons:
    - <判定证据>
dispatch:
  batches:
    - [M1, M2]
```

为每个 module 分配唯一 `id`；`depends_on` 只能引用同一计划中已存在的 id。分派时将 `id` 映射为 worker 输入的 `module_id`。所有 module 必须可追溯到 `parent_goal` 的完成条件；`worker_context` 只携带实现所需的约束、保护范围和来源证据。

`writable_paths` 不得使用无法判断冲突的宽泛范围。把相同路径、父子路径、相交 glob、共享 API、迁移、生成输出和全局配置视为冲突；将冲突写入同一模块，或标记为不可自动并发。

## Profile 解析

写入计划前按以下顺序解析 profile：

1. 从平台默认 `worker_defaults: sonnet/max` 开始；顶层覆盖和 module 覆盖均可单独覆盖 `model` 或 `reasoning_effort`，计划顶层始终写出解析后的完整 `worker_defaults`。
2. 对每个 module，将其 `worker_profile` 覆盖合并到解析后的 `worker_defaults`，再写出包含两个字段的完整值；module 不得依赖 coordinator 继续继承默认值。
3. 为每个 module 写出完整的 `reviewer_subagent_profile: sonnet/max`；它不跟随 worker 覆盖，显式替换或不完整 reviewer profile 同样需要 `needs_user_review`。
4. `model` 与 `reasoning_effort` 都必须是非空、当前运行时可识别的值。显式空值、无法解析的值、平台不匹配或解析后缺少任一字段时，将 `safety.status` 写为 `needs_user_review` 并说明具体字段。

用户显式给出的不可用 profile 是约束错误，不能用平台默认值、近似模型或较低 reasoning effort 静默替换。计划中的 profile 只是请求约束，不是运行时已经应用的证据；不要把推荐值或提示词中的声明写成已生效配置。

## 安全门禁

只有以下条件全部成立时，`safety.status` 才可写为 `parallel_safe`：

1. 至少存在两个可执行模块。
2. 同一 batch 中的 `writable_paths` 不存在精确、父子或 glob 相交，且不存在未归属的共享契约。
3. 依赖图无环，batch 中每个模块的依赖均已完成。
4. 每个模块都有明确 `done_when` 和定向 `verification`。
5. 并行验证不会竞争同一可写产物或共享环境；会竞争的验证必须串行。
6. 全部模块合起来覆盖父目标的完成条件。
7. 来源、格式版本、执行平台以及每个 module 的两个 profile 均完整且可解析。

存在明确依赖但没有不确定性时，写 `sequential_only` 并保存计划，不自动并发。范围、依赖或共享契约有证据不足时，写 `needs_user_review`，说明缺少何种确认；绝不自动降级为“看起来能并发”。

## 自动交接

只有 `safety.status: parallel_safe` 的版本化计划在写入并复查后才立即调用 `$thread-coordination`，传入计划绝对路径、`parallel-plan` 模式和 `parent_goal`。不要重复拆解模块，也不要转发完整聊天记录。

在 Claude Code 中，coordinator 使用 agent team 的稳定队员 name 执行每个 ready module；规划器只提供 module 契约和 batch 顺序。它不直接创建 worker、修改实现文件、验证业务结果或替 coordinator 决定补修。

`sequential_only` 与 `needs_user_review` 只返回计划和判定证据，不调用 coordinator。用户修改计划后可重新运行本 skill。

## 输出

最终回复必须说明：计划路径、格式版本、执行平台、`safety.status`、模块及其完整 profiles、batch、自动分派是否发生、未分派原因和仍需用户确认的事项。自动分派后以 coordinator 返回的 `PARALLEL_PLAN_RESULT` 判断父目标状态；不得把“计划已生成”表述为父目标已经完成。

## 非目标
每个 module 必须具备 reviewer_profile_preflight；普通 module 为 ready/applied，parallel-plan diff_self_check 例外为 not_required 并说明证据。

- 不维护长期 ownership registry 或 thread 亲和性。
- 不通过猜测把串行工作拆成并发工作。
- 不要求每个模块都运行全项目构建。
- 不替 worker 修改代码，也不接管 coordinator 的总验收。
