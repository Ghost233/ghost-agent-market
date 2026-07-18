import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "codex-market/plugins/ghost-agent-workflow"
LOCAL_GIT_COMMIT = ROOT / ".codex/skills/git-commit"
AGENTS = ROOT / "AGENTS.md"


def read(relative: str) -> str:
    return (PLUGIN / relative).read_text(encoding="utf-8")


class CodexChildThreadContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.planner = read("skills/parallel-task-planner/SKILL.md")
        cls.planner_templates = read(
            "skills/parallel-task-planner/references/templates.md"
        )
        cls.coordinator = read("skills/thread-coordination/SKILL.md")
        cls.coordinator_templates = read(
            "skills/thread-coordination/references/templates.md"
        )
        cls.worker = read("skills/thread-goal-worker/SKILL.md")
        cls.worker_templates = read(
            "skills/thread-goal-worker/references/templates.md"
        )
        cls.git_commit = read("skills/git-commit/SKILL.md")
        cls.metadata = "\n".join(
            read(path)
            for path in (
                "skills/parallel-task-planner/agents/openai.yaml",
                "skills/thread-coordination/agents/openai.yaml",
                "skills/thread-goal-worker/agents/openai.yaml",
                "skills/git-commit/agents/openai.yaml",
            )
        )
        cls.thread_metadata = "\n".join(
            read(path)
            for path in (
                "skills/thread-coordination/agents/openai.yaml",
                "skills/thread-goal-worker/agents/openai.yaml",
            )
        )

    def test_planner_emits_fresh_v3_dag(self) -> None:
        contract = f"{self.planner}\n{self.planner_templates}"
        self.assertIn("plan_format_version", contract)
        self.assertIn("execution_platform", contract)
        self.assertIn('"execution_platform": "codex"', contract)
        self.assertIn(".ghost-agent-workflow/parallel_plan", self.planner)
        self.assertIn("gpt-5.6-sol/medium", self.planner)
        self.assertIn("新的 `parent_goal`", self.planner)
        self.assertIn("不同 `parent_goal` 之间绝不复用", self.planner)
        self.assertNotIn('"dispatch"', self.planner_templates)
        self.assertIn("至少包含一个中文汉字", self.planner)

    def test_coordinator_uses_codex_thread_tools(self) -> None:
        contract = f"{self.coordinator}\n{self.coordinator_templates}"
        for tool in (
            "list_projects",
            "list_threads",
            "create_thread",
            "read_thread",
            "send_message_to_thread",
            "set_thread_title",
        ):
            self.assertIn(tool, contract)
        self.assertIn("environment: {type: local}", contract)
        self.assertIn("dispatch_task", contract)
        self.assertIn("dispatch_key", contract)
        self.assertIn("thread-plan.mjs mode", contract)
        self.assertIn("<state_path> thread", contract)
        self.assertIn("普通错误文本不能当作 JSON 解析", contract)
        self.assertIn("model=gpt-5.6-sol", contract)
        self.assertIn("thinking=medium", contract)
        self.assertIn("create_thread:gpt-5.6-sol/medium", contract)

    def test_thread_skills_require_sol_medium(self) -> None:
        combined = "\n".join(
            (self.coordinator, self.coordinator_templates, self.worker, self.worker_templates)
        )
        self.assertIn("gpt-5.6-sol/medium", combined)
        self.assertIn('"model": "gpt-5.6-sol"', combined)
        self.assertIn('"reasoning_effort": "medium"', combined)
        self.assertNotIn("gpt-5.6-terra", combined)

    def test_thread_reuse_is_limited_to_current_parent_goal(self) -> None:
        contract = f"{self.planner}\n{self.coordinator}\n{self.worker}"
        self.assertIn("当前父目标内", contract)
        self.assertIn("不得跨 `parent_goal`", contract)
        self.assertIn("首次派发创建", contract)
        self.assertIn("后续 task 和 revision 复用", contract)
        self.assertNotIn("reuse_existing_thread", contract)
        self.assertNotIn("continuation.reuse", contract)
        self.assertNotIn("永久 claim", contract)

    def test_threads_use_ga_titles_and_are_retained(self) -> None:
        self.assertIn("[GA][<用途>][<状态>]", self.coordinator)
        for label in ("实施", "审查", "验证", "待命", "执行", "完成", "复核", "阻塞", "失败"):
            self.assertIn(label, self.coordinator)
        self.assertIn("不自动归档", self.coordinator)
        self.assertNotIn("set_thread_archived", self.coordinator)
        self.assertIn("<中文任务名>", self.coordinator)
        self.assertNotIn("<logical_id> · <title>", self.coordinator)
        self.assertIn('"display_name":', self.worker_templates)

    def test_worker_contract_is_scoped_and_atomic(self) -> None:
        contract = f"{self.worker}\n{self.worker_templates}"
        self.assertIn("任一时刻只能有一个活动 task", self.worker)
        self.assertIn("不得继承上一 task 的权限或证据", self.worker)
        self.assertIn("`review`", self.worker)
        self.assertIn("`verify`", self.worker)
        self.assertIn("WORKER_RESULT_V3", contract)
        self.assertIn("WORKER_REPAIR_V3", contract)
        self.assertIn("result_path", contract)
        self.assertIn("原子写入", contract)
        self.assertIn("scope_request", contract)

    def test_codex_skills_do_not_reference_claude(self) -> None:
        for skill in (PLUGIN / "skills").rglob("SKILL.md"):
            self.assertNotIn("claude", skill.read_text(encoding="utf-8").lower(), skill)

    def test_metadata_is_chinese_and_current(self) -> None:
        self.assertIn("任务 DAG", self.metadata)
        self.assertIn("明确", self.metadata)
        self.assertIn("完整单任务绑定包", self.metadata)
        self.assertNotIn("子代理", self.thread_metadata)

    def test_git_commit_uses_readonly_worker_then_main_thread_commits(self) -> None:
        combined = f"{self.git_commit}\n{self.metadata}"
        self.assertIn('agent_type: "git_commit_worker"', combined)
        self.assertIn('fork_turns: "none"', self.git_commit)
        self.assertIn("GIT_COMMIT_ANALYSIS_V1", self.git_commit)
        self.assertIn("wait_agent", self.git_commit)
        self.assertIn("主线程是唯一 Git 写入者", self.git_commit)
        self.assertIn("不得让子代理暂存、提交、修改文件", self.git_commit)
        self.assertIn("必须以一次真实 `spawn_agent` 调用结果为准", self.git_commit)
        self.assertIn("git_commit_worker:gpt-5.3-codex-spark/high", combined)
        self.assertIn('model: "gpt-5.6-luna"', self.git_commit)
        self.assertIn('thinking: "medium"', self.git_commit)
        self.assertIn("`spawn_agent` 当前不支持 `gpt-5.6-luna`", self.git_commit)
        self.assertIn("create_thread:gpt-5.6-luna/medium fallback", self.git_commit)
        self.assertIn("list_projects", self.git_commit)
        self.assertIn("create_thread", self.git_commit)
        self.assertIn("set_thread_title", self.git_commit)
        self.assertIn("read_thread(includeOutputs: true)", self.git_commit)
        self.assertIn("主分析返回合法 `status: \"blocked\"`", self.git_commit)
        self.assertIn("不得修改文件、继续委派或再次 fallback", self.git_commit)
        self.assertIn('prefix_rule: ["rtk", "git", "add"]', self.git_commit)
        self.assertIn('prefix_rule: ["rtk", "git", "commit"]', self.git_commit)
        self.assertNotIn("GIT_COMMIT_EXECUTOR=1", combined)
        self.assertNotIn("send_message_to_thread", combined)

    def test_project_git_commit_copy_matches_marketplace_source(self) -> None:
        self.assertEqual(
            (LOCAL_GIT_COMMIT / "SKILL.md").read_text(encoding="utf-8"),
            self.git_commit,
        )
        self.assertEqual(
            (LOCAL_GIT_COMMIT / "agents/openai.yaml").read_text(encoding="utf-8"),
            read("skills/git-commit/agents/openai.yaml"),
        )

    def test_agents_requires_decimal_version_increment(self) -> None:
        instructions = AGENTS.read_text(encoding="utf-8")
        self.assertIn("基础版本每次增加 `0.0.1`", instructions)
        self.assertIn("任一段达到 `10` 时向左进位", instructions)

    def test_manifest_and_readme_describe_current_scope(self) -> None:
        manifest = json.loads(read(".codex-plugin/plugin.json"))
        readme = read("README.md")
        self.assertTrue(manifest["version"].startswith("0.8.2+codex."))
        self.assertIn("子线程", manifest["description"])
        self.assertIn("子代理", manifest["description"])
        self.assertIn("不提供默认执行模式", manifest["description"])
        self.assertIn("新的顶层任务不会复用旧执行单元", readme)
        self.assertNotIn("subagent-coordination", json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    unittest.main()
