---
name: start-dag-dashboard
description: 在后台启动现有 Goal DAG 的本地只读进度网页。用户明确要求把 DAG 看板放到后台、启动或恢复进度网页服务时使用；只启动服务，不创建、执行或修订 Goal，不打开浏览器，不持续轮询。
whenToUse: 用户显式运行 /skill:start-dag-dashboard <plan.json绝对路径> 时使用；其它场景不得触发。
---

# 后台启动 DAG 看板

只负责启动已经存在的 DAG 看板服务并返回 URL。不要创建 Goal、生成计划、调度 task、修改 Goal/DAG 状态、打开浏览器、停止服务或持续监控。服务只通过 runtime 脚本原子维护 Goal 目录下固定的紧凑 `progress.json` 当前快照和追加式 `events.jsonl` 历史；模型不得直接写这两个文件。

1. 取得目标 Goal 的 `plan.json` 绝对路径。只有一个明确候选时可使用它；多个候选无法唯一判断时停止并要求用户给出路径。
2. 默认使用同目录的 `state.json`；用户明确给出其它 state 路径时使用其绝对路径。
3. 运行以下 Python 后台启动器，不要再追加 `nohup`、`&` 或 shell job control：

```bash
python3 ${KIMI_SKILL_DIR}/../../scripts/start-dashboard.py <plan.json> [state.json] [--port 7357]
```

4. 只接受 JSON 契约 `DAG_DASHBOARD_START_V1`。`status` 为 `started` 或 `already_running` 时，向用户返回 `url`、`progress_document_path`、`progress_document_url`、`progress_events_path` 与可分页抓取的 `progress_events_url`，并简短报告 `pid` 和 `log_path`（值为 `null` 时省略）；不得继续轮询。
5. `status: error` 或命令失败时原样报告错误，不得退回前台服务。

默认只绑定 `127.0.0.1`。只有用户明确要求跨机器访问并接受 Goal 元数据与 task result 摘要对局域网可见时，才传入非 loopback `--host` 与 `--allow-remote`。Kimi 通过 `KIMI_SKILL_DIR` 定位插件脚本并使用 `whenToUse` 声明显式入口，这是平台路径与元数据差异。
