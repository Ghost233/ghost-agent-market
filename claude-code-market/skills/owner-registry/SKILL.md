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
- **L2 = sparse visibility superset（非授权边界）**：runtime 在 `.ghost-agent-workflow/worktrees/<goal>/<owner>` 创建唯一物理 worktree，并把 glob 保守投影为可见目录；它只减少暴露面，最终写授权仍由 L1/L3 的 exact matcher 决定。投影为空、退化到仓库根或无法安全映射时拒绝创建。
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
3. `can_cover=false` → `owner-add`/`owner-split --plan` 取得包含 `registry_digest`、`proposal_digest` 与 `confirmation_scope=anti_accidental_and_toctou_only` 的方案；controller 用 AskUserQuestion 展示方案，用户确认后以同一 `proposal_digest` 执行 `--confirm` 落盘
4. planner 产 plan：`owners[].id` 引用 registry active owner，`writable_paths` 派生自 `owned_modules` **[planner]**
5. `owner-verify-plan` 机械复核（只读）**[planner]**
6. `owner-bind-goal` 先冻结 required work Owner 的 `pending` delivery 投影，再逐个执行 `worktree-create`；每次创建后运行 `owner-delivery-reconcile`，仅在 worktree identity、base 与 scope 未漂移时推进到 `active` **[controller]**
7. 命名子代理开发，Agent spawn name = `owner-<owner_id>` **[worker]**
8. controller 收口，先 `worktree-commit` seal，再 reconcile 到 `sealed` 并执行 `worktree-merge-back` **[controller]**
9. merge 后 reconcile 到 `merged`；此后才允许 final diff audit 与 `finalize` **[controller]**
10. `finalize` 后可 `worktree-remove` 清理 per-owner worktree；删除后的 reconcile 必须保留已证明的 `merged` 状态 **[controller]**

## 三大生命周期操作

1. **查询覆盖**（planner 规划前必跑，只读）：把需求涉及的模块交给 `owner-query`，得到 `covered`/`gaps`/`split_candidates`/`can_cover`。`can_cover=false` 时先 `owner-add`/`owner-split` 再规划。
2. **新增 owner**：`owner-add` 注册新功能域 owner。新 owner 的 `owned_modules`/`interfaces` 与全表现有 owner 不相交，否则 runtime 拒绝。
3. **分裂 owner**：`owner-split` 把父 owner 的部分模块拆给一个或多个新 owner。父保留未被认领的模块；若全部被认领则 lifecycle 置 `retired` 并作为只读 tombstone 保留审计历史。父置 `retired` 前，controller 须先对其 live worktree 跑完整 commit/merge/remove 主链释放槽位。拆出的子 owner 须各自落在父域内且互斥。

```text
node <plugin-root>/scripts/goal-dag.mjs owner-list  <registry.json>
node <plugin-root>/scripts/goal-dag.mjs owner-add   <registry.json> <owner-def.json> --plan|--confirm <proposal_digest>
node <plugin-root>/scripts/goal-dag.mjs owner-query <registry.json> <requirement.json>
node <plugin-root>/scripts/goal-dag.mjs owner-split <registry.json> <parent_owner_id> <split-spec.json> --plan|--confirm <proposal_digest>
```

## 变更 owner 必须先经用户确认（硬约束，不可跳过）

`owner-add` 与 `owner-split` 会改写跨 Goal 的 owner 拓扑，影响面广且不可逆，故由用户拍板——**执行前必须**：

1. 先跑 dry-run：`owner-add ... --plan` / `owner-split ... --plan`。输出除候选变化外还包含 `registry_digest`、`proposal_digest` 和 `confirmation_scope: anti_accidental_and_toctou_only`。
2. 把方案以 **AskUserQuestion** 列给用户确认：新增/拆出的 owner_id、functional_domain、owned_modules、interfaces、（split 的）父 owner 保留域与 lifecycle 变化、与现有 owner 的互斥校验结果。
3. **用户明确确认后**，执行 `owner-add ... --confirm <proposal_digest>` 或 `owner-split ... --confirm <proposal_digest>`。runtime 在 registry lock 内重读输入与 registry 并重算 digest；参数或 registry 漂移、错误 digest及成功后的重放都会失败。

`proposal_digest` 只能绑定所展示的 proposal 与当时 registry 状态，提供防误操作和 TOCTOU 保护；它**不能证明 AskUserQuestion 确实发生、回答者身份或人类批准**。human confirmation 仍是 controller 必须遵守的流程约束，不能把 digest 描述为可信审批票据。

**禁止跳过确认直接 add/split。** 即便 planner/worker 经 `needs_repair.scope_request` 建议分裂，也必须由 controller 走上述确认流程，不得自动执行。`owner-query`/`owner-list`/`owner-verify-plan` 只读，无需确认；`owner-note` 由 controller 在主工作区写入（见「owner 记忆」节）。

hook 只对命令形态做硬门禁：Owner mutation 必须是单一直接命令，且只能使用 `--plan` 或格式正确的 `--confirm <proposal_digest>`；复合 shell、混合 flag 和无确认参数命令均拒绝。proposal 与 registry freshness 的最终校验由 runtime 在 registry lock 内完成。

## 归档 owner 数据（随仓库提交）

所有 owner 数据落在 `.ghost-agent-workflow/`：`owners/registry.json`（注册表）、`owners/<id>/memory.md` + `requirements/*.md`（记忆）、`owners/<id>/worktree_binding`。这些**随仓库 git 提交永久存档**，跨需求/跨机器可追溯。

`owner-init` 自动写 `.ghost-agent-workflow/.gitignore`：仅忽略运行时临时文件（`worktrees/`、`*.lock`、`*.lock.*.tmp`、`*.tmp`、`*.transaction.json`），保留 `owners/` 与 `registry.json` 可提交。若 `owner-init` 输出 `archive_warning` 非空，说明仓库根 `.gitignore` 整体忽略了 `.ghost-agent-workflow/`（git 规则下子目录无法重新包含）——必须把根忽略改为上述粒度，owner 数据才能存档。

## 校验 plan↔registry 一致性

planner 产 plan 前，每个 `owners[].id` 必须引用 registry `lifecycle=active` 的 owner，`writable_paths` 必须是该 owner `owned_modules` 的子集。产出后用 `owner-verify-plan` 机械复核（只读）：任何 plan owner 未注册或 writable 越界即 `fail`。

```text
node <plugin-root>/scripts/goal-dag.mjs owner-verify-plan <registry.json> <plan.json>
```

## 绑定 per-owner worktree（物理隔离）

每个 owner 至多一个 live worktree；runtime 使用由 feature branch、owner_id 与 base OID 派生的唯一 `owner_<owner_id>_<digest>` 分支，并在 `.ghost-agent-workflow/worktrees/<digest>/<owner_id>` 建立 worktree。sparse checkout 只暴露 `owned_modules` 的保守目录投影。1 owner = 1 live worktree，重复创建即 `fail`。

**三映射**（逻辑身份 ↔ 物理载体）：

- Agent spawn name = `owner-<owner_id>` ↔ `registry.owners[].owner_id`（逻辑身份）↔ runtime 派生的 `worktree_binding.owner_branch`（物理载体）。
- spawn name `owner-<owner_id>` 即 SendMessage 二次寻址句柄（稳定，跨 attempt 不变）。
- runtime 的 `executor_spawn_name`（形如 `runtime-...-g2_a2_<hex>`）跨 attempt 会变、不稳定，仅作 per-attempt executor_id / reservation token 用于 worktree bind，不能当 Agent spawn name。controller 以 `owner-<owner_id>` 为 Agent 名 spawn；`executor_spawn_name` 作 executor_id bind。

```text
node <plugin-root>/scripts/goal-dag.mjs worktree-create      <registry.json> <feature_branch> <owner_id>
node <plugin-root>/scripts/goal-dag.mjs worktree-commit      <registry.json> <owner_id>
node <plugin-root>/scripts/goal-dag.mjs worktree-merge-back  <registry.json> <feature_branch> <owner_id>
node <plugin-root>/scripts/goal-dag.mjs worktree-remove      <registry.json> <owner_id> [--force]
node <plugin-root>/scripts/goal-dag.mjs owner-bind-goal      <goal.json> <goal-state.json> <plan.json> <state.json> <registry.json> <feature_branch>
node <plugin-root>/scripts/goal-dag.mjs owner-delivery-reconcile <goal.json> <goal-state.json> <plan.json> <state.json> <registry.json>
node <plugin-root>/scripts/goal-dag.mjs owner-delivery-recover <registry.json> --plan|--confirm <proposal_digest>
```

`worktree-create`/`worktree-commit`/`worktree-merge-back`/`worktree-remove` 仍是 registry-first 命令，但每项 Git mutation 都在副作用前 durable 写入 `OWNER_GIT_INTENT_V1`。Git 后、registry 前崩溃时先运行 `owner-delivery-recover --plan`，只读核对 registry digest、登记 branch/path、worktree list、base/committed/feature OID 与 commit/merge operation marker；仅 `safety=safe` 的同一 proposal 才可 `--confirm` 前滚。unknown orphan、ref/path 漂移或 merge conflict 必须保留 intent并进入 `needs_repair`，禁止自动 adopt/delete/abort。proposal digest仍只提供防误操作和 TOCTOU。controller 用 `owner-bind-goal` 冻结 `pending` delivery，创建后 reconcile 到 `active`，commit/merge后继续 reconcile；delta新增 live writable Owner在下一次 reconcile以 `pending` 纳入。

## Git intent 与恢复契约

`OWNER_GIT_INTENT_V1` 存在于 `<registry.json>.git-intent.json`，是 runtime 临时恢复状态并由 `.gitignore` 忽略。任一 worktree mutation前若已有 intent，禁止启动新操作；先运行 `owner-delivery-recover --plan`。恢复分类：

- `safe`：Git未应用、Git已应用但registry滞后，或registry已发布但intent未清；可用同一 `proposal_digest` 执行 `--confirm`。
- `needs_repair`：registry digest漂移、branch/path/OID/operation marker不符、unknown orphan或冲突状态；不得confirm，不得人工删除intent后继续。
- 无intent但发现相似 branch/path不代表属于当前Owner；runtime不会自动adopt。

create恢复要求登记 path上的 worktree branch/HEAD/base精确吻合；commit恢复要求 branch tip是唯一带同一 operation marker且parent正确的新commit；merge恢复要求 feature tip是带marker、两个parent分别为冻结feature tip与owner committed OID的merge commit；remove只删除intent精确登记的path/branch/OID。无法唯一证明时保留现场供人工审计。

## 沉淀 owner 记忆

每次需求沉淀到 `.ghost-agent-workflow/owners/<owner_id>/requirements/<UTC-ts>-<slug>.md`（原文+决策+验收）与 rolling `memory.md`，跨需求可追溯。用 `owner-note` 原子追加（`kind=requirement` 同时落独立需求文档 + memory 滚动条目；`kind=memory` 仅追加 memory）。

**归属**：`owner-note` 由 **controller（subagent-coordination）在主工作区**写 `owners/<id>/memory.md` + `requirements/`（主工作区路径，随仓库提交）。worker **绝不**写 `memory.md`（会触发 L3 scope audit 越界 `fail` + 违反 worker 写白名单）。worker 经其结果契约的 `owner_updates` 字段（WORKER_RESULT_V4）回写 per-Goal Capsule；controller 收口时把关键 decisions/invariants 经 `owner-note` 沉淀为跨 Goal registry memory。命名子代理经 SendMessage 二次寻址做记忆汇总是「可选增强，平台前提验证后启用」，不影响「命名子代理不回收」的承重性（承重靠 SendMessage 跨 attempt 稳定寻址做任务分发/状态查询）；当前默认 controller 据 `owner_updates` + runtime 登记的 feature/owner branch diff（merge-back 前后均可用，即 L3 scope audit 同一 diff）自写 owner-note。

```text
node <plugin-root>/scripts/goal-dag.mjs owner-note <registry.json> <owner_id> <note.json>
```

## 查询覆盖并保证零冲突

`owned_modules` 用仓库相对 glob（`**`/`*`/`?`/`[...]`/`{a,b}`）。全表互斥 + `interfaces` 独占 ⇒ 各 owner worktree 改动严格落在自己域内 ⇒ `worktree-merge-back` 用 `--no-ff` 合并（保留合并节点）+ 已内置 L3 per-owner scope audit（`diff feature..owner` 逐文件比对 `owned_modules`，越界即 `fail`）。任何 scope audit 越界都意味 registry 被绕过，须排查 owner 定义而非手工解冲突。

## 契约与模板

> 以下契约原存于 `references/registry.md`，现已内联于本节，触发本 skill 即见，无需再 Read references。

### 功能域 Owner 注册表契约

仅在创建、校验或变更 `OWNERS_REGISTRY_V1`，或准备 owner mutation/query/verification/note/recovery 输入时参考本节。配套命令由 `scripts/goal-dag.mjs` 提供：`owner-init`/`owner-list`/`owner-add --plan|--confirm`/`owner-query`/`owner-split --plan|--confirm`/`owner-verify-plan`/`owner-note`/`owner-bind-goal`/`owner-delivery-reconcile`/`owner-delivery-recover --plan|--confirm`/`worktree-create`/`worktree-commit`/`worktree-merge-back`/`worktree-remove`。

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
- `history`：事件流水，`event` ∈ {`created`,`split`,`split_from`,`retired`,`worktree_created`,`worktree_committed`,`worktree_merged`,`worktree_removed`}。
- `worktree_binding`：`null` 或 `{feature_branch, owner_branch, worktree_path, status, created_at, base_oid, committed_oid, committed_at, merged_oid, merged_at}`；`owner_branch` 由 runtime 按 feature/base/owner 唯一派生，`status` ∈ {`active`,`sealed`,`merged`,`removed`}。同一 owner 至多一个 live（`active`/`sealed`）binding。

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

owner-worktree visibility + PreToolUse写权限钉位依赖宿主 Hook元数据与 worktree-local controller。Claude Code 2.1.220 的 Agent surface不能指定一个已存在 cwd；controller必须用 `scripts/claude-owner-host.py` 在登记 worktree的 OS cwd启动独立 Claude session，并由 adapter在启动前后校验 path/branch/HEAD/common-dir。禁止请求 `isolation`/`--worktree` 创建第二个 worktree，也禁止退回主 checkout。Hook provenance只在显式 opt-in smoke中脱敏记录，是特定 host/version observation，不是密码学身份保证。
