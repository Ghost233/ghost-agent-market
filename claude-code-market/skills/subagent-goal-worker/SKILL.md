---
name: subagent-goal-worker
description: 仅供 subagent-coordination 分发完整 TASK_BINDING_V4 时内部使用，且 binding.executor_mode 必须为 subagent；执行同一 Goal/Owner 的一个 fenced attempt，从 Owner Capsule 恢复上下文并写入唯一 WORKER_RESULT_V4。普通请求、不完整绑定、其他 mode 或绕过 coordinator 的调用不得触发。
user-invocable: false
---

# Claude Code 子代理 Worker

## 边界

只执行一个 binding。逻辑 Owner 与 Capsule 是持久真相源；当前 Agent 的会话记忆和复用只是性能优化。

不得创建或委派其他执行单元。不得修改 goal/coverage/plan/state/capsule，不得直接编辑 `capsule.json`，不得暂存、提交、推送或扩大 Goal。协调元数据只允许写 binding 指定的 checkpoint_path、attempt 唯一 result_path，以及固定 audit binding 中非空的精确 `evidence_artifact_paths`（source proposal/runtime audit artifact）；其它 runtime 路径不可写。

Claude Code binding 的 runtime profile 为 `null`，由平台选择执行配置；Codex 固定 profile。这是有意的平台差异。每次接收 binding 时读取 [references/templates.md](references/templates.md)。

## 绑定门禁

1. 要求完整 `TASK_BINDING_V4`，`executor_mode: subagent`，且 `executor_spawn_name`、`attempt`、`reservation_token`、`source_revision`、`worktree_baseline`、`source_blocks`、`coverage.{ref,digest,semantic_digest}`、非空 `plan_item_ids`、`coverage_effect`、goal constraints、side-effect policy、verification requirement descriptions、artifact path/contract maps 与唯一 result_path 全部存在。
2. 读取 state，等待 task 进入 running；核对 task、Owner、generation、executor_id、attempt、token、source revision 和 result_path。
3. 重新计算并核对 `worktree_baseline`、`source_blocks` 与 `coverage` 的绑定 digest/semantic digest；从 state 的 `result_ref/result_digest` 核对直接 `dependency_result_refs`。读取 Owner Capsule 时核对 ref、owner、generation、goal/source revision 和结构字段；binding 未提供 Capsule digest，不得假称已做 digest 校验。普通 task 不读取整篇 source 或无关 task；`source-coverage-audit` 例外，必须按 `SOURCE_BLOCKS_V1` 的全部 line span 读取 source，并从 `coverage.ref` 读取 required items↔source refs，校验 semantic digest 后逐块分类。使用 `plan_item_ids + coverage_effect` 维持本 task 与 required effect 的精确映射。
4. 任一身份或路径不一致时不修改业务文件，返回原始错误。同一 task/attempt/token 的完全相同 binding 是 crash recovery 重投：不得重置进度、并发重复执行或覆盖已有 canonical result；继续当前 attempt，结果已存在时只返回同一结果。只有 state 已进入新 attempt 且新 binding 完整通过门禁时，才替换旧 task 权限。同一 Agent 同时只能执行一个 binding。
5. 新 generation Agent 从 Capsule 的 decisions、invariants、progress、important_symbols 与 next_steps 恢复，不依赖旧 Agent 存活。

## 执行与副作用边界

- 只处理 binding 的 `plan_item_ids` 所映射范围，满足 task、done_when 与 `verification_requirements`；不得自行扩张到其他 coverage item。
- 只修改 `goal_constraints.scope` 与 `writable_paths` 的交集；不得违反 constraints/non_goals。
- `side_effect_policy` 未显式授权的部署或外部写入一律禁止。不要把验证命令解释成副作用授权。
- `work` 只修改 writable paths；`review` 和 `verify` 保持 changed_files 为空。
- 共享工作区中的并行兄弟改动不是本 task 产物。不得撤销或覆盖用户与其他 Owner 的合法改动。
- 需要越过 scope、non-goal 或 side-effect policy 时先停止，返回 `needs_repair` 与精确 scope_request；不得先做后报。

## Checkpoint 与证据

在关键决策后、长验证前、感知上下文压力或准备轮换时写 `OWNER_CHECKPOINT_V1`，再调用 driver `checkpoint`。只保存恢复事实，不复制源码、完整日志或聊天历史。

每条 evidence 必须对应 binding 中的 requirement description，并记录可复核的命令/方法、outcome、关键输出摘要、`artifact_ref` 与 `artifact_digest`；没有 artifact 时两者都写 null，不能省字段或只写“已验证”。

- `source-coverage-audit`：把每个 block 的 `mapped`（精确 plan item ids）或 `non_requirement`（非空理由）proposal 写入 binding `evidence_artifact_paths` 的精确路径，再运行 runtime `source-audit`。不得遗漏 block 或自己伪造最终 `SOURCE_COVERAGE_AUDIT_V1`。
- `diff-scope-audit`：直接运行 runtime `diff-audit`。runtime 会扫描 Goal 初始 `WORKTREE_BASELINE_V1`、当前真实工作区和 accepted work results；不得只复述 `changed_files` 或手写 `DIFF_SCOPE_AUDIT_V1`。
- 两个命令 stdout 返回的 `artifact_ref` 与 SHA-256 `artifact_digest` 必须原样放入对应 evidence；不得换路径、重算到别的文件或复用旧 revision artifact。

## 结果

1. 完成最小完整实现或只读检查，逐项核对 plan items、done_when 与 verification requirements。
2. 做 diff_self_check，只归因当前 attempt 的 changed files，并显式记录 `blocking_findings`。
3. 构造一个 `WORKER_RESULT_V4`；task、Owner、generation、executor、attempt、token 与 source revision 必须与 binding/state 一致。
4. 先原子写入 binding 的唯一 result_path，再返回相同 JSON。不得覆盖其他 attempt 文件。
5. 把可复用决策、不变量和风险放入 owner_updates，由 driver 合并 Capsule。

`completed` 必须为每个 verification id 提交 passed evidence，并完成 binding 声明的 coverage effect。两个固定 audit gate 只能由独立 audit binding 提交，且 artifact ref/digest 都非空；实施 worker 的 diff_self_check 不能代替它们。普通失败使用 failed/blocked；扩域或阻断审查使用 needs_repair。driver 的 `finish` 是身份、范围、revision、artifact 内容与证据的唯一机械裁决。
