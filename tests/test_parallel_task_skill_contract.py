import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
PLATFORMS = {
    "codex": ROOT / "codex-market/plugins/ghost-agent-workflow",
    "claude": ROOT / "claude-code-market",
}
ACTIVE_DAG_SKILLS = (
    "subagent-coordination",
    "parallel-task-planner",
    "subagent-goal-worker",
)
INTERNAL_DAG_SKILLS = (
    "parallel-task-planner",
    "subagent-goal-worker",
)
class GoalDagSkillContractTests(unittest.TestCase):
    def skill(self, platform: str, name: str) -> str:
        return (PLATFORMS[platform] / "skills" / name / "SKILL.md").read_text(
            encoding="utf-8"
        )

    def reference(self, platform: str, name: str, file: str = "templates.md") -> str:
        return (PLATFORMS[platform] / "skills" / name / "references" / file).read_text(
            encoding="utf-8"
        )

    def metadata(self, platform: str, name: str) -> str:
        return (PLATFORMS[platform] / "skills" / name / "agents/openai.yaml").read_text(
            encoding="utf-8"
        )

    def json_block_after(self, text: str, heading: str) -> dict:
        tail = text[text.index(heading) + len(heading) :]
        match = re.search(r"```json\n(.*?)\n```", tail, re.DOTALL)
        self.assertIsNotNone(match, heading)
        return json.loads(match.group(1))

    def test_only_three_dag_skills_remain(self) -> None:
        for platform, root in PLATFORMS.items():
            actual_skills = {
                path.name
                for path in (root / "skills").iterdir()
                if path.is_dir() and (path / "SKILL.md").is_file()
            }
            self.assertEqual(actual_skills, {"git-commit", *ACTIVE_DAG_SKILLS}, platform)

    def test_subagent_coordinator_is_the_only_public_dag_entrypoint(self) -> None:
        for platform in PLATFORMS:
            coordinator = self.skill(platform, "subagent-coordination")
            metadata = self.metadata(platform, "subagent-coordination")
            self.assertIn("default_prompt:", metadata)
            self.assertIn("allow_implicit_invocation: false", metadata)
            self.assertIn("subagent-coordination", metadata)
            self.assertIn("唯一公开", coordinator)

            for name in INTERNAL_DAG_SKILLS:
                skill = self.skill(platform, name)
                internal_metadata = self.metadata(platform, name)
                self.assertNotIn("default_prompt:", internal_metadata)
                self.assertIn("allow_implicit_invocation: true", internal_metadata)
                self.assertIn("内部", f"{skill}\n{internal_metadata}")
                if platform == "claude":
                    self.assertIn("user-invocable: false", skill)

        self.assertIn(
            "/goal 每轮使用 $subagent-coordination",
            self.metadata("codex", "subagent-coordination"),
        )
        self.assertIn(
            "/ghost-agent-workflow:subagent-coordination 执行",
            self.metadata("claude", "subagent-coordination"),
        )

    def test_coordinator_owns_subagent_only_goal_contract(self) -> None:
        for platform in PLATFORMS:
            reference_path = (
                PLATFORMS[platform]
                / "skills/subagent-coordination/references/goal-contract.md"
            )
            self.assertTrue(reference_path.is_file())
            contract = self.json_block_after(
                reference_path.read_text(encoding="utf-8"), "## GOAL_CONTRACT_V1"
            )
            self.assertEqual(contract["execution"]["mode"], "subagent")
            self.assertEqual(contract["execution_platform"], platform if platform == "codex" else "claude_code")
            self.assertEqual(contract["workspace"]["root"], "/absolute/workspace/root")
            gates = {gate["id"]: gate for gate in contract["verification_gates"]}
            self.assertTrue(gates["source-coverage-audit"]["required"])
            self.assertTrue(gates["diff-scope-audit"]["required"])

            if platform == "codex":
                self.assertEqual(contract["lifecycle"]["controller"], "codex_native")
                self.assertEqual(
                    set(contract["lifecycle"]["native_goal"]), {"thread_id", "created_at"}
                )
            else:
                self.assertEqual(contract["lifecycle"]["controller"], "local_fallback")
                self.assertIsNone(contract["lifecycle"]["native_goal"])

    def test_platform_lifecycles_remain_native_and_local(self) -> None:
        codex = self.skill("codex", "subagent-coordination")
        codex_contract = self.reference(
            "codex", "subagent-coordination", "goal-contract.md"
        )
        self.assertIn("$subagent-coordination", codex)
        self.assertIn("get_goal", codex)
        self.assertIn("update_goal", codex)
        self.assertIn("goal-dag.mjs native-confirm", codex)
        self.assertIn("不要调用 `create_goal`", codex)
        bridge = codex[codex.index("## 原生完成桥接") :]
        self.assertRegex(
            bridge,
            re.compile(
                r"`finalize`.*?`get_goal`.*?`update_goal\(\{status: \"complete\"\}\)`"
                r".*?`get_goal`.*?native-confirm",
                re.DOTALL,
            ),
        )
        self.assertNotIn('update_goal({status: "blocked"})', codex)

        claude = self.skill("claude", "subagent-coordination")
        claude_contract = self.reference(
            "claude", "subagent-coordination", "goal-contract.md"
        )
        combined = f"{claude}\n{claude_contract}"
        self.assertIn("lifecycle.controller: local_fallback", claude)
        self.assertIn(
            "/ghost-agent-workflow:subagent-coordination 继续 `<goal.json绝对路径>`。",
            combined,
        )
        for native_tool in ("get_goal", "update_goal", "create_goal", "native-confirm"):
            self.assertNotIn(native_tool, combined)

    def test_planner_builds_effect_aware_coverage_plan_and_delta(self) -> None:
        for platform in PLATFORMS:
            skill = self.skill(platform, "parallel-task-planner")
            template = self.reference(platform, "parallel-task-planner")
            coverage = self.json_block_after(template, "## PLAN_COVERAGE_V1")
            plan = self.json_block_after(template, "## DAG_PLAN_V4")
            delta = self.json_block_after(template, "## DAG_DELTA_V1")

            self.assertIn("goal.source.path", skill)
            self.assertEqual(coverage["contract"], "PLAN_COVERAGE_V1")
            self.assertEqual(plan["contract"], "DAG_PLAN_V4")
            self.assertEqual(plan["plan_format_version"], 4)
            self.assertEqual(delta["contract"], "DAG_DELTA_V1")
            self.assertIn("coverage_update", delta)
            self.assertTrue(coverage["required_plan_items"])
            self.assertTrue(plan["tasks"])
            self.assertTrue(all(item["source_refs"] for item in coverage["required_plan_items"]))
            self.assertTrue(all(item["required_effects"] for item in coverage["required_plan_items"]))
            self.assertTrue(all(task["plan_item_ids"] for task in plan["tasks"]))

            required_pairs = {
                (item["id"], effect)
                for item in coverage["required_plan_items"]
                for effect in item["required_effects"]
            }
            planned_pairs = {
                (item_id, task["coverage_effect"])
                for task in plan["tasks"]
                for item_id in task["plan_item_ids"]
            }
            self.assertLessEqual(required_pairs, planned_pairs)
            self.assertIn("source_dispositions", delta)
            self.assertIn("source_revision", template)

    def test_coordinator_owns_runtime_recovery_and_dispatch(self) -> None:
        required_commands = (
            "goal-validate",
            "validate",
            "render",
            "status",
            "reconcile",
            "goal-refresh",
            "apply-delta",
            "abandon",
            "reclaim",
            "confirm-stale-executor",
            "rotate-owner",
            "reserve",
            "bind",
            "finish",
            "finalize",
        )
        for platform in PLATFORMS:
            skill = self.skill(platform, "subagent-coordination")
            recovery = self.reference(platform, "subagent-coordination")
            for command in required_commands:
                self.assertIn(f"goal-dag.mjs {command}", skill)
            self.assertLess(skill.index("goal-dag.mjs status"), skill.index("goal-dag.mjs reconcile"))
            self.assertLess(skill.index("goal-dag.mjs reconcile"), skill.index("goal-dag.mjs reserve"))
            self.assertIn("TASK_BINDING_V4", skill)
            self.assertIn("executor_spawn_name", skill)
            self.assertIn("Owner/generation", skill)
            for window in (
                "orphan reservation",
                "spawn-before-bind",
                "bind-before-send",
                "result-written-before-finish",
            ):
                self.assertIn(window, recovery)
            self.assertIn("canonical recovery binding", recovery)
            self.assertIn("reserved_unbound", recovery)
            self.assertIn("running_bound", recovery)

    def test_worker_binding_and_result_are_fenced_and_auditable(self) -> None:
        for platform in PLATFORMS:
            skill = self.skill(platform, "subagent-goal-worker")
            template = self.reference(platform, "subagent-goal-worker")
            binding = self.json_block_after(template, "## TASK_BINDING_V4")
            result = self.json_block_after(template, "## WORKER_RESULT_V4")

            self.assertEqual(binding["executor_mode"], "subagent")
            for field in (
                "executor_spawn_name",
                "worktree_baseline",
                "source_blocks",
                "coverage",
                "attempt",
                "reservation_token",
                "source_revision",
                "plan_item_ids",
                "coverage_effect",
                "goal_constraints",
                "side_effect_policy",
                "verification_requirements",
                "evidence_artifact_paths",
                "evidence_artifact_contracts",
                "result_path",
            ):
                self.assertIn(field, binding)
            self.assertEqual(set(binding["coverage"]), {"ref", "digest", "semantic_digest"})
            self.assertEqual(result["attempt"], binding["attempt"])
            self.assertEqual(result["source_revision"], binding["source_revision"])
            self.assertIn("blocking_findings", result)
            self.assertIn("artifact_digest", result["evidence"][0])
            self.assertIn("OWNER_CHECKPOINT_V1", template)
            self.assertIn("goal-dag.mjs source-audit", template)
            self.assertIn("goal-dag.mjs diff-audit", template)
            self.assertIn("不得修改 goal/coverage/plan/state/capsule", skill)

    def test_platform_profiles_are_intentionally_different(self) -> None:
        codex_plan = self.reference("codex", "parallel-task-planner")
        claude_plan = self.reference("claude", "parallel-task-planner")
        codex_coordinator = self.skill("codex", "subagent-coordination")
        claude_coordinator = self.skill("claude", "subagent-coordination")
        self.assertIn('"model": "gpt-5.6-sol"', codex_plan)
        self.assertIn('"reasoning_effort": "medium"', codex_plan)
        self.assertIn('"runtime_profile": null', claude_plan)
        self.assertIn('model: "gpt-5.6-sol"', codex_coordinator)
        self.assertIn('reasoning_effort: "medium"', codex_coordinator)
        self.assertIn('fork_turns: "none"', codex_coordinator)
        self.assertIn("不得指定 model", claude_coordinator)

    def test_runtime_and_generated_scripts_are_subagent_only(self) -> None:
        source = (ROOT / "tooling/goal-dag/goal-dag.ts").read_text(encoding="utf-8")
        self.assertIn('type ExecutorMode = "subagent";', source)
        self.assertIn("goal execution.mode must equal subagent", source)
        self.assertIn("/ghost-agent-workflow:subagent-coordination 继续", source)

        for script in (
            ROOT / "claude-code-market/scripts/goal-dag.mjs",
            ROOT / "codex-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs",
        ):
            generated = script.read_text(encoding="utf-8")
            self.assertIn('execution.mode !== "subagent"', generated)


if __name__ == "__main__":
    unittest.main()
