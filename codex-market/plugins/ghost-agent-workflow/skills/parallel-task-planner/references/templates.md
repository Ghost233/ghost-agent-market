# 计划模板

## 初始计划

```json
{
  "planner": "parallel-task-planner",
  "plan_format_version": 3,
  "revision": 1,
  "execution_platform": "codex",
  "parent_goal": "<可验收的父目标>",
  "modules": [
    {
      "id": "implementation",
      "worker_profile": {
        "model": "gpt-5.6-terra",
        "reasoning_effort": "medium"
      },
      "worker_context": "<该执行配置共享的最少上下文>"
    }
  ],
  "tasks": [
    {
      "id": "T1",
      "logical_id": "state.extract-types",
      "title": "抽离页面状态类型",
      "module_id": "implementation",
      "task": "在独立文件定义并导出页面状态类型",
      "depends_on": [],
      "writable_paths": ["src/state/types.ts"],
      "done_when": ["独立文件导出完整的页面状态类型"],
      "verification": ["运行状态类型相关检查"]
    },
    {
      "id": "T2",
      "logical_id": "parser.add-boundary-tests",
      "title": "补充解析器边界测试",
      "module_id": "implementation",
      "task": "为既有解析器补充独立的边界测试",
      "depends_on": [],
      "writable_paths": ["tests/parser-boundary.test.ts"],
      "done_when": ["空输入与非法输入都有测试覆盖"],
      "verification": ["运行解析器边界测试"]
    }
  ],
  "project_verification": ["<工程总验收>"],
  "safety": {
    "status": "parallel_safe",
    "reasons": ["T1 与 T2 无依赖且写入路径不交叉，可以并行执行"]
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
