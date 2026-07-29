# Planner 最小契约

Planner 是唯一允许提交结构化语义 DAG 的模型角色，因为 task 目标、依赖和范围无法由脚本推导。它不写文件。先调用 `planner-open <goal-dir> [cursor]`；每页最多 50 项，按 `next_cursor` 读完。初始页直接提供 `source_blocks` 的 id、行号和文本，coverage 必须引用这些 id。输出直接送入 `planner-submit` stdin，由脚本校验并生成 canonical Plan/Delta/Expansion。

## 初始最小 Plan

只提供：

- `items`：需求 id、说明、source refs、implementation/verification 覆盖；
- `tasks`：id、中文 title、Owner、work、after、write、done、verify、items；
- 默认值确实不适用时才加 risk/review/priority/cost。

初始 tasks 只能是顶层节点，不能带 parent/child。每个节点至少提供上下文隔离、真实并行、职责专业化或独立验证中的一种价值；否则合并。不要为达到配置并行数拆节点。

Review 不是默认隐藏阶段。无需 Review 时使用脚本默认 `none`；需要 Review 时显式加入 `role: review` 节点，并让相关下游依赖该节点。

脚本自动加入 source/diff/commit 三个 runtime gate、Owner 定义、actor、identity、digest、revision 和路径。初次调用 `planner-submit <goal-dir> initial`；Reviewer 要求修改时最多调用一次 `planner-submit <goal-dir> revise`。

## 局部变化

- Review 升级只给 subject、Review task 和固定 reason；通过 `planner-submit <goal-dir> delta`，runtime 重连下游。
- 子图只给 children、内部依赖、entry、exit；通过 `planner-submit <goal-dir> subgraph <run-id>`，runtime 保持父节点外部边。
- Quick 升级 source 中的已验收输入不是 DAG 节点；初始 Plan 只覆盖剩余工作。
- Owner delta 只描述 `owner.rebind` 中受影响的 pending task/新 Owner；不要传 validation、approval、Registry digest 或路径。同样走 `planner-submit ... delta`，runtime 读取当前批准状态。
- source delta 只描述受影响 task 的 carry forward/invalidate；被审结果 invalidate 时对应 Review 一起 invalidate。

禁止传 Plan/State 路径、parent task、attempt 或 token；禁止复制 canonical schema、补默认空字段、手写 JSON 文件或绕过 `planner-submit`。
