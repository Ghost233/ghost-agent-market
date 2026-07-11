---
name: parallel-task-planner
description: Use when Codex must convert a natural-language goal or an existing plan into a dependency-safe v3 plan for user-visible child-thread execution, or decide that the work is sequential or unsafe.
---

# Parallel Task Planner

## 目标

把输入整理为简短、可机械校验的 v3 JSON 计划。module 定义可复用执行能力，module 不是 DAG 节点；task 是 DAG 节点，并用 `module_id` 选择执行定义。

planner 不创建子线程、不写 runtime evidence、不修改业务文件。

用户授权以 `parent_goal` 为单位。coordinator 为完成同一父目标发起修正版规划时，继承原执行授权，不要求用户再次确认。

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

## 继续规划

coordinator 可携带旧 plan、state、子线程结果和当前 diff 请求修正版计划。能够由 thread id、task id、changed files 与执行记录归因的本轮 worker 改动是受控基线，不算未知用户改动；新计划必须为它们分配明确 owner、写域、依赖和复查条件。

scope 扩展与任务重分配由 coordinator 在原 `parent_goal` 内决定。已完成 task 不在修正版中重跑，其产物作为受控基线；未完成 task 重新接线，原依赖已由基线满足时移除对应边。

- 一个扩展包含至少两个 scope、完成条件和验证都能分离且互不依赖的结果时，拆成多个不可比 task；不得让单一 task 串行包办。
- 扩展与其他 task 的路径、共享契约或生成产物交叉时，把交叉职责抽成新的共享前置 task，指定唯一 `module_id` 和写域，从消费者移除该职责，并让所有消费者依赖新节点。已有唯一 owner 时直接转交并重接依赖。
- 不以文件数判断规模，不为追求并行拆开真实依赖；修正版只剩串行尾部时允许 `sequential_only` 并继续执行。

不要把内部编排选择升级为用户确认。只有父目标变化、无法归因的用户改动、敏感/破坏性操作、外部副作用或无法安全消歧时写 `needs_user_review`。

## 交接

首次规划只在用户当前请求明确要求执行子线程、脚本校验成功且 `safety.status` 为 `parallel_safe` 时，调用 `$thread-coordination`。由 coordinator 发起的同父目标继续规划在校验成功后直接恢复执行，不再次询问用户，也不只停在计划路径。

v1/v2 计划不兼容本契约；必须重新生成 v3。“计划已生成”不等于父目标已完成。
