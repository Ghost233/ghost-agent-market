---
name: subagent-goal-worker
description: 仅供 subagent-coordination 分发完整 TASK_BINDING_V5 时内部使用，且 binding.executor_mode 必须为 subagent；执行同一 Goal/Owner 的一个 fenced attempt，从 Owner Capsule 恢复上下文并写入唯一 WORKER_RESULT_V5。普通请求、不完整绑定、其他 mode 或绕过 coordinator 的调用不得触发。
---

# Codex 子代理 Worker

## 边界

只执行一个 binding。逻辑 Owner 与永久 `OWNER_CAPSULE_V2` 是跨 Goal 持久真相源；Goal session Capsule、当前 Agent 的会话记忆和复用都只是运行时视图或性能优化。

不得创建新的执行单元或继续委派。不得修改 goal/coverage/plan/state/capsule，不得直接编辑 `capsule.json`，不得暂存、提交、推送或扩大 Goal。协调元数据只允许写 binding 指定的 checkpoint_path、attempt 唯一 result_path、模块 Owner 的 `published_artifact_directory`，以及固定 actor binding 中非空的精确 `evidence_artifact_paths`；其它 runtime/Owner 路径不可写。

Codex binding 使用固定 runtime profile；Claude Code 使用平台默认 profile。这是有意的平台差异。每次接收 binding 时读取 [references/templates.md](references/templates.md) 与 [永久 Owner 治理](../subagent-coordination/references/owner-governance.md)。

## 绑定门禁

1. 要求完整 `TASK_BINDING_V5`，`executor_mode: subagent`，且 identity/attempt/token/source revision、`workspace_change_seq`、Registry/Capsule、scope include/exclude、`published_artifact_directory`、worktree/source/coverage binding、`dependency_inputs`、plan-item effect、约束、副作用、verification、artifact map 与唯一 result_path 全部存在。runtime actor 的 Registry/Capsule/published directory 可以按契约为 null。
2. 读取 state，等待 task 进入 running；核对 task、Owner、generation、executor_id、attempt、token、source revision 和 result_path。
3. 重新计算 Registry/Capsule/worktree/source/coverage binding；只按 `dependency_inputs` 消费依赖。同 Owner 可以读取绑定的 accepted result；跨 Owner 只能读取 published interface/handoff；runtime actor 只消费证据摘要。普通 task 不读取整篇 source、无关 task 或其他 Owner 代码。
4. 任一身份或路径不一致时不修改业务文件，返回原始错误。同一 task/attempt/token 的完全相同 binding 是 crash recovery 重投：不得重置进度、并发重复执行或覆盖已有 canonical result；继续当前 attempt，结果已存在时只返回同一结果。只有 state 已进入新 attempt 且新 binding 完整通过门禁时，才替换旧 task 权限。同一 Agent 同时只能执行一个 binding。
5. 新 generation Agent 从 Capsule 的 decisions、invariants、progress、important_symbols 与 next_steps 恢复，不依赖旧 Agent 存活。

## 执行与副作用边界

- 只处理 binding 的 `plan_item_ids` 所映射范围，满足 task、done_when 与 `verification_requirements`；不得自行扩张到其他 coverage item。
- 模块代码只能在 `owner_scope_patterns - owner_scope_excludes` 内读取、搜索；只修改 `goal_constraints.scope`、Owner scope 与 effective `writable_paths` 的交集。其他 Owner 的模块即使位于 Goal scope 内也不可读取、搜索、修改、审查或代为调研。平台提供 Owner allowlist gateway/OS sandbox 时必须使用；没有硬隔离能力的严格运行环境必须 fail closed，不能用普通 shell/file 工具绕过。
- `side_effect_policy` 未显式授权的部署或外部写入一律禁止。不要把验证命令解释成副作用授权。
- `work` 只修改 writable paths；`review` 和 `verify` 保持 changed_files 为空。
- 共享工作区中的并行兄弟改动不是本 task 产物。不得撤销或覆盖用户与其他 Owner 的合法改动；跨模块只消费 `dependency_inputs` 中对应 Owner 发布的 interface/handoff，不读取其 raw result ref。
- 需要越过 scope、non-goal 或 side-effect policy 时先停止，返回 `needs_repair` 与精确 scope_request；不得先做后报。

## Checkpoint 与证据

在关键决策后、长验证前、感知上下文压力或准备轮换时写 `OWNER_CHECKPOINT_V1`，再调用 driver `checkpoint`。只保存恢复事实，不复制源码、完整日志或聊天历史。

每条 evidence 必须对应 binding 中的 requirement description，并记录可复核的命令/方法、outcome、关键输出摘要、`artifact_ref` 与 `artifact_digest`；没有 artifact 时两者都写 null，不能省字段或只写“已验证”。

- `source-coverage-audit`：把每个 block 的 `mapped`（精确 plan item ids）或 `non_requirement`（非空理由）proposal 写入 binding `evidence_artifact_paths` 的精确路径，再运行 runtime `source-audit`。不得遗漏 block 或自己伪造最终 `SOURCE_COVERAGE_AUDIT_V1`。
- `diff-scope-audit`：直接运行 runtime `diff-audit`。runtime 会扫描 Goal 初始 `WORKTREE_BASELINE_V1`、当前真实工作区和 accepted work results；不得只复述 `changed_files` 或手写 `DIFF_SCOPE_AUDIT_V1`。
- `source-audit`、`diff-audit`、`commit-readiness` stdout 返回的 artifact ref/digest 必须原样放入 evidence；不得换路径或复用旧 revision/sequence artifact。

## 结果

1. 完成最小完整实现或只读检查，逐项核对 plan items、done_when 与 verification requirements。
2. 做 diff_self_check，报告观察到的当前 attempt changed files 并显式记录 `blocking_findings`；最终归因由 runtime 使用 bind snapshot 自动计算，不能依赖自报。
3. 构造一个 `WORKER_RESULT_V5`；task、Owner、generation、executor、attempt、token 与 source revision 必须与 binding/state 一致。
4. 先原子写入 binding 的唯一 result_path，再返回相同 JSON。不得覆盖其他 attempt 文件。
5. 把可复用决策、不变量和风险放入 owner_updates；由 driver 在 `finish` 时合并到永久 `OWNER_CAPSULE_V2`。Goal/Plan/result/checkpoint/session Capsule 均不作为 Git 持久化数据。

`completed` 必须覆盖 verification/effect。三个固定 gate 只能由对应 runtime actor binding 提交。模块完成时按 binding 目录发布 handoff/interface/commit attestation；跨 Owner 产物不得暴露 raw result。needs_repair 的同 Owner 精确路径可由 coordinator 调 `expand-task-scope` 后重排；其他路径走 Owner 路由/治理。`finish` 是身份、范围、revision、sequence、artifact 与自动归因的唯一机械裁决。
