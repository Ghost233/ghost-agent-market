from __future__ import annotations

import json
from contextlib import contextmanager
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
CLAUDE_SCRIPT = ROOT / "claude-code-market/scripts/goal-dag.mjs"


class OwnerRegistryCliTests(unittest.TestCase):
    @contextmanager
    def registry_workspace(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace_root = Path(directory)
            subprocess.run(["git", "init", "-q", str(workspace_root)], check=True)
            (workspace_root / "README.md").write_text("fixture\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(workspace_root), "add", "README.md"], check=True)
            subprocess.run(
                ["git", "-C", str(workspace_root), "-c", "user.name=t", "-c", "user.email=t@e.invalid",
                 "commit", "-q", "-m", "baseline"],
                check=True,
            )
            owners_dir = workspace_root / ".ghost-agent-workflow" / "owners"
            owners_dir.mkdir(parents=True)
            registry_path = owners_dir / "registry.json"
            yield workspace_root, registry_path

    def run_cli(self, *args: object) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment["GOAL_DAG_EXECUTION_PLATFORM"] = "claude_code"
        return subprocess.run(
            ["node", str(CLAUDE_SCRIPT), *(str(arg) for arg in args)],
            capture_output=True, text=True, check=False, env=environment,
        )

    def run_json(self, *args: object) -> dict:
        result = self.run_cli(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def write_json(self, path: Path, payload: dict) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")
        return path

    def init_registry(self, registry_path: Path, workspace_root: Path) -> None:
        self.run_json("owner-init", registry_path, workspace_root)

    def add_owner(self, registry_path: Path, owner_id: str, modules: list[str],
                  interfaces: list[str] | None = None, depends: list[str] | None = None) -> dict:
        def_path = registry_path.parent / f"{owner_id}-def.json"
        self.write_json(def_path, {
            "owner_id": owner_id,
            "functional_domain": owner_id,
            "owned_modules": modules,
            "interfaces": interfaces or [],
            "depends_on_owners": depends or [],
        })
        return self.run_json("owner-add", registry_path, def_path)

    def test_owner_init_creates_empty_registry(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            self.init_registry(registry_path, workspace_root)
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            self.assertEqual(registry["contract"], "OWNERS_REGISTRY_V1")
            self.assertEqual(registry["owners"], [])
            self.assertEqual(registry["workspace_root"], str(workspace_root))
            # owner-init is not idempotent
            rejected = self.run_cli("owner-init", registry_path, workspace_root)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("already exists", rejected.stderr)

    def test_owner_init_writes_gitignore_and_detects_whole_ignore(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            payload = self.run_json("owner-init", registry_path, workspace_root)
            self.assertIsNone(payload["archive_warning"])
            gitignore = workspace_root / ".ghost-agent-workflow" / ".gitignore"
            self.assertTrue(gitignore.is_file())
            body = gitignore.read_text(encoding="utf-8")
            self.assertIn("worktrees/", body)
            self.assertIn("*.lock", body)
            self.assertIn("*.transaction.json", body)
        with self.registry_workspace() as (workspace_root, registry_path):
            (workspace_root / ".gitignore").write_text(".ghost-agent-workflow/\n", encoding="utf-8")
            payload = self.run_json("owner-init", registry_path, workspace_root)
            self.assertIsNotNone(payload["archive_warning"])
            self.assertIn("整体忽略", payload["archive_warning"])

    def test_owner_add_plan_does_not_persist(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            self.init_registry(registry_path, workspace_root)
            plan = self.run_json(
                "owner-add", registry_path,
                self.write_json(registry_path.parent / "d.json", {
                    "owner_id": "proto_owner", "functional_domain": "proto",
                    "owned_modules": ["src/proto/**"], "interfaces": [], "depends_on_owners": [],
                }),
                "--plan",
            )
            self.assertEqual(plan["status"], "plan")
            self.assertEqual(plan["contract"], "OWNER_ADD_PLAN_V1")
            self.assertEqual(plan["would_add"]["owner_id"], "proto_owner")
            self.assertEqual(plan["new_owners"], ["proto_owner"])
            listed = self.run_json("owner-list", registry_path)
            self.assertEqual(listed["owners"], [])

    def test_owner_split_plan_does_not_persist(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            self.init_registry(registry_path, workspace_root)
            self.add_owner(registry_path, "chat_owner",
                           ["src/chat/message/**", "src/chat/topbar/**"])
            spec = self.write_json(registry_path.parent / "sp.json", {
                "reason": "拆顶栏",
                "new_owners": [{
                    "owner_id": "topbar_owner", "functional_domain": "顶栏",
                    "owned_modules": ["src/chat/topbar/**"], "interfaces": [],
                    "depends_on_owners": ["chat_owner"],
                }],
            })
            plan = self.run_json("owner-split", registry_path, "chat_owner", spec, "--plan")
            self.assertEqual(plan["status"], "plan")
            self.assertEqual(plan["contract"], "OWNER_SPLIT_PLAN_V1")
            self.assertEqual(plan["parent_would_lifecycle"], "active")
            self.assertEqual([c["owner_id"] for c in plan["new_owners"]], ["topbar_owner"])
            self.assertEqual(plan["new_owners"][0]["depends_on_owners"], ["chat_owner"])
            listed = self.run_json("owner-list", registry_path)
            ids = {o["owner_id"] for o in listed["owners"]}
            self.assertEqual(ids, {"chat_owner"})

    def test_owner_add_and_list(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            self.init_registry(registry_path, workspace_root)
            self.add_owner(registry_path, "proto_owner", ["src/proto/**"], ["src/proto/log.proto"])
            self.add_owner(registry_path, "api_owner", ["src/api/**"], depends=["proto_owner"])
            listed = self.run_json("owner-list", registry_path)
            ids = {owner["owner_id"] for owner in listed["owners"]}
            self.assertEqual(ids, {"proto_owner", "api_owner"})
            proto = next(o for o in listed["owners"] if o["owner_id"] == "proto_owner")
            self.assertEqual(proto["interfaces"], ["src/proto/log.proto"])
            self.assertEqual(proto["worktree_status"], "none")

    def test_owner_add_rejects_overlapping_modules(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            self.init_registry(registry_path, workspace_root)
            self.add_owner(registry_path, "proto_owner", ["src/proto/**"])
            rejected = self.run_cli(
                "owner-add", registry_path,
                self.write_json(registry_path.parent / "bad.json", {
                    "owner_id": "bad_owner", "functional_domain": "x",
                    "owned_modules": ["src/proto/x.proto"], "interfaces": [], "depends_on_owners": [],
                }),
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("overlaps", rejected.stderr)

    def test_owner_add_rejects_duplicate_id(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            self.init_registry(registry_path, workspace_root)
            self.add_owner(registry_path, "api_owner", ["src/api/**"])
            rejected = self.run_cli(
                "owner-add", registry_path,
                self.write_json(registry_path.parent / "dup.json", {
                    "owner_id": "api_owner", "functional_domain": "x",
                    "owned_modules": ["src/other/**"], "interfaces": [], "depends_on_owners": [],
                }),
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("already exists", rejected.stderr)

    def test_owner_interfaces_must_be_within_owned_modules(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            self.init_registry(registry_path, workspace_root)
            rejected = self.run_cli(
                "owner-add", registry_path,
                self.write_json(registry_path.parent / "iface.json", {
                    "owner_id": "api_owner", "functional_domain": "x",
                    "owned_modules": ["src/api/**"],
                    "interfaces": ["src/proto/shared.proto"], "depends_on_owners": [],
                }),
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("within owned_modules", rejected.stderr)

    def test_owner_query_reports_covered_gaps_and_can_cover(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            self.init_registry(registry_path, workspace_root)
            self.add_owner(registry_path, "proto_owner", ["src/proto/**"])
            self.add_owner(registry_path, "api_owner", ["src/api/**"])
            req_path = self.write_json(registry_path.parent / "req.json", {
                "modules": ["src/proto/log.proto", "src/api/user.ts", "src/feature/new/**"],
                "text": "日志上传",
            })
            payload = self.run_json("owner-query", registry_path, req_path)
            self.assertFalse(payload["can_cover"])
            self.assertEqual(payload["gaps"], ["src/feature/new/**"])
            covered = {item["module"]: item["owner_id"] for item in payload["covered"]}
            self.assertEqual(covered["src/proto/log.proto"], "proto_owner")
            self.assertEqual(covered["src/api/user.ts"], "api_owner")

    def test_owner_split_shrinks_parent_and_mints_child(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            self.init_registry(registry_path, workspace_root)
            self.add_owner(registry_path, "chat_owner", [
                "src/chat/message/**", "src/chat/dialog/**",
                "src/chat/topbar/**", "src/chat/input/**",
            ])
            spec_path = self.write_json(registry_path.parent / "split.json", {
                "reason": "拆分顶栏",
                "new_owners": [{
                    "owner_id": "chat_topbar_owner", "functional_domain": "顶栏",
                    "owned_modules": ["src/chat/topbar/**"],
                    "interfaces": [], "depends_on_owners": ["chat_owner"],
                }],
            })
            payload = self.run_json("owner-split", registry_path, "chat_owner", spec_path)
            self.assertEqual(payload["status"], "split")
            self.assertEqual(payload["parent_owner_id"], "chat_owner")
            self.assertEqual(payload["parent_would_lifecycle"], "active")
            self.assertNotIn("src/chat/topbar/**", payload["parent_would_retain"])
            listed = self.run_json("owner-list", registry_path)
            chat = next(o for o in listed["owners"] if o["owner_id"] == "chat_owner")
            self.assertNotIn("src/chat/topbar/**", chat["owned_modules"])
            topbar = next(o for o in listed["owners"] if o["owner_id"] == "chat_topbar_owner")
            self.assertEqual(topbar["owned_modules"], ["src/chat/topbar/**"])

    def test_owner_split_retires_parent_when_all_modules_claimed(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            self.init_registry(registry_path, workspace_root)
            self.add_owner(registry_path, "chat_owner",
                           ["src/chat/message/**", "src/chat/dialog/**"])
            spec_path = self.write_json(registry_path.parent / "split.json", {
                "reason": "全部拆出",
                "new_owners": [
                    {"owner_id": "msg_owner", "functional_domain": "消息",
                     "owned_modules": ["src/chat/message/**"], "interfaces": [], "depends_on_owners": []},
                    {"owner_id": "dialog_owner", "functional_domain": "对话框",
                     "owned_modules": ["src/chat/dialog/**"], "interfaces": [], "depends_on_owners": []},
                ],
            })
            payload = self.run_json("owner-split", registry_path, "chat_owner", spec_path)
            self.assertEqual(payload["parent_would_lifecycle"], "retired")
            self.assertEqual(payload["parent_would_retain"], [])
            listed = self.run_json("owner-list", registry_path)
            self.assertFalse(any(o["owner_id"] == "chat_owner" for o in listed["owners"]))

    def test_owner_split_rejects_module_outside_parent(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            self.init_registry(registry_path, workspace_root)
            self.add_owner(registry_path, "chat_owner", ["src/chat/**"])
            spec_path = self.write_json(registry_path.parent / "bad-split.json", {
                "reason": "越界",
                "new_owners": [{
                    "owner_id": "api_owner", "functional_domain": "api",
                    "owned_modules": ["src/api/**"], "interfaces": [], "depends_on_owners": [],
                }],
            })
            rejected = self.run_cli("owner-split", registry_path, "chat_owner", spec_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("not within parent", rejected.stderr)

    def test_owner_split_rejects_interface_drifting_outside_retained(self) -> None:
        # interfaces ⊆ owned_modules 是硬不变量。split 缩父域后，若某 retained
        # interface 的宿主模块被 child 认领，它会漂移到 retainedModules 外。
        # 必须显式 fail，不得产出 active owner 持越界 interface。
        with self.registry_workspace() as (workspace_root, registry_path):
            self.init_registry(registry_path, workspace_root)
            self.add_owner(registry_path, "ab_owner",
                           ["src/a/**", "src/b/**"], interfaces=["src/b/iface.ts"])
            spec_path = self.write_json(registry_path.parent / "drift.json", {
                "reason": "认领 src/b/sub",
                "new_owners": [{
                    "owner_id": "bsub_owner", "functional_domain": "bsub",
                    "owned_modules": ["src/b/sub/**"], "interfaces": [],
                    "depends_on_owners": ["ab_owner"],
                }],
            })
            rejected = self.run_cli("owner-split", registry_path, "ab_owner", spec_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("would fall outside retained", rejected.stderr)

    def commit_in_worktree(self, worktree_path: Path, files: dict[str, str]) -> None:
        for rel, content in files.items():
            target = worktree_path / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        subprocess.run(
            ["git", "-C", str(worktree_path), "add", "-A"], check=True,
        )
        subprocess.run(
            ["git", "-C", str(worktree_path), "-c", "user.name=t", "-c", "user.email=t@e.invalid",
             "commit", "-q", "-m", "wip"], check=True,
        )

    def test_worktree_create_sparse_checkout_and_uniqueness(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            (workspace_root / "src/proto/base.proto").parent.mkdir(parents=True, exist_ok=True)
            (workspace_root / "src/proto/base.proto").write_text("base\n", encoding="utf-8")
            (workspace_root / "src/api/base.ts").parent.mkdir(parents=True, exist_ok=True)
            (workspace_root / "src/api/base.ts").write_text("base\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(workspace_root), "add", "-A"], check=True)
            subprocess.run(
                ["git", "-C", str(workspace_root), "-c", "user.name=t", "-c", "user.email=t@e.invalid",
                 "commit", "-q", "-m", "init"], check=True,
            )
            subprocess.run(["git", "-C", str(workspace_root), "checkout", "-q", "-b", "dev_feature"], check=True)
            self.init_registry(registry_path, workspace_root)
            self.add_owner(registry_path, "proto_owner", ["src/proto/**"])
            payload = self.run_json("worktree-create", registry_path, "dev_feature", "proto_owner")
            self.assertEqual(payload["owner_branch"], "dev_proto_owner")
            self.assertEqual(payload["sparse_dirs"], ["src/proto"])
            worktree = Path(payload["worktree_path"])
            # sparse: only src/proto materialized, src/api absent
            self.assertTrue((worktree / "src/proto/base.proto").is_file())
            self.assertFalse((worktree / "src/api").exists())
            # uniqueness: second create rejected
            rejected = self.run_cli("worktree-create", registry_path, "dev_feature", "proto_owner")
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("active worktree", rejected.stderr)

    def test_worktree_merge_back_succeeds_in_scope(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            (workspace_root / "src/proto/base.proto").parent.mkdir(parents=True, exist_ok=True)
            (workspace_root / "src/proto/base.proto").write_text("base\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(workspace_root), "add", "-A"], check=True)
            subprocess.run(
                ["git", "-C", str(workspace_root), "-c", "user.name=t", "-c", "user.email=t@e.invalid",
                 "commit", "-q", "-m", "init"], check=True,
            )
            subprocess.run(["git", "-C", str(workspace_root), "checkout", "-q", "-b", "dev_feature"], check=True)
            self.init_registry(registry_path, workspace_root)
            self.add_owner(registry_path, "proto_owner", ["src/proto/**"])
            created = self.run_json("worktree-create", registry_path, "dev_feature", "proto_owner")
            self.commit_in_worktree(Path(created["worktree_path"]), {"src/proto/log.proto": "log\n"})
            merged = self.run_json("worktree-merge-back", registry_path, "dev_feature", "proto_owner")
            self.assertEqual(merged["status"], "merged")
            self.assertEqual(merged["changed_files"], 1)
            self.assertTrue((workspace_root / "src/proto/log.proto").is_file())

    def test_worktree_merge_back_rejects_out_of_scope(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            (workspace_root / "src/proto/base.proto").parent.mkdir(parents=True, exist_ok=True)
            (workspace_root / "src/proto/base.proto").write_text("base\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(workspace_root), "add", "-A"], check=True)
            subprocess.run(
                ["git", "-C", str(workspace_root), "-c", "user.name=t", "-c", "user.email=t@e.invalid",
                 "commit", "-q", "-m", "init"], check=True,
            )
            subprocess.run(["git", "-C", str(workspace_root), "checkout", "-q", "-b", "dev_feature"], check=True)
            self.init_registry(registry_path, workspace_root)
            self.add_owner(registry_path, "proto_owner", ["src/proto/**"])
            created = self.run_json("worktree-create", registry_path, "dev_feature", "proto_owner")
            worktree = Path(created["worktree_path"])
            # bypass sparse to plant an out-of-scope file
            subprocess.run(["git", "-C", str(worktree), "sparse-checkout", "disable"], check=True)
            self.commit_in_worktree(worktree, {"src/api/leak.ts": "leak\n"})
            rejected = self.run_cli("worktree-merge-back", registry_path, "dev_feature", "proto_owner")
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("outside owned_modules", rejected.stderr)

    def test_worktree_remove_requires_merge_or_force(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            (workspace_root / "src/proto/base.proto").parent.mkdir(parents=True, exist_ok=True)
            (workspace_root / "src/proto/base.proto").write_text("base\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(workspace_root), "add", "-A"], check=True)
            subprocess.run(
                ["git", "-C", str(workspace_root), "-c", "user.name=t", "-c", "user.email=t@e.invalid",
                 "commit", "-q", "-m", "init"], check=True,
            )
            subprocess.run(["git", "-C", str(workspace_root), "checkout", "-q", "-b", "dev_feature"], check=True)
            self.init_registry(registry_path, workspace_root)
            self.add_owner(registry_path, "proto_owner", ["src/proto/**"])
            created = self.run_json("worktree-create", registry_path, "dev_feature", "proto_owner")
            rejected = self.run_cli("worktree-remove", registry_path, "proto_owner")
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("--force", rejected.stderr)
            removed = self.run_json("worktree-remove", registry_path, "proto_owner", "--force")
            self.assertEqual(removed["status"], "removed")
            listed = self.run_json("owner-list", registry_path)
            proto = next(o for o in listed["owners"] if o["owner_id"] == "proto_owner")
            self.assertEqual(proto["worktree_status"], "removed")

    def test_owner_verify_plan_checks_writable_within_owned_modules(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            self.init_registry(registry_path, workspace_root)
            self.add_owner(registry_path, "proto_owner", ["src/proto/**"])
            plan_path = self.write_json(registry_path.parent / "plan.json", {
                "contract": "DAG_PLAN_V4",
                "owners": [{"id": "proto_owner", "writable_paths": ["src/proto/log.proto"]}],
            })
            payload = self.run_json("owner-verify-plan", registry_path, plan_path)
            self.assertEqual(payload["status"], "verified")

    def test_owner_verify_plan_rejects_writable_outside_and_unknown_owner(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            self.init_registry(registry_path, workspace_root)
            self.add_owner(registry_path, "proto_owner", ["src/proto/**"])
            outside = self.write_json(registry_path.parent / "outside.json", {
                "contract": "DAG_PLAN_V4",
                "owners": [{"id": "proto_owner", "writable_paths": ["src/api/x.ts"]}],
            })
            rejected = self.run_cli("owner-verify-plan", registry_path, outside)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("not covered by registry owned_modules", rejected.stderr)
            unknown = self.write_json(registry_path.parent / "unknown.json", {
                "contract": "DAG_PLAN_V4",
                "owners": [{"id": "ghost_owner", "writable_paths": ["src/proto/x"]}],
            })
            rejected = self.run_cli("owner-verify-plan", registry_path, unknown)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("not an active registry owner", rejected.stderr)

    def test_owner_note_lands_requirement_and_memory(self) -> None:
        with self.registry_workspace() as (workspace_root, registry_path):
            self.init_registry(registry_path, workspace_root)
            self.add_owner(registry_path, "proto_owner", ["src/proto/**"])
            req_note = self.write_json(registry_path.parent / "req.json", {
                "kind": "requirement", "slug": "log-upload", "text": "日志上传需求",
            })
            self.run_json("owner-note", registry_path, "proto_owner", req_note)
            mem_note = self.write_json(registry_path.parent / "mem.json", {
                "kind": "memory", "text": "决策：proto 用 v3",
            })
            payload = self.run_json("owner-note", registry_path, "proto_owner", mem_note)
            self.assertEqual(payload["status"], "noted")
            owner_dir = registry_path.parent / "proto_owner"
            memory = (owner_dir / "memory.md").read_text(encoding="utf-8")
            self.assertIn("日志上传需求", memory)
            self.assertIn("决策：proto 用 v3", memory)
            req_files = list((owner_dir / "requirements").glob("*.md"))
            self.assertEqual(len(req_files), 1)
            self.assertIn("日志上传需求", req_files[0].read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
