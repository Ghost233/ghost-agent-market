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
        cls.coordinator = read("skills/thread-coordination/SKILL.md")
        cls.worker = read("skills/thread-goal-worker/SKILL.md")
        cls.git_commit = read("skills/git-commit/SKILL.md")
        cls.metadata = "\n".join(
            read(path)
            for path in (
                "skills/parallel-task-planner/agents/openai.yaml",
                "skills/thread-coordination/agents/openai.yaml",
                "skills/thread-goal-worker/agents/openai.yaml",
                "skills/git-commit/agents/openai.yaml",
            )
        )

    def test_planner_emits_v2_child_thread_runtime(self) -> None:
        self.assertIn("plan_format_version: 2", self.planner)
        self.assertIn("worker_runtime: codex_child_thread", self.planner)
        self.assertIn("gpt-5.6-terra", self.planner)
        self.assertIn("reasoning_effort: xhigh", self.planner)

    def test_planner_only_gates_child_threads_on_create_thread_contract(self) -> None:
        self.assertIn(
            "不得检查与模块子线程无关的调度接口",
            self.planner,
        )
        self.assertIn("非 `create_thread` 接口不能作为 profile、安全或并发门禁证据", self.planner)
        self.assertIn(
            "默认 `gpt-5.6-terra/xhigh` 始终是有效的 plan-authored profile",
            self.planner,
        )
        self.assertIn(
            "profile 的实际应用只由 `$thread-coordination` 通过 `create_thread` 负责",
            self.planner,
        )

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

    def test_worker_is_child_thread_owner(self) -> None:
        self.assertIn("模块子线程", self.worker)
        self.assertIn("主线程只识别通过 `create_thread` 创建并绑定的模块子线程", self.worker)
        self.assertIn("child_thread", self.worker)
        self.assertIn("goal_set_evidence", self.worker)

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

    def test_metadata_describes_child_threads(self) -> None:
        self.assertIn("子线程", self.metadata)
        self.assertIn("gpt-5.6-terra/xhigh", self.metadata)

    def test_git_commit_uses_spark_readonly_worker(self) -> None:
        combined = "\n".join((self.git_commit, self.metadata))
        self.assertIn("gpt-5.3-codex-spark", combined)
        self.assertIn("reasoning_effort=high", self.git_commit)
        self.assertIn("不要传 reasoning summary", self.metadata)
        self.assertIn("不要回退到其他模型", self.git_commit)

    def test_codex_skills_do_not_reference_claude_runtime(self) -> None:
        for skill in (PLUGIN / "skills").rglob("SKILL.md"):
            self.assertNotIn("claude", skill.read_text(encoding="utf-8").lower(), skill)

    def test_agents_requires_decimal_plugin_version_increment(self) -> None:
        instructions = AGENTS.read_text(encoding="utf-8")
        self.assertIn("基础版本每次增加 `0.0.1`", instructions)
        self.assertIn("任一段达到 `10` 时向左进位", instructions)

    def test_manifest_targets_new_minor_version(self) -> None:
        manifest = json.loads(read(".codex-plugin/plugin.json"))
        self.assertTrue(manifest["version"].startswith("0.4.4+codex."))
        self.assertIn("child thread", manifest["description"].lower())
        self.assertNotIn("subagent", json.dumps(manifest, ensure_ascii=False).lower())


if __name__ == "__main__":
    unittest.main()
