import json
from pathlib import Path
import re
import shutil
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
CODEX_GHOST = ROOT / "codex-market/plugins/ghost-agent-skills"
CLAUDE_GHOST = ROOT / "claude-code-market/plugins/ghost-agent-skills"
CODEX_MATT = ROOT / "codex-market/plugins/mattpocock-skills-zh"
CLAUDE_MATT = ROOT / "claude-code-market/plugins/mattpocock-skills-zh"
GHOST_SKILLS = {
    "git-commit", "git-merge-conflict", "configure-gh-account", "spec-delivery",
    "zh-tech-writing", "container-dev-workflow", "apple-container",
}


class SkillPackagingContractTests(unittest.TestCase):
    def test_remaining_ghost_skills_are_self_contained(self) -> None:
        for root, manifest_path in (
            (CODEX_GHOST, ".codex-plugin/plugin.json"),
            (CLAUDE_GHOST, ".claude-plugin/plugin.json"),
        ):
            names = {path.parent.name for path in (root / "skills").glob("*/SKILL.md")}
            self.assertEqual(names, GHOST_SKILLS)
            manifest = json.loads((root / manifest_path).read_text(encoding="utf-8"))
            for name in names:
                self.assertIn(name, manifest["keywords"])
                folder = root / "skills" / name
                self.assertIn("name: " + name, (folder / "SKILL.md").read_text().split("---", 2)[1])
                self.assertIn("$" + name, (folder / "agents/openai.yaml").read_text())
                with tempfile.TemporaryDirectory() as temporary:
                    isolated = Path(temporary) / name
                    shutil.copytree(folder, isolated)
                    for document in isolated.rglob("*.md"):
                        prose = re.sub(r"^```[^\n]*\n[\s\S]*?^```\s*$", "", document.read_text(), flags=re.M)
                        for target in re.findall(r"\]\(([^)#]+)(?:#[^)]*)?\)", prose):
                            if "://" not in target:
                                resolved = (document.parent / target).resolve()
                                self.assertTrue(resolved.is_file(), str(resolved))
                                self.assertIn(isolated.resolve(), resolved.parents)
            for prompt in manifest.get("interface", {}).get("defaultPrompt", []):
                for name in re.findall(r"\$([a-z][a-z0-9-]*)", prompt):
                    self.assertIn(name, GHOST_SKILLS)

    def test_original_matt_inventory_and_workflow_are_preserved(self) -> None:
        inventories = []
        for root in (CODEX_MATT, CLAUDE_MATT):
            names = {path.parent.name for path in (root / "skills").glob("*/SKILL.md")}
            self.assertEqual(len(names), 27)
            inventories.append(names)
            skill = (root / "skills/implement-spec/SKILL.md").read_text(encoding="utf-8")
            for requirement in (
                "任务图", "frontier", "exploration 子代理", "implementer 子代理",
                "merger 子代理", "code-review", "草稿 PR", "worktree",
            ):
                self.assertIn(requirement, skill)
        self.assertEqual(inventories[0], inventories[1])

    def test_marketplace_paths_and_versions_match_plugins(self) -> None:
        for relative, manifest_path in (
            (".agents/plugins/marketplace.json", ".codex-plugin/plugin.json"),
            ("codex-market/.agents/plugins/marketplace.json", ".codex-plugin/plugin.json"),
            (".claude-plugin/marketplace.json", ".claude-plugin/plugin.json"),
            ("claude-code-market/.claude-plugin/marketplace.json", ".claude-plugin/plugin.json"),
        ):
            path = ROOT / relative
            base = path.parents[2] if path.parent.name == "plugins" else path.parents[1]
            marketplace = json.loads(path.read_text(encoding="utf-8"))
            for entry in marketplace["plugins"]:
                source = entry["source"]
                directory = base / (source["path"] if isinstance(source, dict) else source)
                manifest = json.loads((directory / manifest_path).read_text(encoding="utf-8"))
                self.assertEqual(manifest["name"], entry["name"])
                if "version" in entry:
                    self.assertEqual(manifest["version"], entry["version"])
        claude = json.loads((CLAUDE_GHOST / ".claude-plugin/plugin.json").read_text())
        zcode = json.loads((CLAUDE_GHOST / ".zcode-plugin/plugin.json").read_text())
        self.assertEqual(claude["version"], zcode["version"])

    def test_zcode_preserves_only_the_git_commit_executor(self) -> None:
        manifest = json.loads((CLAUDE_GHOST / ".zcode-plugin/plugin.json").read_text())
        agents = CLAUDE_GHOST / manifest["agents"]
        self.assertEqual({path.name for path in agents.glob("*.md")}, {"git-commit-executor.md"})


if __name__ == "__main__":
    unittest.main()
