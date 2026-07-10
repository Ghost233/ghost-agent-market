# Codex 子线程协调设计

## 状态

- 设计状态：已确认
- 适用范围：Codex 版 `$parallel-task-planner`、`$thread-coordination`、`$thread-goal-worker`
- 计划版本：`plan_format_version: 2`
- 替代范围：替代旧设计中“Codex module 必须由 implementation subagent 执行”的运行时契约
- 非目标：不修改 Claude Code 的 Agent/agent team 执行模型，不配置模块子线程内部使用的普通子代理

## 背景

旧契约要求 coordinator 在创建 Codex implementation subagent 时原子传入 `model`、`thinking` 和初始 prompt，并以此生成 `worker_profile_evidence.status: applied`。当前 implementation-subagent 接口没有 `model` 和 `thinking` 参数，因此 planner 只能把计划标记为 `needs_user_review`，coordinator 也必然返回 `dispatch_unavailable`。

Codex 用户可见 thread 创建接口能够显式接收 `model` 和 `thinking`。本设计将每个并发 module 改为一个用户可见子线程，使 worker profile、执行身份、结果回收和一次补修都绑定到真实 thread id。

## 目标

1. 主线程只消费 `$parallel-task-planner` 生成且标记为 `parallel_safe` 的 v2 计划。
2. 每个 module 由一个用户可见、与主线程共享当前本地工作区的子线程执行。
3. 创建 module 子线程时原样应用计划中的 worker model 和 reasoning effort。
4. 主线程自动等待、回收、校验结果，并最多向原子线程补修一次。
5. 所有子线程完成后保留在侧边栏，不自动归档。
6. 模块子线程可以自行使用普通子代理，但主线程不配置、不追踪这些内部子代理的 profile。

## 三层执行结构

### 第一层：主线程

主线程是只读 coordinator，职责包括：

- 校验 v2 计划、并发安全性、共享工作区和用户授权。
- 按 `dispatch.batches` 创建 module 子线程。
- 保存 `module_id -> thread_id` 的一对一映射。
- 读取子线程状态和最终结果。
- 对同一子线程最多发起一次聚焦补修。
- 汇总 module 结果并执行只读工程完成度检查。

主线程不修改实现文件、不 stage、不 commit、不 push，也不替失败 module 接管实现。

### 第二层：模块子线程

每个 module 对应一个用户可见 Codex 子线程。子线程：

- 使用当前项目的 `local` 环境，与主线程共享同一本地工作区。
- 创建时显式接收该 module 的 `model` 与 `thinking`。
- 创建时只接收禁止修改的预备包；coordinator 取得真实 thread id 后，才向同一线程发送完整 module 绑定包。
- 加载 `$thread-goal-worker`，校验 Plan Binding，设置本线程 active goal。
- 在 `writable_paths` 内实现、验证、执行 diff 自检并返回 `WORKER_RESULT`。
- 对其内部采用的实现方式和普通子代理负责。

### 第三层：模块子线程的普通子代理

模块子线程可以按 Codex 正常能力自行使用普通子代理。主线程不设置其模型、思考强度或 profile evidence，也不维护其身份映射。

内部子代理必须继承所属 module 的目标和 `writable_paths` 边界，不得创建新的用户可见 thread，不得扩展 module scope。无论内部使用多少子代理，module 的 goal、修改、验证、自检和最终结果都由第二层模块子线程负责。

## v2 计划契约

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
    writable_paths: [<窄路径>]
    depends_on: []
    done_when: [<可观察条件>]
    verification: [<定向检查>]
    worker_context: <最少上下文>
    worker_profile:
      model: gpt-5.6-terra
      reasoning_effort: xhigh
safety:
  status: parallel_safe | sequential_only | needs_user_review
  reasons: [<判定证据>]
dispatch:
  batches:
    - [M1, M2]
```

v1 计划与 v2 的 worker 身份和 profile evidence 语义不同。coordinator 不兼容执行 v1，也不原地升级旧计划；用户必须重新运行 planner 生成 v2 计划。

planner 只校验 profile 字段完整性，不检查 `spawn_agent`、`fork_thread` 或其他普通子代理接口。它们不是 `codex_child_thread` 的运行时；默认 `gpt-5.6-terra/xhigh` 的实际创建验收只由 coordinator 的 `create_thread` 负责，不能因此把并发安全计划降级为 `needs_user_review`。

## 入口门禁

创建任何子线程前按顺序验证：

1. 当前用户请求明确要求使用子线程执行并发计划，或明确调用 `$thread-coordination` 执行该 v2 计划。仅提供计划路径、普通实现请求或后台自动猜测不构成 thread 创建授权。
2. 输入包含绝对、可读的 `plan_path`。
3. `planner`、`plan_format_version`、`execution_platform`、`worker_runtime`、`dispatch_mode` 和 `review_mode` 与 v2 契约严格一致。
4. `safety.status` 严格为 `parallel_safe`，至少两个 module，且至少一个 batch 宽度大于一。
5. module 字段、依赖 DAG、batch 拓扑、写路径和 parent goal 覆盖完整。
6. 每个 `worker_profile` 都包含当前 thread 创建接口可识别的完整 model id 和受支持 reasoning effort。
7. 当前工作区与计划生成时的安全判断仍一致；已有用户改动没有落入待写范围，同 batch 不存在路径或共享产物冲突。
8. 通过 `list_projects` 能唯一解析出当前工作区对应的 Codex project，并可使用 `environment: local`。

任一门禁失败时，不创建子线程，不修复计划，不静默回退到 implementation subagent。

## 子线程创建与 Profile Evidence

每个 ready module 先使用一次 thread 创建调用：

```text
create_thread(
  target={
    type: project,
    projectId: <current-project>,
    environment: {type: local}
  },
  model=<module.worker_profile.model>,
  thinking=<module.worker_profile.reasoning_effort>,
  prompt=<禁止修改并等待绑定的预备包>
)
```

同一 batch 的 ready module 可以并发创建。创建成功后，coordinator 保存真实 thread id，并立即通过 `send_message_to_thread` 向同一 id 发送完整 module、`child_thread` 和 profile evidence。预备包要求子线程在绑定消息到达前不得设置 goal、读取实现文件或修改文件；这避免把未知的 thread id 伪造进首个 prompt。

```yaml
child_thread:
  id: <thread id>
  environment: local
worker_profile_evidence:
  requested:
    model: gpt-5.6-terra
    reasoning_effort: xhigh
  dispatch_arguments:
    model: gpt-5.6-terra
    thinking: xhigh
  status: applied | rejected | unavailable
  evidence: <create_thread 请求摘要与返回的 thread id 或拒绝原因>
```

只有 thread 创建接口接受 model、thinking 和初始 prompt，并返回 thread id，才记录 `applied`。接口拒绝或不可用时不创建替代 worker，不降低 profile，不改用普通子代理。

主线程推荐使用 `gpt-5.6-sol/xhigh`，但 skill 不切换当前主线程，也不把主线程 profile 的不可读性设为永久阻塞条件。

## 分派包

预备包只包含 `dispatch_request_id`、等待绑定指令和禁止修改边界。后续绑定包是每个子线程唯一可执行的 module 包，包含：

- v2 marker、绝对 `plan_path`、`parent_goal`、`module_id`。
- `task`、`writable_paths`、`depends_on`、`done_when`、`verification`、`worker_context`。
- plan-authored `worker_profile`。
- coordinator 追加的 `child_thread` 和 `worker_profile_evidence`。
- `repair_round: 0`、保护边界、`result_contract: WORKER_RESULT`。
- 必须使用 `$thread-goal-worker` 的要求。
- 内部普通子代理必须服从同一 module scope、且不得创建用户可见 thread 的要求。

不得发送其他 module 的写权限、计划全文或完整历史聊天。

## Goal 绑定

active goal 属于模块子线程，不属于主 coordinator。模块子线程在修改前创建并核对与 `module_id`、`parent_goal`、`task`、`writable_paths`、`done_when` 和 `verification` 绑定的 goal。

`goal_set_evidence` 使用结构化结果：

```yaml
goal_set_evidence:
  child_thread_id: <thread id>
  module_id: M1
  repair_round: 0
  action: created | resumed | repair_created
  goal_id: <goal id>
  status: active | complete | blocked
```

主线程通过子线程记录和最终结果核对该证据，但不声称自己能直接管理子线程的 active goal。首次执行完成后由子线程更新 goal；若主线程发起补修，原 goal 可恢复时继续使用，否则在同一子线程创建与相同 module 绑定的 repair goal。

## 结果回收与一次补修

coordinator 使用 `read_thread` 低频、退避式检查当前 batch 的子线程。运行中本身不是失败；当前 batch 所有已创建子线程都进入稳定状态并返回结果后，才处理下一 batch。

只接受与 coordinator 保存的 `module_id -> thread_id` 映射一致的最终 `WORKER_RESULT`。结果缺字段、验证不足、diff 自检失败或 goal/profile evidence 不完整时，通过 `send_message_to_thread` 向原 thread id 发送一次聚焦补修消息，不覆盖该线程的 model 和 thinking。

补修包保持同一 module、scope 和 profile，设置 `repair_round: 1`，只携带具体 finding。补修仍失败时停止该 module；不创建第二个子线程，不由主线程接管。

## Worker 结果契约

```yaml
WORKER_RESULT:
  status: completed | blocked | failed | needs_main_review
  module_id: M1
  dispatch_mode: parallel-plan
  review_mode: diff_self_check
  child_thread:
    id: <thread id>
    environment: local
  goal_set_evidence:
    child_thread_id: <thread id>
    module_id: M1
    repair_round: 0
    action: created
    goal_id: <goal id>
    status: complete
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
    status: applied
    evidence: <create_thread evidence>
  goal_alignment: []
  risks: []
```

worker 不为内部普通子代理返回 profile 或身份清单。内部子代理的使用不能替代 module 子线程自己的 goal、verification 和 diff self-check。

## 失败与冲突处理

- v1、非法 marker 或缺少显式 thread 创建授权：创建前 `blocked`。
- 当前 project 无法唯一解析：不创建任何子线程。
- thread 创建拒绝 model 或 thinking：module `blocked`，不降级。
- 同一 batch 部分创建成功：已创建线程继续执行并回收；失败 module 及其 dependents 阻塞。
- 已有用户改动落入待写范围、同 batch 路径重叠或出现未计划共享产物：停止相关 module，不擅自回滚。
- 子线程修改 `writable_paths` 外文件：`needs_main_review`，不自动撤销共享工作区内容。
- 子线程异常、取消或失联：记录真实状态并阻塞 dependents，不替换线程。
- 用户在执行中向子线程发送新指令：视为计划可能偏离，停止自动放行 dependents 并标记 `needs_main_review`；仅查看线程不影响执行。
- 缺少或不合法的 `WORKER_RESULT`：消耗唯一一次同线程补修机会。
- 普通子代理失败：由模块子线程处理并反映在最终结果中，主线程不直接协调第三层。

## 完成门禁

module 只有同时满足以下条件才能完成：

1. v2 Plan Binding 和 `module_id -> thread_id` 绑定通过。
2. `worker_profile_evidence.status: applied` 且与 thread 创建请求一致。
3. goal evidence 与当前子线程、module 和 repair round 一致。
4. changed files 全部位于 `writable_paths`。
5. `done_when` 满足，verification 通过或有明确替代证据。
6. `diff_self_check.status: pass`。
7. 没有未解决的依赖、共享文件、用户干预或 scope 冲突。

工程最终状态只有 `completed`、`partial`、`blocked`。所有创建过的子线程无论成功失败都保留，不调用自动归档接口。

## 验证要求

1. 三份 Codex `SKILL.md` 和三份 `agents/openai.yaml` 通过 Skill Creator validator。
2. 静态契约确认只接受 v2 和 `worker_runtime: codex_child_thread`。
3. coordinator 明确使用 `list_projects`、`create_thread`、`read_thread` 和 `send_message_to_thread`。
4. module worker 路径中不再保留 implementation-subagent 调度或 per-subagent profile 门禁。
5. 合法 v2 计划能按 batch 生成 `local` thread 创建请求，并原样传递 `gpt-5.6-terra/xhigh`。
6. v1、非法 DAG、路径冲突和缺少 thread 创建授权均在创建前阻塞。
7. thread 创建失败时不降级到普通子代理。
8. 缺失结果只向原 thread id 补修一次。
9. 越界修改和用户中途新指令变为 `needs_main_review`。
10. 内部普通子代理不进入计划、profile evidence 或主线程身份映射。
11. skill 中不存在自动调用 `set_thread_archived` 的执行路径。
12. 更新 plugin manifest 和 marketplace 版本，重新安装后从实际缓存目录复查三份 skill。

## 发布与迁移

- Codex plugin 基础版本递增一个 minor 版本，并生成新的 `+codex.<UTC 时间戳>` cachebuster。
- 旧 v1 计划不迁移、不手改 safety；统一重新运行 `$parallel-task-planner`。
- Claude Code skill 和计划格式保持现状，不随本次 Codex 子线程迁移修改。
- 发布后，使用旧插件缓存的客户端必须更新或重新安装插件，再新建任务加载 v2 skill。
