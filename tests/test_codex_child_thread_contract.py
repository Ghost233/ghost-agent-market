import json
from pathlib import Path
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
        cls.goal = read("skills/goal-dag-runner/SKILL.md")
        cls.planner = read("skills/parallel-task-planner/SKILL.md")
        cls.thread = read("skills/thread-coordination/SKILL.md")
        cls.subagent = read("skills/subagent-coordination/SKILL.md")
        cls.thread_worker = read("skills/thread-goal-worker/SKILL.md")
        cls.subagent_worker = read("skills/subagent-goal-worker/SKILL.md")
        cls.git_commit = read("skills/git-commit/SKILL.md")
        cls.git_commit_metadata = read("skills/git-commit/agents/openai.yaml")
        cls.git_commit_worker = GIT_COMMIT_WORKER.read_text(encoding="utf-8")

    def test_codex_subagent_mode_is_direct_and_fixed_profile(self) -> None:
        self.assertIn("spawn_agent", self.subagent)
        self.assertIn("followup_task", self.subagent)
        self.assertIn("interrupt_agent", self.subagent)
        self.assertIn("wait_agent", self.subagent)
        self.assertIn('model: "gpt-5.6-sol"', self.subagent)
        self.assertIn('reasoning_effort: "medium"', self.subagent)
        self.assertIn('fork_turns: "none"', self.subagent)
        self.assertIn('agent_type: "worker"', self.subagent)
        self.assertIn("executor_spawn_name", self.subagent)
        self.assertIn("TASK_BINDING_V4", self.subagent)
        self.assertIn("启动握手", self.subagent)
        self.assertNotIn("SUBAGENT_BOOTSTRAP_V1", self.subagent)
        self.assertNotIn("SUBAGENT_READY_V1", self.subagent)

    def test_codex_thread_mode_uses_visible_thread_tools_and_fixed_profile(self) -> None:
        for tool in (
            "list_projects",
            "list_threads",
            "send_message_to_thread",
            "wait_threads",
        ):
            self.assertIn(tool, self.thread)
        self.assertIn("gpt-5.6-sol/medium", self.thread)
        self.assertIn("不自动归档", self.thread)
        self.assertIn("[GA][用途][状态]", self.thread)

    def test_owner_reuse_is_soft_and_fenced(self) -> None:
        combined = "\n".join(
            (self.goal, self.planner, self.thread, self.subagent, self.thread_worker, self.subagent_worker)
        )
        self.assertIn("Owner Capsule", combined)
        self.assertIn("Owner affinity", combined)
        self.assertIn("generation", combined)
        self.assertIn("reservation", combined)
        self.assertIn("rotate-owner", combined)
        self.assertIn("不同 Goal 不复用", combined)
        self.assertIn("会话记忆和复用只是性能优化", combined)
        self.assertIn("不表示永久 Agent", combined)

    def test_workers_checkpoint_and_return_v4_result(self) -> None:
        for worker in (self.thread_worker, self.subagent_worker):
            name = "thread-goal-worker" if worker == self.thread_worker else "subagent-goal-worker"
            reference = read(f"skills/{name}/references/templates.md")
            combined = f"{worker}\n{reference}"
            self.assertIn("OWNER_CHECKPOINT_V1", combined)
            self.assertIn("WORKER_RESULT_V4", combined)
            self.assertIn("owner_capsule_ref", combined)
            self.assertIn("result_path", combined)
            self.assertIn("原子写入", combined)
            self.assertIn("不得修改 goal/coverage/plan/state/capsule", worker)
            self.assertIn("capsule.json", worker)
            self.assertIn("source_revision", combined)
            self.assertIn("plan_item_ids", combined)
            self.assertIn("verification requirement descriptions", worker)
            self.assertIn("coverage.{ref,digest,semantic_digest}", worker)
            self.assertIn("evidence_artifact_paths", worker)
            self.assertIn("artifact_digest", worker)

    def test_codex_runner_bridges_native_goal_after_local_finalize(self) -> None:
        self.assertIn("当前 Codex 原生 Goal 的 objective 显式包含 $goal-dag-runner", self.goal)
        self.assertIn("首先调用 `get_goal`", self.goal)
        self.assertNotIn("create_goal", self.goal)
        bridge = self.goal[self.goal.index("## 原生完成桥接") :]
        self.assertLess(bridge.index("goal-dag.mjs finalize"), bridge.index("update_goal"))
        self.assertLess(bridge.index("update_goal"), bridge.index("goal-dag.mjs native-confirm"))
        self.assertIn("native_completion_pending", bridge)
        self.assertIn("不能重新 status/reconcile/finalize", bridge)
        self.assertIn("mutable source/worktree", bridge)
        self.assertNotIn('update_goal({status: "blocked"})', bridge)

    def test_recovery_uses_narrow_reserved_reuse_reclaim_and_fences_stale_executors(self) -> None:
        for coordinator in (self.thread, self.subagent):
            self.assertIn("`reserved_unbound + spawn_executor`", coordinator)
            self.assertIn("`reserved_unbound + reuse_executor` 的 bound 目标确认丢失是窄例外", coordinator)
            self.assertIn("以当前 token `reclaim`", coordinator)
            self.assertIn("同一逻辑 Owner/generation", coordinator)
            self.assertIn("confirm-stale-executor", coordinator)
            self.assertIn("stop-pending stale executor", coordinator)

    def test_thread_worker_reference_uses_thread_executor_mode(self) -> None:
        reference = read("skills/thread-goal-worker/references/templates.md")
        binding = reference[reference.index("## TASK_BINDING_V4") : reference.index("## OWNER_CHECKPOINT_V1")]
        self.assertIn('"executor_mode": "thread"', binding)
        self.assertNotIn('"executor_mode": "subagent"', binding)

    def test_git_commit_uses_readonly_worker_then_main_thread_commits(self) -> None:
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
        self.assertIn("不是并行分析、第二意见或一般错误兜底", self.git_commit)
        self.assertIn("Spark profile 当前不可创建或不可运行", self.git_commit)
        self.assertIn("都不得触发 fallback", self.git_commit)
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
        self.assertIn("/goal 每轮使用 $goal-dag-runner", prompt)
        self.assertIn("覆盖率 100%", prompt)
        instructions = AGENTS.read_text(encoding="utf-8")
        self.assertIn("基础版本每次增加", instructions)
        self.assertIn("任一段达到", instructions)


if __name__ == "__main__":
    unittest.main()
