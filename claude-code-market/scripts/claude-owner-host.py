#!/usr/bin/env python3
"""Worktree-local Claude controller adapter for owner capability probes.

Validated against the locally installed Claude Code host 2.1.220 only. The
adapter never uses ``--worktree``: it starts a child process with OS-level cwd
set to the already-created owner worktree and verifies git identity before and
after launch. The default direct probe performs no model request.
"""
from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HOST_VERSION_VALIDATED = "2.1.220"
REAL_SMOKE_ENV = "GHOST_AGENT_REAL_HOST_SMOKE"


def git(worktree: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=worktree, check=True, capture_output=True, text=True
    ).stdout.strip()


def snapshot(worktree: Path) -> dict[str, str]:
    return {
        "cwd": str(worktree.resolve()),
        "toplevel": str(Path(git(worktree, "rev-parse", "--show-toplevel")).resolve()),
        "branch": git(worktree, "rev-parse", "--abbrev-ref", "HEAD"),
        "head": git(worktree, "rev-parse", "HEAD"),
        "common_dir": str(
            (worktree / git(worktree, "rev-parse", "--git-common-dir")).resolve()
        ),
    }


def validate(actual: dict[str, str], expected: dict[str, str]) -> list[str]:
    return [key for key, value in expected.items() if actual.get(key) != value]


def enabled(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def write_artifact(path: Path | None, artifact: dict[str, Any]) -> None:
    text = json.dumps(artifact, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if path is None:
        sys.stdout.write(text)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worktree", type=Path, required=True, help="existing owner worktree")
    parser.add_argument("--expected-branch", required=True)
    parser.add_argument("--expected-head", required=True)
    parser.add_argument("--expected-common-dir", type=Path, required=True)
    parser.add_argument("--artifact", type=Path)
    parser.add_argument("--controller", action="store_true", help="launch a worktree-local Claude child")
    parser.add_argument("--real-host", action="store_true", help="allow the Claude child to reach a real model")
    parser.add_argument("--claude-command", default="claude", help="Claude executable; tests may provide a fake")
    parser.add_argument("--prompt", default="Reply exactly OWNER_HOST_SMOKE_OK.")
    args = parser.parse_args()

    worktree = args.worktree.resolve()
    expected = {
        "cwd": str(worktree),
        "toplevel": str(worktree),
        "branch": args.expected_branch,
        "head": args.expected_head,
        "common_dir": str(args.expected_common_dir.resolve()),
    }
    artifact: dict[str, Any] = {
        "schema_version": 1,
        "kind": "claude_owner_host_capability",
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "host": {"name": "claude-code", "validated_version": HOST_VERSION_VALIDATED},
        "mode": "worktree_local_controller" if args.controller else "direct_probe",
        "uses_os_cwd": True,
        "forbids_worktree_flag": True,
        "real_model_requested": False,
    }
    try:
        before = snapshot(worktree)
    except (OSError, subprocess.CalledProcessError) as exc:
        artifact.update({"outcome": "unsupported", "reason": "git_probe_failed", "detail": str(exc)})
        write_artifact(args.artifact, artifact)
        return 2
    artifact["before"] = before
    mismatches = validate(before, expected)
    if mismatches:
        artifact.update({"outcome": "failed", "reason": "pre_launch_identity_mismatch", "mismatches": mismatches})
        write_artifact(args.artifact, artifact)
        return 3

    if args.controller:
        command = shlex.split(args.claude_command)
        if any(token == "--worktree" or token.startswith("--worktree=") or token == "-w" for token in command):
            artifact.update({"outcome": "failed", "reason": "worktree_flag_forbidden"})
            write_artifact(args.artifact, artifact)
            return 4
        real_host = args.real_host or enabled(os.environ.get(REAL_SMOKE_ENV))
        if not real_host:
            artifact.update({"outcome": "unsupported", "reason": "real_host_smoke_opt_in_required"})
            artifact["after"] = snapshot(worktree)
            write_artifact(args.artifact, artifact)
            return 0
        artifact["real_model_requested"] = True
        command.extend([
            "--print", "--output-format", "json", "--no-session-persistence",
            "--tools", "", "--permission-mode", "dontAsk", args.prompt,
        ])
        completed = subprocess.run(command, cwd=worktree, capture_output=True, text=True)
        artifact["child"] = {
            "returncode": completed.returncode,
            "stdout_sha256": __import__("hashlib").sha256(completed.stdout.encode()).hexdigest(),
            "stderr_sha256": __import__("hashlib").sha256(completed.stderr.encode()).hexdigest(),
        }
        if completed.returncode != 0:
            artifact.update({"outcome": "failed", "reason": "claude_child_failed"})

    try:
        after = snapshot(worktree)
    except (OSError, subprocess.CalledProcessError) as exc:
        artifact.update({"outcome": "failed", "reason": "post_launch_git_probe_failed", "detail": str(exc)})
        write_artifact(args.artifact, artifact)
        return 5
    artifact["after"] = after
    post_mismatches = validate(after, expected)
    if post_mismatches:
        artifact.update({"outcome": "failed", "reason": "post_launch_identity_mismatch", "mismatches": post_mismatches})
        write_artifact(args.artifact, artifact)
        return 6
    artifact.setdefault("outcome", "passed")
    artifact.setdefault("reason", "identity_preserved")
    write_artifact(args.artifact, artifact)
    return 0 if artifact["outcome"] != "failed" else 7


if __name__ == "__main__":
    raise SystemExit(main())
