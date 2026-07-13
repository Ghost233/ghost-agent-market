from pathlib import Path
import json
import unittest


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "codex-market/plugins/ghost-agent-workflow"
AGENTS = ROOT / "AGENTS.md"


def read(path: str) -> str:
    return (PLUGIN / path).read_text(encoding="utf-8")


class CodexChildThreadContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.planner = read("skills/parallel-task-planner/SKILL.md")
        cls.planner_templates = read(
            "skills/parallel-task-planner/references/templates.md"
        )
        cls.coordinator = read("skills/thread-coordination/SKILL.md")
        cls.coordinator_templates = read(
            "skills/thread-coordination/references/templates.md"
        )
        cls.worker = read("skills/thread-goal-worker/SKILL.md")
        cls.worker_templates = read(
            "skills/thread-goal-worker/references/templates.md"
        )
        cls.planner_contract = f"{cls.planner}\n{cls.planner_templates}"
        cls.coordinator_contract = f"{cls.coordinator}\n{cls.coordinator_templates}"
        cls.worker_contract = f"{cls.worker}\n{cls.worker_templates}"
        cls.git_commit = read("skills/git-commit/SKILL.md")
        cls.readme = read("README.md")
        cls.metadata = "\n".join(
            read(path)
            for path in (
                "skills/parallel-task-planner/agents/openai.yaml",
                "skills/thread-coordination/agents/openai.yaml",
                "skills/thread-goal-worker/agents/openai.yaml",
                "skills/git-commit/agents/openai.yaml",
            )
        )

    def test_planner_emits_v3_task_dag_contract(self) -> None:
        self.assertIn("plan_format_version", self.planner_contract)
        self.assertIn(".ghost-agent-workflow/parallel_plan", self.planner)
        self.assertIn("thread-plan.mjs", self.planner)
        self.assertIn("DAG 节点", self.planner)
        self.assertIn("gpt-5.6-terra", self.planner)
        self.assertIn('"reasoning_effort": "medium"', self.planner_templates)
        self.assertIn("logical_id", self.planner_contract)
        self.assertIn("thread_role", self.planner_contract)
        self.assertIn("continuation", self.planner_contract)
        self.assertIn('"revision": 1', self.planner_templates)
        self.assertIn("永久 claim", self.planner)
        self.assertIn("reviewed_task_ids", self.planner_contract)
        self.assertIn("replacements", self.planner_contract)
        self.assertIn("闭包审查", self.planner)

    def test_planner_separates_modules_from_tasks(self) -> None:
        self.assertIn("`module`", self.planner)
        self.assertIn("不是 DAG 节点", self.planner)
        self.assertIn("`task` 是 DAG 节点", self.planner)
        self.assertIn("module_id", self.planner_contract)
        self.assertIn("project_verification", self.planner_contract)

    def test_coordinator_uses_thread_tools(self) -> None:
        for tool in (
            "list_projects",
            "create_thread",
            "read_thread",
            "send_message_to_thread",
            "set_thread_title",
        ):
            self.assertIn(tool, self.coordinator_contract)
        self.assertIn("environment: {type: local}", self.coordinator)
        self.assertIn("model", self.coordinator_contract)
        self.assertIn("thinking", self.coordinator_templates)
        self.assertIn("dispatch_key", self.coordinator_contract)
        self.assertIn("普通错误文本不得传给 `JSON.parse`", self.coordinator)
        self.assertIn("dispatch_failed", self.coordinator_contract)
        self.assertIn("reuse_existing_thread", self.coordinator)
        self.assertIn("[完成]", self.coordinator)
        self.assertIn("[复核]", self.coordinator)
        self.assertIn("状态：待命", self.coordinator_templates)
        self.assertIn("[GA][<用途>][<状态>]", self.coordinator)
        self.assertNotIn("pending blocked", self.coordinator)

    def test_worker_owns_one_active_task(self) -> None:
        self.assertIn("task_id", self.worker_contract)
        self.assertIn("module_id", self.worker_contract)
        self.assertIn("WORKER_RESULT_V3", self.worker_contract)
        self.assertIn("一个活动任务", self.worker)
        self.assertIn("独立目标", self.worker)
        self.assertIn("scope_request", self.worker_contract)
        self.assertIn("logical_id", self.worker_contract)
        self.assertIn("thread_role", self.worker_contract)
        self.assertIn("`review` 是严格只读任务", self.worker)

    def test_main_thread_owns_safe_plan_revisions(self) -> None:
        self.assertIn("完整父目标", self.coordinator)
        self.assertIn("## 内部修订", self.coordinator)
        self.assertIn("不要求用户逐次批准", self.coordinator)
        self.assertIn("不要求用户确认", self.planner)
        self.assertIn("纯串行图标记 `sequential_only`", self.planner)
        self.assertIn("不是用户确认请求", self.worker)
        self.assertIn("scope_exception", self.worker)
        self.assertIn("split_hints", self.worker_contract)
        self.assertIn("overlap_hints", self.worker_contract)
        self.assertIn("拆成不可比任务", self.planner)
        self.assertIn("共享前置任务", self.planner)
        self.assertIn("$parallel-task-planner", self.coordinator)

    def test_legacy_worker_terms_are_removed(self) -> None:
        combined = "\n".join(
            (
                self.planner_contract,
                self.coordinator_contract,
                self.worker_contract,
                self.metadata,
                self.readme,
            )
        )
        self.assertNotIn("subagent", combined.lower())
        self.assertNotIn("子代理", combined)
        self.assertNotIn("spawn_agent", combined)
        self.assertNotIn("fork_thread", combined)
        self.assertNotIn("禁止创建用户可见 thread/task", combined)
        self.assertNotIn("set_thread_archived", combined)
        self.assertNotIn("dispatch.batches", combined)
        self.assertNotIn("线程池", combined)
        self.assertNotIn("并发上限", combined)
        self.assertIn("v3 module/task DAG", self.readme)

    def test_metadata_describes_child_threads(self) -> None:
        self.assertIn("任务 DAG", self.metadata)
        self.assertIn("gpt-5.6-terra/medium", self.metadata)

    def test_git_commit_uses_spark_execution_thread(self) -> None:
        combined = "\n".join((self.git_commit, self.metadata))
        self.assertIn("gpt-5.3-codex-spark", combined)
        self.assertIn("thinking: high", self.git_commit)
        self.assertIn("GIT_COMMIT_EXECUTOR=1", self.git_commit)
        self.assertIn("不得传入 `reasoning.summary`", self.git_commit)
        self.assertIn("gpt-5.6-luna/xhigh fallback", self.git_commit)

    def test_git_commit_does_not_delegate_from_the_execution_thread(self) -> None:
        self.assertIn("当前线程就是唯一执行线程", self.git_commit)
        self.assertIn("不得调用 `create_thread`", self.git_commit)
        self.assertIn("不得自行 fallback", self.git_commit)

    def test_git_commit_preserves_state_across_write_failures_and_concurrent_edits(self) -> None:
        self.assertIn("所有 Git 写命令第一次执行时就必须主动提权", self.git_commit)
        self.assertIn("提权或前缀审批被拒绝时保留现场并报告", self.git_commit)
        self.assertIn("无法归因时在 stage 前停止并通知", self.git_commit)
        self.assertIn("提交后同一路径出现新修改时", self.git_commit)
        self.assertIn("不得自动 amend", self.git_commit)

    def test_codex_skills_do_not_reference_claude_runtime(self) -> None:
        for skill in (PLUGIN / "skills").rglob("SKILL.md"):
            self.assertNotIn("claude", skill.read_text(encoding="utf-8").lower(), skill)

    def test_agents_requires_decimal_plugin_version_increment(self) -> None:
        instructions = AGENTS.read_text(encoding="utf-8")
        self.assertIn("基础版本每次增加 `0.0.1`", instructions)
        self.assertIn("任一段达到 `10` 时向左进位", instructions)

    def test_manifest_targets_new_minor_version(self) -> None:
        manifest = json.loads(read(".codex-plugin/plugin.json"))
        self.assertTrue(manifest["version"].startswith("0.6.9+codex."))
        self.assertIn("子线程", manifest["description"])
        self.assertNotIn("subagent", json.dumps(manifest, ensure_ascii=False).lower())


if __name__ == "__main__":
    unittest.main()
