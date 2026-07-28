# 运行契约

`GOAL_CONTRACT_V1` 是本地执行批次，不等同于 Codex 原生 Goal。

## 生命周期

- 默认 `standalone_thread`：不调用原生 Goal 工具。
- 用户已启动或明确要求 Goal 时使用 `codex_native`：绑定 fresh `get_goal` 返回的 identity；本地 finalize 后才完成原生 Goal。
- task 失败、Review 等待和 Owner 用户决策都不映射为原生 blocked。

## 创建

Goal 的业务字段来自用户和 source 计划；workspace、source digest、revision、execution mode、默认 gate 和状态文件由 runtime 生成。只向 stdin 提交精简 `GOAL_INPUT_V1`，不写 canonical JSON：

```text
goal-dag.mjs goal-create <goal.json> <workspace_root>
goal-dag.mjs goal-validate <goal.json>
```

输入只需 `id/objective/source/scope`；`non_goals/constraints/max_concurrency/controller/native_thread_id/gates` 按需增加。固定机械 gate、side-effect 默认值、平台、digest、revision 和生命周期结构由脚本补齐。

`goal-validate` 初始化 Goal State、source blocks 和轻量 workspace fence。Fence 用内容/tree 与 task scope 判断冲突；HEAD 指针单独变化不作废 attempt。

## Gate

机械 gate 固定为 source coverage、diff scope 和 commit readiness。业务 Review 必须是显式 DAG 节点；verify 是独立验证节点。三者不能互相替代。

Evidence 默认不复用。只有 runtime 签发一个不可伪造的 `cache_key` 且 lookup 命中时，verify 才能直接使用；模型不得自己拼 tree/scope/command/config digest。

## 变化

- source 变化：drain active，`goal-refresh`，再用 delta 处理受影响 task。
- Review 升级：result 的 `review_upgrade` 触发 runtime 待升级状态；精简 delta 只提交 subject、Review task id 和 reason，runtime 自动重连边。
- Owner 变化：暂停当前 DAG，使用 Owner domain commands，用户批准并完成 transition 后恢复。
- 子图变化：Worker 调用 `subgraph-request`，Planner 生成 Expansion，runtime `expand-subgraph` 应用。

## 完成

`finalize` 只在 coverage、required task、Review/verify、blocking findings、scope 和 delivery gate 全部通过且没有 active reservation/Owner action 时成功。codex_native 随后才执行原生完成桥接。
