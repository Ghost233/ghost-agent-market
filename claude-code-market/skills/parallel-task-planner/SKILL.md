---
name: parallel-task-planner
description: |
  当用户提供自然语言需求或已有计划文档，并希望在确认安全时自动并发推进时使用。
  将输入转换为可执行的并发模块计划；仅在可写范围、依赖和验证均通过安全门禁时，调用
  `thread-coordination` 的 `parallel-plan` 模式。无法证明安全时只交付计划，不自动分派。
---

# Parallel Task Planner

## 目标

把一个已经具备可执行信息的需求或计划文档，整理为短小、可审计的并发模块计划。规划器只负责输入归一化、最少量的冲突检查、计划写入和安全分派；不维护长期模块归属，也不替 coordinator 或 worker 实现业务改动。

## 输入与最少检查

接受以下任一种输入：

- 自然语言：目标、已知范围、完成条件、约束或验证偏好。
- 计划文档路径：保留其中已经确定的决策，只将可执行工作提取为模块。

只读取确认目标文件、可写范围、依赖和验证冲突所需的最少仓库内容。不要为了制造并发而扩张需求或猜测隐式接口；无法确认时保留证据并输出 `needs_user_review`。

## 并发计划契约

每次规划都写入：

```text
docs/parallel-task-plans/YYYY-MM-DD-<goal-slug>.md
```

计划必须使用以下字段：

```yaml
parent_goal: <一句话结果>
source: natural_language | <计划文档路径>
modules:
  - id: M1
    task: <单一可执行结果>
    writable_paths:
      - <窄路径或 glob>
    depends_on: []
    done_when:
      - <可观察完成条件>
    verification:
      - <定向命令或替代证据>
    worker_context: <执行所需的最少上下文>
safety:
  status: parallel_safe | sequential_only | needs_user_review
  reasons:
    - <判定证据>
dispatch:
  batches:
    - [M1, M2]
```

所有 module 必须可追溯到 `parent_goal` 的完成条件。`writable_paths` 不得使用无法判断冲突的宽泛范围；共享 API、迁移、生成输出、全局配置和同一文件必须归属一个模块，或被放入后续串行 batch。

## 安全门禁

只有以下条件全部成立时，`safety.status` 才可写为 `parallel_safe`：

1. 至少存在两个可执行模块。
2. 同一 batch 中的 `writable_paths` 不重叠，且不存在未归属的共享契约。
3. 依赖图无环，batch 中每个模块的依赖均已完成。
4. 每个模块都有明确 `done_when` 和定向 `verification`。
5. 并行验证不会竞争同一可写产物或共享环境；会竞争的验证必须串行。
6. 全部模块合起来覆盖父目标的完成条件。

存在明确依赖但没有不确定性时，写 `sequential_only` 并保存计划，不自动并发。范围、依赖或共享契约有证据不足时，写 `needs_user_review`，说明缺少何种确认；绝不自动降级为“看起来能并发”。

## 自动交接

`parallel_safe` 计划写入并复查后，立即调用 `$thread-coordination`，传入计划绝对路径和 `parallel-plan` 模式。不要重复拆解模块，也不要转发完整聊天记录。

在 Claude Code 中，coordinator 使用 agent team 的稳定队员 name 执行每个 ready module；规划器只提供 module 契约和 batch 顺序。它不直接创建 worker、修改实现文件、验证业务结果或替 coordinator 决定补修。

`sequential_only` 与 `needs_user_review` 只返回计划和判定证据，不调用 coordinator。用户修改计划后可重新运行本 skill。

## 输出

最终回复必须说明：计划路径、`safety.status`、模块及 batch、自动分派是否发生、未分派原因和仍需用户确认的事项。不得把“计划已生成”表述为父目标已经完成。

## 非目标

- 不维护长期 ownership registry 或 thread 亲和性。
- 不通过猜测把串行工作拆成并发工作。
- 不要求每个模块都运行全项目构建。
- 不替 worker 修改代码，也不接管 coordinator 的总验收。
