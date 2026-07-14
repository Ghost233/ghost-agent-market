import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CODEX = ROOT / "codex-market/plugins/ghost-agent-workflow"
CLAUDE = ROOT / "claude-code-market"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class ParallelTaskSkillContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.platforms = {
            "codex": {
                "root": CODEX,
                "skills": CODEX / "skills",
                "script": CODEX / "scripts/thread-plan.mjs",
            },
            "claude": {
                "root": CLAUDE,
                "skills": CLAUDE / "skills",
                "script": CLAUDE / "scripts/thread-plan.mjs",
            },
        }

    def skill(self, platform: str, name: str) -> str:
        return read(self.platforms[platform]["skills"] / name / "SKILL.md")

    def reference(self, platform: str, name: str) -> str:
        return read(
            self.platforms[platform]["skills"]
            / name
            / "references/templates.md"
        )

    def metadata(self, platform: str, name: str) -> str:
        return read(
            self.platforms[platform]["skills"] / name / "agents/openai.yaml"
        )

    def test_initial_planning_requires_an_explicit_closed_request(self) -> None:
        for platform in self.platforms:
            planner = self.skill(platform, "parallel-task-planner")
            coordinator = self.skill(platform, "thread-coordination")
            worker = self.skill(platform, "thread-goal-worker")
            combined = "\n".join((planner, coordinator, worker))

            self.assertIn("明确要求", planner)
            self.assertIn("DAG 或并行规划", planner)
            self.assertIn("唯一选择", planner)
            self.assertIn("尚未说完", planner)
            self.assertIn("验收标准", planner)
            self.assertNotIn("每次用户发起的顶层完整任务都是新的 `parent_goal`", planner)
            self.assertIn("不同 `parent_goal` 之间绝不复用", planner)
            self.assertIn("不得跨 `parent_goal`", combined)
            self.assertIn("当前父目标内", coordinator)

    def test_planner_has_no_default_execution_mode(self) -> None:
        for platform in self.platforms:
            planner = self.skill(platform, "parallel-task-planner")
            self.assertIn("唯一选择", planner)
            self.assertIn("不得生成", planner)
            self.assertIn("普通", planner)
            self.assertNotIn("未指定时默认", planner)
            self.assertRegex(planner, r"不设默认|不得采用默认|不得.*默认值")

    def test_coordinators_require_explicit_or_locked_mode(self) -> None:
        for platform in self.platforms:
            for name, mode in (
                ("thread-coordination", "thread"),
                ("subagent-coordination", "subagent"),
            ):
                coordinator = self.skill(platform, name)
                self.assertIn("明确", coordinator)
                self.assertIn("state", coordinator)
                self.assertIn("锁定", coordinator)
                self.assertIn(mode, coordinator)

    def test_workers_only_accept_complete_coordinator_bindings(self) -> None:
        for platform in self.platforms:
            for name in ("thread-goal-worker", "subagent-goal-worker"):
                worker = self.skill(platform, name)
                self.assertIn("协调器", worker)
                self.assertIn("完整", worker)
                self.assertRegex(worker, r"绑定包|分派包")
                self.assertIn("普通用户请求", worker)

    def test_plan_contains_modules_tasks_and_no_thread_routes(self) -> None:
        for platform in self.platforms:
            planner = self.skill(platform, "parallel-task-planner")
            template = self.reference(platform, "parallel-task-planner")
            contract = f"{planner}\n{template}"

            for field in (
                "plan_format_version",
                "parent_goal",
                "modules",
                "tasks",
                "logical_id",
                "thread_role",
                "module_id",
                "depends_on",
                "writable_paths",
                "done_when",
                "verification",
                "project_verification",
                "safety",
            ):
                self.assertIn(field, contract)
            self.assertIn("计划不包含", planner)
            self.assertNotIn('"dispatch"', template)
            self.assertNotIn('"reuse"', template)
            self.assertNotIn("reviewed_task_ids", contract)
            self.assertNotIn("replacements", contract)
            self.assertNotIn("永久 claim", contract)

    def test_module_definition_is_fixed_within_parent_goal(self) -> None:
        for platform in self.platforms:
            planner = self.skill(platform, "parallel-task-planner")
            worker = self.skill(platform, "thread-goal-worker")
            self.assertIn("`worker_profile` 和 `worker_context` 在当前父目标内固定", planner)
            self.assertIn("需要不同职责或执行配置时定义新 module", planner)
            self.assertIn("与当前父目标初始定义一致", worker)

    def test_planner_has_concrete_verification_closure_rule(self) -> None:
        for platform in self.platforms:
            planner = self.skill(platform, "parallel-task-planner")
            self.assertIn("测试、门禁或配置如果需要修改", planner)
            self.assertIn("某个 `work` task 的 `writable_paths`", planner)
            self.assertIn("明确依赖且先完成的前置 task", planner)
            self.assertIn("否则不得生成", planner)

    def test_all_dag_topologies_are_executable(self) -> None:
        for platform in self.platforms:
            planner = self.skill(platform, "parallel-task-planner")
            template = self.reference(platform, "parallel-task-planner")
            coordinator = self.skill(platform, "thread-coordination")
            for topology in ("单节点", "纯串行", "并行", "混合"):
                self.assertIn(topology, planner)
            for status in ("parallel_safe", "sequential_only", "needs_user_review"):
                self.assertIn(status, f"{planner}\n{template}\n{coordinator}")
            self.assertIn("串行拓扑不会阻塞协调器", template)
            self.assertIn("`sequential_only`", coordinator)

    def test_one_plan_supports_two_execution_modes(self) -> None:
        for platform in self.platforms:
            planner = self.skill(platform, "parallel-task-planner")
            template = self.reference(platform, "parallel-task-planner")
            self.assertIn("$thread-coordination", planner)
            self.assertIn("$subagent-coordination", planner)
            self.assertIn("$thread-goal-worker", planner)
            self.assertIn("$subagent-goal-worker", planner)
            self.assertIn("`executor_mode`", planner)
            self.assertIn("选择不写入 plan", planner)
            self.assertNotIn('"executor_mode":', template)

    def test_coordinator_uses_one_dispatch_action(self) -> None:
        for platform in self.platforms:
            coordinator = self.skill(platform, "thread-coordination")
            self.assertIn("统一的 `dispatch_task`", coordinator)
            self.assertIn("action 的 `thread_id` 非空", coordinator)
            self.assertIn("action 的 `thread_id` 为 `null`", coordinator)
            self.assertIn("线程选择只服从 `next`" if platform == "codex" else "执行单元选择只服从 `next`", coordinator)
            self.assertIn("协调器不手工扫描 plan 链", coordinator)
            self.assertNotIn("沿当前 `parent_goal` 的 plan 链", coordinator)
            self.assertNotIn("reuse_existing_thread", coordinator)
            self.assertNotIn("reuse_thread", coordinator)
            self.assertNotIn("from_plan", coordinator)
            self.assertNotIn("from_task", coordinator)

    def test_successor_revision_retires_direct_predecessor(self) -> None:
        for platform in self.platforms:
            planner = self.skill(platform, "parallel-task-planner")
            coordinator = self.skill(platform, "thread-coordination")
            worker = self.skill(platform, "thread-goal-worker")
            self.assertIn("后继计划校验成功后", planner)
            self.assertIn("直接前版只保留为结果证据，不再执行", planner)
            self.assertIn("不再运行 `next` 或 `update`", coordinator)
            self.assertIn("前版只保留结果证据", worker)

    def test_thread_coordinator_locks_mode_and_uses_shared_driver(self) -> None:
        for platform in self.platforms:
            planner = self.skill(platform, "parallel-task-planner")
            coordinator = self.skill(platform, "thread-coordination")
            self.assertIn("thread-plan.mjs validate", planner)
            self.assertIn("thread-plan.mjs render", planner)
            self.assertIn("thread-plan.mjs validate", coordinator)
            self.assertIn("thread-plan.mjs mode", coordinator)
            self.assertIn("<state_path> thread", coordinator)
            self.assertIn("thread-plan.mjs next", coordinator)
            self.assertIn("thread-plan.mjs update", coordinator)
            self.assertNotIn("thread-plan.mjs migrate", f"{planner}\n{coordinator}")

    def test_binding_and_result_contract_have_one_reference_owner(self) -> None:
        for platform in self.platforms:
            coordinator = self.skill(platform, "thread-coordination")
            coordinator_reference = self.reference(platform, "thread-coordination")
            worker_reference = self.reference(platform, "thread-goal-worker")

            self.assertIn("唯一规范来源", coordinator)
            self.assertIn("唯一模板", coordinator_reference)
            self.assertNotIn('"task_id":', coordinator_reference)
            self.assertIn('"task_id":', worker_reference)
            self.assertIn('"contract": "WORKER_RESULT_V3"', worker_reference)
            self.assertIn('"contract": "WORKER_REPAIR_V3"', worker_reference)

    def test_worker_is_scoped_and_persists_one_result(self) -> None:
        for platform in self.platforms:
            worker = self.skill(platform, "thread-goal-worker")
            template = self.reference(platform, "thread-goal-worker")
            contract = f"{worker}\n{template}"
            self.assertIn("任一时刻只能有一个活动 task", worker)
            self.assertIn("不得继承上一 task 的权限或证据", worker)
            self.assertIn("`review`", worker)
            self.assertIn("`verify`", worker)
            self.assertIn("原子写入 `result_path`", worker)
            self.assertIn("scope_request", contract)
            self.assertIn("scope_exception", contract)
            self.assertIn("不是用户确认请求", worker)

    def test_mermaid_is_display_only(self) -> None:
        for platform in self.platforms:
            planner = self.skill(platform, "parallel-task-planner")
            worker = self.skill(platform, "thread-goal-worker")
            self.assertIn("`mermaid` fenced code block", planner)
            self.assertIn("Mermaid 不是机器输入", f"{planner}\n{worker}")

    def test_metadata_is_chinese_and_matches_current_goal_scope(self) -> None:
        for platform in self.platforms:
            metadata = "\n".join(
                self.metadata(platform, name)
                for name in (
                    "parallel-task-planner",
                    "thread-coordination",
                    "thread-goal-worker",
                )
            )
            self.assertIn("任务 DAG", metadata)
            self.assertIn("明确", metadata)
            self.assertNotIn("legacy", metadata.lower())

    def test_internal_skills_disable_implicit_invocation(self) -> None:
        for platform in self.platforms:
            planner = self.metadata(platform, "parallel-task-planner")
            self.assertNotIn("allow_implicit_invocation: false", planner)

            for name in (
                "thread-coordination",
                "thread-goal-worker",
                "subagent-coordination",
                "subagent-goal-worker",
            ):
                metadata = self.metadata(platform, name)
                self.assertIn("allow_implicit_invocation: false", metadata)

    def test_default_worker_profiles_are_platform_specific(self) -> None:
        codex = self.reference("codex", "parallel-task-planner")
        claude = self.reference("claude", "parallel-task-planner")
        codex_coordinator = self.skill("codex", "thread-coordination")
        claude_coordinator = self.skill("claude", "thread-coordination")
        self.assertIn('"model": "gpt-5.6-terra"', codex)
        self.assertIn('"reasoning_effort": "medium"', codex)
        self.assertIn('"model": "sonnet"', claude)
        self.assertIn('"reasoning_effort": "max"', claude)
        self.assertIn("`gpt-5.6-sol/xhigh` 主线程", codex_coordinator)
        self.assertIn("`gpt-5.6-terra/medium`", codex_coordinator)
        self.assertIn("`opus/max` 主会话", claude_coordinator)
        self.assertIn("`sonnet/max`", claude_coordinator)

    def test_thread_skills_do_not_reintroduce_pool_limits(self) -> None:
        for platform in self.platforms:
            combined = "\n".join(
                read(path)
                for name in (
                    "thread-coordination",
                    "thread-goal-worker",
                )
                for path in (
                    self.platforms[platform]["skills"] / name / "SKILL.md",
                    self.platforms[platform]["skills"] / name / "references/templates.md",
                    self.platforms[platform]["skills"] / name / "agents/openai.yaml",
                )
            )
            self.assertNotIn("线程池", combined)
            self.assertNotIn("并发上限", combined)

    def test_published_driver_is_generated_from_one_source(self) -> None:
        source = read(ROOT / "tooling/thread-plan/thread-plan.ts")
        codex = read(self.platforms["codex"]["script"])
        claude = read(self.platforms["claude"]["script"])
        self.assertIn("dispatch_task", source)
        self.assertIn("dispatch_task", codex)
        self.assertIn("dispatch_task", claude)
        self.assertNotIn("dispatch routes are missing", source)

    def test_manifest_versions_are_incremented(self) -> None:
        codex = json.loads(read(CODEX / ".codex-plugin/plugin.json"))
        claude = json.loads(read(CLAUDE / ".claude-plugin/plugin.json"))
        self.assertTrue(codex["version"].startswith("0.7.5+codex."))
        self.assertEqual(claude["version"], "0.3.7")

    def test_codex_manifest_exposes_only_explicit_user_prompts(self) -> None:
        manifest = json.loads(read(CODEX / ".codex-plugin/plugin.json"))
        prompts = manifest["interface"]["defaultPrompt"]

        self.assertEqual(len(prompts), 2)
        self.assertIn("$parallel-task-planner", prompts[0])
        self.assertIn("DAG", prompts[0])
        self.assertIn("子线程", prompts[0])
        self.assertIn("子代理", prompts[0])
        self.assertIn("必须二选一", prompts[0])
        self.assertIn("不要推断或默认", prompts[0])
        self.assertIn("$git-commit", prompts[1])

        hidden_entries = (
            "$thread-coordination",
            "$thread-goal-worker",
            "$subagent-coordination",
            "$subagent-goal-worker",
        )
        combined = "\n".join(prompts)
        for entry in hidden_entries:
            self.assertNotIn(entry, combined)

        keywords = manifest["keywords"]
        for entry in (
            "thread-coordination",
            "thread-goal-worker",
            "subagent-coordination",
            "subagent-goal-worker",
        ):
            self.assertNotIn(entry, keywords)

    def test_claude_manifest_uses_the_same_explicit_gate(self) -> None:
        manifest = json.loads(read(CLAUDE / ".claude-plugin/plugin.json"))
        self.assertIn("明确要求 DAG 或并行规划", manifest["description"])
        self.assertIn("唯一选择执行方式", manifest["description"])
        self.assertIn("不提供默认执行模式", manifest["description"])

        for entry in (
            "thread-coordination",
            "thread-goal-worker",
            "subagent-coordination",
            "subagent-goal-worker",
        ):
            self.assertNotIn(entry, manifest["keywords"])

    def test_readmes_describe_the_explicit_planning_gate(self) -> None:
        readmes = (
            read(ROOT / "README.md"),
            read(ROOT / "codex-market/README.md"),
            read(ROOT / "claude-code-market/README.md"),
            read(CODEX / "README.md"),
        )
        for readme in readmes:
            self.assertIn("已经完成当前任务说明", readme)
            self.assertIn("明确要求", readme)
            self.assertIn("DAG 或并行规划", readme)
            self.assertIn("验收标准", readme)
            self.assertIn("尚未说完", readme)
            self.assertIn("不会自动触发规划", readme)
            self.assertIn("没有默认值", readme)


if __name__ == "__main__":
    unittest.main()
