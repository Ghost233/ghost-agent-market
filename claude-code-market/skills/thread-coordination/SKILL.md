---
name: thread-coordination
description: 当用户已授权执行通过校验的 v3 任务 DAG，需要由 Claude Code 主会话协调领域执行单元、按 module+role 跨 revision 复用并自动闭环失败，一次性完成同一父目标时使用。
---

# 任务协调

## 职责与边界

主会话作为只读协调器，消费驱动脚本返回的动作，安排执行单元实现任务，并持续推进到 `parent_goal` 完成。协调器不修改业务文件，不暂存、提交或推送代码。

用户授权的是完整父目标，不是某一版计划的冻结写域。安全的内部修订、任务重分配和执行单元复用由主会话完成，不要求用户逐次批准。所有已创建的执行单元保留，不自动关闭。

任何会影响父目标完成判定的实现、诊断、审查和验证都必须归属当前或下一 revision 的 DAG task。协调器不得为了范围分析、交叉检查、编译诊断或审查而创建任何计划外执行单元；需要委派的工作必须先成为 DAG task，通过校验后再由驱动器分派。主会话只能直接做只读的 plan、state、结果和差异核对。

执行单元归属由 `(parent_goal, module_id, thread_role)` 唯一确定。相同归属跨全部 revision 必须复用一个保留执行单元；`dispatch_key` 只保证一次 task 分派幂等，不是执行单元身份。不同归属的 ready actions 必须立即处理，不因其他执行单元仍在运行而延后。

创建执行单元、发送分派包、验收执行结果或返回最终结构化结果前，必须读取 [references/templates.md](references/templates.md)。

## 入口门禁

执行前逐项确认：

1. 用户以执行意图给出的顶层完整目标本身就是当前 `parent_goal` 的授权，不得二次询问；只有用户明确要求“只规划”或“只讨论”时才没有执行授权。同一父目标的安全修正版继承该授权。
2. `plan_path` 是当前项目 `.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json` 的绝对路径。
3. 计划使用 `planner: parallel-task-planner`、`plan_format_version: 3` 和 `execution_platform: claude_code`。首次计划可为 `parallel_safe` 或 `sequential_only`，修正版可为 `parallel_safe` 或 `sequential_only`；前者表示存在安全的并行机会，后者表示按依赖串行执行，二者都是可执行 DAG。`needs_user_review` 才表示当前存在真实用户边界。
4. 同目录 `state.json` 可读，且 `validate` 成功：

```text
node <plugin-root>/scripts/thread-plan.mjs validate <plan_path>
```

5. 无法归因的用户改动不落入未执行任务的 `writable_paths`；能够由执行单元、任务、`state.tasks.<id>.result` 和 changed files 证据归因的本轮改动视为受控基线。

门禁失败时不执行、不私自修复，按模板返回原始证据。只有 `validate` 成功且 safety 为 `parallel_safe` 或 `sequential_only` 才进入执行循环；`needs_user_review` 或校验失败时暂停，驱动器也会机械拒绝此状态下的 `next` 与 `update`。不得为通过门禁而制造并行任务、删除真实依赖或篡改 safety。

进入当前 revision 时，检查当前主会话是否已有 `render` 首行对应的 `plan_digest=<digest> revision=<n> safety.status=<status>` 和完整 Mermaid。完整 marker 必须包含当前计划摘要，不能仅按 revision 与 safety 判断。证据完整时不重复；缺失时先按规划模板提示执行模式并补运行一次 `render` 展示，然后立即继续。重复调用 `next` 时不展示。`sequential_only` 提示后不等待用户回复，也不需要特殊调度分支；依赖就绪动作自然会按拓扑逐项返回。

`validate` 只进行模型配置语法校验，并输出 `profile_validation: syntax_only`。首次创建时实际 `model` 与 `reasoning_effort` 是否可用，以平台创建执行单元的真实结果为准；复用时继承已有执行单元的实际配置。module 的 profile 或 context 变化不改变执行单元归属，也不能触发替代执行单元；不自动降级。

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

2. 立即处理本次返回的全部 actions；不同 `(module_id, thread_role)` 的 ready task 全部并行推进，不能因为其他任务仍在运行而延后。相同归属的 task 已由 DAG 保证可比。串行 DAG 通常只返回一个 action，仍按同一循环推进，不产生阻塞。
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

- `create_thread`：从 action 的领域 `module_id` 读取执行配置和共享上下文，以 `<plan_path>#<task_id>` 作为 `dispatch_key`。该 key 只用于恢复当前 task 的创建尝试；跨 revision 的执行单元归属只由 `(parent_goal, module_id, thread_role)` 决定。`create_thread` 表示驱动器已经沿完整 continuation 历史确认不存在该归属的真实执行单元，不能根据 profile、context、错误或终态自行改判。action 必须带有计划已校验的 `thread_role`、`expected_title` 和 `result_path`。真正创建前，先用平台可用的列表或查询能力按 `dispatch_key` 查找当前 task 的已有创建结果；唯一匹配时恢复其 id 并直接更新 `running`，零匹配时才创建，多个匹配时保持 `pending`、进入内部复核并返回 `dispatch_failed` 与匹配证据。
- `reuse_thread`：只使用 action 指定的原执行单元 id，并确认 `thread_role` 与复用链一致；不自行挑选其他执行单元。
- `reuse_existing_thread`：只使用驱动器沿完整 continuation 历史验证后返回的 id、`from_plan` 和 `from_task`。旧来源必须属于同一父目标并具有相同 `module_id + thread_role`；`completed`、`needs_main_review`、`blocked` 或 `failed` 都是合法复用终态。profile 与 context 变化不否定归属，复用模式仅由 `logical_id` 是否相同自动确定；不得替换或另建同职责执行单元。

创建后未取得真实 id 时再次按 `dispatch_key` 查询；唯一匹配才采用，多个匹配进入内部复核，零匹配时使用相同配置自动重试一次。再次失败时保持任务为 `pending`，返回 `dispatch_failed` 与两次原始错误；不要求用户批准重试，也不把平台创建错误写成任务 `blocked`。

旧执行单元不可读取、仍有活动任务或已被用户插入新任务时，停止跨版本映射并进入主会话内部复核；不得创建同职责重复执行单元。`continuation.replacements` 只表达旧任务的承接关系，不得覆盖或限制历史执行单元归属。

## 命名与分派恢复

统一名称格式为 `[GA][<用途>][<状态>] <logical_id> · <title>`。执行单元的持久归属只有 `(parent_goal, module_id, thread_role)`；名称中的用途反映固定 `thread_role`，`logical_id` 与可读标题只展示当前 task，状态段只展示当前状态，均不得作为归属判断依据。用途由 `thread_role` 唯一映射：`work -> [实施]`、`review -> [审查]`、`verify -> [验证]`。不得使用其他近义词或根据运行结果改变用途。

持久状态段只使用能够从 state 恢复的两个中文字：`running -> [执行]`、`completed -> [完成]`、`needs_main_review -> [复核]`、`blocked | dependency_blocked -> [阻塞]`、`failed -> [失败]`。取得真实 id 但尚未绑定时可显示 `[待命]`，发送唯一聚焦补修时可显示 `[补修]`；两者只是当前过程状态，恢复时必须被持久状态覆盖。没有真实 id 时不命名；平台不支持改名或命名失败时只记录警告，不改变任务状态或触发重复执行。

每次 state 更新后立即执行对应改名；恢复时幂等重放，因此 state 是名称的唯一真相。分派包首次发送失败时，保留 `running/thread_id` 并向同一执行单元重发一次。重新进入协调时，如果执行单元没有完整分派包或执行活动，也只补发一次。仍失败或匹配不唯一时返回 `dispatch_failed` 并保留原状态；不得创建替代执行单元。

## 结果回收与补修

只接受符合模板“WORKER_RESULT_V3 普通结果”或“WORKER_RESULT_V3 写入范围变化”章节，且与当前 `task_id`、`logical_id`、`thread_role`、`module_id` 和 `thread_id` 一致的结果。绑定包中的 `result_path` 必须位于当前计划目录 `results/<task_id>.json`；执行单元原子写入该文件，并在消息中返回完全相同的 JSON。

`completed` 必须同时满足：changed files 全部在写入范围内；`review` 与 `verify` 的 tracked changed files 为空；`done_when` 已满足；验证通过或有明确替代证据；`diff_self_check` 为 `pass`；模型与分派证据可核对；不存在用户干预、未解决依赖或共享文件冲突。

字段缺失、验证不足或普通差异自检失败时，task state 保持 `running`，名称临时显示 `[补修]`，只向原执行单元发送一次模板中的聚焦补修差量；差量必须要求执行单元即使无法补齐成功证据，也返回身份正确、契约合法并保留原始原因的 `failed` 结果。契约合法且带完整 `scope_request` 的越界结果不做无意义补修，记录 `needs_main_review` 并在静止点内部修订。`review` 发现缺陷时也走该路径，由规划器生成 `work` 任务；`verify` 只报告完整原始验证证据。补修后得到合法终态结果才执行 `update` 并进入内部修订；若结果仍不合法或原执行单元不可达，保留 `running/thread_id`，返回 `dispatch_failed` 与原始证据，不伪造终态、不创建替代执行单元，也不声称已经到达静止点。

## 自动失败闭环

在静止点按以下顺序处理全部终态结果：

1. `completed` 保留并继续满足下游依赖。
2. `needs_main_review`、同父目标内的 `failed`、内部依赖或可诊断环境造成的 `blocked`，统一交给 `$parallel-task-planner` 做一次闭包审计，生成诊断、修复、复审或 `verify` 任务。
3. 编译和验证失败必须以原始退出码、源码错误和日志路径为准；包装摘要不得覆盖更具体的错误。证据不足时先规划 `verify` 诊断任务，不询问用户。
4. `project_verification` 失败同样进入下一 revision，不直接结束父目标。
5. 只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部系统副作用、权限升级，或无法安全消歧才是用户边界。

## 内部修订

在静止点整理旧计划、state 内嵌结果、所有未完成任务、受控基线和当前差异，调用 `$parallel-task-planner` 生成唯一下一 revision。范围变化、可恢复失败、验证失败和审查缺陷必须合并处理；规划器负责闭包审计、拆分、职责转交和依赖重接，驱动器负责沿历史自动生成复用路由。

旧计划仍有 `running` 或终态结果尚未内嵌时先回收，不抢跑修订。新计划校验成功后由规划 skill 展示一次执行模式和 Mermaid；若展示中断，恢复本 skill 时按包含 `plan_digest` 的完整 marker 补展示。不得等待用户确认。驱动器返回 `reuse_existing_thread` 时必须复用。内部修订不能作为最终失败返回。

只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部系统副作用、权限升级，或主会话无法安全消歧时，才暂停并询问用户。

## 总验收

只有当前 revision 的全部任务都是 `completed`、每项都内嵌合法结果，且正式诊断、审查和验证都能追溯到 DAG task，才核对 `project_verification`。顶层只聚合 state 中的规范 task 证据、父目标覆盖和最终差异，不执行计划外命令，也不重复运行 build、test、lint 或正式审查。验证通过后按模板返回 `PARALLEL_PLAN_RESULT.status: completed`。

工程总验收失败先进入自动失败闭环；内部修订确认存在真实用户边界时，才返回 `blocked` 并附原始证据。用户插入新指令时暂停当前循环并优先处理新意图。

## 消息策略

对用户只报告一次启动、必要的 revision 摘要、最终完成或真实边界；不逐任务播报。一次 `next` 返回的 actions 批量处理，执行结果低频批量回收。每项任务只发送一次完整分派包；补修只发送一次结构化差量。执行单元的过程性说明不转发给用户，也不作为正式证据。
