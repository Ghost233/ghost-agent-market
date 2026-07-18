# Task DAG 驱动与线程复用设计

## 背景

现有并发计划把 module 同时当作任务、DAG 节点和一次性分派，并使用拓扑 batch 作为运行屏障。这会导致三个问题：

1. 一条串行任务链会创建多个用户可见线程，没有复用已完成前置任务的线程。
2. batch 内的任意任务未完成时，已满足依赖的后继任务仍然被阻塞，无法按 DAG 实际就绪状态继续并发。
3. 新 revision 依赖 planner 手写复用映射；遗漏映射时，同一职责会反复创建编译、审查或实施线程。

新设计将 module、task 和 dispatch 分离，并用一个最小 TypeScript 脚本固化计划校验、线程复用路由和 DAG 就绪计算。

## 目标

- module 定义可复用的执行能力；task 定义具体工作并作为 DAG 节点。
- module 使用跨 revision 稳定的领域能力边界，不使用 implementation、review、compile 等生命周期阶段名。
- 所有依赖已完成的 task 立即执行，不使用 batch barrier、线程池或并发上限。
- 主线程收到用户发起的顶层完整任务后始终生成 DAG；单节点、纯串行、并行和混合拓扑都是一等计划，不因缺少并行度绕过规划或拒绝协调。已绑定 DAG task 不是新父目标，不得递归规划。
- 同一 `parent_goal` 内，相同 `module_id + thread_role` 的 task 始终归属同一条保留线程；task 只是发送给该线程的一次性工作。
- 不同线程归属的 ready task 全部立即执行；同一归属内的 task 必须由 DAG 明确排序，不引入图外等待。
- Codex 和 Claude Code 使用同一份 JSON 计划契约和 DAG 驱动脚本，只在平台工具适配层保留差异。
- 脚本仅负责拆解计划的结构校验和 DAG 推进，不演变为通用工作流系统。
- 用户一次授权完整 `parent_goal`；同一父目标内的安全 scope 扩展、任务重分配和计划修订由主线程自主完成。

## 非目标

- 脚本不调用 Codex 线程工具或 Claude Code teammate 工具。
- 脚本只机械校验 worker result 的身份、状态和 changed files 边界，不解释测试语义或工程总验收。
- 脚本不管理超时、重试、补修、归档、平台线程恢复、提交或 push。
- 不保留 v2 batch 执行兼容层；v2 计划必须重新生成为 v3。

## 项目内存储

每个计划使用独立目录：

```text
<project>/.ghost-agent-workflow/parallel_plan/<plan_id>/
├── plan.json
├── state.json
├── results/
│   └── <task_id>.json             # worker 原始 WORKER_RESULT_V3
└── state.json.continued-by.claim  # 仅旧 plan 已被后继 revision 认领时存在
```

`plan.json` 是 planner 生成并经脚本校验的静态 v3 契约，执行期间不原地修改。需要调整时创建新的唯一 plan 目录和独立 state，把旧版本保留为审计证据。`state.json` 保存 plan digest、task 状态、实际 thread id 和终态 `WORKER_RESULT_V3`；`results/` 保留 worker 写入的原始结果。所有版本都保留，不自动删除或归档。只有同时具有 `plan.json`、digest 匹配的 `state.json` 和有效 claim 的目录才是已激活 revision；plan-only 候选不参与 continuation 和 revision 编号。

Mermaid 是已校验 `plan.json` 的只读展示，不写入计划目录，也不参与 `validate`、`next` 或 `update`。图与 JSON 不一致时始终以 JSON 为准并重新渲染。

自然语言需求和 Markdown 计划可以作为 planner 输入，但 coordinator 只接受上述目录中经脚本校验的 `plan.json`。

## v3 计划契约

```json
{
  "planner": "parallel-task-planner",
  "plan_format_version": 3,
  "revision": 1,
  "execution_platform": "codex",
  "parent_goal": "完成页面状态架构重构",
  "modules": [
    {
      "id": "state-domain",
      "worker_profile": {
        "model": "gpt-5.6-terra",
        "reasoning_effort": "medium"
      },
      "worker_context": "负责页面状态领域的类型、读取与验证契约"
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
      "worker_context": "负责可复现的构建与集成验证"
    }
  ],
  "tasks": [
    {
      "id": "T1",
      "logical_id": "state.extract-types",
      "title": "抽离页面状态类型",
      "thread_role": "work",
      "module_id": "state-domain",
      "task": "抽离页面状态类型",
      "depends_on": [],
      "writable_paths": ["src/state/**"],
      "done_when": ["状态类型不再定义于页面组件中"],
      "verification": ["运行对应类型检查"]
    },
    {
      "id": "T2",
      "logical_id": "state.migrate-reads",
      "title": "迁移页面状态读取",
      "thread_role": "work",
      "module_id": "state-domain",
      "task": "迁移页面状态读取逻辑",
      "depends_on": ["T1"],
      "writable_paths": ["src/page/**"],
      "done_when": ["页面使用新的状态类型"],
      "verification": ["运行页面测试"]
    },
    {
      "id": "T3",
      "logical_id": "parser.preserve-boundaries",
      "title": "保持解析器边界兼容",
      "thread_role": "work",
      "module_id": "parser-runtime",
      "task": "迁移解析器边界行为",
      "depends_on": [],
      "writable_paths": ["src/parser/**"],
      "done_when": ["解析器边界行为保持兼容"],
      "verification": ["运行解析器测试"]
    },
    {
      "id": "T4",
      "logical_id": "build.verify-integration",
      "title": "验证状态与解析器集成",
      "thread_role": "verify",
      "module_id": "build-integration",
      "task": "执行构建与集成测试并保留证据",
      "depends_on": ["T2", "T3"],
      "writable_paths": [],
      "done_when": ["构建和集成测试通过且 tracked diff 不变"],
      "verification": ["运行项目构建和集成测试"]
    }
  ],
  "dispatch": {
    "strategy": "dependency_ready",
    "routes": {
      "T1": {"action": "create"},
      "T2": {"action": "reuse", "from_task": "T1"},
      "T3": {"action": "create"},
      "T4": {"action": "create"}
    }
  },
  "project_verification": ["确认全部 task 证据有效、最终 diff 覆盖父目标且无计划外改动"],
  "safety": {
    "status": "parallel_safe",
    "reasons": ["T1 与 T3 属于不同领域且写域不冲突，可以同时执行"]
  }
}
```

### Module

module 是跨 revision 稳定的领域能力和线程复用安全边界，提供 `worker_profile` 与共享 `worker_context`。相同 profile 不代表相同 module；KMP 契约、缓存运行时、Signal 和构建集成等职责必须使用不同 module。`worker_context` 只保存稳定领域边界与不变量，task 特有路径、错误和本轮目标留在 task。module 不是 DAG 节点，task 才决定本轮由哪个 module 完成哪项具体工作。

线程归属键固定为 `(parent_goal, module_id, thread_role)`。同一父目标下，一个 module 可分别保留实施、审查和验证线程，但同一角色只保留一条线程。module 的 profile 或 context 文本在后续 revision 中调整时，不因此改变归属或新建线程；复用线程保留平台上的实际模型配置，新绑定携带当前领域 context。

同一 revision 内，共享同一归属键的 task 必须在 DAG 中两两可比，并由该线程按依赖顺序执行。若两项工作确实互不依赖且应同时执行，planner 必须把它们建模为不同 module；这只是职责拆分，不是全局并发限制。

### Task

task 是 DAG 节点和最小调度单元。`module_id` 决定该 task 使用哪个 module；`task`、`writable_paths`、`done_when` 和 `verification` 定义具体工作和验收边界。

task 仅在所有 `depends_on` 均为 `completed` 时 ready。任一依赖为 `blocked`、`failed`、`needs_main_review` 或 `dependency_blocked` 时，该 task 进入 `dependency_blocked`。

`thread_role` 把线程用途固定为 `work | review | verify`。`work` 是允许在 `writable_paths` 内正式修改的实施任务，写域不得为空，并通过 task 级 verification 与 diff 自检形成默认闭环。`review` 是按风险选用的严格只读语义审查任务，只用于跨 module 契约、安全或权限边界、迁移、并发语义、缺少可执行验证或用户明确要求独立审查的场景；不得为重复 work 自检按 task 复制 review。`verify` 用于尚未被 work 验证覆盖的集成构建、全量测试、预构建或类型检查，不得重复执行相同命令。后两者的 `writable_paths` 必须为 `[]`、tracked changed files 必须为空；`verify` 可产生 repo 外或 ignored 的构建缓存与日志，并且 `verification` 不得为空。review 与 verify 依赖同一批 work 时默认作为并列节点，不互相制造依赖。非阻断审查建议随 `completed` 返回；只有影响 `done_when`、父目标正确性或安全边界的阻断缺陷才返回主线程复核，由下一 revision 的 `work` 任务承接。驱动器兼容缺少该字段的旧 v3 plan：写域非空回退为 `work`，空写域回退为 `review`；新 planner 必须显式生成。

`logical_id` 是当前 revision 内唯一的逻辑工作项标识；同一逻辑工作跨 revision 续作时保持，职责交接或新工作项可以改变。它只决定复用模式是 `continue` 还是 `handoff`，不参与线程归属。`title` 是用户可读短标题。拆分任务使用语义后缀，修复任务使用 `repair.<cause>`；不得把“等待绑定包”或单独 T 编号作为标题。驱动器兼容缺少这两个字段的旧 v3 plan，分别回退到 `id` 和 `task`，但新 planner 必须生成显式值。

### Safety

- module id 和 task id 各自唯一；每个 `module_id` 和 `depends_on` 引用必须存在。
- task 依赖图必须无环。
- 任意两个写路径、共享产物、契约或环境冲突的 task 必须在 DAG 中可比，即其中一个是另一个的祖先。
- 任意两个具有相同 `module_id + thread_role` 的 task 必须在 DAG 中可比；不可比的并行工作必须使用不同 module。
- 至少存在两个可同时 ready 的 task 时才可标记 `parallel_safe`。纯串行 DAG 标记 `sequential_only`。
- `parallel_safe` 与 `sequential_only` 都是可执行计划：前者表示存在安全并行机会，后者表示协调器按依赖串行推进。首次计划和修订计划一视同仁。
- `needs_user_review` 表示存在真实用户边界。只有该状态或校验失败才阻止自动执行；普通工程证据不足必须转为 `review`、`verify` 或诊断 task。不得为了通过入口门禁伪造并行 task、删除真实依赖或篡改 safety。
- coordinator 不接受未经脚本校验的 JSON、自然语言或 v2 计划。

## 线程复用路由

脚本为每个 task 生成一个静态 route：

- `create`：完整父目标历史中不存在相同归属键时创建新线程。
- `reuse`：同一 revision 内，后继 task 复用 `from_task` 已绑定的线程。
- `resume`：continuation 经历史 state 验证后，当前归属链的入口 task 自动恢复保留线程。

`A -> B` 只能成为候选复用边，当且仅当：

1. A 是 B 的祖先，因此 B ready 时 A 必然已完成，复用不会引入额外等待。
2. A 和 B 的 `module_id` 与 `thread_role` 都相同，即归属键相同。
3. A 最多将线程传给一个后继 task，B 最多接收一条线程。

由于同一归属键的 task 必须两两可比，脚本按确定性顺序把它们连接成单条 `reuse` 链。不同归属键的 ready task 不受影响，`next` 仍一次返回全部动作。

修正版的 `reuse` 可以省略；旧计划若保留该字段，它只是对自动路由的兼容性断言：

```json
{
  "continuation": {
    "previous_plan_path": "/absolute/previous/plan.json",
    "reviewed_task_ids": ["T7A"],
    "replacements": {"T7A": ["T7C"]},
    "reuse": {
      "T7C": {"from_task": "T7A", "mode": "continue"}
    }
  }
}
```

初始 plan 为 `revision: 1`，continuation 必须比直接前版加一。驱动器要求 `reviewed_task_ids/replacements` 覆盖全部未完成旧 task，且直接前版没有 running；`replacements` 只说明旧 task 的工作由哪些新 task 承接，不决定线程归属。

驱动器沿 `previous_plan_path` 读取完整祖先链，以 `(parent_goal, module_id, thread_role)` 自动寻找最近的有效保留线程，并验证终态和真实 thread id。`completed`、`needs_main_review`、`blocked` 和 `failed` 都是可恢复终态；业务结果失败不表示线程本身不可复用。新旧 `logical_id` 相同时生成 `continue`，改变时生成 `handoff`。module 的 profile 或 context 不要求逐字相等。非空的旧式 `continuation.reuse` 必须与自动结果一致，不能用空映射关闭自动复用，也不能指示驱动器另选线程。

兼容旧计划时，驱动器先选择最近 revision；同版存在多条旧归属记录时优先选择 DAG 中最后继的 task。若旧图曾允许同归属 task 不可比，则以 `tasks` 数组中靠后的终态记录作确定性迁移兜底。新计划会在校验阶段拒绝这种歧义，因此兜底不会继续制造多个 owner。

每个 canonical `state.json` 都有短时互斥锁；状态读取、修改和原子替换在同一锁内完成。锁只在记录的 owner 进程已经不存在时回收，多个等待者还需通过原子硬链接争抢独立 reaper，不能按时间删除仍存活的 owner 或在回收竞态中删除新锁。若 reaper 自身中断，后续等待者进入绑定原锁 token 的下一代 reaper；每一代只允许一个 owner，旧代不会被复用或抢删，因此无需人工清理也不会误删后来创建的活锁。continuation 争抢也持有旧 state 的锁，先确认没有 running，再用带 PID 和随机 token 的临时文件及原子硬链接建立永久 `state.json.continued-by.claim`。第一个后继 plan 成为唯一 owner，随后才创建可运行的新 state；竞争失败的 revision 不会获得运行状态。`next/update` 必须使用 plan 同目录的 canonical state，并在每次操作时同时验证当前 plan 未被后继取代，以及 continuation 的前版 claim 确实指向自己。因此 state 副本、失败分支和旧 revision 都不能绕过 claim。自动映射生成 `resume` route，`next` 输出 `reuse_existing_thread`。当前计划的同归属可比性校验保证跨 revision 复用不会把不可比 task 串行化。

复用线程的发送操作失败时，coordinator 保留驱动器确认的 thread id 并对同一线程补发一次；仍失败则返回可恢复的 `dispatch_failed`，不改写 route、不猜测替代线程，也不把平台发送错误伪装成业务 task 失败。

## 最小 DAG 驱动脚本

仓库保留一份 TypeScript 源码和测试。发布时编译为无运行时依赖的 `.mjs`，并同步到 Codex 和 Claude Code 插件。skill 运行 `.mjs`，不要求客户端安装 `tsx`、`ts-node` 或 TypeScript。

脚本提供五个命令：

```text
validate <plan.json>
render <plan.json>
mode <plan.json> <state.json> thread|subagent
next <plan.json> <state.json>
update <plan.json> <state.json> <task_id> running <thread_id>
update <plan.json> <state.json> <task_id> <terminal_status> <result.json>
```

### validate

- 校验 v3 字段、module/task 引用、DAG 和写范围安全性。
- 生成确定性 `dispatch.routes`。
- 仅在 `state.json` 不存在时创建最小状态，写入 plan digest，并将所有 task 初始为 `pending`。
- `state.json` 已存在时不得重置。digest 与当前 `plan.json` 不一致时拒绝继续。
- continuation 先取得前版永久 claim，再创建可运行状态；竞争失败的 plan 不得执行。
- 校验失败时不创建运行状态，coordinator 不得执行。

### render

- 解析当前 revision 的 `plan.json`，重新校验静态 v3 字段和 DAG，向标准输出返回确定性的 Mermaid `flowchart LR`，不修改 plan 或 state。正式展示仍以前一步 `validate` 成功为前提。
- 节点使用脚本内部安全别名，标签只包含 task id、`[实施|审查|验证]`、可读标题和必要的 module id；依赖边严格按 `dependency --> task` 生成。
- 单节点、串行、并行和混合 DAG 使用同一渲染规则。双引号、尖括号、换行和反引号等特殊字符必须转义，防止破坏 Mermaid label 或外层 fenced code block；输出顺序必须稳定。
- 输出首行必须包含 `plan_digest=<digest> revision=<n> safety.status=<status>`。协调器用完整 marker 判断当前计划是否已经展示，不能只比较 revision 与 safety，以免不同计划相互碰撞。
- 不读取运行状态，不绘制 continuation reuse 或 replacements，不保存 `.mmd` 文件。

### next

- 根据 `plan.json` 和 `state.json` 计算全部 ready task。
- `needs_user_review` 计划即使结构校验成功也必须机械拒绝 `next` 和 `update`，且不得修改 state。
- plan digest 不一致时拒绝计算，不使用旧状态执行已修改的计划。
- state 路径必须是 plan 同目录的 canonical `state.json`；读取和必要状态写入持有互斥锁。
- 一次返回全部 `create_thread` 或 `reuse_thread` 动作，不接受 limit、batch 或线程池参数。
- continuation route 返回 `reuse_existing_thread`，并附带旧 plan、旧 task 和经过验证的 thread id。
- 每个 action 都带显式 `thread_role` 和持久状态对应的 `expected_title`，协调器不从标题或任务文本猜测用途。
- 计算并原子写入 `dependency_blocked`，同时返回各 task 状态的简单汇总。
- `next` 不调用平台工具。coordinator 必须处理完本次返回的所有动作并调用 `update`，才能再次调用 `next`。

### update

- 记录 task 实际状态、thread id 和终态 `WORKER_RESULT_V3`。
- 允许 `pending -> running`，以及 `running -> completed | blocked | failed | needs_main_review`。
- state 路径必须 canonical；整个状态转换持有互斥锁并原子替换文件。
- `running` 接收真实 thread id；终态接收同一 plan 目录 `results/<task_id>.json`，验证 contract、status、task/logical/module/role/thread 身份、changed files、scope request 和 diff self-check 后把完整结果嵌入 state。
- `review` 和 `verify` 的 changed files 必须为空；`work` 的 changed files 必须落在写域内。
- 拒绝不存在的 task、非法跳转、已终止 task 的修改，以及 route/thread/result 不一致。

补修时 task 保持 `running`，由 coordinator 向原线程发送一次补修指令。脚本机械校验和持久化 worker result，但不判断 `done_when` 的语义完成度。

## Coordinator 协议

coordinator 仅消费经 `validate` 通过的绝对 `plan.json` 路径。

用户以执行意图给出顶层完整任务时，该请求本身就是 `parent_goal` 授权；只有明确要求“只规划”或“只讨论”时才不自动执行。planner 每次生成初始计划或 successor revision 并校验成功后，先运行 `render`，向用户展示一次执行模式，再把命令标准输出原样放入 `mermaid` fenced code block，随后立即交接或恢复 coordinator。`sequential_only` 必须原样提示：

```text
执行模式：串行 DAG（sequential_only）
当前计划已通过校验，将按依赖顺序自动执行全部任务，无需确认或介入。
```

该提示是通知而不是确认点。`parallel_safe` 同样简短提示并行模式。`render` 首行的 revision 与 safety 注释是当前会话的展示 marker；协调器进入或恢复时只在 marker 或完整图缺失时补展示，重复调用 `next` 时不展示。`needs_user_review` 可展示有效 DAG，但展示后暂停并附真实用户边界。

1. 运行 `next`。
2. 对返回的所有 action 立即调用平台工具，不得等待同次其他 task 的结果。
3. 只有驱动器确认完整历史不存在相同归属键时才执行 `create_thread`；创建前按当前 task 的稳定 `dispatch_key` 做一次幂等恢复查询，不能用该查询代替跨 revision 归属解析。
4. `reuse_thread` 向 route 指定的原 thread id 发送新 task。
5. `reuse_existing_thread` 只使用驱动器验证的旧 thread id，不自行替换。
6. 工具成功后调用 `update ... running <thread_id>`；创建前失败保持 `pending`，绑定失败保留 `running/thread_id`，并按协调 skill 返回可恢复的 `dispatch_failed`。
7. 标题固定为 `[GA][<用途>][<状态>] <中文任务名>`，中文任务名只取 task 的 `title`，不显示 `logical_id`、`module_id` 或其他内部标识。用途由 `thread_role` 映射为 `[实施|审查|验证]`。持久状态映射为 `[执行|完成|复核|阻塞|失败]`；`[待命|补修]` 只用于当前分派过程。每次状态更新、恢复协调和进入新 revision 时，按 state 幂等重放持久标题。
8. 回收 worker result，执行 evidence 和 diff 自检；worker 把同一 JSON 原子写入绑定的 `result_path`，coordinator 再用终态 `update` 持久化。
9. 结果不合法时仅向原线程补修一次，并要求无法补齐成功证据时仍返回契约合法的 `failed` 结果。只有合法终态结果才能执行 `update` 并进入内部修订；结果仍非法或线程不可达时保留 `running/thread_id`，返回 `dispatch_failed` 与原始证据，不伪造终态或静止点。
10. 每次状态更新后重新运行 `next`，立即放行新的 ready task。

coordinator 保持实现只读：不修改业务文件，不 stage、commit 或 push。它负责判断 scope 扩展、任务重分配和修正版 DAG，并把实现继续交给子线程。影响父目标完成判断的实施、范围分析、诊断、编译和必要的风险审查都必须是 DAG task；没有独立 review 不是证据缺口，coordinator 不得为重复 work 自检临时补造 review。coordinator 不创建计划外正式执行单元，也不为临时分析另开编排外线程。线程内部辅助过程不形成独立正式证据，只能汇总到当前 task 的单一终态结果。所有创建过的线程保留，不自动归档。

## 父目标授权与自主修订

用户对执行的授权以完整 `parent_goal` 为单位，而不是绑定到某一版 plan 或某组 `writable_paths`。子线程是主线程完成父目标的执行资源；写域仅限制子线程当前 task，不能把内部编排决策转化为用户审批步骤。

worker 发现完成条件需要额外路径时，保留已授权范围内成果并返回结构化 `scope_request`。若新增工作仍属于同一父目标、改动可归因于本轮子线程，且不涉及未知用户改动、敏感或破坏性操作、外部副作用、权限升级或运行中写冲突，coordinator 必须：

1. 把已知 worker 改动作为受控基线。
2. 已完成 task 不重跑；为剩余 task 重新接线，并决定扩写原 task、转交其他 module，或增加依赖以消除冲突。
3. 生成并校验新的唯一 v3 plan，由驱动器按归属键自动复用现有线程。
4. 立即继续执行，不在 revision 之间返回最终结果，也不要求用户再次确认。

首次规划和每次 revision 前都执行闭包审查，覆盖全部受控基线、调用方/消费者、共享契约、adapter/port、生成产物、构建入口、文档映射和已有工程验证失败。已完成 producer 的变化也必须检查对剩余工程的影响。当前证据能确认的缺口合并到同一个 revision；未知可能性不生成推测任务。planner 不手工决定是否复用，驱动器根据完整祖先历史自动继承每个归属键的保留线程。

revision 使用静止点合并：首个 `needs_main_review` 出现后停止派发可能受影响的新 task，继续回收当前 running task；当 running 为零时汇总本 revision 的 scope request、review finding 和 verification failure，只生成一个 successor。未校验成功或没有匹配 state digest 的 plan-only 候选不算正式 revision。

`needs_main_review` 表示主线程内部复核，不表示需要用户参与。初始计划或修正版只含一个 task、纯串行链或串行尾部时，都使用 `sequential_only` 自动执行，不能因为没有并行性而中止父目标。只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部系统副作用、权限升级，或无法安全消歧时才暂停并询问用户。

### Scope 变化决策

主线程以可独立验收结果判断 scope 规模，不以文件数量判断：

- 只有一个结果且无交叉：扩写原 task。
- 存在至少两个 scope、完成条件和验证都可分离、互不依赖的结果：拆为不同 module 下的不可比 task，由驱动器并行分派。
- 与其他 task 的路径、共享契约或生成产物交叉：把交叉职责抽成新的共享前置 task，指定唯一 module 和写域，从下游消费者移除交叉职责，并让它们依赖新节点。已有唯一 owner 时转交给该 task 并重接依赖。

worker 可在 `scope_request` 中提供 `split_hints` 和 `overlap_hints`，但它们只是证据；最终拆分、owner 和 DAG 流向由主线程决定。每个 baseline path/change 恰好分配给一个 owner，交叉基线只归共享前置节点。线程复用不得延迟不可比 task 的同时执行，同一线程任一时刻只绑定一个 active task。整个决策属于同一 `parent_goal` 的内部修订，不产生用户审批步骤。

## Worker 绑定与结果

线程固定服务于同一 `parent_goal + module_id + thread_role`，可以跨 revision 顺序执行多个 task，但任一时刻只能有一个 active task。每次新绑定只授予当前 task 的写域与验收条件；上一 task 的权限和目标不会延续。补修恢复当前 task 的 goal。

绑定包只包含当前 task：

```json
{
  "plan_path": "<absolute plan.json>",
  "state_path": "<absolute state.json>",
  "result_path": "<plan dir>/results/T2.json",
  "task_id": "T2",
  "logical_id": "state.migrate-reads",
  "title": "迁移页面状态读取",
  "thread_role": "work",
  "module_id": "state-domain",
  "task": "<具体工作>",
  "writable_paths": ["src/page/**"],
  "done_when": [],
  "verification": [],
  "thread_id": "<actual thread id>"
}
```

worker 返回：

```json
{
  "contract": "WORKER_RESULT_V3",
  "status": "completed",
  "task_id": "T2",
  "logical_id": "state.migrate-reads",
  "thread_role": "work",
  "module_id": "state-domain",
  "thread_id": "<actual thread id>",
  "changed_files": [],
  "verification": [],
  "diff_self_check": "pass",
  "scope_request": null,
  "summary": "<结果>"
}
```

绑定后的 task 只由 worker 执行，不把自身当作新的顶层父目标，也不再次调用 planner 或 coordinator。

coordinator 只接受 task、module、role 和 thread 与当前绑定一致的结果。worker 必须把结果原子写入绑定的 `result_path`，该协调元数据文件不计入业务 changed files。需要扩大写域或 review 发现阻断缺陷时，worker 返回 `needs_main_review`、`diff_self_check: scope_exception` 和精确指向后继 work 修复路径的 `scope_request`；非阻断建议以 `completed` 返回，不触发 revision。`verify` 发现源码、配置或集成失败时返回 `failed` 与完整原始证据，由静止点修订生成诊断、修复和复验任务。共享工作区中的自检只归因当前 task 的授权路径、受审边界和本次命令副作用，不把并行兄弟 task 的合法变更当作自身冲突。意外生成且可归因的越界文件保留为受控基线。纯环境、凭据或权限不可用返回 `blocked`。用户向子线程插入新指令或结果无法归因时才暂停自动推进。

## 完成与失败判定

- 一个 task 失败只阻塞它的后继，不相关的 ready task 继续执行。
- 存在 running 或 ready task 时，coordinator 继续调度和回收。
- 所有 task 都是 `completed` 后，coordinator 才核对顶层 `project_verification`；顶层只聚合 DAG task 证据，不执行计划外正式命令。
- 所有 task 完成且工程总验收通过时，父目标才能报告完成。
- `needs_main_review`、同父目标内可诊断的 `failed`、内部 `blocked` 和 project verification 失败都进入静止点修订，自动生成诊断、修复和复验节点。
- 无 running/ready task 且仍存在非 completed task 时，先尝试同父目标内的安全修订；只有真实用户边界才返回具体状态、失败命令和证据。

## 平台适配

JSON schema、DAG 脚本、module/task 语义和 worker result 字段在 Codex 与 Claude Code 之间保持一致。

- Codex 适配层使用用户可见子线程的创建和发送工具。
- Claude Code 适配层使用对应 teammate 的创建和后续任务分派工具。
- 首次创建时，模型名称和思考强度取自当前平台的 module `worker_profile`；复用时继承保留线程的实际模型配置，并在新绑定中使用当前 `worker_context`。脚本不猜别 alias 或降级 profile。

## 验证范围

1. module/task 引用、必填字段和 DAG 环检测。
2. 写路径冲突但无依赖关系时拒绝执行。
3. 同一 `module_id + thread_role` 的 task 在当前 DAG 中形成确定性复用链。
4. 同一归属键的不可比 task 被拒绝；不同 module 的独立 task 同时 ready，并分别调度。
5. 前置 task 完成后，后继立即 ready，不等待无关 task。
6. 失败只传播到后继，不影响其他分支。
7. 合法与非法 `state.json` 状态转换。
8. Codex 和 Claude Code 使用同一 JSON schema 和编译脚本。
9. skill 中不存在 batch barrier、线程池、并发上限，也不再把 module 描述为 DAG 节点或泛化生命周期角色。
10. continuation 沿完整祖先链自动复用同父目标、同 `thread_role`、同 module、处于任一终态且有真实 thread id 的最近线程；空 `reuse` 不能关闭复用。
11. action 带稳定 `logical_id`、可读 `title` 和显式 `thread_role`，协调器不会猜测用途或留下通用“等待绑定包”标题。
12. 线程标题始终遵循 `[GA][实施|审查|验证][两字状态] <中文任务名>`，且不泄露内部标识；恢复后与持久 state 一致。
13. 插件 manifest 合法，基础版本按仓库规则递增，发布后 `.mjs` 在无项目依赖时可执行。
14. 终态结果完整写入 state，协调器在上下文压缩后可以只依赖 plan/state 与 result evidence 恢复。
15. 同一静止点的多个 scope、审查或验证问题只生成一个 successor revision。
16. 单节点和纯串行首次计划都能通过校验并进入协调器，且不会因 `sequential_only` 产生阻塞或确认请求。
17. 每个有效 revision 都能从 `plan.json` 稳定渲染与依赖完全一致的 Mermaid；展示不改变执行状态。
18. `needs_user_review` 计划能够通过结构校验，但 `next` 和 `update` 必须拒绝执行且不修改 state。
19. 标题中的反引号不能截断 Mermaid fenced block；校验后展示中断时由协调器按包含 plan digest 的完整 marker 补展示，不同计划即使 revision 和 safety 相同也不能碰撞。
20. `replacements`、module profile 或 context 变化不改变线程归属；旧式非空 `reuse` 只校验自动结果。
21. 实施、审查、验证和诊断都来自 DAG，不为同一职责反复创建计划外线程。
22. 唯一一次补修仍未产生合法终态时保持真实 `running/thread_id` 并返回 `dispatch_failed`，不会伪造 `needs_main_review` 或错误进入静止点。

## 验收标准

- planner 能把自然语言或旧计划转换为项目内的 v3 `plan.json`。
- planner 对每个用户发起的顶层完整任务都生成 DAG；校验成功后展示执行模式与 Mermaid，串行模式提示后自动继续。
- coordinator 只根据脚本输出执行 ready task，不存在人工 batch barrier 或并发容量判断。
- 同一父目标中，相同 `module_id + thread_role` 始终复用一条保留线程；不同归属的 ready task 不因复用而延迟。
- 脚本只提供 `validate`、`render`、`mode`、`next` 和 `update` 五个命令，且不承担 worker 实现或工程验收职责。
- 父目标仅在全部 task 完成且 `project_verification` 通过后完成。
