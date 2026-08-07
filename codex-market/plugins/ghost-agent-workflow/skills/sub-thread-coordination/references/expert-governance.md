# Expert 治理

Expert 是长期责任域，不是人员。Planner 只能引用 Registry 中已批准 Expert；跨 Expert 只消费公开 handoff。

启动时只运行：

```text
expert-registry.mjs init <workspace>
```

如果本次只管理一组明确文件，必须在首次 Expert 提案前调用：

```text
expert-registry.mjs set-managed-roots <workspace> <精确仓库相对路径>...
```

该命令拒绝通配符、已有 Expert 和尚未清除的提案；不得手写 Registry。未调用时保持默认 `**`。

路径路由交给 `route`。未归属、冲突、split/merge/transfer 才进入 Expert 变化。

## 当前变更

模型只选择 operation、reason、Expert 描述和 scope，脚本管理所有文件、digest 与状态：

```text
expert-registry.mjs propose <workspace> <operation> <reason> ...
expert-registry.mjs current <workspace>
expert-registry.mjs approve-current <workspace>
expert-registry.mjs apply-current <workspace>
expert-registry.mjs clear-current <workspace>
```

`propose` 后向用户展示脚本摘要。`workflow step` 会自动暂停 DAG 的新 reserve；Quick 会等当前 run 到达安全边界，然后统一返回 `owner_action_required`。没有用户明确批准不得调用 `approve-current`。`apply-current` 在仍有 reserved/running run 时拒绝写 Registry。应用后再次调用 `workflow step`：Quick 自动采用新 Registry，DAG 自动路由 Planner 迁移受影响 pending Expert/Review task，并由脚本清除 current request。仓库存在其他 active workflow 时脚本拒绝变化。

Capsule 只保存当前责任域上下文：decisions、invariants、risks 和最近进度；不保存 task/result/evidence history。Quick 的当前 Expert 线程映射由脚本保存，DAG 线程丢失由 Supervisor 报告；用户确认关闭后才允许恢复或重建。
