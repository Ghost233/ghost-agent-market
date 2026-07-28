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
    "sub-thread-goal-worker",
    "sub-thread-task-supervisor",
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
            self.assertIn("禁止使用 subagent", coordinator)
            self.assertIn("standalone_thread", coordinator)
            self.assertIn("codex_native", coordinator)
            self.assertIn("TASK_BINDING_V6", coordinator)
            self.assertIn("$sub-thread-goal-worker", coordinator)
            self.assertIn("$parallel-task-planner", coordinator)

    def test_main_discovery_is_simple_and_fail_closed(self) -> None:
        for platform in PLATFORMS:
            coordinator = self.skill(platform, "sub-thread-coordination")
            self.assertIn("[GA][TASK][MAIN] <goal_id>", coordinator)
            self.assertIn("必须恰好一个", coordinator)
            self.assertIn("不使用 nonce", coordinator)
            self.assertIn("零个或多个立即停止", coordinator)

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
            self.assertIn("模型只提供业务判断和最小语义输入", coordinator)
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
                "checkpoint-save", "source-audit-auto",
            ):
                self.assertIn(command, combined)
            self.assertIn("正常流程禁止 `json-write`", combined)

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

    def test_supervisor_is_wait_only_and_reports_stalls(self) -> None:
        for platform in PLATFORMS:
            supervisor = self.skill(platform, "sub-thread-task-supervisor")
            for requirement in (
                "gpt-5.6-luna/low",
                "wait_threads",
                "send_message_to_thread",
                "禁止 `read_thread`",
                "TASK_END",
                "TASK_STALLED",
                "连续三次",
                "不得自行废弃、关闭或重启线程",
            ):
                self.assertIn(requirement, supervisor)

    def test_progress_is_script_owned_and_main_does_not_print_dag(self) -> None:
        for platform in PLATFORMS:
            coordinator = self.skill(platform, "sub-thread-coordination")
            self.assertIn("自动刷新固定 `progress.json`", coordinator)
            self.assertIn("追加 `events.jsonl`", coordinator)
            self.assertIn("主线程不输出 Mermaid", coordinator)
            self.assertIn("最终 task 结果", coordinator)

    def test_portable_skill_copies_are_synchronized(self) -> None:
        portable = (
            "parallel-task-planner/SKILL.md",
            "parallel-task-planner/references/templates.md",
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
