---
name: parallel-task-planner
description: 仅当用户已完成当前任务说明，明确要求对该任务进行 DAG 或并行规划，并且明确且唯一选择执行线程或子代理模式时使用；任务只需有可识别的规划对象，不要求用户预先给出验收标准。背景说明、尚未说完或准备继续补充的需求、普通实施、审查或讨论请求不得触发；同一 parent_goal 的后继 v3 计划修订除外。
---

# 任务 DAG 规划

## 职责

初次规划必须同时满足：当前上下文中有可识别的任务对象；用户已经收口这段任务说明并明确要求现在开始 DAG 或并行规划；用户明确且唯一选择执行线程或子代理模式。任务不必预先包含验收标准，规划器可以根据任务意图补充 task 级完成条件和父目标验证方式。

不得因为任务复杂、适合并行或看起来已经完整而推断规划授权。背景介绍、半段需求、明确表示稍后继续补充的内容，以及普通实施、修复、审查、讨论请求都按普通流程处理，不生成 plan，也不追问执行方式。只有用户已经明确要求规划但规划对象或执行方式仍不明确时，才合并成一次简短询问；“都可以”“你决定”或未指定均不构成唯一选择。

满足初次门禁后，每个新的规划对象形成新的 `parent_goal`。单节点、纯串行、并行和混合拓扑都合理，不得因为任务简单或只能串行而拒绝规划。已绑定的 DAG task 只由当前执行方式对应的 goal worker 执行，不得再次拆成新的父目标。

`module` 是当前 `parent_goal` 内稳定的领域职责；`task` 是一次性 DAG 节点，只通过 `module_id` 选择负责人。执行归属为当前父目标内的 `(module_id, thread_role)`：首次派发创建执行单元，后续 task 和 revision 复用；不同 `parent_goal` 之间绝不复用。

初始计划确定 module 后，其 `id`、`worker_profile` 和 `worker_context` 在当前父目标内固定。需要不同职责或执行配置时定义新 module，不修改已有 module。计划不包含执行单元路由；驱动器在 `next` 时按当前父目标内的 `(module_id, thread_role)` 归属计算 `action.thread_id`。

本 skill 只规划，不创建执行单元、不修改业务文件。规划授权不等于执行授权：只有用户同时明确要求执行时，初始计划展示后才交给已选协调器；用户要求只规划时展示后停止。同一 `parent_goal` 的后继 revision 继承已有规划授权、执行授权和已锁定的执行方式，不重复询问。

## 输出

在项目中创建：

```text
.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json
```

写入前读取 [references/templates.md](references/templates.md)。计划文件只写 JSON；执行模式和 Mermaid 只在会话中展示。

Claude Code 默认 module 配置为 `sonnet/max`。用户可以为初始 module 指定完整 `model` 与 `reasoning_effort`；不猜测别名，不自动降级。

## 执行方式

同一份 plan 可以选择两种执行方式，选择不写入 plan：

- 用户明确选择执行线程模式时，交给 `$thread-coordination`，task 由 `$thread-goal-worker` 执行。
- 用户明确选择子代理模式时，交给 `$subagent-coordination`，task 由 `$subagent-goal-worker` 执行。
- 用户未明确且唯一选择时不得生成初始 plan，也不得采用默认值或代为决定。

执行开始后由 driver 锁定 `executor_mode`，同一 `parent_goal` 不得中途混用或切换。子代理模式仍使用相同 plan，但不消费 module 的 `worker_profile`。

## 规划流程

1. 确认用户已收口当前任务说明，将可识别的规划对象归纳为 `parent_goal`，并根据任务意图补充父目标总验证方式；不得要求用户预先写好验收标准。
2. 按稳定领域职责定义 module。不得使用 `implementation`、`review`、`verification`、`compile` 等阶段名，也不得为每个 task 复制近义 module。`worker_context` 只写领域边界和长期不变量。
3. 按可独立验收的结果拆分 task。不得为制造并行度拆开真实串行职责，也不得合并本可独立验收的结果。每项都写明 `logical_id`、中文用户可见 `title`、`thread_role`、`writable_paths`、`done_when` 和 `verification`；`logical_id` 与 `module_id` 只作内部标识。
4. `work` 负责正式修改且 `writable_paths` 非空，必须完成当前 task 的定向验证与差异自检，并以此默认闭环。不得为重复自检生成独立 `review`。
5. `review` 只在跨 module 契约、安全边界、数据迁移、并发语义、破坏性行为或 work 无法自证的关键语义等风险触发条件下创建；它按风险边界聚合，不是每个 `work` 各建一个。`verify` 只承担 work 定向验证未覆盖的集成、全量 build、test 或 lint，不得重复 work verification，以保证验证不重复。两者都只读，`writable_paths` 必须为 `[]`，不得产生 tracked diff。
6. 检查任务闭包：task 引用的测试、门禁或配置如果需要修改，必须位于某个 `work` task 的 `writable_paths`，并由当前 task 自己负责，或由它明确依赖且先完成的前置 task 负责。否则不得生成依赖该检查的 `review` 或 `verify` task。
7. 用 `depends_on` 表达真实依赖。同一 revision 中相同 `module_id + thread_role` 的 task 必须在 DAG 中可比；不同归属且写域、共享契约、生成产物和运行环境不冲突的 ready task 保持不可比并立即并行。同时需要 `review` 与 `verify` 时，默认让二者直接依赖相关 work，成为互不依赖的并列节点；只有真实的数据或产物依赖才允许串行化。
8. `project_verification` 只汇总父目标覆盖和 task 证据。需要实际运行且未被 work verification 覆盖的正式检查才生成 `verify` task；不得把缺少独立审查当作计划缺口，也不得补造 `review`。
9. 至少两个不可比 task 时使用 `parallel_safe`；单节点或纯串行图使用 `sequential_only`；只有真实用户边界使用 `needs_user_review`。前两者都可执行，不能为了通过门禁伪造并行任务。

## 当前任务内修订

只有当前 plan 没有 `running` task 时才修订：

1. 读取直接前版 plan、state、完整 task result 和当前差异。
2. 一次聚合当前静止点的全部范围变化、审查阻断缺陷、验证失败和总验收缺口；`review` 的非阻断建议随 `completed` 保留为证据，不触发 revision。
3. 已完成 task 不重跑；把尚未闭环的事实重新整理为一个后继 DAG。
4. 新计划只用 `continuation.previous_plan_path` 指向直接前版；保持同一 `parent_goal`，`revision` 增加 1。
5. 完整保留前版全部 module 定义，可按需增加新 module。执行单元复用不写入计划，也不由 task id 或 `logical_id` 决定。
6. 后继计划校验成功后，直接前版只保留为结果证据，不再执行；协调器从后继 revision 继续。

内部拆分、依赖重接和同父目标修订不询问用户。只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部副作用、权限升级或无法安全消歧时，才使用 `needs_user_review`。

## 校验与展示

定位当前插件根目录并运行：

```text
node <plugin-root>/scripts/thread-plan.mjs validate <absolute-plan.json>
node <plugin-root>/scripts/thread-plan.mjs render <absolute-plan.json>
```

`validate` 只校验计划和初始化 state，不生成执行单元路由。校验失败时保留原始错误并修正候选计划。`render` 成功后，按模板提示执行模式，并把标准输出原样放入 `mermaid` fenced code block。每个 revision 正常展示一次；Mermaid 不是机器输入。

## 交接

- `parallel_safe`：展示后，只有已有明确执行授权时才调用或恢复已选定的 coordination skill；只规划时停止。
- `sequential_only`：明确提示当前 DAG 将串行推进但不会因此阻塞；已有明确执行授权时调用或恢复已选定的 coordination skill，只规划时停止。
- `needs_user_review`：展示具体用户边界后暂停。

同一 `parent_goal` 的内部 revision 沿用既有执行授权和锁定模式，可展示后自动继续。计划生成不代表已开始执行或父目标完成。
