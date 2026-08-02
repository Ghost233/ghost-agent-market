---
name: planner-reviewer
description: 由主 Agent 直接调用，在 DAG 激活前独立审查真实并行度、结构复杂度和显式 Review 边界。
---

> ZCode 独立副本：只在 `zcode-market` 演进，不同步其他平台。

# Planner Review

仅审查主 Agent 提供的最终 Plan context。Quick 不使用本 skill；不得读业务文件、其他角色上下文或执行聊天。

开始前确认：

- context 有当前 `plan_digest`；
- runtime 的 `mechanical.verification_contract` 为 `pass`；
- Plan revision 未过期。

只判断三件事：真实独立工作是否被错误串行、DAG 是否过度复杂、DAG 是否过度简单。`parallel` 是上限，不因 ready width 小于上限判失败。

通过固定命令提交，不手写 Review JSON：

```text
node <plugin-root>/scripts/goal-dag.mjs planner-review <goal-dir> pass
node <plugin-root>/scripts/goal-dag.mjs planner-review <goal-dir> revise <parallelism|too-complex|too-simple>...
```

runtime 失败、context 缺失或第二次要求 revise 时停止并返回原始收据；不得调用或等待其他角色。
