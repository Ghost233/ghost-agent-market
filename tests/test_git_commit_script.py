import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Optional


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (
    ROOT
    / "codex-market/plugins/ghost-agent-skills/skills/git-commit/scripts/git_commit.py"
)


class GitCommitScriptTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        self.root = Path(self.tempdir.name)
        self.repo = self.root / "parent"
        self.repo.mkdir()
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
        env: Optional[dict[str, str]] = None,
    ) -> subprocess.CompletedProcess[str]:
        return self.git_at(self.repo, *args, check=check, env=env)

    def git_at(
        self,
        repo: Path,
        *args: str,
        check: bool = True,
        env: Optional[dict[str, str]] = None,
    ) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            ["git", "-C", str(repo), *args],
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

    def create_submodule(self) -> Path:
        source = self.root / "child-source"
        source.mkdir()
        self.git_at(source, "init", "-q")
        self.git_at(source, "config", "user.name", "Test User")
        self.git_at(source, "config", "user.email", "test@example.com")
        (source / "child.txt").write_text("child base\n", encoding="utf-8")
        self.git_at(source, "add", "--", "child.txt")
        self.git_at(source, "commit", "-qm", "child initial")
        self.git(
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            str(source),
            "vendor/child",
        )
        self.git("commit", "-qm", "add child submodule")
        child = self.repo / "vendor/child"
        self.git_at(child, "config", "user.name", "Test User")
        self.git_at(child, "config", "user.email", "test@example.com")
        return child

    def create_nested_submodule_ignored_by_parent(self) -> tuple[Path, Path]:
        child = self.create_submodule()
        source = self.root / "grandchild-source"
        source.mkdir()
        self.git_at(source, "init", "-q")
        self.git_at(source, "config", "user.name", "Test User")
        self.git_at(source, "config", "user.email", "test@example.com")
        (source / "grandchild.txt").write_text(
            "grandchild base\n", encoding="utf-8"
        )
        self.git_at(source, "add", "--", "grandchild.txt")
        self.git_at(source, "commit", "-qm", "grandchild initial")
        self.git_at(
            child,
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            str(source),
            "vendor/grandchild",
        )
        self.git_at(
            child,
            "config",
            "-f",
            ".gitmodules",
            "submodule.vendor/grandchild.ignore",
            "all",
        )
        self.git_at(child, "add", "--", ".gitmodules", "vendor/grandchild")
        self.git_at(child, "commit", "-qm", "add ignored grandchild")
        self.git("add", "--", "vendor/child")
        self.git("commit", "-qm", "record nested submodule")
        grandchild = child / "vendor/grandchild"
        return child, grandchild

    def run_script(
        self,
        command: str,
        *,
        plan: Optional[dict[str, object]] = None,
        include_diff: bool = False,
        repo: Optional[Path] = None,
    ) -> tuple[subprocess.CompletedProcess[str], dict[str, object]]:
        args = [
            sys.executable,
            str(SCRIPT),
            command,
            "--repo",
            str(repo or self.repo),
        ]
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

    def inspect(
        self,
        *,
        include_diff: bool = False,
        repo: Optional[Path] = None,
    ) -> dict[str, object]:
        result, payload = self.run_script(
            "inspect", include_diff=include_diff, repo=repo
        )
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

    def test_sensitive_path_risks_are_tiered_and_explained(self) -> None:
        self.write_text(
            "scripts/local_mock_2/internal/codec/tokenlist_semantic.go",
            "package codec\n",
        )
        self.write_text("internal/oauth_client.go", "package internal\n")
        self.write_text(".env.production", "API_TOKEN=do-not-leak-value\n")
        self.write_text(".env.example", "API_TOKEN=replace-me\n")
        self.write_text("config/credentials.json", "{}\n")
        self.write_text("config/credentials.production.json", "{}\n")
        self.write_text("config/client_secret.dev.json", "{}\n")
        self.write_text("certificates/public.crt", "public certificate\n")
        self.write_text("keys/id_rsa", "do-not-leak-private-key\n")
        self.write_text("docs/id_rsa/README.md", "SSH key documentation\n")
        self.write_text("secrets/prod.json", "{}\n")
        self.write_text("credentials/aws.ini", "[default]\n")
        self.write_text("tokens/source.go", "package tokens\n")

        payload = self.inspect()
        findings = {
            str(finding["path"]): finding
            for finding in payload["risk_findings"]  # type: ignore[union-attr]
        }

        self.assertEqual(
            set(payload["sensitive_paths"]),
            {
                ".env.production",
                "config/client_secret.dev.json",
                "config/credentials.json",
                "config/credentials.production.json",
                "credentials/aws.ini",
                "keys/id_rsa",
                "secrets/prod.json",
            },
        )
        self.assertEqual(
            set(payload["sensitive_warnings"]),
            {
                ".env.example",
                "certificates/public.crt",
                "internal/oauth_client.go",
                "scripts/local_mock_2/internal/codec/tokenlist_semantic.go",
                "tokens/source.go",
            },
        )
        for path in payload["sensitive_paths"]:  # type: ignore[union-attr]
            finding = findings[str(path)]
            self.assertEqual(finding["severity"], "confirmation-required")
            for field in ("rule_id", "reason", "evidence", "required_action"):
                self.assertTrue(finding[field], f"{path} missing {field}")
        self.assertEqual(
            findings[
                "scripts/local_mock_2/internal/codec/tokenlist_semantic.go"
            ]["severity"],
            "warning",
        )
        self.assertNotIn("docs/id_rsa/README.md", findings)
        self.assertNotIn(
            "do-not-leak-value",
            json.dumps(payload["risk_findings"], ensure_ascii=False),
        )
        self.assertNotIn(
            "do-not-leak-private-key",
            json.dumps(payload["risk_findings"], ensure_ascii=False),
        )

    def test_sensitive_detection_covers_all_git_change_states(self) -> None:
        self.write_text(".env.unstaged", "BASE=value\n")
        self.git("add", "--", ".env.unstaged")
        self.git("commit", "-qm", "add tracked environment file")
        self.write_text(".env.unstaged", "BASE=changed\n")
        self.write_text(".env.staged", "STAGED=value\n")
        self.git("add", "--", ".env.staged")
        self.write_text(".env.untracked", "UNTRACKED=value\n")

        payload = self.inspect()

        self.assertEqual(
            set(payload["sensitive_paths"]),
            {".env.staged", ".env.unstaged", ".env.untracked"},
        )

    def test_inspect_separates_dirty_submodule_from_gitlink_update(self) -> None:
        child = self.create_submodule()
        (child / "child.txt").write_text("dirty child\n", encoding="utf-8")

        payload = self.inspect()

        self.assertEqual(
            [item["path"] for item in payload["blocking_submodules"]],
            ["vendor/child"],
        )
        self.assertEqual(payload["gitlink_updates"], [])
        state = payload["blocking_submodules"][0]
        self.assertTrue(state["worktree_dirty"])
        self.assertIn("worktree-dirty", state["blocking_reasons"])
        self.assertEqual(payload["dirty_submodules"], payload["blocking_submodules"])

    def test_apply_rejects_parent_while_submodule_worktree_is_dirty(self) -> None:
        child = self.create_submodule()
        (child / "child.txt").write_text("dirty child\n", encoding="utf-8")
        self.write_text("target.txt", "parent change\n")
        snapshot = self.inspect()
        initial_head = self.git("rev-parse", "HEAD").stdout.strip()

        result, payload = self.run_script(
            "apply",
            plan=self.plan(
                snapshot,
                [{"paths": ["target.txt"], "message": "fix(test): 修复父仓库"}],
            ),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("vendor/child[worktree-dirty]", str(payload["error"]))
        self.assertEqual(self.git("rev-parse", "HEAD").stdout.strip(), initial_head)

    def test_nested_dirty_submodule_is_not_hidden_by_ignore_all(self) -> None:
        child, grandchild = self.create_nested_submodule_ignored_by_parent()
        (grandchild / "grandchild.txt").write_text(
            "hidden dirty grandchild\n", encoding="utf-8"
        )
        self.assertEqual(
            self.git_at(child, "status", "--porcelain").stdout,
            "",
            "fixture must hide the nested dirty submodule by default",
        )

        root_snapshot = self.inspect()
        child_snapshot = self.inspect(repo=child)

        self.assertEqual(
            [item["path"] for item in root_snapshot["blocking_submodules"]],
            ["vendor/child"],
        )
        self.assertEqual(
            [item["path"] for item in child_snapshot["blocking_submodules"]],
            ["vendor/grandchild"],
        )

    def test_staged_pointer_not_checked_out_reports_exact_reason(self) -> None:
        self.create_submodule()
        source = self.root / "child-source"
        (source / "child.txt").write_text("new source commit\n", encoding="utf-8")
        self.git_at(source, "add", "--", "child.txt")
        self.git_at(source, "commit", "-qm", "new source commit")
        staged_head = self.git_at(source, "rev-parse", "HEAD").stdout.strip()
        self.git(
            "update-index",
            "--cacheinfo",
            f"160000,{staged_head},vendor/child",
        )
        snapshot = self.inspect()

        self.assertIn(
            "staged-pointer-not-checked-out",
            snapshot["blocking_submodules"][0]["blocking_reasons"],
        )
        result, payload = self.run_script(
            "apply",
            plan=self.plan(
                snapshot,
                [
                    {
                        "paths": ["vendor/child"],
                        "message": "chore(submodule): 记录暂存指针",
                    }
                ],
            ),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "vendor/child[staged-pointer-not-checked-out]",
            str(payload["error"]),
        )

    def test_apply_commits_clean_unstaged_gitlink_update(self) -> None:
        child = self.create_submodule()
        (child / "child.txt").write_text("committed child\n", encoding="utf-8")
        self.git_at(child, "add", "--", "child.txt")
        self.git_at(child, "commit", "-qm", "update child")
        child_head = self.git_at(child, "rev-parse", "HEAD").stdout.strip()
        snapshot = self.inspect()

        self.assertEqual(snapshot["blocking_submodules"], [])
        self.assertEqual(
            [item["path"] for item in snapshot["gitlink_updates"]],
            ["vendor/child"],
        )
        result, payload = self.run_script(
            "apply",
            plan=self.plan(
                snapshot,
                [
                    {
                        "paths": ["vendor/child"],
                        "message": "chore(submodule): 更新子模块指针",
                    }
                ],
            ),
        )

        self.assertEqual(result.returncode, 0, payload)
        recorded = self.git(
            "ls-tree", "HEAD", "--", "vendor/child"
        ).stdout.split()[2]
        self.assertEqual(recorded, child_head)
        self.assertEqual(self.git("status", "--porcelain").stdout, "")

    def test_apply_commits_clean_staged_gitlink_update(self) -> None:
        child = self.create_submodule()
        (child / "child.txt").write_text("staged child\n", encoding="utf-8")
        self.git_at(child, "add", "--", "child.txt")
        self.git_at(child, "commit", "-qm", "update child")
        self.git("add", "--", "vendor/child")
        snapshot = self.inspect()

        self.assertEqual(snapshot["blocking_submodules"], [])
        self.assertTrue(snapshot["gitlink_updates"][0]["staged_pointer"])
        result, payload = self.run_script(
            "apply",
            plan=self.plan(
                snapshot,
                [
                    {
                        "paths": ["vendor/child"],
                        "message": "chore(submodule): 记录子模块提交",
                    }
                ],
            ),
        )

        self.assertEqual(result.returncode, 0, payload)
        self.assertEqual(self.git("status", "--porcelain").stdout, "")

    def test_unchanged_uninitialized_submodule_does_not_block_parent_commit(
        self,
    ) -> None:
        self.create_submodule()
        self.git("submodule", "deinit", "-q", "-f", "--", "vendor/child")
        self.write_text("target.txt", "parent change\n")
        snapshot = self.inspect()

        self.assertEqual(snapshot["blocking_submodules"], [])
        self.assertEqual(snapshot["submodules"], [])
        result, payload = self.run_script(
            "apply",
            plan=self.plan(
                snapshot,
                [{"paths": ["target.txt"], "message": "fix(test): 修复父仓库"}],
            ),
        )

        self.assertEqual(result.returncode, 0, payload)

    def test_inspect_reports_absolute_git_metadata_paths(self) -> None:
        payload = self.inspect()

        self.assertTrue(Path(payload["git_dir"]).is_absolute())
        self.assertTrue(Path(payload["git_common_dir"]).is_absolute())
        self.assertFalse(payload["linked_worktree"])

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

    def test_apply_rejects_multiline_message_and_points_at_trailer(self) -> None:
        self.write_text("target.txt", "target change\n")
        snapshot = self.inspect()
        initial_head = self.git("rev-parse", "HEAD").stdout.strip()
        plan = self.plan(
            snapshot,
            [
                {
                    "paths": ["target.txt"],
                    "message": "fix(test): 修复目标文件\nCo-Authored-By: Nexus <nexus@xfinite.global>",
                }
            ],
        )

        result, payload = self.run_script("apply", plan=plan)

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(payload["ok"])
        error = str(payload["error"])
        self.assertIn("single-line", error)
        self.assertIn("trailer", error)
        self.assertIn("Conventional Commit", error)
        self.assertEqual(self.git("rev-parse", "HEAD").stdout.strip(), initial_head)

    def test_apply_rejects_message_without_chinese(self) -> None:
        self.write_text("target.txt", "target change\n")
        snapshot = self.inspect()
        initial_head = self.git("rev-parse", "HEAD").stdout.strip()
        plan = self.plan(
            snapshot,
            [{"paths": ["target.txt"], "message": "fix(test): fix the target file"}],
        )

        result, payload = self.run_script("apply", plan=plan)

        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(payload["ok"])
        self.assertIn("Chinese characters", str(payload["error"]))
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

    def test_apply_repairs_simple_whitespace_before_staging(self) -> None:
        self.write_text("target.txt", "target change   \n\n")
        snapshot = self.inspect()
        plan = self.plan(
            snapshot,
            [{"paths": ["target.txt"], "message": "fix(test): 修复简单空白"}],
        )

        result, payload = self.run_script("apply", plan=plan)

        self.assertEqual(result.returncode, 0, payload)
        self.assertEqual((self.repo / "target.txt").read_text(), "target change\n")
        actions = {item["action"] for item in payload["batches"][0]["repairs"]}
        self.assertEqual(
            actions,
            {"remove-trailing-whitespace", "remove-extra-eof-blank-lines"},
        )

    def test_apply_repairs_whitespace_without_changing_crlf(self) -> None:
        self.write_bytes("target.txt", b"first   \r\nsecond\r\n\r\n")
        snapshot = self.inspect()
        plan = self.plan(
            snapshot,
            [
                {
                    "paths": ["target.txt"],
                    "message": "fix(test): 修复空白并保留换行",
                }
            ],
        )

        result, payload = self.run_script("apply", plan=plan)

        self.assertEqual(result.returncode, 0, payload)
        self.assertEqual(
            (self.repo / "target.txt").read_bytes(),
            b"first\r\nsecond\r\n",
        )

    def test_apply_preserves_markdown_two_space_hard_break(self) -> None:
        self.write_text("notes.md", "第一行。  \n第二行。\n")
        snapshot = self.inspect()
        plan = self.plan(
            snapshot,
            [{"paths": ["notes.md"], "message": "docs(test): 保留换行语法"}],
        )

        result, payload = self.run_script("apply", plan=plan)

        self.assertEqual(result.returncode, 0, payload)
        self.assertEqual(
            (self.repo / "notes.md").read_text(),
            "第一行。  \n第二行。\n",
        )
        self.assertEqual(
            payload["batches"][0]["allowed_whitespace"][0]["action"],
            "preserve-markdown-hard-break",
        )

    def test_apply_rejects_conflict_marker_without_touching_real_index(self) -> None:
        self.write_text(
            "target.txt",
            "<<<<<<< HEAD\nleft\n=======\nright\n>>>>>>> branch\n",
        )
        snapshot = self.inspect()
        initial_head = self.git("rev-parse", "HEAD").stdout.strip()
        plan = self.plan(
            snapshot,
            [{"paths": ["target.txt"], "message": "fix(test): 检查冲突标记"}],
        )

        result, payload = self.run_script("apply", plan=plan)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("leftover conflict marker", str(payload["error"]))
        self.assertEqual(self.git("rev-parse", "HEAD").stdout.strip(), initial_head)
        self.assertEqual(self.git("diff", "--cached", "--name-only").stdout, "")

    def test_apply_retries_once_when_hook_updates_only_selected_paths(self) -> None:
        self.write_text("target.txt", "needs-format\n")
        snapshot = self.inspect()
        hook = self.repo / ".git/hooks/pre-commit"
        hook.write_text(
            "#!/bin/sh\n"
            "if grep -q needs-format target.txt; then\n"
            "  sed 's/needs-format/formatted/' target.txt > target.tmp\n"
            "  mv target.tmp target.txt\n"
            "  exit 1\n"
            "fi\n"
            "exit 0\n",
            encoding="utf-8",
        )
        os.chmod(hook, 0o755)
        plan = self.plan(
            snapshot,
            [{"paths": ["target.txt"], "message": "style(test): 应用自动格式化"}],
        )

        result, payload = self.run_script("apply", plan=plan)

        self.assertEqual(result.returncode, 0, payload)
        self.assertEqual(payload["batches"][0]["retry_count"], 1)
        self.assertEqual((self.repo / "target.txt").read_text(), "formatted\n")
        self.assertIn(
            "retry-after-hook-updated-selected-paths",
            {item["action"] for item in payload["batches"][0]["repairs"]},
        )

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
