import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "codex-market/plugins/ghost-agent-workflow"
SKILLS_PLUGIN = ROOT / "codex-market/plugins/ghost-agent-skills"
LOCAL_GIT_COMMIT = ROOT / ".codex/skills/git-commit"
LOCAL_DIRECT_MODEL_TEST = ROOT / ".codex/skills/git-commit-direct-model-test"
AGENTS = ROOT / "AGENTS.md"
WORKFLOW_CONFIG_UPDATER = ROOT / "tooling/goal-dag/update-thread-workflow-configs.mjs"


def read(relative: str) -> str:
    return (PLUGIN / relative).read_text(encoding="utf-8")


def read_standalone(relative: str) -> str:
    return (SKILLS_PLUGIN / relative).read_text(encoding="utf-8")


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
        cls.planner_reviewer = read("skills/planner-reviewer/SKILL.md")
        cls.worker = read("skills/sub-thread-goal-worker/SKILL.md")
        cls.worker_reference = read("skills/sub-thread-goal-worker/references/templates.md")
        cls.supervisor = read("skills/sub-thread-task-supervisor/SKILL.md")
        cls.supervisor_metadata = read(
            "skills/sub-thread-task-supervisor/agents/openai.yaml"
        )
        cls.setup = read("skills/setup-sub-thread-workflow/SKILL.md")
        cls.setup_metadata = read("skills/setup-sub-thread-workflow/agents/openai.yaml")
        cls.git_commit = read_standalone("skills/git-commit/SKILL.md")
        cls.git_commit_metadata = read_standalone(
            "skills/git-commit/agents/openai.yaml"
        )
        cls.direct_model_test = read_standalone(
            "skills/git-commit-direct-model-test/SKILL.md"
        )
        cls.direct_model_test_metadata = read_standalone(
            "skills/git-commit-direct-model-test/agents/openai.yaml"
        )

    def test_codex_workflow_uses_quick_owner_and_dag_supervisor(self) -> None:
        combined = (
            f"{self.coordinator}\n{self.coordinator_metadata}\n"
            f"{self.supervisor}\n{self.supervisor_metadata}"
        )
        for requirement in (
            "长期 Owner 线程",
            "supervisor start",
            "supervisor next",
            "supervisor ack",
            "supervisor inspect",
            "supervisor stop",
            "gpt-5.6-luna/medium",
            "gpt-5.6-sol/high",
            "workflow start-dag",
            "必须由用户明确选择",
        ):
            self.assertIn(requirement, combined)
        self.assertIn("禁止 subagent", self.coordinator)
        self.assertIn("同时只能有一个 Main", self.coordinator)
        self.assertIn("$sub-thread-goal-worker", self.coordinator)
        self.assertIn("$parallel-task-planner", self.coordinator)
        self.assertIn("$sub-thread-task-supervisor", self.coordinator)
        self.assertIn("禁止读取 Plan、State、Registry、Binding、Result", self.supervisor)
        self.assertIn("脚本 JSON 只作机器收据", self.coordinator)
        self.assertIn("workflow supervisor-init", self.coordinator)
        self.assertIn("Supervisor 必须早于 Planner", self.coordinator_reference)
        self.assertIn("Main 自己绝不调用 `wait_threads`", self.coordinator)
        self.assertIn("Supervisor 不创建或复用执行线程", self.supervisor)
        self.assertIn("`kind: main`", self.supervisor)
        self.assertIn("独立 worktree", self.supervisor)
        self.assertIn("禁止 Orca", self.supervisor)
        self.assertIn("Main 不调用 `wait_threads`", self.coordinator)
        self.assertIn("当前会话立即停止", self.coordinator)
        self.assertIn("完全不创建、切换、合并或删除 Git 分支/worktree", self.coordinator)
        self.assertIn("删除全部 Owner/DAG worktree 与分支", self.coordinator)
        self.assertIn(".ghost-agent-workflow/result.json", self.goal_contract)
        self.assertIn("supervisor ack <goal-dir> <action-id> <thread> <host> bootstrap", self.coordinator)
        self.assertIn("禁止 `fork_thread`", self.coordinator)
        self.assertIn("最多 100 字", self.worker)
        self.assertIn("用户可见文本不显示 `result_ref`", self.supervisor)
        self.assertIn("调用 `get_goal`", self.supervisor)
        self.assertIn("调用 `create_goal`", self.supervisor)
        self.assertIn("只重新执行 `supervisor next`", self.supervisor)
        self.assertIn("同一时间不得存在两个 Supervisor Goal", self.supervisor)
        self.assertIn("只有同一个真实 runtime/权限阻塞", self.supervisor)
        self.assertIn("`latestTurn.status`", self.supervisor)
        self.assertIn("禁止传 `thread.status.type`", self.supervisor)
        self.assertIn("全部 ack 成功后", self.supervisor)
        self.assertIn("timeoutMs=120000", self.supervisor)
        self.assertIn("累计十轮", self.supervisor)
        self.assertIn("read_thread", self.supervisor)
        self.assertIn("`status_document`", self.supervisor)
        self.assertIn("supervisor_notify", self.worker)
        self.assertIn("send_message_to_thread", self.worker)
        self.assertIn("supervisor-resume", self.coordinator)
        self.assertIn("当前项目 `.ghost-agent-workflow`", self.supervisor)
        self.assertNotIn("插件缓存", self.supervisor)
        self.assertNotIn("runtime_ref", self.supervisor)
        self.assertNotIn("runtime_ref", self.coordinator)
        self.assertIn("default_prompt:", self.coordinator_metadata)
        self.assertIn("allow_implicit_invocation: false", self.coordinator_metadata)
        self.assertIn("standalone_thread", combined)

    def test_setup_skill_manages_profiles_and_parallel_by_script(self) -> None:
        combined = f"{self.setup}\n{self.setup_metadata}"
        for requirement in (
            "workflow-config.mjs ensure",
            "set-parallel",
            "set-profile",
            "gpt-5.6-sol/xhigh",
            "gpt-5.6-sol/high",
            "parallel: 8",
            "$setup-sub-thread-workflow",
            "allow_implicit_invocation: false",
        ):
            self.assertIn(requirement, combined)
        self.assertIn("不得手写", self.setup)
        self.assertIn("DAG 模式的 1–8 并发上限", self.setup)
        self.assertIn(".ghost-agent-workflow/.gitignore", self.setup)

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
            "当前 Owner 上下文",
            "approved Owner",
            "preferred_thread",
            "run-id",
        ):
            self.assertIn(invariant, combined)

    def test_worker_uses_action_commands_instead_of_result_json(self) -> None:
        combined = f"{self.worker}\n{self.worker_reference}"
        for command in (
            "worker open",
            "worker verify",
            "worker complete",
            "worker block",
            "worker fail",
            "worker request-dag",
            "worker request-scope",
        ):
            self.assertIn(command, combined)
        self.assertIn("禁止调用 `result-submit`", combined)
        self.assertIn("构造 Binding/Result", combined)

    def test_planner_reviewer_is_a_pre_activation_two_round_gate(self) -> None:
        combined = f"{self.coordinator}\n{self.planner_reviewer}"
        for requirement in (
            "planner-review <goal-dir> pass",
            "parallelism|too-complex|too-simple",
            "不构造 Review JSON",
            "最多修订一次",
        ):
            self.assertIn(requirement, combined)

    def test_goal_is_optional_and_native_bridge_follows_local_finalize(self) -> None:
        combined = f"{self.coordinator}\n{self.goal_contract}"
        self.assertIn("codex_native", combined)
        self.assertIn("Quick 不创建原生 Goal", self.goal_contract)
        self.assertIn("不映射为 blocked", self.goal_contract)
        self.assertIn("Supervisor 在自己的线程内按需创建原生 Goal", self.coordinator)
        self.assertIn("按需创建原生 Goal", self.goal_contract)
        self.assertIn("create|wait|notify|stop", self.goal_contract)
        self.assertIn("没有 active 任务时才允许 `stop`", self.goal_contract)
        self.assertIn("同一时间不得存在两个 Supervisor Goal", self.supervisor)
        self.assertIn("update_goal(status=complete)", self.supervisor)

    def test_recovery_uses_script_state_instead_of_chat_history(self) -> None:
        combined = f"{self.coordinator}\n{self.coordinator_reference}"
        self.assertIn("聊天不是状态源", combined)
        self.assertIn("workflow start-dag <当前 DAG worktree> <相同 development-key>", combined)
        self.assertIn("workflow step <goal-dir>", combined)
        self.assertIn("supervisor next <goal-dir>", combined)
        self.assertIn("成功验收后立即删除当前临时文件", combined)

    def test_expected_skill_directories_are_present(self) -> None:
        actual_skills = {
            path.name
            for path in (PLUGIN / "skills").iterdir()
            if path.is_dir() and (path / "SKILL.md").is_file()
        }
        self.assertEqual(
            actual_skills,
            {
                "parallel-task-planner",
                "planner-reviewer",
                "setup-sub-thread-workflow",
                "start-dag-dashboard",
                "sub-thread-coordination",
                "sub-thread-goal-worker",
                "sub-thread-task-supervisor",
            },
        )
        standalone_skills = {
            path.name
            for path in (SKILLS_PLUGIN / "skills").iterdir()
            if path.is_dir() and (path / "SKILL.md").is_file()
        }
        self.assertEqual(
            standalone_skills,
            {"git-commit", "git-commit-direct-model-test"},
        )

    def test_git_commit_uses_nested_executor_reviewer_flow(self) -> None:
        combined = f"{self.git_commit}\n{self.git_commit_metadata}"
        for requirement in (
            "ROLE=dispatcher",
            "ROLE=executor",
            "ROLE=reviewer",
            "gpt-5.6-terra",
            "思考强度固定为 `medium`",
            'fork_turns: "none"',
            "fork_context",
            'task_name: "git_commit_executor"',
            'task_name: "git_commit_reviewer"',
            "followup_task",
            "不复制主线程聊天历史",
            "主线程不得重复检查仓库",
            "执行全部暂存、提交和最终核验",
            "不得创建任何代理",
            "默认最多使用 6 个工具回合",
            "Promise.all",
            "优先复用原 executor 和 reviewer",
            "git diff --cached --check",
            "git add -- <paths>",
            "Co-Authored-By: Nexus <nexus@xfinite.global>",
        ):
            self.assertIn(requirement, combined)
        for removed_constraint in (
            "Owner",
            "Goal",
            "DAG",
            "sub-thread",
            "parallel",
            "profile_evidence",
            "GIT_COMMIT_ANALYSIS_V1",
            "multi_agent_v1",
            "delivery-validate",
        ):
            self.assertNotIn(removed_constraint, combined)

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
        self.assertEqual(
            (
                ROOT
                / "claude-code-market/plugins/ghost-agent-skills/skills/git-commit/SKILL.md"
            ).read_text(
                encoding="utf-8"
            ),
            self.git_commit,
        )
        self.assertEqual(
            (
                ROOT
                / "kimi-market/plugins/ghost-agent-skills/skills/git-commit/SKILL.md"
            ).read_text(encoding="utf-8"),
            self.git_commit,
        )

    def test_manifest_and_repository_rules_are_current(self) -> None:
        manifest = json.loads(read(".codex-plugin/plugin.json"))
        self.assertRegex(manifest["version"], r"^1\.4\.6\+codex\.")
        self.assertIn("Quick Owner", manifest["description"])
        self.assertIn("Review", manifest["description"])
        prompt = manifest["interface"]["defaultPrompt"][0]
        self.assertEqual(
            prompt,
            "使用 $sub-thread-coordination 执行 `./plan.md`；如果我未指定 Quick 或 DAG，先要求我选择运行模式。",
        )
        self.assertNotIn("首次建图", prompt)
        self.assertFalse(
            any("$git-commit" in item for item in manifest["interface"]["defaultPrompt"])
        )
        standalone_manifest = json.loads(
            read_standalone(".codex-plugin/plugin.json")
        )
        self.assertEqual(standalone_manifest["name"], "ghost-agent-skills")
        self.assertRegex(standalone_manifest["version"], r"^0\.1\.1\+codex\.")
        self.assertTrue(
            any(
                "$git-commit-direct-model-test" in item
                for item in standalone_manifest["interface"]["defaultPrompt"]
            )
        )
        codex_marketplace = json.loads(
            (
                ROOT / "codex-market/.agents/plugins/marketplace.json"
            ).read_text(encoding="utf-8")
        )
        codex_entries = {
            entry["name"]: entry for entry in codex_marketplace["plugins"]
        }
        self.assertEqual(
            codex_entries["ghost-agent-skills"]["source"]["path"],
            "./plugins/ghost-agent-skills",
        )
        root_marketplace = json.loads(
            (ROOT / ".agents/plugins/marketplace.json").read_text(encoding="utf-8")
        )
        root_entries = {
            entry["name"]: entry for entry in root_marketplace["plugins"]
        }
        self.assertEqual(
            root_entries["ghost-agent-skills"]["source"]["path"],
            "./codex-market/plugins/ghost-agent-skills",
        )
        claude_marketplace = json.loads(
            (
                ROOT / "claude-code-market/.claude-plugin/marketplace.json"
            ).read_text(encoding="utf-8")
        )
        claude_entries = {
            entry["name"]: entry for entry in claude_marketplace["plugins"]
        }
        self.assertEqual(
            claude_entries["ghost-agent-skills"]["source"],
            "./plugins/ghost-agent-skills",
        )
        instructions = AGENTS.read_text(encoding="utf-8")
        self.assertIn("基础版本每次增加", instructions)
        self.assertIn("任一段达到", instructions)
        self.assertIn(
            "!.ghost-agent-workflow/config.json",
            (ROOT / ".gitignore").read_text(encoding="utf-8"),
        )
        self.assertIn(
            "!.ghost-agent-workflow/.gitignore",
            (ROOT / ".gitignore").read_text(encoding="utf-8"),
        )

        updater = WORKFLOW_CONFIG_UPDATER.read_text(encoding="utf-8")
        self.assertIn("function bumpBase", updater)
        self.assertIn("--bump-base", updater)
        self.assertNotIn("goalFixturePath", updater)
        self.assertNotIn("planFixturePath", updater)
        self.assertNotRegex(updater, r"codexManifest\.version\s*=\s*`\d")


if __name__ == "__main__":
    unittest.main()
