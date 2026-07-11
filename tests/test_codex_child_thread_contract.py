from pathlib import Path
import json
import unittest


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "codex-market/plugins/ghost-agent-workflow"
AGENTS = ROOT / "AGENTS.md"
GIT_COMMIT_AGENT = ROOT / ".codex/agents/git-commit-worker.toml"


def read(path: str) -> str:
    return (PLUGIN / path).read_text(encoding="utf-8")


class CodexChildThreadContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.planner = read("skills/parallel-task-planner/SKILL.md")
        cls.coordinator = read("skills/thread-coordination/SKILL.md")
        cls.worker = read("skills/thread-goal-worker/SKILL.md")
        cls.git_commit = read("skills/git-commit/SKILL.md")
        cls.git_commit_agent = GIT_COMMIT_AGENT.read_text(encoding="utf-8") if GIT_COMMIT_AGENT.exists() else ""
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
        self.assertIn("plan_format_version", self.planner)
        self.assertIn(".ghost-agent-workflow/parallel_plan", self.planner)
        self.assertIn("thread-plan.mjs", self.planner)
        self.assertIn("DAG 节点", self.planner)
        self.assertIn("gpt-5.6-terra", self.planner)
        self.assertIn("reasoning_effort: xhigh", self.planner)

    def test_planner_separates_modules_from_tasks(self) -> None:
        self.assertIn("module 不是 DAG 节点", self.planner)
        self.assertIn("task", self.planner)
        self.assertIn("module_id", self.planner)
        self.assertIn("project_verification", self.planner)

    def test_coordinator_uses_thread_tools(self) -> None:
        for tool in (
            "list_projects",
            "create_thread",
            "read_thread",
            "send_message_to_thread",
        ):
            self.assertIn(tool, self.coordinator)
        self.assertIn("environment: {type: local}", self.coordinator)
        self.assertIn("model", self.coordinator)
        self.assertIn("thinking", self.coordinator)

    def test_worker_owns_one_active_task(self) -> None:
        self.assertIn("task_id", self.worker)
        self.assertIn("module_id", self.worker)
        self.assertIn("WORKER_RESULT_V3", self.worker)
        self.assertIn("一个 active task", self.worker)
        self.assertIn("独立 goal", self.worker)

    def test_legacy_worker_terms_are_removed(self) -> None:
        combined = "\n".join(
            (self.planner, self.coordinator, self.worker, self.metadata)
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

    def test_metadata_describes_child_threads(self) -> None:
        self.assertIn("task DAG", self.metadata)
        self.assertIn("gpt-5.6-terra/xhigh", self.metadata)

    def test_git_commit_uses_spark_readonly_worker(self) -> None:
        combined = "\n".join((self.git_commit, self.metadata))
        self.assertIn("gpt-5.3-codex-spark", combined)
        self.assertIn("reasoning_effort=high", self.git_commit)
        self.assertIn("不传 reasoning summary", self.metadata)
        self.assertIn("不要回退到其他模型", self.git_commit)

    def test_git_commit_binds_named_custom_agent(self) -> None:
        self.assertIn("git_commit_worker", self.git_commit)
        self.assertIn("model = \"gpt-5.3-codex-spark\"", self.git_commit_agent)
        self.assertIn("model_reasoning_effort = ", self.git_commit_agent)
        self.assertIn("sandbox_mode = \"read-only\"", self.git_commit_agent)

    def test_codex_skills_do_not_reference_claude_runtime(self) -> None:
        for skill in (PLUGIN / "skills").rglob("SKILL.md"):
            self.assertNotIn("claude", skill.read_text(encoding="utf-8").lower(), skill)

    def test_agents_requires_decimal_plugin_version_increment(self) -> None:
        instructions = AGENTS.read_text(encoding="utf-8")
        self.assertIn("基础版本每次增加 `0.0.1`", instructions)
        self.assertIn("任一段达到 `10` 时向左进位", instructions)

    def test_manifest_targets_new_minor_version(self) -> None:
        manifest = json.loads(read(".codex-plugin/plugin.json"))
        self.assertTrue(manifest["version"].startswith("0.4.6+codex."))
        self.assertIn("child thread", manifest["description"].lower())
        self.assertNotIn("subagent", json.dumps(manifest, ensure_ascii=False).lower())


if __name__ == "__main__":
    unittest.main()
