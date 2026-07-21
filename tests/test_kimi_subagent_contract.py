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
    "subagent-coordination",
    "subagent-goal-worker",
    "git-commit",
)
CONTINUATION = "/skill:subagent-coordination 继续 `<goal.json绝对路径>`。"
SCRIPT_PREFIX = "${KIMI_SKILL_DIR}/../../scripts/"


def read(relative: str) -> str:
    return (PLUGIN / relative).read_text(encoding="utf-8")


class KimiWorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.runtime = RUNTIME.read_text(encoding="utf-8")
        cls.skill_texts = {
            name: read(f"skills/{name}/SKILL.md") for name in SKILLS
        }

    def frontmatter(self, skill: str) -> str:
        text = self.skill_texts[skill]
        self.assertTrue(text.startswith("---\n"), skill)
        end = text.index("\n---\n", 4)
        return text[4:end]

    def test_kimi_plugin_manifest_is_valid(self) -> None:
        manifest = json.loads(
            (PLUGIN / "kimi.plugin.json").read_text(encoding="utf-8")
        )
        self.assertEqual(manifest["name"], "ghost-agent-workflow")
        self.assertRegex(manifest["name"], r"^[a-z0-9][a-z0-9_-]{0,63}$")
        self.assertTrue(manifest["version"])
        self.assertEqual(manifest["skills"], "./skills/")
        self.assertTrue(manifest["interface"]["displayName"])

    def test_marketplace_manifest_points_at_existing_plugin(self) -> None:
        marketplace = json.loads(MARKETPLACE.read_text(encoding="utf-8"))
        self.assertEqual(marketplace["version"], "2")
        self.assertEqual(marketplace["plugins"][0]["id"], "ghost-agent-workflow")
        source = (MARKET / marketplace["plugins"][0]["source"]).resolve()
        self.assertTrue(source.is_dir(), source)
        self.assertEqual(source, PLUGIN.resolve())
        self.assertTrue((source / "kimi.plugin.json").is_file(), source)

    def test_skill_frontmatter_is_complete_and_matches_directory(self) -> None:
        for name in SKILLS:
            path = PLUGIN / "skills" / name / "SKILL.md"
            self.assertTrue(path.is_file(), name)
            frontmatter = self.frontmatter(name)
            keys = set(re.findall(r"^([A-Za-z_][A-Za-z0-9_]*):", frontmatter, re.MULTILINE))
            self.assertLessEqual({"name", "description", "whenToUse"}, keys, name)
            self.assertNotIn("disableModelInvocation", frontmatter, name)
            declared = re.search(r"^name:\s*(\S+)", frontmatter, re.MULTILINE)
            self.assertIsNotNone(declared, name)
            self.assertEqual(declared.group(1), name, name)

    def test_kimi_local_fallback_goal_contract(self) -> None:
        coordinator = self.skill_texts["subagent-coordination"]
        contract = read("skills/subagent-coordination/references/goal-contract.md")
        self.assertIn('"execution_platform": "kimi"', contract)
        self.assertIn('"controller": "local_fallback"', contract)
        self.assertIn('"native_goal": null', contract)
        self.assertIn("execution_platform: kimi", coordinator)
        self.assertIn("lifecycle.controller: local_fallback", coordinator)
        self.assertIn("native_goal: null", coordinator)
        self.assertIn("not_required", contract)

    def test_goal_dag_references_use_kimi_skill_dir_prefix(self) -> None:
        coordinator = self.skill_texts["subagent-coordination"]
        matches = list(re.finditer(r"goal-dag\.mjs", coordinator))
        self.assertTrue(matches)
        for match in matches:
            prefix = coordinator[max(0, match.start() - len(SCRIPT_PREFIX)) : match.start()]
            self.assertEqual(prefix, SCRIPT_PREFIX, coordinator[match.start() - 60 : match.end()])

    def test_continuation_prompt_matches_runtime(self) -> None:
        coordinator = self.skill_texts["subagent-coordination"]
        self.assertIn(CONTINUATION, coordinator)
        self.assertIn("continuation_prompt", self.runtime)
        self.assertIn(
            "`/skill:subagent-coordination 继续 \\`${resolve(goalPath)}\\`。`,",
            self.runtime,
        )
        self.assertIn("/skill:subagent-coordination 继续 `", coordinator)
        self.assertNotIn("/ghost-agent-workflow:subagent-coordination 继续", coordinator)

    def test_no_codex_native_residue_in_skills(self) -> None:
        forbidden = (
            "spawn_agent",
            "multi_agent_v1",
            "wait_agent",
            "followup_task",
            "interrupt_agent",
            "codex_native",
            "native-confirm",
        )
        for name in SKILLS:
            skill_dir = PLUGIN / "skills" / name
            for document in sorted(skill_dir.rglob("*.md")):
                text = document.read_text(encoding="utf-8")
                label = f"{name}:{document.relative_to(skill_dir)}"
                for word in forbidden:
                    self.assertIsNone(
                        re.search(rf"\b{re.escape(word)}\b", text),
                        f"{label} contains {word}",
                    )
                self.assertNotIn("/ghost-agent-workflow:", text, label)
                self.assertNotIn("<plugin-root>", text, label)
                for line in text.splitlines():
                    if re.search(r"\bgpt-5", line):
                        self.assertIn("平台差异", line, f"{label}: {line}")

    def test_runtime_is_compiled_for_kimi(self) -> None:
        self.assertIn('COMPILED_PLATFORM = "kimi"', self.runtime)
        self.assertIn('EXPECTED_PLATFORM !== "kimi"', self.runtime)
        self.assertIn("codex, claude_code or kimi", self.runtime)

    def test_no_openai_agent_metadata_under_kimi_market(self) -> None:
        self.assertEqual(list(MARKET.rglob("openai.yaml")), [])
        self.assertEqual(
            [path for path in MARKET.rglob("agents") if path.is_dir()], []
        )

    def test_coordination_dispatch_contract(self) -> None:
        coordinator = self.skill_texts["subagent-coordination"]
        self.assertIn('subagent_type: "coder"', coordinator)
        self.assertIn("TaskList(active_only: false)", coordinator)
        self.assertIn("Skill 工具调用 subagent-goal-worker", coordinator)
        self.assertIn("explore/plan", coordinator)
        worker = self.skill_texts["subagent-goal-worker"]
        self.assertIn("node ${KIMI_SKILL_DIR}/../../scripts/goal-dag.mjs", worker)
        git_commit = self.skill_texts["git-commit"]
        self.assertIn("/skill:git-commit", git_commit)

    def test_remote_marketplace_points_at_release_zip(self) -> None:
        marketplace = json.loads(REMOTE_MARKETPLACE.read_text(encoding="utf-8"))
        self.assertEqual(marketplace["version"], "2")
        entry = marketplace["plugins"][0]
        self.assertEqual(entry["id"], "ghost-agent-workflow")
        self.assertEqual(entry["source"], RELEASE_ZIP_URL)

    def test_release_workflow_builds_rolling_zip_release(self) -> None:
        self.assertTrue(RELEASE_WORKFLOW.is_file(), RELEASE_WORKFLOW)
        text = RELEASE_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn('"kimi-market/**"', text)
        self.assertIn("ghost-agent-workflow-kimi.zip", text)
        self.assertIn("kimi-latest", text)
        self.assertIn("contents: write", text)


if __name__ == "__main__":
    unittest.main()
