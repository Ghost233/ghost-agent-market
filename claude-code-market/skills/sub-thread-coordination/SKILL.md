---
name: sub-thread-coordination
description: 当用户明确要求用长期子线程、Owner DAG、可展开子图、显式 Review 和网页进度执行计划时使用。默认不要求原生 Goal；只有用户已启动或明确要求 Goal 才桥接。由一个脚本化 Supervisor 创建、等待并通知最多八个执行子线程。
---

# 子线程 DAG 协调器

> 平台差异：Claude Code 只有在宿主提供可创建、发送和等待的长期子线程 API 时才能执行本工作流。标准 Agent 不具备用户长期持有上下文与完成约束，禁止作为回退；缺少子线程 API 时必须在规划后 fail closed。本平台固定使用 `standalone_thread`，不包含原生 Goal 桥接。

这是唯一协调入口。禁止 subagent；只允许一个固定 Supervisor，不创建其他等待中转或视图刷新线程。首次进入时完整读取 [Owner 治理](references/owner-governance.md)、[运行契约](references/goal-contract.md) 和 [恢复约定](references/templates.md)；引用 digest 未变时不重复读取。

Planner 必须显式使用 `$parallel-task-planner`，Planner Reviewer 使用 `$planner-reviewer`，Supervisor 使用 `$sub-thread-task-supervisor`，Owner/Implementation Review 使用 `$sub-thread-goal-worker`，配置使用 `$setup-sub-thread-workflow`，Dashboard 由 Main 直接调用 `$start-dag-dashboard`。

## 硬规则

1. 模型只提交最小语义输入；ID、attempt、token、revision、digest、timestamp、路径、默认字段、状态迁移及结构化文件均由脚本生成。
2. 禁止模型直接编辑配置、Plan、State、Result、Progress、Registry、Owner Capsule 或 Review JSON。
3. Supervisor 只通过 `supervisor-next/supervisor-record` 取得并持久化紧凑动作，再调用 `wait_threads`；Main 不读取监督文件或完整执行线程结果。
4. 并行数范围 1–8。不得为了填满槽位拆分存在真实依赖的任务。
5. Runtime Actor 不是模型角色。source、scope、diff、schema、evidence、progress 和 commit readiness 均调用脚本。
6. 脚本 JSON 只作机器收据，禁止复制到 commentary、final 或普通聊天；完整 DAG、Binding、Result、Review、Progress、diff 和日志只落本地文件。

## 工作流配置

工作流开始时运行一次；文件不存在会自动创建：

```text
workflow-config.mjs init <workspace>
workflow-config.mjs show <workspace>
```

配置只有 `parallel` 及 `profiles.planner/owner/review/supervisor`。每轮 reserve 和创建任何新 LLM 子线程前必须再次 `show`：`parallel` 立即影响后续 reserve，profile 只影响之后新建的线程；已经存在的线程不强制更换。

- Planner、Composite Planner：`profiles.planner`
- Owner Worker：`profiles.owner`
- Planner Reviewer、Implementation Review：`profiles.review`
- Supervisor：`profiles.supervisor`，默认 `gpt-5.6-luna/medium`
- 其它未明确覆盖的 LLM 子线程：`gpt-5.6-sol/high`

## 生命周期

本平台固定使用 `standalone_thread`，不调用 Codex 原生 Goal。Owner 变化等待用户时保持本地工作流暂停；应用成功后提示用户可以继续执行。

初始顺序固定为：

```text
配置 init + show
→ owner-registry init；已有 Registry 则幂等读取
→ Registry 无已批准 Owner 时走 Owner 创建与用户批准流程
→ owner-registry validate
→ goal-create + goal-validate
→ thread-registry init，登记唯一 Main 路由
→ Planner 生成 PLAN_INPUT_V1
→ plan-create 机械校验并保存 DAG draft
→ planner-review-context --compact
→ Planner Reviewer 独立审查
→ planner-review-submit
→ activate
→ Main 启动 Dashboard
→ Main 创建并命名 Supervisor
→ reserve / Supervisor wait_threads
```

Planner Reviewer 返回 `revise` 时，Planner 通过 `plan-revise` 只修订一次，再运行第二轮 context/review。第二轮仍需修改时停止并通知 Main，禁止循环。`activate` 成功前不得 reserve，也不得启动 Dashboard。

Dashboard 启动失败只影响查看：Main 报错后继续业务 DAG，并允许稍后重试。成功时只向用户报告一次 URL；runtime 自动维护 `progress.json` 和 `events.jsonl`。

## 主线程与线程登记

Main 标题使用 `goal-validate.thread_titles.main`，格式为 `[GA][任务][主控] <中文目标>`。扫描当前 workspace 后，未结束且角色为主控的 Main 必须恰好一个；发现多个时立即停止，不创建子线程。用 `thread-registry` 脚本登记 Main 和模型线程，内部 id 不进入可见标题。

`create_thread` 不接受 `title` 或 `name`。每个新线程必须按以下顺序初始化：

```text
create_thread
→ 取得正式 threadId；若只返回 clientThreadId，则等待初始化完成
→ 创建者通过 send_message_to_thread 通知新线程自己的 threadId 和 canonical title
→ 新线程立即调用 set_thread_title({ threadId, title })
→ 设置成功后再登记、bind 和执行任务
```

Main 创建 Supervisor，Supervisor 创建执行线程；两者的创建提示都必须明确要求新线程先完成上述改名。不得把标题参数伪造到 `create_thread`，也不得用 `clientThreadId` 代替正式 `threadId`。

系统 key 只含小写字母、数字和下划线。所有可见标题必须逐字使用脚本收据，不得由模型翻译或拼入 owner_id/task_id/thread_key：

- `[GA][任务][主控] <中文目标>`
- `[GA][任务][规划] <中文任务>`
- `[GA][任务][子图规划] <中文父任务>`
- `[GA][任务][规划审查] <中文任务>`
- `[GA][任务][责任域] <中文任务>`
- `[GA][任务][实现审查] <中文任务>`
- `[GA][任务][监督] <中文目标>`

Planner 生成的 task `title` 必须包含中文，否则 runtime 拒绝 Plan。Owner 线程复用到新任务时也必须先改成当前脚本标题。不得创建第二个 Supervisor、Dashboard 刷新或 Runtime 模型线程。Main 创建 Supervisor 后，取得正式 threadId，再通知它自行设置 canonical 标题。

## 调度循环

每轮严格执行：

```text
status --compact
→ reconcile --compact
→ reserve --compact，最多补满 config.parallel 个 active task
→ 立即执行所有 run_script action
→ 用 Goal 目录唤醒 Supervisor
→ Supervisor 调用 supervisor-next，创建/复用、bind 并投递模型线程
→ Supervisor 用 wait_threads 等待最多 8 个目标并通过 supervisor-record 保存 cursor
→ Supervisor 只通知 Main 终态 task/thread/status
→ Main 只把 result_ref 交给 finish 脚本做机械验收，不直接读取 Result
→ 补满空余槽位
```

`run_script` action 仍由 Main 直接调用其 `runtime-execute` 命令，不创建、登记或等待线程。Supervisor 不读取原始 Plan/State/Registry、完整 DAG、Worker 聊天或结果正文；只执行 `$sub-thread-task-supervisor` 的两个脚本入口。模型线程通过 Supervisor receipt 的 `dispatch` 自行取得 `TASK_BINDING_V6`。

Supervisor 的机器通知可以包含 result_ref，但用户可见消息不得包含它。线程终态而 Result 无效时只说“线程已结束，但尚未生成有效结果”；只有 `finish` 返回的脚本消息才可称为“任务完成”。Supervisor 不判断结果、不决定 retry/reclaim，也不向用户输出普通 running 状态。

## 静默与摘要

- 需要传给其他线程的内容直接使用 `send_message_to_thread`，当前聊天不重复。
- 线程之间只传必要标量、文件引用和不超过 100 字的脚本摘要；禁止粘贴 JSON 代码块、完整 stdout、DAG、任务正文、代码、diff、结果或日志。
- `supervisor-next` 的 create/wait/stalled/notify 每类最多 8 项。没有状态变化时不发用户可见消息。
- 创建或监控集合变化时，Main 可以列出最多 8 个脚本生成的中文标题。
- 错误只报告一句原因与脚本给出的日志路径。原始 JSON 只有用户明确要求时才能展示。

## Composite Planner

Owner Worker 在任何可归因业务修改前发现需要拆解时，调用 `subgraph-request` 并结束当前 attempt。随后 Composite Planner 使用 `$parallel-task-planner` 和 `profiles.planner` 生成 `TASK_SUBGRAPH_INPUT_V1`：

- child 使用 `T2-1/T2-2/T2-3`；
- 声明内部依赖及 entry/exit；
- 保留父节点的外部依赖边界；
- 不修改业务代码。

runtime 校验并 `expand-subgraph` 后，由普通 Owner Worker 执行子节点。

## Review、Owner 变化与完成

Planner Reviewer 是激活前门禁，不是 DAG 节点。Implementation Review 仍是显式 `role: review` 节点，并使用独立 Review 线程；机械验收不是 Review。

Owner 变化是用户决策，期间暂停当前 DAG：`request → validate-change → 用户确认 → approve-change → apply-change → owner transition delta`。所有文件由脚本写入；仓库存在多个 active Goal 时脚本拒绝变更，先完成其他 active Goal。

只有 coverage、Implementation Review/verify、blocking findings、scope 与 delivery gate 全部通过才 `finalize`。Main 只向用户报告 Dashboard URL、Owner 决策、真实阻塞、疑似挂死、已验收 task 最终结果和 Goal 完成；不得持续报告普通 running 状态、Planner 过程、测试过程、Delta 准备或完整 DAG/Mermaid。
