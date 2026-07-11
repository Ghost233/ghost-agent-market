from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CODEX = ROOT / "codex-market/plugins/ghost-agent-workflow"
CLAUDE = ROOT / "claude-code-market"
THREAD_SKILLS = (
    "parallel-task-planner",
    "thread-coordination",
    "thread-goal-worker",
)


def read_skill(root: Path, name: str) -> str:
    return (root / "skills" / name / "SKILL.md").read_text(encoding="utf-8")


def read_metadata(root: Path, name: str) -> str:
    return (root / "skills" / name / "agents/openai.yaml").read_text(encoding="utf-8")


class ParallelTaskSkillContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.codex_skills = {name: read_skill(CODEX, name) for name in THREAD_SKILLS}
        cls.claude_skills = {name: read_skill(CLAUDE, name) for name in THREAD_SKILLS}
        cls.all_skills = "\n".join(
            [*cls.codex_skills.values(), *cls.claude_skills.values()]
        )
        cls.all_metadata = "\n".join(
            [
                *(read_metadata(CODEX, name) for name in THREAD_SKILLS),
                *(read_metadata(CLAUDE, name) for name in THREAD_SKILLS),
            ]
        )

    def test_both_planners_define_task_as_the_dag_node(self) -> None:
        for planner in (
            self.codex_skills["parallel-task-planner"],
            self.claude_skills["parallel-task-planner"],
        ):
            self.assertIn("module 不是 DAG 节点", planner)
            self.assertIn("task 是 DAG 节点", planner)
            self.assertIn("module_id", planner)
            self.assertIn(".ghost-agent-workflow/parallel_plan", planner)

    def test_both_coordinators_use_the_three_command_driver(self) -> None:
        for coordinator in (
            self.codex_skills["thread-coordination"],
            self.claude_skills["thread-coordination"],
        ):
            self.assertIn("thread-plan.mjs validate", coordinator)
            self.assertIn("thread-plan.mjs next", coordinator)
            self.assertIn("thread-plan.mjs update", coordinator)
            self.assertIn("WORKER_RESULT_V3", coordinator)

    def test_all_thread_skills_remove_batch_and_capacity_terms(self) -> None:
        for legacy in (
            "dispatch.batches",
            "batch barrier",
            "线程池",
            "并发上限",
            "plan_format_version: 2",
            "plan_format_version: 1",
        ):
            self.assertNotIn(legacy, self.all_skills)

    def test_published_driver_is_identical_on_both_platforms(self) -> None:
        codex_script = CODEX / "scripts/thread-plan.mjs"
        claude_script = CLAUDE / "scripts/thread-plan.mjs"
        self.assertEqual(codex_script.read_bytes(), claude_script.read_bytes())

    def test_platform_default_profiles_remain_distinct(self) -> None:
        self.assertIn(
            "gpt-5.6-terra/xhigh",
            self.codex_skills["parallel-task-planner"],
        )
        self.assertIn(
            "sonnet/max",
            self.claude_skills["parallel-task-planner"],
        )

    def test_metadata_describes_v3_task_dag(self) -> None:
        self.assertIn("v3", self.all_metadata)
        self.assertIn("task DAG", self.all_metadata)
        self.assertNotIn("拓扑 batch", self.all_metadata)


if __name__ == "__main__":
    unittest.main()
