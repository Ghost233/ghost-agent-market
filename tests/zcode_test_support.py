from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
from typing import Any
import unittest


ROOT = Path(__file__).resolve().parents[1]


def sha256_bytes(value: bytes) -> str:
    return f"sha256:{hashlib.sha256(value).hexdigest()}"


def snapshot_tree(root: Path) -> dict[str, tuple[bytes, int]]:
    if not root.exists():
        return {}
    result: dict[str, tuple[bytes, int]] = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            result[path.relative_to(root).as_posix()] = (
                os.readlink(path).encode("utf-8"),
                stat.S_IFLNK,
            )
        elif path.is_file():
            result[path.relative_to(root).as_posix()] = (
                path.read_bytes(),
                stat.S_IMODE(path.stat().st_mode),
            )
    return result


def load_agent_registry() -> dict[str, Any]:
    return json.loads(
        (ROOT / "zcode-market/agent-registry.json").read_text(encoding="utf-8")
    )


def run_json_cli(
    argv: list[str],
    *,
    stdin: dict[str, Any] | None = None,
) -> tuple[subprocess.CompletedProcess[str], dict[str, Any] | None]:
    result = subprocess.run(
        argv,
        input=None if stdin is None else json.dumps(stdin),
        capture_output=True,
        text=True,
        check=False,
    )
    payload = None
    if result.stdout.strip():
        payload = json.loads(result.stdout)
    return result, payload


def assert_zero_write(
    testcase: unittest.TestCase,
    before: dict[str, tuple[bytes, int]],
    after: dict[str, tuple[bytes, int]],
) -> None:
    testcase.assertEqual(after, before)
