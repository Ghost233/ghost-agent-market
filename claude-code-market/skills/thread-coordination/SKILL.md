---
name: thread-coordination
description: 当用户已授权执行通过校验的 v3 任务 DAG，需要由 Claude Code 主会话协调领域执行单元、自动闭环失败、复用既有执行单元，并一次性完成同一父目标时使用。
---

# 任务协调

## 职责与边界

主会话作为只读协调器，消费驱动脚本返回的动作，安排执行单元实现任务，并持续推进到 `parent_goal` 完成。协调器不修改业务文件，不暂存、提交或推送代码。

用户授权的是完整父目标，不是某一版计划的冻结写域。安全的内部修订、任务重分配和执行单元复用由主会话完成，不要求用户逐次批准。所有已创建的执行单元保留，不自动关闭。

任何会影响父目标完成判定的实现、诊断、审查和验证都必须归属当前或下一 revision 的 DAG task。执行期间不得创建计划外执行单元取得正式证据，也不增加人工容量判断。

创建执行单元、发送分派包、验收执行结果或返回最终结构化结果前，必须读取 [references/templates.md](references/templates.md)。

## 入口门禁

执行前逐项确认：

1. 用户已明确授权执行当前 `parent_goal`；同一父目标的安全修正版继承该授权。
2. `plan_path` 是当前项目 `.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json` 的绝对路径。
3. 计划使用 `planner: parallel-task-planner`、`plan_format_version: 3` 和 `execution_platform: claude_code`。首次计划必须为 `parallel_safe`；带前版计划、状态和执行证据的修正版可为 `parallel_safe` 或 `sequential_only`。
4. 同目录 `state.json` 可读，且 `validate` 成功：

```text
node <plugin-root>/scripts/thread-plan.mjs validate <plan_path>
```

5. 无法归因的用户改动不落入未执行任务的 `writable_paths`；能够由执行单元、任务、`state.tasks.<id>.result` 和 changed files 证据归因的本轮改动视为受控基线。

首次计划门禁失败时不执行、不私自修复，按模板返回原始证据。修正版仅有计划结构或 safety 标注错误时，调用 `$parallel-task-planner` 重新生成唯一 revision 并再校验一次，不升级为用户确认。

`validate` 只进行模型配置语法校验，并输出 `profile_validation: syntax_only`。实际 `model` 与 `reasoning_effort` 是否可用，以平台创建执行单元的真实结果为准；不自动降级。

## 恢复与执行循环

每次进入或恢复本 skill，先读取当前 plan 和 state：

1. 终态任务必须具有内嵌的完整 `WORKER_RESULT_V3`；缺失时先从已绑定执行单元回收同一结果文件或结果消息，不凭聊天摘要重建。
2. 按 state 恢复名称。对同一 `thread_id` 只更新当前活动任务；没有活动任务时更新当前 revision 中最后一个终态任务。
3. 当前 state 仍有 `running` 时先回收；没有真实用户边界时不得因会话中断询问用户。

随后循环：

1. 运行：

```text
node <plugin-root>/scripts/thread-plan.mjs next <plan_path> <state_path>
```

2. 立即处理本次返回的全部 actions；不能因为其他任务仍在运行而延后已就绪任务。
3. action 必须带有待命 `expected_title` 与唯一 `result_path`。取得真实执行单元 id 后，先使用 action 标题显示 `[待命]`，再统一写入 `thread_id`：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> running <thread_id>
```

4. 保存 running update 返回的 `expected_title`；发送一次完整分派包，成功后用该标题显示 `[执行]`。
5. 低频、批量回收执行结果；运行中不是失败。执行单元的过程说明不作为证据。
6. 校验执行单元已经原子写入的结果文件与消息 JSON 一致，再把 `result_path` 传给终态 update；驱动器负责读取、验证身份字段并内嵌完整结果：

```text
node <plugin-root>/scripts/thread-plan.mjs update <plan_path> <state_path> <task_id> completed|blocked|failed|needs_main_review <result_path>
```

7. 终态 update 成功后立即按持久状态更新名称，再回到第 1 步。不要在仍有 ready action 时等待其他任务，也不要在仍有 `running` 时生成 revision。
8. 当 actions 为空且没有 `running` 时到达静止点；此时一次汇总全部内嵌结果，进入唯一一次内部修订或总验收。

## 分派动作

- `create_thread`：从 action 的领域 `module_id` 读取执行配置和共享上下文，以 `<plan_path>#<task_id>` 作为 `dispatch_key`。action 必须带有计划已校验的 `thread_role`、`expected_title` 和 `result_path`，协调器不得根据任务文本猜测用途。真正创建前，先用平台可用的列表或查询能力按 `dispatch_key` 查找已有执行单元；唯一匹配时恢复其 id 并直接更新 `running`，零匹配时才创建，多个匹配时保持 `pending`、进入内部复核并返回 `dispatch_failed` 与匹配证据。
- `reuse_thread`：只使用 action 指定的原执行单元 id，并确认 `thread_role` 与复用链一致；不自行挑选其他执行单元。
- `reuse_existing_thread`：只使用驱动器从旧计划与状态验证后返回的 id、`from_plan` 和 `from_task`；`thread_role` 必须一致，不得替换或另建同职责执行单元。

创建后未取得真实 id 时再次按 `dispatch_key` 查询；唯一匹配才采用，多个匹配进入内部复核，零匹配时使用相同配置自动重试一次。再次失败时保持任务为 `pending`，返回 `dispatch_failed` 与两次原始错误；不要求用户批准重试，也不把平台创建错误写成任务 `blocked`。

旧执行单元不可读取、仍有活动任务或已被用户插入新任务时，停止跨版本映射并进入主会话内部复核；不得创建同职责重复执行单元。失败续作保持同一 `logical_id`、领域 module 和 role 时优先 `continue`；只有职责真正移交时才 `handoff`。

## 命名与分派恢复

统一名称格式为 `[GA][<用途>][<状态>] <logical_id> · <title>`，每次改名都保留 `[GA]`、用途、稳定标识和可读标题。用途由 `thread_role` 唯一映射：`work -> [实施]`、`review -> [审查]`、`verify -> [验证]`。不得使用其他近义词或根据运行结果改变用途。

持久状态段只使用能够从 state 恢复的两个中文字：`running -> [执行]`、`completed -> [完成]`、`needs_main_review -> [复核]`、`blocked | dependency_blocked -> [阻塞]`、`failed -> [失败]`。取得真实 id 但尚未绑定时可显示 `[待命]`，发送唯一聚焦补修时可显示 `[补修]`；两者只是当前过程状态，恢复时必须被持久状态覆盖。没有真实 id 时不命名；平台不支持改名或命名失败时只记录警告，不改变任务状态或触发重复执行。

每次 state 更新后立即执行对应改名；恢复时幂等重放，因此 state 是名称的唯一真相。分派包首次发送失败时，保留 `running/thread_id` 并向同一执行单元重发一次。重新进入协调时，如果执行单元没有完整分派包或执行活动，也只补发一次。仍失败或匹配不唯一时返回 `dispatch_failed` 并保留原状态；不得创建替代执行单元。

## 结果回收与补修

只接受符合模板“WORKER_RESULT_V3 普通结果”或“WORKER_RESULT_V3 写入范围变化”章节，且与当前 `task_id`、`logical_id`、`thread_role`、`module_id` 和 `thread_id` 一致的结果。绑定包中的 `result_path` 必须位于当前计划目录 `results/<task_id>.json`；执行单元原子写入该文件，并在消息中返回完全相同的 JSON。

`completed` 必须同时满足：changed files 全部在写入范围内；`review` 与 `verify` 的 tracked changed files 为空；`done_when` 已满足；验证通过或有明确替代证据；`diff_self_check` 为 `pass`；模型与分派证据可核对；不存在用户干预、未解决依赖或共享文件冲突。

字段缺失、验证不足或普通差异自检失败时，task state 保持 `running`，名称临时显示 `[补修]`，只向原执行单元发送一次模板中的聚焦补修差量。契约合法且带完整 `scope_request` 的越界结果不做无意义补修，记录 `needs_main_review` 并在静止点内部修订。`review` 发现缺陷时也走该路径，由规划器生成 `work` 任务；`verify` 只报告完整原始验证证据。补修仍不合法时记录 `failed`，但不自动升级为用户确认。

## 自动失败闭环

在静止点按以下顺序处理全部终态结果：

1. `completed` 保留并继续满足下游依赖。
2. `needs_main_review`、同父目标内的 `failed`、内部依赖或可诊断环境造成的 `blocked`，统一交给 `$parallel-task-planner` 做一次闭包审计，生成诊断、修复、复审或 `verify` 任务。
3. 编译和验证失败必须以原始退出码、源码错误和日志路径为准；包装摘要不得覆盖更具体的错误。证据不足时先规划 `verify` 诊断任务，不询问用户。
4. `project_verification` 失败同样进入下一 revision，不直接结束父目标。
5. 只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部系统副作用、权限升级，或无法安全消歧才是用户边界。

## 内部修订

在静止点整理旧计划、state 内嵌结果、所有未完成任务、受控基线和当前差异，调用 `$parallel-task-planner` 生成唯一下一 revision。范围变化、可恢复失败、验证失败和审查缺陷必须合并处理；规划器负责闭包审计、拆分、职责转交、依赖重接和复用映射。

旧计划仍有 `running` 或终态结果尚未内嵌时先回收，不抢跑修订。新计划校验成功后立即恢复本 skill；驱动器返回 `reuse_existing_thread` 时必须复用。内部修订不能作为最终失败返回。

只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部系统副作用、权限升级，或主会话无法安全消歧时，才暂停并询问用户。

## 总验收

只有当前 revision 的全部任务都是 `completed`、每项都内嵌合法结果，且正式诊断、审查和验证都能追溯到 DAG task，才运行 `project_verification`。验证通过后按模板返回 `PARALLEL_PLAN_RESULT.status: completed`。

工程总验收失败先进入自动失败闭环；内部修订确认存在真实用户边界时，才返回 `blocked` 并附原始证据。用户插入新指令时暂停当前循环并优先处理新意图。

## 消息策略

对用户只报告一次启动、必要的 revision 摘要、最终完成或真实边界；不逐任务播报。一次 `next` 返回的 actions 批量处理，执行结果低频批量回收。每项任务只发送一次完整分派包；补修只发送一次结构化差量。执行单元的过程性说明不转发给用户，也不作为正式证据。
