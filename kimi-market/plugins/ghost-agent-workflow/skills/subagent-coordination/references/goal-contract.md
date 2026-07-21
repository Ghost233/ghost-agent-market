# Kimi Goal Contract

仅在 `subagent-coordination` 创建或校验 Kimi 本地 Goal 时读取本文件。`goal.json`、`goal-state.json`、`coverage.json`、`plan.json` 与 `state.json` 必须位于同一目录。

## GOAL_CONTRACT_V1

```json
{
  "contract": "GOAL_CONTRACT_V1",
  "goal_id": "runtime-owner-reuse--4cc8a51d904e",
  "execution_platform": "kimi",
  "workspace": {
    "root": "/absolute/workspace/root"
  },
  "lifecycle": {
    "controller": "local_fallback",
    "native_goal": null
  },
  "source": {
    "path": "/absolute/path/to/plan.md",
    "digest": "<plan.md sha256>",
    "revision": 1
  },
  "objective": "完整执行计划且计划项覆盖率达到 100%",
  "scope": ["Goal、DAG runtime、skills 和测试"],
  "constraints": ["保留用户已有改动", "所有结果必须可复核"],
  "non_goals": ["部署", "发布"],
  "execution": {
    "mode": "subagent",
    "max_concurrency": 3,
    "reuse_policy": "owner_affinity"
  },
  "verification_gates": [
    {
      "id": "runtime-unit",
      "stage": "unit",
      "description": "runtime 单元测试通过",
      "required": true
    },
    {
      "id": "workflow-smoke",
      "stage": "smoke",
      "description": "真实 Goal DAG smoke 通过",
      "required": true
    },
    {
      "id": "source-coverage-audit",
      "stage": "pre-execution",
      "description": "独立 verify task 逐项分类 SOURCE_BLOCKS_V1，证明 source 没有遗漏且 required effects 已映射到 DAG",
      "required": true
    },
    {
      "id": "diff-scope-audit",
      "stage": "final",
      "description": "由独立 review/verify task 核对实际工作区差异均位于 Goal 授权 scope，并保存可复核 artifact",
      "required": true
    }
  ],
  "side_effects": {
    "deploy": "forbidden",
    "external_write": "forbidden"
  },
  "completion": {
    "plan_coverage_100": true,
    "all_tasks_completed": true,
    "required_gates_passed": true,
    "blocking_findings_zero": true,
    "diff_in_scope": true
  }
}
```

Kimi 的原生 Goal 不提供 threadId/createdAt，native Goal identity 不可用，本插件不把原生 Goal 作为 identity 来源。默认 local instance digest 定义为 `SHA-256(UTF-8(source.path + "\n" + source.digest))`；`goal_id` 和目录名都必须包含其至少前 12 位小写 hex，推荐形态为 `<可读-slug>--<digest-prefix>`。slug 要归一化并裁剪，使完整 id 匹配 `[A-Za-z0-9][A-Za-z0-9._-]{0,95}`；没有可用 slug 时使用 `goal`。同一 source path+digest 的普通首次调用默认恢复已有 instance，不得覆盖目录；恢复前还要核对当前调用的 objective、execution mode、constraints 与 side-effect policy，任何差异都必须停止并要求显式新实例。若用户要并行或重复执行完全相同的 source，必须显式提供稳定 `instance_key`，改用 `SHA-256(UTF-8(source.path + "\n" + source.digest + "\n" + instance_key))`。短前缀碰撞到不同契约时逐步延长同一 digest 前缀。续跑只接受 runtime 返回的绝对 `goal.json` 路径，并精确校验 `goal_id`、source path 与持久化 digest。

`workspace.root` 必须是 Goal 开始时的绝对工作区根目录。首次 `goal-validate` 会在业务执行前捕获排除 `.ghost-agent-workflow/` 的 `WORKTREE_BASELINE_V1`，并从当前 source 生成逐个非空行的 `SOURCE_BLOCKS_V1`；两者的绝对 ref 与 SHA-256 digest 只由 runtime 写入 `goal-state.json`，planner 与 worker 只能消费绑定，不得重建。

## 平台差异

Kimi 使用 `local_fallback`：原生 `/goal` 外循环不向 skill 提供可用 instance identity，本控制器也不依赖原生 Goal 存在。`goal-state.native_sync.status` 因此为 `not_required`；`finalize` 验证通过后直接写入本地 `completed`。不要构造原生完成 token、调用 CreateGoal/UpdateGoal 或模拟外层状态。用户可另行用原生 `/goal` 包裹本 skill 获得自动外循环，这不改变本契约的本地生命周期语义。

显式首次调用与唯一续跑提示分别为：

```text
/skill:subagent-coordination 执行 <开发文档路径>
/skill:subagent-coordination 继续 `<goal.json绝对路径>`。
```

逐字返回 runtime `goal-validate`/`status` 输出的这条短续跑行；不要自行构造、相对化，也不要拼入开发文档、Goal Contract、DAG、gate、Owner Capsule 或 worker prompt。

## Gate 与约束合并

按顺序保留仓库强制 gate、加入计划验收、再加入 skill 调用参数明确追加的测试。相同语义使用稳定 id。固定 required gate `source-coverage-audit` 与 `diff-scope-audit` 都不得删除：前者只能由所有 work task 的独立 verify/audit 祖先覆盖，并用 runtime 生成的 `SOURCE_COVERAGE_AUDIT_V1` 证明每个 source block 已映射或有明确 non-requirement 理由；后者只能由独立 `review` 或 `verify` audit task 覆盖，并用 runtime 对 baseline 与当前真实工作区的扫描生成 `DIFF_SCOPE_AUDIT_V1`。两类 passed evidence 都必须携带 binding 指定的非空 `artifact_ref` 与 `artifact_digest`。其它 required gate 也必须由至少一个 task 的 `satisfies_goal_gates` 覆盖，并由对应 `WORKER_RESULT_V4.evidence` 提交可复核证据。

把 scope、constraints、non_goals 与 side_effects 原样下发到每次 `TASK_BINDING_V4`。任何 task 都不得越过它们；需要扩域时返回 `needs_repair`，由 planner 生成 delta。
