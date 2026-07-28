import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
MARKET = ROOT / "kimi-market"
MARKETPLACE = MARKET / ".kimi-plugin/marketplace.json"
REMOTE_MARKETPLACE = MARKET / ".kimi-plugin/marketplace-remote.json"
RELEASE_WORKFLOW = ROOT / ".github/workflows/kimi-market-release.yml"
RELEASE_ZIP_URL = (
    "https://github.com/Ghost233/ghost-agent-market"
    "/releases/download/kimi-latest/ghost-agent-workflow-kimi.zip"
)
PLUGIN = MARKET / "plugins/ghost-agent-workflow"
RUNTIME = PLUGIN / "scripts/goal-dag.mjs"
SKILLS = (
    "parallel-task-planner",
    "sub-thread-coordination",
    "sub-thread-goal-worker",
    "sub-thread-task-supervisor",
    "git-commit",
    "start-dag-dashboard",
)


def read(relative: str) -> str:
    return (PLUGIN / relative).read_text(encoding="utf-8")


class KimiWorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.runtime = RUNTIME.read_text(encoding="utf-8")
        cls.skill_texts = {name: read(f"skills/{name}/SKILL.md") for name in SKILLS}

    def test_kimi_plugin_manifest_is_current(self) -> None:
        manifest = json.loads(read("kimi.plugin.json"))
        self.assertEqual(manifest["name"], "ghost-agent-workflow")
        self.assertEqual(manifest["version"], "0.2.4")
        self.assertEqual(manifest["skills"], "./skills/")
        self.assertIn("长期子线程", manifest["description"])
        self.assertIn("Review", manifest["description"])

    def test_marketplace_manifest_points_at_existing_plugin(self) -> None:
        marketplace = json.loads(MARKETPLACE.read_text(encoding="utf-8"))
        self.assertEqual(marketplace["version"], "2")
        source = (MARKET / marketplace["plugins"][0]["source"]).resolve()
        self.assertEqual(source, PLUGIN.resolve())
        self.assertTrue((source / "kimi.plugin.json").is_file())

    def test_skill_frontmatter_matches_directories(self) -> None:
        for name in SKILLS:
            text = self.skill_texts[name]
            self.assertTrue(text.startswith("---\n"), name)
            end = text.index("\n---\n", 4)
            frontmatter = text[4:end]
            declared = re.search(r"^name:\s*(\S+)", frontmatter, re.MULTILINE)
            self.assertIsNotNone(declared, name)
            self.assertEqual(declared.group(1), name)

    def test_kimi_uses_standalone_thread_and_fails_closed_without_thread_api(self) -> None:
        coordinator = self.skill_texts["sub-thread-coordination"]
        contract = read("skills/sub-thread-coordination/references/goal-contract.md")
        self.assertIn("standalone_thread", contract)
        self.assertIn("长期子线程", coordinator)
        self.assertIn("禁止使用 subagent", coordinator)
        self.assertIn("零个或多个立即停止", coordinator)

    def test_kimi_workflow_contract_has_supervisor_review_and_script_writes(self) -> None:
        combined = "\n".join(
            self.skill_texts[name]
            for name in ("sub-thread-coordination", "parallel-task-planner", "sub-thread-goal-worker")
        )
        for requirement in (
            "监督线程",
            "DAG 视图线程",
            "thread-registry init",
            "THREAD_TASK_RECEIPT_V1",
            "review_upgrade",
            "review_upgrades[]",
            "subgraph-request",
            "result-submit",
            "approve-change",
        ):
            self.assertIn(requirement, combined)
        self.assertIn("禁止使用 subagent", combined)
        self.assertIn("主线程不输出 Mermaid", combined)

        supervisor = self.skill_texts["sub-thread-task-supervisor"]
        self.assertIn("gpt-5.6-luna/low", supervisor)
        self.assertIn("不透明内容", supervisor)
        self.assertIn("TASK_STALLED", supervisor)
        self.assertIn("请主线程检查", supervisor)

    def test_runtime_is_compiled_for_kimi(self) -> None:
        self.assertIn('COMPILED_PLATFORM = "kimi"', self.runtime)
        self.assertIn('type ExecutorMode = "thread"', (ROOT / "tooling/goal-dag/goal-dag.ts").read_text(encoding="utf-8"))
        self.assertIn('execution.mode must equal thread', self.runtime)
        self.assertIn('"create_thread"', self.runtime)
        self.assertIn('"reuse_thread"', self.runtime)
        self.assertIn("result-submit", self.runtime)
        self.assertIn("goal-create", self.runtime)
        self.assertIn("plan-create", self.runtime)

    def test_no_openai_agent_metadata_under_kimi_market(self) -> None:
        self.assertEqual(list(MARKET.rglob("openai.yaml")), [])
        self.assertEqual([path for path in MARKET.rglob("agents") if path.is_dir()], [])

    def test_remote_marketplace_points_at_release_zip(self) -> None:
        marketplace = json.loads(REMOTE_MARKETPLACE.read_text(encoding="utf-8"))
        entry = marketplace["plugins"][0]
        self.assertEqual(entry["id"], "ghost-agent-workflow")
        self.assertEqual(entry["source"], RELEASE_ZIP_URL)

    def test_release_workflow_builds_rolling_zip_release(self) -> None:
        text = RELEASE_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn('"kimi-market/**"', text)
        self.assertIn("ghost-agent-workflow-kimi.zip", text)
        self.assertIn("kimi-latest", text)
        self.assertIn("contents: write", text)
        self.assertIn("sync-thread-skills.mjs", text)
        self.assertIn("tooling/goal-dag/build.mjs", text)
        self.assertIn("tooling/owner-registry/build.mjs", text)
        self.assertIn("python3 -m unittest", text)
        self.assertLess(text.index("Validate workflow contracts"), text.index("Build plugin zip"))


if __name__ == "__main__":
    unittest.main()
