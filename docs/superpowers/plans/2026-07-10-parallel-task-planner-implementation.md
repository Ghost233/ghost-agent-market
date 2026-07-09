# 并发任务规划 Skill 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 新增可从自然语言或既有计划生成安全并发模块计划、并自动协调执行的轻量 skill，并以六次独立的十轮 SkillOpt 强化结果提升三组 skill。

**架构：** `$parallel-task-planner` 生成 `docs/parallel-task-plans/` 下的计划契约，并仅在显式安全门禁通过时调用 `$thread-coordination` 的 `parallel-plan` 模式。协调 skill 负责有上限的分派、汇总和一轮补修；worker skill 负责单个模块的有上限自检循环。六个目标 `SKILL.md` 分别接受其专属、已审核的 TaskRecord 语料的十轮 SkillOpt-Sleep 强化；随后按同名 skill 融合双端结果并保留平台差异。

**技术栈：** Markdown SKILL.md、Codex/Claude skill metadata、Codex thread tools、SkillOpt-Sleep、Bash、Python 3.10+。

## 全局约束

- 新增或更新的每份 skill 内容必须同时出现在 Claude Code 和 Codex marketplace 的对应目录；平台 API 差异必须在各自 skill 中明确说明。
- 并发计划只有在可写范围不重叠、依赖图无环、验证不冲突且父目标完成条件完全覆盖时，才能自动分派。
- 协调循环和 worker 循环均最多只允许一轮补修；不可确认的并发安全性必须返回 `needs_user_review`，不得猜测。
- SkillOpt 强化必须针对六份独立的目标 SKILL.md，使用该目标专属且已审核、至少包含四条真实 TaskRecord 的语料。
- 真实 SkillOpt 运行必须使用 `--backend codex --source codex --confirm-auto-adopt`、`gate_mode=on`、`evolve_memory=false`、`evolve_skill=true`，并在运行前取得用户对预算和自动采纳的明确同意。
- 不得手动编辑某个 target SKILL.md 的十轮强化过程；十轮结束后的跨平台融合是单独、可审计的集成步骤。
- 六个强化执行者总数固定为六；运行环境最多同时容纳三个 worker，因此分两批运行，每批三个。

---

### Task 1: 创建并同步并发任务规划 Skill 基线

**文件：**
- 创建：`claude-code-market/skills/parallel-task-planner/SKILL.md`
- 创建：`claude-code-market/skills/parallel-task-planner/agents/openai.yaml`
- 创建：`codex-market/plugins/ghost-agent-workflow/skills/parallel-task-planner/SKILL.md`
- 创建：`codex-market/plugins/ghost-agent-workflow/skills/parallel-task-planner/agents/openai.yaml`

**接口：**
- 消费：自然语言目标或计划文档路径。
- 生成：`docs/parallel-task-plans/YYYY-MM-DD-<goal-slug>.md`。
- 调用：安全状态为 `parallel_safe` 时调用 `$thread-coordination`，并传入计划路径。

- [ ] 新建两个 `SKILL.md`，且两端均包含“输入入口、最少仓库读取、计划文档格式、安全门禁、自动分派、非目标”六节。
- [ ] 将计划文档 schema 固定为 `parent_goal`、`source`、`modules`、`safety`、`dispatch.batches`；每个 module 固定包含 `id`、`task`、`writable_paths`、`depends_on`、`done_when`、`verification`、`worker_context`。
- [ ] 明确 `parallel_safe` 的六项必要条件，并规定模糊信息返回 `needs_user_review`、仅有依赖返回 `sequential_only`。
- [ ] 为 Claude Code 说明通过 agent team coordinator 分派；为 Codex 说明通过可访问的 Codex worker thread 分派。除这一平台适配外，两个文档的计划 schema 和安全门禁语义一致。
- [ ] 添加两端 `agents/openai.yaml`，显示名为“并发任务规划”，默认提示词要求“生成计划、通过门禁后自动使用 $thread-coordination”。
- [ ] 运行：`git diff --check`。
- [ ] 提交：`git add claude-code-market/skills/parallel-task-planner codex-market/plugins/ghost-agent-workflow/skills/parallel-task-planner && git commit -m "feat: add parallel task planner skill"`。

### Task 2: 为协调 Skill 增加 parallel-plan 模式

**文件：**
- 修改：`claude-code-market/skills/thread-coordination/SKILL.md`
- 修改：`claude-code-market/skills/thread-coordination/agents/openai.yaml`
- 修改：`codex-market/plugins/ghost-agent-workflow/skills/thread-coordination/SKILL.md`
- 修改：`codex-market/plugins/ghost-agent-workflow/skills/thread-coordination/agents/openai.yaml`

**接口：**
- 消费：`parallel-task-planner` 生成的计划路径和 `parallel_safe` 状态。
- 分派：每个 ready module 的 `id`、`task`、`writable_paths`、`done_when`、`verification`。
- 生成：按模块收集的 `WORKER_RESULT`，以及 `completed | partial | blocked` 的父目标结论。

- [ ] 添加 `parallel-plan` 入口：读取已存在的计划，不重做任务拆解，不创建永久模块/线程 registry。
- [ ] 添加 coordinator 循环：按 `dispatch.batches` 分派 ready 模块、收集每个模块的结果、检查所有模块状态、仅对 owner worker 发起一次定向补修、输出最终状态。
- [ ] 添加总验收清单：`parent_goal` 覆盖、模块结果完整性、验证证据、跨模块可写文件冲突、未解决风险，以及允许时的 `git diff --check`。
- [ ] 明确平台差异：Claude 使用稳定 team member name；Codex 使用可访问的已有 thread 或现有的用户可见 thread 创建规则。两端都不得由 coordinator 修改实现文件。
- [ ] 更新两端 metadata 的 short description 和 default prompt，覆盖 `parallel-plan` 输入和“一轮补修”。
- [ ] 运行：`git diff --check`。
- [ ] 提交：`git add claude-code-market/skills/thread-coordination codex-market/plugins/ghost-agent-workflow/skills/thread-coordination && git commit -m "feat: add parallel-plan coordination mode"`。

### Task 3: 为 Worker Skill 增加轻量 parallel-plan 模式

**文件：**
- 修改：`claude-code-market/skills/thread-goal-worker/SKILL.md`
- 修改：`claude-code-market/skills/thread-goal-worker/agents/openai.yaml`
- 修改：`codex-market/plugins/ghost-agent-workflow/skills/thread-goal-worker/SKILL.md`
- 修改：`codex-market/plugins/ghost-agent-workflow/skills/thread-goal-worker/agents/openai.yaml`

**接口：**
- 消费：一个模块的 `id`、`task`、`writable_paths`、`done_when`、`verification`、`worker_context`。
- 生成：`WORKER_RESULT`，字段为 `module_id`、`status`、`changed_files`、`verification`、`diff_self_check`、`goal_alignment`、`risks`。

- [ ] 添加 worker 循环：设置或确认 child goal（Codex 保留现有 active `/goal` 门禁）、检查 scope、实现、验证、检查自身 diff、最多修复一次、返回结果。
- [ ] 将 `parallel-plan` 模式的自检定义为 module scope、`done_when`、验证结果和变更聚焦度的检查；该模式不要求额外 reviewer-subagent，但不得影响既有非 parallel-plan 模式的审查要求。
- [ ] 明确 `completed` 仅在验证和 `diff_self_check: pass` 时允许；失败、范围不清或依赖缺失必须返回 `needs_fix` 或 `blocked`。
- [ ] 添加两端平台一致的 `WORKER_RESULT` 格式，并在协调 skill 仍可消费既有 `TEAMMATE_RESULT` / `COORDINATOR_RESULT` 时说明本模式优先使用 `WORKER_RESULT`。
- [ ] 更新两端 metadata 的 default prompt，说明单模块执行与一轮自修限制。
- [ ] 运行：`git diff --check`。
- [ ] 提交：`git add claude-code-market/skills/thread-goal-worker codex-market/plugins/ghost-agent-workflow/skills/thread-goal-worker && git commit -m "feat: add parallel-plan worker mode"`。

### Task 4: 建立六份已审核的 SkillOpt 语料

**文件：**
- 创建：`.skillopt-reinforce/corpora/claude-thread-coordination.json`
- 创建：`.skillopt-reinforce/corpora/codex-thread-coordination.json`
- 创建：`.skillopt-reinforce/corpora/claude-thread-goal-worker.json`
- 创建：`.skillopt-reinforce/corpora/codex-thread-goal-worker.json`
- 创建：`.skillopt-reinforce/corpora/claude-parallel-task-planner.json`
- 创建：`.skillopt-reinforce/corpora/codex-parallel-task-planner.json`

**接口：**
- 消费：仅来自历史 Codex Desktop 会话的、与对应 target skill 匹配的真实任务。
- 生成：每份 target 专属的 TaskRecord JSON，顶层 `reviewed: true`，至少四条独立记录。

- [ ] 针对每个 target 运行 harvest，使用对应的绝对 `--target-skill-path`、`--project /Users/ghost233/code/ghost-agent-market`、`--source codex` 和唯一 `--output` 路径。
- [ ] 逐份读取生成 JSON，移除无关记录或敏感信息；确认每条记录实际对应其 target skill、数量至少为四，且顶层记录的 `target_skill_path` 与目标绝对路径一致。
- [ ] 仅在以上审核完成后将顶层 `reviewed` 设为 `true`。审核不足的 corpus 保持未审核，不得用于强化。
- [ ] 在每份 JSON 旁记录不含原始会话内容的审核摘要：任务数、目标路径、移除原因和审核人。
- [ ] 运行：`git diff --check -- .skillopt-reinforce/corpora`。

### Task 5: 用六个独立 worker 执行十轮 SkillOpt 强化

**文件：**
- 修改目标：Task 1 至 Task 3 的六份 `SKILL.md`。
- 读取报告：每轮 staging 目录中的 `report.md` 与运行器 JSON 输出。

**接口：**
- 每个 worker 仅拥有一份 target SKILL.md 与同名 corpus。
- 每个 worker 运行恰好十轮，返回所有轮次的 gate action、accepted/rejected edit 数、最终 diff 和报告路径。

- [ ] 在真正运行前取得用户对以下项目的明确同意：六个绝对 target 路径、六个 corpus 路径、`codex` 后端、`codex` source、总计六十轮真实后端调用，以及 gate 接受的编辑自动采纳并保留备份。
- [ ] 分两批启动共六个独立 worker；每批三个。每个 worker 先阅读 `.agents/skills/skillopt-reinforce-10/SKILL.md`，只处理分配给它的 target 和 corpus。
- [ ] 每个 worker 使用：`SKILLOPT_REPO=/Users/ghost233/code/ghost-agent-market/SkillOpt bash /Users/ghost233/code/ghost-agent-market/.agents/skills/skillopt-reinforce-10/scripts/reinforce_ten_rounds.sh --project /Users/ghost233/code/ghost-agent-market --target-skill-path <absolute-target> --tasks-file <absolute-corpus> --backend codex --source codex --confirm-auto-adopt`。
- [ ] 每个 worker 遇到未审核、少于四条任务、路径不匹配、运行器失败或 gate 配置不符合本计划时立即停止，不得以 mock、跳过轮次或手动编辑冒充强化完成。
- [ ] 每个 worker 在十轮后读取每轮 staging 的 `report.md` 和最终目标 diff，并写入自己的结果摘要；没有 gate 接受编辑或分数未提升时如实报告“未验证改进”。

### Task 6: 融合同名 Skill 的强化结果并验证交付

**文件：**
- 修改：Task 1 至 Task 3 的六份 `SKILL.md` 和六份 `agents/openai.yaml`（仅在需要保持契约一致时）。
- 创建：`.skillopt-reinforce/reports/2026-07-10-parallel-task-planner-merge.md`

**接口：**
- 消费：六个 worker 的十轮摘要、staging `report.md`、最终 diff。
- 生成：每一对同名 skill 的共同强化结论、保留的平台差异、最终一致性证据。

- [ ] 逐对比较 `thread-coordination`、`thread-goal-worker` 和 `parallel-task-planner` 的强化结果，提取相同的、通过 gate 的改进意图。
- [ ] 将共同改进融合到两端对应 skill，保留 Claude team member 与 Codex thread / active-goal 的真实平台差异；不得把一端平台 API 复制到另一端。
- [ ] 验证每对 skill 都包含相同的计划 schema、`parallel_safe | sequential_only | needs_user_review` 安全状态、一轮 coordinator 补修限制、一轮 worker 自修限制和相同 `WORKER_RESULT` 字段。
- [ ] 运行：`git diff --check`、`rg -n 'parallel-plan|parallel_safe|sequential_only|needs_user_review|WORKER_RESULT' claude-code-market/skills codex-market/plugins/ghost-agent-workflow/skills`。
- [ ] 阅读 merge report，核对六个运行器都完成十轮，或明确记录对应的阻止原因；不得把未运行的目标称为强化完成。
- [ ] 提交：`git add claude-code-market/skills codex-market/plugins/ghost-agent-workflow/skills .skillopt-reinforce/reports && git commit -m "feat: reinforce parallel task workflow skills"`。
