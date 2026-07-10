# Codex 子线程协调 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Codex 并发执行从不可用的 profile-bound implementation subagent 迁移为用户可见、共享本地工作区且保留在侧边栏的 profile-bound module 子线程。

**Architecture:** `$parallel-task-planner` 生成带 `worker_runtime: codex_child_thread` 的 v2 计划；只读 `$thread-coordination` 使用 `list_projects` 和 `create_thread` 按 batch 创建 module 子线程，再通过 `read_thread` 回收结果并用 `send_message_to_thread` 在原线程补修一次；`$thread-goal-worker` 在模块子线程内绑定 active goal、限定 scope、验证并汇总内部普通子代理的工作。

**Tech Stack:** Markdown agent skills、YAML UI metadata、Python `unittest` 契约测试、JSON Codex plugin manifest、Skill Creator validator、Plugin Creator cachebuster/reinstall helper、Codex thread tools。

## Global Constraints

- 只修改 Codex marketplace；Claude Code skill 和计划格式保持不变。
- coordinator 只接受 `plan_format_version: 2`、`execution_platform: codex`、`worker_runtime: codex_child_thread`、`safety.status: parallel_safe` 的计划。
- 创建用户可见子线程前必须有当前用户的明确子线程执行授权。
- module 子线程必须使用当前 Codex project 的 `environment: {type: local}`，与主线程共享同一本地工作区。
- Codex coordinator 推荐 `gpt-5.6-sol/xhigh`；module 子线程默认 `gpt-5.6-terra/xhigh`，并在 `create_thread` 调用中原样传入 `model` 和 `thinking`。
- 每个 module 只能绑定一个 thread id；一次补修必须使用 `send_message_to_thread` 发送给原 thread id。
- module 子线程可以自行使用普通子代理；coordinator 不配置、不跟踪第三层子代理的模型、effort 或身份。
- 子线程无论成功失败都保留，skill 不调用 `set_thread_archived`。
- 不允许回退到 implementation subagent，不允许模型或 effort 静默降级。
- 旧 v1 计划不得原地升级或手改 safety；必须重新运行 planner。
- Codex plugin 基础版本升级为 `0.4.0`，发布构建只保留一个 `+codex.<UTC 时间戳>` cachebuster。

---

### Task 1: 建立 v2 子线程契约 RED 测试

**Files:**
- Create: `tests/test_codex_child_thread_contract.py`

**Interfaces:**
- Consumes: 三份 Codex `SKILL.md`、三份 `agents/openai.yaml`、plugin manifest。
- Produces: `python3 -m unittest tests/test_codex_child_thread_contract.py -v` 的稳定契约门禁。

- [ ] **Step 1: 创建失败测试**

写入以下完整测试：

```python
from pathlib import Path
import json
import unittest


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "codex-market/plugins/ghost-agent-workflow"


def read(path: str) -> str:
    return (PLUGIN / path).read_text(encoding="utf-8")


class CodexChildThreadContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.planner = read("skills/parallel-task-planner/SKILL.md")
        cls.coordinator = read("skills/thread-coordination/SKILL.md")
        cls.worker = read("skills/thread-goal-worker/SKILL.md")
        cls.metadata = "\n".join(
            read(path)
            for path in (
                "skills/parallel-task-planner/agents/openai.yaml",
                "skills/thread-coordination/agents/openai.yaml",
                "skills/thread-goal-worker/agents/openai.yaml",
            )
        )

    def test_planner_emits_v2_child_thread_runtime(self) -> None:
        self.assertIn("plan_format_version: 2", self.planner)
        self.assertIn("worker_runtime: codex_child_thread", self.planner)
        self.assertIn("gpt-5.6-terra", self.planner)
        self.assertIn("reasoning_effort: xhigh", self.planner)

    def test_coordinator_uses_thread_tools(self) -> None:
        for tool in ("list_projects", "create_thread", "read_thread", "send_message_to_thread"):
            self.assertIn(tool, self.coordinator)
        self.assertIn("environment: {type: local}", self.coordinator)
        self.assertIn("model", self.coordinator)
        self.assertIn("thinking", self.coordinator)

    def test_worker_is_child_thread_owner(self) -> None:
        self.assertIn("模块子线程", self.worker)
        self.assertIn("内部子代理", self.worker)
        self.assertIn("child_thread", self.worker)
        self.assertIn("goal_set_evidence", self.worker)

    def test_legacy_module_worker_contract_is_removed(self) -> None:
        combined = "\n".join((self.planner, self.coordinator, self.worker, self.metadata))
        self.assertNotIn("implementation subagent", combined)
        self.assertNotIn("实现子代理", combined)
        self.assertNotIn("禁止创建用户可见 thread/task", combined)
        self.assertNotIn("set_thread_archived", combined)

    def test_metadata_describes_child_threads(self) -> None:
        self.assertIn("子线程", self.metadata)
        self.assertIn("gpt-5.6-terra/xhigh", self.metadata)

    def test_manifest_targets_new_minor_version(self) -> None:
        manifest = json.loads(read(".codex-plugin/plugin.json"))
        self.assertTrue(manifest["version"].startswith("0.4.0+codex."))
        self.assertIn("child thread", manifest["description"].lower())
        self.assertNotIn("implementation subagent", json.dumps(manifest, ensure_ascii=False).lower())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```bash
python3 -m unittest tests/test_codex_child_thread_contract.py -v
```

Expected: FAIL；至少报告缺少 `plan_format_version: 2`、缺少 `create_thread`、仍含 `implementation subagent`、manifest 仍为 `0.3.3`。

- [ ] **Step 3: 提交 RED 测试**

```bash
git add tests/test_codex_child_thread_contract.py
git commit -m "test(workflow): 固化 Codex 子线程协调契约"
```

---

### Task 2: 将 parallel-task-planner 升级为 v2 子线程计划

**Files:**
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/parallel-task-planner/SKILL.md`
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/parallel-task-planner/agents/openai.yaml`

**Interfaces:**
- Consumes: 自然语言需求或已有计划文档、Codex 默认 worker profile。
- Produces: `plan_format_version: 2`、`worker_runtime: codex_child_thread`、完整 module profile 和拓扑 batch。

- [ ] **Step 1: 修改 frontmatter 与平台边界**

将描述和概述中的 Codex module worker 统一为“用户可见模块子线程”；删除对 implementation-subagent schema 是否支持 per-call profile 的 safety 预检。明确 planner 只验证 profile 字段完整且能映射到 thread 创建参数，不生成 runtime evidence。

- [ ] **Step 2: 替换计划 schema**

在 schema 中使用以下固定 marker：

```yaml
planner: parallel-task-planner
plan_format_version: 2
execution_platform: codex
worker_runtime: codex_child_thread
dispatch_mode: parallel-plan
review_mode: diff_self_check
worker_defaults:
  model: gpt-5.6-terra
  reasoning_effort: xhigh
```

每个 module 继续写出完整 `worker_profile`。计划中禁止出现 `child_thread`、`worker_profile_evidence` 或其他 runtime thread id。

- [ ] **Step 3: 重写安全判定与自动交接**

保留 DAG、batch、路径和 parent goal 安全判定。`parallel_safe` 只表达任务可并发，不把当前 implementation-subagent 参数缺失误判为 `needs_user_review`。只有当前用户明确要求创建子线程并执行时，才把绝对 `plan_path` 交给 `$thread-coordination`；否则只保存计划。

- [ ] **Step 4: 更新 metadata**

`openai.yaml` 必须包含：

```yaml
interface:
  display_name: "并发子线程规划"
  short_description: "为 Codex 用户可见子线程生成 v2 版本化并发计划"
```

`default_prompt` 明确 v2、`codex_child_thread`、`gpt-5.6-terra/xhigh` 和只在显式授权时交给 coordinator。

- [ ] **Step 5: 运行定向测试**

```bash
python3 -m unittest tests.test_codex_child_thread_contract.CodexChildThreadContractTests.test_planner_emits_v2_child_thread_runtime -v
```

Expected: PASS。

- [ ] **Step 6: 提交 planner**

```bash
git add codex-market/plugins/ghost-agent-workflow/skills/parallel-task-planner
git commit -m "feat(workflow): 生成 Codex v2 子线程计划"
```

---

### Task 3: 将 thread-coordination 改为用户可见子线程 coordinator

**Files:**
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/thread-coordination/SKILL.md`
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/thread-coordination/agents/openai.yaml`

**Interfaces:**
- Consumes: 绝对 v2 `plan_path` 和当前用户明确的子线程创建授权。
- Produces: `module_id -> thread_id` 映射、profile evidence、同线程补修和最终 `PARALLEL_PLAN_RESULT`。

- [ ] **Step 1: 反转入口门禁**

只接受以下 marker：

```yaml
plan_format_version: 2
execution_platform: codex
worker_runtime: codex_child_thread
dispatch_mode: parallel-plan
review_mode: diff_self_check
safety:
  status: parallel_safe
```

新增 `thread_authorization_required`、`project_unavailable` blocking code。v1、自然语言、缺少显式 thread 授权、无法解析当前 project、workspace 冲突时，在创建前返回 `blocked`。

- [ ] **Step 2: 定义 project 解析与两步绑定**

写明先使用 `list_projects` 唯一匹配当前工作区，再为每个 ready module 调用：

```yaml
create_thread:
  target:
    type: project
    projectId: <resolved current project id>
    environment: {type: local}
  model: <module.worker_profile.model>
  thinking: <module.worker_profile.reasoning_effort>
  prompt: <preflight package that forbids file changes until binding>
```

这里的尖括号是 skill 契约中的运行时值说明，不是实施占位符。调用成功后保存真实 `threadId`，把 `worker_profile_evidence.status` 设为 `applied`，并立即向该 id 发送唯一可执行的绑定包：

```yaml
send_message_to_thread:
  threadId: <created thread id>
  prompt: <single-module package with child_thread and profile evidence>
```

预备包禁止子线程在绑定前设置 goal、读取实现文件或修改文件。拒绝时不启动替代普通子代理。

- [ ] **Step 3: 定义 batch、回收和补修**

同 batch 子线程可并发创建；当前 batch 全部稳定后才进入下一 batch。使用 `read_thread(includeOutputs: true)` 退避式检查状态并解析最后一个 plan-bound `WORKER_RESULT`。缺字段或验收失败时仅调用一次：

```yaml
send_message_to_thread:
  threadId: <original module thread id>
  prompt: <repair_round 1 focused findings>
```

补修调用省略 `model` 和 `thinking`，保持原 thread profile。禁止创建第二个 thread，禁止 coordinator 接管实现。

- [ ] **Step 4: 定义用户干预、共享工作区与完成门禁**

保存基线 dirty 范围和 `module_id -> thread_id` 映射。越界修改、未计划共享产物或用户向子线程发送新指令时标记 `needs_main_review`，不自动回滚。只查看线程不影响执行。所有已创建线程保留，不调用自动归档接口。

- [ ] **Step 5: 更新结果 schema 与 metadata**

`PARALLEL_PLAN_RESULT.modules[]` 至少包含：

```yaml
id: M1
child_thread:
  id: <thread id>
  environment: local
repair_round: 0
status: completed
worker_profile: {model: gpt-5.6-terra, reasoning_effort: xhigh}
worker_profile_evidence:
  requested: {model: gpt-5.6-terra, reasoning_effort: xhigh}
  dispatch_arguments: {model: gpt-5.6-terra, thinking: xhigh}
  status: applied
  evidence: <create_thread request and thread id>
```

metadata 的 display name 改为“子线程计划协调”，描述中明确用户可见 module 子线程、共享 local workspace 和保留 thread。

- [ ] **Step 6: 运行定向测试**

```bash
python3 -m unittest tests.test_codex_child_thread_contract.CodexChildThreadContractTests.test_coordinator_uses_thread_tools -v
```

Expected: PASS。

- [ ] **Step 7: 提交 coordinator**

```bash
git add codex-market/plugins/ghost-agent-workflow/skills/thread-coordination
git commit -m "feat(workflow): 用 Codex 子线程执行并发模块"
```

---

### Task 4: 将 thread-goal-worker 改为模块子线程 owner

**Files:**
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/thread-goal-worker/SKILL.md`
- Modify: `codex-market/plugins/ghost-agent-workflow/skills/thread-goal-worker/agents/openai.yaml`

**Interfaces:**
- Consumes: coordinator 首轮或补修轮发送的单 module v2 分派包、真实 child thread id 和 profile evidence。
- Produces: 绑定当前模块子线程的 `WORKER_RESULT`。

- [ ] **Step 1: 重写入口和 Plan Binding**

worker 只接受 coordinator 创建的用户可见 module 子线程分派。校验 v2 marker、绝对 plan path、完整 module、当前 `child_thread.id`、`worker_profile_evidence.status: applied` 和 `repair_round: 0 | 1`。自然语言、v1、thread id 不匹配或手工 owner-domain 包在修改前 `blocked`。

- [ ] **Step 2: 定义模块子线程 goal 生命周期**

在任何修改前创建或恢复本线程 goal，并返回：

```yaml
goal_set_evidence:
  child_thread_id: <current thread id>
  module_id: M1
  repair_round: 0
  action: created | resumed | repair_created
  goal_id: <goal id>
  status: active | complete | blocked
```

首次执行完成时更新 goal；补修时恢复原 goal，无法恢复则在同一子线程创建与相同 module 绑定的 repair goal。

- [ ] **Step 3: 允许受控内部子代理**

明确模块子线程可自行使用普通子代理，但不配置或回传内部子代理 profile，也不得让内部子代理创建用户可见 thread。所有内部工作仍受当前 module 的 `writable_paths`、`done_when` 和 verification 约束，最终结果由模块子线程汇总。

- [ ] **Step 4: 更新 WORKER_RESULT 和状态规则**

结果必须包含 `child_thread`、结构化 `goal_set_evidence`、changed files、verification、mapping-shaped `diff_self_check`、plan-authored worker profile、create-thread profile evidence、goal alignment 和 risks。`completed` 要求 goal complete、scope 合法、验证通过且 diff self-check pass。

- [ ] **Step 5: 更新 metadata 并运行定向测试**

metadata display name 改为“单模块执行子线程”，default prompt 明确内部子代理不受主 coordinator 配置。

Run:

```bash
python3 -m unittest tests.test_codex_child_thread_contract.CodexChildThreadContractTests.test_worker_is_child_thread_owner -v
python3 -m unittest tests.test_codex_child_thread_contract.CodexChildThreadContractTests.test_legacy_module_worker_contract_is_removed -v
```

Expected: 两项 PASS。

- [ ] **Step 6: 提交 worker**

```bash
git add codex-market/plugins/ghost-agent-workflow/skills/thread-goal-worker
git commit -m "feat(workflow): 让模块子线程持有执行 goal"
```

---

### Task 5: 更新说明、发布版本、验证并重装插件

**Files:**
- Modify: `codex-market/plugins/ghost-agent-workflow/.codex-plugin/plugin.json`
- Modify: `codex-market/plugins/ghost-agent-workflow/README.md`
- Modify: `codex-market/README.md`
- Modify: `README.md`
- Verify: `tests/test_codex_child_thread_contract.py`
- Verify: 三份 Codex `SKILL.md` 和三份 `agents/openai.yaml`

**Interfaces:**
- Consumes: Tasks 2-4 的最终 v2 契约。
- Produces: 可安装的 `0.4.0+codex.<UTC timestamp>` 插件和从实际 cache 加载的三份新版 skill。

- [ ] **Step 1: 更新 README 和 manifest 基础版本**

README 补全四个 plugin skill，并把 Codex 并发执行说明改为 v2 用户可见 module 子线程。manifest 使用：

```json
{
  "version": "0.4.0",
  "description": "Codex skills for versioned parallel planning, profile-bound child thread coordination, scoped workers, and safe Git commits."
}
```

同步更新 keywords、shortDescription、longDescription 和 defaultPrompt，删除 implementation-subagent 文案。

- [ ] **Step 2: 生成单个 cachebuster**

```bash
python3 /Users/ghost233/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py codex-market/plugins/ghost-agent-workflow
```

Expected: manifest 版本从基础 `0.4.0` 变为 `0.4.0+codex.<UTC timestamp>`，且只有一个 `+codex.` 后缀。

- [ ] **Step 3: 运行完整契约测试并确认 GREEN**

```bash
python3 -m unittest tests/test_codex_child_thread_contract.py -v
```

Expected: 6 tests PASS。

- [ ] **Step 4: 运行三个 skill validator**

```bash
python3 /Users/ghost233/.codex/skills/.system/skill-creator/scripts/quick_validate.py codex-market/plugins/ghost-agent-workflow/skills/parallel-task-planner
python3 /Users/ghost233/.codex/skills/.system/skill-creator/scripts/quick_validate.py codex-market/plugins/ghost-agent-workflow/skills/thread-coordination
python3 /Users/ghost233/.codex/skills/.system/skill-creator/scripts/quick_validate.py codex-market/plugins/ghost-agent-workflow/skills/thread-goal-worker
```

Expected: 每次输出 `Skill is valid!`。

- [ ] **Step 5: 验证 plugin**

```bash
python3 /Users/ghost233/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py codex-market/plugins/ghost-agent-workflow
```

Expected: plugin validation passed。

- [ ] **Step 6: 运行静态残留和 diff 检查**

```bash
rg -n "implementation subagent|实现子代理|禁止创建用户可见 thread/task|set_thread_archived" codex-market/plugins/ghost-agent-workflow
git diff --check
```

Expected: `rg` 无匹配；`git diff --check` 无输出。

- [ ] **Step 7: 提交发布变更**

```bash
git add README.md codex-market tests
git commit -m "chore(plugin): 发布 workflow 0.4.0 子线程协调"
```

- [ ] **Step 8: 从已配置 marketplace 重装**

先运行：

```bash
codex plugin list
```

确认 `ghost-agent-workflow` 来自本地 `ghost-agent-market` 后运行：

```bash
codex plugin add ghost-agent-workflow@ghost-agent-market
```

Expected: 安装版本与 manifest 的 `0.4.0+codex.<UTC timestamp>` 一致。

- [ ] **Step 9: 复查实际缓存**

从 `~/.codex/plugins/cache/ghost-agent-market/ghost-agent-workflow/<installed-version>/skills/` 读取三份 `SKILL.md`，确认包含 `plan_format_version: 2`、`worker_runtime: codex_child_thread`、`create_thread`、`read_thread`、`send_message_to_thread`，且不存在 implementation-subagent worker 契约。

- [ ] **Step 10: 最终只读审查**

运行完整 unittest、三个 skill validator、plugin validator、`git status --short` 和 `git log -6 --oneline`。确认工作树干净、提交边界清晰、Claude Code 文件无变化，并提示用户必须在新 Codex 线程中加载新版 skill。
