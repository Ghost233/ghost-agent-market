# Owner 治理

Owner 是长期责任域，不是人员。Planner 只能引用 Registry 中已批准 Owner；跨 Owner 只消费公开 handoff。

启动时只运行：

```text
owner-registry.mjs init <workspace>
```

路径路由交给 `route`。未归属、冲突、split/merge/transfer 才进入 Owner 变化。

## 当前变更

模型只选择 operation、reason、Owner 描述和 scope，脚本管理所有文件、digest 与状态：

```text
owner-registry.mjs propose <workspace> <operation> <reason> ...
owner-registry.mjs current <workspace>
owner-registry.mjs approve-current <workspace>
owner-registry.mjs apply-current <workspace>
owner-registry.mjs clear-current <workspace>
```

`propose` 后向用户展示脚本摘要。`workflow step` 会自动暂停 DAG 的新 reserve；Quick 会等当前 run 到达安全边界，然后统一返回 `owner_action_required`。没有用户明确批准不得调用 `approve-current`。`apply-current` 在仍有 reserved/running run 时拒绝写 Registry。应用后再次调用 `workflow step`：Quick 自动采用新 Registry，DAG 自动路由 Planner 迁移受影响 pending Owner/Review task，并由脚本清除 current request。仓库存在其他 active workflow 时脚本拒绝变化。

Capsule 只保存当前责任域上下文：decisions、invariants、risks 和最近进度；不保存 task/result/evidence history。Quick 的当前 Owner 线程映射由脚本保存，DAG 线程丢失由 Supervisor 报告；用户确认关闭后才允许恢复或重建。
