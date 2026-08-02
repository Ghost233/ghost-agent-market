---
name: setup-sub-thread-workflow
description: 初始化、查看或修改仓库级 workflow profile 与 1–8 的并行上限；只通过配置脚本工作。
---

> ZCode 独立副本：只在 `zcode-market` 演进，不同步其他平台。

# Workflow 设置

只管理 `<workspace>/.ghost-agent-workflow/config.json`。不得手写、整份替换或格式化配置。

初始化或读取：

```text
node <plugin-root>/scripts/workflow-config.mjs ensure <workspace>
```

默认 profile 为 `main`、`planner`、`owner`、`review`；`parallel` 范围为 1–8。Quick 始终串行，DAG 使用该上限但不要求填满。

修改只能使用：

```text
node <plugin-root>/scripts/workflow-config.mjs set-parallel <workspace> <1-8>
node <plugin-root>/scripts/workflow-config.mjs set-profile <workspace> <main|planner|owner|review> <model> <effort>
```

修改后运行 `validate` 和 `show`，只接受 `THREAD_WORKFLOW_CONFIG_RECEIPT_V1`。返回路径、profile、并行上限和完整收据；不要创建 Goal、Plan、看板或执行任务。
