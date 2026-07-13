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
      "id": "state-contract",
      "worker_profile": {
        "model": "gpt-5.6-terra",
        "reasoning_effort": "medium"
      },
      "worker_context": "负责状态契约及其稳定不变量；任务特有路径与错误不写在这里"
    },
    {
      "id": "parser-runtime",
      "worker_profile": {
        "model": "gpt-5.6-terra",
        "reasoning_effort": "medium"
      },
      "worker_context": "负责解析器运行时行为与边界兼容"
    },
    {
      "id": "build-integration",
      "worker_profile": {
        "model": "gpt-5.6-terra",
        "reasoning_effort": "medium"
      },
      "worker_context": "负责构建、测试与可复现验证证据"
    }
  ],
  "tasks": [
    {
      "id": "T1",
      "logical_id": "state.extract-types",
      "title": "抽离页面状态类型",
      "thread_role": "work",
      "module_id": "state-contract",
      "task": "在独立文件定义并导出页面状态类型",
      "depends_on": [],
      "writable_paths": ["src/state/types.ts"],
      "done_when": ["独立文件导出完整的页面状态类型"],
      "verification": ["运行状态类型相关检查"]
    },
    {
      "id": "T2",
      "logical_id": "parser.migrate-boundaries",
      "title": "迁移解析器边界行为",
      "thread_role": "work",
      "module_id": "parser-runtime",
      "task": "迁移解析器的空输入与非法输入行为",
      "depends_on": [],
      "writable_paths": ["src/parser/runtime.ts"],
      "done_when": ["解析器边界行为保持兼容"],
      "verification": ["运行解析器边界测试"]
    },
    {
      "id": "T3",
      "logical_id": "parser.review-boundaries",
      "title": "审查解析器边界行为",
      "thread_role": "review",
      "module_id": "parser-runtime",
      "task": "只读审查解析器迁移后的边界行为",
      "depends_on": ["T2"],
      "writable_paths": [],
      "done_when": ["形成可核对且无待修复项的审查结论"],
      "verification": ["核对解析器差异与既有边界测试证据"]
    },
    {
      "id": "T4",
      "logical_id": "build.verify-integration",
      "title": "验证状态与解析器集成",
      "thread_role": "verify",
      "module_id": "build-integration",
      "task": "执行状态与解析器集成构建并保存可复现证据",
      "depends_on": ["T1", "T3"],
      "writable_paths": [],
      "done_when": ["构建和集成测试通过且仓库 tracked diff 未变化"],
      "verification": ["运行项目构建与集成测试，记录命令、退出状态和日志"]
    }
  ],
  "project_verification": ["确认全部 task 完成、T4 证据有效且父目标覆盖完整"],
  "safety": {
    "status": "parallel_safe",
    "reasons": ["T1 与 T2 属于独立领域且写域不冲突，可以并行；审查和验证按真实依赖后置"]
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

`reviewed_task_ids` 与 `replacements` 只完整覆盖全部未完成旧任务；已完成任务的改动仍参加闭包审计。静止点收齐本 revision 的全部结果后只生成一个后继 revision；`reuse` 只列通过复用约束的映射。
