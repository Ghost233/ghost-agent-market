# 计划模板

完整任务必须形成 v3 DAG。单节点和纯串行计划使用 `sequential_only`，存在至少两个不可比任务时使用 `parallel_safe`；两者都可以交给协调器执行。

`module` 是稳定执行职责，`task` 只通过 `module_id` 选择职责。线程归属固定为 `(parent_goal, module_id, thread_role)`；同一归属跨全部 revision 必须复用最近的真实线程。`dispatch_key` 只标识一次 task 分派，不是线程身份。

兼容旧历史时，同一最近 revision 若已有多个同归属真实线程，驱动器优先选择 DAG 中最后继的 task；旧图仍不可比时选择 `tasks` 数组中靠后的终态记录。其余旧线程保留但不再分派，也不得再创建第三条线程。

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
    }
  }
}
```

`reviewed_task_ids` 与 `replacements` 只完整覆盖全部未完成旧任务；已完成任务的改动仍参加闭包审计。它们只表达任务替代关系，与线程归属关系正交：即使一个失败 task 被不同 module 的诊断 task 替代，后续回到原 `module_id + thread_role` 时仍自动复用原线程。静止点收齐本 revision 的全部结果后只生成一个后继 revision。

旧计划允许保留下列兼容字段，但新计划可以省略：

```json
{
  "continuation": {
    "reuse": {
      "<当前任务 id>": {
        "from_task": "<兼容断言引用的旧任务 id>",
        "mode": "continue | handoff"
      }
    }
  }
}
```

`reuse` 仅是兼容性断言，不能决定路由。驱动器沿完整 continuation 历史自动查找最近的合法终态线程；字段缺失或为空都不能关闭复用，断言与自动结果不一致时校验失败。`completed`、`needs_main_review`、`blocked` 和 `failed` 只要具有真实线程 id 都可复用；相同 `logical_id` 自动为 `continue`，不同则为 `handoff`。

## 校验后展示

`validate` 成功后运行 `render`，每个 revision 只展示一次对应模式和 Mermaid。展示不是确认门禁，不写入 `plan.json`。

`parallel_safe`：

```text
执行模式：并行 DAG（parallel_safe）
当前计划已通过校验，将按照依赖关系并发执行。
```

`sequential_only`：

```text
执行模式：串行 DAG（sequential_only）
当前计划已通过校验，将按依赖顺序自动执行全部任务，无需确认或介入。
```

`needs_user_review`：

```text
执行模式：等待复核 DAG（needs_user_review）
当前计划已通过校验，但存在以下用户边界：<具体证据>。
```

紧接提示把 `render` 的标准输出原样放入 `mermaid` fenced code block。输出首行的 `plan_digest=<digest> revision=<n> safety.status=<status>` 是当前会话的完整展示 marker；协调器仅在当前计划的完整 marker 或完整图缺失时补展示，不能只比较 revision 与 safety。前两种模式展示后立即交接执行；最后一种展示后暂停。
