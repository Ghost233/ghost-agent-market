import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CODEX_GHOST = ROOT / "codex-market/plugins/ghost-agent-skills"
CLAUDE_GHOST = ROOT / "claude-code-market/plugins/ghost-agent-skills"
ZCODE_GHOST = CLAUDE_GHOST / ".zcode-plugin/plugin.json"
CODEX_MATT = ROOT / "codex-market/plugins/mattpocock-skills-zh"
CLAUDE_MATT = ROOT / "claude-code-market/plugins/mattpocock-skills-zh"


class GhostImplementSpecContractTests(unittest.TestCase):
    def test_codex_workflow_entrypoints_and_references(self) -> None:
        import re
        import shutil
        import tempfile

        names = (
            "ghost-matt-spec", "ghost-matt-ticket", "ghost-matt-implement",
            "ghost-matt-run-test", "ghost-matt-test-report",
        )
        manifest = json.loads((CODEX_GHOST / ".codex-plugin/plugin.json").read_text())
        for name in names:
            folder = CODEX_GHOST / "skills" / name
            content = (folder / "SKILL.md").read_text()
            self.assertIn("name: " + name, content.split("---", 2)[1])
            interface = (folder / "agents/openai.yaml").read_text()
            self.assertIn("$" + name, interface)
            self.assertIn("allow_implicit_invocation: false", interface)
            self.assertIn(name, manifest["keywords"])
            # A skill must still resolve every local reference when copied alone.
            with tempfile.TemporaryDirectory() as temporary:
                isolated = Path(temporary) / name
                shutil.copytree(folder, isolated)
                for document in isolated.rglob("*.md"):
                    for target in re.findall(r"\]\(([^)#]+)(?:#[^)]*)?\)", document.read_text()):
                        if "://" not in target:
                            resolved = (document.parent / target).resolve()
                            self.assertTrue(resolved.is_file(), str(resolved))
                            self.assertIn(isolated.resolve(), resolved.parents)
        for old in ("ghost-implement-spec", "ghos-matt-run-test", "ghos-matt-test-report"):
            self.assertFalse((CODEX_GHOST / "skills" / old).exists())
            self.assertTrue((CLAUDE_GHOST / "skills" / old / "SKILL.md").is_file())
        for name in names:
            self.assertFalse((CLAUDE_GHOST / "skills" / name).exists())

    def test_matt_workflow_is_packaged_for_both_platforms(self) -> None:
        for root, review_invocation in (
            (CODEX_MATT, "$code-review"),
            (CLAUDE_MATT, "/code-review"),
        ):
            skill = (root / "skills/implement-spec/SKILL.md").read_text(
                encoding="utf-8"
            )
            for requirement in (
                "任务图",
                "frontier",
                "exploration 子代理",
                "implementer 子代理",
                "merger 子代理",
                review_invocation,
                "草稿 PR",
                "worktree",
            ):
                self.assertIn(requirement, skill)

    def test_versions_and_marketplaces_describe_the_merged_artifact(self) -> None:
        manifests = (
            (CODEX_GHOST / ".codex-plugin/plugin.json", "0.3.4"),
            (CLAUDE_GHOST / ".claude-plugin/plugin.json", "0.3.1"),
            (ZCODE_GHOST, "0.3.1"),
            (CODEX_MATT / ".codex-plugin/plugin.json", "0.1.4"),
            (CLAUDE_MATT / ".claude-plugin/plugin.json", "0.1.5"),
        )
        for path, version in manifests:
            manifest = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["version"].split("+", 1)[0], version)

        for path in (
            ROOT / ".claude-plugin/marketplace.json",
            ROOT / "claude-code-market/.claude-plugin/marketplace.json",
        ):
            marketplace = json.loads(path.read_text(encoding="utf-8"))
            entries = {entry["name"]: entry for entry in marketplace["plugins"]}
            self.assertEqual(entries["ghost-agent-skills"]["version"], "0.3.1")
            self.assertEqual(entries["mattpocock-skills-zh"]["version"], "0.1.5")
            self.assertIn(
                "ghost-implement-spec",
                entries["ghost-agent-skills"]["keywords"],
            )

    def test_test_skills_preserve_claude_and_expose_codex_replacements(self) -> None:
        zcode_manifest = json.loads(ZCODE_GHOST.read_text(encoding="utf-8"))
        for name in ("ghos-matt-test-report", "ghos-matt-run-test"):
            codex = CODEX_GHOST / "skills" / name.replace("ghos-", "ghost-")
            claude = CLAUDE_GHOST / "skills" / name
            self.assertTrue((codex / "SKILL.md").is_file())
            self.assertTrue((claude / "SKILL.md").is_file())
            self.assertTrue((codex / "agents/openai.yaml").is_file())
            agent = CLAUDE_GHOST / zcode_manifest["agents"] / (name + ".md")
            content = agent.read_text(encoding="utf-8")
            frontmatter = dict(
                line.split(": ", 1) for line in content.split("---", 2)[1].strip().splitlines()
            )
            self.assertEqual(frontmatter["name"], name)
            self.assertEqual(frontmatter["model"], "glm-5.3-flash")
            self.assertIn(
                "ghost-agent-skills:" + name,
                (claude / "SKILL.md").read_text(encoding="utf-8"),
            )
            for manifest_path in (
                CODEX_GHOST / ".codex-plugin/plugin.json",
                CLAUDE_GHOST / ".claude-plugin/plugin.json",
            ):
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                self.assertIn(name.replace("ghos-", "ghost-") if manifest_path == CODEX_GHOST / ".codex-plugin/plugin.json" else name, manifest["keywords"])


if __name__ == "__main__":
    unittest.main()
