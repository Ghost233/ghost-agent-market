---
name: setup-sub-thread-workflow
description: 初始化、查看或修改 Ghost Agent Workflow 的仓库级子线程配置，包括 Main、Planner、Owner、Review、Supervisor 的模型与推理强度，以及 1–8 的并行数量。用户要求 setup、配置子线程默认模型或修改 DAG 并发数时使用；只通过脚本管理配置，不创建或执行 Goal/DAG。
---

# 子线程工作流设置

只管理 `<workspace>/.ghost-agent-workflow/config.json`。不得手写、整份替换或直接格式化该文件。

## 初始化

取得当前 workspace 绝对路径，调用：

```text
node <plugin-root>/scripts/workflow-config.mjs ensure <workspace>
```

文件不存在时任一读取或修改命令都自动创建默认配置。默认值为：

- `parallel: 8`
- `main`: `gpt-5.6-sol/xhigh`
- `planner`: `gpt-5.6-sol/high`
- `owner`: `gpt-5.6-sol/high`
- `review`: `gpt-5.6-sol/high`
- `supervisor`: `gpt-5.6-luna/medium`

`ensure` 幂等；文件不存在时创建，旧版合法配置自动收敛到当前字段，已有当前配置保持不变。
第一次创建 `.ghost-agent-workflow/` 时，脚本同时生成内置 `.ghost-agent-workflow/.gitignore`：只保留该文件、`config.json` 和 `owners/**`，忽略 `runtime/**` 与 Owner 临时 `interfaces/`。已有 `.gitignore` 不覆盖。
该文件是仓库级配置，应持久化并提交；只有 `.ghost-agent-workflow/runtime/**` 属于临时执行状态。
如果仓库上层 `.gitignore` 整体排除了 `.ghost-agent-workflow/`，仍需先修正上层规则；禁止使用 `git add -f` 绕过。

`parallel` 只表示 DAG 模式的 1–8 并发上限，不要求填满；Quick 始终串行。模式按每次请求选择，不写入配置。profile 修改只影响之后新建的线程，不强制替换已存在的线程。

## 修改

只调用以下命令：

```text
node <plugin-root>/scripts/workflow-config.mjs set-parallel <workspace> <1-8>
node <plugin-root>/scripts/workflow-config.mjs set-profile <workspace> <main|planner|owner|review|supervisor> <model> <effort>
```

未被用户明确修改的字段保持不变。禁止把并行数设置为 8 以上。

## 验证与返回

修改后调用：

```text
node <plugin-root>/scripts/workflow-config.mjs validate <workspace>
node <plugin-root>/scripts/workflow-config.mjs show <workspace>
```

只接受 `THREAD_WORKFLOW_CONFIG_RECEIPT_V1`。向用户报告配置路径、并行数和五种 profile；不要创建子线程、Goal、Plan 或 Dashboard。
