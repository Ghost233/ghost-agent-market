from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest import mock

from zcode_test_support import (
    ROOT,
    assert_zero_write,
    run_json_cli,
    sha256_bytes,
    snapshot_tree,
)


tempfile.tempdir = os.path.realpath(tempfile.gettempdir())


SOURCE = ROOT / "tooling/zcode-workflow/workflow-config.mjs"
CONFIG_CONTRACT = "ZCODE_WORKFLOW_CONFIG_V2"
RECEIPT_CONTRACT = "ZCODE_WORKFLOW_CONFIG_RECEIPT_V2"
MIGRATION_PREVIEW_CONTRACT = "ZCODE_WORKFLOW_CONFIG_MIGRATION_PREVIEW_V1"
MIGRATION_RECEIPT_CONTRACT = "ZCODE_WORKFLOW_CONFIG_MIGRATION_RECEIPT_V1"
EXECUTION_ROLES = ["planner", "planner_reviewer", "owner", "review"]
DEFAULT_CONFIG = {
    "contract": CONFIG_CONTRACT,
    "parallel": 4,
    "execution_classes": {role: "main" for role in EXECUTION_ROLES},
}
LEGACY_PROFILE_SHAPES = [
    ["planner", "owner", "review"],
    ["planner", "owner", "review", "supervisor"],
    ["main", "planner", "owner", "review"],
    ["main", "planner", "owner", "review", "supervisor"],
]


WORKFLOW_GITIGNORE = (
    "# Managed by Ghost Agent Workflow.\n"
    "*\n"
    "!.gitignore\n"
    "!config.json\n"
    "!owners/\n"
    "!owners/**\n"
    "owners/*/interfaces/\n"
)


def metadata_snapshot(root: Path) -> dict[str, tuple[int, int, int, int]]:
    result: dict[str, tuple[int, int, int, int]] = {}
    for path in [root, *sorted(root.rglob("*"))]:
        metadata = path.lstat()
        result[path.relative_to(root).as_posix() or "."] = (
            metadata.st_ino,
            metadata.st_mode,
            metadata.st_size,
            metadata.st_mtime_ns,
        )
    return result


def legacy_config(roles: list[str]) -> dict[str, object]:
    return {
        "parallel": 8,
        "profiles": {
            role: {"model": "gpt-5.6-sol", "effort": "high"}
            for role in roles
        },
    }


def migrated_config(parallel: int = 8) -> dict[str, object]:
    return {
        **DEFAULT_CONFIG,
        "parallel": parallel,
    }


def serialized_v2_config(value: dict[str, object]) -> bytes:
    return f"{json.dumps(value, indent=2)}\n".encode("utf-8")


def removed_legacy_fields(roles: list[str]) -> list[str]:
    return [
        f"/profiles/{role}/{field}"
        for role in sorted(roles)
        for field in ["model", "effort"]
    ]


def workflow_state(
    *, status: str = "active", run: dict[str, object] | None = None
) -> dict[str, object]:
    completed = status == "completed"
    return {
        "contract": "WORKFLOW_STATE_V1",
        "status": status,
        "reason": None,
        "action": None,
        "revision": 1,
        "next": "completed" if completed else "owner",
        "registry": {"revision": 1, "digest": "registry-digest"},
        "run": run,
        "accepted": None,
        "attention": None,
        "result_ref": "/completed/result.json" if completed else None,
    }


def quick_run(*, status: str = "reserved") -> dict[str, object]:
    return {
        "id": "run-1",
        "kind": "work",
        "owner": "example",
        "generation": 1,
        "work": "implement",
        "title": "执行任务",
        "token": "reservation-token",
        "executor": None,
        "host": None,
        "cursor": None,
        "status": status,
        "request_dag": False,
    }


def goal_state(*, status: str = "active") -> dict[str, object]:
    completed = status == "completed"
    return {
        "contract": "GOAL_STATE_V1",
        "goal_digest": "goal-digest",
        "status": status,
        "controller": "standalone_thread",
        "native_goal": None,
        "worktree_baseline": {
            "ref": "/runtime/workspace-fence.json",
            "digest": "0" * 64,
        },
        "source_blocks": {
            "ref": "/runtime/source-blocks.json",
            "digest": "1" * 64,
        },
        "active_plan_path": None,
        "result_ref": "/runtime/result.json" if completed else None,
        "completed_at": "2026-08-02T00:00:00.000Z" if completed else None,
        "native_sync": {
            "status": "not_required",
            "completion_token": None,
            "objective_digest": "2" * 64,
            "confirmed_at": None,
        },
    }


def task_state(*, status: str = "pending") -> dict[str, object]:
    active = status in {"reserved", "running"}
    return {
        "status": status,
        "reason": None,
        "action": None,
        "attempt": 1 if active else 0,
        "reservation_token": "reservation-token" if active else None,
        "owner_generation": 1 if active else None,
        "executor_id": None,
        "source_revision": 1,
        "validated_source_revision": 1,
        "reserved_at": "2026-08-02T00:00:00.000Z" if active else None,
        "result_path": "/runtime/result.json" if active else None,
        "result_ref": None,
        "result_digest": None,
        "replacement_task_id": None,
        "last_reclaimed_token": None,
        "task_baseline_ref": None,
        "task_baseline_digest": None,
        "expanded_writable_paths": [],
        "accepted_change_seq": None,
    }


def run_state(*, task_status: str = "pending", status: str = "active") -> dict[str, object]:
    return {
        "contract": "DAG_RUN_STATE_V5",
        "status": status,
        "reason": None,
        "action": None,
        "plan_digest": "plan-digest",
        "goal_digest": "goal-digest",
        "goal_refresh_pending": False,
        "source_revision": 1,
        "revision": 1,
        "workspace_change_seq": 0,
        "owner_registry": {
            "ref": "/runtime/owners/registry.json",
            "digest": "registry-digest",
            "revision": 1,
        },
        "owner_change": None,
        "tasks": {"task": task_state(status=task_status)},
        "owners": {},
        "runtime_actors": {},
        "reviewers": {},
        "review_pending": [],
        "stale_executors": [],
    }


def thread_registry(
    *, status: str = "completed", watches: list[dict[str, object]] | None = None
) -> dict[str, object]:
    return {
        "contract": "THREAD_REGISTRY_V1",
        "goal_id": "legacy",
        "main": {"thread_id": "main-thread", "host_id": "host-1"},
        "threads": {
            "wf_worker": {
                "thread_id": "worker-thread",
                "host_id": "host-1",
                "role": "owner",
                "status": status,
                "cursor": None,
            }
        },
        "watches": [] if watches is None else watches,
    }


def owner_lease(*, status: str = "reserved") -> dict[str, object]:
    return {
        "contract": "OWNER_LEASE_V1",
        "owner_id": "example",
        "goal_id": "legacy",
        "task_id": "task",
        "state_path": "/runtime/state.json",
        "reservation_token": "reservation-token",
        "executor_id": None,
        "acquired_at": "2026-08-02T00:00:00.000Z",
        "heartbeat_at": "2026-08-02T00:00:00.000Z",
        "status": status,
    }


def owner_thread() -> dict[str, object]:
    return {
        "contract": "OWNER_THREAD_V1",
        "owner": "example",
        "generation": 1,
        "thread_id": "worker-thread",
        "host_id": "host-1",
        "updated_at": "2026-08-02T00:00:00.000Z",
    }


def worktrees(*, owner_path: str | None) -> dict[str, object]:
    return {
        "contract": "DAG_WORKTREES_V1",
        "original": {
            "path": "/workspace",
            "branch": "main",
            "head": "0123456789abcdef",
        },
        "dag": {"path": "/workspace-dag", "branch": "ga/dev/main"},
        "owners": {
            "example": {
                "branch": "ga/dev/example",
                "path": owner_path,
                "synced_dag_head": "0123456789abcdef",
            }
        },
    }


class ZCodeWorkflowConfigCliTests(unittest.TestCase):
    def run_json(
        self,
        command: str,
        workspace: Path | str,
        *args: str,
        env: dict[str, str] | None = None,
    ) -> tuple[object, dict[str, object] | None]:
        with mock.patch.dict(os.environ, env or {}, clear=False):
            return run_json_cli(
                ["node", str(SOURCE), command, str(workspace), *args]
            )

    def assert_workspace_unchanged(
        self,
        root: Path,
        before_tree: dict[str, tuple[bytes, int]],
        before_metadata: dict[str, tuple[int, int, int, int]],
    ) -> None:
        assert_zero_write(self, before_tree, snapshot_tree(root))
        self.assertEqual(metadata_snapshot(root), before_metadata)

    def write_config(self, root: Path, value: object) -> Path:
        path = root / ".ghost-agent-workflow/config.json"
        path.parent.mkdir()
        path.write_text(json.dumps(value), encoding="utf-8")
        return path

    def assert_receipt(
        self,
        payload: dict[str, object] | None,
        *,
        operation: str,
        status: str,
        path: Path,
        source: str,
        config: object,
    ) -> None:
        self.assertEqual(
            payload,
            {
                "contract": RECEIPT_CONTRACT,
                "operation": operation,
                "status": status,
                "path": str(path.absolute()),
                "source": source,
                "config": config,
            },
        )

    def assert_writer_receipt(
        self,
        payload: dict[str, object] | None,
        *,
        operation: str,
        status: str,
        path: Path,
        source: str,
        config: object,
        changed_fields: list[str] | None = None,
    ) -> None:
        expected: dict[str, object] = {
            "contract": RECEIPT_CONTRACT,
            "operation": operation,
            "status": status,
            "path": str(path.absolute()),
            "source": source,
            "config": config,
        }
        if changed_fields is not None:
            expected["changed_fields"] = changed_fields
        self.assertEqual(payload, expected)

    def assert_migration_preview(
        self,
        payload: dict[str, object] | None,
        *,
        path: Path,
        source_digest: str,
        target_config: dict[str, object],
        removed_fields: list[str],
    ) -> None:
        self.assertEqual(
            payload,
            {
                "contract": MIGRATION_PREVIEW_CONTRACT,
                "operation": "migrate",
                "status": "preview",
                "path": str(path.absolute()),
                "source": "legacy",
                "source_digest": source_digest,
                "target_digest": sha256_bytes(serialized_v2_config(target_config)),
                "target_config": target_config,
                "removed_fields": removed_fields,
                "changed_fields": [
                    "/contract",
                    "/profiles",
                    "/execution_classes",
                ],
            },
        )

    def assert_migration_receipt(
        self,
        payload: dict[str, object] | None,
        *,
        path: Path,
        source_digest: str,
        target_config: dict[str, object],
        removed_fields: list[str],
        backup_path: Path,
    ) -> None:
        self.assertEqual(
            payload,
            {
                "contract": MIGRATION_RECEIPT_CONTRACT,
                "operation": "migrate",
                "status": "migrated",
                "path": str(path.absolute()),
                "source": "legacy",
                "source_digest": source_digest,
                "target_digest": sha256_bytes(serialized_v2_config(target_config)),
                "config": target_config,
                "changed_fields": [
                    "/contract",
                    "/profiles",
                    "/execution_classes",
                ],
                "removed_fields": removed_fields,
                "backup_path": str(backup_path.absolute()),
            },
        )

    def test_migrate_preview_is_digest_bound_deterministic_and_zero_write(self) -> None:
        for roles in LEGACY_PROFILE_SHAPES:
            with (
                self.subTest(roles=roles),
                tempfile.TemporaryDirectory() as directory,
            ):
                root = Path(directory)
                path = root / ".ghost-agent-workflow/config.json"
                path.parent.mkdir()
                source_bytes = (
                    json.dumps(legacy_config(roles), indent=1, sort_keys=False) + "\n"
                ).encode("utf-8")
                path.write_bytes(source_bytes)
                custom_gitignore = path.parent / ".gitignore"
                custom_gitignore.write_text("custom-rule\n", encoding="utf-8")
                before_tree = snapshot_tree(root)
                before_metadata = metadata_snapshot(root)

                result, payload = self.run_json("migrate", root)

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stderr, "")
                self.assert_migration_preview(
                    payload,
                    path=path,
                    source_digest=sha256_bytes(source_bytes),
                    target_config=migrated_config(),
                    removed_fields=removed_legacy_fields(roles),
                )
                self.assert_workspace_unchanged(root, before_tree, before_metadata)
                self.assertEqual(custom_gitignore.read_text(encoding="utf-8"), "custom-rule\n")

    def test_migrate_validates_every_legacy_model_and_effort_without_writes(self) -> None:
        for field, invalid_value, expected_error in [
            ("model", "", ".model must be a non-empty string"),
            ("effort", "impossible", ".effort is invalid"),
        ]:
            for roles in LEGACY_PROFILE_SHAPES:
                for role in roles:
                    with (
                        self.subTest(field=field, roles=roles, role=role),
                        tempfile.TemporaryDirectory() as directory,
                    ):
                        root = Path(directory)
                        value = legacy_config(roles)
                        value["profiles"][role][field] = invalid_value
                        path = self.write_config(root, value)
                        digest = sha256_bytes(path.read_bytes())
                        before_tree = snapshot_tree(root)
                        before_metadata = metadata_snapshot(root)

                        for arguments in [(), ("--apply", digest)]:
                            result, payload = self.run_json("migrate", root, *arguments)

                            self.assertEqual(result.returncode, 1, result.stderr)
                            self.assertIsNone(payload)
                            self.assertIn(f"config.profiles.{role}{expected_error}", result.stderr)
                            self.assert_workspace_unchanged(root, before_tree, before_metadata)

    def test_migrate_apply_preserves_parallel_mode_and_exact_source_backup(self) -> None:
        for roles in LEGACY_PROFILE_SHAPES:
            with (
                self.subTest(roles=roles),
                tempfile.TemporaryDirectory() as directory,
            ):
                root = Path(directory)
                path = root / ".ghost-agent-workflow/config.json"
                path.parent.mkdir()
                source_bytes = (
                    json.dumps(legacy_config(roles), separators=(",", ":")) + "\n"
                ).encode("utf-8")
                path.write_bytes(source_bytes)
                path.chmod(0o600)
                gitignore = path.parent / ".gitignore"
                gitignore.write_text("custom-rule\n", encoding="utf-8")
                digest = sha256_bytes(source_bytes)

                result, payload = self.run_json("migrate", root, "--apply", digest)

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stderr, "")
                target = migrated_config()
                self.assertEqual(path.read_bytes(), serialized_v2_config(target))
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                self.assertEqual(gitignore.read_text(encoding="utf-8"), "custom-rule\n")
                backups = list(path.parent.glob("config.v1.backup-*.json"))
                self.assertEqual(len(backups), 1)
                backup = backups[0]
                self.assertRegex(
                    backup.name,
                    rf"^config\.v1\.backup-\d{{8}}T\d{{9}}Z-{digest[7:19]}\.json$",
                )
                self.assertEqual(backup.read_bytes(), source_bytes)
                self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)
                self.assert_migration_receipt(
                    payload,
                    path=path,
                    source_digest=digest,
                    target_config=target,
                    removed_fields=removed_legacy_fields(roles),
                    backup_path=backup,
                )
                self.assertFalse(
                    any(
                        candidate.name.endswith((".tmp", ".bak", ".rollback.tmp"))
                        for candidate in path.parent.iterdir()
                    )
                )

    def test_migrate_apply_rejects_missing_malformed_mismatch_and_stale_digest(self) -> None:
        cases = [
            (("--apply",), "requires --apply <sha256-digest>"),
            (("unexpected",), "migrate takes no arguments or --apply <sha256-digest>"),
            (("--apply", "sha256:ABC"), "sha256:<64 lowercase hexadecimal"),
            (("--apply", f"sha256:{'0' * 64}"), "source digest mismatch"),
        ]
        for arguments, expected_error in cases:
            with (
                self.subTest(arguments=arguments),
                tempfile.TemporaryDirectory() as directory,
            ):
                root = Path(directory)
                self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
                before_tree = snapshot_tree(root)
                before_metadata = metadata_snapshot(root)

                command = ["node", str(SOURCE), "migrate", str(root), *arguments]
                result, payload = run_json_cli(command)

                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIsNone(payload)
                self.assertIn(expected_error, result.stderr)
                self.assert_workspace_unchanged(root, before_tree, before_metadata)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
            stale_digest = sha256_bytes(path.read_bytes())
            changed = legacy_config(LEGACY_PROFILE_SHAPES[0])
            changed["parallel"] = 7
            path.write_text(json.dumps(changed), encoding="utf-8")
            before_tree = snapshot_tree(root)
            before_metadata = metadata_snapshot(root)

            result, payload = self.run_json(
                "migrate", root, "--apply", str(stale_digest)
            )

            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIsNone(payload)
            self.assertIn("source digest mismatch", result.stderr)
            self.assert_workspace_unchanged(root, before_tree, before_metadata)

    def test_migrate_rejects_missing_v2_invalid_v1_and_unsafe_paths_without_write(self) -> None:
        existing_cases: list[tuple[str, object | None, str]] = [
            ("missing", None, "missing"),
            ("v2", DEFAULT_CONFIG, "already V2"),
            (
                "invalid v1",
                legacy_config(["planner", "owner"]),
                "allowed legacy shape",
            ),
        ]
        for name, value, expected_error in existing_cases:
            with (
                self.subTest(case=name),
                tempfile.TemporaryDirectory() as directory,
            ):
                root = Path(directory)
                if value is not None:
                    path = self.write_config(root, value)
                    digest = sha256_bytes(path.read_bytes())
                else:
                    digest = f"sha256:{'0' * 64}"
                before_tree = snapshot_tree(root)
                before_metadata = metadata_snapshot(root)

                for arguments in [(), ("--apply", digest)]:
                    result, payload = self.run_json("migrate", root, *arguments)

                    self.assertNotEqual(result.returncode, 0)
                    self.assertIsNone(payload)
                    self.assertIn(expected_error, result.stderr)
                    self.assert_workspace_unchanged(root, before_tree, before_metadata)

        for unsafe in ["ancestor symlink", "config symlink"]:
            with (
                self.subTest(unsafe=unsafe),
                tempfile.TemporaryDirectory() as directory,
            ):
                base = Path(directory)
                outside = base / "outside"
                outside.mkdir()
                outside_workspace = outside / "workspace"
                outside_workspace.mkdir()
                self.write_config(
                    outside_workspace,
                    legacy_config(LEGACY_PROFILE_SHAPES[0]),
                )
                if unsafe == "ancestor symlink":
                    ancestor = base / "ancestor"
                    os.symlink(outside, ancestor)
                    root = ancestor / "workspace"
                else:
                    root = base / "workspace"
                    workflow_root = root / ".ghost-agent-workflow"
                    workflow_root.mkdir(parents=True)
                    os.symlink(
                        outside_workspace / ".ghost-agent-workflow/config.json",
                        workflow_root / "config.json",
                    )
                before_tree = snapshot_tree(base)
                before_metadata = metadata_snapshot(base)

                for arguments in [(), ("--apply", f"sha256:{'0' * 64}")]:
                    result, payload = self.run_json("migrate", root, *arguments)

                    self.assertNotEqual(result.returncode, 0)
                    self.assertIsNone(payload)
                    self.assertIn("symbolic link", result.stderr)
                    self.assert_workspace_unchanged(base, before_tree, before_metadata)

    def test_migrate_apply_refuses_active_legacy_runtime_markers(self) -> None:
        watch = {
            "task_id": "task",
            "attempt": 1,
            "thread_key": "wf_worker",
            "unchanged_waits": 0,
        }
        marker_cases = [
            ("workflow-state.json", workflow_state(run=quick_run())),
            ("state.json", run_state(task_status="running")),
            ("threads.json", thread_registry(watches=[watch])),
        ]
        for marker_name, marker in marker_cases:
            with (
                self.subTest(marker=marker_name),
                tempfile.TemporaryDirectory() as directory,
            ):
                root = Path(directory)
                path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
                digest = sha256_bytes(path.read_bytes())
                goal = path.parent / "runtime/goals/legacy"
                goal.mkdir(parents=True)
                (goal / marker_name).write_text(json.dumps(marker), encoding="utf-8")
                before_tree = snapshot_tree(root)
                before_metadata = metadata_snapshot(root)

                result, payload = self.run_json(
                    "migrate", root, "--apply", digest
                )

                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIsNone(payload)
                self.assertIn("active legacy workflow", result.stderr)
                self.assert_workspace_unchanged(root, before_tree, before_metadata)

    def test_migrate_apply_allows_completed_legacy_runtime_markers(self) -> None:
        completed_cases = [
            {
                "state.json": run_state(task_status="completed", status="completed"),
                "threads.json": thread_registry(status="completed"),
            },
            {
                "workflow-state.json": workflow_state(status="completed"),
                "worktrees.json": worktrees(owner_path="/completed/owner/worktree"),
            },
        ]
        for markers in completed_cases:
            with (
                self.subTest(markers=sorted(markers)),
                tempfile.TemporaryDirectory() as directory,
            ):
                root = Path(directory)
                path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
                digest = sha256_bytes(path.read_bytes())
                goal = path.parent / "runtime/goals/legacy"
                goal.mkdir(parents=True)
                for name, marker in markers.items():
                    (goal / name).write_text(json.dumps(marker), encoding="utf-8")

                result, payload = self.run_json(
                    "migrate", root, "--apply", digest
                )

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(payload["status"], "migrated")
                self.assertEqual(json.loads(path.read_text(encoding="utf-8")), migrated_config())

    def test_migrate_detects_source_mutation_after_preflight_without_overwriting_it(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
            source_bytes = path.read_bytes()
            digest = sha256_bytes(source_bytes)
            changed = legacy_config(LEGACY_PROFILE_SHAPES[0])
            changed["parallel"] = 7
            changed_bytes = json.dumps(changed).encode("utf-8")
            preload = root / "mutate-after-preflight.mjs"
            preload.write_text(
                """
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const originalReadFileSync = fs.readFileSync;
let configDescriptorReads = 0;
fs.readFileSync = function (...args) {
  if (typeof args[0] === "number") {
    configDescriptorReads += 1;
    if (
      configDescriptorReads === 3 &&
      process.env.ZCODE_WORKFLOW_CONFIG_TEST_MUTATE_STAGE === "after-migration-preflight"
    ) {
      fs.writeFileSync(
        process.env.ZCODE_WORKFLOW_CONFIG_TEST_MUTATE_PATH,
        Buffer.from(process.env.ZCODE_WORKFLOW_CONFIG_TEST_MUTATE_BYTES, "base64"),
      );
    }
  }
  return originalReadFileSync.apply(this, args);
};
syncBuiltinESMExports();
""".strip()
                + "\n",
                encoding="utf-8",
            )

            with mock.patch.dict(
                os.environ,
                {
                    "ZCODE_WORKFLOW_CONFIG_TEST_MUTATE_STAGE": "after-migration-preflight",
                    "ZCODE_WORKFLOW_CONFIG_TEST_MUTATE_PATH": str(path),
                    "ZCODE_WORKFLOW_CONFIG_TEST_MUTATE_BYTES": base64.b64encode(
                        changed_bytes
                    ).decode("ascii"),
                },
                clear=False,
            ):
                result, payload = run_json_cli(
                    [
                        "node",
                        "--import",
                        str(preload),
                        str(SOURCE),
                        "migrate",
                        str(root),
                        "--apply",
                        digest,
                    ]
                )

            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIsNone(payload)
            self.assertIn("source changed after migration preflight", result.stderr)
            self.assertEqual(path.read_bytes(), changed_bytes)
            self.assertEqual(
                sorted(candidate.name for candidate in path.parent.iterdir()),
                ["config.json"],
            )
            self.assertFalse(list(path.parent.glob("config.v1.backup-*.json")))
            self.assertFalse(
                any(candidate.name.endswith(".tmp") for candidate in path.parent.iterdir())
            )

    def test_migrate_faults_restore_exact_v1_and_remove_backup_and_temps(self) -> None:
        stages = [
            "after-migration-preflight",
            "after-backup-create",
            "after-config-rename",
            "before-post-write-verification",
            "after-post-write-verification",
            "before-migration-receipt-write",
            "after-migration-receipt-write",
        ]
        for stage in stages:
            with (
                self.subTest(stage=stage),
                tempfile.TemporaryDirectory() as directory,
            ):
                root = Path(directory)
                path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
                path.chmod(0o600)
                digest = sha256_bytes(path.read_bytes())
                before_tree = snapshot_tree(root)
                before_metadata = metadata_snapshot(root)

                result, payload = self.run_json(
                    "migrate",
                    root,
                    "--apply",
                    digest,
                    env={"ZCODE_WORKFLOW_CONFIG_TEST_FAIL_STAGE": stage},
                )

                self.assertNotEqual(result.returncode, 0)
                if stage == "after-migration-receipt-write":
                    self.assertEqual(payload["status"], "migrated")
                else:
                    self.assertIsNone(payload)
                self.assertIn(stage, result.stderr)
                self.assertEqual(snapshot_tree(root), before_tree)
                after_metadata = metadata_snapshot(root)
                self.assertEqual(
                    after_metadata[".ghost-agent-workflow/config.json"][1:3],
                    before_metadata[".ghost-agent-workflow/config.json"][1:3],
                )
                self.assertFalse(list(path.parent.glob("config.v1.backup-*.json")))
                self.assertFalse(
                    any(
                        candidate.name.endswith((".tmp", ".bak", ".rollback.tmp"))
                        for candidate in path.parent.iterdir()
                    )
                )

    def test_migrate_apply_refuses_each_exact_active_legacy_marker_and_allows_inert_runtime_entries(self) -> None:
        watch = {
            "task_id": "task",
            "attempt": 1,
            "thread_key": "wf_worker",
            "unchanged_waits": 0,
        }
        active_cases = [
            ("quick run", "goals/quick/workflow-state.json", workflow_state(run=quick_run())),
            ("running task", "goals/dag/state.json", run_state(task_status="running")),
            ("reserved task", "goals/dag/state.json", run_state(task_status="reserved")),
            ("thread watch", "goals/dag/threads.json", thread_registry(watches=[watch])),
            ("idle thread", "goals/dag/threads.json", thread_registry(status="idle")),
            ("needs-attention thread", "goals/dag/threads.json", thread_registry(status="needs_attention")),
            ("notified thread", "goals/dag/threads.json", thread_registry(status="attention_notified")),
            ("stalled thread", "goals/dag/threads.json", thread_registry(status="stalled")),
            ("lost thread", "goals/dag/threads.json", thread_registry(status="lost")),
            ("owner lease", "owners/example/lease.json", owner_lease()),
        ]
        for name, marker_relative, marker in active_cases:
            with self.subTest(marker=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
                digest = sha256_bytes(path.read_bytes())
                marker_path = path.parent / "runtime" / marker_relative
                marker_path.parent.mkdir(parents=True)
                marker_path.write_text(json.dumps(marker), encoding="utf-8")
                before_tree = snapshot_tree(root)
                before_metadata = metadata_snapshot(root)

                result, payload = self.run_json("migrate", root, "--apply", digest)

                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIsNone(payload)
                self.assertIn(str(marker_path.absolute()), result.stderr)
                self.assert_workspace_unchanged(root, before_tree, before_metadata)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
            digest = sha256_bytes(path.read_bytes())
            goal = path.parent / "runtime/goals/dag"
            goal.mkdir(parents=True)
            workflow_path = goal / "workflow-state.json"
            workflow_path.write_text(
                json.dumps(workflow_state(status="active")), encoding="utf-8"
            )
            worktrees_path = goal / "worktrees.json"
            worktrees_path.write_text(
                json.dumps(worktrees(owner_path="/tmp/owner-worktree")),
                encoding="utf-8",
            )
            before_tree = snapshot_tree(root)
            before_metadata = metadata_snapshot(root)

            result, payload = self.run_json("migrate", root, "--apply", digest)

            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIsNone(payload)
            self.assertIn(str(worktrees_path.absolute()), result.stderr)
            self.assert_workspace_unchanged(root, before_tree, before_metadata)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
            digest = sha256_bytes(path.read_bytes())
            runtime = path.parent / "runtime"
            (runtime / "unrelated").mkdir(parents=True)
            (runtime / "unrelated/note.txt").write_text("not an active marker\n", encoding="utf-8")

            result, payload = self.run_json("migrate", root, "--apply", digest)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(payload["status"], "migrated")

    def test_migrate_allows_owner_thread_affinity_but_refuses_correlated_registry_activity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
            digest = sha256_bytes(path.read_bytes())
            thread_path = path.parent / "runtime/owners/example/thread.json"
            thread_path.parent.mkdir(parents=True)
            thread_path.write_text(json.dumps(owner_thread()), encoding="utf-8")

            result, payload = self.run_json("migrate", root, "--apply", digest)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(payload["status"], "migrated")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
            digest = sha256_bytes(path.read_bytes())
            thread_path = path.parent / "runtime/owners/example/thread.json"
            thread_path.parent.mkdir(parents=True)
            thread_path.write_text(json.dumps(owner_thread()), encoding="utf-8")
            registry_path = path.parent / "runtime/goals/legacy/threads.json"
            registry_path.parent.mkdir(parents=True)
            registry_path.write_text(
                json.dumps(thread_registry(status="running")), encoding="utf-8"
            )
            before_tree = snapshot_tree(root)
            before_metadata = metadata_snapshot(root)

            result, payload = self.run_json("migrate", root, "--apply", digest)

            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIsNone(payload)
            self.assertIn(str(registry_path.absolute()), result.stderr)
            self.assert_workspace_unchanged(root, before_tree, before_metadata)

    def test_migrate_apply_rejects_drift_after_preview_hook_without_writes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
            original_bytes = path.read_bytes()
            changed = legacy_config(LEGACY_PROFILE_SHAPES[0])
            changed["parallel"] = 7
            changed_bytes = json.dumps(changed).encode("utf-8")

            preview_result, preview = self.run_json(
                "migrate",
                root,
                env={
                    "ZCODE_WORKFLOW_CONFIG_TEST_MUTATE_STAGE": "after-migration-preview",
                    "ZCODE_WORKFLOW_CONFIG_TEST_MUTATE_PATH": str(path),
                    "ZCODE_WORKFLOW_CONFIG_TEST_MUTATE_BYTES": base64.b64encode(changed_bytes).decode("ascii"),
                },
            )

            self.assertEqual(preview_result.returncode, 0, preview_result.stderr)
            source_digest = preview["source_digest"]
            self.assertEqual(source_digest, sha256_bytes(original_bytes))
            self.assertEqual(path.read_bytes(), changed_bytes)
            before_tree = snapshot_tree(root)
            before_metadata = metadata_snapshot(root)

            result, payload = self.run_json(
                "migrate", root, "--apply", source_digest
            )

            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIsNone(payload)
            self.assertIn("source digest mismatch", result.stderr)
            self.assert_workspace_unchanged(root, before_tree, before_metadata)
            self.assertFalse(list(path.parent.glob("config.v1.backup-*.json")))

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
            digest = sha256_bytes(path.read_bytes())

            result, payload = self.run_json(
                "migrate",
                root,
                "--apply",
                digest,
                env={"ZCODE_WORKFLOW_CONFIG_TEST_MUTATE_STAGE": "unknown-stage"},
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(payload["status"], "migrated")

    def test_migrate_mutation_hook_after_preflight_refuses_without_backup(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
            digest = sha256_bytes(path.read_bytes())
            changed = legacy_config(LEGACY_PROFILE_SHAPES[0])
            changed["parallel"] = 7
            changed_bytes = json.dumps(changed).encode("utf-8")

            result, payload = self.run_json(
                "migrate",
                root,
                "--apply",
                digest,
                env={
                    "ZCODE_WORKFLOW_CONFIG_TEST_MUTATE_STAGE": "after-migration-preflight",
                    "ZCODE_WORKFLOW_CONFIG_TEST_MUTATE_PATH": str(path),
                    "ZCODE_WORKFLOW_CONFIG_TEST_MUTATE_BYTES": base64.b64encode(changed_bytes).decode("ascii"),
                },
            )

            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIsNone(payload)
            self.assertIn("source changed after migration preflight", result.stderr)
            self.assertEqual(path.read_bytes(), changed_bytes)
            self.assertFalse(list(path.parent.glob("config.v1.backup-*.json")))
            self.assertFalse(any(candidate.name.endswith(".tmp") for candidate in path.parent.iterdir()))

    def test_migrate_receipt_stdout_failure_restores_v1_before_backup_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
            path.chmod(0o600)
            digest = sha256_bytes(path.read_bytes())
            before_tree = snapshot_tree(root)
            before_metadata = metadata_snapshot(root)
            preload = root / "fail-migration-receipt-write.mjs"
            preload.write_text(
                """
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function (chunk, ...args) {
  if (String(chunk).includes('ZCODE_WORKFLOW_CONFIG_MIGRATION_RECEIPT_V1')) {
    throw new Error('injected stdout migration receipt failure');
  }
  return originalWrite(chunk, ...args);
};
""".strip()
                + "\n",
                encoding="utf-8",
            )
            expected_tree = snapshot_tree(root)
            expected_metadata = metadata_snapshot(root)

            result, payload = run_json_cli(
                [
                    "node",
                    "--import",
                    str(preload),
                    str(SOURCE),
                    "migrate",
                    str(root),
                    "--apply",
                    digest,
                ]
            )

            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertIsNone(payload)
            self.assertIn("injected stdout migration receipt failure", result.stderr)
            self.assertEqual(snapshot_tree(root), expected_tree)
            after_metadata = metadata_snapshot(root)
            self.assertEqual(
                after_metadata[".ghost-agent-workflow/config.json"][1:3],
                expected_metadata[".ghost-agent-workflow/config.json"][1:3],
            )
            self.assertEqual(
                after_metadata["fail-migration-receipt-write.mjs"],
                expected_metadata["fail-migration-receipt-write.mjs"],
            )
            self.assertFalse(list(path.parent.glob("config.v1.backup-*.json")))
            self.assertFalse(
                any(
                    candidate.name.endswith((".tmp", ".bak", ".rollback.tmp"))
                    for candidate in path.parent.iterdir()
                )
            )
            self.assertNotEqual(before_tree, expected_tree)
            self.assertNotEqual(before_metadata, expected_metadata)

    def test_migrate_malformed_recognized_markers_safe_refuse_without_writes(self) -> None:
        valid_markers: dict[str, dict[str, object]] = {
            "workflow-state.json": workflow_state(status="completed"),
            "state.json": run_state(task_status="pending", status="completed"),
            "threads.json": thread_registry(status="completed"),
            "worktrees.json": worktrees(owner_path=None),
        }
        cases: list[tuple[str, str, object]] = [
            ("workflow wrong contract", "goals/legacy/workflow-state.json", {**valid_markers["workflow-state.json"], "contract": "WRONG"}),
            ("workflow array", "goals/legacy/workflow-state.json", []),
            ("workflow invalid run", "goals/legacy/workflow-state.json", {**workflow_state(), "run": {"status": "running"}}),
            ("goal wrong contract", "goals/legacy/goal-state.json", {"contract": "WRONG", "status": "completed"}),
            ("goal array", "goals/legacy/goal-state.json", []),
            ("goal invalid status", "goals/legacy/goal-state.json", {"contract": "GOAL_STATE_V1", "status": "unknown"}),
            ("state wrong contract", "goals/legacy/state.json", {**valid_markers["state.json"], "contract": "WRONG"}),
            ("state tasks array", "goals/legacy/state.json", {**valid_markers["state.json"], "tasks": []}),
            ("state task entry", "goals/legacy/state.json", {**valid_markers["state.json"], "tasks": {"task": "bad"}}),
            ("state task status", "goals/legacy/state.json", {**valid_markers["state.json"], "tasks": {"task": {**task_state(), "status": "unknown"}}}),
            ("state boolean", "goals/legacy/state.json", {**valid_markers["state.json"], "goal_refresh_pending": "false"}),
            ("threads wrong contract", "goals/legacy/threads.json", {**valid_markers["threads.json"], "contract": "WRONG"}),
            ("threads array", "goals/legacy/threads.json", {**valid_markers["threads.json"], "threads": []}),
            ("thread entry", "goals/legacy/threads.json", {**valid_markers["threads.json"], "threads": {"wf_worker": "bad"}}),
            ("thread status", "goals/legacy/threads.json", thread_registry(status="unknown")),
            ("watches string", "goals/legacy/threads.json", {**valid_markers["threads.json"], "watches": "bad"}),
            ("watch entry", "goals/legacy/threads.json", {**valid_markers["threads.json"], "watches": ["bad"]}),
            ("worktrees wrong contract", "goals/legacy/worktrees.json", {**valid_markers["worktrees.json"], "contract": "WRONG"}),
            ("worktrees owners array", "goals/legacy/worktrees.json", {**valid_markers["worktrees.json"], "owners": []}),
            ("worktree owner entry", "goals/legacy/worktrees.json", {**valid_markers["worktrees.json"], "owners": {"example": "bad"}}),
            ("lease wrong contract", "owners/example/lease.json", {**owner_lease(), "contract": "WRONG"}),
            ("lease invalid shape", "owners/example/lease.json", {"contract": "OWNER_LEASE_V1", "status": "reserved"}),
            ("lease invalid status", "owners/example/lease.json", {**owner_lease(), "status": "completed"}),
        ]
        for name, relative, marker in cases:
            with self.subTest(case=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
                digest = sha256_bytes(path.read_bytes())
                marker_path = path.parent / "runtime" / relative
                marker_path.parent.mkdir(parents=True)
                marker_path.write_text(json.dumps(marker), encoding="utf-8")
                before_tree = snapshot_tree(root)
                before_metadata = metadata_snapshot(root)

                result, payload = self.run_json("migrate", root, "--apply", digest)

                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIsNone(payload)
                self.assertIn(str(marker_path.absolute()), result.stderr)
                self.assert_workspace_unchanged(root, before_tree, before_metadata)

        for target_type in ["symlink", "directory"]:
            with self.subTest(target_type=target_type), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
                digest = sha256_bytes(path.read_bytes())
                marker_path = path.parent / "runtime/goals/legacy/threads.json"
                marker_path.parent.mkdir(parents=True)
                if target_type == "symlink":
                    outside = root / "outside.json"
                    outside.write_text(json.dumps(thread_registry()), encoding="utf-8")
                    os.symlink(outside, marker_path)
                else:
                    marker_path.mkdir()
                before_tree = snapshot_tree(root)
                before_metadata = metadata_snapshot(root)

                result, payload = self.run_json("migrate", root, "--apply", digest)

                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIsNone(payload)
                self.assertIn(str(marker_path.absolute()), result.stderr)
                self.assert_workspace_unchanged(root, before_tree, before_metadata)

    def test_migrate_apply_backup_collision_and_failure_after_backup_are_zero_write(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
            digest = sha256_bytes(path.read_bytes())
            fixed_utc = "20260802T010203004Z"
            collision = path.parent / f"config.v1.backup-{fixed_utc}-{digest[7:19]}.json"
            collision.write_text("pre-existing\n", encoding="utf-8")
            before_tree = snapshot_tree(root)

            result, payload = self.run_json(
                "migrate", root, "--apply", digest,
                env={"ZCODE_WORKFLOW_CONFIG_TEST_UTC": fixed_utc},
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIsNone(payload)
            self.assertIn("already exists", result.stderr)
            self.assertEqual(snapshot_tree(root), before_tree)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
            digest = sha256_bytes(path.read_bytes())
            before_tree = snapshot_tree(root)

            result, payload = self.run_json(
                "migrate", root, "--apply", digest,
                env={"ZCODE_WORKFLOW_CONFIG_TEST_FAIL_STAGE": "after-backup-create"},
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIsNone(payload)
            self.assertIn("after-backup-create", result.stderr)
            self.assertEqual(snapshot_tree(root), before_tree)
            self.assertFalse(list(path.parent.glob("config.v1.backup-*.json")))

    def test_init_writes_exact_v2_defaults_only_when_requested(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result, payload = self.run_json("init", root)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stderr, "")
            path = root / ".ghost-agent-workflow/config.json"
            self.assert_writer_receipt(
                payload,
                operation="init",
                status="created",
                path=path,
                source="file",
                config=DEFAULT_CONFIG,
            )
            self.assertEqual(
                json.loads(path.read_text(encoding="utf-8")), DEFAULT_CONFIG
            )
            self.assertEqual(
                (path.parent / ".gitignore").read_text(encoding="utf-8"),
                WORKFLOW_GITIGNORE,
            )

    def test_managed_gitignore_tracks_config_and_owner_capsules_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "-C", str(root), "init", "-q"], check=True)
            result, _ = self.run_json("init", root)
            self.assertEqual(result.returncode, 0, result.stderr)
            workflow_root = root / ".ghost-agent-workflow"
            (workflow_root / "runtime").mkdir()
            (workflow_root / "runtime/state.json").write_text("{}\n", encoding="utf-8")
            owner = workflow_root / "owners/example"
            (owner / "interfaces").mkdir(parents=True)
            (owner / "capsule.json").write_text("{}\n", encoding="utf-8")
            (owner / "interfaces/temp.json").write_text("{}\n", encoding="utf-8")

            status = subprocess.run(
                [
                    "git",
                    "-C",
                    str(root),
                    "status",
                    "--short",
                    "--untracked-files=all",
                ],
                check=True,
                capture_output=True,
                text=True,
            ).stdout

            self.assertIn("?? .ghost-agent-workflow/.gitignore", status)
            self.assertIn("?? .ghost-agent-workflow/config.json", status)
            self.assertIn("?? .ghost-agent-workflow/owners/example/capsule.json", status)
            self.assertNotIn("runtime/state.json", status)
            self.assertNotIn("interfaces/temp.json", status)

    def test_set_parallel_changes_only_parallel(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_config(root, DEFAULT_CONFIG)
            path.chmod(0o600)
            before = json.loads(path.read_text(encoding="utf-8"))

            result, payload = self.run_json("set-parallel", root, "7")

            self.assertEqual(result.returncode, 0, result.stderr)
            expected = {**before, "parallel": 7}
            self.assert_writer_receipt(
                payload,
                operation="set-parallel",
                status="updated",
                path=path,
                source="file",
                config=expected,
                changed_fields=["/parallel"],
            )
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), expected)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_set_execution_class_changes_only_requested_role(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_config(root, DEFAULT_CONFIG)
            _, before = self.run_json("show-strict", root)

            result, updated = self.run_json(
                "set-execution-class", root, "review", "lite"
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            expected = {
                **DEFAULT_CONFIG,
                "execution_classes": {
                    **DEFAULT_CONFIG["execution_classes"],
                    "review": "lite",
                },
            }
            self.assert_writer_receipt(
                updated,
                operation="set-execution-class",
                status="updated",
                path=root / ".ghost-agent-workflow/config.json",
                source="file",
                config=expected,
                changed_fields=["/execution_classes/review"],
            )
            self.assertEqual(updated["config"]["execution_classes"]["review"], "lite")
            self.assertEqual(
                updated["config"]["execution_classes"]["owner"],
                before["config"]["execution_classes"]["owner"],
            )

    def test_init_adds_missing_managed_gitignore_without_touching_existing_v2(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_config(root, DEFAULT_CONFIG)
            before_bytes = path.read_bytes()
            before_metadata = path.stat()

            result, payload = self.run_json("init", root)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assert_writer_receipt(
                payload,
                operation="init",
                status="existing",
                path=path,
                source="file",
                config=DEFAULT_CONFIG,
            )
            self.assertEqual(path.read_bytes(), before_bytes)
            after_metadata = path.stat()
            self.assertEqual(after_metadata.st_ino, before_metadata.st_ino)
            self.assertEqual(after_metadata.st_mtime_ns, before_metadata.st_mtime_ns)
            self.assertEqual(
                (path.parent / ".gitignore").read_text(encoding="utf-8"),
                WORKFLOW_GITIGNORE,
            )

    def test_init_is_idempotent_and_preserves_custom_gitignore(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workflow_root = root / ".ghost-agent-workflow"
            workflow_root.mkdir()
            gitignore = workflow_root / ".gitignore"
            gitignore.write_text("custom-rule\n", encoding="utf-8")

            first_result, first = self.run_json("init", root)
            self.assertEqual(first_result.returncode, 0, first_result.stderr)
            config_path = workflow_root / "config.json"
            first_metadata = metadata_snapshot(root)
            first_bytes = config_path.read_bytes()
            second_result, second = self.run_json("init", root)

            self.assertEqual(second_result.returncode, 0, second_result.stderr)
            self.assertEqual(gitignore.read_text(encoding="utf-8"), "custom-rule\n")
            self.assertEqual(config_path.read_bytes(), first_bytes)
            self.assertEqual(metadata_snapshot(root), first_metadata)
            self.assert_writer_receipt(
                first,
                operation="init",
                status="created",
                path=config_path,
                source="file",
                config=DEFAULT_CONFIG,
            )
            self.assert_writer_receipt(
                second,
                operation="init",
                status="existing",
                path=config_path,
                source="file",
                config=DEFAULT_CONFIG,
            )

    def test_init_existing_v1_requires_migration_without_write(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = self.write_config(root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
            before_tree = snapshot_tree(root)
            before_metadata = metadata_snapshot(root)

            result, payload = self.run_json("init", root)

            self.assertEqual(result.returncode, 2)
            self.assertIn("migration", result.stderr)
            self.assert_writer_receipt(
                payload,
                operation="init",
                status="migration_required",
                path=path,
                source="legacy",
                config=None,
            )
            self.assert_workspace_unchanged(root, before_tree, before_metadata)

    def test_init_invalid_existing_config_fails_closed_without_write(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / ".ghost-agent-workflow/config.json"
            path.parent.mkdir()
            path.write_bytes(b'{"contract":')
            before_tree = snapshot_tree(root)
            before_metadata = metadata_snapshot(root)

            result, payload = self.run_json("init", root)

            self.assertEqual(result.returncode, 1)
            self.assertIsNone(payload)
            self.assertIn("invalid JSON", result.stderr)
            self.assert_workspace_unchanged(root, before_tree, before_metadata)

    def test_set_commands_require_existing_valid_v2_and_reject_invalid_values(self) -> None:
        cases = [
            ("set-parallel", (), "requires <1-8>"),
            ("set-parallel", ("true",), "integer from 1 to 8"),
            ("set-parallel", ("false",), "integer from 1 to 8"),
            ("set-parallel", ("4.0",), "integer from 1 to 8"),
            ("set-parallel", ("4.5",), "integer from 1 to 8"),
            ("set-parallel", ("0",), "integer from 1 to 8"),
            ("set-parallel", ("9",), "integer from 1 to 8"),
            ("set-execution-class", ("unknown", "main"), "role must be one of"),
            ("set-execution-class", ("review", "haiku"), "execution class must be one of"),
        ]
        for command, arguments, expected_error in cases:
            with self.subTest(command=command, arguments=arguments), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.write_config(root, DEFAULT_CONFIG)
                before_tree = snapshot_tree(root)
                before_metadata = metadata_snapshot(root)

                result, payload = self.run_json(command, root, *arguments)

                self.assertNotEqual(result.returncode, 0)
                self.assertIsNone(payload)
                self.assertIn(expected_error, result.stderr)
                self.assert_workspace_unchanged(root, before_tree, before_metadata)

        for existing in [None, legacy_config(LEGACY_PROFILE_SHAPES[0])]:
            with self.subTest(existing=existing), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                if existing is not None:
                    self.write_config(root, existing)
                before_tree = snapshot_tree(root)
                before_metadata = metadata_snapshot(root)

                result, payload = self.run_json("set-parallel", root, "6")

                self.assertNotEqual(result.returncode, 0)
                if existing is None:
                    self.assertIsNone(payload)
                    self.assertIn("missing", result.stderr)
                else:
                    self.assertEqual(result.returncode, 2)
                    self.assert_writer_receipt(
                        payload,
                        operation="set-parallel",
                        status="migration_required",
                        path=root / ".ghost-agent-workflow/config.json",
                        source="legacy",
                        config=None,
                    )
                self.assert_workspace_unchanged(root, before_tree, before_metadata)

    def test_writer_rejects_symlink_and_unsafe_target_types_without_write(self) -> None:
        cases = [
            "workspace symlink",
            "workflow symlink",
            "gitignore symlink",
            "gitignore directory",
            "config symlink",
            "config directory",
            "config fifo",
        ]
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                base = Path(directory)
                root = base / "workspace"
                outside = base / "outside"
                outside.mkdir()
                if case == "workspace symlink":
                    os.symlink(outside, root)
                    workflow_root = root / ".ghost-agent-workflow"
                else:
                    root.mkdir()
                    workflow_root = root / ".ghost-agent-workflow"
                    if case == "workflow symlink":
                        os.symlink(outside, workflow_root)
                    else:
                        workflow_root.mkdir()
                        target_name = ".gitignore" if case.startswith("gitignore") else "config.json"
                        target = workflow_root / target_name
                        if case.endswith("symlink"):
                            outside_target = outside / target_name
                            outside_target.write_text(
                                "outside\n" if target_name == ".gitignore" else json.dumps(DEFAULT_CONFIG),
                                encoding="utf-8",
                            )
                            os.symlink(outside_target, target)
                        elif case.endswith("directory"):
                            target.mkdir()
                        else:
                            os.mkfifo(target)
                before_tree = snapshot_tree(base)
                before_metadata = metadata_snapshot(base)

                result, payload = self.run_json("init", root)

                self.assertNotEqual(result.returncode, 0)
                self.assertIsNone(payload)
                self.assertTrue(
                    "symbolic link" in result.stderr or "regular file" in result.stderr,
                    result.stderr,
                )
                self.assert_workspace_unchanged(base, before_tree, before_metadata)

    def test_init_and_setters_reject_symlinked_workspace_ancestors_without_outside_writes(self) -> None:
        operations = [
            ("init", ()),
            ("set-parallel", ("6",)),
            ("set-execution-class", ("review", "lite")),
        ]
        for command, arguments in operations:
            with (
                self.subTest(command=command),
                tempfile.TemporaryDirectory() as directory,
            ):
                base = Path(directory)
                outside_parent = base / "outside-parent"
                outside_workspace = outside_parent / "workspace"
                outside_workspace.mkdir(parents=True)
                if command != "init":
                    self.write_config(outside_workspace, DEFAULT_CONFIG)
                link_parent = base / "link-parent"
                os.symlink(outside_parent, link_parent)
                lexical_workspace = link_parent / "workspace"
                before_tree = snapshot_tree(base)
                before_metadata = metadata_snapshot(base)

                result, payload = self.run_json(
                    command, lexical_workspace, *arguments
                )

                self.assertNotEqual(result.returncode, 0)
                self.assertIsNone(payload)
                self.assertIn("symbolic link", result.stderr)
                self.assert_workspace_unchanged(
                    base, before_tree, before_metadata
                )

    def test_setters_reject_direct_unsafe_workflow_and_config_targets(self) -> None:
        operations = [
            ("set-parallel", ("6",)),
            ("set-execution-class", ("review", "lite")),
        ]
        for command, arguments in operations:
            for unsafe in ["workflow symlink", "config symlink", "config directory"]:
                with (
                    self.subTest(command=command, unsafe=unsafe),
                    tempfile.TemporaryDirectory() as directory,
                ):
                    base = Path(directory)
                    root = base / "workspace"
                    outside = base / "outside"
                    root.mkdir()
                    outside.mkdir()
                    workflow_root = root / ".ghost-agent-workflow"
                    if unsafe == "workflow symlink":
                        outside_workflow = outside / ".ghost-agent-workflow"
                        outside_workflow.mkdir()
                        (outside_workflow / "config.json").write_text(
                            json.dumps(DEFAULT_CONFIG), encoding="utf-8"
                        )
                        os.symlink(outside_workflow, workflow_root)
                    else:
                        workflow_root.mkdir()
                        target = workflow_root / "config.json"
                        if unsafe == "config symlink":
                            outside_config = outside / "config.json"
                            outside_config.write_text(
                                json.dumps(DEFAULT_CONFIG), encoding="utf-8"
                            )
                            os.symlink(outside_config, target)
                        else:
                            target.mkdir()
                    before_tree = snapshot_tree(base)
                    before_metadata = metadata_snapshot(base)

                    result, payload = self.run_json(command, root, *arguments)

                    self.assertNotEqual(result.returncode, 0)
                    self.assertIsNone(payload)
                    self.assertTrue(
                        "symbolic link" in result.stderr
                        or "regular file" in result.stderr,
                        result.stderr,
                    )
                    self.assert_workspace_unchanged(
                        base, before_tree, before_metadata
                    )

    def test_strict_and_runtime_reads_reject_unsafe_lexical_paths_without_writes(self) -> None:
        cases = [
            "ancestor symlink",
            "workspace symlink",
            "workspace file",
            "workflow symlink",
            "workflow file",
            "config symlink",
            "dangling config symlink",
            "config directory",
            "config fifo",
        ]
        for unsafe in cases:
            with (
                self.subTest(unsafe=unsafe),
                tempfile.TemporaryDirectory() as directory,
            ):
                base = Path(directory)
                outside = base / "outside"
                outside.mkdir()
                root = base / "workspace"
                if unsafe == "ancestor symlink":
                    outside_workspace = outside / "workspace"
                    outside_workspace.mkdir()
                    self.write_config(outside_workspace, DEFAULT_CONFIG)
                    ancestor = base / "ancestor"
                    os.symlink(outside, ancestor)
                    root = ancestor / "workspace"
                elif unsafe == "workspace symlink":
                    outside_workspace = outside / "workspace"
                    outside_workspace.mkdir()
                    self.write_config(outside_workspace, DEFAULT_CONFIG)
                    os.symlink(outside_workspace, root)
                elif unsafe == "workspace file":
                    root.write_text("not a directory\n", encoding="utf-8")
                else:
                    root.mkdir()
                    workflow_root = root / ".ghost-agent-workflow"
                    if unsafe == "workflow symlink":
                        outside_workflow = outside / ".ghost-agent-workflow"
                        outside_workflow.mkdir()
                        (outside_workflow / "config.json").write_text(
                            json.dumps(DEFAULT_CONFIG), encoding="utf-8"
                        )
                        os.symlink(outside_workflow, workflow_root)
                    elif unsafe == "workflow file":
                        workflow_root.write_text(
                            "not a directory\n", encoding="utf-8"
                        )
                    else:
                        workflow_root.mkdir()
                        config = workflow_root / "config.json"
                        if unsafe == "config symlink":
                            outside_config = outside / "config.json"
                            outside_config.write_text(
                                json.dumps(DEFAULT_CONFIG), encoding="utf-8"
                            )
                            os.symlink(outside_config, config)
                        elif unsafe == "dangling config symlink":
                            os.symlink(outside / "missing.json", config)
                        elif unsafe == "config directory":
                            config.mkdir()
                        else:
                            os.mkfifo(config)
                before_tree = snapshot_tree(base)
                before_metadata = metadata_snapshot(base)

                for command in ["show-strict", "validate-strict"]:
                    result, payload = self.run_json(command, root)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIsNone(payload)
                    self.assertTrue(
                        "symbolic link" in result.stderr
                        or "directory" in result.stderr
                        or "regular file" in result.stderr,
                        result.stderr,
                    )

                source = """
const root = JSON.parse(await new Response(process.stdin).text());
let error = null;
try {
  configModule.readWorkflowConfigForRuntime(root);
} catch (caught) {
  error = caught.message;
}
process.stdout.write(JSON.stringify({error}));
"""
                runtime_result, runtime_payload = self.run_module(
                    source, stdin=str(root)
                )
                self.assertEqual(
                    runtime_result.returncode, 0, runtime_result.stderr
                )
                self.assertIsNotNone(runtime_payload["error"])
                self.assertTrue(
                    "symbolic link" in runtime_payload["error"]
                    or "directory" in runtime_payload["error"]
                    or "regular file" in runtime_payload["error"],
                    runtime_payload["error"],
                )
                self.assert_workspace_unchanged(
                    base, before_tree, before_metadata
                )

    def test_init_faults_rollback_only_invocation_owned_paths(self) -> None:
        stages = [
            "after-gitignore-write",
            "after-config-rename",
            "before-post-write-verification",
            "after-post-write-verification",
        ]
        for stage in stages:
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                before_tree = snapshot_tree(root)
                before_metadata = metadata_snapshot(root)

                result, payload = self.run_json(
                    "init",
                    root,
                    env={"ZCODE_WORKFLOW_CONFIG_TEST_FAIL_STAGE": stage},
                )

                self.assertNotEqual(result.returncode, 0)
                self.assertIsNone(payload)
                self.assertIn(stage, result.stderr)
                self.assertEqual(snapshot_tree(root), before_tree)
                after_metadata = metadata_snapshot(root)
                self.assertEqual(after_metadata["."][:3], before_metadata["."][:3])
                self.assertFalse(
                    any(
                        path.name.endswith((".tmp", ".bak"))
                        for path in root.rglob("*")
                    )
                )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workflow_root = root / ".ghost-agent-workflow"
            workflow_root.mkdir()
            custom = workflow_root / "custom.txt"
            custom.write_text("keep\n", encoding="utf-8")
            before_tree = snapshot_tree(root)
            before_metadata = metadata_snapshot(root)

            result, payload = self.run_json(
                "init",
                root,
                env={
                    "ZCODE_WORKFLOW_CONFIG_TEST_FAIL_STAGE": "after-gitignore-write"
                },
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIsNone(payload)
            self.assertEqual(snapshot_tree(root), before_tree)
            after_metadata = metadata_snapshot(root)
            self.assertEqual(
                after_metadata[".ghost-agent-workflow/custom.txt"],
                before_metadata[".ghost-agent-workflow/custom.txt"],
            )

    def test_setter_faults_restore_exact_config_and_leave_no_artifacts(self) -> None:
        operations = [
            ("set-parallel", ("6",)),
            ("set-execution-class", ("review", "lite")),
        ]
        stages = [
            "after-config-rename",
            "before-post-write-verification",
            "after-post-write-verification",
        ]
        for command, arguments in operations:
            for stage in stages:
                with (
                    self.subTest(command=command, stage=stage),
                    tempfile.TemporaryDirectory() as directory,
                ):
                    root = Path(directory)
                    path = self.write_config(root, DEFAULT_CONFIG)
                    path.chmod(0o600)
                    before_tree = snapshot_tree(root)
                    before_metadata = metadata_snapshot(root)

                    result, payload = self.run_json(
                        command,
                        root,
                        *arguments,
                        env={"ZCODE_WORKFLOW_CONFIG_TEST_FAIL_STAGE": stage},
                    )

                    self.assertNotEqual(result.returncode, 0)
                    self.assertIsNone(payload)
                    self.assertIn(stage, result.stderr)
                    self.assertEqual(snapshot_tree(root), before_tree)
                    after_metadata = metadata_snapshot(root)
                    self.assertEqual(
                        after_metadata[".ghost-agent-workflow/config.json"][1:3],
                        before_metadata[".ghost-agent-workflow/config.json"][1:3],
                    )
                    self.assertFalse(
                        any(
                            candidate.name.endswith((".tmp", ".bak"))
                            for candidate in path.parent.iterdir()
                        )
                    )

    def test_fault_hook_is_inert_without_exact_test_stage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result, payload = self.run_json(
                "init",
                root,
                env={"ZCODE_WORKFLOW_CONFIG_TEST_FAIL_STAGE": "unknown-stage"},
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(payload["status"], "created")

    def test_atomic_writes_use_same_directory_fsync_rename_and_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result, payload = self.run_json("init", root)
            self.assertEqual(result.returncode, 0, result.stderr)
            path = root / ".ghost-agent-workflow/config.json"
            workflow_root = path.parent
            config_metadata = path.lstat()
            self.assertTrue(stat.S_ISREG(config_metadata.st_mode))
            self.assertEqual(stat.S_IMODE(config_metadata.st_mode), 0o644)
            self.assertEqual(
                stat.S_IMODE((workflow_root / ".gitignore").stat().st_mode), 0o644
            )
            self.assertEqual(
                sorted(candidate.name for candidate in workflow_root.iterdir()),
                [".gitignore", "config.json"],
            )
            self.assertFalse(any(candidate.name.endswith(".tmp") for candidate in workflow_root.iterdir()))
            self.assertEqual(payload["path"], str(path))

            before_inode = path.stat().st_ino
            update_result, update = self.run_json("set-parallel", root, "5")
            self.assertEqual(update_result.returncode, 0, update_result.stderr)
            self.assertNotEqual(path.stat().st_ino, before_inode)
            self.assertEqual(update["changed_fields"], ["/parallel"])
            self.assertFalse(any(candidate.name.endswith(".tmp") for candidate in workflow_root.iterdir()))

        source = SOURCE.read_text(encoding="utf-8")
        self.assertIn("fsyncSync(descriptor)", source)
        self.assertIn("renameSync(temporaryPath, path)", source)
        self.assertIn("openSync(directory, fsConstants.O_RDONLY)", source)
        self.assertIn("fsyncSync(directoryDescriptor)", source)

    def test_show_and_validate_strict_missing_are_read_only(self) -> None:
        for command in ["show-strict", "validate-strict"]:
            with self.subTest(command=command), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                before_tree = snapshot_tree(root)
                before_metadata = metadata_snapshot(root)

                result, payload = self.run_json(command, root)

                self.assertEqual(result.returncode, 1)
                self.assertIn("workflow config is missing", result.stderr)
                self.assert_receipt(
                    payload,
                    operation=command,
                    status="missing",
                    path=root / ".ghost-agent-workflow/config.json",
                    source="missing",
                    config=None,
                )
                self.assert_workspace_unchanged(root, before_tree, before_metadata)

    def test_show_and_validate_strict_v2_are_read_only(self) -> None:
        for command, expected_status in [
            ("show-strict", "shown"),
            ("validate-strict", "valid"),
        ]:
            with self.subTest(command=command), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                path = self.write_config(root, DEFAULT_CONFIG)
                original = path.read_bytes()
                before_tree = snapshot_tree(root)
                before_metadata = metadata_snapshot(root)

                result, payload = self.run_json(command, root)

                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stderr, "")
                self.assert_receipt(
                    payload,
                    operation=command,
                    status=expected_status,
                    path=path,
                    source="file",
                    config=DEFAULT_CONFIG,
                )
                self.assertEqual(path.read_bytes(), original)
                self.assert_workspace_unchanged(root, before_tree, before_metadata)

    def test_show_and_validate_strict_detect_all_v1_shapes_without_migrating(self) -> None:
        for command in ["show-strict", "validate-strict"]:
            for roles in LEGACY_PROFILE_SHAPES:
                with (
                    self.subTest(command=command, roles=roles),
                    tempfile.TemporaryDirectory() as directory,
                ):
                    root = Path(directory)
                    path = self.write_config(root, legacy_config(roles))
                    original = path.read_bytes()
                    before_tree = snapshot_tree(root)
                    before_metadata = metadata_snapshot(root)

                    result, payload = self.run_json(command, root)

                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stderr, "")
                    self.assert_receipt(
                        payload,
                        operation=command,
                        status="migration_required",
                        path=path,
                        source="legacy",
                        config=None,
                    )
                    self.assertEqual(path.read_bytes(), original)
                    self.assert_workspace_unchanged(root, before_tree, before_metadata)

    def test_show_and_validate_strict_invalid_json_fail_without_writes(self) -> None:
        for command in ["show-strict", "validate-strict"]:
            with self.subTest(command=command), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                path = root / ".ghost-agent-workflow/config.json"
                path.parent.mkdir()
                path.write_bytes(b'{"contract":')
                before_tree = snapshot_tree(root)
                before_metadata = metadata_snapshot(root)

                result, payload = self.run_json(command, root)

                self.assertEqual(result.returncode, 1)
                self.assertIsNone(payload)
                self.assertIn("invalid JSON", result.stderr)
                self.assertIn(str(path), result.stderr)
                self.assert_workspace_unchanged(root, before_tree, before_metadata)

    def test_show_and_validate_strict_unknown_fields_fail_without_writes(self) -> None:
        invalid = {**DEFAULT_CONFIG, "unexpected": True}
        for command in ["show-strict", "validate-strict"]:
            with self.subTest(command=command), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                path = self.write_config(root, invalid)
                before_tree = snapshot_tree(root)
                before_metadata = metadata_snapshot(root)

                result, payload = self.run_json(command, root)

                self.assertEqual(result.returncode, 1)
                self.assertIsNone(payload)
                self.assertIn("unexpected keys unexpected", result.stderr)
                self.assertIn(str(path), result.stderr)
                self.assert_workspace_unchanged(root, before_tree, before_metadata)

    def test_strict_commands_reject_v2_shape_type_value_and_range_errors(self) -> None:
        cases: list[tuple[str, object, str]] = [
            ("not an object", [], "config must be an object"),
            (
                "missing contract",
                {
                    "parallel": 4,
                    "execution_classes": DEFAULT_CONFIG["execution_classes"],
                },
                "missing keys contract",
            ),
            (
                "wrong contract",
                {**DEFAULT_CONFIG, "contract": "ZCODE_WORKFLOW_CONFIG_V1"},
                "config.contract must equal",
            ),
            ("parallel string", {**DEFAULT_CONFIG, "parallel": "4"}, "parallel must be an integer"),
            ("parallel boolean", {**DEFAULT_CONFIG, "parallel": True}, "parallel must be an integer"),
            ("parallel float", {**DEFAULT_CONFIG, "parallel": 4.5}, "parallel must be an integer"),
            ("parallel below range", {**DEFAULT_CONFIG, "parallel": 0}, "parallel must be an integer"),
            ("parallel above range", {**DEFAULT_CONFIG, "parallel": 9}, "parallel must be an integer"),
            (
                "execution classes array",
                {**DEFAULT_CONFIG, "execution_classes": []},
                "config.execution_classes must be an object",
            ),
            (
                "missing execution role",
                {
                    **DEFAULT_CONFIG,
                    "execution_classes": {
                        "planner": "main",
                        "owner": "main",
                        "review": "main",
                    },
                },
                "missing keys planner_reviewer",
            ),
            (
                "unknown execution role",
                {
                    **DEFAULT_CONFIG,
                    "execution_classes": {
                        **DEFAULT_CONFIG["execution_classes"],
                        "supervisor": "main",
                    },
                },
                "unexpected keys supervisor",
            ),
            (
                "wrong execution value",
                {
                    **DEFAULT_CONFIG,
                    "execution_classes": {
                        **DEFAULT_CONFIG["execution_classes"],
                        "review": "haiku",
                    },
                },
                "config.execution_classes.review must be one of: main, lite",
            ),
            (
                "wrong execution type",
                {
                    **DEFAULT_CONFIG,
                    "execution_classes": {
                        **DEFAULT_CONFIG["execution_classes"],
                        "review": False,
                    },
                },
                "config.execution_classes.review must be one of: main, lite",
            ),
        ]
        for name, value, expected_error in cases:
            with self.subTest(case=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.write_config(root, value)
                before_tree = snapshot_tree(root)
                before_metadata = metadata_snapshot(root)

                result, payload = self.run_json("show-strict", root)

                self.assertEqual(result.returncode, 1)
                self.assertIsNone(payload)
                self.assertIn(expected_error, result.stderr)
                self.assert_workspace_unchanged(root, before_tree, before_metadata)

    def test_strict_reader_rejects_malformed_legacy_profiles_without_writes(self) -> None:
        cases = [
            (
                "unknown profile shape",
                legacy_config(["planner", "owner"]),
                "config.profiles keys must match an allowed legacy shape",
            ),
            (
                "profile extra field",
                {
                    **legacy_config(["planner", "owner", "review"]),
                    "profiles": {
                        **legacy_config(["planner", "owner", "review"])["profiles"],
                        "planner": {
                            "model": "gpt-5.6-sol",
                            "effort": "high",
                            "extra": True,
                        },
                    },
                },
                "config.profiles.planner",
            ),
            (
                "empty model",
                {
                    **legacy_config(["planner", "owner", "review"]),
                    "profiles": {
                        **legacy_config(["planner", "owner", "review"])["profiles"],
                        "planner": {"model": "", "effort": "high"},
                    },
                },
                "config.profiles.planner.model",
            ),
            (
                "invalid effort",
                {
                    **legacy_config(["planner", "owner", "review"]),
                    "profiles": {
                        **legacy_config(["planner", "owner", "review"])["profiles"],
                        "planner": {"model": "gpt-5.6-sol", "effort": "impossible"},
                    },
                },
                "config.profiles.planner.effort",
            ),
        ]
        for name, value, expected_error in cases:
            with self.subTest(case=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.write_config(root, value)
                before_tree = snapshot_tree(root)
                before_metadata = metadata_snapshot(root)

                result, payload = self.run_json("validate-strict", root)

                self.assertEqual(result.returncode, 1)
                self.assertIsNone(payload)
                self.assertIn(expected_error, result.stderr)
                self.assert_workspace_unchanged(root, before_tree, before_metadata)

    def test_invalid_cli_usage_is_zero_write(self) -> None:
        cases = [
            (
                lambda root: ["node", str(SOURCE), "show-strict"],
                "usage:",
            ),
            (
                lambda root: ["node", str(SOURCE), "show-strict", str(root), "extra"],
                "takes no extra arguments",
            ),
            (
                lambda root: ["node", str(SOURCE), "init", str(root), "extra"],
                "takes no extra arguments",
            ),
            (
                lambda root: ["node", str(SOURCE), "set-parallel", str(root)],
                "requires <1-8>",
            ),
            (
                lambda root: [
                    "node",
                    str(SOURCE),
                    "set-execution-class",
                    str(root),
                    "review",
                ],
                "requires <role> <main|lite>",
            ),
            (
                lambda root: ["node", str(SOURCE), "unknown", str(root)],
                "unknown command",
            ),
        ]
        for arguments_for, expected in cases:
            with self.subTest(expected=expected), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                before_tree = snapshot_tree(root)
                before_metadata = metadata_snapshot(root)
                result, payload = run_json_cli(arguments_for(root))
                self.assertNotEqual(result.returncode, 0)
                self.assertIsNone(payload)
                self.assertIn(expected, result.stderr)
                self.assert_workspace_unchanged(root, before_tree, before_metadata)

    def run_module(self, source: str, *, stdin: object | None = None):
        script = f"import * as configModule from {json.dumps(SOURCE.as_uri())};\n{source}"
        return run_json_cli(
            ["node", "--input-type=module", "--eval", script],
            stdin=stdin,
        )

    def test_module_exports_strict_parsers_and_read_helpers(self) -> None:
        source = """
const input = JSON.parse(await new Response(process.stdin).text());
const parsedV2 = configModule.parseV2Config(input.v2);
const parsedLegacy = input.legacy.map(configModule.parseLegacyV1Config);
process.stdout.write(JSON.stringify({
  exports: Object.keys(configModule).sort(),
  parsedV2,
  parsedLegacy,
}));
"""
        legacy = [legacy_config(roles) for roles in LEGACY_PROFILE_SHAPES]

        result, payload = self.run_module(
            source,
            stdin={"v2": DEFAULT_CONFIG, "legacy": legacy},
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertEqual(
            payload["exports"],
            [
                "executionClassForOperation",
                "parseLegacyV1Config",
                "parseV2Config",
                "readConfigStrict",
                "readWorkflowConfigForRuntime",
            ],
        )
        self.assertEqual(payload["parsedV2"], DEFAULT_CONFIG)
        self.assertEqual(payload["parsedLegacy"], legacy)

    def test_runtime_read_defaults_file_migration_and_missing_error_are_read_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            missing = base / "missing"
            file_root = base / "file"
            legacy_root = base / "legacy"
            missing.mkdir()
            file_root.mkdir()
            legacy_root.mkdir()
            self.write_config(file_root, DEFAULT_CONFIG)
            self.write_config(legacy_root, legacy_config(LEGACY_PROFILE_SHAPES[0]))
            before_tree = snapshot_tree(base)
            before_metadata = metadata_snapshot(base)
            source = """
const [missingRoot, fileRoot, legacyRoot] = JSON.parse(await new Response(process.stdin).text());
let missingError = null;
try {
  configModule.readWorkflowConfigForRuntime(missingRoot, {missing: 'error'});
} catch (error) {
  missingError = error.message;
}
process.stdout.write(JSON.stringify({
  defaults: configModule.readWorkflowConfigForRuntime(missingRoot),
  file: configModule.readWorkflowConfigForRuntime(fileRoot),
  legacy: configModule.readWorkflowConfigForRuntime(legacyRoot),
  missingError,
}));
"""

            result, payload = self.run_module(
                source,
                stdin=[str(missing), str(file_root), str(legacy_root)],
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                payload["defaults"], {"config": DEFAULT_CONFIG, "source": "default"}
            )
            self.assertEqual(
                payload["file"], {"config": DEFAULT_CONFIG, "source": "file"}
            )
            self.assertEqual(
                payload["legacy"],
                {
                    "status": "migration_required",
                    "path": str(legacy_root / ".ghost-agent-workflow/config.json"),
                },
            )
            self.assertIn("workflow config is missing", payload["missingError"])
            self.assert_workspace_unchanged(base, before_tree, before_metadata)

    def test_execution_class_for_operation_maps_through_registry(self) -> None:
        expected = {
            "planner": [
                "initial_plan",
                "revise_plan",
                "apply_global_delta",
                "expand_subgraph",
            ],
            "planner_reviewer": ["review_plan_revision"],
            "owner": ["execute_owner_run", "repair_owner_run"],
            "review": ["review_implementation"],
        }
        source = """
const expected = JSON.parse(await new Response(process.stdin).text());
const mapped = {};
for (const [role, operations] of Object.entries(expected)) {
  const config = {
    contract: 'ZCODE_WORKFLOW_CONFIG_V2',
    parallel: 4,
    execution_classes: {
      planner: 'main',
      planner_reviewer: 'main',
      owner: 'main',
      review: 'main',
      [role]: 'lite',
    },
  };
  for (const operation of operations) {
    mapped[operation] = configModule.executionClassForOperation(config, operation);
  }
}
let unknownError = null;
try {
  configModule.executionClassForOperation({
    contract: 'ZCODE_WORKFLOW_CONFIG_V2',
    parallel: 4,
    execution_classes: {
      planner: 'main', planner_reviewer: 'main', owner: 'main', review: 'main'
    },
  }, 'unknown_operation');
} catch (error) {
  unknownError = error.message;
}
process.stdout.write(JSON.stringify({mapped, unknownError}));
"""

        result, payload = self.run_module(source, stdin=expected)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            payload["mapped"],
            {
                operation: "lite"
                for operations in expected.values()
                for operation in operations
            },
        )
        self.assertIn("unknown_operation", payload["unknownError"])


if __name__ == "__main__":
    unittest.main()
