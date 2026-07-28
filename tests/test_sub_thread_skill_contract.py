from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
PLATFORMS = {
    "codex": ROOT / "codex-market/plugins/ghost-agent-workflow",
    "claude": ROOT / "claude-code-market",
    "kimi": ROOT / "kimi-market/plugins/ghost-agent-workflow",
}
ACTIVE_DAG_SKILLS = (
    "sub-thread-coordination",
    "parallel-task-planner",
    "planner-reviewer",
    "setup-sub-thread-workflow",
    "sub-thread-task-supervisor",
    "sub-thread-goal-worker",
)


class ThreadDagSkillContractTests(unittest.TestCase):
    def skill(self, platform: str, name: str) -> str:
        return (PLATFORMS[platform] / "skills" / name / "SKILL.md").read_text(
            encoding="utf-8"
        )

    def reference(self, platform: str, name: str, file: str = "templates.md") -> str:
        return (PLATFORMS[platform] / "skills" / name / "references" / file).read_text(
            encoding="utf-8"
        )

    def test_expected_platform_skills_remain(self) -> None:
        for platform, root in PLATFORMS.items():
            actual = {
                path.name
                for path in (root / "skills").iterdir()
                if path.is_dir() and (path / "SKILL.md").is_file()
            }
            expected = {"git-commit", "start-dag-dashboard", *ACTIVE_DAG_SKILLS}
            if platform == "codex":
                expected.add("git-commit-direct-model-test")
            self.assertEqual(actual, expected, platform)

    def test_main_uses_one_scripted_state_machine(self) -> None:
        for platform in PLATFORMS:
            coordinator = self.skill(platform, "sub-thread-coordination")
            for required in (
                "唯一协调入口",
                "禁止 subagent",
                "workflow start",
                "workflow step",
                "必须由用户明确选择",
                "supervisor_required",
                "$sub-thread-goal-worker",
                "$parallel-task-planner",
            ):
                self.assertIn(required, coordinator)
            self.assertIn("只供 runtime 和测试使用", coordinator)

    def test_mode_choice_is_required_and_quick_can_upgrade_one_way(self) -> None:
        for platform in PLATFORMS:
            coordinator = self.skill(platform, "sub-thread-coordination")
            contract = self.reference(platform, "sub-thread-coordination", "goal-contract.md")
            combined = f"{coordinator}\n{contract}"
            for required in (
                "用户未明确指定",
                "等待用户作出选择",
                "不得调用 `workflow start`",
                "Quick 不创建 Planner、Plan、Dashboard 或 Supervisor",
                "workflow dispatch",
                "workflow review",
                "worker request-dag",
                "不得从 DAG 降级回 Quick",
                "八个是上限，不是目标",
            ):
                self.assertIn(required, combined)

    def test_thread_creation_and_titles_are_host_owned(self) -> None:
        for platform in PLATFORMS:
            coordinator = self.skill(platform, "sub-thread-coordination")
            self.assertIn("等待正式 threadId", coordinator)
            self.assertIn("set_thread_title", coordinator)
            self.assertIn("不得给 `create_thread` 伪造 title/name", coordinator)
            self.assertIn("[GA][任务][主控|规划|子图规划|规划审查|责任域|实现审查|监督]", coordinator)

    def test_supervisor_uses_opaque_actions_only(self) -> None:
        for platform in PLATFORMS:
            supervisor = self.skill(platform, "sub-thread-task-supervisor")
            for required in (
                "supervisor-next",
                "supervisor-ack",
                "action id 是不透明值",
                "wait_threads",
                "--limit 8",
                "supervisor-resume",
                "supervisor-recover-run",
            ):
                self.assertIn(required, supervisor)
            self.assertIn("不得调用低层 `supervisor-record`", supervisor)
            self.assertIn("线程已结束，但尚未生成有效结果", supervisor)

    def test_worker_never_builds_result_json(self) -> None:
        for platform in PLATFORMS:
            worker = self.skill(platform, "sub-thread-goal-worker")
            reference = self.reference(platform, "sub-thread-goal-worker")
            combined = f"{worker}\n{reference}"
            for required in (
                "worker open",
                "worker verify",
                "worker complete",
                "worker block",
                "worker fail",
                "worker request-dag",
                "worker request-scope",
                "worker complete-risk",
            ):
                self.assertIn(required, combined)
            self.assertIn("构造 Binding/Result", reference)
            self.assertIn("禁止调用 `result-submit`", worker)

    def test_planner_is_the_only_structured_semantic_exception(self) -> None:
        for platform in PLATFORMS:
            planner = self.skill(platform, "parallel-task-planner")
            template = self.reference(platform, "parallel-task-planner")
            combined = f"{planner}\n{template}"
            self.assertIn("唯一仍可提交结构化语义输入", planner)
            self.assertIn("初始最小 Plan", template)
            self.assertIn("脚本自动加入", template)
            self.assertIn("禁止复制 canonical schema", template)
            self.assertIn("T2-1", planner)

    def test_review_and_subgraph_changes_are_explicit(self) -> None:
        for platform in PLATFORMS:
            combined = "\n".join((
                self.skill(platform, "sub-thread-coordination"),
                self.skill(platform, "parallel-task-planner"),
                self.skill(platform, "sub-thread-goal-worker"),
            ))
            self.assertIn("Review 是显式", combined)
            self.assertIn("review_upgrades", combined)
            self.assertIn("worker request-dag", combined)
            self.assertIn("外层后继继续依赖父节点", combined)

    def test_owner_changes_use_current_facade(self) -> None:
        for platform in PLATFORMS:
            owner = self.reference(platform, "sub-thread-coordination", "owner-governance.md")
            for command in (
                "propose",
                "current",
                "approve-current",
                "apply-current",
                "clear-current",
                "自动暂停",
            ):
                self.assertIn(command, owner)
            self.assertIn("用户明确批准", owner)
            self.assertIn("不保存 task/result/evidence history", owner)

    def test_setup_controls_four_profiles_and_parallel(self) -> None:
        for platform in PLATFORMS:
            setup = self.skill(platform, "setup-sub-thread-workflow")
            for required in (
                "workflow-config.mjs ensure",
                "set-parallel",
                "set-profile",
                "parallel: 8",
                "gpt-5.6-sol/high",
                "gpt-5.6-luna/medium",
                ".ghost-agent-workflow/.gitignore",
            ):
                self.assertIn(required, setup)

    def test_only_final_result_and_dag_log_survive(self) -> None:
        for platform in PLATFORMS:
            coordinator = self.skill(platform, "sub-thread-coordination")
            contract = self.reference(platform, "sub-thread-coordination", "goal-contract.md")
            recovery = self.reference(platform, "sub-thread-coordination")
            combined = f"{coordinator}\n{contract}\n{recovery}"
            self.assertIn("唯一历史 `events.jsonl`", combined)
            self.assertIn("`result.json`", combined)
            self.assertIn("成功验收后立即删除当前临时文件", combined)
            self.assertIn("禁止 attempt、Review、evidence、recovery 和聊天 history", combined)

    def test_planner_reviewer_uses_fixed_enum(self) -> None:
        for platform in PLATFORMS:
            reviewer = self.skill(platform, "planner-reviewer")
            self.assertIn("planner-review <goal-dir> pass", reviewer)
            self.assertIn("parallelism|too-complex|too-simple", reviewer)
            self.assertIn("不构造 Review JSON", reviewer)

    def test_portable_skill_copies_are_synchronized(self) -> None:
        portable = (
            "parallel-task-planner/SKILL.md",
            "parallel-task-planner/references/templates.md",
            "planner-reviewer/SKILL.md",
            "setup-sub-thread-workflow/SKILL.md",
            "sub-thread-goal-worker/SKILL.md",
            "sub-thread-goal-worker/references/templates.md",
            "sub-thread-task-supervisor/SKILL.md",
            "sub-thread-coordination/references/templates.md",
            "sub-thread-coordination/references/owner-governance.md",
        )
        codex_root = PLATFORMS["codex"] / "skills"
        for relative in portable:
            expected = (codex_root / relative).read_text(encoding="utf-8")
            for platform in ("claude", "kimi"):
                actual = (PLATFORMS[platform] / "skills" / relative).read_text(encoding="utf-8")
                self.assertEqual(actual, expected, f"{platform}:{relative}")


if __name__ == "__main__":
    unittest.main()
