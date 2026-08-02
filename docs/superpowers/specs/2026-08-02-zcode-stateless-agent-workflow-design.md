# ZCode 无状态单例 Agent 工作流重构设计

日期：2026-08-02

## 1. 背景

当前 ZCode 工作流同时使用插件内 Skill、在线脚本安装到 `~/.zcode/agents/` 的用户级 Agent，以及 `goal-dag.mjs` 管理的 Goal/Plan/State/Binding。现有结构名义上让 Agent 与 Skill 一一对应，但仍存在以下问题：

- `sub-thread-goal-worker` 同时承担 Quick Owner、DAG Owner 和只读 Implementation Review；
- `sub-thread-coordination` 同时表达模式确认、启动、继续和最终交付；
- `setup-sub-thread-workflow` 同时查看和修改配置，底层查看命令还可能产生写入；
- `start-dag-dashboard` 的启动路径可能隐式终止已登记进程；
- runtime 已有 Supervisor 状态机，但 ZCode 没有对应稳定 Agent，且 Supervisor 机械职责不需要模型推理；
- Agent 名、Skill 名、runtime role 和模型 profile 近似使用同一命名体系，导致 Role、Action 和执行身份边界不清；
- 当前 ZCode 没有向插件或模型公开持久 Session 的 create/resume/send/close API，不能依赖 Session Bridge 实现仓库级任意模型与 reasoning effort；
- ZCode runtime 文件标记为生成文件，但当前共享 builder 不能重现 ZCode 独立版本；
- 现有测试主要检查文件和 manifest 存在，不覆盖 ZCode runtime 派发、配置迁移和 Agent bundle 事务。

本设计仅作用于 `zcode-market/`。Claude Code 与 Codex 的共享版本保持不变。

## 2. 设计目标

重构后满足以下目标：

1. Main 是唯一 Agent 调度者和用户交互入口；
2. Runtime 是唯一 workflow 状态写入者和机械调度内核；
3. 每个专业 Agent 每次只打开一个 Binding、执行一个 Operation 并结束；
4. Agent 不创建、调用、等待或通知其他 Agent；
5. Skill 可以复用能力，但不能自行选择本轮 Operation；
6. 只有出现新的权限或信任边界时才新增 Agent；
7. 完全机械的动作进入 Runtime，不建 Agent；
8. Owner 写入与 Implementation Review 只读权限完全分离；
9. 配置读写、Dashboard start/status/stop 完全分离；
10. 不依赖 ZCode 私有 Session/IPC API；
11. 继续通过在线 GitHub Raw 安装用户级 Agent；
12. 一次性备份并替换旧 Agent，不长期维护旧别名；
13. 保持核心 Plan/State/Owner 数据契约兼容；
14. 建立可重现的 ZCode 独立 runtime 构建和测试链路。

## 3. 非目标

本次不做以下事项：

- 不修改 Claude Code 或 Codex workflow；
- 不为每个 runtime 命令创建一个 Agent；
- 不让 Agent 持有 workflow 长期状态；
- 不通过私有 `app-server --stdio` 或未公开 IPC 创建 ZCode Session；
- 不在仓库配置中承诺任意模型 ID 或 reasoning effort；
- 不改变 `DAG_PLAN_V5`、`DAG_RUN_STATE_V5`、Owner ID 或 task role 的核心语义；
- 不自动接管存在 running task/thread 的旧 workflow。

## 4. 核心职责模型

### 4.1 Main

Main 是用户当前使用的主 ZCode Agent，不安装额外的 `workflow-main` Agent。

Main 负责：

- 加载 `workflow-coordination` Skill；
- 调用 Runtime 获取下一步结果；
- 按 Runtime Receipt 指定的 Agent 和 Operation 派发；
- 并行调用同一个 dispatch batch 中的独立 jobs；
- 在 Agent 返回后调用 reconcile；
- 请求用户完成模式选择、Owner 变化、reclaim 等真实决策；
- 报告最终结果。

Main 不负责：

- 语义规划；
- 修改业务代码；
- Plan Review 或 Implementation Review；
- 手写 Plan、State、Binding 或 Result；
- 猜测下一步 Agent；
- 用聊天历史补齐缺失 runtime 字段。

### 4.2 Runtime

Runtime 是 `goal-dag.mjs` 及其配套脚本，负责：

- Goal、Plan、State、Binding、Result 和 Owner Registry 的 schema 校验与写入；
- dependency、scope、Owner lease 和 parallel limit；
- ready task 选择与 dispatch batch 生成；
- Action token、attempt、digest 和 revision；
- 机械 verification、source audit、diff audit、commit readiness 和 Owner integration；
- Result acceptance、task 状态迁移和 workflow 完成判断；
- Dashboard 状态投影；
- 旧 workflow 兼容检测。

Runtime 不执行需要语义判断的规划、实现或审查。

### 4.3 Agent

Agent 是短生命周期、无 workflow 私有状态的专业执行器。

统一生命周期：

```text
创建 Agent
→ 加载固定 Skill
→ action open
→ 校验 Binding
→ 执行一个 Operation
→ 提交一个 Result
→ 返回 Receipt
→ 结束
```

Agent 不继续请求下一个任务，不保存跨调用的聊天上下文。下一次 action 使用新的 Agent 调用，并重新从 Binding 恢复必要上下文。

### 4.4 Skill

Skill 描述可复用能力和安全流程。一个 Skill 可以支持多个 Operation，但：

- Operation 只能由 Runtime Binding 指定；
- Agent 必须在 Registry 中被授权执行该 Operation；
- Skill 必须先核对 Agent ID、Operation、permission class、revision 和 digest；
- 任一不匹配时 fail closed；
- Skill 不创建、调用、等待或通知其他 Agent。

## 5. 稳定数据角色

### 5.1 Task Role

Plan 中继续使用：

```text
work
review
verify
```

这些是 DAG 数据类型，不是 Agent 名。

### 5.2 Runtime Actor

机械任务使用 Runtime Actor，例如：

```text
scheduler
source-audit
diff-audit
commit-readiness
owner-integration
```

Runtime Actor 不安装为用户级 Agent。

### 5.3 Supervisor

删除 ZCode Supervisor Agent 设计。原 Supervisor 的机械职责并入 Runtime scheduler：

```text
status → reconcile → integrate → reserve → dispatch_batch
```

Scheduler 负责并发、依赖、Owner lease、scope 冲突、Review gate 和完成判断，不进行模型推理。

## 6. Agent 清单

最终在线安装 11 个用户级 Agent。

### 6.1 Workflow Agent

#### `workflow-planner`

允许 Operation：

- `initial_plan`
- `revise_plan`
- `apply_global_delta`
- `expand_subgraph`

每次调用只执行其中一个。Global Plan 与 Subgraph 通过 Binding 输入隔离，不依赖长期 Planner Session。

禁止：修改业务文件、执行实现、审查实现、调用其他 Agent、绕过 runtime 提交。

#### `workflow-plan-reviewer`

允许 Operation：

- `review_plan_revision`

只审查一个当前 Plan revision，提交 `pass` 或固定 `revise` reason。禁止读取无关业务上下文、修改 Plan 或调用 Planner。

#### `workflow-owner`

允许 Operation：

- `execute_owner_run`
- `repair_owner_run`

Binding 固定 `mode: quick|dag`、workspace、writable scope 和 verification。Agent 不能在一次调用中切换模式。

Quick 只在原 workspace 工作；DAG 只在 Owner worktree 工作。禁止执行 Git/worktree/commit/merge 操作。

#### `workflow-implementation-reviewer`

允许 Operation：

- `review_implementation`

严格只读，审查一个 implementation Binding，提交 pass 或 blocking findings。禁止修改业务文件或替 Owner 修复。

### 6.2 Utility / Safety Agent

#### `workflow-config-reader`

只执行真正无写入的 `show-strict` 或 `validate-strict`。

#### `workflow-config-writer`

只执行一个明确配置动作：`init`、`migrate`、`set-parallel` 或 `set-execution-class`。

#### `workflow-dashboard-starter`

只启动 Dashboard 或返回 `already_running`；不能终止活进程。

#### `workflow-dashboard-status-reader`

只读 descriptor、进程身份、health、URL 和 Goal 绑定。

#### `workflow-dashboard-stopper`

用户明确要求后，核对 descriptor token、PID、process identity、workspace 和 Goal，再停止一个实例。

#### `git-commit`

保持现有授权提交能力和脚本驱动事务。

#### `git-merge-conflict`

保持现有高风险冲突考古能力。

## 7. Skill 清单

最终约 8 个 Skill：

| Skill | 调用者 |
| --- | --- |
| `workflow-coordination` | Main |
| `workflow-planning` | `workflow-planner` |
| `workflow-plan-review` | `workflow-plan-reviewer` |
| `workflow-bound-run` | `workflow-owner`、`workflow-implementation-reviewer` |
| `workflow-config` | config reader/writer |
| `workflow-dashboard` | dashboard 三个 Agent |
| `git-commit` | `git-commit` |
| `git-merge-conflict` | `git-merge-conflict` |

所有 ZCode Skill 保留独立演进说明，明确不自动同步 Claude Code 或 Codex。

## 8. Agent Registry

新增 ZCode 独立 Agent Registry，作为唯一映射来源。Registry 至少包含：

```json
{
  "contract": "ZCODE_AGENT_BUNDLE_V2",
  "bundle_version": "2.0.0",
  "agents": [
    {
      "id": "workflow-owner",
      "plugin": "ghost-agent-workflow",
      "skill": "ghost-agent-workflow:workflow-bound-run",
      "operations": ["execute_owner_run", "repair_owner_run"],
      "permission_class": "workspace_write",
      "execution_class": "main",
      "template": "ghost-agent-workflow/workflow-owner.md",
      "replaces": ["sub-thread-goal-worker"]
    }
  ]
}
```

Registry 是以下内容的唯一来源：

- installer 安装清单；
- Agent → Skill → Operation 映射；
- permission class；
- execution class；
- 模板路径和 digest；
- 旧 Agent 替换关系；
- Runtime 派发名称；
- 测试预期；
- bundle schema/version。

生成流程可以把 Registry 编译进 Runtime；Runtime 执行时不联网读取 Registry。

## 9. Runtime Action 协议

### 9.1 Main 入口

Main 重复调用一个公开入口：

```text
node <plugin-root>/scripts/goal-dag.mjs workflow next-actions <workflow-dir>
```

返回结果严格属于以下枚举：

- `dispatch_batch`
- `runtime_action`
- `user_action`
- `completed`
- `failed`

### 9.2 Dispatch Batch

```json
{
  "contract": "WORKFLOW_DISPATCH_BATCH_V1",
  "workflow_revision": 7,
  "jobs": [
    {
      "action_id": "action-T1-1",
      "agent": "workflow-owner",
      "operation": "execute_owner_run",
      "execution_class": "main",
      "dispatch": "使用 workflow-owner；先打开 action-T1-1。",
      "binding_ref": "/workflow/actions/action-T1-1.json",
      "binding_digest": "sha256:..."
    }
  ]
}
```

Main 逐字使用 `agent` 和 `dispatch`。同一 batch 中 scope 和 lease 独立的 jobs 可以并行调用。

### 9.3 Action Open

Agent 首先调用：

```text
node <plugin-root>/scripts/goal-dag.mjs action open <workflow-dir> <action-id> <token>
```

Runtime 原子执行：

1. 校验 workflow revision；
2. 校验 action、Agent 和 token；
3. 校验 Agent bundle schema；
4. 增加 attempt；
5. 生成不可变 Binding；
6. 将 task 从可派发状态转为 running；
7. 返回 `WORKFLOW_ACTION_BINDING_V1`。

仅生成 dispatch job 不会把 task 标为 running。用户拒绝 Agent 调用时不会产生假的 running task。

### 9.4 Binding

Binding 至少包含：

```yaml
contract: WORKFLOW_ACTION_BINDING_V1
action_id: action-T1-1
attempt: 1
agent:
  id: workflow-owner
  skill: ghost-agent-workflow:workflow-bound-run
  operation: execute_owner_run
  permission_class: workspace_write
subject:
  mode: dag
  task_role: work
  task_id: T1
  owner_id: payments
  workspace: /owner/worktree
scope:
  writable:
    - src/payments/**
  readonly:
    - package.json
verification:
  - payments-unit
result_actions:
  - complete
  - block
  - fail
  - request_dag
```

Agent 只读取 Binding 和 Binding 明确引用的 Capsule/source blocks，不读取完整 State 或聊天历史补字段。

### 9.5 Result

Result 提交必须包含：

- `action_id`
- `attempt`
- `binding_digest`
- `result_token`
- 固定 result action
- 语义摘要或 findings

旧 attempt、重复提交、digest 不匹配和未授权 result action 全部拒绝。

## 10. Action 状态机与恢复

```text
offered
  ↓ action open
running
  ├── completed
  ├── blocked
  ├── failed
  └── repair_required
```

### 10.1 Agent 未启动

Action 保持 `offered`，不改变 task 状态。Main 可以安全地重新请求当前 actions。

### 10.2 Agent 已 open 但未提交

Runtime 保留 running 现场，不猜测 Agent 是否仍活跃。Main 向用户报告真实状态。用户明确确认后才允许 reclaim。

### 10.3 DAG Owner 恢复

保留原 Owner worktree。Reclaim 后 Runtime 创建 `repair_owner_run`，新 Agent 重新打开 Binding 并从现有工作区继续。

### 10.4 Quick Owner 恢复

若 Quick Agent 留下未验收修改，进入 `user_action`。Runtime 不自动回滚，也不把 block/fail 视为已清理。

## 11. 并行模型

Runtime 根据 `parallel`、依赖、Owner lease 和 scope 冲突生成最大安全 batch。

Main 在同一轮并行调用 batch jobs。每个调用：

- 使用同一个专业 Agent 定义或不同 Agent 定义；
- 使用独立 action ID 和 Binding；
- 拥有独立上下文；
- 不知道其他 Agent 是否存在；
- 返回后立即结束。

Main 收齐当前调用结果后执行 reconcile。Agent 不等待同批其他 Agent。

## 12. 模型配置

当前 ZCode 公开 Agent 调用只支持 `sonnet|opus|haiku` 别名，且不支持 Agent 级 reasoning effort。设计不得承诺无法兑现的任意 model/effort profile。

### 12.1 Workflow Config V2

```json
{
  "contract": "ZCODE_WORKFLOW_CONFIG_V2",
  "parallel": 4,
  "execution_classes": {
    "planner": "main",
    "planner_reviewer": "main",
    "owner": "main",
    "review": "main"
  }
}
```

允许值：

- `main`：调用 Agent 时使用 ZCode 主模型别名；
- `lite`：调用 Agent 时使用轻量模型别名。

Runtime Receipt 使用 `execution_class`，Main 映射为受支持的 Agent 调用参数。实际具体模型由用户当前 ZCode Main/Lite 配置决定。

### 12.2 Agent Markdown

Workflow Agent 模板使用 `model: inherit`。Runtime 的正式派发通过 `execution_class`，不把 Agent Markdown 的具体 model 当作仓库级权威。

Installer 仍可为 Utility/Git Agent 写入用户选择的全局模型；这些 Agent 不参与 workflow execution class。

## 13. 配置读写分离

### 13.1 Strict Reader

新增：

```text
workflow-config.mjs show-strict <workspace>
workflow-config.mjs validate-strict <workspace>
```

这两个入口不得创建目录、`.gitignore` 或配置，不得自动迁移。不存在时返回 `missing`。

### 13.2 Writer

允许：

```text
init
migrate
set-parallel
set-execution-class
```

每次调用只修改用户明确指定的一项。修改后运行 strict validate。

### 13.3 V1 → V2

旧 model/effort profile 迁移必须显式执行：

1. 读取并验证旧配置；
2. 生成迁移预览；
3. 说明将删除无法兑现的任意 model/effort 字段；
4. 用户授权后备份原配置；
5. 原子写入 V2；
6. strict validate；
7. 返回 migration receipt。

不得在 show/validate 或普通 workflow start 时静默迁移。

## 14. Dashboard 生命周期

### 14.1 Starter

只允许 `started` 或 `already_running`。发现冲突活进程时返回 conflict，不终止它。

### 14.2 Status Reader

只读取 descriptor、PID identity、health、URL 和 Goal 绑定；零写入。

### 14.3 Stopper

用户明确要求停止后，核对：

- descriptor token；
- PID；
- process identity；
- workspace；
- Goal ID。

禁止仅按端口终止任意进程。

## 15. Installer V2

### 15.1 在线来源

继续遵守仅允许在线 GitHub 来源的规则。Installer、Registry 和模板必须来自同一个固定 release ref 或 commit ref，禁止混用不同 ref。

### 15.2 安装事务

一次性替换流程：

1. 下载 Registry 和全部模板；
2. 校验 bundle schema；
3. 校验 frontmatter、Agent/Skill/Operation 映射和 digest；
4. 读取所有目标与待删除旧文件；
5. 创建完整备份；
6. 在目标目录生成 staging files；
7. 获取 installer lock；
8. 原子替换 11 个 canonical Agent；
9. 删除 Registry 声明的旧 Agent；
10. 写 sidecar；
11. 失败时按备份回滚；
12. 成功后要求重启 ZCode。

### 15.3 旧 Agent 映射

| 旧 Agent | 新结构 |
| --- | --- |
| `parallel-task-planner` | `workflow-planner` |
| `planner-reviewer` | `workflow-plan-reviewer` |
| `sub-thread-goal-worker` | `workflow-owner`、`workflow-implementation-reviewer` |
| `sub-thread-coordination` | 删除；Main 加载 `workflow-coordination` |
| `setup-sub-thread-workflow` | config reader/writer |
| `start-dag-dashboard` | dashboard starter/status-reader/stopper |
| `git-commit` | 原名保留 |
| `git-merge-conflict` | 原名保留 |

### 15.4 Metadata 迁移

旧文件的 `model` 和 `color` 可复制到替代 Agent。一对多时复制到每个替代项。自定义正文不合并，只保存在备份。

Workflow Agent 的一次性迁移可以保留用户原有 `color`，但其 `model` 最终按模板和 execution class 规则处理；若用户显式要求全局具体模型，应在安装回执中说明它只影响直接调用，不构成仓库 profile。

### 15.5 Sidecar

写入：

```text
~/.zcode/agents/.ghost-agent-market.json
```

至少记录：

- bundle version；
- source ref；
- installed Agent；
- contract digest；
- allowed custom metadata；
- replaced legacy Agent；
- backup path；
- installation time。

Installer 只覆盖 Registry 管理的 Agent，不影响其他用户 Agent。

## 16. 旧 Workflow 处理

新 Runtime 不自动接管存在 running task/thread 的旧 workflow。

- 已完成：允许只读查看；
- 未开始执行的旧 Plan：可显式迁移；
- 存在 running task/thread：返回 `LEGACY_ACTIVE_WORKFLOW_REQUIRES_USER_ACTION`；
- 用户必须结束、取消或归档旧 workflow 后再使用新 runtime；
- 不将旧 thread 状态猜测为新的 one-shot Action。

## 17. ZCode 独立构建链路

当前 ZCode `goal-dag.mjs` 无法由共享 builder 重现。实施前建立明确的 ZCode 生成路径：

- 独立 ZCode source/build target，或共享 source 中严格的平台条件；
- 生成目标只写 `zcode-market/`；
- 测试确认 Claude/Codex 生成产物 byte-for-byte 不变；
- 禁止直接长期维护带“Generated”头但无法重现的 ZCode 文件。

Registry、runtime dispatch mapping 和测试清单应来自同一可审计来源。

## 18. 扩展规则

### 18.1 现有权限边界内的新 Operation

只修改 Registry、Skill、Runtime 和测试，不新增 Agent。

### 18.2 新权限或信任边界

只有出现以下至少一种变化时新增 Agent：

- 可写或只读范围；
- 信任等级；
- 审查独立性；
- 用户授权条件；
- 可调用工具集合。

### 18.3 机械动作

digest、schema、reserve、dependency gate、branch/worktree、result acceptance 和状态迁移进入 Runtime，不新增 Agent/Skill。

### 18.4 用户交互

Quick/DAG 选择、Owner 变化、reclaim 决策和最终交付进入 Main coordination Skill，不新增 Agent。

## 19. 测试要求

### 19.1 Registry

验证 Agent ID 唯一、Skill 存在、Operation 合法、Review 无写权限、旧映射完整，以及 installer/runtime/test 使用同一清单。

### 19.2 Installer

覆盖全量下载后再写、校验失败零写入、备份、metadata 迁移、无关 Agent 不受影响、失败回滚、幂等、sidecar、固定 ref 和网络失败。

### 19.3 Runtime

覆盖 Planner、Plan Review、Owner、Implementation Review 派发；确认不再派发 Supervisor；覆盖 Quick 串行、DAG 并行、lease/scope 冲突、stale action、重复 result、Agent 崩溃、repair、subgraph 和最终完成。

### 19.4 Config

覆盖 strict reader 零写入、V1 检测、显式 V1→V2、main/lite、parallel 1–8 和单字段 Writer。

### 19.5 Dashboard

覆盖 start 不终止活进程、status 零写入、stop 验证进程身份和禁止按端口误杀。

### 19.6 构建与跨平台

覆盖 ZCode generated artifacts 可重现，并确认 `claude-code-market/`、`codex-market/` 未被 ZCode 单端改动污染。

## 20. 发布和版本

修改 workflow plugin 时，基础版本从 `0.1.5` 增加到 `0.1.6`。修改普通 skills plugin 时，从 `0.1.3` 增加到 `0.1.4`。同步更新各自 manifest 与根 `marketplace.json`。

ZCode 单端变化不运行 Claude/Codex Skill 同步脚本，也不修改 Codex cachebuster。

发布流程：

1. 完成实现和全部测试；
2. 确认 Claude/Codex 目录无差异；
3. 更新文档与版本；
4. 用户明确要求后提交；
5. 推送到在线 GitHub marketplace；
6. ZCode 从在线 marketplace 刷新；
7. 用户运行一次性全局 Agent 同步；
8. 重启 ZCode；
9. 执行 Quick 和 DAG 端到端验证。

## 21. 实施阶段

1. **契约与构建基础**：Registry、Action/Binding/Result schema、ZCode 独立 build/test lane；
2. **Runtime 调度**：`next-actions`、action open/result、Scheduler、dispatch batch、crash/reclaim；
3. **Agent 与 Skill**：4 个 workflow Agent、7 个 utility Agent、8 个 Skill；
4. **Installer 与迁移**：bundle、备份、事务替换、metadata、sidecar；
5. **Config 与 Dashboard**：V2、strict reader、显式迁移、三操作分离；
6. **文档与发布**：版本、在线 marketplace、一次性同步和端到端验证。

## 22. 完成标准

重构完成必须同时满足：

1. Main 是唯一 Agent 调度者；
2. Runtime 是唯一 workflow 状态写入者；
3. 不存在 Main 或 Supervisor 用户级 Agent；
4. Runtime 不依赖私有 Session API；
5. 每个专业 Agent 一次只打开一个 Binding；
6. Agent 不创建、调用、等待或通知其他 Agent；
7. Skill 不能自行选择 Operation；
8. Owner 与 Implementation Reviewer 权限分离；
9. Config Read/Write 分离；
10. Dashboard Start/Status/Stop 分离；
11. 新普通 Operation 不要求新增 Agent；
12. 只有新权限边界才新增 Agent；
13. 旧 Agent 已备份并一次性替换；
14. 活动旧 workflow 不被自动接管；
15. ZCode runtime 可重现生成；
16. Claude/Codex 内容保持不变；
17. 所有 ZCode runtime、installer、config 和 dashboard 测试通过。
