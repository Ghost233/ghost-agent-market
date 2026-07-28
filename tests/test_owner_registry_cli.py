from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "codex-market/plugins/ghost-agent-workflow/scripts/owner-registry.mjs"
CLAUDE_SCRIPT = ROOT / "claude-code-market/scripts/owner-registry.mjs"
KIMI_SCRIPT = ROOT / "kimi-market/plugins/ghost-agent-workflow/scripts/owner-registry.mjs"


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
                "contract": "OWNER_REGISTRY_V2",
                "workspace_root": str(root),
                "revision": 1,
                "matcher": "owner-path-expression-v2",
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
            "responsibility": f"负责 {owner_id}",
            "scope_patterns": patterns,
            "scope_excludes": [],
            "worker_context": f"保持 {owner_id} 模块知识",
            "lineage": {
                "parent_owner_ids": [] if parent is None else [parent],
                "created_by_request_digest": "bootstrap",
            },
        }

    def capsule(self, owner: dict, revision: int) -> dict:
        return {
            "contract": "OWNER_CAPSULE_V2",
            "owner_id": owner["id"],
            "generation": 1,
            "registry_revision": revision,
            "scope_patterns": owner["scope_patterns"],
            "scope_excludes": owner["scope_excludes"],
            "responsibility": owner["responsibility"],
            "worker_context": owner["worker_context"],
            "inherited_from": [],
            "decisions": [f"{owner['id']} decision"],
            "invariants": [f"{owner['id']} invariant"],
            "risks": [],
            "important_symbols": [],
            "next_steps": [],
            "history": [],
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
            "contract": "OWNER_CHANGE_REQUEST_V2",
            "request_id": "owner-change-1",
            "operation": "create",
            "base_registry_digest": digest_json(registry),
            "created_at": "2026-07-27T01:00:00.000Z",
            "reason": "新增报表模块",
            "source_owner_ids": [],
            "new_owners": [
                {
                    "id": "report-module",
                    "responsibility": "负责报表模块",
                    "scope_patterns": ["src/report/**"],
                    "worker_context": "保持报表合同稳定",
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
        path.write_text(serialized(request), encoding="utf-8")
        return request

    def approve(self, request: dict, validation_path: Path, validation: dict, path: Path) -> None:
        approval = {
            "contract": "OWNER_CHANGE_APPROVAL_V2",
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

    def test_init_requires_an_approved_covering_create_request(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q", root], check=True)
            (root / "README.md").write_text("bootstrap\n", encoding="utf-8")
            subprocess.run(["git", "-C", root, "add", "README.md"], check=True)
            initialized = self.run_json("init", root)
            self.assertEqual(initialized["status"], "pending_owner_approval")
            registry_path = Path(initialized["registry_ref"])
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
            self.assertIn("owner scope conflict", result.stderr)

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
                "contract": "OWNER_CHANGE_APPROVAL_V2",
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
            self.assertEqual(request["contract"], "OWNER_CHANGE_REQUEST_V2")
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
        for published in [SCRIPT, CLAUDE_SCRIPT, KIMI_SCRIPT]:
            self.assertEqual(built.stdout, published.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
