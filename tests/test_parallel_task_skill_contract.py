import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
PLATFORMS = {
    "codex": ROOT / "codex-market/plugins/ghost-agent-workflow",
    "claude": ROOT / "claude-code-market",
}
INTERNAL_SKILLS = (
    "parallel-task-planner",
    "thread-coordination",
    "thread-goal-worker",
    "subagent-coordination",
    "subagent-goal-worker",
)


class GoalDagSkillContractTests(unittest.TestCase):
    def skill(self, platform: str, name: str) -> str:
        return (PLATFORMS[platform] / "skills" / name / "SKILL.md").read_text(encoding="utf-8")

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

    def test_codex_runner_is_native_goal_inner_loop(self) -> None:
        skill = self.skill("codex", "goal-dag-runner")
        reference = self.reference("codex", "goal-dag-runner", "goal-contract.md")
        metadata = self.metadata("codex", "goal-dag-runner")
        prompt = (
            "/goal 每轮使用 $goal-dag-runner，以子代理 DAG 完整执行 `./plan.md`，"
            "直到计划项覆盖率 100% 且所有验收通过。"
        )
        self.assertIn("当前 Codex 原生 Goal 的 objective 显式包含 $goal-dag-runner", skill)
        self.assertIn(prompt, skill)
        self.assertIn("不要解析 `/goal`", skill)
        self.assertIn("不要改写 objective", skill)
        self.assertIn("首先调用 `get_goal`", skill)
        self.assertIn("`threadId`、`createdAt`", skill)
        self.assertIn("不能只按 objective digest", skill)
        self.assertIn('SHA-256(UTF-8(threadId + "\\n" + String(createdAt)))', skill)
        self.assertIn("新 `goal_id` 和目录名都必须包含该 suffix", skill)
        self.assertIn("相同 objective 的新原生 instance 必须创建独立目录", skill)
        self.assertIn("精确校验 `thread_id`、`created_at` 与 objective digest", reference)
        every_turn = skill[skill.index("## 每轮入口") : skill.index("## 本地文件")]
        self.assertLess(every_turn.index("goal-dag.mjs goal-validate"), every_turn.index("goal-dag.mjs status"))
        self.assertLess(every_turn.index("goal-dag.mjs status"), every_turn.index("goal-dag.mjs reconcile"))
        self.assertNotIn("create_goal", f"{skill}\n{reference}")
        self.assertNotIn("continuation_prompt", skill)
        self.assertIn('"controller": "codex_native"', reference)
        self.assertIn('"native_goal"', reference)
        self.assertIn('"thread_id"', reference)
        self.assertIn('"created_at"', reference)
        self.assertIn("goal-state.native_sync.objective_digest", reference)
        self.assertIn("普通 task", skill)
        self.assertIn("原生 blocked", skill)
        self.assertIn("allow_implicit_invocation: false", metadata)
        self.assertIn(prompt, metadata)

    def test_codex_completion_bridge_has_strict_order_and_retry(self) -> None:
        skill = self.skill("codex", "goal-dag-runner")
        bridge = skill[skill.index("## 原生完成桥接") :]
        finalize = bridge.index("goal-dag.mjs finalize")
        fresh_before_update = bridge.index("`finalize` 成功后立即再次调用 `get_goal`")
        update = bridge.index('update_goal({status: "complete"})')
        fresh_after_update = bridge.index("`update_goal` 返回成功后再次调用 `get_goal`")
        confirm = bridge.index("goal-dag.mjs native-confirm")
        self.assertLess(finalize, fresh_before_update)
        self.assertLess(fresh_before_update, update)
        self.assertLess(update, fresh_after_update)
        self.assertLess(fresh_after_update, confirm)
        self.assertIn("threadId + createdAt + objective digest", bridge)
        self.assertIn("native_completion_pending", bridge)
        self.assertIn("同一 token", bridge)
        self.assertIn("可恢复轮次先用 `get_goal`", bridge)
        self.assertIn("不能重新 status/reconcile/finalize", bridge)
        self.assertIn("mutable source/worktree", bridge)
        self.assertNotIn('update_goal({status: "blocked"})', skill)

    def test_claude_runner_is_explicit_local_fallback(self) -> None:
        skill = self.skill("claude", "goal-dag-runner")
        reference = self.reference("claude", "goal-dag-runner", "goal-contract.md")
        metadata = self.metadata("claude", "goal-dag-runner")
        combined = f"{skill}\n{reference}"
        self.assertIn("disable-model-invocation: true", skill)
        self.assertIn("/ghost-agent-workflow:goal-dag-runner 执行 <开发文档路径>", skill)
        self.assertIn("`$goal-dag-runner` 不是 Claude Code 插件 skill 的显式调用语法", skill)
        self.assertIn('"controller": "local_fallback"', reference)
        self.assertIn('"native_goal": null', reference)
        self.assertIn("有意的平台差异", combined)
        self.assertIn('SHA-256(UTF-8(source.path + "\\n" + source.digest))', reference)
        self.assertIn("显式提供稳定 `instance_key`", reference)
        self.assertIn("不得覆盖目录", reference)
        continuation = "/ghost-agent-workflow:goal-dag-runner 继续 `<goal.json绝对路径>`。"
        self.assertIn(f"{continuation}\n", skill)
        self.assertIn(f"{continuation}\n", reference)
        self.assertIn("逐字返回最近一次 runtime", skill)
        self.assertNotIn("get_goal", combined)
        self.assertNotIn("update_goal", combined)
        self.assertNotIn("create_goal", combined)
        self.assertIn("allow_implicit_invocation: false", metadata)
        self.assertIn('/ghost-agent-workflow:goal-dag-runner 执行', metadata)
        recovery = skill[skill.index("## 每次恢复") : skill.index("## 完成")]
        self.assertLess(recovery.index("goal-dag.mjs goal-validate"), recovery.index("goal-dag.mjs status"))
        self.assertLess(recovery.index("goal-dag.mjs status"), recovery.index("goal-dag.mjs reconcile"))

    def test_planner_reads_source_before_building_coverage_and_dag(self) -> None:
        for platform in PLATFORMS:
            skill = self.skill(platform, "parallel-task-planner")
            template = self.reference(platform, "parallel-task-planner")
            self.assertIn("亲自读取 `goal.source.path`", skill)
            self.assertLess(skill.index("先形成 `PLAN_COVERAGE_V1"), skill.index("再按 `(plan_item_id, required_effect)` 设计"))
            coverage = self.json_block_after(template, "## PLAN_COVERAGE_V1")
            plan = self.json_block_after(template, "## DAG_PLAN_V4")
            self.assertEqual(coverage["contract"], "PLAN_COVERAGE_V1")
            for field in (
                "source_path",
                "source_digest",
                "source_revision",
                "plan_path",
                "plan_digest",
                "plan_revision",
                "required_plan_items",
            ):
                self.assertIn(field, coverage)
            self.assertEqual(plan["contract"], "DAG_PLAN_V4")
            self.assertEqual(plan["plan_format_version"], 4)
            self.assertIn("plan_source", plan)
            self.assertIn("coverage_path", plan)
            self.assertTrue(plan["tasks"])
            self.assertTrue(all(task["plan_item_ids"] for task in plan["tasks"]))
            self.assertTrue(all(item["source_refs"] for item in coverage["required_plan_items"]))
            self.assertTrue(all(item["required_effects"] for item in coverage["required_plan_items"]))
            self.assertTrue(all(task["coverage_effect"] in {"implementation", "verification", "audit"} for task in plan["tasks"]))
            required_ids = {item["id"] for item in coverage["required_plan_items"]}
            covered_ids = {item for task in plan["tasks"] for item in task["plan_item_ids"]}
            self.assertEqual(required_ids, covered_ids)
            self.assertIn("DAG 无 ready/running task", skill)
            self.assertIn("不得 finalize", skill)

    def test_diff_scope_is_an_independent_required_gate(self) -> None:
        for platform in PLATFORMS:
            contract = self.reference(platform, "goal-dag-runner", "goal-contract.md")
            planner = self.skill(platform, "parallel-task-planner")
            plan = self.json_block_after(
                self.reference(platform, "parallel-task-planner"), "## DAG_PLAN_V4"
            )
            self.assertIn('"id": "diff-scope-audit"', contract)
            self.assertIn("`source-coverage-audit` 与 `diff-scope-audit` 都不得删除", contract)
            covering = [
                task for task in plan["tasks"]
                if "diff-scope-audit" in task["satisfies_goal_gates"]
            ]
            self.assertTrue(covering)
            self.assertTrue(all(task["role"] in {"review", "verify"} for task in covering))
            self.assertIn("非空 artifact", planner)
            for worker in ("thread-goal-worker", "subagent-goal-worker"):
                combined = f"{self.skill(platform, worker)}\n{self.reference(platform, worker)}"
                self.assertIn("diff-scope-audit", combined)
                self.assertIn("artifact_ref", combined)
                self.assertIn("artifact_digest", combined)

    def test_workspace_baseline_source_blocks_and_effect_coverage_are_mandatory(self) -> None:
        for platform in PLATFORMS:
            contract_text = self.reference(platform, "goal-dag-runner", "goal-contract.md")
            contract = self.json_block_after(contract_text, "## GOAL_CONTRACT_V1")
            runner = self.skill(platform, "goal-dag-runner")
            template = self.reference(platform, "parallel-task-planner")
            coverage = self.json_block_after(template, "## PLAN_COVERAGE_V1")
            plan = self.json_block_after(template, "## DAG_PLAN_V4")
            self.assertEqual(contract["workspace"]["root"], "/absolute/workspace/root")
            gates = {gate["id"]: gate for gate in contract["verification_gates"]}
            self.assertTrue(gates["source-coverage-audit"]["required"])
            self.assertTrue(gates["diff-scope-audit"]["required"])
            self.assertIn("WORKTREE_BASELINE_V1", runner)
            self.assertIn("SOURCE_BLOCKS_V1", runner)

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
            self.assertTrue(all(set(item["required_effects"]) <= {"implementation", "verification"} for item in coverage["required_plan_items"]))
            self.assertTrue(all(task["coverage_effect"] == "implementation" for task in plan["tasks"] if task["role"] == "work"))

            by_id = {task["id"]: task for task in plan["tasks"]}
            source_audits = {
                task["id"] for task in plan["tasks"]
                if "source-coverage-audit" in task["satisfies_goal_gates"]
            }
            self.assertTrue(source_audits)
            self.assertTrue(all(by_id[task_id]["role"] == "verify" and by_id[task_id]["coverage_effect"] == "audit" for task_id in source_audits))

            def ancestors(task_id: str) -> set[str]:
                direct = set(by_id[task_id]["depends_on"])
                return direct | {ancestor for dep in direct for ancestor in ancestors(dep)}

            for task in plan["tasks"]:
                if task["role"] == "work":
                    self.assertTrue(ancestors(task["id"]) & source_audits)

    def test_delta_refreshes_coverage_and_fences_source_revision(self) -> None:
        for platform in PLATFORMS:
            skill = self.skill(platform, "parallel-task-planner")
            template = self.reference(platform, "parallel-task-planner")
            delta = self.json_block_after(template, "## DAG_DELTA_V1")
            self.assertEqual(delta["contract"], "DAG_DELTA_V1")
            self.assertIn("coverage_update", delta)
            self.assertIn("required_plan_items", delta["coverage_update"])
            dispositions = {entry["action"] for entry in delta["source_dispositions"]}
            self.assertEqual(dispositions, {"invalidate"})
            invalidation = next(entry for entry in delta["source_dispositions"] if entry["action"] == "invalidate")
            self.assertIn(invalidation["replacement_task_id"], {task["id"] for task in delta["add_tasks"]})
            self.assertEqual(delta["repairs"], [])
            self.assertTrue(all(task["plan_item_ids"] for task in delta["add_tasks"]))
            self.assertIn("superseding task", skill)
            self.assertIn("旧 revision", skill)
            self.assertIn("非 source refresh", template)
            self.assertIn("原样保留", template)
            plan = self.json_block_after(template, "## DAG_PLAN_V4")
            fixed_audits = {
                task["id"] for task in plan["tasks"]
                if {"source-coverage-audit", "diff-scope-audit"} & set(task["satisfies_goal_gates"])
            }
            disposition_by_id = {entry["task_id"]: entry for entry in delta["source_dispositions"]}
            self.assertTrue(all(disposition_by_id[task_id]["action"] == "invalidate" for task_id in fixed_audits))
            self.assertIn("Capsule 当前视图", template)

    def test_platform_profiles_are_intentionally_different(self) -> None:
        codex = self.reference("codex", "parallel-task-planner")
        claude = self.reference("claude", "parallel-task-planner")
        self.assertIn('"model": "gpt-5.6-sol"', codex)
        self.assertIn('"reasoning_effort": "medium"', codex)
        self.assertIn('"runtime_profile": null', claude)
        self.assertNotIn('"model": "gpt-5.6-sol"', claude)
        for platform in PLATFORMS:
            self.assertIn("有意的平台差异", self.skill(platform, "parallel-task-planner"))

    def test_coordinators_reconcile_before_reserve_and_define_crash_windows(self) -> None:
        for platform in PLATFORMS:
            for name in ("thread-coordination", "subagent-coordination"):
                skill = self.skill(platform, name)
                reference = self.reference(platform, name)
                self.assertLess(skill.index("goal-dag.mjs status"), skill.index("goal-dag.mjs reconcile"))
                self.assertLess(skill.index("goal-dag.mjs reconcile"), skill.index("goal-dag.mjs reserve"))
                for command in ("goal-dag.mjs reconcile", "goal-dag.mjs abandon", "goal-dag.mjs reclaim", "goal-dag.mjs confirm-stale-executor", "goal-dag.mjs rotate-owner", "goal-dag.mjs bind", "goal-dag.mjs finish"):
                    self.assertIn(command, skill)
                for crash_window in ("orphan reservation", "spawn-before-bind", "bind-before-send", "result-written-before-finish"):
                    self.assertIn(crash_window, reference)
                self.assertIn("复用只是性能优化", skill)
                self.assertIn("attempt-<attempt>-<token>", skill)
                self.assertIn("coverage", skill)
                self.assertIn("confirm-stale-executor", skill)
                self.assertIn("stop-pending stale executor", skill)
                self.assertIn("`abandon` 只回滚 `reserved_unbound + spawn_executor`", reference)
                self.assertIn("`reserved_unbound + reuse_executor` 的已绑定复用目标确认丢失", reference)
                self.assertIn("不得 rotate generation", reference)
                self.assertIn("active task/checkpoint", reference)
                self.assertIn("canonical recovery binding", reference)
                self.assertIn("`reserved_unbound` + `spawn_executor`", reference)
                self.assertIn("`reserved_unbound` + `reuse_executor`", reference)
                self.assertIn("`running_bound` + `wait_or_redeliver`", reference)
                self.assertIn("`reserve.actions[]` 或 `status`/`reconcile.active_reservations[]`", reference)
                self.assertIn("完整 canonical `binding`", skill)
                self.assertIn("不得用聊天记录、旧 prompt 或本地推导重建", skill)
                if name == "subagent-coordination":
                    self.assertIn("executor_spawn_name", skill)
                    self.assertIn("canonical spawn identity", reference)

    def test_worker_bindings_carry_scope_revision_and_auditable_requirements(self) -> None:
        for platform in PLATFORMS:
            for name, mode in (("subagent-goal-worker", "subagent"), ("thread-goal-worker", "thread")):
                skill = self.skill(platform, name)
                template = self.reference(platform, name)
                binding = self.json_block_after(template, "## TASK_BINDING_V4")
                result = self.json_block_after(template, "## WORKER_RESULT_V4")
                self.assertEqual(binding["executor_mode"], mode)
                for field in ("executor_spawn_name", "worktree_baseline", "source_blocks", "coverage", "attempt", "reservation_token", "source_revision", "plan_item_ids", "coverage_effect", "goal_constraints", "side_effect_policy", "verification_requirements", "evidence_artifact_paths", "evidence_artifact_contracts", "result_path"):
                    self.assertIn(field, binding)
                self.assertEqual(set(binding["coverage"]), {"ref", "digest", "semantic_digest"})
                self.assertNotIn("coverage_digest", binding)
                self.assertTrue(binding["plan_item_ids"])
                gate = binding["verification_requirements"]["goal_gates"][0]
                self.assertTrue(gate["description"])
                self.assertRegex(binding["result_path"], r"/results/T1/attempt-2-.+\.json$")
                self.assertEqual(result["attempt"], binding["attempt"])
                self.assertEqual(result["source_revision"], binding["source_revision"])
                self.assertIn("blocking_findings", result)
                self.assertIn("exit 0", result["evidence"][0]["summary"])
                self.assertIn("artifact_digest", result["evidence"][0])
                self.assertTrue(binding["verification_requirements"]["completion"]["plan_coverage_100"])
                self.assertIn("goal-dag.mjs source-audit", template)
                self.assertIn("goal-dag.mjs diff-audit", template)
                self.assertIn("不得违反 constraints/non_goals", skill)
                self.assertIn("未显式授权", skill)
                self.assertIn("会话记忆和复用只是性能优化", skill)

    def test_only_runner_is_public_entrypoint(self) -> None:
        for platform in PLATFORMS:
            runner_metadata = self.metadata(platform, "goal-dag-runner")
            self.assertIn("default_prompt:", runner_metadata)
            self.assertIn("allow_implicit_invocation: false", runner_metadata)
            for name in INTERNAL_SKILLS:
                skill = self.skill(platform, name)
                metadata = self.metadata(platform, name)
                self.assertNotIn("default_prompt:", metadata)
                self.assertIn("allow_implicit_invocation: true", metadata)
                self.assertIn("仅供", skill.splitlines()[2])
                if platform == "claude":
                    self.assertIn("user-invocable: false", skill)
                self.assertLess(len(skill.splitlines()), 500)

    def test_runtime_and_generated_scripts_expose_new_contract_surface(self) -> None:
        source = (ROOT / "tooling/goal-dag/goal-dag.ts").read_text(encoding="utf-8")
        for token in (
            "PLAN_COVERAGE_V1",
            "plan_source",
            "plan_item_ids",
            "source_revision",
            "reconcile",
            "reclaim",
            "native-confirm",
            "native_completion_pending",
            "WORKER_RESULT_V4",
            "WORKTREE_BASELINE_V1",
            "SOURCE_BLOCKS_V1",
            "source-coverage-audit",
            "coverage_effect",
            "executor_spawn_name",
            "evidence_artifact_paths",
            "artifact_digest",
            "confirm-stale-executor",
        ):
            self.assertIn(token, source)
        self.assertNotIn("create_goal", source)


if __name__ == "__main__":
    unittest.main()
