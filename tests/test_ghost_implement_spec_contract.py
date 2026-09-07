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
    def test_wrapper_replaces_the_old_ghost_skill(self) -> None:
        self.assertFalse((CODEX_GHOST / "skills/implement-spec").exists())
        self.assertFalse((CLAUDE_GHOST / "skills/implement-spec").exists())

        codex = (CODEX_GHOST / "skills/ghost-implement-spec/SKILL.md").read_text(
            encoding="utf-8"
        )
        claude = (
            CLAUDE_GHOST / "skills/ghost-implement-spec/SKILL.md"
        ).read_text(encoding="utf-8")
        for requirement in (
            "mattpocock-skills-zh",
            "references/worktree-workflow.md",
            "collaboration.spawn_agent",
            'agent_type: "worker"',
            'model: "gpt-5.6-terra"',
            'reasoning_effort: "xhigh"',
            'fork_turns: "none"',
            "exploration、implementer、merger、review",
            "不得静默降级",
        ):
            self.assertIn(requirement, codex)
        self.assertIn('model: "sonnet"', claude)
        self.assertNotIn("gpt-5.6-terra", claude)
        reference = "skills/ghost-implement-spec/references/worktree-workflow.md"
        self.assertEqual(
            (CODEX_GHOST / reference).read_bytes(),
            (CLAUDE_GHOST / reference).read_bytes(),
        )
        self.assertIn("references/worktree-workflow.md", claude)

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
            (CODEX_GHOST / ".codex-plugin/plugin.json", "0.3.1"),
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

    def test_test_skills_are_packaged_and_synced(self) -> None:
        zcode_manifest = json.loads(ZCODE_GHOST.read_text(encoding="utf-8"))
        for name in ("ghos-matt-test-report", "ghos-matt-run-test"):
            codex = CODEX_GHOST / "skills" / name
            claude = CLAUDE_GHOST / "skills" / name
            self.assertEqual(
                (codex / "SKILL.md").read_bytes(),
                (claude / "SKILL.md").read_bytes(),
            )
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
                self.assertIn(name, manifest["keywords"])


if __name__ == "__main__":
    unittest.main()
