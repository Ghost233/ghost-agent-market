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
            self.assertIn("profile_validation: syntax_only", coordinator)
            self.assertIn("dispatch_failed", coordinator)
            self.assertIn("task 保持 `pending`", coordinator)
            self.assertIn("保留 `running/thread_id`", coordinator)
            self.assertIn("自动重试一次", coordinator)
            self.assertIn("不得要求用户批准重试", coordinator)

    def test_parent_goal_authorization_covers_internal_replanning(self) -> None:
        for planner in (
            self.codex_skills["parallel-task-planner"],
            self.claude_skills["parallel-task-planner"],
        ):
            self.assertIn("用户授权以 `parent_goal` 为单位", planner)
            self.assertIn("受控基线", planner)
            self.assertIn("不要求用户再次确认", planner)
            self.assertIn("拆成多个不可比 task", planner)
            self.assertIn("新的共享前置 task", planner)

        for coordinator in (
            self.codex_skills["thread-coordination"],
            self.claude_skills["thread-coordination"],
        ):
            self.assertIn("用户授权的是完整 `parent_goal`", coordinator)
            self.assertIn("不得向用户请求确认", coordinator)
            self.assertIn("自动生成新的唯一 v3 plan", coordinator)
            self.assertIn("修正版可为 `parallel_safe` 或 `sequential_only`", coordinator)
            self.assertIn("作为受控基线", coordinator)
            self.assertIn("至少两个写域不交叉", coordinator)
            self.assertIn("新的共享前置 task", coordinator)
            self.assertIn("所有消费者依赖新节点", coordinator)
            self.assertIn("必须恰好归属一个新 task", coordinator)
            self.assertIn("不延迟任何不可比 task", coordinator)
            self.assertIn(
                "不得在 revision 之间返回最终 `PARALLEL_PLAN_RESULT`",
                coordinator,
            )

        for worker in (
            self.codex_skills["thread-goal-worker"],
            self.claude_skills["thread-goal-worker"],
        ):
            self.assertIn("scope_request", worker)
            self.assertIn("scope_exception", worker)
            self.assertIn("split_hints", worker)
            self.assertIn("overlap_hints", worker)
            self.assertIn("不自动撤销", worker)
            self.assertIn("不是用户确认请求", worker)

    def test_all_thread_skills_remove_batch_and_capacity_terms(self) -> None:
        for legacy in (
            "dispatch.batches",
            "batch barrier",
            "线程池",
            "并发上限",
            "plan_format_version: 2",
            "plan_format_version: 1",
            "需要扩大 scope 时停止",
        ):
            self.assertNotIn(legacy, self.all_skills)

    def test_published_driver_differs_only_by_execution_platform(self) -> None:
        codex_script = CODEX / "scripts/thread-plan.mjs"
        claude_script = CLAUDE / "scripts/thread-plan.mjs"
        codex_source = codex_script.read_text(encoding="utf-8").replace(
            'const expectedExecutionPlatform = "codex";',
            'const expectedExecutionPlatform = "<platform>";',
        )
        claude_source = claude_script.read_text(encoding="utf-8").replace(
            'const expectedExecutionPlatform = "claude_code";',
            'const expectedExecutionPlatform = "<platform>";',
        )
        self.assertEqual(codex_source, claude_source)

    def test_platform_default_profiles_remain_distinct(self) -> None:
        self.assertIn(
            "gpt-5.6-terra/medium",
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
