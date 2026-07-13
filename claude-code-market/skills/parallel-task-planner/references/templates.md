# 计划模板

## 初始计划

```json
{
  "planner": "parallel-task-planner",
  "plan_format_version": 3,
  "revision": 1,
  "execution_platform": "claude_code",
  "parent_goal": "<可验收的父目标>",
  "modules": [
    {
      "id": "state-domain",
      "worker_profile": {
        "model": "sonnet",
        "reasoning_effort": "max"
      },
      "worker_context": "<页面状态领域的最少共享上下文>"
    },
    {
      "id": "parser-domain",
      "worker_profile": {
        "model": "sonnet",
        "reasoning_effort": "max"
      },
      "worker_context": "<解析器领域的最少共享上下文>"
    },
    {
      "id": "build-verification",
      "worker_profile": {
        "model": "sonnet",
        "reasoning_effort": "max"
      },
      "worker_context": "<工程构建与验证约束>"
    }
  ],
  "tasks": [
    {
      "id": "T1",
      "logical_id": "state.extract-types",
      "title": "抽离页面状态类型",
      "thread_role": "work",
      "module_id": "state-domain",
      "task": "在独立文件定义并导出页面状态类型",
      "depends_on": [],
      "writable_paths": ["src/state/types.ts"],
      "done_when": ["独立文件导出完整的页面状态类型"],
      "verification": ["运行状态类型相关检查"]
    },
    {
      "id": "T2",
      "logical_id": "parser.review-boundaries",
      "title": "审查解析器边界行为",
      "thread_role": "review",
      "module_id": "parser-domain",
      "task": "只读审查既有解析器的空输入与非法输入行为",
      "depends_on": [],
      "writable_paths": [],
      "done_when": ["形成可核对的边界行为审查结论"],
      "verification": ["读取并运行既有解析器边界测试，不修改 tracked files"]
    },
    {
      "id": "T3",
      "logical_id": "state.verify-integration",
      "title": "验证页面状态集成",
      "thread_role": "verify",
      "module_id": "build-verification",
      "task": "执行页面状态相关编译和类型检查",
      "depends_on": ["T1"],
      "writable_paths": [],
      "done_when": ["相关编译和类型检查通过，或完整报告原始失败证据"],
      "verification": ["运行页面状态相关编译和类型检查，不修改 tracked files"]
    }
  ],
  "project_verification": ["<工程总验收>"],
  "safety": {
    "status": "parallel_safe",
    "reasons": ["T1 与 T2 无依赖且写域不冲突；T3 仅真实依赖 T1"]
  }
}
```

## 修正版片段

把该字段加入完整计划；其余顶层字段仍按初始计划模板生成。

```json
{
  "continuation": {
    "previous_plan_path": "<直接前版 plan.json 的绝对路径>",
    "reviewed_task_ids": ["<每个未完成旧任务 id>"],
    "replacements": {
      "<未完成旧任务 id>": ["<当前承接任务 id>"]
    },
    "reuse": {
      "<当前任务 id>": {
        "from_task": "<已终止旧任务 id>",
        "mode": "continue | handoff"
      }
    }
  }
}
```

`reviewed_task_ids` 与 `replacements` 必须完整覆盖全部未完成旧任务；`reuse` 只列通过复用约束的映射。

修订前以 `state.tasks.<task_id>.result` 内嵌的完整 `WORKER_RESULT_V3` 为终态证据；同一静止点的失败与范围变化必须合并审计，不按单条结果分别创建 revision。
