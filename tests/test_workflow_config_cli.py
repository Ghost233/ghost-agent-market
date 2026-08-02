import json
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tooling/workflow-config/workflow-config.mjs"
PUBLISHED = (
    ROOT / "codex-market/plugins/ghost-agent-workflow/scripts/workflow-config.mjs",
    ROOT / "claude-code-market/scripts/workflow-config.mjs",
)


class WorkflowConfigCliTests(unittest.TestCase):
    def run_cli(self, *args: object) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["node", str(SOURCE), *(str(arg) for arg in args)],
            capture_output=True,
            text=True,
            check=False,
        )

    def run_json(self, *args: object) -> dict:
        result = self.run_cli(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_init_writes_compact_defaults_and_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first = self.run_json("ensure", directory)
            second = self.run_json("ensure", directory)
            self.assertEqual(first["status"], "ensured")
            self.assertEqual(second["status"], "ensured")
            self.assertEqual(first["parallel"], 8)
            self.assertEqual(
                set(first["profiles"]), {"main", "planner", "owner", "review", "supervisor"}
            )
            self.assertEqual(first["profiles"]["main"], {
                "model": "gpt-5.6-sol",
                "effort": "xhigh",
            })
            for role in ("planner", "owner", "review"):
                self.assertEqual(first["profiles"][role], {
                    "model": "gpt-5.6-sol",
                    "effort": "high",
                })
            self.assertEqual(first["profiles"]["supervisor"], {
                "model": "gpt-5.6-luna",
                "effort": "medium",
            })
            path = Path(first["path"])
            self.assertEqual(path, Path(directory) / ".ghost-agent-workflow/config.json")
            self.assertTrue(path.is_file())
            self.assertEqual(
                (path.parent / ".gitignore").read_text(encoding="utf-8"),
                "# Managed by Ghost Agent Workflow.\n"
                "*\n"
                "!.gitignore\n"
                "!config.json\n"
                "!owners/\n"
                "!owners/**\n"
                "owners/*/interfaces/\n",
            )

    def test_set_commands_preserve_other_fields_and_validate_range(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            self.run_json("init", directory)
            parallel = self.run_json("set-parallel", directory, 6)
            updated = self.run_json(
                "set-profile", directory, "review", "gpt-5.6-sol", "xhigh"
            )
            self.assertEqual(parallel["parallel"], 6)
            self.assertEqual(updated["parallel"], 6)
            self.assertEqual(updated["profiles"]["review"]["effort"], "xhigh")
            self.assertEqual(updated["profiles"]["planner"]["effort"], "high")
            main = self.run_json(
                "set-profile", directory, "main", "gpt-5.6-sol", "max"
            )
            self.assertEqual(main["profiles"]["main"]["effort"], "max")
            rejected = self.run_cli("set-parallel", directory, 9)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("1 to 8", rejected.stderr)

    def test_show_creates_missing_config_and_unknown_fields_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            shown = self.run_json("show", directory)
            self.assertEqual(shown["status"], "shown")
            path = Path(shown["path"])
            config = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(set(config), {"parallel", "profiles"})
            config["unknown"] = True
            path.write_text(json.dumps(config), encoding="utf-8")
            rejected = self.run_cli("validate", directory)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("keys must equal", rejected.stderr)

    def test_show_migrates_the_previous_three_profile_config(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".ghost-agent-workflow/config.json"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({
                "parallel": 8,
                "profiles": {
                    role: {"model": "gpt-5.6-sol", "effort": "high"}
                    for role in ("planner", "owner", "review")
                },
            }), encoding="utf-8")
            migrated = self.run_json("show", directory)
            self.assertEqual(migrated["status"], "shown")
            self.assertEqual(migrated["profiles"]["supervisor"], {
                "model": "gpt-5.6-luna",
                "effort": "medium",
            })
            stored = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(set(stored["profiles"]), {
                "main", "planner", "owner", "review", "supervisor"
            })

    def test_show_migrates_the_previous_four_profile_config(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".ghost-agent-workflow/config.json"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({
                "parallel": 8,
                "profiles": {
                    "planner": {"model": "gpt-5.6-sol", "effort": "high"},
                    "owner": {"model": "gpt-5.6-sol", "effort": "high"},
                    "review": {"model": "gpt-5.6-sol", "effort": "high"},
                    "supervisor": {"model": "gpt-5.6-luna", "effort": "medium"},
                },
            }), encoding="utf-8")
            migrated = self.run_json("show", directory)
            self.assertEqual(migrated["profiles"]["main"], {
                "model": "gpt-5.6-sol",
                "effort": "xhigh",
            })

    def test_existing_workflow_gitignore_is_not_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            workflow_root = Path(directory) / ".ghost-agent-workflow"
            workflow_root.mkdir()
            gitignore = workflow_root / ".gitignore"
            gitignore.write_text("custom-rule\n", encoding="utf-8")
            self.run_json("ensure", directory)
            self.assertEqual(gitignore.read_text(encoding="utf-8"), "custom-rule\n")

    def test_workflow_gitignore_tracks_config_and_owners_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            subprocess.run(["git", "init", "-q", directory], check=True)
            self.run_json("ensure", directory)
            workflow_root = Path(directory) / ".ghost-agent-workflow"
            (workflow_root / "runtime").mkdir()
            (workflow_root / "runtime/state.json").write_text("{}\n", encoding="utf-8")
            owner = workflow_root / "owners/example"
            (owner / "interfaces").mkdir(parents=True)
            (owner / "capsule.json").write_text("{}\n", encoding="utf-8")
            (owner / "interfaces/temp.json").write_text("{}\n", encoding="utf-8")
            status = subprocess.run(
                ["git", "-C", directory, "status", "--short", "--untracked-files=all"],
                check=True,
                capture_output=True,
                text=True,
            ).stdout
            self.assertIn("?? .ghost-agent-workflow/.gitignore", status)
            self.assertIn("?? .ghost-agent-workflow/config.json", status)
            self.assertIn("?? .ghost-agent-workflow/owners/example/capsule.json", status)
            self.assertNotIn("runtime/state.json", status)
            self.assertNotIn("interfaces/temp.json", status)

    def test_published_scripts_match_source(self) -> None:
        expected = SOURCE.read_text(encoding="utf-8")
        for path in PUBLISHED:
            self.assertEqual(path.read_text(encoding="utf-8"), expected, str(path))


if __name__ == "__main__":
    unittest.main()
