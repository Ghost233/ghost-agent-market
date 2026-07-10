# Worker 模型配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复版本化并发计划的运行时闭环，让 Codex 使用实现子代理、Claude Code 使用 Agent/team assignment，并统一 profile evidence 与 worker 结果 schema。

**Architecture:** planner 只输出 plan-authored `worker_profile`；coordinator 把 profile 转换为平台调度参数并创建实现 worker；Codex worker 使用单 module active goal，Claude worker 使用 assignment evidence。两端统一使用 mapping-shaped `diff_self_check`，不创建额外 reviewer。

**Tech Stack:** Markdown agent skills、YAML UI metadata、JSON Codex plugin manifest、Skill Creator validators、Plugin Creator cachebuster helper。

## Global Constraints

- `$thread-coordination` 只能消费 `$parallel-task-planner` 生成的 `plan_format_version: 1`、`safety.status: parallel_safe` 计划。
- Codex coordinator 默认 `sol/xhigh`，实现 worker 必须是 `terra/xhigh` 子代理；不得使用用户可见 thread/task 作为 worker。
- Codex alias `terra` 分派时映射为 `gpt-5.6-terra`，`reasoning_effort` 映射为 `thinking`。
- Claude Code coordinator 默认 `opus/max`，实现 worker 使用 `sonnet/max` Agent/team teammate；Claude worker 不依赖 `/goal`。
- 计划中只保留 `worker_profile`；runtime 使用独立 `worker_profile_evidence`，不再包含 reviewer profile/preflight。
- `diff_self_check` 在所有输入输出中统一为 `{status, evidence}` mapping。
- coordinator 在调用前生成 dispatch/assignment id，并用一次原子调用同时传入完整 module 包与 profile 参数；调用后返回的 subagent/task id 不得成为首包前置字段。
- 有依赖的 DAG 只要至少一个 batch 可并发就允许 `parallel_safe`；只有完全串行的 DAG 才是 `sequential_only`。
- 不允许静默模型或 effort 降级。
- Claude Code 与 Codex 同步通用 schema，只保留 goal/assignment、调度工具和平台 profile 差异。
- Codex 插件版本更新为 `0.3.1+codex.<UTC cachebuster>`。

---

### Task 1: 修订设计与失败基线

**Files:**
- Modify: `docs/superpowers/specs/2026-07-10-worker-model-profile-design.md`
- Modify: `docs/superpowers/plans/2026-07-10-worker-model-profile-implementation.md`

**Interfaces:**
- Consumes: 运行时复审 findings 和用户确认的 Codex 子代理方向。
- Produces: 无 thread worker、无 reviewer dead branch 的最终契约。

- [x] **Step 1: 记录 RED 证据**

确认旧实现存在：Codex alias 与 canonical model 未映射、Claude worker 依赖不存在的 `/goal`、`diff_self_check` shape 不一致、reviewer 分支不可达、非空依赖 DAG 被提前标为 `sequential_only`。

- [x] **Step 2: 更新设计**

写明 Codex subagent、Claude assignment、profile dispatch evidence、统一 diff schema 和 DAG 判定。

---

### Task 2: 修复 Codex 三个 skill

**Files:**
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/parallel-task-planner/SKILL.md`
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/parallel-task-planner/agents/openai.yaml`
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/thread-coordination/SKILL.md`
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/thread-coordination/agents/openai.yaml`
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/thread-goal-worker/SKILL.md`
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/thread-goal-worker/agents/openai.yaml`

**Interfaces:**
- Consumes: versioned Codex plan and subagent profile dispatch API.
- Produces: implementation-subagent dispatch packets and `WORKER_RESULT`.

- [x] **Step 1: 更新 planner schema**

移除 reviewer fields；保留完整 module `worker_profile`；允许拓扑 batch；只有每个 batch 宽度都为 1 时写 `sequential_only`。

- [x] **Step 2: 更新 coordinator**

只使用实现子代理；禁止 thread/task 工具；把 `terra/xhigh` 映射为 `gpt-5.6-terra` + `thinking: xhigh`；以成功调度结果形成 `worker_profile_evidence`。

- [x] **Step 3: 更新 worker**

保留 Codex active goal；删除 reviewer 分支；统一 `diff_self_check: {status, evidence}` 和 profile evidence shape。

- [x] **Step 4: 更新 metadata 并验证**

重新生成或同步三份 `agents/openai.yaml`，分别运行 `quick_validate.py`。

---

### Task 3: 修复 Claude Code 三个 skill

**Files:**
- Modify: `claude-code-market/skills/parallel-task-planner/SKILL.md`
- Modify: `claude-code-market/skills/parallel-task-planner/agents/openai.yaml`
- Modify: `claude-code-market/skills/thread-coordination/SKILL.md`
- Modify: `claude-code-market/skills/thread-coordination/agents/openai.yaml`
- Modify: `claude-code-market/skills/thread-goal-worker/SKILL.md`
- Modify: `claude-code-market/skills/thread-goal-worker/agents/openai.yaml`

**Interfaces:**
- Consumes: versioned Claude plan and Agent/team assignment.
- Produces: assignment-bound worker packets and the common `WORKER_RESULT` core schema。

- [x] **Step 1: 同步 planner 与 DAG 规则**

使用 `sonnet/max` worker profile，移除 reviewer fields，并与 Codex 共用计划结构。

- [x] **Step 2: 更新 coordinator profile dispatch**

使用 Agent/team teammate，记录 `sonnet/max` dispatch evidence；不要求不存在的历史 teammate profile readback。

- [x] **Step 3: 用 assignment evidence 替代 `/goal`**

worker 在修改前绑定 plan、module id 和 Agent/team task id；不读取或设置 Codex goal。

- [x] **Step 4: 更新 metadata 并验证**

重新生成或同步三份 `agents/openai.yaml`，分别运行 `quick_validate.py`。

---

### Task 4: 发布与全量验证

**Files:**
- Modify: `codex-market/plugins/ghost-agent-workflow/.codex-plugin/plugin.json`
- Verify: 六份 `SKILL.md` 与六份 metadata。

**Interfaces:**
- Consumes: Tasks 2-3 的最终 schema。
- Produces: 可安装的 `0.3.1` 构建和无阻塞审查结论。

- [x] **Step 1: 更新插件版本与说明**

把基础版本更新为 `0.3.1`，再运行 cachebuster helper，保持单个 `+codex.<UTC 时间戳>`。

- [x] **Step 2: 运行六个 skill validator 和 plugin validator**

Expected: 六次 `Skill is valid!`，plugin validation passed。

- [x] **Step 3: 运行关键压力场景**

覆盖 Codex alias 映射、禁止 thread worker、Claude assignment happy path、统一 diff shape、无 reviewer 残留、并发 DAG、纯串行 DAG、非法入口阻塞。

- [x] **Step 4: 最终只读审查和工作树检查**

修复全部 Critical/Important findings，运行 `git diff --check`，确认工作树只包含本计划变更后提交。
