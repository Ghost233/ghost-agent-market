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

    def test_workflow_is_thread_only_and_goal_is_optional(self) -> None:
        for platform in PLATFORMS:
            coordinator = self.skill(platform, "sub-thread-coordination")
            self.assertIn("唯一协调入口", coordinator)
            self.assertIn("禁止 subagent", coordinator)
            self.assertIn("standalone_thread", coordinator)
            if platform == "codex":
                self.assertIn("codex_native", coordinator)
            else:
                self.assertNotIn("codex_native", coordinator)
            self.assertIn("TASK_BINDING_V6", coordinator)
            self.assertIn("$sub-thread-goal-worker", coordinator)
            self.assertIn("$parallel-task-planner", coordinator)

    def test_main_discovery_is_simple_and_fail_closed(self) -> None:
        for platform in PLATFORMS:
            coordinator = self.skill(platform, "sub-thread-coordination")
            self.assertIn("[GA][任务][主控] <中文目标>", coordinator)
            self.assertIn("必须恰好一个", coordinator)
            self.assertIn("发现多个时立即停止", coordinator)

    def test_new_threads_rename_themselves_after_creation(self) -> None:
        for platform in PLATFORMS:
            coordinator = self.skill(platform, "sub-thread-coordination")
            self.assertIn("`create_thread` 不接受 `title` 或 `name`", coordinator)
            self.assertIn("若只返回 clientThreadId，则等待初始化完成", coordinator)
            self.assertIn("创建者通过 send_message_to_thread 通知新线程自己的 threadId", coordinator)
            self.assertIn("新线程立即调用 set_thread_title({ threadId, title })", coordinator)
            self.assertIn("设置成功后再登记、bind 和执行任务", coordinator)

    def test_registry_changes_use_domain_commands(self) -> None:
        for platform in PLATFORMS:
            combined = "\n".join((
                self.skill(platform, "sub-thread-coordination"),
                self.reference(platform, "sub-thread-coordination"),
            ))
            for command in (
                "thread-registry init",
                "thread-registry put-thread",
                "thread-registry set-status",
                "thread-registry put-watch",
                "thread-registry remove-watch",
            ):
                self.assertIn(command, combined)
            self.assertIn("模型不得创建或替换", combined)
            self.assertNotIn("通过 `json-write` 创建或 `--replace` 更新", combined)

    def test_contract_fields_are_minimal_and_script_derived(self) -> None:
        for platform in PLATFORMS:
            coordinator = self.skill(platform, "sub-thread-coordination")
            worker = self.skill(platform, "sub-thread-goal-worker")
            template = self.reference(platform, "sub-thread-goal-worker")
            self.assertIn("模型只提交最小语义输入", coordinator)
            self.assertIn("TASK_RESULT_INPUT_V2", worker)
            self.assertIn("不要构造 `WORKER_RESULT_V5`", worker)
            self.assertIn("runtime 自动补齐 identity", worker)
            for derived in (
                "generation", "thread id", "token", "attempt", "revision", "digest"
            ):
                self.assertIn(derived, template)

    def test_review_upgrade_uses_three_semantic_fields(self) -> None:
        for platform in PLATFORMS:
            combined = "\n".join((
                self.skill(platform, "sub-thread-coordination"),
                self.reference(platform, "sub-thread-coordination", "goal-contract.md"),
                self.skill(platform, "parallel-task-planner"),
                self.reference(platform, "parallel-task-planner"),
            ))
            self.assertIn("review_upgrade", combined)
            self.assertIn("review_upgrades[]", combined)
            self.assertIn("task + review_task + reason", combined)
            self.assertIn("自动升级策略和重连下游", combined)
            self.assertIn("Review 是显式", combined)

    def test_subgraph_request_is_script_generated(self) -> None:
        for platform in PLATFORMS:
            worker = self.skill(platform, "sub-thread-goal-worker")
            planner = self.skill(platform, "parallel-task-planner")
            self.assertIn("subgraph-request", worker)
            self.assertIn("不写 request JSON", worker)
            self.assertIn("T2-1", planner)
            self.assertIn("外层后继继续依赖父节点", planner)

    def test_legacy_semantic_contracts_use_short_script_inputs(self) -> None:
        for platform in PLATFORMS:
            combined = "\n".join((
                self.skill(platform, "sub-thread-coordination"),
                self.reference(platform, "sub-thread-coordination", "goal-contract.md"),
                self.skill(platform, "parallel-task-planner"),
                self.skill(platform, "sub-thread-goal-worker"),
                self.reference(platform, "parallel-task-planner"),
            ))
            for contract in (
                "GOAL_INPUT_V1", "PLAN_INPUT_V1", "DAG_DELTA_INPUT_V1",
                "TASK_SUBGRAPH_INPUT_V1", "TASK_RESULT_INPUT_V2",
            ):
                self.assertIn(contract, combined)
            for command in (
                "goal-create", "plan-create", "apply-delta", "expand-subgraph",
                "checkpoint-save", "runtime-execute",
            ):
                self.assertIn(command, combined)
            self.assertIn("不调用 `json-write`", combined)

    def test_owner_change_uses_script_and_pauses_one_goal(self) -> None:
        for platform in PLATFORMS:
            owner = self.reference(platform, "sub-thread-coordination", "owner-governance.md")
            for command in (
                "request-change", "validate-change", "approve-change", "apply-change"
            ):
                self.assertIn(command, owner)
            self.assertIn("暂停全部新 reserve", owner)
            self.assertIn("不要启动空模型回合累计 blocked", owner)
            self.assertIn("可以继续 Goal", owner)

    def test_supervisor_waits_by_script_and_setup_controls_profiles(self) -> None:
        for platform in PLATFORMS:
            coordinator = self.skill(platform, "sub-thread-coordination")
            setup = self.skill(platform, "setup-sub-thread-workflow")
            supervisor = self.skill(platform, "sub-thread-task-supervisor")
            for requirement in (
                "wait_threads",
                "supervisor-next",
                "supervisor-record",
                "gpt-5.6-luna/medium",
                "gpt-5.6-sol/high",
            ):
                self.assertIn(requirement, coordinator)
            for requirement in (
                "workflow-config.mjs init",
                "set-parallel",
                "set-profile",
                "THREAD_WORKFLOW_CONFIG_RECEIPT_V1",
                "supervisor",
            ):
                self.assertIn(requirement, setup)
            for forbidden in (
                "`plan.json`",
                "`state.json`",
                "`threads.json`",
                "Worker 聊天",
                "结果正文",
            ):
                self.assertIn(forbidden, supervisor)
            self.assertIn("--limit 8", supervisor)
            self.assertIn("timeout 为 60000 ms", supervisor)
            self.assertIn("脚本 stdout JSON 仅是机器收据", supervisor)
            self.assertIn("线程已结束，但尚未生成有效结果", supervisor)
            self.assertIn("[GA][任务][责任域] <中文任务>", coordinator)

    def test_progress_is_script_owned_and_main_does_not_print_dag(self) -> None:
        for platform in PLATFORMS:
            coordinator = self.skill(platform, "sub-thread-coordination")
            self.assertIn("自动维护 `progress.json`", coordinator)
            self.assertIn("events.jsonl", coordinator)
            self.assertIn("完整 DAG/Mermaid", coordinator)
            self.assertIn("task 最终结果", coordinator)

    def test_planner_reviewer_is_pre_activation_and_bounded(self) -> None:
        for platform in PLATFORMS:
            combined = "\n".join((
                self.skill(platform, "sub-thread-coordination"),
                self.skill(platform, "planner-reviewer"),
            ))
            for requirement in (
                "planner-review-context",
                "planner-review-submit",
                "plan-revise",
                "profiles.review",
                "不是 DAG 节点",
                "第二轮",
            ):
                self.assertIn(requirement, combined)

    def test_portable_skill_copies_are_synchronized(self) -> None:
        portable = (
            "parallel-task-planner/SKILL.md",
            "parallel-task-planner/references/templates.md",
            "planner-reviewer/SKILL.md",
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

    def test_setup_skill_body_is_synchronized_with_platform_frontmatter(self) -> None:
        bodies = {
            platform: self.skill(platform, "setup-sub-thread-workflow").split("---\n", 2)[2]
            for platform in PLATFORMS
        }
        self.assertEqual(bodies["claude"], bodies["codex"])
        self.assertEqual(bodies["kimi"], bodies["codex"])


if __name__ == "__main__":
    unittest.main()
