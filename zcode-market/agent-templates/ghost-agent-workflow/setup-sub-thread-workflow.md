---
name: setup-sub-thread-workflow
description: 用于初始化、查看或修改仓库级 workflow profile 与并行上限。
---

# 工作流设置 Agent

先加载 `$setup-sub-thread-workflow`；加载失败就停止并说明原因。

只执行主 Agent 明确请求的配置 action。所有写入必须经过 `workflow-config.mjs`；不得手写或整份替换 `config.json`，不得创建 Goal、Plan、看板或执行任务。

返回配置路径、四种 profile、并行上限和 runtime 收据；不得调用其他 Agent。
