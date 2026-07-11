---
name: parallel-task-planner
description: Use when Codex must convert a natural-language goal or an existing plan into a dependency-safe v3 plan for user-visible child-thread execution, or decide that the work is sequential or unsafe.
---

# Parallel Task Planner

## 目标

把输入整理为简短、可机械校验的 v3 JSON 计划。module 定义可复用执行能力，module 不是 DAG 节点；task 是 DAG 节点，并用 `module_id` 选择执行定义。

planner 不创建子线程、不写 runtime evidence、不修改业务文件。

## 产物

每次生成唯一 plan id，并写入当前项目：

```text
.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json
```

只生成 JSON；自然语言或 Markdown 仅作为输入来源。计划必须包含：

```json
{
  "planner": "parallel-task-planner",
  "plan_format_version": 3,
  "execution_platform": "codex",
  "parent_goal": "<可验收的父目标>",
  "modules": [
    {
      "id": "implementation",
      "worker_profile": {
        "model": "gpt-5.6-terra",
        "reasoning_effort": "medium"
      },
      "worker_context": "<该执行能力共享的最少上下文>"
    }
  ],
  "tasks": [
    {
      "id": "T1",
      "module_id": "implementation",
      "task": "<单一可执行结果>",
      "depends_on": [],
      "writable_paths": ["<窄路径或 glob>"],
      "done_when": ["<可观察完成条件>"],
      "verification": ["<定向验证命令或替代证据>"]
    }
  ],
  "project_verification": ["<工程总验收>"],
  "safety": {
    "status": "parallel_safe",
    "reasons": ["<判定证据>"]
  }
}
```

默认 profile 为 `gpt-5.6-terra/medium`（model: gpt-5.6-terra，reasoning_effort: medium）。用户可为 module 指定其他完整 model/effort；不猜 alias，不降级 effort。

## 拆解规则

1. 只有执行 profile 或共享 worker context 不同时才拆分 module。
2. task 按可独立验收的工作结果拆分；相互无依赖且写范围不冲突的 task 保持不可比。
3. 写路径、共享契约、生成产物或环境冲突的 task 必须用 `depends_on` 排序。
4. 完整 task 集合共同覆盖 `parent_goal`；每个 task 都必须有 scope、`done_when` 和 `verification`。
5. 图中存在至少两个不可比 task 才写 `parallel_safe`；纯串行图写 `sequential_only`；证据不足写 `needs_user_review`。

## 脚本校验

定位当前 skill 所在插件根目录，运行：

```text
node <plugin-root>/scripts/thread-plan.mjs validate <absolute-plan.json>
```

脚本生成 `dispatch.routes` 和同目录 `state.json`。校验失败时保留原错误，不手改 route 或 safety。

## 交接

只在用户当前请求明确要求执行子线程、脚本校验成功且 `safety.status` 为 `parallel_safe` 时，调用 `$thread-coordination` 并传入绝对 `plan_path`。否则只返回计划路径和安全结论。

v1/v2 计划不兼容本契约；必须重新生成 v3。“计划已生成”不等于父目标已完成。
