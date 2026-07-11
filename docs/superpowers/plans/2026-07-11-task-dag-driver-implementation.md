# Task DAG Driver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将双端 thread workflow 升级为统一 v3 module/task JSON 契约，用最小 TypeScript CLI 驱动无 batch、无并发上限的 DAG 执行和同 module 线程复用。

**Architecture:** Planner 在项目的 `.ghost-agent-workflow/parallel_plan/<plan_id>/` 生成 `plan.json`；无依赖 TS CLI 通过 `validate` / `next` / `update` 校验 DAG、计算复用 route 和推进 `state.json`。Codex 和 Claude Code 共用 schema 与脚本，skill 只负责把结构化 action 翻译为平台工具调用、验证 worker result 和执行工程总验收。

**Tech Stack:** TypeScript erasable syntax、Node.js core modules、发布时生成的 ESM `.mjs`、Python `unittest`、Markdown agent skills、YAML UI metadata、JSON plugin manifests。

## Global Constraints

- DAG 节点是 task，module 只定义可复用 worker profile/context。
- `next` 一次返回全部 ready task，不得存在 batch barrier、线程池或并发上限。
- 线程只在同 `module_id` 的祖先 task 之间复用，不得为复用引入 DAG 外等待。
- 脚本运行时无项目依赖，且只提供 `validate`、`next`、`update` 三个命令。
- Codex module 默认 profile 为 `gpt-5.6-terra/xhigh`；Claude Code module 默认 profile 为 `sonnet/max`。
- Codex skill 不出现 Claude runtime 文案；双端平台差异只存在适配层。
- Codex 基础版本从 `0.4.5` 增加为 `0.4.6`，然后生成一个 cachebuster；Claude Code 版本从 `0.2.1` 增加为 `0.2.2`。
- 不修改 `git-commit` skill 的模型和执行契约。

---

### Task 1: 用失败测试固定 v3 DAG CLI 契约

**Files:**
- Create: `tests/test_thread_plan_cli.py`
- Create: `tests/fixtures/thread-plan/parallel.json`
- Create: `tests/fixtures/thread-plan/conflict.json`

**Interfaces:**
- Consumes: 设计文档中的 v3 `modules` / `tasks` / `dispatch.routes` 结构。
- Produces: 对 `validate`、`next`、`update` CLI 的可执行验收契约。

- [ ] **Step 1: 写 CLI 失败测试**

`tests/test_thread_plan_cli.py` 必须用 `tempfile.TemporaryDirectory` 复制 fixture，并用 `subprocess.run(["node", SCRIPT, ...], capture_output=True, text=True)` 执行发布脚本。至少覆盖：

```python
def test_validate_builds_routes_and_state(self):
    result = self.run_cli("validate", plan_path)
    self.assertEqual(result.returncode, 0, result.stderr)
    self.assertEqual(plan["dispatch"]["routes"]["T2"], {
        "action": "reuse",
        "from_task": "T1",
    })
    self.assertEqual(state["tasks"]["T1"]["status"], "pending")

def test_next_returns_every_ready_task_without_limit(self):
    payload = self.run_json("next", plan_path, state_path)
    self.assertEqual(
        {action["task_id"] for action in payload["actions"]},
        {"T1", "T3"},
    )

def test_conflicting_incomparable_tasks_are_rejected(self):
    result = self.run_cli("validate", conflict_plan)
    self.assertNotEqual(result.returncode, 0)
    self.assertIn("writable_paths conflict", result.stderr)
```

还必须测试环、未知 module/task、同 module 独立 task 分别 `create_thread`、前置完成后后继立即 ready、失败仅传播给后继、plan digest 变化和非法状态转换。

- [ ] **Step 2: 运行测试确认 RED**

Run:

```bash
python3 -m unittest tests/test_thread_plan_cli.py -v
```

Expected: FAIL，因为 `scripts/thread-plan.mjs` 尚不存在。

### Task 2: 实现最小 TypeScript DAG 驱动器

**Files:**
- Create: `tooling/thread-plan/thread-plan.ts`
- Create: `tooling/thread-plan/build.mjs`
- Create: `codex-market/plugins/ghost-agent-workflow/scripts/thread-plan.mjs`
- Create: `claude-code-market/scripts/thread-plan.mjs`
- Test: `tests/test_thread_plan_cli.py`

**Interfaces:**
- Consumes: `validate <plan.json>`、`next <plan.json> <state.json>`、`update <plan.json> <state.json> <task_id> <status> [thread_id]`。
- Produces: 双端字节完全一致的无依赖 `.mjs` 和 JSON stdout/error stderr。

- [ ] **Step 1: 实现 TypeScript 数据类型与基础校验**

`thread-plan.ts` 使用可擦除 TypeScript 语法和 Node core `fs`、`path`、`crypto`。核心类型固定为：

```ts
type WorkerProfile = { model: string; reasoning_effort: string };
type ModuleDefinition = {
  id: string;
  worker_profile: WorkerProfile;
  worker_context: string;
};
type TaskDefinition = {
  id: string;
  module_id: string;
  task: string;
  depends_on: string[];
  writable_paths: string[];
  done_when: string[];
  verification: string[];
};
type TaskStatus =
  | "pending" | "running" | "completed" | "blocked"
  | "failed" | "needs_main_review" | "dependency_blocked";
```

- [ ] **Step 2: 实现 DAG、冲突和复用 route**

实现有向环检测、task 可达矩阵、精确/父子/glob 前缀写路径冲突检查，以及按 task 文档顺序遍历的二分图增广路最大匹配。匹配边必须满足：

```ts
source.module_id === target.module_id && isAncestor(source.id, target.id)
```

匹配到的 target 生成 `{ action: "reuse", from_task: sourceId }`，其他 task 生成 `{ action: "create" }`。

- [ ] **Step 3: 实现三个 CLI 命令**

`validate` 规范化并回写 `plan.json`，仅在不存在时创建带 plan digest 的 `state.json`。`next` 验证 digest，写入 `dependency_blocked`，并一次输出全部 ready actions。`update` 仅允许：

```ts
pending -> running | blocked
running -> completed | blocked | failed | needs_main_review
```

`running` 必须带 thread id；`reuse` route 的 thread id 必须等于 `from_task` 的 thread id。

- [ ] **Step 4: 实现无依赖发布构建**

`build.mjs` 用 Node `module.stripTypeScriptTypes(..., {mode: "strip"})` 转换源码，添加 generated header，并把完全相同的字节写入双端 `scripts/thread-plan.mjs`。

- [ ] **Step 5: 构建并运行测试确认 GREEN**

Run:

```bash
node tooling/thread-plan/build.mjs
python3 -m unittest tests/test_thread_plan_cli.py -v
```

Expected: 构建成功，CLI 测试全部 PASS，两份 `.mjs` 字节相同。

### Task 3: 用契约测试固定双端 skill 语义

**Files:**
- Modify: `tests/test_codex_child_thread_contract.py`
- Create: `tests/test_parallel_task_skill_contract.py`

**Interfaces:**
- Consumes: Task 2 的 v3 CLI 和设计文档中的平台适配边界。
- Produces: 双端 planner/coordinator/worker 不得偏离的静态契约。

- [ ] **Step 1: 把 Codex 契约升级为 v3 task DAG**

更新旧 v2 断言，必须断言 planner/coordinator/worker 包含：

```python
self.assertIn("plan_format_version: 3", combined)
self.assertIn(".ghost-agent-workflow/parallel_plan", planner)
self.assertIn("thread-plan.mjs", combined)
self.assertIn("task_id", combined)
self.assertIn("module_id", combined)
self.assertIn("create_thread", coordinator)
self.assertIn("send_message_to_thread", coordinator)
```

并断言 Codex 三份 skill 不包含 `dispatch.batches`、`batch barrier`、`线程池`、`并发上限`、`子代理`、`spawn_agent` 或 Claude runtime 文案。

- [ ] **Step 2: 新增双端统一性测试**

`test_parallel_task_skill_contract.py` 读取双端三份 skill、metadata 和发布脚本，断言：

```python
self.assertIn("DAG 节点", planner)
self.assertIn("module", planner)
self.assertIn("task", planner)
self.assertEqual(codex_script.read_bytes(), claude_script.read_bytes())
self.assertNotIn("dispatch.batches", all_thread_skills)
self.assertNotIn("并发上限", all_thread_skills)
```

- [ ] **Step 3: 运行测试确认 RED**

Run:

```bash
python3 -m unittest tests/test_codex_child_thread_contract.py tests/test_parallel_task_skill_contract.py -v
```

Expected: FAIL，因为 skill 仍是 v1/v2 module batch 契约。

### Task 4: 重写双端三份 thread skill 与 metadata

**Files:**
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/parallel-task-planner/SKILL.md`
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/thread-coordination/SKILL.md`
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/thread-goal-worker/SKILL.md`
- Modify: 上述三个目录的 `agents/openai.yaml`
- Modify: `claude-code-market/skills/parallel-task-planner/SKILL.md`
- Modify: `claude-code-market/skills/thread-coordination/SKILL.md`
- Modify: `claude-code-market/skills/thread-goal-worker/SKILL.md`
- Modify: 上述三个目录的 `agents/openai.yaml`

**Interfaces:**
- Consumes: Task 2 CLI action JSON 和 Task 3 契约测试。
- Produces: planner -> coordinator -> worker 的统一 v3 task 契约和平台适配流程。

- [ ] **Step 1: 重写 planner**

双端 planner 都必须：把输入拆为 module 定义和 task DAG；写入 `<project>/.ghost-agent-workflow/parallel_plan/<plan_id>/plan.json`；运行 `thread-plan.mjs validate`；只在 `parallel_safe` 且用户明确授权时交给 coordinator。默认 profile 分别为 Codex `gpt-5.6-terra/xhigh` 和 Claude Code `sonnet/max`。

- [ ] **Step 2: 重写 coordinator**

双端 coordinator 都必须：只接受绝对 v3 `plan.json`；运行 `next`；在不等待同次任何结果的前提下处理全部 actions；成功后 `update ... running`；回收 `WORKER_RESULT_V3`；一次原 worker 补修；每次状态变化后再运行 `next`；全部 task 完成后执行 `project_verification`。

Codex 使用 `create_thread` / `send_message_to_thread` / `read_thread`；Claude Code 使用 Agent/team teammate 对应工具。

- [ ] **Step 3: 重写 worker**

worker 必须以 `task_id` 而非 module 作为当前执行单元，验证 `module_id` 和 plan 原文，只修改 task `writable_paths`，并返回设计文档规定的 `WORKER_RESULT_V3`。Codex 每个 task 使用独立 goal；Claude Code 使用 assignment evidence。

- [ ] **Step 4: 更新 metadata 并运行契约测试**

`openai.yaml` 的 display name、short description 和 default prompt 改为 v3 module/task DAG、无 batch 执行和同 module 线程复用。

Run:

```bash
python3 -m unittest tests/test_codex_child_thread_contract.py tests/test_parallel_task_skill_contract.py -v
```

Expected: PASS。

### Task 5: 发布、验证并重装插件

**Files:**
- Modify: `codex-market/plugins/ghost-agent-workflow/.codex-plugin/plugin.json`
- Modify: `claude-code-market/.claude-plugin/plugin.json`
- Verify: 双端 scripts、skills、metadata 和全部 tests

**Interfaces:**
- Consumes: Tasks 1-4 的可执行 v3 插件内容。
- Produces: Codex `0.4.6+codex.<UTC>`、Claude Code `0.2.2` 和从实际 Codex cache 加载的新版 skill。

- [ ] **Step 1: 递增基础版本**

Codex manifest 先设为 `0.4.6`，Claude Code manifest 设为 `0.2.2`。更新 manifest 描述中的 v3 task DAG 能力，不修改 `git-commit` 能力。

- [ ] **Step 2: 生成唯一 Codex cachebuster**

Run:

```bash
python3 /Users/ghost233/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py codex-market/plugins/ghost-agent-workflow
```

Expected: Codex manifest 版本为 `0.4.6+codex.<UTC timestamp>`，且只有一个 `+codex.` 后缀。

- [ ] **Step 3: 运行全部测试和静态检查**

Run:

```bash
node tooling/thread-plan/build.mjs
python3 -m unittest discover -s tests -v
python3 /Users/ghost233/.codex/skills/.system/skill-creator/scripts/quick_validate.py codex-market/plugins/ghost-agent-workflow/skills/parallel-task-planner
python3 /Users/ghost233/.codex/skills/.system/skill-creator/scripts/quick_validate.py codex-market/plugins/ghost-agent-workflow/skills/thread-coordination
python3 /Users/ghost233/.codex/skills/.system/skill-creator/scripts/quick_validate.py codex-market/plugins/ghost-agent-workflow/skills/thread-goal-worker
python3 /Users/ghost233/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py codex-market/plugins/ghost-agent-workflow
git diff --check
```

Expected: 全部命令通过，双端 `.mjs` 仍字节相同。

- [ ] **Step 4: 检查禁止残留**

Run:

```bash
rg -n "dispatch\.batches|batch barrier|线程池|并发上限|plan_format_version: 2|plan_format_version: 1" codex-market/plugins/ghost-agent-workflow/skills/{parallel-task-planner,thread-coordination,thread-goal-worker} claude-code-market/skills/{parallel-task-planner,thread-coordination,thread-goal-worker}
```

Expected: 无匹配。

- [ ] **Step 5: 提交实现**

```bash
git add docs/superpowers/plans/2026-07-11-task-dag-driver-implementation.md tooling tests codex-market claude-code-market
git commit -m "feat(workflow): 引入 task DAG 驱动与线程复用"
```

- [ ] **Step 6: 从本地 marketplace 重装 Codex 插件**

Run:

```bash
codex plugin list
codex plugin add ghost-agent-workflow@ghost-agent-market
```

Expected: 安装版本与 Codex manifest 的 `0.4.6+codex.<UTC timestamp>` 完全一致。

- [ ] **Step 7: 复查实际 cache 和工作树**

从 `~/.codex/plugins/cache/ghost-agent-market/ghost-agent-workflow/<installed-version>/` 检查三份 thread skill 和 `scripts/thread-plan.mjs`，确认包含 v3 task DAG 契约且无 batch/并发上限残留。运行 `git status --short` 和 `git log -3 --oneline`，确认工作树干净且提交边界正确。
