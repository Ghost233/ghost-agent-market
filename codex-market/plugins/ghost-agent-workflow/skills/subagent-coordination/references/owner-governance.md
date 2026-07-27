# 永久模块 Owner 治理

## 核心定义

- Owner 是以代码模块为边界、仓库级持久化、跨 Goal 永久存在的唯一责任主体，不是一次 task 的功能角色。
- 同一模块的开发、修复、代码搜索、资料调研、审查、验证、给其他模块建议，都只能由该模块 Owner 完成。`work`、`review`、`verify`、`research` 只是它的 task mode。
- 一个受管理路径必须且只能命中一个 active Owner。其他 Owner 不能读取、搜索、修改或语义审查其内部代码，只能消费该 Owner 发布的 `OWNER_INTERFACE_V1`、`OWNER_HANDOFF_V1` 或结论摘要。
- 物理 executor 可以更换；Owner ID、scope、永久 Capsule 和历史不随 Agent、Goal、Plan 或 task 改变。
- Planner 只能引用已批准 Owner，不能创建临时 repair/review Owner。
- `source-audit`、`diff-audit`、`commit-readiness` 是固定机械 runtime actor，放在 `DAG_PLAN_V5.runtime_actors[]`，不能混入 `owners[]`、读取模块内部代码或更新永久 Capsule。
- Goal、Plan、coverage、delta、lease、result、artifact 和 session Capsule 都是可删除 runtime，不进入 Git。只有 Owner Registry、永久 Capsule、有界接口和 append-only Owner history 保留。

## 持久与运行时位置

```text
<workspace>/.ghost-agent-workflow/
├── owners/
│   ├── registry.json
│   └── <owner_id>/
│       ├── capsule.json
│       ├── interfaces/**
│       └── history/**
└── runtime/
    ├── owners/<owner_id>/{lease.json,recoveries/**}
    └── goals/<goal_id>/**
```

永久 Capsule 只保存有界摘要：decisions、invariants、risks 各最多 100 项，最近 history 最多 50 项；完整成功事件写入 `owners/<owner_id>/history/**`。失败或 repair 结果不得污染永久 Capsule。

## Registry scope v2

Registry 使用 `OWNER_REGISTRY_V2` 与 matcher `owner-path-expression-v2`。每个 Owner 的范围是：

```text
matches(path) = any(scope_patterns) && !any(scope_excludes)
```

两组值都是 repository-relative glob，支持精确路径、`*`、`**`、字符类和 `{a,b}`。禁止绝对路径、`..` 和 `.ghost-agent-workflow/**`。include/exclude 是受脚本验证的布尔表达方式；不接受未经约束的原始正则，以避免回溯、平台差异和不可判定覆盖。

脚本必须同时验证未来 pattern 语言无冲突和当前 managed files 恰好单 Owner。为保证 fail closed，无法证明互斥时允许保守拒绝，不允许漏报重叠。

`split` 可拆宽 scope。例如把 `src/**` 拆出用户模块：

```json
[
  {"id":"user-module","scope_patterns":["src/user/**"],"scope_excludes":[]},
  {"id":"source-remainder","scope_patterns":["src/**"],"scope_excludes":["src/user/**"]}
]
```

被 remainder exclude 的每个新增区域必须由另一个 replacement 精确 claim，防止未来路径出现洞。

## 变更操作与用户批准

新增、分裂、扩张、收缩、转移和合并都使用同一 V2 流程：

1. 写 `OWNER_CHANGE_REQUEST_V2`，operation 为 `create | split | expand | shrink | transfer | merge`，包含 `source_owner_ids[]` 和 replacement `new_owners[]`。
2. 运行 `validate-change`。脚本验证 request schema、base Registry digest、ID/retired 规则、include/exclude 关系、未来冲突和当前文件唯一归属；失败申请不能提交审批。
3. 向用户展示 operation、来源与目标 Owner、完整 include/exclude、validation digest 与 next Registry digest，并停止。
4. 只有用户对这些精确内容明确同意后，才写 `OWNER_CHANGE_APPROVAL_V2`；保留简单的 `approved_by: user + digest` 证明，不引入签名 token。
5. 运行 `apply-change`；它重新计算全部 digest 和 next Registry，任一输入变化即拒绝。
6. 再运行 `validate` 与关键路径 `route` 抽检。

```text
node <plugin-root>/scripts/owner-registry.mjs init <workspace>
node <plugin-root>/scripts/owner-registry.mjs validate <registry.json>
node <plugin-root>/scripts/owner-registry.mjs route <registry.json> <repo-relative-path>
node <plugin-root>/scripts/owner-registry.mjs validate-change <registry.json> <request.json> <validation.json>
node <plugin-root>/scripts/owner-registry.mjs apply-change <registry.json> <request.json> <validation.json> <approval.json>
```

没有用户批准时，不得调用 `apply-change`，也不得手改 Registry、Plan scope 或使用临时 Owner 绕过。`expand`/`shrink` 保留同一 ID 并递增 generation；`transfer` 保留双方 ID；`split`/`merge` 永久退休来源 ID并继承来源 Capsule。

## 仓库级 Owner lease

模块 task reserve 前必须原子取得：

```text
.ghost-agent-workflow/runtime/owners/<owner_id>/lease.json
```

`OWNER_LEASE_V1` 记录 `goal_id`、`task_id`、`state_path`、reservation token、executor、状态和 heartbeat。它是跨 Goal 的硬互斥：已有不同 lease 时 reserve 返回 `owner_busy`，不能调度同一永久 Owner。固定 runtime actor 不占该 lease。

主线程处理疑似崩溃/死锁时先 inspect，按 `state_path + task_id + executor_id` 查询实际 task/Agent 状态；确认无法继续后才能带精确 token 和原因 recover。recover 会留下不可变恢复事件，token 不匹配时拒绝。

```text
node <plugin-root>/scripts/goal-dag.mjs owner-lease-inspect <workspace> <owner_id>
node <plugin-root>/scripts/goal-dag.mjs owner-lease-heartbeat <workspace> <owner_id> <reservation_token>
node <plugin-root>/scripts/goal-dag.mjs owner-lease-recover <workspace> <owner_id> <reservation_token> <reason>
```

## Goal 路由、自动扩域与访问隔离

Goal 启动前运行 Registry `validate`，对受影响路径逐一 `route`。Planner 把 Registry metadata、include 和 exclude 原样复制到 Plan；未覆盖或多重命中时生成变更申请并等待用户。

发现初始 write scope 漏项时，不创建复杂 impact manifest：

- 路径仍属于同一 Owner：用 `expand-task-scope` 加入当前 task 的精确路径，脚本复核 Registry 后重建 binding。
- 路径属于其他 Owner：停止当前 Owner 对该路径的操作，路由给对应 Owner，并通过 handoff 交接。
- 未归属或冲突：停止并请求用户进行 Owner 治理。

```text
node <plugin-root>/scripts/goal-dag.mjs expand-task-scope <plan> <state> <task_id> <token> <exact_repo_path>...
```

`TASK_BINDING_V5` 必须包含 Registry digest、永久 Capsule、scope include/exclude、read/search include/exclude、task writable paths。跨 Owner 的 `dependency_inputs` 只能包含发布产物；同 Owner 才可收到原始 result ref；机械 actor 只收到 runtime evidence 摘要。

read/search 的路径字段本身不是操作系统隔离。严格模式必须通过支持 allowlist 的 Owner 工具网关或 OS sandbox 执行，并同时使用 include/exclude；平台无法提供硬隔离时必须 fail closed，不能把提示词自律描述为安全边界。普通 shell/file 工具不得绕过该网关。

## Git 交付

每个有 changed files 的 Owner 在当前 `workspace_change_seq` 发布 `COMMIT_ATTESTATION_V1`，内容精确列出本模块文件与审查结论。`diff-audit` 机械核对 accepted result 与工作树，最后 `commit-readiness` 运行 `git diff --check`、敏感文件/runtime 路径/唯一 Owner 路由检查，生成 `DELIVERY_MANIFEST_V1`。

存在 Registry 时，Git 控制器只能消费 current delivery manifest 和 Owner attestations，按清单机械分组、暂存和提交；通用分析代理与主线程不得读取模块 diff 或替模块 Owner 复审。没有 Registry 时才允许旧的通用 Git 分析流程。
