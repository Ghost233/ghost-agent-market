---
name: thread-coordination
description: 当用户已授权执行通过校验的 v3 任务 DAG，需要由 Codex 主线程协调可见子线程、复用既有线程，并一次性完成同一父目标时使用。
---

# 任务协调

## 职责与边界

主线程作为只读协调器，消费驱动脚本返回的动作，安排子线程实现任务，并持续推进到 `parent_goal` 完成。协调器不修改业务文件，不暂存、提交或推送代码。

用户授权的是完整父目标，不是某一版计划的冻结写域。安全的内部修订、任务重分配和线程复用由主线程完成，不要求用户逐次批准。所有创建过的子线程保留，不自动归档。

创建线程、发送绑定包、验收子线程结果或返回最终结构化结果前，必须读取 [references/templates.md](references/templates.md)。

所有会影响父目标验收的正式实施、审查、验证、诊断和职责变化都必须是 DAG task；同一 task 的一次聚焦补修仍属于原职责。协调器不得临时创建计划外执行。线程内部辅助过程不形成独立正式证据，由当前 task 的执行线程统一汇总进唯一结果。

## 入口门禁

执行前逐项确认：

1. 用户已明确授权执行当前 `parent_goal`；同一父目标的安全修正版继承该授权。
2. `plan_path` 是当前项目 `.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json` 的绝对路径。
3. 计划使用 `planner: parallel-task-planner`、`plan_format_version: 3` 和 `execution_platform: codex`。首次计划必须为 `parallel_safe`；带前版计划、状态和执行证据的修正版可为 `parallel_safe` 或 `sequential_only`。
4. 同目录 `state.json` 可读，且 `validate` 成功：

```text
node <plugin-root>/scripts/thread-plan.mjs validate <plan_path>
```

5. 无法归因的用户改动不落入未执行任务的 `writable_paths`；能够由线程、任务和 changed files 证据归因的本轮改动视为受控基线。
6. 用 `list_projects` 唯一解析当前目录，并固定使用 `environment: {type: local}`。

首次计划门禁失败时不执行、不私自修复，按模板返回原始证据。修正版仅有计划结构或 safety 标注错误时，调用 `$parallel-task-planner` 重新生成唯一 revision 并再校验一次，不升级为用户确认。

`validate` 只进行模型配置语法校验，并输出 `profile_validation: syntax_only`。实际 `model` 与 `reasoning_effort` 是否可用，以 `create_thread` 的真实结果为准；不根据工具说明猜测，不自动降级。

## 执行循环

每次进入或恢复本 skill，先读取当前 plan 和 state。终态 task 缺少内嵌 `result` 时，只能通过其 `thread_id` 使用 `read_thread(includeOutputs: true)` 回收原始结果并补写规范 `result_path`，不得根据聊天摘要臆造。仍有 `running` 时先回收；上下文中断本身不构成用户边界。

1. 运行：

```text
node <plugin-root>/scripts/thread-plan.mjs next <plan_path> <state_path>
```

2. 立即处理本次返回的全部 actions；不能因为其他任务仍在运行而延后已就绪任务。
3. 取得真实线程 id 后，先使用 action 的 `expected_title` 设置待命标题，再持久化归属：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> running <thread_id>
```

4. 保存 running update 返回的 `expected_title`；发送模板中的完整绑定包，成功后用该标题更新为 `[执行]`。
5. 用 `read_thread(includeOutputs: true)` 低频读取线程，或检查 action 指定的 `result_path`。运行中不是失败；没有新结果时不发送追问、进度播报或确认消息。
6. 结果文件必须是线程原子写入的完整 `WORKER_RESULT_V3`，且线程消息返回语义相同的 JSON。文件是恢复与持久化的规范来源；driver 校验身份字段后把结果内嵌到 `state.tasks.<task_id>.result`。用结果文件更新终止状态：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> completed|blocked|failed|needs_main_review <result_path>
```

7. 每次状态变化后立即回到第 1 步，直到进入修订流程或完成总验收。

## 分派动作

### `create_thread`

从 action 的 `module_id` 读取 `worker_profile` 和 `worker_context`，以 `<plan_path>#<task_id>` 作为 `dispatch_key`。action 必须带有计划已校验的 `thread_role`、`expected_title` 和唯一 `result_path`，协调器不得根据任务文本猜测用途。

每个 `create_thread` action 真正创建前，先调用 `list_threads(query=<dispatch_key>)`。唯一匹配时恢复其线程 id，直接更新 `running` 后发送绑定包；零匹配时才按模板调用 `create_thread`；多个匹配时不再创建，保持 `pending`，进入内部复核并返回 `dispatch_failed` 与匹配证据。

只接受对象中的非空 `threadId`，或内容本身是 JSON 对象且包含非空 `threadId` 的字符串；普通错误文本不得传给 `JSON.parse`。返回不明确时再次按 `dispatch_key` 查询：唯一匹配才采用，多个匹配进入内部复核；零匹配时使用同一配置自动重试一次。再次失败时保持任务为 `pending`，返回 `dispatch_failed` 与两次原始错误；不要求用户批准重试，也不把创建错误写成任务 `blocked`。

### `reuse_thread`

只使用 action 指定的线程 id。确认 action 的 `thread_role` 与该复用链一致后，按该 id 更新标题、写入 `running` 并发送新绑定包；不得自行挑选其他线程。

### `reuse_existing_thread`

只使用驱动器从旧计划与状态验证后返回的 `from_plan`、`from_task` 和线程 id。旧来源必须属于同一父目标，且 module、profile、context、终止状态和真实线程 id 均满足复用约束。

旧线程不可读取、仍有活动任务或已被用户插入新任务时，停止该映射并进入主线程内部复核；不得创建同职责重复线程。跨 revision 复用时 `thread_role` 也必须一致。

## 命名与分派恢复

统一用 `set_thread_title` 设置标题，格式为 `[GA][<用途>][<状态>] <logical_id> · <title>`。`[GA]`、用途、`logical_id` 和可读标题是当前 task 的持久身份；状态段只是瞬时显示，不得作为调度或恢复依据。用途由 `thread_role` 唯一映射：`work -> [实施]`、`review -> [审查]`、`verify -> [验证]`。不得使用其他近义词或根据结果改变用途。

状态段只使用两个中文字：取得真实线程 id 后为 `[待命]`；绑定包发送成功后为 `[执行]`；发送聚焦补修前为 `[补修]`；终止状态固定映射为 `completed -> [完成]`、`needs_main_review -> [复核]`、`blocked -> [阻塞]`、`failed -> [失败]`。复用线程承接新 task 时同时替换用途、`logical_id`、标题和瞬时状态。绑定或恢复失败但已有唯一线程时使用 `[阻塞]`；没有真实线程 id 时不命名。命名失败只记录警告，不改变任务状态或触发重复执行。

每次 `update` 成功后立即使用返回的 `expected_title` 重命名；恢复协调、上下文中断恢复和进入新 revision 时，按 state 中各 thread 的最新 owner 幂等重放标题。state 是持久标题状态的唯一来源，`[待命]` 与 `[补修]` 只在当前分派过程显示。

用 `send_message_to_thread` 发送绑定包。首次发送失败时，保留 `running/thread_id` 并向同一线程重发一次。重新进入协调时，如果线程只有预备消息且没有绑定包或执行活动，也只补发一次。除绑定、一次聚焦补修和新 revision 绑定外不发送消息。仍失败或匹配不唯一时返回 `dispatch_failed` 并保留原状态；已有唯一线程时把标题更新为 `[阻塞]`，不得创建替代线程。

## 结果回收与补修

只接受写入绑定 `result_path`、符合模板“WORKER_RESULT_V3 普通结果”或“WORKER_RESULT_V3 写入范围变化”，且与当前 `task_id`、`logical_id`、`thread_role`、`module_id` 和 `thread_id` 一致的结果。聊天 JSON 与文件冲突时停止持久化并进入内部复核；聊天不可读但规范结果文件完整时可从文件恢复。

`completed` 必须同时满足：模型配置证据可核对；changed files 全部在写入范围内；`review` 与 `verify` 的 tracked changed files 为空；`done_when` 已满足；验证通过或有明确替代证据；`diff_self_check` 为 `pass`；不存在用户干预、未解决依赖或共享文件冲突。

字段缺失、验证不足或普通差异自检失败时，先把标题更新为 `[补修]`，再只向原线程发送一次聚焦补修。契约合法且带完整 `scope_request` 的越界结果不做无意义补修，直接记录 `needs_main_review`、更新为 `[复核]` 并进入内部修订。审查发现需要修改时走该路径；验证发现源码、配置或集成失败时持久化 `failed` 与原始证据。两者都由规划器生成后续 `work` task，原线程不得直接修改。补修仍不合法时同样进入内部修订；该状态本身不代表需要用户确认。

合法的 `blocked` 或 `failed` 先按结果文件持久化，只阻塞其后继；不相关分支继续执行。协调器不得把单个 task 的失败直接上报为父目标失败。

## 内部修订

子线程返回 `scope_request`、`blocked`、`failed`，生成器产生额外文件，或验证证明原 DAG 不完整时，先让当前已运行任务回收，并停止派发可能受影响的新任务。到达没有 `running` 的静止点后，聚合 state 内全部 task result、受控基线和当前差异，只调用一次 `$parallel-task-planner` 生成下一 revision。规划器负责闭包审查、拆分、职责转交、依赖重接和复用映射；协调器不复制或临时改写规划规则。

同一静止点的多个结果必须合并，不能一条结果生成一个 revision。新计划校验成功后立即恢复本 skill；驱动器返回 `reuse_existing_thread` 时必须复用。内部修订不能作为最终失败返回。

只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部系统副作用、权限升级，或主线程无法安全消歧时，才暂停并询问用户。

## 总验收

只有当前 revision 的全部任务都是 `completed`，才核对 `project_verification`。正式 build、test、lint 或审查必须已经由 DAG 中的 `verify` 或 `review` task 产生结果；顶层只聚合 state 中的规范证据、父目标覆盖和最终差异，不临时创建计划外工作，也不重复执行同一命令。通过后按模板返回 `PARALLEL_PLAN_RESULT.status: completed`。

工程总验收发现缺口时，先把缺口作为证据进入静止点修订，生成所需的 `work`、`review` 或 `verify` task 并自动继续。同一根因经过明确补修与复验后仍失败且没有新证据时，才判定无法恢复。只有无法恢复或存在真实用户边界时，才返回 `blocked` 并附 state 中的原始结果证据。用户插入新指令时暂停当前循环并优先处理新意图。
