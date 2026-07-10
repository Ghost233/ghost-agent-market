# Worker 模型配置设计

## 目标

为 `$parallel-task-planner`、`$thread-coordination` 和 `$thread-goal-worker` 增加统一的运行时 profile 契约。`$thread-coordination` 只能消费 `$parallel-task-planner` 生成的版本化计划，不能跳过规划直接按自然语言或手工分派 worker。规划器解析配置，协调器负责实际调度和证据校验，worker 只确认自己收到的有效配置。

本次是对外可见的新能力，Codex 插件基础版本从 `0.2.0` 升至 `0.3.0`。发布时额外加上 `+codex.<UTC 时间戳>` cachebuster，使已安装客户端在重新安装时明确识别为新构建。

## 配置契约

所有入口按平台使用以下角色默认值：

```yaml
execution_defaults:
  codex:
    main_thread:
      model: sol
      reasoning_effort: xhigh
    worker:
      model: terra
      reasoning_effort: xhigh
    reviewer_subagent:
      model: terra
      reasoning_effort: xhigh
  claude_code:
    main_thread:
      model: opus
      reasoning_effort: max
    worker:
      model: sonnet
      reasoning_effort: max
    reviewer_subagent:
      model: sonnet
      reasoning_effort: max
```

`main_thread` 是 `$thread-coordination` 所在主协调线程的固定预检 profile，不支持用户或计划覆盖，也不会被 skill 在运行中静默切换。Codex 必须确认 `sol/xhigh`，Claude Code 必须确认 `opus/max`；不可读、不支持或不一致时 coordinator 必须停止，并要求用户用固定 profile 重启或重建协调 task，不能在当前 task 内继续。

规划器接受一个可选 worker 默认 profile；每个 module 可以覆盖其中任一字段。Codex 的默认值为 `terra/xhigh`，Claude Code 的默认值为 `sonnet/max`：

```yaml
worker_defaults:
  model: sonnet
  reasoning_effort: max
modules:
  - id: M1
    task: 为认证模块增加独立单元测试
    worker_profile:
      model: sonnet
      reasoning_effort: max
```

`model` 必须是用户指定的非空、当前运行时可识别的模型标识；`reasoning_effort` 必须是当前客户端允许的思考强度。当前本地 Codex 配置启用了 `low`、`medium`、`high`、`xhigh` 和 `ultra`，但 skill 不把这个列表写死：协调器必须以实际调度接口/运行时能力为准。

规划器在写计划前合并默认值与 module 覆盖，并在每个 module 中输出完整、不可继承的 `worker_profile`。因此 coordinator 和 worker 不需要重新解释默认值，且每次分派都有确定的模型契约。

```yaml
modules:
  - id: M1
    worker_profile:
      model: sonnet
      reasoning_effort: max
```

规划器在每份计划顶层写入以下来源与版本字段，并在每个修改型 module 中写入完整 `reviewer_subagent_profile`：

```yaml
planner: parallel-task-planner
plan_format_version: 1
execution_platform: codex | claude_code
dispatch_mode: parallel-plan
review_mode: diff_self_check
```

Codex 的 reviewer 默认固定为 `terra/xhigh`，Claude Code 的 reviewer 默认固定为 `sonnet/max`。普通 worker 分派使用它启动只读审查子代理；只有 `dispatch_mode: parallel-plan` 与 `review_mode: diff_self_check` 两个结构化 marker 同时匹配时才启用 diff 自检例外，不额外创建审查子代理，并在 reviewer profile 和 preflight 结果中标记 `not_required`。

未提供 `worker_defaults` 时，每个 module 必须显式给出这两个字段；任何缺失、空值或无法解析的 profile 都使计划成为 `needs_user_review`，不能自动分派。

## 职责与数据流

### Parallel Task Planner

规划器从自然语言或既有计划提取默认 profile 与 module 覆盖。它在计划中写入已解析的 plan-authored `worker_profile: {model, reasoning_effort}`、固定 reviewer profile、`dispatch_mode: parallel-plan` 和 `review_mode: diff_self_check`，并将这些字段与 task、可写路径、依赖和验证要求一起交给 coordinator。规划器不创建 worker、不猜测模型名，也不把“推荐模型”写成已实际生效。

### Thread Coordination

coordinator 的唯一执行入口是一个绝对 `plan_path`，且文件必须由 `$parallel-task-planner` 生成，包含 `planner: parallel-task-planner`、`plan_format_version: 1`、`execution_platform`、`dispatch_mode: parallel-plan`、`review_mode: diff_self_check`、`parent_goal`、完整 modules、`dispatch.batches` 和 `safety.status: parallel_safe`。任一字段缺失、版本不支持、marker 不匹配、计划状态不安全或用户只给自然语言/手工 worker 包时，一律返回 `blocked`，不做 owner-domain 拆解、不补全计划、不创建或复用 worker。

计划是轻量 schema，不能密码学证明其作者；`planner` 与 `plan_format_version` 只能证明其格式声明。因此 coordinator 必须同时验证全部字段、路径冲突、依赖、profile 完整性和当前工作区安全证据，不能仅因字段存在就跳过门禁。

接收通过后，coordinator 先验证自身 `main_thread` profile，再逐 module 读取完整 `worker_profile`。在分派前，它必须通过当前平台的 thread 创建/复用接口验证模型和思考强度可以真正应用：

1. 可复用 thread 的实际 profile 与请求完全一致时，允许复用。
2. 不一致时，只有在用户已授权创建 thread 且接口能带 profile 创建时，才创建匹配的 worker。
3. 接口无法设置或读取任一字段、模型不可用、思考强度不可用，或用户不允许创建匹配 worker 时，module 返回 `blocked` 或 `needs_user_review`。

不得静默降级为默认模型、较低思考强度或只在提示词中声明配置。模型和思考强度是调度参数，不是 worker 可以自行更改的执行指令。

coordinator 把 plan-authored `worker_profile` 与两个结构化 marker 原样放入 worker 的派发包，并用独立字段携带每个 module 的运行时配置证据。计划值与 runtime evidence 不得共用同一个 key：

```yaml
worker_profile:
  model: sonnet
  reasoning_effort: max
worker_profile_evidence:
  requested:
    model: sonnet
    reasoning_effort: max
  effective:
    model: sonnet
    reasoning_effort: max
  status: applied | unavailable | mismatch
  evidence: "create_thread 返回 model=sonnet、reasoning_effort=max"
```

`worker_profile_evidence.status: applied` 是完成态的必要条件；`unavailable` 和 `mismatch` 都不能被主线程写成已按 profile 执行。worker 的 Plan Binding 只把 plan-authored `worker_profile` 与计划原文比较；`worker_profile_evidence` 和 `reviewer_profile_preflight` 只验证 runtime shape 以及是否与 coordinator 分派证据一致。

`reviewer_profile_preflight` 的 `requested` 与 `effective` 始终使用 `{model, reasoning_effort}` mapping。`ready`/`applied` 时，`requested` 必须等于计划中的固定 `reviewer_subagent_profile`，且 `effective == requested`。合法 `not_required` 时，`requested` 仍是平台固定 reviewer profile，`effective` 必须是 `{model: not_required, reasoning_effort: not_required}`，并记录 `parallel-plan diff_self_check exception`。

### Thread Goal Worker

worker 仅接受含有 `planner: parallel-task-planner`、受支持 `plan_format_version`、`dispatch_mode: parallel-plan`、`review_mode: diff_self_check` 和单个 `module_id` 的 coordinator 派发包；缺少该来源链的普通任务返回 `blocked`，不自行执行。worker 将 plan-authored `worker_profile` 与 `reviewer_subagent_profile` 当作不可变的派发约束，在设置 `/goal` 前严格验证 marker、runtime `worker_profile_evidence` 和 `reviewer_profile_preflight`。Codex reviewer 固定是 `terra/xhigh`，Claude Code reviewer 固定是 `sonnet/max`。

worker 不自行选择、切换或覆盖模型及思考强度；若运行时无法确认它或只读审查子代理实际使用了所请求的 profile，停止在 `needs_main_review` 或 `blocked`，而不是把普通文本里的模型声明当作成功证据。无论 `WORKER_RESULT` 是 completed、blocked、failed 还是 needs_main_review，都必须返回 plan-authored `worker_profile`、独立 `worker_profile_evidence` 和 mapping-shaped `reviewer_profile_preflight`。coordinator 对所有状态先校验 shape 与分派证据；blocked 结果一致时汇总 worker 原因，不一致时汇总 schema/evidence mismatch。两者都不进入一次补修或完成态 profile 门禁。

## 只允许计划协调

`$thread-coordination` 不再提供普通 owner-domain 分派入口。用户想要并发执行时，必须先调用 `$parallel-task-planner`：它生成、写入并复查计划；只有 `parallel_safe` 计划才会自动交给 coordinator。`sequential_only` 与 `needs_user_review` 计划只可返回给用户修订，coordinator 不能接管并自行串行或手工补全。

通过的 `parallel-plan` 仍保持既有的路径隔离、batch、一次补修和总体完成度检查；模型配置不会改变任何模块的 scope、依赖关系或 worker 自审查要求。这个顺序没有旁路：`需求/既有计划 -> planner 写入版本化计划 -> coordinator 验证计划 -> worker 执行单 module -> coordinator 总验收`。

## 错误处理

| 情况 | planner | coordinator | worker |
| --- | --- | --- | --- |
| 缺少模型或思考强度 | `needs_user_review` | 不分派 | `blocked` |
| 不是 planner 计划或格式版本不支持 | 写入/提示可修订计划 | `blocked`，不绕过 planner | `blocked` |
| 主线程 profile 不匹配固定值 | 不适用 | 请求用户用固定 profile 重启/重建 task，不允许覆盖后继续 | 不执行 |
| profile 不能由运行时识别 | 保留原因 | `blocked` | `needs_main_review` |
| 复用 thread 的 profile 不匹配 | 不适用 | 新建匹配 worker 或停止 | 不执行 |
| 调度接口无法应用 worker 或 reviewer profile | 不假定成功 | `blocked` | 不伪称 applied |

不会自动选择替代模型，也不会把思考强度降级。这让用户可以把模型成本、能力和任务风险作为明确调度决策，而不是隐式行为。

## 同步与验证

以下三份 skill 必须在 Claude Code 与 Codex 两端保持相同的通用契约；只允许保留 thread 创建/复用工具的既有平台差异：

- `parallel-task-planner`
- `thread-coordination`
- `thread-goal-worker`

实施后验证：

1. 六份 `SKILL.md` 都能描述同名字段、解析规则、不可静默降级和结果证据。
2. Skill Creator 的 `quick_validate.py` 验证六个 skill 目录均通过。
3. 对“缺少 planner 来源/版本字段被拒绝”“主线程 Codex `sol/xhigh` 默认值”“主线程 Claude Code `opus/max` 默认值”“Codex 默认 `terra/xhigh` + module 覆盖”“Claude Code 默认 `sonnet/max` + module 覆盖”“两个平台的审查子代理默认值”“复用 profile 不匹配”“运行时不支持设置 profile”八类压力场景进行前向测试。
4. Codex `plugin.json` 版本为 `0.3.0+codex.<UTC 时间戳>`，并保持合法 JSON。
