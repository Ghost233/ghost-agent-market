---
name: owner-registry
description: 仅供 parallel-task-planner 与 subagent-coordination 内部使用：维护跨 Goal 的功能域 owner 注册表（OWNERS_REGISTRY_V1），提供 owner-add/owner-split/owner-query/owner-list 以及 owner 的 worktree 绑定。普通用户请求、未收口需求或绕过 controller 的调用不得触发。
user-invocable: false
---

# 功能域 Owner 注册表

## 边界

只维护跨 Goal 仓库级 owner 身份、模块独占域、接口独占、生命周期与 worktree 绑定的真相源。不创建执行单元、不选择 Agent、不直接改 Goal 的 plan/state/capsule（split/add 后让 active Goal 感知仍由 planner 产 `DAG_DELTA_V1`）、不复制整篇 source。

owner 之间**严格文件隔离**：每个 owner 的 `owned_modules` + `interfaces` 全表两两不相交（runtime `pathsOverlap` 强制，重叠即 `fail`）。跨切面共享文件（proto/api/interface）归单一 owner 独占，其余 owner 只读消费——这保证各 owner worktree 分支合并回 feature 分支时零冲突。

本 skill 是 Claude Code `parallel-task-planner`（覆盖检查）与 `subagent-coordination`（fan-out/merge-back）自动调用的内部能力，不是公开入口。owner-worktree 物理隔离 + 写权限钉位依赖 Claude Code 的 `isolation:worktree` frontmatter 与 PreToolUse hook（按 `agent_type` 映射 owner 模块）；Codex/Kimi 平台不具备等价能力，故仅 claude 端实现 owner 体系，codex/kimi 继续用共享 workspace + `tasksConflict` 逻辑互斥。这是有意的平台差异。

写入任何产物前读取 [references/registry.md](references/registry.md)。

## 数据层次

| 层 | 作用域 | 真相源 | 内容 |
|---|---|---|---|
| `OWNERS_REGISTRY_V1` | 跨 Goal 仓库级 | `.ghost-agent-workflow/owners/registry.json` | owner 身份、`owned_modules`、`interfaces`、lifecycle、history、memory_docs_ref、worktree_binding |
| `DAG_PLAN_V4.owners[]` | 单 Goal | plan.json | task 归属；`id` 引用 registry active owner，`writable_paths` 由 `owned_modules ∪ interfaces` 派生 |
| Owner Capsule | 单 Owner×Goal | capsule.json | decisions/invariants/completed_tasks/evidence（subagent-coordination 维护） |

registry 是身份/模块/记忆真相源；plan.owners[] 是 Goal 内投影。一致性：plan 中每个 owner_id 必须在 registry `lifecycle=active`。

## 初始化

```text
node <plugin-root>/scripts/goal-dag.mjs owner-init <registry.json> <workspace_root>
```

## 三大生命周期操作

1. **查询覆盖**（planner 规划前必跑）：把需求涉及的模块交给 `owner-query`，得到 `covered`/`gaps`/`split_candidates`/`can_cover`。`can_cover=false` 时先 `owner-add`/`owner-split` 再规划。
2. **新增 owner**：`owner-add` 注册新功能域 owner。新 owner 的 `owned_modules`/`interfaces` 与全表现有 owner 不相交，否则 runtime 拒绝。
3. **分裂 owner**：`owner-split` 把父 owner 的部分模块拆给一个或多个新 owner。父保留未被认领的模块；若全部被认领则 lifecycle 置 `retired`。拆出的子 owner 须各自落在父域内且互斥。

```text
node <plugin-root>/scripts/goal-dag.mjs owner-list  <registry.json>
node <plugin-root>/scripts/goal-dag.mjs owner-add   <registry.json> <owner-def.json> [--plan]
node <plugin-root>/scripts/goal-dag.mjs owner-query <registry.json> <requirement.json>
node <plugin-root>/scripts/goal-dag.mjs owner-split <registry.json> <parent_owner_id> <split-spec.json> [--plan]
```

## 变更 owner 必须先经用户确认（硬约束，不可跳过）

`owner-add` 与 `owner-split` 会改写跨 Goal 的 owner 拓扑，**执行前必须**：

1. 先跑 dry-run 拿方案：`owner-add ... --plan` / `owner-split ... --plan`（输出 `would_add`/`parent_would_retain`/`new_owners`，不落盘）。
2. 把方案以 **AskUserQuestion** 列给用户确认：新增/拆出的 owner_id、functional_domain、owned_modules、interfaces、（split 的）父 owner 保留域与 lifecycle 变化、与现有 owner 的互斥校验结果。
3. **用户明确确认后**，才执行不带 `--plan` 的正式命令落盘。

**禁止跳过确认直接 add/split。** 即便 planner/worker 经 `needs_repair.scope_request` 建议分裂，也必须由 controller 走上述确认流程，不得自动执行。`owner-query`/`owner-list`/`owner-verify-plan` 只读，无需确认。

## 数据存档（随仓库提交永久存档）

所有 owner 数据落在 `.ghost-agent-workflow/`：`owners/registry.json`（注册表）、`owners/<id>/memory.md` + `requirements/*.md`（记忆）、`owners/<id>/worktree_binding`。这些**随仓库 git 提交永久存档**，跨需求/跨机器可追溯。

`owner-init` 自动写 `.ghost-agent-workflow/.gitignore`：仅忽略运行时临时文件（`worktrees/`、`*.lock`、`*.lock.*.tmp`、`*.tmp`、`*.transaction.json`），保留 `owners/` 与 `registry.json` 可提交。若 `owner-init` 输出 `archive_warning` 非空，说明仓库根 `.gitignore` 整体忽略了 `.ghost-agent-workflow/`（git 规则下子目录无法重新包含）——必须把根忽略改为上述粒度，owner 数据才能存档。

## plan↔registry 一致性

planner 产 plan 前，每个 `owners[].id` 必须引用 registry `lifecycle=active` 的 owner，`writable_paths` 必须是该 owner `owned_modules` 的子集。产出后用 `owner-verify-plan` 机械复核：任何 plan owner 未注册或 writable 越界即 `fail`。

```text
node <plugin-root>/scripts/goal-dag.mjs owner-verify-plan <registry.json> <plan.json>
```

## worktree 绑定（per-owner 物理隔离）

每个 owner 至多一个 live worktree：分支 `dev_{owner_id}`，从 feature 分支切出，sparse checkout 仅含 `owned_modules`。1 owner = 1 worktree，重复创建即 `fail`。`worktree-create`/`worktree-merge-back`/`worktree-remove` 由 subagent-coordination 在 fan-out 与合并阶段调用。

```text
node <plugin-root>/scripts/goal-dag.mjs worktree-create     <registry.json> <feature_branch> <owner_id>
node <plugin-root>/scripts/goal-dag.mjs worktree-merge-back <registry.json> <feature_branch> <owner_id>
node <plugin-root>/scripts/goal-dag.mjs worktree-remove     <registry.json> <owner_id> [--force]
```

## owner 记忆

每次需求沉淀到 `.ghost-agent-workflow/owners/<owner_id>/requirements/<UTC-ts>-<slug>.md`（原文+决策+验收）与 rolling `memory.md`，跨需求可追溯。用 `owner-note` 原子追加（`kind=requirement` 同时落独立需求文档 + memory 滚动条目；`kind=memory` 仅追加 memory）。worker 经 `WORKER_RESULT_V4.owner_updates` 回写关键决策，subagent-coordination 镜像到 registry memory。

```text
node <plugin-root>/scripts/goal-dag.mjs owner-note <registry.json> <owner_id> <note.json>
```

## 覆盖检查与零冲突保证

`owned_modules` 用仓库相对 glob（`**`/`*`/`?`/`[...]`/`{a,b}`）。全表互斥 + `interfaces` 独占 ⇒ 各 owner worktree 改动严格落在自己域内 ⇒ `worktree-merge-back` 用 `--ff-only` 零冲突合回 feature 分支。任何合并冲突都意味着注册表被绕过，须排查 owner 定义而非手工解冲突。
