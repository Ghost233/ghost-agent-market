import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "codex-market/plugins/ghost-agent-workflow"
LOCAL_GIT_COMMIT = ROOT / ".codex/skills/git-commit"
LOCAL_DIRECT_MODEL_TEST = ROOT / ".codex/skills/git-commit-direct-model-test"
AGENTS = ROOT / "AGENTS.md"
WORKFLOW_CONFIG_UPDATER = ROOT / "tooling/goal-dag/update-thread-workflow-configs.mjs"


def read(relative: str) -> str:
    return (PLUGIN / relative).read_text(encoding="utf-8")


class CodexWorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.coordinator = read("skills/sub-thread-coordination/SKILL.md")
        cls.coordinator_reference = read(
            "skills/sub-thread-coordination/references/templates.md"
        )
        cls.goal_contract = read(
            "skills/sub-thread-coordination/references/goal-contract.md"
        )
        cls.coordinator_metadata = read(
            "skills/sub-thread-coordination/agents/openai.yaml"
        )
        cls.planner = read("skills/parallel-task-planner/SKILL.md")
        cls.worker = read("skills/sub-thread-goal-worker/SKILL.md")
        cls.worker_reference = read("skills/sub-thread-goal-worker/references/templates.md")
        cls.supervisor = read("skills/sub-thread-task-supervisor/SKILL.md")
        cls.supervisor_metadata = read(
            "skills/sub-thread-task-supervisor/agents/openai.yaml"
        )
        cls.git_commit = read("skills/git-commit/SKILL.md")
        cls.git_commit_metadata = read("skills/git-commit/agents/openai.yaml")
        cls.direct_model_test = read("skills/git-commit-direct-model-test/SKILL.md")
        cls.direct_model_test_metadata = read(
            "skills/git-commit-direct-model-test/agents/openai.yaml"
        )

    def test_codex_workflow_uses_persistent_threads_and_dedicated_supervision(self) -> None:
        combined = f"{self.coordinator}\n{self.coordinator_metadata}"
        for requirement in (
            "长期子线程",
            "监督线程",
            "DAG 视图线程",
            "gpt-5.6-luna/low",
            "THREAD_TASK_RECEIPT_V1",
            "thread-registry init",
        ):
            self.assertIn(requirement, combined)
        self.assertIn("禁止使用 subagent", self.coordinator)
        self.assertIn("系统 key", self.coordinator)
        self.assertIn("[GA][TASK][OWNER]", self.coordinator)
        self.assertIn("[GA][TASK][RUNTIME]", self.coordinator)
        self.assertIn("[GA][TASK][SUPERVISOR]", self.coordinator)
        self.assertIn("[GA][TASK][DAG_VIEW]", self.coordinator)
        self.assertIn("[GA][TASK][MAIN]", self.coordinator)
        self.assertIn("不使用 nonce", self.coordinator)
        self.assertIn("必须恰好一个", self.coordinator)
        self.assertIn("TASK_BINDING_V6", self.coordinator)
        self.assertIn("$sub-thread-goal-worker", self.coordinator)
        self.assertIn("$parallel-task-planner", self.coordinator)
        self.assertIn("default_prompt:", self.coordinator_metadata)
        self.assertIn("allow_implicit_invocation: false", self.coordinator_metadata)
        self.assertIn("standalone_thread", combined)

    def test_task_supervisor_only_waits_and_notifies_main(self) -> None:
        combined = f"{self.supervisor}\n{self.supervisor_metadata}"
        for requirement in (
            "gpt-5.6-luna/low",
            "wait_threads",
            "send_message_to_thread",
            "不透明内容",
            "active watch 非空",
            "请主线程检查",
            "TASK_STALLED",
            "连续三次",
            "$sub-thread-task-supervisor",
            "allow_implicit_invocation: false",
        ):
            self.assertIn(requirement, combined)
        self.assertIn("禁止实施、分析、验收、调度", self.supervisor)
        self.assertIn("不得自行废弃、关闭或重启线程", self.supervisor)

    def test_owner_affinity_is_permanent_and_fenced(self) -> None:
        combined = "\n".join(
            (
                self.coordinator,
                self.coordinator_reference,
                self.planner,
                self.worker,
                self.worker_reference,
            )
        )
        for invariant in (
            "Owner Capsule",
            "generation",
            "approved Owner Registry",
            "可继续 Goal",
            "reclaim",
        ):
            self.assertIn(invariant, combined)

    def test_worker_submits_minimal_result_and_runtime_builds_v5(self) -> None:
        combined = f"{self.worker}\n{self.worker_reference}"
        for contract in (
            "TASK_BINDING_V6",
            "TASK_RESULT_INPUT_V2",
            "WORKER_RESULT_V5",
            "THREAD_TASK_RECEIPT_V1",
        ):
            self.assertIn(contract, combined)
        self.assertIn("result-submit", combined)
        self.assertIn("subgraph-request", combined)
        self.assertIn("不要构造 `WORKER_RESULT_V5`", combined)
        self.assertIn("runtime 自动补齐 identity", combined)
        self.assertIn("不要填写 task identity", combined)
        self.assertIn("checkpoint-save", combined)
        self.assertIn("source-audit-auto", combined)

    def test_goal_is_optional_and_native_bridge_follows_local_finalize(self) -> None:
        combined = f"{self.coordinator}\n{self.goal_contract}"
        self.assertIn("standalone_thread", combined)
        self.assertIn("codex_native", combined)
        self.assertIn("默认 `standalone_thread`", self.goal_contract)
        self.assertIn("本地 finalize 后才完成原生 Goal", self.goal_contract)

    def test_recovery_uses_canonical_binding_and_fences_stale_threads(self) -> None:
        combined = f"{self.coordinator}\n{self.coordinator_reference}"
        self.assertIn("`reserved` 且未 bind", combined)
        self.assertIn("`running` 且无结果", combined)
        self.assertIn("reclaim", self.coordinator)
        self.assertIn("status -> reconcile", self.coordinator_reference)
        self.assertIn("canonical binding", self.coordinator)
        self.assertIn("TASK_STALLED", combined)

    def test_expected_skill_directories_are_present(self) -> None:
        actual_skills = {
            path.name
            for path in (PLUGIN / "skills").iterdir()
            if path.is_dir() and (path / "SKILL.md").is_file()
        }
        self.assertEqual(
            actual_skills,
            {
                "git-commit",
                "git-commit-direct-model-test",
                "parallel-task-planner",
                "start-dag-dashboard",
                "sub-thread-coordination",
                "sub-thread-goal-worker",
                "sub-thread-task-supervisor",
            },
        )

    def test_git_commit_selects_one_no_fork_executor_model_agent(self) -> None:
        combined = f"{self.git_commit}\n{self.git_commit_metadata}"
        self.assertIn('agent_type: "default"', combined)
        self.assertIn('fork_turns: "none"', self.git_commit)
        self.assertIn('fork_context: false', self.git_commit)
        self.assertIn("GIT_COMMIT_ANALYSIS_V1", self.git_commit)
        self.assertIn("wait_agent", self.git_commit)
        self.assertIn("主线程是唯一 Git 写入者", self.git_commit)
        self.assertIn("不得让子代理暂存、提交、修改文件", self.git_commit)
        self.assertIn('names.has("multi_agent_v1__spawn_agent")', self.git_commit)
        self.assertIn('names.has("multi_agent_v1__wait_agent")', self.git_commit)
        self.assertIn("multi_agent_v1:executor-model/no-fork", combined)
        self.assertIn("spawn_agent:executor-model/no-fork", combined)
        self.assertIn("使用本次执行 `git-commit` 的主线程模型与推理配置", self.git_commit)
        self.assertNotIn("model:", self.git_commit)
        self.assertNotIn("reasoning_effort:", self.git_commit)
        for hardcoded_model in (
            "gpt-5.3-codex-spark",
            "gpt-5.6-sol",
            "gpt-5.6-terra",
            "gpt-5.6-luna",
        ):
            self.assertNotIn(hardcoded_model, combined)
        self.assertNotIn("create_thread", self.git_commit)
        self.assertNotIn("list_projects", self.git_commit)
        self.assertNotIn("wait_threads", self.git_commit)
        self.assertNotIn("gpt-5.6-luna", self.git_commit)
        self.assertIn("主线程复核", self.git_commit)
        self.assertIn("DELIVERY_MANIFEST_V1", self.git_commit)
        self.assertIn("delivery-validate", self.git_commit)
        self.assertIn("不得读取 `git diff`", self.git_commit)

    def test_git_commit_has_no_dedicated_agent_config(self) -> None:
        matching_configs = list((ROOT / ".codex/agents").glob("*git*commit*"))
        self.assertEqual(matching_configs, [])

    def test_direct_model_test_uses_fixed_serial_matrix_without_custom_agents(self) -> None:
        skill = self.direct_model_test
        expected_order = (
            '1. `spawn_agent` + `gpt-5.3-codex-spark`',
            '2. `create_thread` + `gpt-5.3-codex-spark`',
            '3. `spawn_agent` + `gpt-5.6-luna`',
            '4. `create_thread` + `gpt-5.6-luna`',
        )
        positions = [skill.index(item) for item in expected_order]
        self.assertEqual(positions, sorted(positions))
        for invariant in (
            'agent_type: "default"',
            'fork_turns: "none"',
            "不得读取 agent 配置",
            "必须进行一次真实 `spawn_agent` 调用",
            "任何单项失败都必须记录并继续后续 case",
            "DIRECT_MODEL_TEST_V1",
            "wait_agent",
            "wait_threads",
            "不自动归档",
        ):
            self.assertIn(invariant, skill)
        self.assertNotIn("git_commit_worker", skill)
        self.assertIn("$git-commit-direct-model-test", self.direct_model_test_metadata)

    def test_project_direct_model_test_copy_matches_marketplace_source(self) -> None:
        self.assertEqual(
            (LOCAL_DIRECT_MODEL_TEST / "SKILL.md").read_text(encoding="utf-8"),
            self.direct_model_test,
        )
        self.assertEqual(
            (LOCAL_DIRECT_MODEL_TEST / "agents/openai.yaml").read_text(
                encoding="utf-8"
            ),
            self.direct_model_test_metadata,
        )

    def test_project_git_commit_copy_matches_marketplace_source(self) -> None:
        self.assertEqual(
            (LOCAL_GIT_COMMIT / "SKILL.md").read_text(encoding="utf-8"),
            self.git_commit,
        )
        self.assertEqual(
            (LOCAL_GIT_COMMIT / "agents/openai.yaml").read_text(encoding="utf-8"),
            self.git_commit_metadata,
        )

    def test_manifest_and_repository_rules_are_current(self) -> None:
        manifest = json.loads(read(".codex-plugin/plugin.json"))
        self.assertRegex(manifest["version"], r"^1\.0\.7\+codex\.")
        self.assertIn("长期 Codex 子线程", manifest["description"])
        self.assertIn("Review", manifest["description"])
        prompt = manifest["interface"]["defaultPrompt"][0]
        self.assertEqual(
            prompt,
            "使用 $sub-thread-coordination，以长期子线程完整执行 `./plan.md`；默认不创建 Goal。",
        )
        self.assertNotIn("首次建图", prompt)
        self.assertTrue(
            any(
                "$git-commit-direct-model-test" in item
                for item in manifest["interface"]["defaultPrompt"]
            )
        )
        instructions = AGENTS.read_text(encoding="utf-8")
        self.assertIn("基础版本每次增加", instructions)
        self.assertIn("任一段达到", instructions)

        updater = WORKFLOW_CONFIG_UPDATER.read_text(encoding="utf-8")
        self.assertIn("function bumpBase", updater)
        self.assertIn("--bump-base", updater)
        self.assertNotIn("goalFixturePath", updater)
        self.assertNotIn("planFixturePath", updater)
        self.assertNotRegex(updater, r"codexManifest\.version\s*=\s*`\d")


if __name__ == "__main__":
    unittest.main()
