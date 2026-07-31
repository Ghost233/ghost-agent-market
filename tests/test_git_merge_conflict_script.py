import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (
    ROOT
    / "codex-market/plugins/ghost-agent-skills/skills/git-merge-conflict"
    / "scripts/archaeology.sh"
)


class GitMergeConflictScriptTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp_dir.name) / "repo"
        self.repo.mkdir()
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Test User")
        self.git("config", "user.email", "test@example.com")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def git(
        self,
        *args: str,
        cwd: Path | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args],
            cwd=cwd or self.repo,
            check=check,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={
                **os.environ,
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_MERGE_AUTOEDIT": "no",
                "LC_ALL": "C",
            },
        )

    def run_script(
        self,
        *args: str,
        cwd: Path | None = None,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(SCRIPT), *args],
            cwd=cwd or self.repo,
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={**os.environ, "LC_ALL": "C"},
        )

    def write(self, relative: str, content: str) -> None:
        path = self.repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def commit_all(self, message: str) -> str:
        self.git("add", "--all")
        self.git("commit", "-m", message)
        return self.git("rev-parse", "HEAD").stdout.strip()

    def make_conflicting_history(self) -> tuple[str, str, str, Path]:
        conflict_path = self.repo / "conflict file.txt"
        base_lines = [f"base-a-{index}" for index in range(1, 7)]
        gap_lines = [f"unchanged-gap-{index}" for index in range(1, 11)]
        self.write(
            conflict_path.name,
            "\n".join([*base_lines, *gap_lines, "base-second", ""]),
        )
        base = self.commit_all("base")

        self.git("checkout", "-b", "incoming")
        self.write(
            conflict_path.name,
            "\n".join(
                [
                    *(f"incoming-a-{index}" for index in range(1, 7)),
                    *gap_lines,
                    "incoming-second",
                    "",
                ]
            ),
        )
        incoming = self.commit_all("incoming changes")

        self.git("checkout", "main")
        self.write(
            conflict_path.name,
            "\n".join(
                [
                    *(f"current-a-{index}" for index in range(1, 7)),
                    *gap_lines,
                    "current-second",
                    "",
                ]
            ),
        )
        current = self.commit_all("current changes")
        merge = self.git("merge", "incoming", "--no-edit", check=False)
        self.assertNotEqual(merge.returncode, 0)
        self.assertIn("conflict file.txt", self.git("diff", "--name-only", "--diff-filter=U").stdout)
        return base, current, incoming, conflict_path

    def test_bash_syntax_is_valid(self) -> None:
        result = subprocess.run(
            ["bash", "-n", str(SCRIPT)],
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_requires_an_active_conflict_operation(self) -> None:
        self.write("file.txt", "base\n")
        self.commit_all("base")
        result = self.run_script("--context")
        self.assertEqual(result.returncode, 1)
        self.assertIn("merge / rebase / cherry-pick", result.stderr)

    def test_merge_archaeology_is_read_only_and_works_from_subdirectory(self) -> None:
        base, current, incoming, conflict_path = self.make_conflicting_history()
        nested = self.repo / "nested"
        nested.mkdir()
        git_dir = Path(self.git("rev-parse", "--git-dir").stdout.strip())
        index_path = self.repo / git_dir / "index"
        index_before = hashlib.sha256(index_path.read_bytes()).hexdigest()
        worktree_before = conflict_path.read_bytes()

        result = self.run_script(cwd=nested)
        output = result.stdout + result.stderr

        self.assertEqual(result.returncode, 0, output)
        self.assertIn("operation = merge", output)
        self.assertIn(f"= {current[:7]}", output)
        self.assertIn(f"= {incoming[:7]}", output)
        self.assertIn(f"= {base[:7]}", output)
        self.assertIn("conflict file.txt", output)
        self.assertIn("2 处冲突块", output)
        self.assertIn("current-second", output)
        self.assertIn("incoming-second", output)
        self.assertEqual(index_before, hashlib.sha256(index_path.read_bytes()).hexdigest())
        self.assertEqual(worktree_before, conflict_path.read_bytes())

    def test_cherry_pick_uses_commit_parent_as_base(self) -> None:
        self.write("file.txt", "base\n")
        base = self.commit_all("base")
        self.git("checkout", "-b", "incoming")
        self.write("file.txt", "incoming\n")
        incoming = self.commit_all("incoming")
        self.git("checkout", "main")
        self.write("file.txt", "current\n")
        self.commit_all("current")
        cherry_pick = self.git("cherry-pick", incoming, check=False)
        self.assertNotEqual(cherry_pick.returncode, 0)

        result = self.run_script("--context")
        output = result.stdout + result.stderr
        self.assertEqual(result.returncode, 0, output)
        self.assertIn("operation = cherry-pick", output)
        self.assertIn("CHERRY_PICK_HEAD", output)
        self.assertIn(f"= {base[:7]}", output)
        self.assertIn("被重放提交的父提交", output)

    def test_rebase_reports_swapped_branch_side_semantics(self) -> None:
        self.write("file.txt", "base\n")
        base = self.commit_all("base")
        self.git("checkout", "-b", "topic")
        self.write("file.txt", "topic\n")
        topic = self.commit_all("topic")
        self.git("checkout", "main")
        self.write("file.txt", "upstream\n")
        self.commit_all("upstream")
        self.git("checkout", "topic")
        rebase = self.git("rebase", "main", check=False)
        self.assertNotEqual(rebase.returncode, 0)

        result = self.run_script("--context")
        output = result.stdout + result.stderr
        self.assertEqual(result.returncode, 0, output)
        self.assertIn("operation = rebase", output)
        self.assertIn("REBASE_HEAD", output)
        self.assertIn(topic[:7], output)
        self.assertIn(base[:7], output)
        self.assertIn("与按分支名称理解的两侧相反", output)

    def test_replayed_merge_commit_requires_explicit_base(self) -> None:
        self.write("base.txt", "base\n")
        self.commit_all("base")
        self.git("checkout", "-b", "side")
        self.write("side.txt", "side\n")
        self.commit_all("side")
        self.git("checkout", "main")
        self.write("main.txt", "main\n")
        self.commit_all("main")
        self.git("merge", "--no-ff", "side", "-m", "merge side")
        merge_commit = self.git("rev-parse", "HEAD").stdout.strip()
        first_parent = self.git("rev-parse", "HEAD^1").stdout.strip()
        git_dir = Path(self.git("rev-parse", "--git-dir").stdout.strip())
        (self.repo / git_dir / "CHERRY_PICK_HEAD").write_text(
            f"{merge_commit}\n", encoding="ascii"
        )

        rejected = self.run_script("--context")
        self.assertEqual(rejected.returncode, 2)
        self.assertIn("无法自动判断 mainline", rejected.stderr)
        accepted = self.run_script("--base", first_parent, "--context")
        output = accepted.stdout + accepted.stderr
        self.assertEqual(accepted.returncode, 0, output)
        self.assertIn("显式指定", output)
        self.assertIn(first_parent[:7], output)


if __name__ == "__main__":
    unittest.main()
