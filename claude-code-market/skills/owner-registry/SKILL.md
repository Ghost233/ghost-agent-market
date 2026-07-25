---
name: owner-registry
description: 仅供 parallel-task-planner 与 subagent-coordination 内部使用：维护跨 Goal 的功能域 owner 注册表（OWNERS_REGISTRY_V1），提供 owner-add/owner-split/owner-query/owner-list/owner-verify-plan/owner-note 以及 owner 的 worktree 绑定。未收口需求或绕过 controller 的调用不得触发（用户直触已由 user-invocable:false 挡）。
user-invocable: false
---

# 功能域 Owner 注册表

## 边界

只维护跨 Goal 仓库级 owner 身份、模块独占域、接口独占、生命周期与 worktree 绑定的真相源。不创建执行单元、不选择 Agent、不直接改 Goal 的 plan/state/capsule（split/add 后由 planner 产 plan 修订增量 `DAG_DELTA_V1` 通知 active Goal 重规划）、不复制整篇 source。

owner 之间**严格文件隔离**：每个 owner 的 `owned_modules` + `interfaces` 全表两两不相交（runtime `pathsOverlap` 强制，重叠即 `fail`）。跨切面共享文件（proto/api/interface）归单一 owner 独占，其余 owner 只读消费——这保证各 owner worktree 分支合并回 feature 分支时零冲突。

本 skill 是 Claude Code `parallel-task-planner`（覆盖检查）与 `subagent-coordination`（fan-out/merge-back）自动调用的内部能力，不是公开入口。写隔离由三层共同保证（全链统一编号）：

- **L1 = PreToolUse hook**（`owner-acl-hook.py`）：写前按 `agent_type` 硬 deny 越界写。
- **L2 = sparse worktree 物理隔离**：每个 owner 的 worktree sparse checkout 仅含 `owned_modules`，依赖 Claude Code 的 `isolation:worktree` frontmatter。
- **L3 = worktree-merge-back per-owner scope audit**：已实现于 `goal-dag.mjs`，合并时 `diff feature..owner` 逐文件比对 `owned_modules`，越界即 `fail`。

Codex/Kimi 平台不具备等价能力，故仅 claude 端实现 owner 体系，codex/kimi 继续用共享 workspace + `tasksConflict` 逻辑互斥。这是有意的平台差异。

写入任何产物前参考本 SKILL.md 末尾「## 契约与模板」节（OWNERS_REGISTRY_V1 / OWNER_DEF_INPUT / REQUIREMENT_INPUT / SPLIT_SPEC_INPUT 已内联，不再 Read references）。

## 数据层次

| 层 | 作用域 | 真相源 | 内容 |
|---|---|---|---|
| `OWNERS_REGISTRY_V1` | 跨 Goal 仓库级 | `.ghost-agent-workflow/owners/registry.json` | owner 身份、`owned_modules`、`interfaces`、lifecycle、history、memory_docs_ref、worktree_binding |
| `DAG_PLAN_V4.owners[]` | 单 Goal | plan.json | task 归属；`id` 引用 registry active owner，`writable_paths` 由 `owned_modules` 派生 |
| Owner Capsule | 单 Owner×Goal | capsule.json | decisions/invariants/completed_tasks/evidence（subagent-coordination 维护） |

registry 是身份/模块/记忆真相源；plan.owners[] 是 Goal 内投影。一致性：plan 中每个 owner_id 必须在 registry `lifecycle=active`。owner 互斥/覆盖域 = `owned_modules ∪ interfaces`（用于 owner 间不相交校验与覆盖查询），但 `writable_paths` 仅从 `owned_modules` 派生——`interfaces` ⊆ `owned_modules`，不额外拓宽写域。

## 初始化

```text
node <plugin-root>/scripts/goal-dag.mjs owner-init <registry.json> <workspace_root>
```

## 标准时序主链

术语：**controller** = `subagent-coordination` 在 fan-out/merge-back 阶段扮演的协调角色；**主工作区** = 根 workspace（owner worktree 之外的仓库根，registry 与 memory 落盘处）。

单需求从注册到合回的标准时序（每步标责任方）：

1. `owner-init` 初始化 registry **[controller]**
2. `owner-query` 覆盖检查（只读）**[planner]**：`can_cover=false` 则进入下一步
3. `can_cover=false` → `owner-add`/`owner-split --plan` 拿方案 + AskUserQuestion **[controller 确认]** 后落盘
4. planner 产 plan：`owners[].id` 引用 registry active owner，`writable_paths` 派生自 `owned_modules` **[planner]**
5. `owner-verify-plan` 机械复核（只读）**[planner]**
6. `worktree-create` 切 per-owner worktree **[controller]**
7. 命名子代理开发，Agent spawn name = `owner-<owner_id>` **[worker]**
8. controller 收口，`owner-note` 沉淀跨 Goal 记忆 **[controller]**
9. `worktree-merge-back`（`--no-ff` 合并 + L3 scope audit）**[controller]**
10. `finalize` → 交用户测 → `worktree-remove` 清理 per-owner worktree（释放 1 owner=1 worktree 槽位）**[controller]**

## 三大生命周期操作

1. **查询覆盖**（planner 规划前必跑，只读）：把需求涉及的模块交给 `owner-query`，得到 `covered`/`gaps`/`split_candidates`/`can_cover`。`can_cover=false` 时先 `owner-add`/`owner-split` 再规划。
2. **新增 owner**：`owner-add` 注册新功能域 owner。新 owner 的 `owned_modules`/`interfaces` 与全表现有 owner 不相交，否则 runtime 拒绝。
3. **分裂 owner**：`owner-split` 把父 owner 的部分模块拆给一个或多个新 owner。父保留未被认领的模块；若全部被认领则 lifecycle 置 `retired`。父置 `retired` 前，controller 须先对其 `status=active` 的 worktree 跑 `worktree-merge-back`/`worktree-remove` 释放槽位（见 registry.md）。拆出的子 owner 须各自落在父域内且互斥。

```text
node <plugin-root>/scripts/goal-dag.mjs owner-list  <registry.json>
node <plugin-root>/scripts/goal-dag.mjs owner-add   <registry.json> <owner-def.json> [--plan]
node <plugin-root>/scripts/goal-dag.mjs owner-query <registry.json> <requirement.json>
node <plugin-root>/scripts/goal-dag.mjs owner-split <registry.json> <parent_owner_id> <split-spec.json> [--plan]
```

## 变更 owner 必须先经用户确认（硬约束，不可跳过）

`owner-add` 与 `owner-split` 会改写跨 Goal 的 owner 拓扑，影响面广且不可逆，故由用户拍板——**执行前必须**：

1. 先跑 dry-run 拿方案：`owner-add ... --plan` / `owner-split ... --plan`（输出 `would_add`/`parent_would_retain`/`parent_would_lifecycle`/`new_owners`，不落盘）。
2. 把方案以 **AskUserQuestion** 列给用户确认：新增/拆出的 owner_id、functional_domain、owned_modules、interfaces、（split 的）父 owner 保留域与 lifecycle 变化、与现有 owner 的互斥校验结果。
3. **用户明确确认后**，才执行不带 `--plan` 的正式命令落盘。

**禁止跳过确认直接 add/split。** 即便 planner/worker 经 `needs_repair.scope_request` 建议分裂，也必须由 controller 走上述确认流程，不得自动执行。`owner-query`/`owner-list`/`owner-verify-plan` 只读，无需确认；`owner-note` 由 controller 在主工作区写入（见「owner 记忆」节）。

该约束由 owner-acl hook 在 runtime 硬强制：不带 `--plan` 的 `owner-add`/`owner-split` 命令（落盘形式）会被 PreToolUse hook 直接 `deny`，任何 agent（含主线程 controller）都无法绕过——必须先 `--plan` 暴露方案。`--plan` dry-run 放行。

## 归档 owner 数据（随仓库提交）

所有 owner 数据落在 `.ghost-agent-workflow/`：`owners/registry.json`（注册表）、`owners/<id>/memory.md` + `requirements/*.md`（记忆）、`owners/<id>/worktree_binding`。这些**随仓库 git 提交永久存档**，跨需求/跨机器可追溯。

`owner-init` 自动写 `.ghost-agent-workflow/.gitignore`：仅忽略运行时临时文件（`worktrees/`、`*.lock`、`*.lock.*.tmp`、`*.tmp`、`*.transaction.json`），保留 `owners/` 与 `registry.json` 可提交。若 `owner-init` 输出 `archive_warning` 非空，说明仓库根 `.gitignore` 整体忽略了 `.ghost-agent-workflow/`（git 规则下子目录无法重新包含）——必须把根忽略改为上述粒度，owner 数据才能存档。

## 校验 plan↔registry 一致性

planner 产 plan 前，每个 `owners[].id` 必须引用 registry `lifecycle=active` 的 owner，`writable_paths` 必须是该 owner `owned_modules` 的子集。产出后用 `owner-verify-plan` 机械复核（只读）：任何 plan owner 未注册或 writable 越界即 `fail`。

```text
node <plugin-root>/scripts/goal-dag.mjs owner-verify-plan <registry.json> <plan.json>
```

## 绑定 per-owner worktree（物理隔离）

每个 owner 至多一个 live worktree：分支 `dev_{owner_id}`，从 feature 分支切出，sparse checkout 仅含 `owned_modules`。1 owner = 1 worktree，重复创建即 `fail`。`worktree-create`/`worktree-merge-back`/`worktree-remove` 由 subagent-coordination 分别在 fan-out、合并与 finalize 后清理阶段调用。

**三映射**（逻辑身份 ↔ 物理载体）：

- Agent spawn name = `owner-<owner_id>` ↔ `registry.owners[].owner_id`（逻辑身份）↔ `worktree_binding.owner_branch = dev_{owner_id}`（物理载体）。
- spawn name `owner-<owner_id>` 即 SendMessage 二次寻址句柄（稳定，跨 attempt 不变）。
- runtime 的 `executor_spawn_name`（形如 `runtime-...-g2_a2_<hex>`）跨 attempt 会变、不稳定，仅作 per-attempt executor_id / reservation token 用于 worktree bind，不能当 Agent spawn name。controller 以 `owner-<owner_id>` 为 Agent 名 spawn；`executor_spawn_name` 作 executor_id bind。

```text
node <plugin-root>/scripts/goal-dag.mjs worktree-create     <registry.json> <feature_branch> <owner_id>
node <plugin-root>/scripts/goal-dag.mjs worktree-merge-back <registry.json> <feature_branch> <owner_id>
node <plugin-root>/scripts/goal-dag.mjs worktree-remove     <registry.json> <owner_id> [--force]
```

## 沉淀 owner 记忆

每次需求沉淀到 `.ghost-agent-workflow/owners/<owner_id>/requirements/<UTC-ts>-<slug>.md`（原文+决策+验收）与 rolling `memory.md`，跨需求可追溯。用 `owner-note` 原子追加（`kind=requirement` 同时落独立需求文档 + memory 滚动条目；`kind=memory` 仅追加 memory）。

**归属**：`owner-note` 由 **controller（subagent-coordination）在主工作区**写 `owners/<id>/memory.md` + `requirements/`（主工作区路径，随仓库提交）。worker **绝不**写 `memory.md`（会触发 L3 scope audit 越界 `fail` + 违反 worker 写白名单）。worker 经其结果契约的 `owner_updates` 字段（WORKER_RESULT_V4）回写 per-Goal Capsule；controller 收口时把关键 decisions/invariants 经 `owner-note` 沉淀为跨 Goal registry memory。命名子代理经 SendMessage 二次寻址做记忆汇总是「可选增强，平台前提验证后启用」，不影响「命名子代理不回收」的承重性（承重靠 SendMessage 跨 attempt 稳定寻址做任务分发/状态查询）；当前默认 controller 据 `owner_updates` + owner worktree diff（`diff feature..dev_{owner_id}`，merge-back 前后均可用，即 L3 scope audit 同一 diff）自写 owner-note。

```text
node <plugin-root>/scripts/goal-dag.mjs owner-note <registry.json> <owner_id> <note.json>
```

## 查询覆盖并保证零冲突

`owned_modules` 用仓库相对 glob（`**`/`*`/`?`/`[...]`/`{a,b}`）。全表互斥 + `interfaces` 独占 ⇒ 各 owner worktree 改动严格落在自己域内 ⇒ `worktree-merge-back` 用 `--no-ff` 合并（保留合并节点）+ 已内置 L3 per-owner scope audit（`diff feature..owner` 逐文件比对 `owned_modules`，越界即 `fail`）。任何 scope audit 越界都意味 registry 被绕过，须排查 owner 定义而非手工解冲突。

## 契约与模板

> 以下契约原存于 `references/registry.md`，现已内联于本节，触发本 skill 即见，无需再 Read references。

### 功能域 Owner 注册表契约

仅在创建、校验或变更 `OWNERS_REGISTRY_V1`，或准备 owner-add/owner-split/owner-query/owner-verify-plan/owner-note 输入时参考本节。配套命令由 `scripts/goal-dag.mjs` 提供：`owner-init`/`owner-list`/`owner-add [--plan]`/`owner-query`/`owner-split [--plan]`/`owner-verify-plan`/`owner-note`/`worktree-create`/`worktree-merge-back`/`worktree-remove`。

#### OWNERS_REGISTRY_V1

```json
{
  "contract": "OWNERS_REGISTRY_V1",
  "registry_version": 1,
  "workspace_root": "/absolute/workspace/root",
  "updated_at": "2026-07-24T00:00:00Z",
  "owners": [
    {
      "owner_id": "proto_owner",
      "functional_domain": "Proto 定义与同步",
      "owned_modules": ["src/proto/**"],
      "interfaces": ["src/proto/log_upload.proto"],
      "depends_on_owners": [],
      "lifecycle": "active",
      "history": [
        {
          "at": "2026-07-24T00:00:00Z",
          "event": "created",
          "reason": "日志上传需求",
          "child_ids": null,
          "parent": null
        }
      ],
      "memory_docs_ref": ".ghost-agent-workflow/owners/proto_owner/memory.md",
      "worktree_binding": null
    }
  ]
}
```

字段约束（runtime `parseOwnerRegistry` 强制）：

- `owner_id`：`[A-Za-z0-9][A-Za-z0-9._-]{0,95}`，全表唯一。
- `owned_modules`：非空数组，仓库相对 glob，经 `normalizePathPattern` 归一化（禁绝对路径 / `..` / 未归一化）。全表两两 `pathsOverlap` 不相交，重叠即 `fail`。
- `interfaces`：独占共享文件（proto/api/interface），须落在同 owner 的 `owned_modules` 内；同样全表不相交。
- `depends_on_owners`：声明的 owner 须存在于 registry。
- `lifecycle`：`active` | `split` | `retired`。
- `history`：事件流水，`event` ∈ {`created`,`split`,`split_from`,`retired`,`worktree_created`,`worktree_merged`,`worktree_removed`}。
- `worktree_binding`：`null` 或 `{feature_branch, owner_branch, worktree_path, status, created_at}`；`owner_branch` 形如 `dev_{owner_id}`，`status` ∈ {`active`,`merged`,`removed`}。同一 owner 至多一个 `status=active` 的 binding。

#### OWNER_DEF_INPUT（owner-add 输入）

```json
{
  "owner_id": "api_owner",
  "functional_domain": "API 接入",
  "owned_modules": ["src/api/**"],
  "interfaces": [],
  "depends_on_owners": ["proto_owner"]
}
```

`interfaces` 可省略（默认 `[]`），`depends_on_owners` 可省略。新 owner 的全部 `owned_modules`+`interfaces` 与现有 owner 不相交，否则 `fail`。

##### owner-add `--plan` 输出契约（dry-run，不落盘）

`owner-add ... --plan` 输出 `OWNER_ADD_PLAN_V1`，供 controller 经 AskUserQuestion 确认后再落盘：

```json
{
  "contract": "OWNER_ADD_PLAN_V1",
  "would_add": {
    "owner_id": "api_owner",
    "functional_domain": "API 接入",
    "owned_modules": ["src/api/**"],
    "interfaces": [],
    "depends_on_owners": ["proto_owner"]
  },
  "new_owners": ["api_owner"]
}
```

`would_add` 为即将新增的 owner 全量定义；`new_owners` 为本次将写入 registry 的 owner_id 列表（add 恒为单元素）。互斥校验在 dry-run 阶段执行，重叠即 `fail`。

#### REQUIREMENT_INPUT（owner-query 输入）

```json
{
  "modules": ["src/proto/log_upload.proto", "src/api/user.ts", "src/feature/new/**"],
  "text": "日志上传"
}
```

输出 `OWNER_COVERAGE_QUERY_V1`：`covered[{module,owner_id}]`、`gaps[]`（未被任何 owner 覆盖的模块）、`split_candidates[]`（模块跨度≥4 的 owner）、`can_cover`（`gaps` 为空则 true）。

```json
{
  "contract": "OWNER_COVERAGE_QUERY_V1",
  "text": "日志上传",
  "covered": [
    {"module": "src/proto/log_upload.proto", "owner_id": "proto_owner"},
    {"module": "src/api/user.ts", "owner_id": "api_owner"}
  ],
  "gaps": ["src/feature/new/**"],
  "split_candidates": [
    {"parent": "chat_owner", "reason": "模块跨度较大(5 条)"}
  ],
  "can_cover": false
}
```

`split_candidates[]` 每项为 `{parent, reason}`（`parent` 即待拆 owner_id）；`can_cover=false` 表示需求有未被覆盖的模块，需先 `owner-add`/`owner-split` 再规划。

#### SPLIT_SPEC_INPUT（owner-split 输入）

```json
{
  "reason": "聊天页拆分顶栏",
  "new_owners": [
    {
      "owner_id": "chat_topbar_owner",
      "functional_domain": "顶栏",
      "owned_modules": ["src/chat/topbar/**"],
      "interfaces": [],
      "depends_on_owners": ["chat_owner"]
    }
  ]
}
```

每个 `new_owners[].owned_modules`+`interfaces` 必须落在父 owner 的 `owned_modules` 内。父保留未被任何子 owner 认领的模块；若全部被认领则父 lifecycle 置 `retired`。子 owner 之间、子与父保留域、子与其他 owner 之间均须互斥。父若有 `status=active` 的 worktree 须先 merge-back/remove。

##### owner-split `--plan` 输出契约（dry-run，不落盘）

`owner-split ... --plan` 输出 `OWNER_SPLIT_PLAN_V1`，供 controller 经 AskUserQuestion 确认后再落盘：

```json
{
  "contract": "OWNER_SPLIT_PLAN_V1",
  "parent_would_retain": ["src/chat/**"],
  "parent_would_lifecycle": "active",
  "new_owners": [
    {
      "owner_id": "chat_topbar_owner",
      "functional_domain": "顶栏",
      "owned_modules": ["src/chat/topbar/**"],
      "interfaces": [],
      "depends_on_owners": ["chat_owner"]
    }
  ]
}
```

`parent_would_retain` 为父 owner 认领后剩余的 `owned_modules`；`parent_would_lifecycle` 为父 owner 目标 lifecycle（全被认领则 `retired`，否则 `active`）；`new_owners` 为本次将拆出的子 owner 全量定义。互斥/落域校验在 dry-run 阶段执行，越界即 `fail`。

#### 平台差异

owner-worktree 物理隔离 + PreToolUse 写权限钉位依赖 Claude Code 平台能力（`isolation:worktree` frontmatter + hook `agent_type` 上下文）。完整平台差异说明与写隔离三层（L1/L2/L3）见本 SKILL.md「边界」节。
