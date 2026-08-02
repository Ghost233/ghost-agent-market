---
name: start-dag-dashboard
description: 用户要求查看进度或 Plan 激活后需要看板时使用，从 DAG 数据启动本地只读页面并返回 URL。
---

> ZCode 独立副本：只在 `zcode-market` 演进，不同步其他平台。

# DAG 看板

只启动看板，不创建 Goal、Plan、任务或角色，不修改 workflow 状态，不持续监控。

1. 使用 runtime receipt 中的 DAG workspace；不要从用户原始 workspace 启动。
2. 不追加 shell job control，运行：

   ```text
   node <plugin-root>/scripts/start-dashboard.mjs <workspace> [--goal <goal-id>] [--port 57357]
   ```

3. 只接受 `DAG_DASHBOARD_START_V1`；多个 active Goal 时必须明确传 `--goal`。
4. `started` 或 `already_running` 只返回一次 URL。默认绑定 `127.0.0.1`；远程访问必须得到用户明确授权。

runtime 负责 progress/events 文件和生命周期；启动失败原样返回，不改用其他端口或手写状态。
