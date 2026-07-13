from pathlib import Path
import json
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


def read_templates(root: Path, name: str) -> str:
    return (root / "skills" / name / "references/templates.md").read_text(
        encoding="utf-8"
    )


def read_json_blocks(markdown: str) -> list[dict]:
    return [
        json.loads(chunk.split("```", 1)[0])
        for chunk in markdown.split("```json")[1:]
    ]


class ParallelTaskSkillContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.codex_skills = {name: read_skill(CODEX, name) for name in THREAD_SKILLS}
        cls.claude_skills = {name: read_skill(CLAUDE, name) for name in THREAD_SKILLS}
        cls.codex_templates = {
            name: read_templates(CODEX, name) for name in THREAD_SKILLS
        }
        cls.claude_templates = {
            name: read_templates(CLAUDE, name) for name in THREAD_SKILLS
        }
        cls.all_skills = "\n".join(
            [
                *cls.codex_skills.values(),
                *cls.claude_skills.values(),
                *cls.codex_templates.values(),
                *cls.claude_templates.values(),
            ]
        )
        cls.all_metadata = "\n".join(
            [
                *(read_metadata(CODEX, name) for name in THREAD_SKILLS),
                *(read_metadata(CLAUDE, name) for name in THREAD_SKILLS),
            ]
        )

    def test_both_planners_define_task_as_the_dag_node(self) -> None:
        for skill, templates in (
            (
                self.codex_skills["parallel-task-planner"],
                self.codex_templates["parallel-task-planner"],
            ),
            (
                self.claude_skills["parallel-task-planner"],
                self.claude_templates["parallel-task-planner"],
            ),
        ):
            contract = f"{skill}\n{templates}"
            self.assertIn("`module`", skill)
            self.assertIn("DAG 节点", skill)
            self.assertIn("领域", skill)
            self.assertIn("`task` 是 DAG 节点", skill)
            self.assertIn("module_id", contract)
            self.assertIn(".ghost-agent-workflow/parallel_plan", skill)
            self.assertIn("logical_id", contract)
            self.assertIn("title", contract)
            self.assertIn("thread_role", contract)
            self.assertIn('"revision": 1', templates)
            self.assertIn("永久 claim", skill)
            self.assertIn('"continuation"', templates)
            self.assertIn("reviewed_task_ids", contract)
            self.assertIn("replacements", contract)
            self.assertIn("continue", contract)
            self.assertIn("handoff", contract)
            self.assertRegex(skill, r"闭包(审查|审计)")

    def test_thread_ownership_is_stable_across_revisions(self) -> None:
        for planner, templates in (
            (
                self.codex_skills["parallel-task-planner"],
                self.codex_templates["parallel-task-planner"],
            ),
            (
                self.claude_skills["parallel-task-planner"],
                self.claude_templates["parallel-task-planner"],
            ),
        ):
            contract = f"{planner}\n{templates}"
            self.assertIn("(parent_goal, module_id, thread_role)", contract)
            self.assertIn("跨全部 revision", contract)
            self.assertIn("必须复用", contract)
            self.assertIn("profile 与 context", planner)
            self.assertIn("不属于", planner)
            self.assertIn("worker_context", planner)
            self.assertIn("DAG 中可比", planner)
            self.assertIn("ready task", planner)
            self.assertIn("任务替代关系", contract)
            self.assertIn("归属关系正交", contract)
            self.assertIn("`continuation.reuse` 可省略", planner)
            self.assertIn("`reuse` 仅是兼容性断言", templates)
            self.assertIn("字段缺失或为空都不能关闭复用", templates)
            self.assertRegex(templates, r"不得再创建第三(条线程|个执行单元)")
            self.assertRegex(planner, r"不参与(线程|执行单元)归属")
            for status in ("completed", "needs_main_review", "blocked", "failed"):
                self.assertIn(status, contract)
            self.assertIn("相同为 `continue`，不同为 `handoff`", planner)

        for coordinator in (
            self.codex_skills["thread-coordination"],
            self.claude_skills["thread-coordination"],
        ):
            self.assertIn("(parent_goal, module_id, thread_role)", coordinator)
            self.assertIn("`dispatch_key`", coordinator)
            self.assertIn("不是线程身份", coordinator.replace("执行单元身份", "线程身份"))
            self.assertIn("完整 continuation 历史", coordinator)
            self.assertIn("profile 或 context 变化不改变", coordinator)
            self.assertIn("任务的承接关系", coordinator)
            self.assertIn("不得覆盖或限制历史", coordinator)
            self.assertIn("范围分析、交叉检查、编译诊断或审查", coordinator)
            self.assertIn("任何计划外", coordinator)
            self.assertIn("持久归属只有", coordinator)
            self.assertIn("每项都内嵌合法结果", coordinator)
            self.assertIn("补修后得到合法终态结果才执行 `update`", coordinator)
            self.assertIn("不伪造终态", coordinator)

        for worker in (
            self.codex_skills["thread-goal-worker"],
            self.claude_skills["thread-goal-worker"],
        ):
            self.assertIn("(parent_goal, module_id, thread_role)", worker)
            self.assertIn("按 DAG 顺序承接", worker)
            self.assertIn("logical_id` 可以变化", worker)
            self.assertIn("不得继承上一 task 的权限", worker)
            self.assertIn("profile 或 context 更新不改变", worker)

        for worker, templates in (
            (
                self.codex_skills["thread-goal-worker"],
                self.codex_templates["thread-goal-worker"],
            ),
            (
                self.claude_skills["thread-goal-worker"],
                self.claude_templates["thread-goal-worker"],
            ),
        ):
            self.assertIn("WORKER_REPAIR_V3", templates)
            self.assertIn("不修改业务文件", worker)
            self.assertIn("原子写入", worker)
            self.assertIn("无法补齐成功证据", f"{worker}\n{templates}")

        self.assertIn("module+role", self.all_metadata)
        self.assertIn("计划外诊断或审查", self.all_metadata)

    def test_workflow_uses_the_four_command_driver(self) -> None:
        for planner in (
            self.codex_skills["parallel-task-planner"],
            self.claude_skills["parallel-task-planner"],
        ):
            self.assertIn("thread-plan.mjs validate", planner)
            self.assertIn("thread-plan.mjs render", planner)

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
            self.assertIn("保持任务为 `pending`", coordinator)
            self.assertIn("保留 `running/thread_id`", coordinator)
            self.assertIn("自动重试一次", coordinator)
            self.assertIn("不要求用户批准重试", coordinator)
            self.assertIn("reuse_existing_thread", coordinator)
            self.assertIn("<logical_id> · <title>", coordinator)
            self.assertIn("[GA][<用途>][<状态>]", coordinator)
            self.assertRegex(coordinator, r"闭包(审查|审计)")
            self.assertIn("静止点", coordinator)
            self.assertIn("result_path", coordinator)
            self.assertIn("expected_title", coordinator)
            self.assertIn("$parallel-task-planner", coordinator)

    def test_parent_goal_authorization_covers_internal_replanning(self) -> None:
        for planner in (
            self.codex_skills["parallel-task-planner"],
            self.claude_skills["parallel-task-planner"],
        ):
            self.assertIn("用户授权以 `parent_goal` 为单位", planner)
            self.assertIn("受控基线", planner)
            self.assertIn("不要求用户确认", planner)
            self.assertIn("不可比", planner)
            self.assertIn("共享前置", planner)
            self.assertIn("静止点", planner)

        for coordinator in (
            self.codex_skills["thread-coordination"],
            self.claude_skills["thread-coordination"],
        ):
            self.assertIn("用户授权的是完整父目标", coordinator)
            self.assertIn("不要求用户逐次批准", coordinator)
            self.assertIn("`parallel_safe`", coordinator)
            self.assertIn("`sequential_only`", coordinator)
            self.assertIn("可执行 DAG", coordinator)
            self.assertIn("视为受控基线", coordinator)
            self.assertIn("静止点", coordinator)
            self.assertIn("$parallel-task-planner", coordinator)
            self.assertIn("内部修订不能作为最终失败返回", coordinator)
            self.assertIn("project_verification", coordinator)

    def test_every_goal_becomes_an_executable_dag(self) -> None:
        serial_notice = (
            "执行模式：串行 DAG（sequential_only）\n"
            "当前计划已通过校验，将按依赖顺序自动执行全部任务，无需确认或介入。"
        )
        for planner, templates in (
            (
                self.codex_skills["parallel-task-planner"],
                self.codex_templates["parallel-task-planner"],
            ),
            (
                self.claude_skills["parallel-task-planner"],
                self.claude_templates["parallel-task-planner"],
            ),
        ):
            contract = f"{planner}\n{templates}"
            self.assertRegex(planner, r"(每个|所有)顶层父目标.*DAG")
            for topology in ("单节点", "纯串行", "并行", "混合"):
                self.assertIn(topology, planner)
            self.assertIn("请求本身就是当前 `parent_goal` 的执行授权", planner)
            self.assertIn("只规划", planner)
            self.assertIn("已绑定的 DAG task 不是新的父目标", planner)
            self.assertIn("普通工程证据不足", planner)
            self.assertIn(serial_notice, contract)
            self.assertIn("`mermaid` fenced code block", contract)
            self.assertIn("`parallel_safe`", contract)
            self.assertIn("`sequential_only`", contract)
            self.assertIn("`needs_user_review`", contract)
            self.assertNotIn("首次计划只有在", planner)

        for coordinator in (
            self.codex_skills["thread-coordination"],
            self.claude_skills["thread-coordination"],
        ):
            self.assertIn("`parallel_safe`", coordinator)
            self.assertIn("`sequential_only`", coordinator)
            self.assertIn("可执行 DAG", coordinator)
            self.assertIn("needs_user_review", coordinator)
            self.assertIn("不等待", coordinator)
            self.assertRegex(
                coordinator,
                r"(任务|目标)本身就是当前 `parent_goal` 的授权",
            )
            self.assertIn(
                "plan_digest=<digest> revision=<n> safety.status=<status>",
                coordinator,
            )
            self.assertNotIn("首次计划必须为 `parallel_safe`", coordinator)

    def test_mermaid_is_a_read_only_projection(self) -> None:
        for planner in (
            self.codex_skills["parallel-task-planner"],
            self.claude_skills["parallel-task-planner"],
        ):
            self.assertIn("Mermaid", planner)
            self.assertIn("plan.json", planner)
            self.assertRegex(planner, r"(只读投影|只用于会话展示)")
            self.assertIn("每个", planner)
            self.assertIn("revision", planner)

        for worker in (
            self.codex_skills["thread-goal-worker"],
            self.claude_skills["thread-goal-worker"],
        ):
            self.assertIn("Mermaid", worker)
            self.assertIn("解析 Mermaid", worker)
            self.assertIn("已绑定 task 不是新的顶层父目标", worker)

    def test_claude_revision_and_project_verification_cover_the_full_dag(self) -> None:
        planner = self.claude_skills["parallel-task-planner"]
        templates = self.claude_templates["parallel-task-planner"]
        coordinator = self.claude_skills["thread-coordination"]
        self.assertIn("全部受控基线", planner)
        self.assertIn("已完成 producer", planner)
        self.assertIn("已完成任务不重跑", templates)
        self.assertIn("只聚合", planner)
        self.assertIn("不执行计划外命令", coordinator)
        self.assertIn("不重复运行 build、test、lint", coordinator)

        for skill, templates in (
            (
                self.codex_skills["thread-goal-worker"],
                self.codex_templates["thread-goal-worker"],
            ),
            (
                self.claude_skills["thread-goal-worker"],
                self.claude_templates["thread-goal-worker"],
            ),
        ):
            worker = f"{skill}\n{templates}"
            self.assertIn("scope_request", worker)
            self.assertIn("scope_exception", worker)
            self.assertIn("split_hints", worker)
            self.assertIn("overlap_hints", worker)
            self.assertIn("logical_id", worker)
            self.assertIn("不自动撤销", worker)
            self.assertIn("不是用户确认请求", worker)

    def test_thread_roles_and_titles_are_deterministic(self) -> None:
        for planner, templates in (
            (
                self.codex_skills["parallel-task-planner"],
                self.codex_templates["parallel-task-planner"],
            ),
            (
                self.claude_skills["parallel-task-planner"],
                self.claude_templates["parallel-task-planner"],
            ),
        ):
            contract = f"{planner}\n{templates}"
            self.assertIn("`work`", contract)
            self.assertIn("正式实施", contract)
            self.assertIn("`review`", contract)
            self.assertIn("只读", contract)
            self.assertIn("`verify`", contract)
            self.assertIn('"thread_role": "work"', templates)
            self.assertIn('"thread_role": "review"', templates)
            self.assertIn('"thread_role": "verify"', templates)
            review = next(
                task
                for task in read_json_blocks(templates)[0]["tasks"]
                if task["thread_role"] == "review"
            )
            self.assertEqual(review["writable_paths"], [])
            verify = next(
                task
                for task in read_json_blocks(templates)[0]["tasks"]
                if task["thread_role"] == "verify"
            )
            self.assertEqual(verify["writable_paths"], [])

        for coordinator in (
            self.codex_skills["thread-coordination"],
            self.claude_skills["thread-coordination"],
        ):
            self.assertIn("work -> [实施]", coordinator)
            self.assertIn("review -> [审查]", coordinator)
            self.assertIn("verify -> [验证]", coordinator)
            for marker in (
                "[GA]",
                "[执行]",
                "[完成]",
                "[复核]",
                "[阻塞]",
                "[失败]",
            ):
                self.assertIn(marker, coordinator)
        self.assertIn("[待命]", self.codex_skills["thread-coordination"])
        self.assertIn("[补修]", self.codex_skills["thread-coordination"])

        for worker in (
            self.codex_skills["thread-goal-worker"],
            self.claude_skills["thread-goal-worker"],
        ):
            self.assertIn("`review` 是严格只读", worker)
            self.assertIn("`verify`", worker)
            self.assertIn("changed files 必须为 `[]`", worker)
            self.assertIn("自行升级为实施任务", worker)

        self.assertIn("[GA][实施|审查|验证][状态]", self.all_metadata)

    def test_templates_are_isolated_in_references(self) -> None:
        for root, skills, templates in (
            (CODEX, self.codex_skills, self.codex_templates),
            (CLAUDE, self.claude_skills, self.claude_templates),
        ):
            for name in THREAD_SKILLS:
                reference = root / "skills" / name / "references/templates.md"
                self.assertTrue(reference.is_file())
                self.assertIn("references/templates.md", skills[name])
                self.assertNotIn("```json", skills[name])
                self.assertIn("```json", templates[name])

            planner = skills["parallel-task-planner"]
            planner_templates = templates["parallel-task-planner"]
            self.assertNotIn('"planner": "parallel-task-planner"', planner)
            self.assertNotIn('"continuation": {', planner)
            self.assertIn('"planner": "parallel-task-planner"', planner_templates)
            self.assertIn('"continuation": {', planner_templates)

    def test_parallel_safe_reference_plan_has_two_incomparable_tasks(self) -> None:
        for templates in (
            self.codex_templates["parallel-task-planner"],
            self.claude_templates["parallel-task-planner"],
        ):
            plan = read_json_blocks(templates)[0]
            self.assertEqual(plan["safety"]["status"], "parallel_safe")
            self.assertGreaterEqual(len(plan["tasks"]), 2)
            self.assertTrue(all(not task["depends_on"] for task in plan["tasks"][:2]))
            first_paths = set(plan["tasks"][0]["writable_paths"])
            second_paths = set(plan["tasks"][1]["writable_paths"])
            self.assertTrue(first_paths.isdisjoint(second_paths))
            self.assertNotEqual(
                plan["tasks"][0]["module_id"],
                plan["tasks"][1]["module_id"],
            )

    def test_worker_and_coordinator_templates_match_in_both_platforms(self) -> None:
        for skills, templates in (
            (self.codex_skills, self.codex_templates),
            (self.claude_skills, self.claude_templates),
        ):
            worker = skills["thread-goal-worker"]
            coordinator = skills["thread-coordination"]
            worker_blocks = read_json_blocks(templates["thread-goal-worker"])
            coordinator_blocks = read_json_blocks(templates["thread-coordination"])

            self.assertIn("模板“输入绑定包”章节", worker)
            self.assertIn("## 输入绑定包", templates["thread-goal-worker"])
            self.assertIn("模板“WORKER_RESULT_V3 普通结果”", coordinator)
            self.assertIn(
                "## WORKER_RESULT_V3 写入范围变化",
                templates["thread-coordination"],
            )
            self.assertEqual(worker_blocks[0], coordinator_blocks[0])
            self.assertEqual(worker_blocks[1:3], coordinator_blocks[1:3])

    def test_create_actions_recover_existing_execution_before_creation(self) -> None:
        codex = self.codex_skills["thread-coordination"]
        preflight = codex.index("每个 `create_thread` action 真正创建前")
        lookup = codex.index("list_threads(query=<dispatch_key>)", preflight)
        create = codex.index("零匹配时才按模板调用 `create_thread`", lookup)
        self.assertLess(preflight, lookup)
        self.assertLess(lookup, create)
        self.assertIn("多个匹配时不再创建", codex)

        claude = self.claude_skills["thread-coordination"]
        self.assertIn("真正创建前", claude)
        self.assertIn("唯一匹配时恢复其 id 并直接更新 `running`", claude)
        self.assertIn("零匹配时才创建", claude)
        self.assertIn("多个匹配时保持 `pending`", claude)

    def test_claude_worker_uses_execution_unit_terminology(self) -> None:
        worker = self.claude_skills["thread-goal-worker"]
        metadata = read_metadata(CLAUDE, "thread-goal-worker")
        self.assertIn("# 任务执行单元", worker)
        self.assertIn('display_name: "任务执行单元"', metadata)
        self.assertNotIn("任务执行线程", worker)
        self.assertNotIn("任务执行线程", metadata)

    def test_thread_skill_descriptions_are_chinese(self) -> None:
        for skill in (*self.codex_skills.values(), *self.claude_skills.values()):
            description = next(
                line.removeprefix("description: ")
                for line in skill.splitlines()
                if line.startswith("description: ")
            )
            self.assertNotIn("Use when", description)
            self.assertTrue(any("\u4e00" <= char <= "\u9fff" for char in description))

        for root in (CODEX, CLAUDE):
            for name in THREAD_SKILLS:
                metadata = read_metadata(root, name)
                for key in ("display_name", "short_description", "default_prompt"):
                    value = next(
                        line.split(":", 1)[1]
                        for line in metadata.splitlines()
                        if line.strip().startswith(f"{key}:")
                    )
                    self.assertTrue(
                        any("\u4e00" <= char <= "\u9fff" for char in value),
                        f"{root}/{name} {key}",
                    )

    def test_all_thread_skills_remove_batch_and_capacity_terms(self) -> None:
        for legacy in (
            "dispatch.batches",
            "batch barrier",
            "线程池",
            "并发上限",
            "plan_format_version: 2",
            "plan_format_version: 1",
            "需要扩大 scope 时停止",
            '"id": "build-verification"',
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
        self.assertIn("任务 DAG", self.all_metadata)
        self.assertNotIn("拓扑 batch", self.all_metadata)
        self.assertIn("verify", self.all_metadata)
        self.assertIn("result_path", self.all_metadata)
        self.assertNotIn("等待绑定包", self.all_metadata)

    def test_plugin_versions_are_incremented(self) -> None:
        codex_manifest = json.loads(
            (CODEX / ".codex-plugin/plugin.json").read_text(encoding="utf-8")
        )
        claude_manifest = json.loads(
            (CLAUDE / ".claude-plugin/plugin.json").read_text(encoding="utf-8")
        )
        self.assertTrue(codex_manifest["version"].startswith("0.7.2+codex."))
        self.assertEqual(claude_manifest["version"], "0.3.4")


if __name__ == "__main__":
    unittest.main()
