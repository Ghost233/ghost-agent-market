# Task DAG 驱动与线程复用设计

## 背景

现有并发计划把 module 同时当作任务、DAG 节点和子线程 owner，并使用拓扑 batch 作为运行屏障。这会导致两个问题：

1. 一条串行任务链会创建多个用户可见线程，没有复用已完成前置任务的线程。
2. batch 内的任意任务未完成时，已满足依赖的后继任务仍然被阻塞，无法按 DAG 实际就绪状态继续并发。

新设计将 module、task 和 dispatch 分离，并用一个最小 TypeScript 脚本固化计划校验、线程复用路由和 DAG 就绪计算。

## 目标

- module 定义可复用的执行能力；task 定义具体工作并作为 DAG 节点。
- 所有依赖已完成的 task 立即执行，不使用 batch barrier、线程池或并发上限。
- 同一 module 的祖先 task 和后继 task 尽可能复用同一线程，且不引入 DAG 之外的等待。
- Codex 和 Claude Code 使用同一份 JSON 计划契约和 DAG 驱动脚本，只在平台工具适配层保留差异。
- 脚本仅负责拆解计划的结构校验和 DAG 推进，不演变为通用工作流系统。
- 用户一次授权完整 `parent_goal`；同一父目标内的安全 scope 扩展、任务重分配和计划修订由主线程自主完成。

## 非目标

- 脚本不调用 Codex 线程工具或 Claude Code teammate 工具。
- 脚本不校验 worker diff、测试输出或工程总验收。
- 脚本不管理超时、重试、补修、归档、恢复、提交或 push。
- 不保留 v2 batch 执行兼容层；v2 计划必须重新生成为 v3。

## 项目内存储

每个计划使用独立目录：

```text
<project>/.ghost-agent-workflow/parallel_plan/<plan_id>/
├── plan.json
├── state.json
└── state.json.continued-by.claim  # 仅旧 plan 已被后继 revision 认领时存在
```

`plan.json` 是 planner 生成并经脚本校验的静态 v3 契约，执行期间不原地修改。需要调整时创建新的唯一 plan 目录和独立 state，把旧版本保留为审计证据。`state.json` 只保存 plan digest、task 状态和实际 thread id。所有版本都保留，不自动删除或归档。

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
      "id": "implementation",
      "worker_profile": {
        "model": "gpt-5.6-terra",
        "reasoning_effort": "medium"
      },
      "worker_context": "实现并自检限定范围内的代码"
    }
  ],
  "tasks": [
    {
      "id": "T1",
      "logical_id": "state.extract-types",
      "title": "抽离页面状态类型",
      "thread_role": "work",
      "module_id": "implementation",
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
      "module_id": "implementation",
      "task": "迁移页面状态读取逻辑",
      "depends_on": ["T1"],
      "writable_paths": ["src/page/**"],
      "done_when": ["页面使用新的状态类型"],
      "verification": ["运行页面测试"]
    }
  ],
  "dispatch": {
    "strategy": "dependency_ready",
    "routes": {
      "T1": {"action": "create"},
      "T2": {"action": "reuse", "from_task": "T1"}
    }
  },
  "project_verification": ["运行项目级类型检查与测试"],
  "safety": {
    "status": "parallel_safe",
    "reasons": []
  }
}
```

### Module

module 是可复用的执行定义，提供 `worker_profile` 和共享 `worker_context`。module 不是 DAG 节点，也不是单例线程。

多个互不依赖的 task 可以引用同一 `module_id`。它们必须分别创建线程并同时执行，不得因 module 相同而串行化。

### Task

task 是 DAG 节点和最小调度单元。`module_id` 决定该 task 使用哪个 module；`task`、`writable_paths`、`done_when` 和 `verification` 定义具体工作和验收边界。

task 仅在所有 `depends_on` 均为 `completed` 时 ready。任一依赖为 `blocked`、`failed`、`needs_main_review` 或 `dependency_blocked` 时，该 task 进入 `dependency_blocked`。

`thread_role` 把线程用途固定为 `work | review`。`work` 是允许在 `writable_paths` 内正式修改的实施任务，写域不得为空；`review` 是严格只读的审查任务，`writable_paths` 必须为 `[]`。审查发现需要修改时返回主线程复核，由下一 revision 的 `work` 任务承接，不能在原审查线程中直接修改。驱动器兼容缺少该字段的旧 v3 plan：写域非空回退为 `work`，空写域回退为 `review`；新 planner 必须显式生成。

`logical_id` 是同一 `parent_goal` 内跨 revision 稳定的职责标识，`title` 是用户可读短标题。拆分任务使用语义后缀，修复任务使用 `repair.<cause>`；不得把“等待绑定包”或单独 T 编号作为标题。驱动器兼容缺少这两个字段的旧 v3 plan，分别回退到 `id` 和 `task`，但新 planner 必须生成显式值。

### Safety

- module id 和 task id 各自唯一；每个 `module_id` 和 `depends_on` 引用必须存在。
- task 依赖图必须无环。
- 任意两个写路径、共享产物、契约或环境冲突的 task 必须在 DAG 中可比，即其中一个是另一个的祖先。
- 至少存在两个可同时 ready 的 task 时才可标记 `parallel_safe`。纯串行 DAG 标记 `sequential_only`。
- coordinator 不接受未经脚本校验的 JSON、自然语言或 v2 计划。首次执行必须为 `parallel_safe`；同父目标修正版只剩串行尾部时可以是 `sequential_only`。

## 线程复用路由

脚本为每个 task 生成一个静态 route：

- `create`：当 task ready 时创建新线程。
- `reuse`：当 task ready 时复用 `from_task` 最后使用的线程。
- `resume`：continuation plan 经旧 state 验证后，跨 revision 复用一个已终止 task 的线程。

`A -> B` 只能成为候选复用边，当且仅当：

1. A 是 B 的祖先，因此 B ready 时 A 必然已完成，复用不会引入额外等待。
2. A 和 B 的 `module_id` 相同。
3. A 和 B 的 `thread_role` 相同，避免实施与审查在同一复用链中混淆用途。
4. A 最多将线程传给一个后继 task，B 最多接收一条线程。

脚本在同 module 的 task 可达图上计算最大二分匹配，将匹配边转换为 `reuse` route，其余 task 使用 `create`。这会在不改变 DAG 并发性的前提下最大化复用次数。

修正版可包含：

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

初始 plan 为 `revision: 1`，continuation 必须比直接前版加一。驱动器要求 `reviewed_task_ids/replacements` 覆盖全部未完成旧 task，且旧 plan 没有 running。它读取旧 plan/state，验证 parent goal、完整 module 定义、`thread_role`、终止状态和真实 thread id。`continue` 要求新旧 `logical_id` 相同；`handoff` 只允许 completed 来源且 logical id 必须改变。同一个旧线程最多映射一个当前 task。

每个 canonical `state.json` 都有短时互斥锁；状态读取、修改和原子替换在同一锁内完成。锁只在记录的 owner 进程已经不存在时回收，多个等待者还需通过原子硬链接争抢独立 reaper，不能按时间删除仍存活的 owner 或在回收竞态中删除新锁。若 reaper 自身中断，后续等待者进入绑定原锁 token 的下一代 reaper；每一代只允许一个 owner，旧代不会被复用或抢删，因此无需人工清理也不会误删后来创建的活锁。continuation 争抢也持有旧 state 的锁，先确认没有 running，再用带 PID 和随机 token 的临时文件及原子硬链接建立永久 `state.json.continued-by.claim`。第一个后继 plan 成为唯一 owner，随后才创建可运行的新 state；竞争失败的 revision 不会获得运行状态。`next/update` 必须使用 plan 同目录的 canonical state，并在每次操作时同时验证当前 plan 未被后继取代，以及 continuation 的前版 claim 确实指向自己。因此 state 副本、失败分支和旧 revision 都不能绕过 claim。映射生成 `resume` route，`next` 输出 `reuse_existing_thread`。跨 revision 复用不能把不可比 task 串行化。

为保证相同计划始终生成相同 route，增广路算法按 task 在 `tasks` 数组中的顺序遍历左侧节点和候选后继。

复用线程的发送操作在 task 开始前失败时，task 直接进入 `blocked`，原因为 `reuse_thread_unavailable`。coordinator 不改写 route，也不猜测替代线程。

## 最小 DAG 驱动脚本

仓库保留一份 TypeScript 源码和测试。发布时编译为无运行时依赖的 `.mjs`，并同步到 Codex 和 Claude Code 插件。skill 运行 `.mjs`，不要求客户端安装 `tsx`、`ts-node` 或 TypeScript。

脚本只有三个命令：

```text
validate <plan.json>
next <plan.json> <state.json>
update <plan.json> <state.json> <task_id> <status> [thread_id]
```

### validate

- 校验 v3 字段、module/task 引用、DAG 和写范围安全性。
- 生成确定性 `dispatch.routes`。
- 仅在 `state.json` 不存在时创建最小状态，写入 plan digest，并将所有 task 初始为 `pending`。
- `state.json` 已存在时不得重置。digest 与当前 `plan.json` 不一致时拒绝继续。
- continuation 先取得前版永久 claim，再创建可运行状态；竞争失败的 plan 不得执行。
- 校验失败时不创建运行状态，coordinator 不得执行。

### next

- 根据 `plan.json` 和 `state.json` 计算全部 ready task。
- plan digest 不一致时拒绝计算，不使用旧状态执行已修改的计划。
- state 路径必须是 plan 同目录的 canonical `state.json`；读取和必要状态写入持有互斥锁。
- 一次返回全部 `create_thread` 或 `reuse_thread` 动作，不接受 limit、batch 或线程池参数。
- continuation route 返回 `reuse_existing_thread`，并附带旧 plan、旧 task 和经过验证的 thread id。
- 每个 action 都带显式 `thread_role`，协调器不从标题或任务文本猜测线程用途。
- 计算并原子写入 `dependency_blocked`，同时返回各 task 状态的简单汇总。
- `next` 不调用平台工具。coordinator 必须处理完本次返回的所有动作并调用 `update`，才能再次调用 `next`。

### update

- 记录 task 实际状态和 thread id。
- 允许 `pending -> running`，以及 `running -> completed | blocked | failed | needs_main_review`。
- state 路径必须 canonical；整个状态转换持有互斥锁并原子替换文件。
- 拒绝不存在的 task、非法跳转、已终止 task 的修改，以及 route/thread 不一致。

补修时 task 保持 `running`，由 coordinator 向原线程发送一次补修指令。脚本不记录补修轮次或解析 worker result。

## Coordinator 协议

coordinator 仅消费经 `validate` 通过的绝对 `plan.json` 路径。

1. 运行 `next`。
2. 对返回的所有 action 立即调用平台工具，不得等待同次其他 task 的结果。
3. `create_thread` 从 task 的 `module_id` 读取 module profile 和 context；创建前先按稳定 `dispatch_key` 查询，唯一匹配直接恢复，零匹配才创建，多匹配停止消歧。
4. `reuse_thread` 向 route 指定的原 thread id 发送新 task。
5. `reuse_existing_thread` 只使用驱动器验证的旧 thread id，不自行替换。
6. 工具成功后调用 `update ... running <thread_id>`；创建前失败保持 `pending`，绑定失败保留 `running/thread_id`，并按协调 skill 返回可恢复的 `dispatch_failed`。
7. 标题固定为 `[GA][<用途>][<状态>] <logical_id> · <title>`。用途由 `thread_role` 映射为 `[实施|审查]`；状态只使用 `[待命|执行|补修|完成|复核|阻塞|失败]`。取得真实 id 后先标记待命，绑定成功后标记执行，补修和终止时及时更新；命名失败不影响执行。
8. 回收 worker result，执行 evidence 和 diff 自检。合法结果更新为对应终止状态。
9. 结果不合法时仅向原线程补修一次；仍不合法时更新为 `needs_main_review`。
10. 每次状态更新后重新运行 `next`，立即放行新的 ready task。

coordinator 保持实现只读：不修改业务文件，不 stage、commit 或 push。它负责判断 scope 扩展、任务重分配和修正版 DAG，并把实现继续交给子线程。所有创建过的线程保留，不自动归档。

## 父目标授权与自主修订

用户对执行的授权以完整 `parent_goal` 为单位，而不是绑定到某一版 plan 或某组 `writable_paths`。子线程是主线程完成父目标的执行资源；写域仅限制子线程当前 task，不能把内部编排决策转化为用户审批步骤。

worker 发现完成条件需要额外路径时，保留已授权范围内成果并返回结构化 `scope_request`。若新增工作仍属于同一父目标、改动可归因于本轮子线程，且不涉及未知用户改动、敏感或破坏性操作、外部副作用、权限升级或运行中写冲突，coordinator 必须：

1. 把已知 worker 改动作为受控基线。
2. 已完成 task 不重跑；为剩余 task 重新接线，并决定扩写原 task、转交其他 module，或增加依赖以消除冲突。
3. 生成并校验新的唯一 v3 plan，优先复用现有线程。
4. 立即继续执行，不在 revision 之间返回最终结果，也不要求用户再次确认。

生成 revision 前，coordinator 对全部未完成 task 做一次闭包审查，覆盖 scope request 的调用方/消费者、共享契约、adapter/port、生成产物和已有工程验证失败。当前证据能确认的缺口合并到同一个 revision；未知可能性不生成推测任务。合格旧线程通过 `continuation.reuse` 显式继承，而不是仅在文字中“优先复用”。

`needs_main_review` 表示主线程内部复核，不表示需要用户参与。修正版只剩一个 task 或串行尾部时使用 `sequential_only` 继续，不能因为失去并行性而中止父目标。只有父目标变化、无法归因的用户改动、敏感或破坏性操作、外部系统副作用、权限升级，或无法安全消歧时才暂停并询问用户。

### Scope 变化决策

主线程以可独立验收结果判断 scope 规模，不以文件数量判断：

- 只有一个结果且无交叉：扩写原 task。
- 存在至少两个 scope、完成条件和验证都可分离、互不依赖的结果：拆为多个不可比 task，由驱动器并行分派。
- 与其他 task 的路径、共享契约或生成产物交叉：把交叉职责抽成新的共享前置 task，指定唯一 module 和写域，从下游消费者移除交叉职责，并让它们依赖新节点。已有唯一 owner 时转交给该 task 并重接依赖。

worker 可在 `scope_request` 中提供 `split_hints` 和 `overlap_hints`，但它们只是证据；最终拆分、owner 和 DAG 流向由主线程决定。每个 baseline path/change 恰好分配给一个 owner，交叉基线只归共享前置节点。线程复用不得延迟不可比 task 的同时执行，同一线程任一时刻只绑定一个 active task。整个决策属于同一 `parent_goal` 的内部修订，不产生用户审批步骤。

## Worker 绑定与结果

线程可以顺序执行同一 module 的多个 task，但任一时刻只能有一个 active task。每个新 task 创建独立 goal；补修恢复当前 task 的 goal。

绑定包只包含当前 task：

```json
{
  "plan_path": "<absolute plan.json>",
  "state_path": "<absolute state.json>",
  "task_id": "T2",
  "logical_id": "state.migrate-reads",
  "title": "迁移页面状态读取",
  "thread_role": "work",
  "module_id": "implementation",
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
  "module_id": "implementation",
  "thread_id": "<actual thread id>",
  "changed_files": [],
  "verification": [],
  "diff_self_check": "pass",
  "scope_request": null,
  "summary": "<结果>"
}
```

coordinator 只接受 task、module 和 thread 与当前绑定一致的结果。需要扩大写域时，worker 返回 `needs_main_review`、`diff_self_check: scope_exception` 和 `scope_request`；意外生成且可归因的越界文件保留为受控基线，由主线程按上述协议自主修订。用户向子线程插入新指令或结果无法归因时才暂停自动推进。

## 完成与失败判定

- 一个 task 失败只阻塞它的后继，不相关的 ready task 继续执行。
- 存在 running 或 ready task 时，coordinator 继续调度和回收。
- 所有 task 都是 `completed` 后，coordinator 才执行顶层 `project_verification`。
- 所有 task 完成且工程总验收通过时，父目标才能报告完成。
- 无 running/ready task 且仍存在非 completed task 时，先尝试同父目标内的安全修订；只有真实用户边界或无法恢复的工程总验收失败才返回具体状态、失败命令和证据。

## 平台适配

JSON schema、DAG 脚本、module/task 语义和 worker result 字段在 Codex 与 Claude Code 之间保持一致。

- Codex 适配层使用用户可见子线程的创建和发送工具。
- Claude Code 适配层使用对应 teammate 的创建和后续任务分派工具。
- 模型名称和思考强度取自当前平台的 module `worker_profile`，脚本不猜别 alias 或降级 profile。

## 验证范围

1. module/task 引用、必填字段和 DAG 环检测。
2. 写路径冲突但无依赖关系时拒绝执行。
3. 同 module 的祖先 task 获得确定性最大线程复用。
4. 同 module 的独立 task 同时 ready，并分别创建线程。
5. 前置 task 完成后，后继立即 ready，不等待无关 task。
6. 失败只传播到后继，不影响其他分支。
7. 合法与非法 `state.json` 状态转换。
8. Codex 和 Claude Code 使用同一 JSON schema 和编译脚本。
9. skill 中不存在 batch barrier、线程池、并发上限，也不再把 module 描述为 DAG 节点。
10. continuation 只复用同父目标、同 `thread_role`、同 module、已终止且有真实 thread id 的旧任务。
11. action 带稳定 `logical_id`、可读 `title` 和显式 `thread_role`，协调器不会猜测用途或留下通用“等待绑定包”标题。
12. 线程标题始终遵循 `[GA][实施|审查][两字状态] <logical_id> · <title>`，用途和状态变化互不混淆。
13. 插件 manifest 合法，基础版本按仓库规则递增，发布后 `.mjs` 在无项目依赖时可执行。

## 验收标准

- planner 能把自然语言或旧计划转换为项目内的 v3 `plan.json`。
- coordinator 只根据脚本输出执行 ready task，不存在人工 batch barrier 或并发容量判断。
- 同 module 的依赖 task 尽可能复用原线程；互不依赖的 task 不因复用目标而延迟。
- 脚本只有 `validate`、`next` 和 `update` 三个命令，且不承担 worker 实现或工程验收职责。
- 父目标仅在全部 task 完成且 `project_verification` 通过后完成。
