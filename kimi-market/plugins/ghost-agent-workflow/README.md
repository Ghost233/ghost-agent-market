# Ghost Agent Workflow Kimi 插件

包含四个 skill：`subagent-coordination`、`parallel-task-planner`、`subagent-goal-worker` 和 `git-commit`。前三者组成 subagent-only Goal DAG；最后一个用于安全提交当前改动。

Kimi 推荐入口只有这一行：

```text
/skill:subagent-coordination 执行 `./plan.md`,以子代理 DAG 完整执行,直到计划项覆盖率 100% 且所有验收通过。
```

Kimi Code 的原生 Goal 不向插件暴露稳定的 native instance identity（无 threadId/createdAt），因此本插件使用 `local_fallback` 生命周期。显式 `/skill:subagent-coordination` 是内循环入口和唯一公开控制器；目标未完成时，逐字使用它返回的 runtime 单行续跑提示（`/skill:subagent-coordination 继续 <goal.json绝对路径>`）继续执行。也可以自行用原生 `/goal` 包裹获得自动外循环；skill 不调用 CreateGoal/UpdateGoal，不依赖原生 Goal 存在。控制器内部调用 planner 生成 `GOAL_CONTRACT_V1`、`PLAN_COVERAGE_V1` 和 v4 `DAG_PLAN_V4`，再把 fenced attempt 分发给 worker。执行方式固定为 `subagent`。instance identity 取 source 绝对路径与 source digest 的 SHA-256 前 12 位小写 hex 后缀，恢复时精确校验完整 instance 与 objective digest。

首次 `goal-validate` 会冻结 `WORKTREE_BASELINE_V1` 并生成 `SOURCE_BLOCKS_V1`。planner 为每个 plan item 写 source refs 和 required effects，task 用 `coverage_effect` 精确覆盖；独立 source audit 必须先于所有 work，最终 diff audit 由 runtime 扫描 baseline、真实工作区与 accepted results，两个 artifact 都用 SHA-256 绑定。

每轮恢复先 `reconcile` 再 reserve；`status`/`reconcile` 为每个 active reservation 返回完整 canonical binding 与 action/phase，使 spawn/bind/send 崩溃后无需聊天记忆或自行重算。source drift 时停止 reserve、drain active reservation，再事务刷新 source revision、blocks、coverage/state 与 Capsule；invalidated task 的当前证据不可沿用。DAG 耗尽但 required effect coverage 不足 100% 时返回 `needs_delta`。

只有 coverage 达到 100%、当前 revision 的 task 与 required gate 证据全部有效，且其它 completion invariant 均成立时，`finalize` 才返回 `completed`，skill 随后向用户报告完成。

Owner 是稳定逻辑责任域，Agent 只是软亲和执行载体。runtime 为每次新建下发 canonical `executor_spawn_name`，协调器不得自行重算；执行器通过 `Agent(run_in_background: true)` 启动、`Agent(resume:)` 复用；正确性只依赖 `.ghost-agent-workflow/` 中的持久状态。Kimi 子代理固定平台默认 profile（runtime_profile 为 null），独立 audit 使用不同 Owner，不同 Goal 不复用 Agent。

`.ghost-agent-workflow/` 是本地 runtime state，不应提交到版本库。

## 安装

GitHub 一键安装（CI 从 `main` 构建的滚动 release zip）：

```text
/plugins install https://github.com/Ghost233/ghost-agent-market/releases/download/kimi-latest/ghost-agent-workflow-kimi.zip
```

或克隆本仓库后本地安装：

```text
/plugins install <仓库路径>/kimi-market/plugins/ghost-agent-workflow
```

插件安装在用户级，对全部项目生效；安装或更新后需 `/reload` 或开启新会话。本地安装会复制到 managed 目录，修改源目录后需重新安装。仓库整库 URL（含 `/tree/...`）不支持安装，monorepo 子目录的 manifest 不会被发现；zip 安装不参与自动更新检查，重新执行同一命令即可更新。
