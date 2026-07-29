---
name: start-dag-dashboard
description: 从指定工作目录的 .ghost-agent-workflow 数据启动已激活 Goal DAG 的本地只读进度网页。用户明确要求启动看板，或 sub-thread-coordination 在 Plan 激活后启动 Dashboard 时使用；只启动服务，不创建模型线程、不执行或修订 Goal、不持续轮询。
---

# 后台启动 DAG 看板

只负责启动后台看板并返回 URL。

由 Main 直接调用后台 Node 启动器。不得创建用于刷新看板的模型线程。不要创建 Goal、生成计划、调度 task、修改 DAG 状态、打开浏览器、停止服务或持续监控。

1. 取得脚本收据中的 DAG worktree 绝对路径；不得从用户原始工作区启动。
2. 运行后台启动器；不要追加 `nohup`、`&` 或 shell job control：

```bash
node <plugin-root>/scripts/start-dashboard.mjs <workspace> [--goal <goal-id>] [--port 57357]
```

3. 启动器必须从 `<workspace>/.ghost-agent-workflow` 发现并校验已激活的 `goal.json`、`goal-state.json`、`plan.json` 和 `state.json`。存在多个 active Goal 时传入 `--goal`；无法唯一选择时停止并报告候选。
4. 只接受 `DAG_DASHBOARD_START_V1`。所有实例使用同一固定端口：第一个绑定成功的实例成为主看板，其他实例登记为参与者并向主看板推送变化；不得因端口已由合法看板占用而改用其他端口或停止它。
5. `started` 或 `already_running` 时只向用户报告一次共享 `url`。网页顶部按工作区文件夹显示项目 Tab；同一入口可切换多个运行中的 Goal。
6. 主看板退出后，参与者必须自动竞争固定端口并由成功者接管。Workflow 清理生命周期文件或 Plan/State 后，仅对应参与者退出并清理自己的启动收据与日志。失败时原样报告；协调工作流中 Dashboard 失败不使业务 DAG 失败，Main 可以稍后重试。

runtime 自动维护 `progress.json` 和 `events.jsonl`，模型不得写入。参与者通过文件监听向主看板推送，浏览器通过 SSE 接收更新，不定时刷新页面数据。默认仅绑定 `127.0.0.1`；远程访问必须由用户明确授权。
