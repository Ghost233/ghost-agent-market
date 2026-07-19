import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "codex-market/plugins/ghost-agent-workflow"
LOCAL_GIT_COMMIT = ROOT / ".codex/skills/git-commit"
GIT_COMMIT_WORKER = ROOT / ".codex/agents/git-commit-worker.toml"
AGENTS = ROOT / "AGENTS.md"


def read(relative: str) -> str:
    return (PLUGIN / relative).read_text(encoding="utf-8")


class CodexWorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.coordinator = read("skills/subagent-coordination/SKILL.md")
        cls.coordinator_reference = read(
            "skills/subagent-coordination/references/templates.md"
        )
        cls.goal_contract = read(
            "skills/subagent-coordination/references/goal-contract.md"
        )
        cls.coordinator_metadata = read(
            "skills/subagent-coordination/agents/openai.yaml"
        )
        cls.planner = read("skills/parallel-task-planner/SKILL.md")
        cls.worker = read("skills/subagent-goal-worker/SKILL.md")
        cls.worker_reference = read("skills/subagent-goal-worker/references/templates.md")
        cls.git_commit = read("skills/git-commit/SKILL.md")
        cls.git_commit_metadata = read("skills/git-commit/agents/openai.yaml")
        cls.git_commit_worker = GIT_COMMIT_WORKER.read_text(encoding="utf-8")

    def test_codex_subagent_entrypoint_uses_direct_fixed_profile(self) -> None:
        combined = f"{self.coordinator}\n{self.coordinator_metadata}"
        for tool in (
            "spawn_agent",
            "followup_task",
            "interrupt_agent",
            "wait_agent",
        ):
            self.assertIn(tool, self.coordinator)
        self.assertIn('model: "gpt-5.6-sol"', self.coordinator)
        self.assertIn('reasoning_effort: "medium"', self.coordinator)
        self.assertIn('fork_turns: "none"', self.coordinator)
        self.assertIn('agent_type: "worker"', self.coordinator)
        self.assertIn("executor_spawn_name", self.coordinator)
        self.assertIn("TASK_BINDING_V4", self.coordinator)
        self.assertNotIn("SUBAGENT_BOOTSTRAP_V1", self.coordinator)
        self.assertNotIn("SUBAGENT_READY_V1", self.coordinator)
        self.assertIn("default_prompt:", self.coordinator_metadata)
        self.assertIn("allow_implicit_invocation: false", self.coordinator_metadata)
        self.assertIn("/goal 每轮使用 $subagent-coordination", combined)

    def test_owner_affinity_is_soft_and_fenced(self) -> None:
        combined = "\n".join(
            (
                self.coordinator,
                self.coordinator_reference,
                self.planner,
                self.worker,
                self.worker_reference,
            )
        )
        for invariant in (
            "Owner Capsule",
            "Owner affinity",
            "generation",
            "reservation",
            "rotate-owner",
            "不同 Goal 不复用",
            "会话记忆和复用只是性能优化",
            "不表示永久 Agent",
        ):
            self.assertIn(invariant, combined)

    def test_worker_checkpoints_and_returns_v4_result(self) -> None:
        combined = f"{self.worker}\n{self.worker_reference}"
        for contract in ("TASK_BINDING_V4", "OWNER_CHECKPOINT_V1", "WORKER_RESULT_V4"):
            self.assertIn(contract, combined)
        for field in (
            "owner_capsule_ref",
            "result_path",
            "source_revision",
            "plan_item_ids",
            "coverage.{ref,digest,semantic_digest}",
            "evidence_artifact_paths",
            "artifact_digest",
        ):
            self.assertIn(field, combined)
        self.assertIn("原子写入", combined)
        self.assertIn("不得修改 goal/coverage/plan/state/capsule", self.worker)
        self.assertIn('"executor_mode": "subagent"', self.worker_reference)

    def test_codex_native_goal_bridge_follows_local_finalize(self) -> None:
        combined = f"{self.coordinator}\n{self.goal_contract}"
        self.assertIn("当前 Codex 原生 Goal", self.coordinator)
        self.assertIn("首先调用 `get_goal`", self.coordinator)
        self.assertIn("不要调用 `create_goal`", self.coordinator)
        bridge = self.coordinator[self.coordinator.index("## 原生完成桥接") :]
        self.assertRegex(
            bridge,
            re.compile(
                r"`finalize`.*?`get_goal`.*?`update_goal\(\{status: \"complete\"\}\)`"
                r".*?`get_goal`.*?native-confirm",
                re.DOTALL,
            ),
        )
        self.assertIn("native_completion_pending", bridge)
        self.assertIn("mutable source/worktree", bridge)
        self.assertNotIn('update_goal({status: "blocked"})', bridge)
        for identity_field in ("thread_id", "created_at", "objective_digest"):
            self.assertIn(identity_field, self.goal_contract)

    def test_recovery_uses_canonical_binding_and_fences_stale_executors(self) -> None:
        combined = f"{self.coordinator}\n{self.coordinator_reference}"
        self.assertIn("reserved_unbound + spawn_executor", combined)
        self.assertIn("reserved_unbound + reuse_executor", combined)
        self.assertIn("running_bound", self.coordinator_reference)
        self.assertIn("canonical recovery binding", self.coordinator_reference)
        self.assertIn("以当前 token `reclaim`", self.coordinator)
        self.assertIn("同一逻辑 Owner/generation", self.coordinator)
        self.assertIn("confirm-stale-executor", self.coordinator)
        self.assertIn("stop-pending stale executor", self.coordinator)

    def test_expected_skill_directories_are_present(self) -> None:
        actual_skills = {
            path.name
            for path in (PLUGIN / "skills").iterdir()
            if path.is_dir() and (path / "SKILL.md").is_file()
        }
        self.assertEqual(
            actual_skills,
            {
                "git-commit",
                "parallel-task-planner",
                "subagent-coordination",
                "subagent-goal-worker",
            },
        )

    def test_git_commit_uses_readonly_worker_then_main_task_commits(self) -> None:
        combined = f"{self.git_commit}\n{self.git_commit_metadata}"
        self.assertIn('agent_type: "git_commit_worker"', combined)
        self.assertIn('fork_turns: "none"', self.git_commit)
        self.assertIn("GIT_COMMIT_ANALYSIS_V1", self.git_commit)
        self.assertIn("wait_agent", self.git_commit)
        self.assertIn("主线程是唯一 Git 写入者", self.git_commit)
        self.assertIn("不得让子代理暂存、提交、修改文件", self.git_commit)
        self.assertIn("git_commit_worker:gpt-5.3-codex-spark/high", combined)
        self.assertIn('model: "gpt-5.6-luna"', self.git_commit)
        self.assertIn('thinking: "medium"', self.git_commit)
        self.assertIn("create_thread:gpt-5.6-luna/medium fallback", self.git_commit)
        self.assertIn("主线程复核", self.git_commit)

    def test_git_commit_worker_returns_primary_contract(self) -> None:
        self.assertIn('model = "gpt-5.3-codex-spark"', self.git_commit_worker)
        self.assertIn('model_reasoning_effort = "high"', self.git_commit_worker)
        self.assertIn("GIT_COMMIT_ANALYSIS_V1 JSON 对象", self.git_commit_worker)
        self.assertIn("profile_evidence 必须精确等于", self.git_commit_worker)
        self.assertNotIn("gpt-5.6-luna", self.git_commit_worker)

    def test_project_git_commit_copy_matches_marketplace_source(self) -> None:
        self.assertEqual(
            (LOCAL_GIT_COMMIT / "SKILL.md").read_text(encoding="utf-8"),
            self.git_commit,
        )
        self.assertEqual(
            (LOCAL_GIT_COMMIT / "agents/openai.yaml").read_text(encoding="utf-8"),
            self.git_commit_metadata,
        )

    def test_manifest_and_repository_rules_are_current(self) -> None:
        manifest = json.loads(read(".codex-plugin/plugin.json"))
        self.assertRegex(manifest["version"], r"^0\.8\.\d+\+codex\.")
        self.assertIn("/goal", manifest["description"])
        self.assertIn("v4", manifest["description"])
        prompt = manifest["interface"]["defaultPrompt"][0]
        self.assertIn("/goal 每轮使用 $subagent-coordination", prompt)
        self.assertIn("覆盖率 100%", prompt)
        instructions = AGENTS.read_text(encoding="utf-8")
        self.assertIn("基础版本每次增加", instructions)
        self.assertIn("任一段达到", instructions)


if __name__ == "__main__":
    unittest.main()
