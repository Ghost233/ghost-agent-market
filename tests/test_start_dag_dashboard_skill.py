from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CODEX = ROOT / "codex-market/plugins/ghost-agent-workflow/skills/start-dag-dashboard"
CLAUDE = ROOT / "claude-code-market/skills/start-dag-dashboard"
KIMI = ROOT / "kimi-market/plugins/ghost-agent-workflow/skills/start-dag-dashboard"


class StartDagDashboardSkillTests(unittest.TestCase):
    def test_skill_is_narrow_and_explicit_on_every_platform(self) -> None:
        codex = (CODEX / "SKILL.md").read_text(encoding="utf-8")
        claude = (CLAUDE / "SKILL.md").read_text(encoding="utf-8")
        kimi = (KIMI / "SKILL.md").read_text(encoding="utf-8")
        for text in (codex, claude, kimi):
            self.assertIn("只负责启动", text)
            self.assertIn("不要创建 Goal", text)
            self.assertIn("不持续轮询", text)
            self.assertIn("DAG_DASHBOARD_START_V1", text)
            self.assertIn("progress.json", text)
            self.assertIn("events.jsonl", text)
            self.assertIn("文件监听", text)
            self.assertIn("SSE", text)
            self.assertIn("远程访问", text)
        self.assertIn(
            "node <plugin-root>/scripts/start-dashboard.mjs <workspace>", codex
        )
        self.assertIn(
            "node <plugin-root>/scripts/start-dashboard.mjs <workspace>", claude
        )
        self.assertIn(
            "node ${KIMI_SKILL_DIR}/../../scripts/start-dashboard.mjs <workspace>",
            kimi,
        )
        self.assertIn("disable-model-invocation: true", claude)
        self.assertIn("whenToUse:", kimi)

    def test_codex_and_claude_metadata_require_explicit_invocation(self) -> None:
        for root in (CODEX, CLAUDE):
            metadata = (root / "agents/openai.yaml").read_text(encoding="utf-8")
            self.assertIn("$start-dag-dashboard", metadata)
            self.assertIn("allow_implicit_invocation: false", metadata)


if __name__ == "__main__":
    unittest.main()
