# Worker 模型配置设计

## 目标

为 `$parallel-task-planner`、`$thread-coordination` 和 `$thread-goal-worker` 增加统一的运行时 profile 契约。默认主协调线程使用 `sol/xhigh`，worker 与其只读审查子代理使用 `terra/xhigh`；用户仍可为并发任务设置默认 worker profile，并按 module 覆盖。规划器解析配置，协调器负责实际调度和证据校验，worker 只确认自己收到的有效配置。

本次是对外可见的新能力，Codex 插件基础版本从 `0.2.0` 升至 `0.3.0`。发布时额外加上 `+codex.<UTC 时间戳>` cachebuster，使已安装客户端在重新安装时明确识别为新构建。

## 配置契约

所有入口使用以下角色默认值：

```yaml
execution_defaults:
  main_thread:
    model: sol
    reasoning_effort: xhigh
  worker:
    model: terra
    reasoning_effort: xhigh
  reviewer_subagent:
    model: terra
    reasoning_effort: xhigh
```

`main_thread` 是 `$thread-coordination` 所在主协调线程的预检 profile；它不会被 skill 在运行中静默切换。只有运行时读取结果与该 profile 一致，主线程才可报告已按默认值运行；不一致时，提示用户在创建/启动该 task 时选择 `sol/xhigh`，或在明确覆盖默认值后继续。

规划器接受一个可选 worker 默认 profile；每个 module 可以覆盖其中任一字段：

```yaml
worker_defaults:
  model: terra
  reasoning_effort: xhigh
modules:
  - id: M1
    task: 为认证模块增加独立单元测试
    worker_profile:
      model: terra
      reasoning_effort: xhigh
```

`model` 必须是用户指定的非空、当前运行时可识别的模型标识；`reasoning_effort` 必须是当前客户端允许的思考强度。当前本地 Codex 配置启用了 `low`、`medium`、`high`、`xhigh` 和 `ultra`，但 skill 不把这个列表写死：协调器必须以实际调度接口/运行时能力为准。

规划器在写计划前合并默认值与 module 覆盖，并在每个 module 中输出完整、不可继承的 `worker_profile`。因此 coordinator 和 worker 不需要重新解释默认值，且每次分派都有确定的模型契约。

```yaml
modules:
  - id: M1
    worker_profile:
      model: terra
      reasoning_effort: xhigh
```

规划器还会在每个修改型 module 中写入完整 `reviewer_subagent_profile`，默认固定为 `terra/xhigh`。普通 worker 分派使用它启动只读审查子代理；既有 `parallel-plan` 的 diff 自检例外不额外创建审查子代理，并在结果中标记该 profile 为 `not_required`。

未提供 `worker_defaults` 时，每个 module 必须显式给出这两个字段；任何缺失、空值或无法解析的 profile 都使计划成为 `needs_user_review`，不能自动分派。

## 职责与数据流

### Parallel Task Planner

规划器从自然语言或既有计划提取默认 profile 与 module 覆盖。它在计划中写入已解析的 `worker_profile`，并将 profile 与现有的 task、可写路径、依赖和验证要求一起交给 coordinator。规划器不创建 worker、不猜测模型名，也不把“推荐模型”写成已实际生效。

### Thread Coordination

coordinator 收到 `parallel_safe` 计划时，先验证自身 `main_thread` profile，再逐 module 读取完整 `worker_profile`。在分派前，它必须通过当前 Codex thread 创建/复用接口验证模型和思考强度可以真正应用：

1. 可复用 thread 的实际 profile 与请求完全一致时，允许复用。
2. 不一致时，只有在用户已授权创建 thread 且接口能带 profile 创建时，才创建匹配的 worker。
3. 接口无法设置或读取任一字段、模型不可用、思考强度不可用，或用户不允许创建匹配 worker 时，module 返回 `blocked` 或 `needs_user_review`。

不得静默降级为默认模型、较低思考强度或只在提示词中声明配置。模型和思考强度是调度参数，不是 worker 可以自行更改的执行指令。

coordinator 将 profile 原样放入 worker 的派发包，并在结果中汇总每个 module 的配置证据：

```yaml
worker_profile:
  requested:
    model: terra
    reasoning_effort: xhigh
  effective:
    model: terra
    reasoning_effort: xhigh
  status: applied | unavailable | mismatch
  evidence: "create_thread 返回 model=terra、reasoning_effort=xhigh"
```

`status: applied` 是完成态的必要条件；`unavailable` 和 `mismatch` 都不能被主线程写成已按 profile 执行。

### Thread Goal Worker

worker 将 `worker_profile` 与 `reviewer_subagent_profile` 当作不可变的派发约束。默认 reviewer profile 为 `terra/xhigh`，且只读审查子代理必须使用该 profile；worker 在设置 `/goal` 前检查两个 profile 字段完整性，并在最终 `WORKER_RESULT` 或 `COORDINATOR_RESULT` 中回报请求 profile、已确认 effective profile、状态和证据。

worker 不自行选择、切换或覆盖模型及思考强度；若运行时无法确认它或只读审查子代理实际使用了所请求的 profile，停止在 `needs_main_review` 或 `blocked`，而不是把普通文本里的模型声明当作成功证据。

## 普通协调与并发计划

该能力既适用于 `$parallel-task-planner` 生成的 `parallel-plan`，也适用于 `$thread-coordination` 的普通 owner-domain 分派：普通分派包增加必需的完整 `worker_profile`。旧调用方若没有 profile，coordinator 先请求用户给出默认值或为每个子目标指定配置，不创建没有可审计模型契约的 worker。

`parallel-plan` 仍保持既有的路径隔离、batch、一次补修和总体完成度检查；模型配置不会改变任何模块的 scope、依赖关系或 worker 自审查要求。

## 错误处理

| 情况 | planner | coordinator | worker |
| --- | --- | --- | --- |
| 缺少模型或思考强度 | `needs_user_review` | 不分派 | `blocked` |
| 主线程不是 `sol/xhigh` | 不适用 | 请求用户重启/覆盖，不伪称默认已生效 | 不执行 |
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
3. 对“主线程 `sol/xhigh` 默认值”“默认 `terra/xhigh` + module 覆盖”“审查子代理 `terra/xhigh`”“缺少 profile”“复用 profile 不匹配”“运行时不支持设置 profile”六类压力场景进行前向测试。
4. Codex `plugin.json` 版本为 `0.3.0+codex.<UTC 时间戳>`，并保持合法 JSON。
