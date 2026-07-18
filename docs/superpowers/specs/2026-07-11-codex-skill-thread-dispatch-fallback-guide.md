# Codex Skill 独立执行线程与启动回退设计指南

> 历史设计，已被当前 `git-commit` skill 取代。当前实现必须先使用 `git_commit_worker:gpt-5.3-codex-spark/high`；只有运行时错误明确证明该 Spark profile 不可创建或不可运行时，才允许一次 `gpt-5.6-luna/medium` fallback。本文其余执行线程、回退强度和回传流程不得作为当前实现依据。

## 1. 文档目的

本文总结 `git-commit` skill 从主任务直接执行、内部委派尝试，演进到“用户可见执行任务 + 启动确认 + 单次模型回退”的原因与最终方案。

这套模式适合以下 skill：

- 工作可以独立完成，不需要源任务持续参与。
- 希望使用指定模型和思考强度执行。
- 需要在同一项目、同一 checkout 中继续工作。
- 执行成功后无需回传，失败时才通知源任务。
- 启动失败时可以切换到更稳定的模型，但必须避免重复执行写操作。

本文只讨论 Codex App 的用户可见任务接口。

## 2. 背景与目标

最初需求不是建立重量级跨任务调度系统，而是让一个轻量 skill 完成以下事情：

1. 源任务只负责创建执行任务。
2. 执行任务使用明确的模型和思考强度。
3. 执行任务独立完成全部工作。
4. 成功时静默结束，不要求源任务继续追踪。
5. 失败时向源任务发送一次结构化通知。
6. 执行任务保留在侧边栏，不自动归档。

`git-commit` 的当前配置是：

```text
主模型：gpt-5.3-codex-spark / high
回退模型：gpt-5.6-luna / xhigh
环境：同一项目的 local checkout
标题：<时:分:秒>-git-commit
```

其他 skill 应把这些值视为可替换 profile，而不是复制成固定配置。

## 3. 真实运行中发现的问题

### 3.1 创建成功不等于模型已经开始执行

`create_thread` 返回 thread id 只证明创建请求被接受。新任务可能先表现为：

```text
status: active / inProgress
items: []
```

此时还没有模型 reasoning、助手回复或工具调用，不能认定任务已经真正运行。

### 3.2 启动阶段的 systemError 无法由执行任务自行通知

执行任务的失败通知依赖它调用 `send_message_to_thread`。如果模型尚未开始就发生 `systemError`，提示词没有执行机会，因此也无法通知源任务。

这意味着启动错误必须由调度状态检测，而不能只依赖执行任务自报失败。

### 3.3 读取接口和命名接口存在独立的可见性延迟

真实运行中出现过以下情况：

- `read_thread` 已经能读取任务。
- `set_thread_title` 同时返回找不到 thread id。
- 稍后再次命名又可以成功。

因此，命名失败不能等同于创建失败，也不能阻断健康检查或模型回退。

### 3.4 状态字段不足以证明真正启动

单独出现 `running`、`active` 或 `inProgress` 不够。真正启动至少还要看到一条由执行任务产生的记录，例如：

- reasoning。
- 助手回复，例如“思考中”或预检说明。
- 工具调用。
- 提交结果。

以下内容不能作为启动证据：

- 原始 `userMessage`。
- `codex_delegation` 包装。
- 空 items。
- 自动生成的标题。

### 3.5 模型回退存在重复写入风险

如果原模型已经执行了 Git 写操作，只是源任务没有及时看到，立即回退可能造成重复 stage、重复 commit 或冲突。

因此，只有同时满足以下条件才能自动回退：

1. 状态明确为 `systemError` 或其他终止失败。
2. 没有 reasoning、助手回复或工具调用。
3. 没有提交结果。
4. 能够确认没有 Git 写操作。

状态不明确时宁可报告“启动未确认”，也不能冒险重复执行。

## 4. 最终架构

Skill 分为两个互斥状态。

### 4.1 调度状态

源任务只负责：

1. 解析项目和 checkout。
2. 创建执行任务并指定 profile。
3. 把源任务 ID 交给执行任务。
4. 确认执行任务真正启动。
5. 在安全条件满足时执行一次模型回退。
6. 报告 thread id、标题和启动结果后停止追踪。

源任务不得 stage、commit、push 或承担执行任务的实际工作。

### 4.2 执行状态

执行任务通过独占标记识别自身，例如：

```text
GIT_COMMIT_EXECUTOR=1
```

检测到标记后必须：

1. 跳过调度流程。
2. 从 `codex_delegation.source_thread_id` 读取 `SOURCE_THREAD_ID`。
3. 不再创建、fork、spawn 或委派其他任务。
4. 直接完成领域工作。
5. 成功时只在当前任务报告并自然结束。
6. 失败时向 `SOURCE_THREAD_ID` 通知一次。

## 5. 启动确认状态机

最多查询三轮，第一轮不等待。

```text
create_thread
  -> 第 1 轮：立即 read_thread
  -> 尝试命名
  -> 立即判断
       -> 已真正启动：结束确认
       -> 安全可确认的 systemError：立即 fallback
       -> 状态不明确：等待 10 秒
  -> 第 2 轮：read_thread，尝试命名，立即判断
       -> 已真正启动：结束确认
       -> 安全可确认的 systemError：立即 fallback
       -> 状态不明确：等待 10 秒
  -> 第 3 轮：read_thread，尝试命名，立即判断
       -> 已真正启动：结束确认
       -> 安全可确认的 systemError：立即 fallback
       -> 仍不明确：报告“启动未确认”并停止
```

命名成功后不再重复命名。命名连续失败只作为警告，不改变启动判断。

### 5.1 判断表

| 读取结果 | 执行记录 | 处理 |
|---|---|---|
| `active` / `inProgress` | reasoning、助手回复或工具调用 | 确认启动，停止查询 |
| 正常完成 | 有执行记录或结果 | 确认已运行完成 |
| `systemError` | 只有原始用户消息，无写操作 | 立即安全回退 |
| `active` / `inProgress` | items 为空 | 状态不明确，进入下一轮 |
| 暂时找不到任务 | 无法判断 | 进入下一轮 |
| 用户中断 | 任意 | 不自动回退 |
| 存在工具调用或可能写入 | 任意失败状态 | 不自动回退，避免重复执行 |

## 6. 模型回退规则

回退使用原任务，而不是再创建一个新任务：

```text
send_message_to_thread:
  threadId: <原执行任务 ID>
  model: <FALLBACK_MODEL>
  thinking: <FALLBACK_THINKING>
  prompt: <带执行标记的一次性回退包>
```

回退包必须说明：

- 这是一次性 fallback。
- 沿用原仓库、授权范围、`SOURCE_THREAD_ID` 和 checkout。
- 从领域预检开始执行。
- 不得再次 fallback。
- 不得再次委派。

不要传入模型不支持或不需要的参数，例如：

```text
reasoning.summary
reasoning.summary_level
summary
service_tier
priority
```

回退请求成功后，源任务停止读取、等待、轮询或干预。回退模型若在真正启动前再次发生平台错误，执行任务仍无法自行通知，这是当前轻量方案接受的剩余限制。

## 7. 源任务 ID 与失败通知

`create_thread` 会把源任务 ID 放入委派元数据：

```xml
<codex_delegation>
  <source_thread_id>...</source_thread_id>
</codex_delegation>
```

执行任务必须在任何写操作前读取非空的 `SOURCE_THREAD_ID`。缺失时不得猜测，也不得开始写操作。

失败通知采用固定结构：

```text
[<skill-name> 执行失败]
线程：<title>
阶段：<stage>
错误：<raw error>
已完成：<results or none>
状态：<remaining state>
```

通知只发送一次，省略 model 和 thinking，使源任务保持原 profile。无论通知成功或失败，执行任务都不重试、不等待源任务响应。

## 8. 通用调度模板

其他 skill 可以替换下列占位符：

```text
EXECUTOR_MARKER=<唯一执行标记>
PRIMARY_MODEL=<主模型>
PRIMARY_THINKING=<主思考强度>
FALLBACK_MODEL=<回退模型>
FALLBACK_THINKING=<回退思考强度>
TASK_TITLE=<任务标题规则>
DOMAIN_PREFLIGHT=<领域预检入口>
```

调度伪代码：

```text
thread_id = create_thread(primary_profile, executor_package)
title_ok = false

for round in 1..3:
    if round > 1:
        wait 10 seconds

    snapshot = read_thread(thread_id)

    if not title_ok:
        title_ok = try_set_title(thread_id)

    if has_executor_activity(snapshot) and is_running_or_completed(snapshot):
        report_started_and_stop()

    if is_terminal_startup_error(snapshot) and proves_no_writes(snapshot):
        send_one_fallback(thread_id, fallback_profile)
        report_fallback_and_stop()

    if is_interrupted(snapshot) or writes_are_uncertain(snapshot):
        report_unconfirmed_and_stop()

report_unconfirmed_and_stop()
```

## 9. 执行任务领域流程

线程调度只解决“在哪里、用什么模型、是否真正启动”的问题，不能替代领域约束。

以 Git 提交为例，执行状态仍然必须独立保证：

- 检查仓库指令和 Git 身份。
- 区分 staged、unstaged、untracked 和 submodule 变更。
- 检查敏感文件。
- 使用显式路径 stage，不使用宽泛 `git add`。
- 按最深 submodule 到主工程的顺序提交。
- 每批提交前复核 cached diff 并运行 `git diff --cached --check`。
- 不绕过 hooks，不 push，不切换分支，不创建 worktree。

迁移到编译、测试、发布或文档 skill 时，应保留调度状态机，但替换为对应领域的预检、执行和完成条件。

## 10. 常见错误

### 把 create_thread 成功当成执行成功

错误。它只证明任务已创建，必须读取执行记录。

### 把 running 状态当成执行成功

错误。`running` 配合空 items 仍可能尚未进入模型执行。

### 命名失败就停止整个流程

错误。命名是非关键操作，可能存在独立的可见性延迟。

### systemError 后继续等待所有轮次

没有必要。只要第一轮已经确认是无执行记录、无写操作的终止错误，就应立即回退。

### 状态不明确时强制回退

危险。原模型可能正在执行写操作，会造成重复执行。

### 回退时创建第二个用户可见任务

通常没有必要。优先在原执行任务上使用 `send_message_to_thread` 切换 profile，减少重复任务和上下文分裂。

### 成功后继续追踪或自动归档

违背轻量化目标。确认启动后应停止追踪，执行任务完成后自然结束并保留。

## 11. 迁移检查清单

### 调度状态

- [ ] 使用 `create_thread` 创建用户可见任务。
- [ ] 明确传入主模型和思考强度。
- [ ] 使用独占执行标记防止递归创建任务。
- [ ] 执行包包含仓库、范围和领域入口。
- [ ] 第一轮立即读取，不盲等。
- [ ] 最多三轮，后续轮次间隔 10 秒。
- [ ] 以执行记录而不是状态字段单独判断启动。
- [ ] 命名失败不阻断健康判断。
- [ ] 只有安全可确认的启动失败才 fallback。
- [ ] fallback 只执行一次。
- [ ] 确认启动或 fallback 后停止追踪。

### 执行状态

- [ ] 读取并验证 `SOURCE_THREAD_ID`。
- [ ] 检测执行标记后跳过调度流程。
- [ ] 不再创建、fork、spawn 或委派。
- [ ] 直接执行领域预检与写操作。
- [ ] 成功时不通知源任务。
- [ ] 失败时只通知一次。
- [ ] 不自动归档。

### 验证

- [ ] 测试创建后立即可读但 items 为空。
- [ ] 测试第一轮立即出现 systemError。
- [ ] 测试先 active/empty，下一轮变为 systemError。
- [ ] 测试出现 reasoning 或助手回复后提前结束查询。
- [ ] 测试读取成功但命名暂时失败。
- [ ] 测试存在工具调用时禁止自动 fallback。
- [ ] 测试 fallback 使用原 thread id 和正确 profile。
- [ ] 测试成功不回传、失败单次回传。

## 12. 核心结论

这套模式的关键不是“创建一个新任务”，而是明确区分三个事件：

1. 任务已经创建。
2. 模型已经真正开始执行。
3. 执行任务已经完成或失败。

`create_thread` 负责第一个事件，执行记录负责证明第二个事件，领域结果与失败通知负责第三个事件。只有把三者分开，模型回退才能既快速又不造成重复写入。
