import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (
    ROOT
    / "codex-market/plugins/ghost-agent-skills/skills/git-commit/scripts/git_commit.py"
)


class GitCommitScriptTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        self.repo = Path(self.tempdir.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Test User")
        self.git("config", "user.email", "test@example.com")
        for name in ("tracked.txt", "target.txt", "other.txt"):
            self.write_text(name, f"{name} base\n")
        self.git("add", "--", "tracked.txt", "target.txt", "other.txt")
        self.git("commit", "-qm", "initial")

    def git(
        self,
        *args: str,
        check: bool = True,
        env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            ["git", "-C", str(self.repo), *args],
            text=True,
            capture_output=True,
            check=False,
            env=env,
        )
        if check and result.returncode != 0:
            self.fail(
                f"git {' '.join(args)} failed ({result.returncode}): "
                f"{result.stderr}"
            )
        return result

    def write_text(self, relative: str, content: str) -> None:
        path = self.repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def write_bytes(self, relative: str, content: bytes) -> None:
        path = self.repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    def run_script(
        self,
        command: str,
        *,
        plan: dict[str, object] | None = None,
        include_diff: bool = False,
    ) -> tuple[subprocess.CompletedProcess[str], dict[str, object]]:
        args = ["python3", str(SCRIPT), command, "--repo", str(self.repo)]
        if include_diff:
            args.append("--diff")
        result = subprocess.run(
            args,
            input=None if plan is None else json.dumps(plan, ensure_ascii=False),
            text=True,
            capture_output=True,
            check=False,
        )
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            self.fail(
                f"script returned invalid JSON ({result.returncode}): "
                f"stdout={result.stdout!r} stderr={result.stderr!r}; {exc}"
            )
        return result, payload

    def inspect(self, *, include_diff: bool = False) -> dict[str, object]:
        result, payload = self.run_script("inspect", include_diff=include_diff)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(payload["ok"])
        return payload

    @staticmethod
    def changes_by_path(
        payload: dict[str, object],
    ) -> dict[str, dict[str, object]]:
        return {
            str(change["path"]): change
            for change in payload["changes"]  # type: ignore[union-attr]
        }

    def plan(
        self,
        snapshot: dict[str, object],
        batches: list[dict[str, object]],
    ) -> dict[str, object]:
        return {
            "head": snapshot["head"],
            "fingerprint": snapshot["fingerprint"],
            "batches": batches,
        }

    def test_reports_same_path_as_staged_and_unstaged(self) -> None:
        self.write_text("tracked.txt", "staged version\n")
        self.git("add", "--", "tracked.txt")
        self.write_text("tracked.txt", "unstaged version\n")

        change = self.changes_by_path(self.inspect())["tracked.txt"]

        self.assertTrue(change["staged"])
        self.assertTrue(change["unstaged"])
        self.assertFalse(change["untracked"])

    def test_rename_records_do_not_create_fake_paths(self) -> None:
        self.git("mv", "tracked.txt", "renamed.txt")

        changes = self.changes_by_path(self.inspect())

        self.assertEqual(set(changes), {"tracked.txt", "renamed.txt"})
        self.assertEqual(changes["tracked.txt"]["index_status"], "D")
        self.assertEqual(changes["renamed.txt"]["index_status"], "A")

    def test_fingerprint_changes_when_modified_content_changes(self) -> None:
        self.write_text("tracked.txt", "first version\n")
        first = self.inspect()["fingerprint"]

        self.write_text("tracked.txt", "second version\n")
        second = self.inspect()["fingerprint"]

        self.assertNotEqual(first, second)

    def test_diff_and_risks_include_untracked_text_and_binary_files(self) -> None:
        self.write_text("notes/new.txt", "new untracked content\n")
        self.write_bytes("assets/image.bin", b"\x00\x01\x02binary")

        payload = self.inspect(include_diff=True)
        changes = self.changes_by_path(payload)

        self.assertIn("notes/new.txt", changes)
        self.assertIn("assets/image.bin", changes)
        self.assertIn("new untracked content", payload["diff"])
        self.assertIn("assets/image.bin", payload["binary_files"])

    def test_binary_risk_includes_staged_content_hidden_by_worktree_version(self) -> None:
        self.write_bytes("tracked.txt", b"\x00staged binary")
        self.git("add", "--", "tracked.txt")
        self.write_text("tracked.txt", "plain worktree version\n")

        payload = self.inspect()

        self.assertIn("tracked.txt", payload["binary_files"])

    def test_apply_commits_only_batch_and_preserves_other_staged_files(self) -> None:
        self.write_text("target.txt", "target change\n")
        self.write_text("other.txt", "other staged change\n")
        self.git("add", "--", "other.txt")
        snapshot = self.inspect()
        plan = self.plan(
            snapshot,
            [{"paths": ["target.txt"], "message": "fix(test): 修复目标文件"}],
        )

        result, payload = self.run_script("apply", plan=plan)

        self.assertEqual(result.returncode, 0, payload)
        self.assertTrue(payload["ok"])
        committed = set(
            self.git(
                "diff-tree",
                "--no-commit-id",
                "--name-only",
                "-r",
                "HEAD",
            ).stdout.splitlines()
        )
        staged = set(
            self.git("diff", "--cached", "--name-only").stdout.splitlines()
        )
        self.assertEqual(committed, {"target.txt"})
        self.assertEqual(staged, {"other.txt"})
        body = self.git("log", "-1", "--format=%B").stdout
        self.assertIn(
            "Co-Authored-By: Nexus <nexus@xfinite.global>",
            body,
        )

    def test_apply_commits_rename_as_two_explicit_paths(self) -> None:
        (self.repo / "tracked.txt").rename(self.repo / "renamed.txt")
        snapshot = self.inspect()
        plan = self.plan(
            snapshot,
            [
                {
                    "paths": ["tracked.txt", "renamed.txt"],
                    "message": "refactor(test): 重命名文件",
                }
            ],
        )

        result, payload = self.run_script("apply", plan=plan)

        self.assertEqual(result.returncode, 0, payload)
        committed = set(
            self.git(
                "diff-tree",
                "--no-commit-id",
                "--name-only",
                "--no-renames",
                "-r",
                "HEAD",
            ).stdout.splitlines()
        )
        self.assertEqual(committed, {"tracked.txt", "renamed.txt"})

    def test_apply_treats_special_filename_as_literal_path(self) -> None:
        self.write_text("[odd].txt", "selected\n")
        self.write_text("o.txt", "must remain untracked\n")
        snapshot = self.inspect()
        plan = self.plan(
            snapshot,
            [{"paths": ["[odd].txt"], "message": "test(path): 提交特殊文件名"}],
        )

        result, payload = self.run_script("apply", plan=plan)

        self.assertEqual(result.returncode, 0, payload)
        committed = self.git(
            "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"
        ).stdout.splitlines()
        self.assertEqual(committed, ["[odd].txt"])
        self.assertIn("?? o.txt", self.git("status", "--short").stdout)

    def test_apply_rejects_changed_content_with_same_status(self) -> None:
        self.write_text("target.txt", "reviewed version\n")
        snapshot = self.inspect()
        initial_head = self.git("rev-parse", "HEAD").stdout.strip()
        self.write_text("target.txt", "unreviewed version\n")
        plan = self.plan(
            snapshot,
            [{"paths": ["target.txt"], "message": "fix(test): 修复目标文件"}],
        )

        result, payload = self.run_script("apply", plan=plan)

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(payload["ok"])
        self.assertIn("fingerprint", str(payload["error"]))
        self.assertEqual(self.git("rev-parse", "HEAD").stdout.strip(), initial_head)

    def test_apply_rejects_duplicate_paths_before_writing(self) -> None:
        self.write_text("target.txt", "target change\n")
        snapshot = self.inspect()
        initial_head = self.git("rev-parse", "HEAD").stdout.strip()
        plan = self.plan(
            snapshot,
            [
                {"paths": ["target.txt"], "message": "fix(test): 第一批"},
                {"paths": ["target.txt"], "message": "fix(test): 第二批"},
            ],
        )

        result, payload = self.run_script("apply", plan=plan)

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(payload["ok"])
        self.assertFalse(payload["partial"])
        self.assertIn("duplicate", str(payload["error"]))
        self.assertEqual(self.git("rev-parse", "HEAD").stdout.strip(), initial_head)

    def test_apply_rejects_non_conventional_message_before_writing(self) -> None:
        self.write_text("target.txt", "target change\n")
        snapshot = self.inspect()
        initial_head = self.git("rev-parse", "HEAD").stdout.strip()
        plan = self.plan(
            snapshot,
            [{"paths": ["target.txt"], "message": "bad message"}],
        )

        result, payload = self.run_script("apply", plan=plan)

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(payload["ok"])
        self.assertIn("Conventional Commit", str(payload["error"]))
        self.assertEqual(self.git("rev-parse", "HEAD").stdout.strip(), initial_head)

    def test_apply_requires_head_and_fingerprint(self) -> None:
        self.write_text("target.txt", "target change\n")
        initial_head = self.git("rev-parse", "HEAD").stdout.strip()

        result, payload = self.run_script(
            "apply",
            plan={
                "batches": [
                    {
                        "paths": ["target.txt"],
                        "message": "fix(test): 修复目标文件",
                    }
                ]
            },
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(payload["ok"])
        self.assertIn("head", str(payload["error"]))
        self.assertIn("fingerprint", str(payload["error"]))
        self.assertEqual(self.git("rev-parse", "HEAD").stdout.strip(), initial_head)

    def test_apply_reports_hook_failure_without_retry_or_rollback(self) -> None:
        self.write_text("target.txt", "target change\n")
        snapshot = self.inspect()
        initial_head = self.git("rev-parse", "HEAD").stdout.strip()
        hook = self.repo / ".git/hooks/pre-commit"
        hook.write_text("#!/bin/sh\necho blocked-by-test >&2\nexit 1\n", encoding="utf-8")
        os.chmod(hook, 0o755)
        plan = self.plan(
            snapshot,
            [{"paths": ["target.txt"], "message": "fix(test): 修复目标文件"}],
        )

        result, payload = self.run_script("apply", plan=plan)

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(payload["ok"])
        self.assertFalse(payload["partial"])
        self.assertEqual(payload["committed_count"], 0)
        self.assertIn("blocked-by-test", str(payload["error"]))
        self.assertEqual(self.git("rev-parse", "HEAD").stdout.strip(), initial_head)
        self.assertEqual(
            self.git("diff", "--cached", "--name-only").stdout.strip(),
            "target.txt",
        )

    def test_second_batch_hook_failure_reports_only_first_commit(self) -> None:
        self.write_text("target.txt", "target change\n")
        self.write_text("tracked.txt", "tracked change\n")
        snapshot = self.inspect()
        initial_head = self.git("rev-parse", "HEAD").stdout.strip()
        hook = self.repo / ".git/hooks/pre-commit"
        hook.write_text(
            "#!/bin/sh\n"
            "counter=.git/hook-count\n"
            "count=0\n"
            'test ! -f "$counter" || count=$(cat "$counter")\n'
            "count=$((count + 1))\n"
            'echo "$count" > "$counter"\n'
            'test "$count" -lt 2\n',
            encoding="utf-8",
        )
        os.chmod(hook, 0o755)
        plan = self.plan(
            snapshot,
            [
                {"paths": ["target.txt"], "message": "fix(test): 第一批修改"},
                {"paths": ["tracked.txt"], "message": "fix(test): 第二批修改"},
            ],
        )

        result, payload = self.run_script("apply", plan=plan)

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(payload["ok"])
        self.assertTrue(payload["partial"])
        self.assertEqual(payload["committed_count"], 1)
        self.assertNotEqual(self.git("rev-parse", "HEAD").stdout.strip(), initial_head)
        self.assertEqual(
            self.git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")
            .stdout.strip(),
            "target.txt",
        )


if __name__ == "__main__":
    unittest.main()
