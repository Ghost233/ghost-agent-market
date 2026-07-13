# 计划模板

`module` 是稳定执行职责，`task` 只通过 `module_id` 选择职责。执行单元归属固定为 `(parent_goal, module_id, thread_role)`；同一归属跨全部 revision 必须复用最近的真实执行单元。`dispatch_key` 只标识一次 task 分派，不是执行单元身份。

兼容旧历史时，同一最近 revision 若已有多个同归属真实执行单元，驱动器优先选择 DAG 中最后继的 task；旧图仍不可比时选择 `tasks` 数组中靠后的终态记录。其余旧执行单元保留但不再分派，也不得再创建第三个执行单元。

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
      "id": "build-integration",
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
      "module_id": "build-integration",
      "task": "执行页面状态相关编译和类型检查",
      "depends_on": ["T1"],
      "writable_paths": [],
      "done_when": ["相关编译和类型检查通过，或完整报告原始失败证据"],
      "verification": ["运行页面状态相关编译和类型检查，不修改 tracked files"]
    }
  ],
  "project_verification": ["确认全部 task 的规范证据有效、最终 diff 覆盖父目标且无计划外改动"],
  "safety": {
    "status": "parallel_safe",
    "reasons": ["T1 与 T2 无依赖且写域不冲突；T3 仅真实依赖 T1"]
  }
}
```

单节点、纯串行、并行和混合拓扑都使用同一份 v3 JSON 模板。`safety.status` 必须按真实拓扑填写：

- `parallel_safe`：至少存在两个不可比且可安全同时执行的任务。
- `sequential_only`：单节点 DAG，或所有任务都必须按依赖串行执行。
- `needs_user_review`：存在真实用户边界，当前不能自动执行。

不得为了得到 `parallel_safe` 而制造任务、删除依赖或改变 safety。`parallel_safe` 与 `sequential_only` 都是可执行计划。

## 校验后展示

每版计划通过 `validate` 后运行 `render`，先展示一次执行模式，再把命令标准输出原样放入 `mermaid` fenced code block。不要把 Mermaid 写入 `plan.json` 或分派包。

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

输出首行的 `plan_digest=<digest> revision=<n> safety.status=<status>` 是当前会话的完整展示 marker；协调器仅在当前计划的完整 marker 或完整图缺失时补展示，不能只比较 revision 与 safety。前两种提示后都立即交接，不等待回复。`needs_user_review` 展示有效 DAG 后说明用户边界并暂停；校验失败的候选计划不展示为正式 DAG。

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

`reviewed_task_ids` 与 `replacements` 必须完整覆盖全部未完成旧任务；已完成任务不重跑，但其改动和影响继续参加全部受控基线的闭包审计。它们只表达任务替代关系，与执行单元归属关系正交：即使一个失败 task 被不同 module 的诊断 task 替代，后续回到原 `module_id + thread_role` 时仍自动复用原执行单元。

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

`reuse` 仅是兼容性断言，不能决定路由。驱动器沿完整 continuation 历史自动查找最近的合法终态执行单元；字段缺失或为空都不能关闭复用，断言与自动结果不一致时校验失败。`completed`、`needs_main_review`、`blocked` 和 `failed` 只要具有真实执行单元 id 都可复用；相同 `logical_id` 自动为 `continue`，不同则为 `handoff`。

修订前以 `state.tasks.<task_id>.result` 内嵌的完整 `WORKER_RESULT_V3` 为终态证据；同一静止点的失败与范围变化必须合并审计，不按单条结果分别创建 revision。
