# 计划模板

每次满足初始规划门禁的任务创建新的 `parent_goal`。module 和执行归属只在该父目标内有效；计划不包含执行方式或路由，同一 JSON 可交给用户明确选择的子线程或子代理协调器。

## 初始计划

```json
{
  "planner": "parallel-task-planner",
  "plan_format_version": 3,
  "revision": 1,
  "execution_platform": "codex",
  "parent_goal": "<当前已收口的明确任务目标>",
  "modules": [
    {
      "id": "state-contract",
      "worker_profile": {
        "model": "gpt-5.6-sol",
        "reasoning_effort": "medium"
      },
      "worker_context": "负责状态契约及其长期不变量"
    },
    {
      "id": "parser-runtime",
      "worker_profile": {
        "model": "gpt-5.6-sol",
        "reasoning_effort": "medium"
      },
      "worker_context": "负责解析器运行时行为与边界"
    },
    {
      "id": "build-integration",
      "worker_profile": {
        "model": "gpt-5.6-sol",
        "reasoning_effort": "medium"
      },
      "worker_context": "负责工程构建和集成验证"
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
      "done_when": ["独立文件导出完整页面状态类型"],
      "verification": ["运行状态类型相关检查"]
    },
    {
      "id": "T2",
      "logical_id": "parser.align-boundaries",
      "title": "调整解析器边界行为",
      "thread_role": "work",
      "module_id": "parser-runtime",
      "task": "调整解析器的空输入与非法输入行为",
      "depends_on": [],
      "writable_paths": ["src/parser/runtime.ts", "tests/parser-boundaries.test.ts"],
      "done_when": ["解析器边界行为与测试保持一致"],
      "verification": ["运行解析器边界测试"]
    },
    {
      "id": "T3",
      "logical_id": "parser.review-boundaries",
      "title": "审查解析器边界行为",
      "thread_role": "review",
      "module_id": "parser-runtime",
      "task": "只读审查解析器调整后的边界行为",
      "depends_on": ["T2"],
      "writable_paths": [],
      "done_when": ["形成无待修复项的可定位审查结论"],
      "verification": ["核对解析器差异与边界测试证据"]
    },
    {
      "id": "T4",
      "logical_id": "build.verify-integration",
      "title": "验证状态与解析器集成",
      "thread_role": "verify",
      "module_id": "build-integration",
      "task": "执行状态与解析器集成构建",
      "depends_on": ["T1", "T3"],
      "writable_paths": [],
      "done_when": ["构建和集成测试通过且 tracked diff 未变化"],
      "verification": ["运行项目构建与集成测试并记录命令、退出状态和日志"]
    }
  ],
  "project_verification": ["确认全部 task 完成且父目标证据覆盖完整"],
  "safety": {
    "status": "parallel_safe",
    "reasons": ["T1 与 T2 无依赖且职责和写域不冲突"]
  }
}
```

## 修正版

修正版仍是完整计划，只额外加入：

```json
{
  "continuation": {
    "previous_plan_path": "<同一 parent_goal 的直接前版 plan.json 绝对路径>"
  }
}
```

`revision` 只增加 1。完整保留前版全部 module 定义，可按需增加新 module；未闭环工作直接写成新 DAG task。计划中不写线程路由或任务替代映射。

## 校验后展示

`parallel_safe`：

```text
DAG 拓扑：可并行（parallel_safe）
当前计划已通过校验，存在可按依赖关系并发执行的任务。
```

`sequential_only`：

```text
DAG 拓扑：串行（sequential_only）
当前计划已通过校验，将按依赖顺序执行；串行拓扑不会阻塞协调器。
```

`needs_user_review`：

```text
DAG 拓扑：等待复核（needs_user_review）
当前计划已通过校验，但存在以下用户边界：<具体证据>。
```

紧接提示把 `render` 的标准输出原样放入 `mermaid` fenced code block，再展示本次明确选择：

```text
执行方式：<子线程或子代理>
请求范围：<只规划或规划后执行>
```

`只规划` 在展示后停止，不调用协调器。`规划后执行` 仅在 `parallel_safe` 或 `sequential_only` 时交给对应协调器；`needs_user_review` 暂停。
