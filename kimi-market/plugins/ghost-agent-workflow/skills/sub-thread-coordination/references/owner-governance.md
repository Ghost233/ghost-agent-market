# Owner 治理

Owner 是仓库级模块责任主体，不是临时 task 角色。一个受管理路径必须且只能属于一个 active Owner；Planner 只能引用 Registry 中已经批准的 Owner。

## 边界

- Owner ID、scope 和永久 Capsule 跨 Goal 保留；物理子线程可以轮换。
- 跨 Owner 只消费公开 interface/handoff，不读取对方聊天。
- source/diff/commit audit 是脚本任务，不是 Owner 或模型角色。
- Registry、Capsule、lease 和 history 只能由脚本更新。

## 路由

启动前运行：

```text
owner-registry.mjs validate <registry.json>
owner-registry.mjs route <registry.json> <repo_path>
```

当前 task 漏了一个仍属于同一 Owner 的精确路径时，用 `expand-task-scope`；路径属于其他 Owner 时交给对应 Owner；未归属或冲突时进入 Owner 变化。

## Owner 变化

为保持状态简单，当前 Goal 在整个变化期间暂停全部新 reserve。模型只给 operation、reason、Owner 描述和 scope 参数，request/validation/approval/digest/timestamp 全部由脚本生成：

```text
owner-registry.mjs request-change <registry> <request> <operation> <reason> \
  [--source <owner>] \
  --owner <id> <responsibility> <worker_context> \
  --scope <id> <pattern> [--scope <id> <pattern>] [--exclude <id> <pattern>]

goal-dag.mjs owner-change-pause <plan> <state> <request>
owner-registry.mjs validate-change <registry> <request> <validation>
```

暂停命令只在 State 保存 request ref 和 digest；具体变更内容只从脚本生成的 request 读取。

向用户展示 operation、来源/目标 Owner、scope 和 validation digest。用户没有明确同意前停止；不要启动空模型回合累计 blocked。

用户批准后只调用：

```text
owner-registry.mjs approve-change <request> <validation> <approval>
owner-registry.mjs apply-change <registry> <request> <validation> <approval>
```

然后 Planner 生成一个局部 Owner transition delta，runtime `apply-delta` 迁移 pending task。全部成功后恢复 reserve，并提示用户“Owner 变化已应用，可以继续 Goal”。任何步骤失败都保持暂停，重复执行同一 digest 绑定步骤即可；不得手改 Registry 或临时发明 Owner。

## Lease 与丢失线程

模块 reserve 前取得仓库级 Owner lease，避免两个 Goal 同时修改同一 Owner：

```text
goal-dag.mjs owner-lease-inspect <workspace> <owner_id>
goal-dag.mjs owner-lease-heartbeat <workspace> <owner_id> <token>
goal-dag.mjs owner-lease-recover <workspace> <owner_id> <token> <reason>
```

Main 连续三次等待无变化后只报告疑似 stalled；用户确认线程确实无法继续后才 recover/reclaim。旧线程标为 lost 或 archived 后，创建新 generation 并从 Capsule 恢复。

## Git 交付

每个有修改的 Owner 发布自己的 attestation。最终 diff/commit readiness 由脚本核对 current results、scope 和 Registry 路由；主线程不替 Owner 重审模块内部实现。
