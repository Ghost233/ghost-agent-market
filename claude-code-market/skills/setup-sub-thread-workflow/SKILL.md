---
name: setup-sub-thread-workflow
description: 初始化、查看或修改 Ghost Agent Workflow 的仓库级子线程配置，包括 Planner、Owner、Review、Supervisor 的模型与推理强度，以及 1–8 的并行数量。用户要求 setup、配置子线程默认模型或修改 DAG 并发数时使用；只通过脚本管理配置，不创建或执行 Goal/DAG。
---

# 子线程工作流设置

只管理 `<workspace>/.ghost-agent-workflow/config.json`。不得手写、整份替换或直接格式化该文件。

## 初始化

取得当前 workspace 绝对路径，调用：

```text
node <plugin-root>/scripts/workflow-config.mjs init <workspace>
```

文件不存在时任一读取或修改命令都自动创建默认配置。默认值为：

- `parallel: 8`
- `planner`: `gpt-5.6-sol/high`
- `owner`: `gpt-5.6-sol/high`
- `review`: `gpt-5.6-sol/high`
- `supervisor`: `gpt-5.6-luna/medium`

`init` 幂等；已有合法配置时保持不变。
该文件是仓库级配置，应持久化并提交；只有 `.ghost-agent-workflow/runtime/**` 属于临时执行状态。

`parallel` 修改后立即影响下一轮 reserve；Goal 只保留 8 的安全上限。profile 修改只影响之后新建的线程，不强制替换已存在的线程。

## 修改

只调用以下命令：

```text
node <plugin-root>/scripts/workflow-config.mjs set-parallel <workspace> <1-8>
node <plugin-root>/scripts/workflow-config.mjs set-profile <workspace> <planner|owner|review|supervisor> <model> <effort>
```

未被用户明确修改的字段保持不变。禁止把并行数设置为 8 以上。

## 验证与返回

修改后调用：

```text
node <plugin-root>/scripts/workflow-config.mjs validate <workspace>
node <plugin-root>/scripts/workflow-config.mjs show <workspace>
```

只接受 `THREAD_WORKFLOW_CONFIG_RECEIPT_V1`。向用户报告配置路径、并行数和四种 profile；不要创建子线程、Goal、Plan 或 Dashboard。
