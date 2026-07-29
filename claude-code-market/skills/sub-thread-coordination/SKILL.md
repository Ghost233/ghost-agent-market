---
name: sub-thread-coordination
description: 当用户要求以长期 Owner 线程、显式 Review、按需 DAG、并行执行或网页进度完成工作时使用。启动前必须由用户明确选择串行 Quick 或 DAG；不允许替用户默认选择。
---

# 子线程工作流协调器

> 平台差异：Claude Code 只有在宿主提供可创建、发送和等待的长期子线程 API 时才能执行本工作流。标准 Agent 不具备用户长期持有上下文与完成约束，禁止作为回退；缺少子线程 API 时必须在规划后 fail closed。本平台固定使用 `standalone_thread`，不包含原生 Goal 桥接。

这是唯一协调入口；禁止 subagent。首次进入时完整读取 [运行模式](references/goal-contract.md)、[生命周期契约](references/lifecycle-contract.md)、[Owner 治理](references/owner-governance.md) 和 [恢复约定](references/templates.md)，引用未变时不重复读取。

本平台固定使用 `standalone_thread`，不包含 Codex 原生 Goal 桥接；DAG Supervisor 按脚本结果启动或结束宿主监督 turn。

默认 profile：移交后的 Main 为 `gpt-5.6-sol/xhigh`，Planner/Owner/Review 为 `gpt-5.6-sol/high`，Supervisor 为 `gpt-5.6-luna/medium`。执行与 Implementation Review 使用 `$sub-thread-goal-worker`；DAG 额外使用 `$parallel-task-planner`、`$planner-reviewer`、`$sub-thread-task-supervisor` 和 `$start-dag-dashboard`。

## 硬边界

- 只通过领域脚本修改 workflow、Plan、State、Result、Registry、Capsule、配置与 Review 文件。
- 运行中的 Main、Planner、Reviewer、Supervisor 和 Worker 都不得编辑、复制、替换或绕过 `goal-dag.mjs`、`owner-registry.mjs`、`workflow-config.mjs`、`start-dashboard.mjs`，包括插件缓存和 `/tmp` 副本。runtime 失败时立即停止当前动作，只报告失败命令、简短错误和日志路径；不得改用内部命令、手写状态或临时补丁继续。
- Git 分支、worktree、提交、合并、验证、ID、路径、attempt、token、digest 和状态迁移都由脚本决定；LLM 不直接运行 Git。
- 新线程使用独立 worktree 后，Goal 目录会位于其当前 worktree 之外。此时必须对收据指定的原始 Node CLI 使用宿主原生文件权限请求；Codex 使用 `require_escalated`。只授权该确定性脚本命令，禁止把权限失败改写为 fork、直接编辑文件或临时脚本。
- 脚本 JSON 只作机器收据，不复制到聊天。
- Quick 只保留当前 Owner 上下文、当前状态和最终结果；DAG 运行中额外保留当前 Plan/State、`progress.json` 和唯一历史 `events.jsonl`。成功交付后只在原始工作区保留最终 `result.json` 与 `events.jsonl`。
- 不新增 attempt、Review、evidence、recovery 或聊天 history。
- Workflow 与 Task 只能使用生命周期契约中的 4 个状态；停止时只允许有限 `reason/action` 矩阵。Owner phase、线程观测、Worker 结果、调度命令和事件都不是生命周期状态。未知值一律由脚本拒绝，模型不得补写或猜测。

## 模式选择

- 用户明确要求快速或串行：Quick。
- 用户明确要求 DAG、并行或网页进度：DAG。
- 用户未明确指定运行模式：只询问“请选择 Quick 串行模式或 DAG 并行模式”，等待用户作出选择；不得调用 `workflow start`、创建线程或开始实施。
- `parallel: 8` 表示八个是上限，不是目标；不为填槽拆任务。

## Quick

Quick 不创建 Planner、Plan、Dashboard 或 Supervisor。它沿用串行 Owner 内核，直接在用户当前工作区和当前分支执行，完全不创建、切换、合并或删除 Git 分支/worktree。Main 使用 `workflow start/step/dispatch/attach/observe/review` 的脚本收据完成串行 Owner 与独立 Review。Worker 只能调用 `worker open/verify/complete|block|fail|request-dag`。

具体调度动作仍由脚本返回 `workflow dispatch` 与 `workflow review`；Main 不自行拼接 Owner 或 Review 状态。

Worker 使用 `worker request-dag` 请求升级时，脚本只迁移已经验收的最终产物与摘要；不迁移聊天历史，也不得从 DAG 降级回 Quick。

## DAG：先移交新主控

DAG 的三个主要入口只有：

```text
goal-dag.mjs workflow start-dag <workspace> <development-key>
goal-dag.mjs workflow owner-sync <goal-dir> <owner-id>
goal-dag.mjs workflow owner-finish <goal-dir> <run-id>
```

其中 `start-dag` 的实际签名是 `start-dag <workspace> <development-key>`。Main 根据开发需求生成简短、稳定的英文 key；用户明确提供时原样使用。key 必须匹配 `^[a-z0-9][a-z0-9_-]{0,63}$`，首次调用和移交后的 Main 必须完全一致，禁止时间戳、Goal ID 或 hash。完整分支名只由脚本生成：DAG 为 `ga/<development-key>/main`，Owner 为 `ga/<development-key>/<owner_id>`；Owner ID 只来自 Planner/runtime，Main 与 Supervisor 不拼接分支。

当前用户会话把中文目标通过 stdin 交给 `workflow start-dag <原始工作区> <development-key>`。脚本要求原始工作树干净，只创建 DAG 分支并返回 `handoff_required`；收据的 dispatch 必须包含带 key 的完整命令。若原始工作区尚无配置，脚本只在内存使用默认值，不得在原始工作区创建 `config.json`；新 DAG worktree 认领分支后才由脚本创建并提交配置。此时原始工作区不得出现 Goal、Dashboard 或 DAG State，也不得切换原始分支。

收到 `handoff_required` 后：

1. 逐字使用收据的 `model/thinking/dispatch/target.starting_branch` 通过 `create_thread` 创建一个全新 worktree 子线程；禁止 `fork_thread`、对话分叉或继承当前聊天历史，不得改写分支、prompt 或 thinking。
2. 取得正式 threadId 后输出创建的任务链接。
3. 当前会话立即停止；不得创建 Goal、Planner、Supervisor、Dashboard，不得等待新主控，也不得继续执行任何 DAG 工作。

新线程自行设置收据标题，并在自己的 worktree 中把相同中文目标通过 stdin 交给同一个 `workflow start-dag <当前工作区> <相同 development-key>`。宿主创建的 worktree 可以是 detached HEAD；脚本验证 HEAD、清洁状态和分支占用后自行附着 `ga/<key>/main`，不得强制抢占。认领成功后脚本创建 Goal 并先要求登记 Main，再要求创建 Supervisor；Planner 尚未启动。Goal、Dashboard、Plan、State、Result 和 DAG 日志只存在于 DAG worktree。

新 Main 只在首次认领 DAG worktree 时调用 `workflow start-dag`。取得脚本返回的 `goal_dir` 后，当前 Goal 的后续动作只调用：

```text
goal-dag.mjs workflow step <goal-dir>
```

它会投影当前唯一动作。不得再次通过 DAG worktree 绝对路径调用 `workflow start-dag`。`main_route_required` 等脚本明确要求的宿主 route/dashboard/native ack 属于内部回执；只能按收据执行，不得把低层命令当作新的协调入口。

## DAG 动作

- `main_route_required`：登记当前新 Main 的正式 threadId/hostId，然后再次投影。
- `supervisor_init_required`：立即调用内部 `workflow supervisor-init`，逐字使用收据的 target 以宿主长期 `create_thread` 创建独立 worktree 的唯一 Supervisor，使用 `gpt-5.6-luna/medium`；Supervisor 必须早于 Planner 创建。收据的 `status_document` 由脚本保存所有 Main 已启动目标及当前状态。Supervisor 先执行 dispatch 中的 `supervisor start`，返回 `start` 时启动监督 turn，返回 `stop` 时保持停止。Main 不等待，也不负责周期唤醒。
- Planner、Planner Reviewer、Owner 与 Implementation Review 全部由 Main 逐字执行 `supervisor next` 的 create action；只允许 `create_thread` 或复用已登记线程。Main 按 action id 执行 `supervisor ack` 并发送正式 dispatch 后，把已有 watch 交给 Supervisor 等待，Main 自己绝不调用 `wait_threads`。
- `planner_required`、`planner_revision_required` 和 `planner_review_required` 如果意外投影到 Main，只能确认 Supervisor route 存在；不得由 Main 执行或重复唤醒 Supervisor。
- `dashboard_start_required`：Plan 激活后由新 Main 启动 Dashboard，回执失败不阻断业务。
- `supervisor_required`：逐字把脚本收据的 dispatch 发送给已登记 Supervisor。Supervisor 通过 `supervisor start` 从本地状态判断继续或重启监督 turn。Worker 完成后也按脚本收据主动通知它。Main 不调用 `supervisor next` 或等待；只有 Supervisor 发来的 create/notify 才由 Main 处理。
- `owner_sync_required`：只执行收据指定的 `workflow owner-sync`。成功后运行 `workflow step <goal-dir>` 投影下一动作；若返回 `supervisor_required`，逐字把 dispatch 发送给 Supervisor，由它为新 active 批次按需创建 Goal。当前 Goal 的后续 Main 动作禁止再次调用 `workflow start-dag`。该 Git 写操作不得藏在 `supervisor next` 或 `supervisor ack` 中。
- Runtime 只接受当前 Plan 与 verification 契约；旧契约直接拒绝，不得猜测字段、命令或手写 JSON。
- 新 Owner 的 create action 若为 `sync_status: worktree_required`：Main 用 `create_thread` 启动 action prompt，取得正式 threadId 后立即调用 `supervisor ack <goal-dir> <action-id> <thread> <host> bootstrap` 登记 bootstrap watch；Main 不等待。bootstrap 结束后 Supervisor 自行投影下一动作，Main 按其通知复用同一线程执行普通 create ack 并发送正式 Worker dispatch。
- Planner、Planner Reviewer 或普通任务连续十轮无进度时，Supervisor 只通过 `supervisor inspect` 取得脚本结论并发送 task/attempt；Main 等待用户决定。继续运行时只调用内部 `supervisor-resume <goal-dir> <task-id> <attempt>`，再把收据的 `thread_notify` 与可选 `supervisor_notify` 逐字发送给对应线程；不得重新创建线程、run、attempt 或 worktree。用户确认关闭旧线程后才调用内部 `supervisor-recover <goal-dir> <task-id> <attempt> <reason>`。异常结束或未生成有效结果也按同一用户决策边界处理。脚本原子更新 watch/route/status，不得手写。
- `owner_action_required`：报告 Owner 变化并等待用户决定。
- `native_completion_required`：只执行收据指定的原生 Goal 桥接。
- `completed`：脚本已合并回原始分支、保存最终结果和 DAG 日志，并删除全部 Owner/DAG worktree 与分支；Main 才报告最终结果并停止。

Plan 只生成最小顶层 DAG；父节点无法直接完成时才由 Composite Planner 展开内部子图。Implementation Review 必须是显式 DAG 节点。

初始 Plan 必须先由 runtime 完整检查 required effects、schema、依赖和固定 gate，再创建 Planner Reviewer。Reviewer 收据必须绑定当前 Plan digest；Plan revision 改变后旧收据立即失效，禁止先 Review 再用 `needs_delta` 补初始计划。

## Owner worktree 循环

每个 Owner 在当前 Goal 内长期复用一个线程、一个分支和一个独立 worktree：

```text
owner-sync：Owner 分支快进到最新 DAG 分支
→ Owner 只在自己的 worktree 开发和验证
→ worker complete 只提交结果候选
→ owner-finish 在临时集成 worktree 合并并重跑验证
→ 验证通过后快进 DAG、更新 task 完成状态
```

每轮开始前必须 `owner-sync`。下游只读取已合并到 DAG 分支的代码。合并冲突或集成验证失败时，task 保持 running、DAG HEAD 不变、结果候选清除；Supervisor 必须唤醒原 Owner 在原 worktree 修复，禁止新建 Owner 线程或 worktree，也禁止重新同步覆盖修复分支。

`owner-sync` 还会按 task writable scope 初始化所需 Git submodule；Worker 不手动执行 submodule/Git 命令。`owner-finish` 由脚本提交 submodule 与父仓库指针，并把已集成 submodule 同步到 DAG。Owner 返回 `blocked/failed/needs_repair` 时不合并分支，脚本直接验收终态并路由 Main，不得反复调用 `owner-finish`。

Goal 完成后，脚本在原始工作区仍处于启动分支且干净的前提下，把 DAG 分支合并到原始分支的最新 HEAD；DAG 期间原始分支新增的提交不得被覆盖。随后把最终结果和 `events.jsonl` 固定保存到原始工作区的 `.ghost-agent-workflow/`，最后删除全部 Owner worktree/分支和 DAG worktree/分支。任何分支尚未合并、worktree 不干净或最终合并冲突时都停止清理并保留现场，不得声称交付完成。

## 线程与输出

- 同一 workspace 同时只能有一个 Main；多个时脚本拒绝。
- 创建线程后必须取得正式 threadId；线程自行调用 `set_thread_title`。不得给 `create_thread` 伪造 title/name，不得登记 clientThreadId。
- Main 创建任何 Planner、Reviewer、Owner 或 Review 线程时只能调用 `create_thread`；Supervisor 不创建线程。禁止调用 `fork_thread`，禁止复制 Main 的历史消息。首条 prompt 只能包含 Skill、Goal 目录、脚本 action 和必要标量。
- 可见标题只使用脚本生成的 `[GA][任务][主控|规划|子图规划|规划审查|责任域|实现审查|监督] <中文标题>`。
- 可见标题的中文后缀最多 32 个字符；不得包含完整目标、文件路径列表或从用户原文机械截断的路径。
- Planner、Reviewer、Supervisor 使用从 DAG 分支创建的独立干净 worktree，只通过绝对 Goal 目录和领域脚本访问共享状态；Owner Work 只能在脚本登记的 Owner worktree 运行。
- Main 不调用 `wait_threads`、sleep 或轮询。DAG 中只有 Supervisor 等待执行线程。
- 禁止 Orca runtime、`orca` CLI、`$orchestration` 和 subagent。
- Main 只报告 Dashboard URL、Owner 决策、真实阻塞、疑似挂死、已机械验收结果和最终完成；普通 running、规划/测试过程和机器 JSON 保持静默。
