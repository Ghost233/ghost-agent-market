from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "codex-market/plugins/ghost-agent-workflow/scripts/expert-registry.mjs"
CLAUDE_SCRIPT = ROOT / "claude-code-market/scripts/expert-registry.mjs"


def serialized(value: object) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False) + "\n"


def digest_json(value: object) -> str:
    return hashlib.sha256(serialized(value).encode()).hexdigest()


class OwnerRegistryCliTests(unittest.TestCase):
    @contextmanager
    def workspace(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q", root], check=True)
            for path in ["src/user/model.ts", "src/admin/model.ts", "README.md"]:
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(f"{path}\n", encoding="utf-8")
            subprocess.run(["git", "-C", root, "add", "."], check=True)
            registry_path = root / ".ghost-agent-workflow/owners/registry.json"
            registry_path.parent.mkdir(parents=True)
            registry = {
                "contract": "EXPERT_REGISTRY_V2",
                "workspace_root": str(root),
                "revision": 1,
                "matcher": "expert-path-expression-v2",
                "managed_roots": ["src/**"],
                "owners": [
                    self.owner("user-module", ["src/user/**"]),
                    self.owner("admin-module", ["src/admin/**"]),
                ],
                "retired_owner_ids": [],
                "updated_at": "2026-07-27T00:00:00.000Z",
            }
            registry_path.write_text(serialized(registry), encoding="utf-8")
            for owner in registry["owners"]:
                capsule = self.capsule(owner, registry["revision"])
                path = registry_path.parent / owner["id"] / "capsule.json"
                path.parent.mkdir(parents=True)
                path.write_text(serialized(capsule), encoding="utf-8")
            yield root, registry_path, registry

    def owner(self, owner_id: str, patterns: list[str], parent: str | None = None) -> dict:
        return {
            "id": owner_id,
            "generation": 1,
            "status": "active",
            "subtype": "execution",
            "responsibility": f"负责 {owner_id}",
            "scope_patterns": patterns,
            "scope_excludes": [],
            "worker_context": f"保持 {owner_id} 模块知识",
            "skill_mount": [],
            "model_profile": {"model": "inherit"},
            "thread_affinity": "main",
            "lineage": {
                "parent_owner_ids": [] if parent is None else [parent],
                "created_by_request_digest": "bootstrap",
            },
        }

    def capsule(self, owner: dict, revision: int) -> dict:
        return {
            "contract": "EXPERT_CAPSULE_V2",
            "owner_id": owner["id"],
            "generation": 1,
            "registry_revision": revision,
            "scope_patterns": owner["scope_patterns"],
            "scope_excludes": owner["scope_excludes"],
            "responsibility": owner["responsibility"],
            "worker_context": owner["worker_context"],
            "skill_mount": owner.get("skill_mount", []),
            "model_profile": owner.get("model_profile", {"model": "inherit"}),
            "thread_affinity": owner.get("thread_affinity", "main"),
            "inherited_from": [],
            "decisions": [f"{owner['id']} decision"],
            "invariants": [f"{owner['id']} invariant"],
            "risks": [],
            "important_symbols": [],
            "next_steps": [],
            "updated_at": "2026-07-27T00:00:00.000Z",
        }

    def run_cli(self, *args: object) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["node", SCRIPT, *(str(arg) for arg in args)],
            capture_output=True,
            text=True,
            check=False,
            env=os.environ.copy(),
        )

    def run_json(self, *args: object) -> dict:
        result = self.run_cli(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def write_request(self, path: Path, registry: dict, **overrides: object) -> dict:
        request = {
            "contract": "EXPERT_CHANGE_REQUEST_V2",
            "request_id": "expert-change-1",
            "operation": "create",
            "base_registry_digest": digest_json(registry),
            "created_at": "2026-07-27T01:00:00.000Z",
            "reason": "新增报表模块",
            "source_owner_ids": [],
            "new_owners": [
                {
                    "id": "report-module",
                    "subtype": "execution",
                    "responsibility": "负责报表模块",
                    "scope_patterns": ["src/report/**"],
                    "worker_context": "保持报表合同稳定",
                    "skill_mount": [],
                    "model_profile": {"model": "inherit"},
                    "thread_affinity": "main",
                }
            ],
            "capsule_strategy": "empty",
        }
        request.update(overrides)
        if "source_owner_id" in request:
            source_owner_id = request.pop("source_owner_id")
            request["source_owner_ids"] = [] if source_owner_id is None else [source_owner_id]
        if request["capsule_strategy"] == "inherit_parent":
            request["capsule_strategy"] = "inherit_sources"
        for owner in request["new_owners"]:
            owner.setdefault("scope_excludes", [])
            owner.setdefault("subtype", "execution")
            owner.setdefault("skill_mount", [])
            owner.setdefault("model_profile", {"model": "inherit"})
            owner.setdefault("thread_affinity", "main")
        path.write_text(serialized(request), encoding="utf-8")
        return request

    def approve(self, request: dict, validation_path: Path, validation: dict, path: Path) -> None:
        approval = {
            "contract": "EXPERT_CHANGE_APPROVAL_V2",
            "decision": "approved",
            "approved_by": "user",
            "approved_at": "2026-07-27T01:05:00.000Z",
            "request_digest": validation["request_digest"],
            "validation_digest": hashlib.sha256(validation_path.read_bytes()).hexdigest(),
            "next_registry_digest": validation["next_registry_digest"],
        }
        path.write_text(serialized(approval), encoding="utf-8")

    def test_validate_and_route_require_exactly_one_owner(self) -> None:
        with self.workspace() as (_, registry_path, _):
            result = self.run_json("validate", registry_path)
            self.assertEqual(result["active_owner_count"], 2)
            route = self.run_json("route", registry_path, "src/user/model.ts")
            self.assertEqual(route["owner_id"], "user-module")
            missing = self.run_cli("route", registry_path, "docs/user.md")
            self.assertNotEqual(missing.returncode, 0)
            self.assertIn("unowned", missing.stderr)

    def test_route_writes_handoff_audit_entry(self) -> None:
        # F7 跨专家 handoff 审计：每次 route 边界解析必须 100% 留痕。
        with self.workspace() as (root, registry_path, _):
            self.run_json("route", registry_path, "src/user/model.ts")
            audit_dir = root / ".ghost-agent-workflow/audit"
            files = sorted(audit_dir.glob("audit-*.jsonl"))
            self.assertEqual(len(files), 1)
            entries = [json.loads(line) for line in files[0].read_text(encoding="utf-8").splitlines() if line]
            self.assertEqual(len(entries), 1)
            entry = entries[0]
            self.assertEqual(entry["action"], "route")
            self.assertEqual(entry["resource"], "src/user/model.ts")
            self.assertEqual(entry["actor"], "main")
            self.assertIn("ts", entry)
            self.assertIn("hash", entry)
            self.assertIn("session_id", entry)
            # audit-log 命令可回读最近条目
            log = self.run_json("audit-log", registry_path)
            self.assertEqual(len(log["entries"]), 1)
            self.assertEqual(log["entries"][0]["action"], "route")

    def test_apply_change_writes_audit_entry(self) -> None:
        # F7 治理变更（专家责任域变化）落地必须审计留痕。
        with self.workspace() as (root, registry_path, _):
            request_path = registry_path.parent / "apply-audit-request.json"
            validation_path = registry_path.parent / "apply-audit-validation.json"
            approval_path = registry_path.parent / "apply-audit-approval.json"
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            self.write_request(
                request_path,
                registry,
                operation="create",
                new_owners=[{
                    "id": "report-module",
                    "subtype": "execution",
                    "responsibility": "负责报表模块",
                    "scope_patterns": ["src/report/**"],
                    "worker_context": "保持报表合同稳定",
                }],
            )
            self.run_json("validate-change", registry_path, request_path, validation_path)
            validation = json.loads(validation_path.read_text(encoding="utf-8"))
            self.approve(
                json.loads(request_path.read_text(encoding="utf-8")),
                validation_path,
                validation,
                approval_path,
            )
            self.run_json("apply-change", registry_path, request_path, validation_path, approval_path)
            log = self.run_json("audit-log", registry_path)
            apply_entries = [e for e in log["entries"] if e["action"].startswith("apply-change")]
            self.assertEqual(len(apply_entries), 1)
            self.assertTrue(apply_entries[0]["action"].endswith(":create"))
            self.assertEqual(apply_entries[0]["actor"], "user")

    def test_prune_audit_removes_only_older_than_retention(self) -> None:
        with self.workspace() as (root, registry_path, _):
            self.run_json("route", registry_path, "src/user/model.ts")
            audit_dir = root / ".ghost-agent-workflow/audit"
            # 制造一个早于保留期的旧审计文件
            old_file = audit_dir / "audit-2000-01-01.jsonl"
            old_file.write_text(
                json.dumps({"actor": "main", "ts": "2000-01-01T00:00:00.000Z",
                            "resource": "x", "action": "route", "hash": "h", "session_id": ""}) + "\n",
                encoding="utf-8",
            )
            pruned = self.run_json("prune-audit", registry_path)
            self.assertIn("audit-2000-01-01.jsonl", pruned["removed"])
            remaining = sorted(audit_dir.glob("audit-*.jsonl"))
            self.assertEqual(len(remaining), 1)
            self.assertNotIn("audit-2000-01-01.jsonl", [p.name for p in remaining])

    def test_set_managed_roots_uses_exact_paths_before_initial_approval(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q", root], check=True)
            for relative in ["src/user/model.ts", "README.md"]:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(f"{relative}\n", encoding="utf-8")
            subprocess.run(["git", "-C", root, "add", "."], check=True)

            self.run_json("init", root)
            receipt = self.run_json(
                "set-managed-roots", root, "src/user/model.ts", "README.md",
            )
            self.assertEqual(receipt["status"], "managed_roots_set")
            self.assertEqual(receipt["revision"], 2)
            registry_path = root / ".ghost-agent-workflow/owners/registry.json"
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            self.assertEqual(registry["managed_roots"], ["README.md", "src/user/model.ts"])

            repeated = self.run_json(
                "set-managed-roots", root, "README.md", "src/user/model.ts",
            )
            self.assertEqual(repeated["status"], "unchanged")
            self.assertEqual(repeated["revision"], 2)

            wildcard = self.run_cli("set-managed-roots", root, "src/**")
            self.assertNotEqual(wildcard.returncode, 0)
            self.assertIn("exact repository paths", wildcard.stderr)

    def test_init_requires_an_approved_covering_create_request(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q", root], check=True)
            (root / "README.md").write_text("bootstrap\n", encoding="utf-8")
            subprocess.run(["git", "-C", root, "add", "README.md"], check=True)
            initialized = self.run_json("init", root)
            self.assertEqual(initialized["status"], "pending_owner_approval")
            registry_path = Path(initialized["registry_ref"])
            self.assertTrue((registry_path.parents[1] / ".gitignore").is_file())
            repeated_init = self.run_json("init", root)
            self.assertEqual(repeated_init["status"], "pending_owner_approval")
            self.assertEqual(repeated_init["registry_digest"], initialized["registry_digest"])
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            self.assertNotEqual(self.run_cli("validate", registry_path).returncode, 0)

            request_path = registry_path.parent / "request.json"
            validation_path = registry_path.parent / "validation.json"
            approval_path = registry_path.parent / "approval.json"
            request = self.write_request(
                request_path,
                registry,
                reason="初始化仓库 Owner",
                new_owners=[
                    {
                        "id": "repository-module",
                        "responsibility": "负责仓库初始模块",
                        "scope_patterns": ["**"],
                        "worker_context": "保持仓库初始模块知识",
                    }
                ],
            )
            self.run_json("validate-change", registry_path, request_path, validation_path)
            validation = json.loads(validation_path.read_text(encoding="utf-8"))
            self.approve(request, validation_path, validation, approval_path)
            self.run_json(
                "apply-change", registry_path, request_path, validation_path, approval_path
            )
            self.assertEqual(self.run_json("validate", registry_path)["active_owner_count"], 1)

    def test_registry_rejects_future_scope_overlap(self) -> None:
        with self.workspace() as (_, registry_path, registry):
            registry["owners"][1]["scope_patterns"] = ["src/*/model.ts"]
            registry_path.write_text(serialized(registry), encoding="utf-8")
            result = self.run_cli("validate", registry_path)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("expert scope conflict", result.stderr)

    def test_create_requires_digest_bound_user_approval(self) -> None:
        with self.workspace() as (_, registry_path, registry):
            request_path = registry_path.parent / "request.json"
            validation_path = registry_path.parent / "validation.json"
            approval_path = registry_path.parent / "approval.json"
            request = self.write_request(request_path, registry)
            validation_result = self.run_json(
                "validate-change", registry_path, request_path, validation_path
            )
            self.assertTrue(validation_result["requires_user_approval"])
            validation = json.loads(validation_path.read_text(encoding="utf-8"))
            bad_approval = {
                "contract": "EXPERT_CHANGE_APPROVAL_V2",
                "decision": "approved",
                "approved_by": "user",
                "approved_at": "2026-07-27T01:05:00.000Z",
                "request_digest": "wrong",
                "validation_digest": hashlib.sha256(validation_path.read_bytes()).hexdigest(),
                "next_registry_digest": validation["next_registry_digest"],
            }
            approval_path.write_text(serialized(bad_approval), encoding="utf-8")
            rejected = self.run_cli(
                "apply-change", registry_path, request_path, validation_path, approval_path
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.approve(request, validation_path, validation, approval_path)
            applied = self.run_json(
                "apply-change", registry_path, request_path, validation_path, approval_path
            )
            self.assertEqual(applied["added_owner_ids"], ["report-module"])
            self.assertTrue((registry_path.parent / "report-module/capsule.json").exists())
            repeated = self.run_json(
                "apply-change", registry_path, request_path, validation_path, approval_path
            )
            self.assertEqual(repeated["status"], "current")

    def test_apply_change_recovers_after_capsules_were_written_before_registry(self) -> None:
        with self.workspace() as (_, registry_path, registry):
            request_path = registry_path.parent / "request.json"
            validation_path = registry_path.parent / "validation.json"
            approval_path = registry_path.parent / "approval.json"
            request = self.write_request(request_path, registry)
            self.run_json("validate-change", registry_path, request_path, validation_path)
            validation = json.loads(validation_path.read_text(encoding="utf-8"))
            self.approve(request, validation_path, validation, approval_path)
            self.run_json(
                "apply-change", registry_path, request_path, validation_path, approval_path
            )
            registry_path.write_text(serialized(registry), encoding="utf-8")
            recovered = self.run_json(
                "apply-change", registry_path, request_path, validation_path, approval_path
            )
            self.assertEqual(recovered["status"], "applied")
            self.assertEqual(digest_json(json.loads(registry_path.read_text(encoding="utf-8"))),
                             validation["next_registry_digest"])

    def test_apply_change_rejects_multiple_active_goal_or_quick_workflows(self) -> None:
        with self.workspace() as (root, registry_path, registry):
            goal_state = root / ".ghost-agent-workflow/runtime/one/goal-state.json"
            goal_state.parent.mkdir(parents=True, exist_ok=True)
            goal_state.write_text(serialized({"status": "active"}), encoding="utf-8")
            quick_state = root / ".ghost-agent-workflow/runtime/two/workflow-state.json"
            quick_state.parent.mkdir(parents=True, exist_ok=True)
            quick_state.write_text(serialized({"status": "active"}), encoding="utf-8")
            request_path = registry_path.parent / "request.json"
            validation_path = registry_path.parent / "validation.json"
            approval_path = registry_path.parent / "approval.json"
            request = self.write_request(request_path, registry)
            self.run_json("validate-change", registry_path, request_path, validation_path)
            validation = json.loads(validation_path.read_text(encoding="utf-8"))
            self.approve(request, validation_path, validation, approval_path)
            rejected = self.run_cli(
                "apply-change", registry_path, request_path, validation_path, approval_path
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("only one active workflow", rejected.stderr)

    def test_apply_change_waits_for_the_single_workflow_safe_boundary(self) -> None:
        with self.workspace() as (root, registry_path, registry):
            goal_directory = root / ".ghost-agent-workflow/runtime/goals/one"
            goal_directory.mkdir(parents=True, exist_ok=True)
            (goal_directory / "goal-state.json").write_text(
                serialized({"status": "active"}), encoding="utf-8"
            )
            (goal_directory / "state.json").write_text(
                serialized({"tasks": {"T1": {"status": "running"}}}),
                encoding="utf-8",
            )
            request_path = registry_path.parent / "request.json"
            validation_path = registry_path.parent / "validation.json"
            approval_path = registry_path.parent / "approval.json"
            request = self.write_request(request_path, registry)
            self.run_json("validate-change", registry_path, request_path, validation_path)
            validation = json.loads(validation_path.read_text(encoding="utf-8"))
            self.approve(request, validation_path, validation, approval_path)
            rejected = self.run_cli(
                "apply-change", registry_path, request_path, validation_path, approval_path
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("safe boundary", rejected.stderr)
            (goal_directory / "state.json").write_text(
                serialized({"tasks": {"T1": {"status": "completed"}}}),
                encoding="utf-8",
            )
            self.assertEqual(
                self.run_json(
                    "apply-change", registry_path, request_path, validation_path, approval_path
                )["status"],
                "applied",
            )

    def test_request_and_approval_are_generated_by_domain_commands(self) -> None:
        with self.workspace() as (_, registry_path, _):
            request_path = registry_path.parent / "script-request.json"
            validation_path = registry_path.parent / "script-validation.json"
            approval_path = registry_path.parent / "script-approval.json"
            created = self.run_json(
                "request-change",
                registry_path,
                request_path,
                "create",
                "新增报表模块",
                "--owner",
                "report-module",
                "负责报表模块",
                "保持报表合同稳定",
                "--scope",
                "report-module",
                "src/report/**",
            )
            self.assertEqual(created["status"], "created")
            request = json.loads(request_path.read_text(encoding="utf-8"))
            self.assertEqual(request["contract"], "EXPERT_CHANGE_REQUEST_V2")
            self.assertNotIn("runtime_profile", request["new_owners"][0])
            self.assertIn("created_at", request)
            self.run_json("validate-change", registry_path, request_path, validation_path)
            approved = self.run_json(
                "approve-change", request_path, validation_path, approval_path
            )
            self.assertEqual(approved["status"], "approved")
            approval = json.loads(approval_path.read_text(encoding="utf-8"))
            self.assertEqual(
                set(approval),
                {
                    "contract",
                    "decision",
                    "approved_by",
                    "approved_at",
                    "request_digest",
                    "validation_digest",
                    "next_registry_digest",
                },
            )
            self.run_json(
                "apply-change", registry_path, request_path, validation_path, approval_path
            )

    def test_dashboard_expert_requires_no_writable_scope(self) -> None:
        # §4.5 Dashboard 专家持有后台进程、不持有任何 writable scope / ACL 写权限；
        # 只读消费 progress.json / events.jsonl 两个固定抓取入口，因此禁止声明 --scope。
        with self.workspace() as (_, registry_path, _):
            request_path = registry_path.parent / "dash-request.json"
            validation_path = registry_path.parent / "dash-validation.json"
            approval_path = registry_path.parent / "dash-approval.json"

            created = self.run_json(
                "request-change",
                registry_path,
                request_path,
                "create",
                "新增 Dashboard 专家",
                "--owner",
                "dash-expert",
                "维护与更新 Dashboard",
                "持有后台进程、轮询进度入口",
                "--subtype",
                "dash-expert",
                "dashboard",
            )
            self.assertEqual(created["status"], "created")
            request = json.loads(request_path.read_text(encoding="utf-8"))
            self.assertEqual(request["new_owners"][0]["subtype"], "dashboard")
            self.assertEqual(request["new_owners"][0]["scope_patterns"], [])

            self.run_json("validate-change", registry_path, request_path, validation_path)
            self.run_json(
                "approve-change", request_path, validation_path, approval_path
            )
            self.run_json(
                "apply-change", registry_path, request_path, validation_path, approval_path
            )
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            applied = next(o for o in registry["owners"] if o["id"] == "dash-expert")
            self.assertEqual(applied["subtype"], "dashboard")
            self.assertEqual(applied["scope_patterns"], [])

    def test_dashboard_expert_rejects_writable_scope(self) -> None:
        # 违反 §4.5 的 Dashboard 专家声明 --scope 必须被 request-change 拒绝。
        with self.workspace() as (_, registry_path, _):
            request_path = registry_path.parent / "dash-bad-request.json"
            result = self.run_cli(
                "request-change",
                registry_path,
                request_path,
                "create",
                "错误的 Dashboard 专家",
                "--owner",
                "dash-bad",
                "维护 Dashboard",
                "持有后台进程",
                "--subtype",
                "dash-bad",
                "dashboard",
                "--scope",
                "dash-bad",
                "src/**",
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("must not declare --scope", result.stderr)

    def test_split_is_exact_partition_and_inherits_parent_capsule(self) -> None:
        with self.workspace() as (_, registry_path, registry):
            registry["owners"][0]["scope_patterns"] = [
                "src/user/auth/**",
                "src/user/profile/**",
            ]
            (registry_path.parent / "user-module/capsule.json").write_text(
                serialized(self.capsule(registry["owners"][0], 1)), encoding="utf-8"
            )
            (registry_path.parent / "user-module/capsule.json").parent.mkdir(
                parents=True, exist_ok=True
            )
            registry["managed_roots"] = ["src/admin/**"]
            registry_path.write_text(serialized(registry), encoding="utf-8")
            request_path = registry_path.parent / "request.json"
            validation_path = registry_path.parent / "validation.json"
            approval_path = registry_path.parent / "approval.json"
            request = self.write_request(
                request_path,
                registry,
                operation="split",
                source_owner_id="user-module",
                new_owners=[
                    {
                        "id": "user-auth-module",
                        "responsibility": "负责用户认证",
                        "scope_patterns": ["src/user/auth/**"],
                        "worker_context": "保持认证合同",
                    },
                    {
                        "id": "user-profile-module",
                        "responsibility": "负责用户资料",
                        "scope_patterns": ["src/user/profile/**"],
                        "worker_context": "保持资料合同",
                    },
                ],
                capsule_strategy="inherit_parent",
            )
            self.run_json("validate-change", registry_path, request_path, validation_path)
            validation = json.loads(validation_path.read_text(encoding="utf-8"))
            self.approve(request, validation_path, validation, approval_path)
            self.run_json(
                "apply-change", registry_path, request_path, validation_path, approval_path
            )
            updated = json.loads(registry_path.read_text(encoding="utf-8"))
            self.assertIn("user-module", updated["retired_owner_ids"])
            auth_capsule = json.loads(
                (registry_path.parent / "user-auth-module/capsule.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(auth_capsule["inherited_from"], ["user-module"])
            self.assertIn("user-module invariant", auth_capsule["invariants"])

    def test_split_rejects_scope_holes(self) -> None:
        with self.workspace() as (_, registry_path, registry):
            request_path = registry_path.parent / "request.json"
            validation_path = registry_path.parent / "validation.json"
            self.write_request(
                request_path,
                registry,
                operation="split",
                source_owner_id="user-module",
                new_owners=[
                    {
                        "id": "user-auth-module",
                        "responsibility": "负责用户认证",
                        "scope_patterns": ["src/user/auth/**"],
                        "worker_context": "保持认证合同",
                    },
                    {
                        "id": "user-profile-module",
                        "responsibility": "负责用户资料",
                        "scope_patterns": ["src/user/profile/**"],
                        "worker_context": "保持资料合同",
                    },
                ],
                capsule_strategy="inherit_parent",
            )
            result = self.run_cli(
                "validate-change", registry_path, request_path, validation_path
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("remainder include", result.stderr)

    def test_scope_v2_splits_broad_include_with_explicit_remainder_exclude(self) -> None:
        with self.workspace() as (_, registry_path, registry):
            source_owner = self.owner("source-module", ["src/**"])
            registry["owners"] = [source_owner]
            registry_path.write_text(serialized(registry), encoding="utf-8")
            source_capsule_path = registry_path.parent / "source-module/capsule.json"
            source_capsule_path.parent.mkdir(parents=True, exist_ok=True)
            source_capsule_path.write_text(
                serialized(self.capsule(source_owner, registry["revision"])),
                encoding="utf-8",
            )
            request_path = registry_path.parent / "broad-split-request.json"
            validation_path = registry_path.parent / "broad-split-validation.json"
            approval_path = registry_path.parent / "broad-split-approval.json"
            request = self.write_request(
                request_path,
                registry,
                operation="split",
                source_owner_ids=["source-module"],
                new_owners=[
                    {
                        "id": "user-module-v2",
                        "responsibility": "负责用户模块",
                        "scope_patterns": ["src/user/**"],
                        "scope_excludes": [],
                        "worker_context": "保持用户模块知识",
                    },
                    {
                        "id": "source-remainder",
                        "responsibility": "负责其余源码",
                        "scope_patterns": ["src/**"],
                        "scope_excludes": ["src/user/**"],
                        "worker_context": "保持非用户源码知识",
                    },
                ],
                capsule_strategy="inherit_sources",
            )
            self.run_json("validate-change", registry_path, request_path, validation_path)
            validation = json.loads(validation_path.read_text(encoding="utf-8"))
            self.approve(request, validation_path, validation, approval_path)
            self.run_json(
                "apply-change", registry_path, request_path, validation_path, approval_path
            )
            self.assertEqual(
                self.run_json("route", registry_path, "src/user/model.ts")["owner_id"],
                "user-module-v2",
            )
            self.assertEqual(
                self.run_json("route", registry_path, "src/admin/model.ts")["owner_id"],
                "source-remainder",
            )

    def test_registry_rejects_unowned_managed_file(self) -> None:
        with self.workspace() as (root, registry_path, registry):
            target = root / "src/orphan.ts"
            target.write_text("orphan\n", encoding="utf-8")
            registry_path.write_text(serialized(registry), encoding="utf-8")
            result = self.run_cli("validate", registry_path)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("unowned", result.stderr)

    def test_current_change_facade_owns_paths_and_compacts_capsules(self) -> None:
        with self.workspace() as (root, registry_path, _):
            proposed = self.run_json(
                "propose",
                root,
                "create",
                "新增报表模块",
                "--owner",
                "report-module",
                "负责报表模块",
                "保持报表合同稳定",
                "--scope",
                "report-module",
                "src/report/**",
            )
            self.assertEqual(proposed["status"], "awaiting_user_approval")
            current = self.run_json("current", root)
            self.assertEqual(current["status"], "awaiting_user_approval")
            self.assertEqual(current["owner_ids"], ["report-module"])
            self.run_json("approve-current", root)
            applied = self.run_json("apply-current", root)
            self.assertEqual(applied["status"], "applied")
            self.run_json("validate", registry_path)
            for capsule_path in registry_path.parent.glob("*/capsule.json"):
                capsule = json.loads(capsule_path.read_text(encoding="utf-8"))
                self.assertNotIn("history", capsule)
                self.assertIn("current_change_digest", capsule)
            cleared = self.run_json("clear-current", root)
            self.assertTrue(cleared["existed"])
            self.assertEqual(self.run_json("current", root)["status"], "none")

    def test_published_drivers_exactly_match_built_typescript_source(self) -> None:
        source_path = ROOT / "tooling/owner-registry/owner-registry.ts"
        builder = """
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
const source = readFileSync(process.argv[1], "utf8");
const built = [
  "// Generated from tooling/owner-registry/owner-registry.ts. Do not edit directly.",
  stripTypeScriptTypes(source, { mode: "strip" }).replace(/[ \\t]+$/gm, ""),
].join("\\n");
process.stdout.write(built);
"""
        built = subprocess.run(
            ["node", "--input-type=module", "-e", builder, str(source_path)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(built.returncode, 0, built.stderr)
        for published in [SCRIPT, CLAUDE_SCRIPT]:
            self.assertEqual(built.stdout, published.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
