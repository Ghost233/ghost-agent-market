from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
ADAPTER = ROOT / "claude-code-market/scripts/claude-owner-host.py"


class ClaudeOwnerHostSmokeTests(unittest.TestCase):
    def make_worktree(self, root: Path) -> tuple[Path, str, str, Path]:
        repo = root / "repo"
        worktree = root / "owner-wt"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=repo, check=True)
        subprocess.run(["git", "config", "user.name", "Test"], cwd=repo, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.invalid"], cwd=repo, check=True)
        (repo / "seed").write_text("seed\n", encoding="utf-8")
        subprocess.run(["git", "add", "seed"], cwd=repo, check=True)
        subprocess.run(["git", "commit", "-qm", "seed"], cwd=repo, check=True)
        subprocess.run(["git", "worktree", "add", "-qb", "owner-proto", str(worktree)], cwd=repo, check=True)
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=worktree, check=True, capture_output=True, text=True).stdout.strip()
        common = Path(subprocess.run(["git", "rev-parse", "--git-common-dir"], cwd=worktree, check=True, capture_output=True, text=True).stdout.strip())
        if not common.is_absolute():
            common = (worktree / common).resolve()
        return worktree, "owner-proto", head, common

    def run_adapter(self, worktree: Path, branch: str, head: str, common: Path, *extra: str, env: dict | None = None):
        artifact = worktree.parent / "capability.json"
        result = subprocess.run([
            "python3", str(ADAPTER), "--worktree", str(worktree),
            "--expected-branch", branch, "--expected-head", head,
            "--expected-common-dir", str(common), "--artifact", str(artifact), *extra,
        ], capture_output=True, text=True, env={**os.environ, **(env or {})})
        return result, json.loads(artifact.read_text(encoding="utf-8"))

    def test_direct_probe_writes_passed_capability_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            worktree, branch, head, common = self.make_worktree(Path(directory))
            result, artifact = self.run_adapter(worktree, branch, head, common)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(artifact["mode"], "direct_probe")
            self.assertEqual(artifact["outcome"], "passed")
            self.assertEqual(artifact["host"]["validated_version"], "2.1.220")
            self.assertEqual(artifact["before"], artifact["after"])

    def test_controller_defaults_to_no_real_model(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            worktree, branch, head, common = self.make_worktree(Path(directory))
            result, artifact = self.run_adapter(
                worktree, branch, head, common, "--controller",
                env={"GHOST_AGENT_REAL_HOST_SMOKE": "0"},
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(artifact["outcome"], "unsupported")
            self.assertFalse(artifact["real_model_requested"])

    def test_controller_uses_os_cwd_and_never_worktree_flag(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            worktree, branch, head, common = self.make_worktree(root)
            capture = root / "argv.json"
            fake = root / "fake-claude.py"
            fake.write_text(
                "#!/usr/bin/env python3\n"
                "import json, os, pathlib, sys\n"
                "pathlib.Path(os.environ['CAPTURE']).write_text(json.dumps({'cwd': os.getcwd(), 'argv': sys.argv[1:]}))\n",
                encoding="utf-8",
            )
            fake.chmod(0o755)
            result, artifact = self.run_adapter(
                worktree, branch, head, common, "--controller", "--real-host",
                "--claude-command", str(fake), env={"CAPTURE": str(capture)},
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            invocation = json.loads(capture.read_text(encoding="utf-8"))
            self.assertEqual(Path(invocation["cwd"]).resolve(), worktree.resolve())
            self.assertNotIn("--worktree", invocation["argv"])
            self.assertNotIn("-w", invocation["argv"])
            self.assertEqual(artifact["outcome"], "passed")
            self.assertTrue(artifact["real_model_requested"])

    @unittest.skipUnless(os.environ.get("GHOST_AGENT_REAL_HOST_SMOKE") in {"1", "true", "yes", "on"},
                         "set GHOST_AGENT_REAL_HOST_SMOKE=1 to invoke Claude Code")
    def test_real_claude_controller_smoke(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            worktree, branch, head, common = self.make_worktree(Path(directory))
            result, artifact = self.run_adapter(worktree, branch, head, common, "--controller", "--real-host")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(artifact["outcome"], "passed")


if __name__ == "__main__":
    unittest.main()
