# 并发任务规划 Skill 设计

## 目标

新增轻量 `$parallel-task-planner` skill：它把自然语言需求或已有计划文档转成一份小而可执行的并发任务计划。计划通过明确的安全门禁后，立即交给 `$thread-coordination`；后者把彼此独立的模块分派给 `$thread-goal-worker`，并完成简单的整体完成度校验。

该设计面向用户已知或初步判断可并发的任务。它不建立持久 ownership 注册表、不提供跨 thread goal 控制，也不发展成通用项目管理系统。

## 输入入口

规划 skill 支持两种输入：

1. 包含目标和已知约束的自然语言需求。
2. 既有计划文档的路径。规划 skill 保留其中的既定决策，只把可执行工作转换为模块。

它只读取确认路径、依赖和写入冲突风险所需的最少仓库信息。若无法根据输入和这些证据确认安全并发，就不自动分派 worker。

## 输出契约

规划 skill 在以下位置写入一份简洁的交接文档：

```text
docs/parallel-task-plans/YYYY-MM-DD-<goal-slug>.md
```

文档使用稳定的结构：

```yaml
parent_goal: <一句话目标>
source: natural_language | <计划文档路径>
modules:
  - id: M1
    task: <单一、可执行的结果>
    writable_paths:
      - <路径或窄 glob>
    depends_on: []
    done_when:
      - <可观察的完成条件>
    verification:
      - <定向命令或等价证据>
    worker_context: <执行所需的最少来源上下文>
safety:
  status: parallel_safe | sequential_only | needs_user_review
  reasons:
    - <决策证据>
dispatch:
  batches:
    - [M1, M2]
```

这份计划是协调 skill 唯一消费的交接契约。它替代冗长的聊天记录转发，并保留“为何可并发执行”的可审计依据。

## 安全门禁

只有满足以下全部条件，`safety.status` 才能是 `parallel_safe`：

- 至少有两个可执行模块。
- 每个模块的可写范围窄且不重叠。共享文件、API 契约、迁移、生成产物和全局配置必须归属单一模块或被串行化。
- 依赖图无环；一个 batch 中的模块均已满足其依赖。
- 每个模块都有可衡量的 `done_when` 和定向验证方式。
- 验证命令及其产物不会与同时运行的模块竞争；存在冲突的验证应移入后续 batch。
- 父目标的完成条件被一个或多个模块完整覆盖。

无法确认可写范围、发现隐藏的共享契约，或任务信息不完整时，计划标记为 `needs_user_review`。存在真实依赖但没有歧义时，计划标记为 `sequential_only`：仍写入文档，但不自动并发执行。

## 自动分派

对 `parallel_safe` 计划，规划 skill 立即以生成的计划路径调用 `$thread-coordination`，而不再次拆解任务。

`thread-coordination` 新增轻量 `parallel-plan` 模式：

1. 读取计划，把每个已就绪模块分派给一个 worker thread。
2. 保证写入范围隔离，并遵守计划定义的 batch。
3. 收集每个模块的简洁结果。
4. 检查计划覆盖、声明的验证、跨模块文件冲突、未解决项，以及在允许时执行只读的 `git diff --check`。
5. 对失败或不完整模块仅向其 owner worker 发起一次定向补修。
6. 相对于 `parent_goal` 报告 `completed`、`partial` 或 `blocked`。

协调线程不编辑实现文件，也不维护持久 thread 或模块注册表。仅当可见的近期上下文确实覆盖某一模块时才复用现有 thread；否则仍遵守现有的用户可见 thread 创建规则。

## Worker 循环

`thread-goal-worker` 新增轻量 `parallel-plan` worker 模式。它每次仅接收一个模块，执行一个有边界的循环：

```text
设置/确认 child goal -> 检查 scope 内状态 -> 实现 -> 验证 -> 检查自身 diff -> 最多修复一次 -> WORKER_RESULT
```

worker 保留已有的 active-goal 和 scope 保护，但该模式将强制 reviewer-subagent 流程替换为对 scope 内 diff、`done_when` 和验证结果的简单自检。它不得创建、路由或管理其他 thread。验证失败或范围问题未解决时，返回 `blocked` 或 `needs_fix`，不得宣称完成。

最小结果结构为：

```yaml
module_id: M1
status: completed | needs_fix | blocked
changed_files: []
verification: []
diff_self_check: pass | failed
goal_alignment: <done_when 如何被满足>
risks: []
```

## 有上限的双循环

系统只包含两个小且明确有上限的循环：

- 协调循环：分派 -> 等待结果 -> 检查整体完成度 -> 最多一次补修 -> 完成、部分完成或阻塞。
- Worker 循环：实现 -> 验证 -> diff 自检 -> 最多一次修复 -> 返回结果。

不引入跨 thread goal 变更、暂停重置状态机，或超出这些上限的自动重试。worker 暂停、失败或不可访问时，向协调线程报告不可用；仅在该模块仍保持安全隔离时，协调线程可以做一次普通的补修或重新分派决定。

## 范围与非目标

该功能不会：

- 为了使用更多 worker 而把任意工作判断为可并发。
- 维护永久的模块归属或 thread 亲和性。
- 强制每个模块都运行全项目构建。
- 让协调线程静默修复 worker 的代码。
- 替代用户已有计划；它只保留既有决策并整理执行方式。

## Marketplace 变更

创建并保持同步：

- `claude-code-market/skills/parallel-task-planner/`
- `codex-market/plugins/ghost-agent-workflow/skills/parallel-task-planner/`

在新 skill 中增加符合现有目录布局的 Codex `agents/openai.yaml` 元数据。更新两个 marketplace 中既有的 thread skill，使它们的 `parallel-plan` 契约、结果字段和安全上限保持一致。

## 验证

实施完成后应检查：

1. 两个 marketplace 中的规划 skill 和 `parallel-plan` 文案语义一致。
2. 三个 skill 引用的名称和计划字段保持一致。
3. 自然语言样例能生成包含两个独立模块的 `parallel_safe` 计划。
4. 计划文档样例会保留依赖关系；可写范围冲突时得到 `sequential_only` 或 `needs_user_review`。
5. 协调 skill 包含“一轮补修”限制和最终完成度检查表。
