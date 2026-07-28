# 运行模式

两种模式共用 Owner、run-id、Binding、fence、scope、机械验收和最终 Result 内核。模式不是仓库配置：每次调用 `workflow start <workspace> <quick|dag>` 选择。用户没有明确选择时必须先询问并等待，不能默认 Quick 或 DAG。

Claude Code 固定使用 `standalone_thread`，不包含 Codex 原生 Goal 桥接。

## Quick

Quick 是显式选择的串行模式，不创建 Goal、Plan、Planner、Supervisor 或 Dashboard。

```text
workflow start ... quick
→ workflow thread ... main ...
→ workflow step
→ workflow dispatch ... <owner>
→ workflow attach ... <thread> <host>
→ Owner Worker
→ workflow step 机械验收
→ 可选下一 Owner
→ workflow review
→ 独立 Review Worker
→ workflow step 生成 result.json
```

跨 Owner 只读取脚本生成的当前 handoff，不读取前一线程聊天。Review 必须使用干净线程。Quick 只保留 `workflow.json`、`workflow-state.json`、Owner 当前上下文和最终 `result.json`；运行中的 baseline、Binding、candidate 与 handoff 验收或完成后删除。

Worker 使用 `worker request-dag` 时，脚本接受安全边界，把当前成果作为“已验收输入”，并只为剩余工作创建 DAG。该转换不可逆。

## DAG

DAG 用于用户明确要求的并行、DAG 或网页进度。初始 Planner 只生成顶层最小图；初始 Plan 中出现 child 会被 runtime 拒绝。父节点无法直接完成时再由 Composite Planner 展开内部子图。

Plan draft 必须经过独立 Planner Reviewer 才能激活。Implementation Review 是显式 DAG 节点；普通完成不产生隐形 Review。风险上升时 runtime 进入明确的 Review upgrade action，只影响相关下游。

Supervisor 最多调度八个 ready 节点；八个是上限，不是目标。Plan 激活后，`workflow step` 先要求 Main 启动并确认 Dashboard，之后才进入执行调度。

## 持久化

- Quick：当前 workflow 状态、Owner 当前上下文、最终结果。
- DAG：当前 Plan/State、`progress.json`、唯一历史 `events.jsonl`、最终结果。

事务恢复文件成功后立即清理。禁止 attempt、Review、evidence、recovery 和聊天 history。
