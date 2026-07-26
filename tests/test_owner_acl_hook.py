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
    def add_owner(self, registry_path: Path, def_path: Path, env: dict) -> None:
        planned = subprocess.run(
            ["node", str(GD), "owner-add", str(registry_path), str(def_path), "--plan"],
            check=True, capture_output=True, text=True, env=env,
        )
        proposal_digest = json.loads(planned.stdout)["proposal_digest"]
        subprocess.run(
            ["node", str(GD), "owner-add", str(registry_path), str(def_path),
             "--confirm", proposal_digest],
            check=True, capture_output=True, env=env,
        )

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
            self.add_owner(registry_path, def_path, env)
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            registry["owners"][0]["worktree_binding"] = {
                "feature_branch": "feature", "owner_branch": "owner-proto", "worktree_path": str(workspace_root),
                "status": "active", "created_at": "2026-07-26T00:00:00Z", "base_oid": "0" * 40,
                "committed_oid": None, "committed_at": None, "merged_oid": None, "merged_at": None,
            }
            registry_path.write_text(json.dumps(registry), encoding="utf-8")
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
        with self.workspace_with_owner() as (workspace_root, registry_path), tempfile.TemporaryDirectory() as wt_dir:
            worktree_root = Path(wt_dir)  # 模拟 owner worktree：无 .ghost-agent-workflow
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            registry["owners"][0]["worktree_binding"]["worktree_path"] = str(worktree_root)
            registry_path.write_text(json.dumps(registry), encoding="utf-8")
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
            registry_path = workspace_root / ".ghost-agent-workflow" / "owners" / "registry.json"
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            registry["owners"][0]["worktree_binding"]["worktree_path"] = str(nested)
            registry_path.write_text(json.dumps(registry), encoding="utf-8")
            denied = self.run_hook({
                "agent_type": "owner-proto_owner", "cwd": str(nested),
                "tool_input": {"file_path": str(nested / "src/api/leak.ts")},
            })  # 无 env，靠 walk-up
            self.assertIsNotNone(denied)
            self.assertEqual(denied["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_brace_and_negation_glob_align_with_runtime(self) -> None:
        # {a,b} brace 与 [!x] 否定类须与 goal-dag.mjs globSegmentRegex 同语义：
        # 否则 L1 hook 会假阴性阻断 in-scope 写，或假阳性放行越界写。
        env = {**os.environ, "GOAL_DAG_EXECUTION_PLATFORM": "claude_code"}
        with self.workspace_with_owner() as (workspace_root, registry_path):
            br_def = registry_path.parent / "brace-def.json"
            br_def.write_text(json.dumps({
                "owner_id": "brace_owner", "functional_domain": "brace",
                "owned_modules": ["src/{api,chat}/**", "src/x/[!y]/z.ts"],
                "interfaces": [], "depends_on_owners": [],
            }), encoding="utf-8")
            self.add_owner(registry_path, br_def, env)
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            brace = next(owner for owner in registry["owners"] if owner["owner_id"] == "brace_owner")
            brace["worktree_binding"] = {
                "feature_branch": "feature", "owner_branch": "owner-brace", "worktree_path": str(workspace_root),
                "status": "active", "created_at": "2026-07-26T00:00:00Z", "base_oid": "0" * 40,
                "committed_oid": None, "committed_at": None, "merged_oid": None, "merged_at": None,
            }
            registry_path.write_text(json.dumps(registry), encoding="utf-8")
            # {api,chat} 覆盖 src/api 与 src/chat：in-scope 放行
            self.assertIsNone(self.run_hook({
                "agent_type": "owner-brace_owner", "cwd": str(workspace_root),
                "tool_input": {"file_path": str(workspace_root / "src/api/sub/a.ts")},
            }))
            self.assertIsNone(self.run_hook({
                "agent_type": "owner-brace_owner", "cwd": str(workspace_root),
                "tool_input": {"file_path": str(workspace_root / "src/chat/a.ts")},
            }))
            # {api,chat} 不覆盖 src/other：deny（修复前 brace 被当字面量 -> 假阴性阻断 in-scope）
            denied = self.run_hook({
                "agent_type": "owner-brace_owner", "cwd": str(workspace_root),
                "tool_input": {"file_path": str(workspace_root / "src/other/a.ts")},
            })
            self.assertIsNotNone(denied)
            self.assertEqual(denied["hookSpecificOutput"]["permissionDecision"], "deny")
            # [!y] 排除 y 段：src/x/y/z.ts 越界 deny（修复前 [!y] 当字面类匹配 y -> 假阳性放行）
            denied_y = self.run_hook({
                "agent_type": "owner-brace_owner", "cwd": str(workspace_root),
                "tool_input": {"file_path": str(workspace_root / "src/x/y/z.ts")},
            })
            self.assertIsNotNone(denied_y)
            self.assertEqual(denied_y["hookSpecificOutput"]["permissionDecision"], "deny")
            # [!y] 放行非 y 段：src/x/a/z.ts
            self.assertIsNone(self.run_hook({
                "agent_type": "owner-brace_owner", "cwd": str(workspace_root),
                "tool_input": {"file_path": str(workspace_root / "src/x/a/z.ts")},
            }))

    def test_double_star_glob_aligns_with_runtime(self) -> None:
        # ** 须按完整段匹配（镜像 goal-dag.mjs globRegex），不得用贪婪 .* 跨部分段：
        # 否则 L1 hook 与 L3 scope audit 分歧（hook 假阳性放行 / merge-back 才 deny）。
        env = {**os.environ, "GOAL_DAG_EXECUTION_PLATFORM": "claude_code"}
        with self.workspace_with_owner() as (workspace_root, registry_path):
            mid_def = registry_path.parent / "midstar-def.json"
            mid_def.write_text(json.dumps({
                "owner_id": "midstar_owner", "functional_domain": "mid",
                "owned_modules": ["lib/**/proto/*.proto"], "interfaces": [], "depends_on_owners": [],
            }), encoding="utf-8")
            self.add_owner(registry_path, mid_def, env)
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            midstar = next(owner for owner in registry["owners"] if owner["owner_id"] == "midstar_owner")
            midstar["worktree_binding"] = {
                "feature_branch": "feature", "owner_branch": "owner-midstar", "worktree_path": str(workspace_root),
                "status": "active", "created_at": "2026-07-26T00:00:00Z", "base_oid": "0" * 40,
                "committed_oid": None, "committed_at": None, "merged_oid": None, "merged_at": None,
            }
            registry_path.write_text(json.dumps(registry), encoding="utf-8")
            # ** 匹配整段 a：lib/a/proto/x.proto in-scope 放行
            self.assertIsNone(self.run_hook({
                "agent_type": "owner-midstar_owner", "cwd": str(workspace_root),
                "tool_input": {"file_path": str(workspace_root / "lib/a/proto/x.proto")},
            }))
            # ** 不得跨部分段：lib/Xproto/x.proto 缺独立 proto 段 -> 越界 deny
            # （修复前 hook 用 .* 会假阳性放行 lib/Xproto/x.proto，与 mjs/L3 不一致）
            denied = self.run_hook({
                "agent_type": "owner-midstar_owner", "cwd": str(workspace_root),
                "tool_input": {"file_path": str(workspace_root / "lib/Xproto/x.proto")},
            })
            self.assertIsNotNone(denied)
            self.assertEqual(denied["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_non_owner_agent_is_allowed(self) -> None:
        with self.workspace_with_owner() as (workspace_root, _):
            self.assertIsNone(self.run_hook({
                "agent_type": "general-purpose", "cwd": str(workspace_root),
                "tool_input": {"file_path": str(workspace_root / "src/api/leak.ts")},
            }))

    def test_blocks_owner_mutation_without_confirmation(self) -> None:
        # Topology mutation accepts only a direct --plan or digest-bound --confirm command.
        with self.workspace_with_owner() as (workspace_root, _):
            reg = workspace_root / ".ghost-agent-workflow" / "owners" / "registry.json"
            denied = self.run_hook({
                "agent_type": "general-purpose", "cwd": str(workspace_root),
                "tool_input": {"command": f"node {GD} owner-add {reg} /tmp/def.json"},
            })
            self.assertIsNotNone(denied)
            self.assertEqual(denied["hookSpecificOutput"]["permissionDecision"], "deny")
            self.assertIn("--confirm", denied["hookSpecificOutput"]["permissionDecisionReason"])
            denied_split = self.run_hook({
                "agent_type": "general-purpose", "cwd": str(workspace_root),
                "tool_input": {"command": f"node {GD} owner-split {reg} parent spec.json"},
            })
            self.assertIsNotNone(denied_split)

    def test_allows_owner_mutation_plan_dry_run_and_unrelated_bash(self) -> None:
        with self.workspace_with_owner() as (workspace_root, _):
            reg = workspace_root / ".ghost-agent-workflow" / "owners" / "registry.json"
            # --plan dry-run 放行（owner-add / owner-split）
            self.assertIsNone(self.run_hook({
                "agent_type": "general-purpose", "cwd": str(workspace_root),
                "tool_input": {"command": f"node {GD} owner-add {reg} /tmp/def.json --plan"},
            }))
            self.assertIsNone(self.run_hook({
                "agent_type": "general-purpose", "cwd": str(workspace_root),
                "tool_input": {"command": f"node {GD} owner-split {reg} parent spec.json --plan"},
            }))
            digest = "a" * 64
            self.assertIsNone(self.run_hook({
                "agent_type": "general-purpose", "cwd": str(workspace_root),
                "tool_input": {"command": f"node {GD} owner-add {reg} /tmp/def.json --confirm {digest}"},
            }))
            for suffix in [
                "--plan && touch /tmp/pwn",
                "--plan | sh",
                "--plan; true",
                "--plan\ntrue",
                "--plan > /tmp/out",
                "--confirm $(printf a)",
                "--confirm `printf a`",
                "--plan --confirm " + digest,
                "--confirm bad",
            ]:
                denied = self.run_hook({
                    "agent_type": "general-purpose", "cwd": str(workspace_root),
                    "tool_input": {"command": f"node {GD} owner-add {reg} /tmp/def.json {suffix}"},
                })
                self.assertIsNotNone(denied, suffix)
            # unrelated Bash remains unaffected for non-owner agents
            self.assertIsNone(self.run_hook({
                "agent_type": "general-purpose", "cwd": str(workspace_root),
                "tool_input": {"command": "git status && ls"},
            }))

    def test_non_owner_agent_is_allowed(self) -> None:
        with self.workspace_with_owner() as (workspace_root, _):
            self.assertIsNone(self.run_hook({
                "agent_type": "general-purpose", "cwd": str(workspace_root),
                "tool_input": {"file_path": str(workspace_root / "src/api/leak.ts")},
            }))

    def test_relative_traversal_and_wrong_cwd_fail_closed(self) -> None:
        with self.workspace_with_owner() as (workspace_root, registry_path):
            traversal = self.run_hook({
                "agent_type": "owner-proto_owner", "cwd": str(workspace_root),
                "tool_input": {"file_path": "src/proto/../../../outside/secret"},
            })
            self.assertIsNotNone(traversal)
            self.assertEqual(traversal["hookSpecificOutput"]["permissionDecision"], "deny")
            with tempfile.TemporaryDirectory() as other:
                denied = self.run_hook({
                    "agent_type": "owner-proto_owner", "cwd": other,
                    "tool_input": {"file_path": str(Path(other) / "src/proto/log.proto")},
                }, extra_env={"CLAUDE_PROJECT_DIR": str(workspace_root)})
            self.assertIsNotNone(denied)
            self.assertIn("cwd", denied["hookSpecificOutput"]["permissionDecisionReason"])

    def test_quoted_mutation_and_malformed_registry_glob_fail_closed(self) -> None:
        with self.workspace_with_owner() as (workspace_root, registry_path):
            denied = self.run_hook({
                "agent_type": "general-purpose", "cwd": str(workspace_root),
                "tool_input": {"command": f"node {GD} owner-''add {registry_path} def.json"},
            })
            self.assertIsNotNone(denied)
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            registry["owners"][0]["owned_modules"] = ["src/[z-a]/x"]
            registry_path.write_text(json.dumps(registry), encoding="utf-8")
            denied = self.run_hook({
                "agent_type": "owner-proto_owner", "cwd": str(workspace_root),
                "tool_input": {"file_path": str(workspace_root / "src/a/x")},
            })
            self.assertIsNotNone(denied)
            self.assertEqual(denied["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_owner_bash_is_denied(self) -> None:
        with self.workspace_with_owner() as (workspace_root, _):
            denied = self.run_hook({
                "agent_type": "owner-proto_owner", "cwd": str(workspace_root),
                "tool_input": {"command": "printf leak > src/api/leak.ts"},
            })
            self.assertIsNotNone(denied)
            self.assertIn("禁止 Bash", denied["hookSpecificOutput"]["permissionDecisionReason"])

    def test_unknown_owner_fails_closed(self) -> None:
        with self.workspace_with_owner() as (workspace_root, _):
            denied = self.run_hook({
                "agent_type": "owner-ghost", "cwd": str(workspace_root),
                "tool_input": {"file_path": str(workspace_root / "anywhere.ts")},
            })
            self.assertIsNotNone(denied)
            self.assertIn("unknown", denied["hookSpecificOutput"]["permissionDecisionReason"])

    def test_missing_registry_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            denied = self.run_hook({
                "agent_type": "owner-proto_owner", "cwd": directory,
                "tool_input": {"file_path": str(Path(directory) / "x.ts")},
            })
            self.assertIsNotNone(denied)
            self.assertIn("registry missing", denied["hookSpecificOutput"]["permissionDecisionReason"])


if __name__ == "__main__":
    unittest.main()
