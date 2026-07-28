---
name: sub-thread-coordination
description: 当用户要求以长期 Owner 线程、显式 Review、按需 DAG、并行执行或网页进度完成工作时使用。启动前必须由用户明确选择串行 Quick 或 DAG；不允许替用户默认选择。
---

# 子线程工作流协调器

> 平台差异：Kimi Code 只有在宿主提供可创建、发送和等待的长期子线程 API 时才能执行本工作流。标准 Agent 不具备用户长期持有上下文与完成约束，禁止作为回退；缺少子线程 API 时必须在规划后 fail closed。本平台固定使用 `standalone_thread`，不包含原生 Goal 桥接。

这是唯一协调入口。禁止 subagent。首次进入时读取 [运行模式](references/goal-contract.md)、[Owner 治理](references/owner-governance.md) 和 [恢复约定](references/templates.md)，引用未变时不重复读取。

本平台固定使用 `standalone_thread`，不包含 Codex 原生 Goal 桥接。默认 profile：Planner/Owner/Review 为 `gpt-5.6-sol/high`，Supervisor 为 `gpt-5.6-luna/medium`。

执行与 Implementation Review 使用 `$sub-thread-goal-worker`。DAG 模式额外使用 `$parallel-task-planner`、`$planner-reviewer`、`$sub-thread-task-supervisor` 和 `$start-dag-dashboard`。

## 硬边界

- 只通过领域脚本修改 workflow、Plan、State、Result、Registry、Capsule、配置和 Review 文件。
- ID、路径、generation、attempt、token、revision、digest、状态迁移和清理由脚本决定。
- Quick 只保留当前 Owner 上下文、当前状态和最终结果。DAG 额外保留当前 Plan/State、`progress.json` 与唯一历史 `events.jsonl`。
- 初始化脚本负责创建 `.ghost-agent-workflow/.gitignore`；模型不得手写或覆盖它。
- 不新增 attempt、Review、evidence、recovery 或聊天 history。
- 脚本 JSON 只是机器收据，不复制到聊天。

## 模式选择

- 用户明确要求快速或串行：`quick`。
- 用户明确要求 DAG、并行执行或网页进度：`dag`。
- 用户未明确指定：只询问“请选择 Quick 串行模式或 DAG 并行模式”，等待用户作出选择；本轮不得调用 `workflow start`、创建线程或开始实施。
- 不根据任务规模、历史偏好或 Main 自己的判断代替用户选模式。
- `parallel: 8` 只是 DAG 并行上限；不得为了填满槽位拆任务。

不增加模式配置字段。每次把中文目标通过 stdin 交给：

```text
goal-dag.mjs workflow start <workspace> <quick|dag>
```

脚本自动确保 workflow 配置存在、生成 ID 和目录，并读取已批准 Owner Registry。没有 Owner 时按 [Owner 治理](references/owner-governance.md) 等待用户决定。

启动成功后立即用当前 Main 的正式 threadId 和 hostId 登记路由：

```text
goal-dag.mjs workflow thread <workflow-dir> main <thread-id> <host-id>
```

`workflow step` 返回 `main_route_required` 时执行同一命令。不得扫描多个 Main 后猜测；同一 workspace 出现多个活动工作流时脚本直接拒绝启动。

## 统一循环

Main 只循环：

```text
goal-dag.mjs workflow step <workflow-dir>
```

### Quick

Quick 不创建 Planner、Plan、Dashboard 或 Supervisor，严格串行：

- `owner_required`：选择已批准 Owner，把中文工作通过 stdin 交给 `workflow dispatch <dir> <owner-id>`。
- dispatch 后复用 `preferred_thread`；没有可用线程才创建 Owner 线程。取得正式 threadId 后调用 `workflow attach <dir> <run-id> <thread-id> <host-id>`，再发送 `$sub-thread-goal-worker + <dir> + <run-id>`。
- `wait_thread`：Main 直接等待该线程，不轮询原始文件；收到新 cursor 后调用 `workflow observe <dir> <run-id> <cursor>` 持久化。
- `next_owner_or_review`：需要其他责任域时再次 dispatch；否则调用 `workflow review <dir>`，用新线程 attach 并执行显式串行 Review。
- `user_blocked`：只报告真实阻塞。
- `completed`：报告最终 `result.json`。

Review 必须使用与实施 Owner 不同的干净线程。Quick 没有隐形 Review，脚本也不会在 Review 通过前 finalize。

Worker 发现需要拆分时使用 `worker request-dag`。脚本验收已完成部分，把它压缩为当前 accepted input，随后只为剩余工作启动 Planner。不得迁移聊天历史，也不得从 DAG 降级回 Quick。

### DAG

DAG 只生成最小可执行顶层图：

- `planner_required`：创建/复用 Planner；新线程逐字使用收据中的 `model/effort/thread_title`，并登记为 `workflow thread <dir> planner ...`，只用 `planner-open/planner-submit`。`planner_action` 决定 initial、delta、Review upgrade、repair 或 Owner transition，不从聊天猜测。
- `planner_review_required`：用收据中的 `model/effort/thread_title` 创建独立 Planner Reviewer；新线程登记为 `workflow thread <dir> planner_reviewer ...`。
- `planner_revision_required`：Planner 最多修订一次。
- `dashboard_start_required`：Main 调用 `$start-dag-dashboard`；随后必须调用 `workflow dashboard <dir> started|failed`。失败只报告网页不可用，业务继续。
- `supervisor_init_required`：调用 `workflow supervisor-init <dir>` 后创建唯一 Supervisor。
- `supervisor_required`：唤醒 Supervisor；最多八个 ready 线程并发。
- `owner_action_required`：报告 Owner 变化并等待用户批准；批准后只调用 Owner 脚本，下一次 `workflow step` 自动继续或路由 Owner transition。
- `user_action_required`：只报告脚本给出的真实阻塞或需确认的陈旧线程。
- `native_completion_required`：执行收据中的原生 Goal 完成动作，再调用 `workflow native-confirm <dir> <completion-token>`。
- `completed`：报告最终结果。

Plan 激活后才启动 Dashboard；成功只报告一次 URL，失败不阻断业务 DAG。Main 不输出完整 DAG 或 Mermaid。

## 线程与输出

同一 workspace 同时只能有一个 Main；发现多个活动主控时停止，不以随机标记绕过。

创建线程后等待正式 threadId，再通知线程自行使用脚本标题调用 `set_thread_title`。不得给 `create_thread` 伪造 title/name，不得登记 clientThreadId。

标题只使用脚本生成的 `[GA][任务][主控|规划|子图规划|规划审查|责任域|实现审查|监督] <中文标题>`。

所有可见标题逐字使用脚本收据。Main 只报告 Dashboard URL、Owner 决策、真实阻塞、疑似挂死、已经机械验收的结果和最终完成；普通 running、Planner 过程、测试过程和机器 JSON 保持静默。

底层 `reserve/reconcile/bind/finish/finalize/result-submit` 只供 runtime 和测试使用，协调线程不得调用。
