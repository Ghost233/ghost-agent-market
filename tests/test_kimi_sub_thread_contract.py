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
SKILLS_PLUGIN = MARKET / "plugins/ghost-agent-skills"
SKILLS_RELEASE_ZIP_URL = (
    "https://github.com/Ghost233/ghost-agent-market"
    "/releases/download/kimi-latest/ghost-agent-skills-kimi.zip"
)
RUNTIME = PLUGIN / "scripts/goal-dag.mjs"
SKILLS = (
    "parallel-task-planner",
    "planner-reviewer",
    "setup-sub-thread-workflow",
    "sub-thread-coordination",
    "sub-thread-task-supervisor",
    "sub-thread-goal-worker",
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
        self.assertEqual(manifest["version"], "0.6.3")
        self.assertEqual(manifest["skills"], "./skills/")
        self.assertIn("Quick Owner", manifest["description"])
        self.assertIn("最小 DAG", manifest["description"])

    def test_marketplace_manifest_points_at_existing_plugin(self) -> None:
        marketplace = json.loads(MARKETPLACE.read_text(encoding="utf-8"))
        self.assertEqual(marketplace["version"], "2")
        entries = {entry["id"]: entry for entry in marketplace["plugins"]}
        self.assertEqual(set(entries), {"ghost-agent-workflow", "ghost-agent-skills"})
        for plugin_id, expected in (
            ("ghost-agent-workflow", PLUGIN),
            ("ghost-agent-skills", SKILLS_PLUGIN),
        ):
            source = (MARKET / entries[plugin_id]["source"]).resolve()
            self.assertEqual(source, expected.resolve())
            self.assertTrue((source / "kimi.plugin.json").is_file())

    def test_standalone_skills_plugin_is_current(self) -> None:
        manifest = json.loads(
            (SKILLS_PLUGIN / "kimi.plugin.json").read_text(encoding="utf-8")
        )
        self.assertEqual(manifest["name"], "ghost-agent-skills")
        self.assertEqual(manifest["version"], "0.1.0")
        self.assertEqual(manifest["skills"], "./skills/")
        skill = (SKILLS_PLUGIN / "skills/git-commit/SKILL.md").read_text(
            encoding="utf-8"
        )
        self.assertTrue(skill.startswith("---\nname: git-commit\n"))

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
        self.assertIn("standalone_thread", coordinator)
        self.assertIn("长期子线程", coordinator)
        self.assertIn("禁止 subagent", coordinator)
        self.assertIn("同时只能有一个 Main", coordinator)

    def test_kimi_workflow_contract_has_supervisor_review_and_script_writes(self) -> None:
        combined = "\n".join(
            self.skill_texts[name] for name in (
                "sub-thread-coordination",
                "parallel-task-planner",
                "planner-reviewer",
                "setup-sub-thread-workflow",
                "sub-thread-goal-worker",
                "sub-thread-task-supervisor",
            )
        )
        combined += "\n" + read(
            "skills/sub-thread-coordination/references/owner-governance.md"
        )
        for requirement in (
            "supervisor start",
            "supervisor next",
            "supervisor ack",
            "supervisor inspect",
            "supervisor stop",
            "gpt-5.6-luna/medium",
            "gpt-5.6-sol/high",
            "workflow-config.mjs",
            "workflow start-dag",
            "workflow owner-sync",
            "workflow owner-finish",
            "worker verify",
            "worker request-dag",
            "worker complete",
            "approve-current",
            "review_upgrades",
        ):
            self.assertIn(requirement, combined)
        self.assertIn("禁止 subagent", combined)
        self.assertIn("完整 DAG", combined)
        self.assertIn("planner-review <goal-dir> pass", combined)

    def test_runtime_is_compiled_for_kimi(self) -> None:
        self.assertIn('COMPILED_PLATFORM = "kimi"', self.runtime)
        self.assertIn('type ExecutorMode = "thread"', (ROOT / "tooling/goal-dag/goal-dag.ts").read_text(encoding="utf-8"))
        self.assertIn('execution.mode must equal thread', self.runtime)
        self.assertIn('"create_thread"', self.runtime)
        self.assertIn('"reuse_thread"', self.runtime)
        self.assertIn("result-submit", self.runtime)
        self.assertIn("worker-complete", self.runtime)
        self.assertIn("workflow-step", self.runtime)
        self.assertIn("goal-create", self.runtime)
        self.assertIn("plan-create", self.runtime)

    def test_no_openai_agent_metadata_under_kimi_market(self) -> None:
        self.assertEqual(list(MARKET.rglob("openai.yaml")), [])
        self.assertEqual([path for path in MARKET.rglob("agents") if path.is_dir()], [])

    def test_remote_marketplace_points_at_release_zip(self) -> None:
        marketplace = json.loads(REMOTE_MARKETPLACE.read_text(encoding="utf-8"))
        entries = {entry["id"]: entry for entry in marketplace["plugins"]}
        self.assertEqual(entries["ghost-agent-workflow"]["source"], RELEASE_ZIP_URL)
        self.assertEqual(
            entries["ghost-agent-skills"]["source"], SKILLS_RELEASE_ZIP_URL
        )

    def test_release_workflow_builds_rolling_zip_release(self) -> None:
        text = RELEASE_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn('"kimi-market/**"', text)
        self.assertIn("ghost-agent-workflow-kimi.zip", text)
        self.assertIn("ghost-agent-skills-kimi.zip", text)
        self.assertIn("kimi-latest", text)
        self.assertIn("contents: write", text)
        self.assertIn("sync-thread-skills.mjs", text)
        self.assertIn("tooling/goal-dag/build.mjs", text)
        self.assertIn("tooling/owner-registry/build.mjs", text)
        self.assertIn("tooling/workflow-config/build.mjs", text)
        self.assertIn("python3 -m unittest", text)
        self.assertLess(text.index("Validate workflow contracts"), text.index("Build plugin zip"))


if __name__ == "__main__":
    unittest.main()
