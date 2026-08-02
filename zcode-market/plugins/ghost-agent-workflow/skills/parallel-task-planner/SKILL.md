---
name: parallel-task-planner
description: 由主 Agent 直接调用，用于存在真实独立工作或需要显式 Review 的任务，生成最小 DAG、必要 delta 或内部子图。
---

> ZCode 独立副本：只在 `zcode-market` 演进，不同步其他平台。

# 最小 DAG Planner

只在主 Agent 已选择 `DAG`，或 runtime 明确请求升级/修订时使用。只做语义规划，不执行代码、不修改业务文件、不手写 Plan/State/JSON。

## 输入与读取

1. 使用主 Agent 提供的 `goal-dir` 和当前 runtime receipt；不要从聊天历史猜字段。
2. 首次使用或 digest 改变时读取 [Planner 输入契约](references/templates.md)。
3. 反复调用 `node <plugin-root>/scripts/goal-dag.mjs planner-open <goal-dir> [cursor]`，直到 `next_cursor` 为空；只使用收据中的 source block、Owner Registry 和 Capsule。

## 规划规则

- 初始 Plan 只生成最小顶层节点；每个节点必须有真实并行、职责隔离或独立验证价值。
- Review 必须是显式 `role: review` 节点；机械 gate 不是 Review。
- task 只引用顶层 `verifications` 中的短 id；验证命令必须是 argv 数组，不能塞进 task。
- Owner 只能使用已批准的 Owner；不猜测、不擅自 rebind，不等待无关分支。
- 初始节点不带 parent/child；只有 runtime 请求 subgraph 时才生成内部节点并保留外部边。

## 提交

只通过 runtime stdin 提交：

```text
node <plugin-root>/scripts/goal-dag.mjs planner-submit <goal-dir> initial
node <plugin-root>/scripts/goal-dag.mjs planner-submit <goal-dir> revise
node <plugin-root>/scripts/goal-dag.mjs planner-submit <goal-dir> delta
node <plugin-root>/scripts/goal-dag.mjs planner-submit <goal-dir> subgraph <run-id>
```

Reviewer 最多要求一次 `revise`。required effects、schema、依赖或 gate 校验失败时，在当前调用修正最小输入；不要手写默认字段或等待其他角色补救。

runtime 命令失败、输入过期或 Owner 未获批准时停止并返回原始收据。输出只包含已执行 action、digest 和下一步所需输入。
