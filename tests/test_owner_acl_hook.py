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

    def run_hook(self, payload: dict, extra_env: dict | None = None) -> dict | None:
        env = {**os.environ, **(extra_env or {})}
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

    def test_r9_out_of_scope_denied_when_cwd_is_worktree(self) -> None:
        # owner worktree 的 sparse checkout 不含 .ghost-agent-workflow；hook 须
        # 经 CLAUDE_PROJECT_DIR 回主工作区读 registry（R9），否则 fail-open。
        with self.workspace_with_owner() as (workspace_root, _), tempfile.TemporaryDirectory() as wt_dir:
            worktree_root = Path(wt_dir)  # 模拟 owner worktree：无 .ghost-agent-workflow
            output = self.run_hook({
                "agent_type": "owner-proto_owner", "cwd": str(worktree_root),
                "tool_input": {"file_path": str(worktree_root / "src/proto/log.proto")},
            }, extra_env={"CLAUDE_PROJECT_DIR": str(workspace_root)})
            self.assertIsNone(output)  # in-scope 放行
            denied = self.run_hook({
                "agent_type": "owner-proto_owner", "cwd": str(worktree_root),
                "tool_input": {"file_path": str(worktree_root / "src/api/leak.ts")},
            }, extra_env={"CLAUDE_PROJECT_DIR": str(workspace_root)})
            self.assertIsNotNone(denied)  # out-of-scope 仍 deny（R9 前会 fail-open）
            self.assertEqual(denied["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_r9_walk_up_finds_main_workspace_from_nested_cwd(self) -> None:
        # worktree 嵌在主工作区子目录下：向上走应命中主工作区的 .ghost-agent-workflow
        with self.workspace_with_owner() as (workspace_root, _):
            nested = workspace_root / "worktrees" / "proto"
            nested.mkdir(parents=True)
            denied = self.run_hook({
                "agent_type": "owner-proto_owner", "cwd": str(nested),
                "tool_input": {"file_path": str(nested / "src/api/leak.ts")},
            })  # 无 env，靠 walk-up
            self.assertIsNotNone(denied)
            self.assertEqual(denied["hookSpecificOutput"]["permissionDecision"], "deny")

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
