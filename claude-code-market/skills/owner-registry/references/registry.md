# Claude Code 功能域 Owner 注册表契约

仅在创建、校验或变更 `OWNERS_REGISTRY_V1`，或准备 owner-add/owner-split/owner-query 输入时读取本文件。配套命令由 `scripts/goal-dag.mjs` 提供：`owner-init`/`owner-list`/`owner-add`/`owner-query`/`owner-split`/`worktree-create`/`worktree-merge-back`/`worktree-remove`。

## OWNERS_REGISTRY_V1

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

## OWNER_DEF_INPUT（owner-add 输入）

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

## REQUIREMENT_INPUT（owner-query 输入）

```json
{
  "modules": ["src/proto/log_upload.proto", "src/api/user.ts", "src/feature/new/**"],
  "text": "日志上传"
}
```

输出 `OWNER_COVERAGE_QUERY_V1`：`covered[{module,owner_id}]`、`gaps[]`（未被任何 owner 覆盖的模块）、`split_candidates[]`（模块跨度≥4 的 owner）、`can_cover`（`gaps` 为空则 true）。

## SPLIT_SPEC_INPUT（owner-split 输入）

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

## 平台差异

owner-worktree 物理隔离 + PreToolUse 写权限钉位依赖 Claude Code 的 `isolation:worktree` frontmatter 与 hook `agent_type` 上下文。Codex/Kimi 不具备等价能力，故 owner 体系仅 claude 端实现；codex/kimi 继续用共享 workspace + `tasksConflict` 逻辑互斥。

```text
node <plugin-root>/scripts/goal-dag.mjs owner-init <registry.json> <workspace_root>
node <plugin-root>/scripts/goal-dag.mjs owner-add <registry.json> <owner-def.json>
```
