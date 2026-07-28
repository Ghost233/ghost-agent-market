---
name: start-dag-dashboard
description: 从指定工作目录的 .ghost-agent-workflow 数据启动已激活 Goal DAG 的本地只读进度网页。用户明确要求启动看板，或 sub-thread-coordination 在 Plan 激活后启动 Dashboard 时使用；只启动服务，不创建模型线程、不执行或修订 Goal、不持续轮询。
whenToUse: 用户显式启动 Dashboard，或协调器在 Plan 激活后启动 Dashboard 时使用。
---

# 后台启动 DAG 看板

只负责启动后台看板并返回 URL。

由 Main 直接调用后台 Node 启动器。不得创建用于刷新看板的模型线程。不要创建 Goal、生成计划、调度 task、修改 DAG 状态、打开浏览器、停止服务或持续监控。

1. 取得目标仓库的工作目录绝对路径。
2. 运行后台启动器；不要追加 `nohup`、`&` 或 shell job control：

```bash
node ${KIMI_SKILL_DIR}/../../scripts/start-dashboard.mjs <workspace> [--goal <goal-id>] [--port 7357]
```

3. 启动器必须从 `<workspace>/.ghost-agent-workflow` 发现并校验已激活的 `goal.json`、`goal-state.json`、`plan.json` 和 `state.json`。存在多个 active Goal 时传入 `--goal`；无法唯一选择时停止并报告候选。
4. 只接受 `DAG_DASHBOARD_START_V1`。`started` 或 `already_running` 时只向用户报告一次 `url`；不得继续轮询。
5. 失败时原样报告。协调工作流中 Dashboard 失败不使业务 DAG 失败，Main 可以稍后重试。

runtime 自动维护 `progress.json` 和 `events.jsonl`，模型不得写入。看板通过文件监听与 SSE 推送更新，不定时刷新页面数据。默认仅绑定 `127.0.0.1`；远程访问必须由用户明确授权。
