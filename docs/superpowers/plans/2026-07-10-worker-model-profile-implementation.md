# Worker 模型配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让三个线程协作 skill 只能通过版本化并发计划执行，并按平台强制使用可审计的主线程、worker 与 reviewer 模型 profile。

**Architecture:** `$parallel-task-planner` 是唯一计划生产者，输出 `plan_format_version: 1`、平台、`dispatch_mode: parallel-plan`、`review_mode: diff_self_check` 和完整 module profiles；`$thread-coordination` 只接受绝对 `plan_path` 并验证计划、运行时 profile 与安全证据；`$thread-goal-worker` 只接受 coordinator 原样转发两个结构化 marker 的单 module 包。plan-authored `worker_profile` 与 runtime `worker_profile_evidence` 使用独立字段，Claude Code 与 Codex 保留各自执行面差异，但共享相同 schema 和拒绝旁路规则。

**Tech Stack:** Markdown agent skills、YAML UI metadata、JSON Codex plugin manifest、Skill Creator validators、Plugin Creator cachebuster helper。

## Global Constraints

- Claude Code 与 Codex 两端的三个 `SKILL.md` 必须同步更新；只允许保留平台工具和默认 profile 差异。
- `$thread-coordination` 只能消费 `$parallel-task-planner` 生成的 `plan_format_version: 1`、`safety.status: parallel_safe` 计划，不允许自然语言、手工 worker 包或普通 owner-domain 旁路。
- Codex 默认：主协调线程 `sol/xhigh`，worker 与 reviewer subagent `terra/xhigh`。
- Claude Code 默认：主协调线程 `opus/max`，worker 与 reviewer subagent `sonnet/max`。
- 主协调 profile 是固定门禁，不支持用户或计划覆盖；不匹配时必须用固定 profile 重启或重建协调 task。
- 不允许静默模型降级；运行时无法应用或证明 profile 时必须返回 `blocked`、`needs_user_review` 或 `needs_main_review`。
- 计划中的 `worker_profile` 只含 `model` 与 `reasoning_effort`；运行时证据只写入 `worker_profile_evidence: {requested, effective, status, evidence}`。Plan Binding 不比较 runtime evidence。
- `reviewer_profile_preflight.requested/effective` 必须是 mapping；只有 `dispatch_mode: parallel-plan` 和 `review_mode: diff_self_check` 同时匹配时 reviewer profile/preflight 才能为 `not_required`。
- Codex 插件基础版本升为 `0.3.0`，再由 Plugin Creator 写入单个 `+codex.<UTC cachebuster>` 后缀。
- 每个 skill 必须独立完成 RED、GREEN、验证和提交，再进入下一个 skill。
- Metadata generator 固定使用 `/Users/ghost233/.codex/skills/.system/skill-creator/scripts/generate_openai_yaml.py`。
- Skill validator 固定使用 `PYTHONPATH=/private/tmp/skill-creator-py python3 /Users/ghost233/.codex/skills/.system/skill-creator/scripts/quick_validate.py <skill-dir>`；不安装依赖。

---

### Task 1: 建立旧 skill 的失败基线

**Files:**
- Read: `codex-market/plugins/ghost-agent-workflow/skills/parallel-task-planner/SKILL.md`
- Read: `codex-market/plugins/ghost-agent-workflow/skills/thread-coordination/SKILL.md`
- Read: `codex-market/plugins/ghost-agent-workflow/skills/thread-goal-worker/SKILL.md`

**Interfaces:**
- Consumes: 当前 `0.2.0` skill 行为。
- Produces: 三个可复现的 RED 结论，分别覆盖 profile 缺失、planner 旁路和 worker 来源链缺失。

- [ ] **Step 1: 运行 planner 基线场景**

让 fresh subagent 使用当前 `$parallel-task-planner`，为 Claude Code 并发任务生成计划，检查是否包含 `planner`、`plan_format_version`、`execution_platform`、`dispatch_mode`、`review_mode`、完整 `worker_profile` 与 `reviewer_subagent_profile`。

Expected: FAIL，当前计划契约缺少这些字段。

- [ ] **Step 2: 运行 coordinator 基线场景**

让 fresh subagent 使用当前 `$thread-coordination`，直接接收自然语言 owner-domain 任务并判断是否会绕过 planner。

Expected: FAIL，当前 skill 仍允许普通 owner-domain 分派。

- [ ] **Step 3: 运行 worker 基线场景**

让 fresh subagent 使用当前 `$thread-goal-worker`，接收没有 `planner`、`plan_format_version` 和 profiles 的普通分派包。

Expected: FAIL，当前 skill 不会因为缺少计划来源链与 profile 而立即阻塞。

---

### Task 2: 强化 parallel-task-planner

**Files:**
- Modify: `claude-code-market/skills/parallel-task-planner/SKILL.md`
- Modify: `claude-code-market/skills/parallel-task-planner/agents/openai.yaml`
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/parallel-task-planner/SKILL.md`
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/parallel-task-planner/agents/openai.yaml`

**Interfaces:**
- Consumes: 自然语言或既有计划、`execution_platform`、可选 module profile 覆盖。
- Produces: 顶层 `planner: parallel-task-planner`、`plan_format_version: 1`、`execution_platform`、`dispatch_mode: parallel-plan`、`review_mode: diff_self_check`，以及每个 module 完整的 `worker_profile` 和 `reviewer_subagent_profile`。

- [ ] **Step 1: 用 RED 结论锁定输出结构**

计划必须使用以下平台默认值并在 module 中写出解析后的完整值：

```yaml
execution_platform: claude_code
dispatch_mode: parallel-plan
review_mode: diff_self_check
worker_defaults:
  model: sonnet
  reasoning_effort: max
modules:
  - id: M1
    worker_profile:
      model: sonnet
      reasoning_effort: max
    reviewer_subagent_profile:
      model: sonnet
      reasoning_effort: max
```

- [ ] **Step 2: 更新两端 SKILL.md**

加入版本化计划来源、两个结构化 marker、平台默认 profile、module 覆盖解析、缺失 profile 时 `needs_user_review`、禁止静默降级，以及只对 `parallel_safe` 计划自动交接的规则。自动交接必须把 `dispatch_mode` 与 `review_mode` 原样传给 coordinator。

- [ ] **Step 3: 更新 UI metadata**

用 Skill Creator 的 `generate_openai_yaml.py` 重新生成两端 `agents/openai.yaml`，默认提示明确要求生成版本化计划和完整 profiles。

- [ ] **Step 4: 验证 planner**

Run: `quick_validate.py` 分别验证 Claude Code 与 Codex planner 目录。

Expected: 两次均输出 `Skill is valid!`。

- [ ] **Step 5: 运行 GREEN 场景并提交**

让 fresh subagent 使用更新后的 planner 处理 Task 1 场景；必须生成完整版本字段和平台 profile。随后只暂存四个 planner 文件并提交 `feat(planner): add worker model profiles`。

---

### Task 3: 将 thread-coordination 收紧为计划唯一入口

**Files:**
- Modify: `claude-code-market/skills/thread-coordination/SKILL.md`
- Modify: `claude-code-market/skills/thread-coordination/agents/openai.yaml`
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/thread-coordination/SKILL.md`
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/thread-coordination/agents/openai.yaml`

**Interfaces:**
- Consumes: planner 生成的绝对 `plan_path`、`plan_format_version: 1`、`execution_platform`、`dispatch_mode: parallel-plan`、`review_mode: diff_self_check` 和 `safety.status: parallel_safe`。
- Produces: plan-authored `worker_profile`、逐 module `worker_profile_evidence`、mapping-shaped `reviewer_profile_preflight`、`WORKER_RESULT` 汇总和 `PARALLEL_PLAN_RESULT`；非法入口只返回 `blocked`。

- [ ] **Step 1: 删除普通 owner-domain 执行入口**

移除允许主线程从自然语言直接建立 `/goal`、拆 owner domain 和分派 worker 的流程；保留只读协调、batch、一次补修和父目标总验收。

- [ ] **Step 2: 加入不可跳过的计划门禁**

只有计划同时包含以下内容才允许分派：`planner: parallel-task-planner`、`plan_format_version: 1`、匹配当前平台的 `execution_platform`、`dispatch_mode: parallel-plan`、`review_mode: diff_self_check`、完整 modules、`dispatch.batches`、`safety.status: parallel_safe`、无当前工作区冲突。

- [ ] **Step 3: 加入平台 profile 预检与证据**

Codex 固定主协调 profile 为 `sol/xhigh`，Claude Code 固定为 `opus/max`，不支持 override；不匹配时重启/重建 task。复用或创建 worker 前验证 plan-authored `worker_profile`，无法应用、读取或匹配时停止；运行时结果独立使用 `worker_profile_evidence: {requested, effective, status, evidence}`，不覆盖计划值。`reviewer_profile_preflight` 的 requested/effective 使用 mapping，并按结构化 marker 约束 `not_required`。

- [ ] **Step 4: 更新 metadata、验证和提交**

重新生成两端 `agents/openai.yaml`，分别运行 `quick_validate.py`，再用 Task 1 的直接自然语言场景确认返回 `blocked`。只暂存四个 coordinator 文件并提交 `refactor(coordination): require versioned plans`。

---

### Task 4: 强化 thread-goal-worker 来源链与 profile 验证

**Files:**
- Modify: `claude-code-market/skills/thread-goal-worker/SKILL.md`
- Modify: `claude-code-market/skills/thread-goal-worker/agents/openai.yaml`
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/thread-goal-worker/SKILL.md`
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/thread-goal-worker/agents/openai.yaml`

**Interfaces:**
- Consumes: coordinator 派发的单 module 包，包含 planner 来源链、`dispatch_mode`、`review_mode`、两个 plan profiles、独立 runtime evidence、scope、done_when 和 verification。
- Produces: `WORKER_RESULT`，包含 plan-authored `worker_profile`、独立 `worker_profile_evidence`、reviewer evidence 与 mapping-shaped `reviewer_profile_preflight`；普通分派返回 `blocked`。

- [ ] **Step 1: 收紧输入契约**

把 `planner: parallel-task-planner`、`plan_format_version: 1`、`execution_platform`、`dispatch_mode: parallel-plan`、`review_mode: diff_self_check`、`module_id`、plan-authored `worker_profile`、`worker_profile_evidence`、`reviewer_subagent_profile` 和 `reviewer_profile_preflight` 设为执行前必需字段。缺少任一字段或 marker 不匹配时不设置 goal、不修改文件。Plan Binding 比较计划值但不比较 runtime evidence。

- [ ] **Step 2: 加入 profile 证据与 reviewer 规则**

worker 不允许自行切换 profile；只有 `worker_profile_evidence` 匹配 plan-authored `worker_profile` 才执行。普通修改型任务的 reviewer 必须匹配平台固定 profile；只有两个结构化 marker 都匹配时 diff 自检例外才写 `not_required`，且 reviewer/preflight 的 requested 保持固定 profile、effective 两字段均写 `not_required`，不能伪造 reviewer evidence。

- [ ] **Step 3: 更新结果契约**

在 completed、blocked、failed、needs_main_review 的 `WORKER_RESULT` 中统一返回 `dispatch_mode`、`review_mode`、plan-authored `worker_profile`、`worker_profile_evidence` 和 `reviewer_profile_preflight`。coordinator 对所有状态先校验 shape 和分派 evidence；blocked 一律直接汇总 worker 原因或 schema/evidence mismatch，不进入一次补修或完成态 profile 门禁。只有必需 runtime profile 为 `applied` 或 reviewer 合法 `not_required` 才允许 `completed`。

- [ ] **Step 4: 更新 metadata、验证和提交**

重新生成两端 `agents/openai.yaml`，分别运行 `quick_validate.py`，再用 Task 1 的无来源链分派确认返回 `blocked`。只暂存四个 worker 文件并提交 `refactor(worker): enforce plan profiles`。

---

### Task 5: 发布 Codex 插件 0.3.0 构建

**Files:**
- Modify: `codex-market/plugins/ghost-agent-workflow/.codex-plugin/plugin.json`

**Interfaces:**
- Consumes: 已验证的三个 Codex skill。
- Produces: 合法的 `0.3.0+codex.YYYYMMDDHHMMSS` 插件构建。

- [ ] **Step 1: 更新基础版本和插件说明**

把基础版本改为 `0.3.0`，并让 description、keywords、longDescription、defaultPrompt 覆盖 `parallel-task-planner`、版本化计划和 worker profiles。

- [ ] **Step 2: 运行 cachebuster helper**

Run: `python3 /Users/ghost233/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py /Users/ghost233/code/ghost-agent-market/codex-market/plugins/ghost-agent-workflow`

Expected: version 变为单个 `0.3.0+codex.<UTC 时间戳>`。

- [ ] **Step 3: 验证并提交 manifest**

Run: `python3 /Users/ghost233/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py /Users/ghost233/code/ghost-agent-market/codex-market/plugins/ghost-agent-workflow`

Expected: 插件验证通过。只暂存 `plugin.json` 并提交 `chore(plugin): release workflow 0.3.0`。

---

### Task 6: 全量一致性和前向验证

**Files:**
- Verify: 六份 `SKILL.md`
- Verify: 六份 `agents/openai.yaml`
- Verify: `codex-market/plugins/ghost-agent-workflow/.codex-plugin/plugin.json`

**Interfaces:**
- Consumes: Tasks 2-5 的已提交结果。
- Produces: 可交付的双 marketplace skills 和无阻塞审查结论。

- [ ] **Step 1: 跑六次 Skill Creator 验证**

分别对两端三个 skill 目录运行 `quick_validate.py`。

Expected: 六次均输出 `Skill is valid!`。

- [ ] **Step 2: 检查跨平台字段一致性**

Run: `git diff --check`

Expected: 无输出。再检查六份 skill 都包含 `planner`、`plan_format_version`、`execution_platform`、`dispatch_mode`、`review_mode`、plan-authored `worker_profile`、独立 `worker_profile_evidence`、`reviewer_subagent_profile` 与 mapping-shaped `reviewer_profile_preflight`，且平台固定值符合 Global Constraints。

- [ ] **Step 3: 运行更新后压力场景**

至少让三个 fresh subagents 分别验证 planner 完整输出、coordinator 拒绝旁路、worker 拒绝无来源链；审阅其原始结果，不只依赖关键词计数。

- [ ] **Step 4: 运行最终只读审查**

让 final reviewer 对设计文档、实施计划和完整分支 diff 做范围、契约、平台差异、验证证据和版本检查。修复 Critical/Important findings 后重新验证。

- [ ] **Step 5: 确认工作树状态**

Run: `git status --short`

Expected: 仅允许实施计划文件处于未提交状态；将其单独提交为 `docs: add worker profile implementation plan`，最终工作树必须干净。
