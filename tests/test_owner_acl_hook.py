from __future__ import annotations

import json
from contextlib import contextmanager
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / "claude-code-market/hooks/scripts/owner-acl-hook.py"
GD = ROOT / "claude-code-market/scripts/goal-dag.mjs"


class OwnerAclHookTests(unittest.TestCase):
    @contextmanager
    def workspace_with_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace_root = Path(directory)
            owners_dir = workspace_root / ".ghost-agent-workflow" / "owners"
            owners_dir.mkdir(parents=True)
            registry_path = owners_dir / "registry.json"
            env = {**os.environ, "GOAL_DAG_EXECUTION_PLATFORM": "claude_code"}
            subprocess.run(
                ["node", str(GD), "owner-init", str(registry_path), str(workspace_root)],
                check=True, capture_output=True, env=env,
            )
            def_path = owners_dir / "proto-def.json"
            def_path.write_text(json.dumps({
                "owner_id": "proto_owner", "functional_domain": "proto",
                "owned_modules": ["src/proto/**"], "interfaces": [], "depends_on_owners": [],
            }), encoding="utf-8")
            subprocess.run(
                ["node", str(GD), "owner-add", str(registry_path), str(def_path)],
                check=True, capture_output=True, env=env,
            )
            yield workspace_root, registry_path

    def run_hook(self, payload: dict) -> dict | None:
        env = {**os.environ}
        result = subprocess.run(
            ["python3", str(HOOK)],
            input=json.dumps(payload), capture_output=True, text=True, env=env,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        out = result.stdout.strip()
        return json.loads(out) if out else None

    def test_in_scope_write_is_allowed(self) -> None:
        with self.workspace_with_owner() as (workspace_root, _):
            self.assertIsNone(self.run_hook({
                "agent_type": "owner-proto_owner", "cwd": str(workspace_root),
                "tool_input": {"file_path": str(workspace_root / "src/proto/log.proto")},
            }))

    def test_nested_in_scope_matches_double_star(self) -> None:
        with self.workspace_with_owner() as (workspace_root, _):
            self.assertIsNone(self.run_hook({
                "agent_type": "owner-proto_owner", "cwd": str(workspace_root),
                "tool_input": {"file_path": str(workspace_root / "src/proto/sub/deep.proto")},
            }))

    def test_out_of_scope_write_is_denied(self) -> None:
        with self.workspace_with_owner() as (workspace_root, _):
            output = self.run_hook({
                "agent_type": "owner-proto_owner", "cwd": str(workspace_root),
                "tool_input": {"file_path": str(workspace_root / "src/api/leak.ts")},
            })
            self.assertIsNotNone(output)
            self.assertEqual(output["hookSpecificOutput"]["permissionDecision"], "deny")
            self.assertIn("src/api/leak.ts", output["hookSpecificOutput"]["permissionDecisionReason"])

    def test_non_owner_agent_is_allowed(self) -> None:
        with self.workspace_with_owner() as (workspace_root, _):
            self.assertIsNone(self.run_hook({
                "agent_type": "general-purpose", "cwd": str(workspace_root),
                "tool_input": {"file_path": str(workspace_root / "src/api/leak.ts")},
            }))

    def test_unknown_owner_fails_open(self) -> None:
        with self.workspace_with_owner() as (workspace_root, _):
            self.assertIsNone(self.run_hook({
                "agent_type": "owner-ghost", "cwd": str(workspace_root),
                "tool_input": {"file_path": str(workspace_root / "anywhere.ts")},
            }))

    def test_missing_registry_fails_open(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            self.assertIsNone(self.run_hook({
                "agent_type": "owner-proto_owner", "cwd": directory,
                "tool_input": {"file_path": str(Path(directory) / "x.ts")},
            }))


if __name__ == "__main__":
    unittest.main()
