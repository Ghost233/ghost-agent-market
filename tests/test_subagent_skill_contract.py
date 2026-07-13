from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CODEX = ROOT / "codex-market/plugins/ghost-agent-workflow"
CLAUDE = ROOT / "claude-code-market"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class SubagentSkillContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.platforms = {
            "codex": CODEX / "skills",
            "claude": CLAUDE / "skills",
        }

    def skill(self, platform: str, name: str) -> str:
        return read(self.platforms[platform] / name / "SKILL.md")

    def reference(self, platform: str, name: str) -> str:
        return read(self.platforms[platform] / name / "references/templates.md")

    def metadata(self, platform: str, name: str) -> str:
        return read(self.platforms[platform] / name / "agents/openai.yaml")

    def test_both_subagent_skills_exist_on_both_platforms(self) -> None:
        for platform in self.platforms:
            for name in ("subagent-coordination", "subagent-goal-worker"):
                self.assertIn(f"name: {name}", self.skill(platform, name))
                self.assertIn("子代理", self.metadata(platform, name))

    def test_subagent_mode_reuses_the_same_plan_and_driver(self) -> None:
        for platform in self.platforms:
            coordinator = self.skill(platform, "subagent-coordination")
            planner = self.skill(platform, "parallel-task-planner")
            self.assertIn("同一份 v3 plan", coordinator)
            self.assertIn("thread-plan.mjs validate", coordinator)
            self.assertIn("thread-plan.mjs mode", coordinator)
            self.assertIn("<state_path> subagent", coordinator)
            self.assertIn("thread-plan.mjs next", coordinator)
            self.assertIn("thread-plan.mjs update", coordinator)
            self.assertIn("选择不写入 plan", planner)

    def test_codex_uses_collaboration_agents_not_visible_threads(self) -> None:
        coordinator = self.skill("codex", "subagent-coordination")
        worker = self.skill("codex", "subagent-goal-worker")
        contract = f"{coordinator}\n{self.reference('codex', 'subagent-coordination')}"
        for tool in ("list_agents", "spawn_agent", "followup_task", "wait_agent"):
            self.assertIn(tool, contract)
        for call in (
            "create_thread(",
            "fork_thread(",
            "list_threads(",
            "read_thread(",
            "send_message_to_thread(",
        ):
            self.assertNotIn(call, contract)
        self.assertIn("不得调用 `spawn_agent`", worker)

    def test_claude_uses_agent_and_send_message(self) -> None:
        coordinator = self.skill("claude", "subagent-coordination")
        worker = self.skill("claude", "subagent-goal-worker")
        self.assertIn("`Agent`", coordinator)
        self.assertIn("`SendMessage({to: agentId})`", coordinator)
        self.assertIn("不要向 `Agent` 传 resume 参数", coordinator)
        self.assertIn("不得再次调用 `Agent`", worker)

    def test_no_explicit_profile_is_required(self) -> None:
        for platform in self.platforms:
            combined = "\n".join(
                (
                    self.skill(platform, "subagent-coordination"),
                    self.skill(platform, "subagent-goal-worker"),
                    self.reference(platform, "subagent-coordination"),
                    self.reference(platform, "subagent-goal-worker"),
                    self.metadata(platform, "subagent-coordination"),
                    self.metadata(platform, "subagent-goal-worker"),
                )
            )
            self.assertNotIn("gpt-", combined.lower())
            self.assertNotIn("sonnet", combined.lower())
            self.assertNotIn("opus", combined.lower())
            self.assertNotIn("model=", combined.lower())
            self.assertNotIn("thinking=", combined.lower())
            self.assertNotIn('"worker_profile":', combined)
            self.assertIn("平台默认", combined)
            self.assertIn("subagent-defaults", combined)

    def test_agent_target_uses_the_shared_thread_id_field(self) -> None:
        for platform in self.platforms:
            coordinator = self.skill(platform, "subagent-coordination")
            template = self.reference(platform, "subagent-goal-worker")
            self.assertIn("共享 driver 的标识字段", coordinator)
            self.assertIn('"thread_id":', template)
            self.assertIn(
                "canonical agent_target" if platform == "codex" else "真实 agentId",
                template,
            )
            self.assertIn('"executor_mode": "subagent"', template)

    def test_worker_scope_and_atomic_result_are_preserved(self) -> None:
        for platform in self.platforms:
            worker = self.skill(platform, "subagent-goal-worker")
            template = self.reference(platform, "subagent-goal-worker")
            self.assertIn("任一时刻只能有一个活动 task", worker)
            self.assertIn("不得继承上一 task 的权限或证据", worker)
            self.assertIn("`review`", worker)
            self.assertIn("`verify`", worker)
            self.assertIn("原子写入 `result_path`", worker)
            self.assertIn('"contract": "WORKER_RESULT_V3"', template)
            self.assertIn('"contract": "WORKER_REPAIR_V3"', template)
            self.assertIn("scope_request", template)


if __name__ == "__main__":
    unittest.main()
