---
name: sub-thread-coordination
description: 将一个请求整理成 Quick 或 DAG，并生成只含一个下一角色的 workflow task package。
---

> ZCode 独立副本：只在 `zcode-market` 演进，不同步其他平台。

# Workflow 协调

只负责模式确认、范围整理和下一步 receipt；不执行实现，不直接调用其他角色。

## 模式

- `Quick`：当前 workspace 的一次串行工作。
- `DAG`：runtime 管理依赖、scope 和验证，只有存在真实独立工作或显式 Review 时使用。

没有明确模式时只返回选择题，不替用户猜测。选择后只传递简短、稳定的用户目标，不把时间戳、路径或完整聊天内容塞进 runtime 输入。

初次创建 workflow 时，`runtime_action` 使用以下命令之一，并把简短目标通过 stdin 原样提供：

```text
node <plugin-root>/scripts/goal-dag.mjs workflow start <workspace> quick
node <plugin-root>/scripts/goal-dag.mjs workflow start <workspace> dag
```

## Task package

只输出以下字段，并且每次只指定一个 `agent`：

```text
mode: Quick | DAG
goal: 简短目标
workspace: 仓库绝对路径
agent: 下一角色 agent 名称
scope: 可修改或只读范围
verification: 必须执行的验证入口
runtime_action: 下一条脚本 action
```

runtime 只通过 `<plugin-root>/scripts/goal-dag.mjs` 和 `workflow-config.mjs` 管理状态。失败、输入缺失或 receipt 过期时停止；不手写 JSON，不扩大 scope，不调用、等待或通知其他 Agent。
