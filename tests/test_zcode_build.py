from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import tempfile
import unittest

from zcode_test_support import ROOT, load_agent_registry, snapshot_tree


REGISTRY_COMPILER = ROOT / "tooling/zcode-workflow/agent-registry.mjs"
REGISTRY_PATH = ROOT / "zcode-market/agent-registry.json"
BUILDER = ROOT / "tooling/zcode-workflow/build.mjs"
PUBLISHED_ROOT = ROOT / "zcode-market/plugins/ghost-agent-workflow/scripts"
GENERATED_REGISTRY = PUBLISHED_ROOT / "agent-registry.mjs"
DECLARED_ARTIFACTS = {
    "zcode-market/plugins/ghost-agent-workflow/scripts/agent-registry.mjs": 0o644,
    "zcode-market/plugins/ghost-agent-workflow/scripts/workflow-config.mjs": 0o755,
    "zcode-market/plugins/ghost-agent-workflow/scripts/start-dashboard.mjs": 0o755,
    "zcode-market/plugins/ghost-agent-workflow/scripts/dashboard-status.mjs": 0o755,
    "zcode-market/plugins/ghost-agent-workflow/scripts/stop-dashboard.mjs": 0o755,
    "zcode-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs": 0o644,
}


def run_compiler_json(
    source: str,
    *,
    input_value: object | None = None,
) -> tuple[subprocess.CompletedProcess[str], object | None]:
    script = f'import * as compiler from {json.dumps(REGISTRY_COMPILER.as_uri())};\n{source}'
    result = subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        input=None if input_value is None else json.dumps(input_value),
        capture_output=True,
        text=True,
        check=False,
    )
    payload = json.loads(result.stdout) if result.stdout.strip() else None
    return result, payload


class ZCodeBuildTests(unittest.TestCase):
    def test_snapshot_tree_records_relative_bytes_and_modes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "nested").mkdir()
            path = root / "nested/example.txt"
            path.write_bytes(b"example\n")

            snapshot = snapshot_tree(root)

            self.assertEqual(snapshot["nested/example.txt"][0], b"example\n")
            self.assertIsInstance(snapshot["nested/example.txt"][1], int)

    def test_zcode_builder_emits_declared_artifacts_only_below_zcode_market(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [
                    "node",
                    str(ROOT / "tooling/zcode-workflow/build.mjs"),
                    "--output-root",
                    directory,
                ],
                cwd=directory,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            emitted = snapshot_tree(Path(directory))
            self.assertEqual(set(emitted), set(DECLARED_ARTIFACTS))
            self.assertEqual(
                {path: mode for path, (_, mode) in emitted.items()},
                DECLARED_ARTIFACTS,
            )

    def test_zcode_builder_check_is_zero_write_and_reports_all_drift(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory)
            built = subprocess.run(
                ["node", str(BUILDER), "--output-root", directory],
                cwd=directory,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(built.returncode, 0, built.stderr)
            first = output_root / next(iter(DECLARED_ARTIFACTS))
            first.write_bytes(b"drifted\n")
            second_relative = list(DECLARED_ARTIFACTS)[1]
            second = output_root / second_relative
            second.unlink()
            before = snapshot_tree(output_root)

            checked = subprocess.run(
                [
                    "node",
                    str(BUILDER),
                    "--check",
                    "--output-root",
                    directory,
                ],
                cwd=directory,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertNotEqual(checked.returncode, 0)
            self.assertIn(first.relative_to(output_root).as_posix(), checked.stderr)
            self.assertIn(second_relative, checked.stderr)
            self.assertEqual(snapshot_tree(output_root), before)

    def test_zcode_builder_check_reports_directory_and_missing_targets_without_writes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory)
            built = subprocess.run(
                ["node", str(BUILDER), "--output-root", directory],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(built.returncode, 0, built.stderr)
            directory_relative = list(DECLARED_ARTIFACTS)[0]
            directory_target = output_root / directory_relative
            directory_target.unlink()
            directory_target.mkdir()
            (directory_target / "sentinel.txt").write_text("unchanged\n", encoding="utf-8")
            missing_relative = list(DECLARED_ARTIFACTS)[1]
            (output_root / missing_relative).unlink()
            before = snapshot_tree(output_root)

            checked = subprocess.run(
                ["node", str(BUILDER), "--check", "--output-root", directory],
                capture_output=True,
                text=True,
                check=False,
                timeout=5,
            )

            self.assertNotEqual(checked.returncode, 0)
            self.assertIn(f"drift: {directory_relative}", checked.stderr)
            self.assertIn(f"drift: {missing_relative}", checked.stderr)
            self.assertEqual(snapshot_tree(output_root), before)

    def test_zcode_builder_check_reports_socket_and_missing_targets_without_writes(self) -> None:
        if not hasattr(socket, "AF_UNIX"):
            self.skipTest("platform does not provide AF_UNIX sockets for special-file coverage")
        directory = tempfile.mkdtemp(prefix="zcb-", dir="/tmp")
        output_root = Path(directory)
        bound_socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            built = subprocess.run(
                ["node", str(BUILDER), "--output-root", directory],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(built.returncode, 0, built.stderr)
            socket_relative = list(DECLARED_ARTIFACTS)[2]
            socket_target = output_root / socket_relative
            socket_target.unlink()
            try:
                bound_socket.bind(str(socket_target))
            except OSError as error:
                self.skipTest(f"platform cannot bind an AF_UNIX socket at the artifact path: {error}")
            socket_before = os.lstat(socket_target)
            self.assertTrue(stat.S_ISSOCK(socket_before.st_mode))
            missing_relative = list(DECLARED_ARTIFACTS)[3]
            (output_root / missing_relative).unlink()
            before = snapshot_tree(output_root)

            try:
                checked = subprocess.run(
                    ["node", str(BUILDER), "--check", "--output-root", directory],
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=5,
                )
            except subprocess.TimeoutExpired:
                self.fail("--check blocked while inspecting a Unix-domain socket")

            self.assertNotEqual(checked.returncode, 0)
            self.assertIn(f"drift: {socket_relative}", checked.stderr)
            self.assertIn(f"drift: {missing_relative}", checked.stderr)
            socket_after = os.lstat(socket_target)
            self.assertTrue(stat.S_ISSOCK(socket_after.st_mode))
            self.assertEqual(socket_after.st_ino, socket_before.st_ino)
            self.assertEqual(snapshot_tree(output_root), before)
        finally:
            bound_socket.close()
            shutil.rmtree(directory, ignore_errors=True)

    def test_zcode_builder_check_rejects_intermediate_symlink_and_reports_all_targets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output_root = root / "output"
            outside_root = root / "outside"
            built = subprocess.run(
                ["node", str(BUILDER), "--output-root", str(outside_root)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(built.returncode, 0, built.stderr)
            output_root.mkdir()
            (output_root / "zcode-market").symlink_to(
                outside_root / "zcode-market",
                target_is_directory=True,
            )
            output_before = snapshot_tree(output_root)
            outside_before = snapshot_tree(outside_root)

            checked = subprocess.run(
                [
                    "node",
                    str(BUILDER),
                    "--check",
                    "--output-root",
                    str(output_root),
                ],
                capture_output=True,
                text=True,
                check=False,
                timeout=5,
            )

            self.assertNotEqual(checked.returncode, 0)
            for relative_path in DECLARED_ARTIFACTS:
                self.assertIn(f"drift: {relative_path}", checked.stderr)
            self.assertEqual(snapshot_tree(output_root), output_before)
            self.assertEqual(snapshot_tree(outside_root), outside_before)

    def test_zcode_builder_check_rejects_intermediate_non_directory_and_reports_all_targets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory)
            (output_root / "zcode-market").write_text("not a directory\n", encoding="utf-8")
            before = snapshot_tree(output_root)

            checked = subprocess.run(
                ["node", str(BUILDER), "--check", "--output-root", directory],
                capture_output=True,
                text=True,
                check=False,
                timeout=5,
            )

            self.assertNotEqual(checked.returncode, 0)
            for relative_path in DECLARED_ARTIFACTS:
                self.assertIn(f"drift: {relative_path}", checked.stderr)
            self.assertEqual(snapshot_tree(output_root), before)

    def test_zcode_builder_check_reports_full_mode_and_missing_target_without_writes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output_root = Path(directory)
            built = subprocess.run(
                ["node", str(BUILDER), "--output-root", directory],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(built.returncode, 0, built.stderr)
            mode_relative = list(DECLARED_ARTIFACTS)[0]
            mode_target = output_root / mode_relative
            os.chmod(mode_target, DECLARED_ARTIFACTS[mode_relative] | stat.S_ISUID)
            observed_mode = stat.S_IMODE(mode_target.stat().st_mode)
            if observed_mode != DECLARED_ARTIFACTS[mode_relative] | stat.S_ISUID:
                self.skipTest("filesystem does not retain the set-user-ID bit for full-mode coverage")
            missing_relative = list(DECLARED_ARTIFACTS)[4]
            (output_root / missing_relative).unlink()
            before = snapshot_tree(output_root)

            checked = subprocess.run(
                ["node", str(BUILDER), "--check", "--output-root", directory],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertNotEqual(checked.returncode, 0)
            self.assertIn(f"drift: {mode_relative}", checked.stderr)
            self.assertIn(f"drift: {missing_relative}", checked.stderr)
            self.assertEqual(snapshot_tree(output_root), before)

    def test_zcode_builder_requires_exact_lifecycle_import_removal(self) -> None:
        source_path = ROOT / "tooling/zcode-workflow/dashboard-status.mjs"
        original = source_path.read_text(encoding="utf-8")
        import_line = (
            'import {\n'
            '  dashboardDescriptorPath,\n'
            '  inspectProcessIdentity,\n'
            '  parseDashboardDescriptorV2,\n'
            '  processIdentityMatches,\n'
            '} from "./dashboard-lifecycle.mjs";\n'
        )
        self.assertEqual(original.count(import_line), 1)
        mutations = {
            "missing": original.replace(import_line, ""),
            "duplicate": original.replace(import_line, import_line * 2),
            "format_changed": original.replace(
                import_line,
                "import {dashboardDescriptorPath} from \"./dashboard-lifecycle.mjs\";\n",
            ),
        }
        try:
            for name, mutated in mutations.items():
                with self.subTest(mutation=name), tempfile.TemporaryDirectory() as directory:
                    source_path.write_text(mutated, encoding="utf-8")
                    result = subprocess.run(
                        ["node", str(BUILDER), "--output-root", directory],
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("expected exactly one lifecycle import", result.stderr)
                    self.assertEqual(snapshot_tree(Path(directory)), {})
        finally:
            source_path.write_text(original, encoding="utf-8")

    def test_zcode_builder_rejects_invalid_arguments(self) -> None:
        cases = [
            (["--unknown"], "unknown argument"),
            (["--check", "--check"], "duplicate argument"),
            (["--output-root"], "requires a path"),
            (["--output-root", "one", "--output-root", "two"], "duplicate argument"),
            (["--output-root", "--check"], "requires a path"),
        ]
        for arguments, expected in cases:
            with self.subTest(arguments=arguments):
                result = subprocess.run(
                    ["node", str(BUILDER), *arguments],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(result.returncode, 2)
                self.assertIn(expected, result.stderr)

    def test_zcode_builder_leaves_protected_platform_trees_unchanged(self) -> None:
        protected = ["claude-code-market", "codex-market", ".agents", ".codex"]
        before = {name: snapshot_tree(ROOT / name) for name in protected}
        result = subprocess.run(
            ["node", str(BUILDER)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        after = {name: snapshot_tree(ROOT / name) for name in protected}
        self.assertEqual(after, before)

    def test_bootstrap_dashboard_status_and_stop_parse_fully_and_do_not_write(self) -> None:
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as runtime_directory:
            workspace = Path(directory)
            environment = {
                **os.environ,
                "ZCODE_DASHBOARD_RUNTIME_DIRECTORY_TEST": str(Path(runtime_directory).resolve()),
            }
            for script_name, contract in [
                ("dashboard-status.mjs", "ZCODE_DASHBOARD_STATUS_RECEIPT_V1"),
                ("stop-dashboard.mjs", "ZCODE_DASHBOARD_STOP_RECEIPT_V1"),
            ]:
                with self.subTest(script=script_name):
                    before = snapshot_tree(workspace)
                    arguments = [
                        "node",
                        str(PUBLISHED_ROOT / script_name),
                        directory,
                        "--goal",
                        "goal-1",
                    ]
                    if script_name == "stop-dashboard.mjs":
                        arguments.extend([
                            "--descriptor-token",
                            "00000000-0000-4000-8000-000000000000",
                        ])
                    arguments.extend([
                        "--host",
                        "127.0.0.1",
                        "--port",
                        "57357",
                    ])
                    result = subprocess.run(
                        arguments,
                        capture_output=True,
                        text=True,
                        check=False,
                        env=environment,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(
                        json.loads(result.stdout),
                        {
                            "contract": contract,
                            "status": "not_found",
                            "workspace_root": str(workspace.resolve()),
                            "goal_id": "goal-1",
                            "host": "127.0.0.1",
                            "port": 57357,
                        },
                    )
                    self.assertEqual(snapshot_tree(workspace), before)
                    rejected = subprocess.run(
                        [
                            "node",
                            str(PUBLISHED_ROOT / script_name),
                            directory,
                            "--goal",
                            "goal-1",
                            "--unknown",
                        ],
                        capture_output=True,
                        text=True,
                        check=False,
                        env=environment,
                    )
                    self.assertNotEqual(rejected.returncode, 0)
                    self.assertIn("unknown option", rejected.stderr)
                    self.assertEqual(snapshot_tree(workspace), before)

    def test_generated_headers_name_exact_canonical_sources_and_bundle_lifecycle(self) -> None:
        expected_headers = {
            "agent-registry.mjs": [
                "tooling/zcode-workflow/agent-registry.mjs",
                "zcode-market/agent-registry.json",
            ],
            "workflow-config.mjs": ["tooling/zcode-workflow/workflow-config.mjs"],
            "start-dashboard.mjs": [
                "tooling/zcode-workflow/dashboard-lifecycle.mjs",
                "tooling/zcode-workflow/start-dashboard.mjs",
            ],
            "dashboard-status.mjs": [
                "tooling/zcode-workflow/dashboard-lifecycle.mjs",
                "tooling/zcode-workflow/dashboard-status.mjs",
            ],
            "stop-dashboard.mjs": [
                "tooling/zcode-workflow/dashboard-lifecycle.mjs",
                "tooling/zcode-workflow/stop-dashboard.mjs",
            ],
            "goal-dag.mjs": ["tooling/zcode-workflow/goal-dag.ts"],
        }
        for name, sources in expected_headers.items():
            with self.subTest(artifact=name):
                lines = (PUBLISHED_ROOT / name).read_text(encoding="utf-8").splitlines()
                header_line = lines[1] if lines[0].startswith("#!") else lines[0]
                for source in sources:
                    self.assertIn(source, header_line)
        for name in ("start-dashboard.mjs", "dashboard-status.mjs", "stop-dashboard.mjs"):
            content = (PUBLISHED_ROOT / name).read_text(encoding="utf-8")
            self.assertNotIn('from "./dashboard-lifecycle.mjs"', content)

    def test_generated_registry_equals_normalized_source_with_exact_metadata(self) -> None:
        source = f"""
import * as generated from {json.dumps(GENERATED_REGISTRY.as_uri())};
const loaded = compiler.loadAgentRegistry({json.dumps(str(REGISTRY_PATH))});
process.stdout.write(JSON.stringify({{
  actual: generated.ZCODE_AGENT_REGISTRY,
  expected: compiler.normalizeAgentRegistry(
    compiler.parseAgentRegistry(JSON.parse(loaded.raw.toString('utf8')))
  ),
  actualContract: generated.ZCODE_AGENT_BUNDLE_CONTRACT,
  expectedContract: loaded.registry.contract,
  actualVersion: generated.ZCODE_AGENT_BUNDLE_VERSION,
  expectedVersion: loaded.registry.bundle_version,
  actualDigest: generated.ZCODE_AGENT_BUNDLE_DIGEST,
  expectedDigest: compiler.registryDigest(loaded.raw),
}}));
"""
        result, payload = run_compiler_json(source)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertEqual(payload["actual"], payload["expected"])
        self.assertEqual(payload["actualContract"], payload["expectedContract"])
        self.assertEqual(payload["actualVersion"], payload["expectedVersion"])
        self.assertEqual(payload["actualDigest"], payload["expectedDigest"])
        self.assertEqual(
            payload["actualDigest"],
            f"sha256:{hashlib.sha256(REGISTRY_PATH.read_bytes()).hexdigest()}",
        )

    def test_compiler_exports_load_and_raw_byte_digest(self) -> None:
        source = f"""
const loaded = compiler.loadAgentRegistry({json.dumps(str(REGISTRY_PATH))});
const first = Buffer.from('{{"value":1}}\\n', 'utf8');
const second = Buffer.from('{{"value":1}}', 'utf8');
process.stdout.write(JSON.stringify({{
  exports: Object.keys(compiler).sort(),
  loadedDigest: compiler.registryDigest(loaded.raw),
  contract: loaded.registry.contract,
  firstDigest: compiler.registryDigest(first),
  secondDigest: compiler.registryDigest(second),
}}));
"""
        result, payload = run_compiler_json(source)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            payload["exports"],
            [
                "loadAgentRegistry",
                "normalizeAgentRegistry",
                "parseAgentRegistry",
                "registryDigest",
                "renderAgentRegistryModule",
            ],
        )
        raw = REGISTRY_PATH.read_bytes()
        self.assertEqual(
            payload["loadedDigest"], f"sha256:{hashlib.sha256(raw).hexdigest()}"
        )
        self.assertEqual(payload["contract"], "ZCODE_AGENT_BUNDLE_V2")
        first_bytes = b'{"value":1}\n'
        second_bytes = b'{"value":1}'
        self.assertEqual(
            payload["firstDigest"],
            f"sha256:{hashlib.sha256(first_bytes).hexdigest()}",
        )
        self.assertEqual(
            payload["secondDigest"],
            f"sha256:{hashlib.sha256(second_bytes).hexdigest()}",
        )
        self.assertNotEqual(payload["firstDigest"], payload["secondDigest"])

    def test_normalization_is_deterministic_preserves_contract_arrays_and_input(self) -> None:
        registry = load_agent_registry()
        shuffled = copy.deepcopy(registry)
        shuffled["skills"].reverse()
        shuffled["agents"].reverse()
        shuffled["legacy_agents"].reverse()
        source = """
const input = JSON.parse(await new Response(process.stdin).text());
const left = compiler.parseAgentRegistry(input.left);
const right = compiler.parseAgentRegistry(input.right);
const beforeLeft = structuredClone(left);
const beforeRight = structuredClone(right);
const normalizedLeft = compiler.normalizeAgentRegistry(left);
const normalizedRight = compiler.normalizeAgentRegistry(right);
const digest = 'sha256:' + '0'.repeat(64);
process.stdout.write(JSON.stringify({
  left,
  right,
  beforeLeft,
  beforeRight,
  normalizedLeft,
  normalizedRight,
  renderedEqual:
    compiler.renderAgentRegistryModule(left, digest) ===
    compiler.renderAgentRegistryModule(right, digest),
}));
"""
        payload_input = {"left": shuffled, "right": registry}
        result, payload = run_compiler_json(source, input_value=payload_input)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(payload["left"], payload["beforeLeft"])
        self.assertEqual(payload["right"], payload["beforeRight"])
        self.assertEqual(payload["normalizedLeft"], payload["normalizedRight"])
        self.assertIs(payload["renderedEqual"], True)
        normalized = payload["normalizedLeft"]
        self.assertEqual(
            [entry["id"] for entry in normalized["skills"]],
            sorted(entry["id"] for entry in registry["skills"]),
        )
        self.assertEqual(
            [entry["id"] for entry in normalized["agents"]],
            sorted(entry["id"] for entry in registry["agents"]),
        )
        self.assertEqual(
            [entry["id"] for entry in normalized["legacy_agents"]],
            sorted(entry["id"] for entry in registry["legacy_agents"]),
        )
        original_skills = {entry["id"]: entry for entry in registry["skills"]}
        original_agents = {entry["id"]: entry for entry in registry["agents"]}
        original_legacy = {entry["id"]: entry for entry in registry["legacy_agents"]}
        for skill in normalized["skills"]:
            self.assertEqual(skill["operations"], original_skills[skill["id"]]["operations"])
            self.assertEqual(skill["consumers"], original_skills[skill["id"]]["consumers"])
        for agent in normalized["agents"]:
            self.assertEqual(agent["operations"], original_agents[agent["id"]]["operations"])
        for legacy in normalized["legacy_agents"]:
            self.assertEqual(
                legacy["replacements"], original_legacy[legacy["id"]]["replacements"]
            )
        self.assertEqual(payload_input["left"], shuffled)
        self.assertEqual(payload_input["right"], registry)

    def test_parse_registry_rejects_strict_shape_and_semantic_violations(self) -> None:
        registry = load_agent_registry()
        cases: list[dict[str, object]] = []

        def reject(name: str, mutation, expected: str) -> None:
            value = copy.deepcopy(registry)
            mutation(value)
            cases.append({"name": name, "value": value, "expected": expected})

        reject(
            "top-level extra key",
            lambda value: value.__setitem__("extra", True),
            "agent registry",
        )
        reject(
            "skill extra key",
            lambda value: value["skills"][0].__setitem__("extra", True),
            "skill ghost-agent-workflow:workflow-coordination",
        )
        reject(
            "agent extra key",
            lambda value: value["agents"][0].__setitem__("extra", True),
            "agent workflow-planner",
        )
        reject(
            "metadata extra key",
            lambda value: value["agents"][0]["metadata_policy"].__setitem__(
                "extra", True
            ),
            "agent workflow-planner.metadata_policy",
        )
        reject(
            "legacy extra key",
            lambda value: value["legacy_agents"][0].__setitem__("extra", True),
            "legacy agent parallel-task-planner",
        )
        for field, replacement in [
            ("$schema", "wrong-schema.json"),
            ("contract", "ZCODE_AGENT_BUNDLE_V1"),
            ("bundle_version", "1.0.0"),
            ("source_repository", "example/other"),
            ("template_root", "templates"),
        ]:
            reject(
                f"top-level constant {field}",
                lambda value, field=field, replacement=replacement: value.__setitem__(
                    field, replacement
                ),
                f"agent registry.{field}",
            )
        reject(
            "allowed metadata",
            lambda value: value.__setitem__("allowed_custom_metadata", ["color", "model"]),
            "agent registry.allowed_custom_metadata",
        )
        reject(
            "skill count",
            lambda value: value["skills"].pop(),
            "agent registry.skills",
        )
        reject(
            "agent count",
            lambda value: value["agents"].pop(),
            "agent registry.agents",
        )
        reject(
            "legacy count",
            lambda value: value["legacy_agents"].pop(),
            "agent registry.legacy_agents",
        )
        reject(
            "duplicate skill id",
            lambda value: value["skills"][1].__setitem__(
                "id", value["skills"][0]["id"]
            ),
            "agent registry.skills",
        )
        reject(
            "duplicate agent id",
            lambda value: value["agents"][1].__setitem__(
                "id", value["agents"][0]["id"]
            ),
            "agent registry.agents",
        )
        reject(
            "duplicate legacy id",
            lambda value: value["legacy_agents"][1].__setitem__(
                "id", value["legacy_agents"][0]["id"]
            ),
            "agent registry.legacy_agents",
        )
        reject(
            "unknown agent inventory",
            lambda value: value["agents"][0].__setitem__("id", "unknown-agent"),
            "agent unknown-agent.id",
        )
        reject(
            "skill plugin relationship",
            lambda value: value["skills"][1].__setitem__(
                "plugin", "ghost-agent-skills"
            ),
            "skill ghost-agent-workflow:workflow-planning.plugin",
        )
        reject(
            "skill path relationship",
            lambda value: value["skills"][1].__setitem__("path", "skills/other"),
            "skill ghost-agent-workflow:workflow-planning.path",
        )
        reject(
            "agent plugin relationship",
            lambda value: value["agents"][0].__setitem__(
                "plugin", "ghost-agent-skills"
            ),
            "agent workflow-planner.plugin",
        )
        reject(
            "agent template relationship",
            lambda value: value["agents"][0].__setitem__(
                "template", "ghost-agent-workflow/other.md"
            ),
            "agent workflow-planner.template",
        )
        reject(
            "unknown skill reference",
            lambda value: value["agents"][0].__setitem__(
                "skill", "ghost-agent-workflow:missing"
            ),
            "agent workflow-planner.skill",
        )
        reject(
            "unknown consumer reference",
            lambda value: value["skills"][1]["consumers"].__setitem__(
                0, "missing-agent"
            ),
            "skill ghost-agent-workflow:workflow-planning.consumers[0]",
        )
        reject(
            "unknown operation",
            lambda value: value["agents"][0]["operations"].__setitem__(
                0, "unknown_operation"
            ),
            "agent workflow-planner.operations[0]",
        )
        reject(
            "unauthorized operation",
            lambda value: value["agents"][0]["operations"].__setitem__(
                0, "show_strict"
            ),
            "agent workflow-planner.operations[0]",
        )
        reject(
            "duplicate operation",
            lambda value: value["agents"][2]["operations"].__setitem__(
                1, "execute_owner_run"
            ),
            "agent workflow-owner.operations",
        )
        reject(
            "non-reciprocal consumers",
            lambda value: value["skills"][1].__setitem__("consumers", []),
            "skill ghost-agent-workflow:workflow-planning.consumers",
        )
        reject(
            "permission consistency",
            lambda value: value["agents"][0].__setitem__(
                "permission_class", "plan_review"
            ),
            "agent workflow-planner.permission_class",
        )
        reject(
            "execution class consistency",
            lambda value: value["agents"][0].__setitem__("execution_class", "lite"),
            "agent workflow-planner.execution_class",
        )
        reject(
            "execution config key consistency",
            lambda value: value["agents"][0].__setitem__(
                "execution_class_config_key", "owner"
            ),
            "agent workflow-planner.execution_class_config_key",
        )
        reject(
            "duplicate template",
            lambda value: value["agents"][1].__setitem__(
                "template", value["agents"][0]["template"]
            ),
            "agent workflow-plan-reviewer.template",
        )
        reject(
            "template sha format",
            lambda value: value["agents"][0].__setitem__(
                "template_sha256", "sha256:ABC"
            ),
            "agent workflow-planner.template_sha256",
        )
        reject(
            "metadata model policy",
            lambda value: value["agents"][0]["metadata_policy"].__setitem__(
                "model", "always_global"
            ),
            "agent workflow-planner.metadata_policy.model",
        )
        reject(
            "metadata color policy",
            lambda value: value["agents"][0]["metadata_policy"].__setitem__(
                "color", "replace"
            ),
            "agent workflow-planner.metadata_policy.color",
        )
        reject(
            "unknown legacy replacement",
            lambda value: value["legacy_agents"][0]["replacements"].__setitem__(
                0, "missing-agent"
            ),
            "legacy agent parallel-task-planner.replacements[0]",
        )
        reject(
            "inexact legacy replacement",
            lambda value: value["legacy_agents"][0]["replacements"].__setitem__(
                0, "workflow-owner"
            ),
            "legacy agent parallel-task-planner.replacements",
        )
        reject(
            "inexact legacy removal policy",
            lambda value: value["legacy_agents"][0].__setitem__("remove", False),
            "legacy agent parallel-task-planner.remove",
        )

        source = """
const input = JSON.parse(await new Response(process.stdin).text());
const results = input.map((testCase) => {
  try {
    compiler.parseAgentRegistry(testCase.value);
    return {name: testCase.name, error: null};
  } catch (error) {
    return {name: testCase.name, error: String(error.message)};
  }
});
process.stdout.write(JSON.stringify(results));
"""
        result, payload = run_compiler_json(source, input_value=cases)

        self.assertEqual(result.returncode, 0, result.stderr)
        expected_by_name = {case["name"]: case["expected"] for case in cases}
        for actual in payload:
            with self.subTest(case=actual["name"]):
                self.assertIsNotNone(actual["error"], "invalid registry was accepted")
                self.assertIn(expected_by_name[actual["name"]], actual["error"])

    def test_generated_registry_helpers_and_nested_values_are_immutable(self) -> None:
        printed = subprocess.run(
            ["node", str(REGISTRY_COMPILER), "--print"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(printed.returncode, 0, printed.stderr)
        with tempfile.TemporaryDirectory() as directory:
            module_path = Path(directory) / "agent-registry.mjs"
            module_path.write_text(printed.stdout, encoding="utf-8")
            source = f"""
import * as generated from {json.dumps(module_path.as_uri())};
function captureError(action) {{
  try {{ action(); return null; }} catch (error) {{ return error.message; }}
}}
function mutationRejected(action) {{
  try {{ action(); return false; }} catch {{ return true; }}
}}
function deeplyFrozen(value) {{
  if (value === null || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(deeplyFrozen);
}}
const owner = generated.agentForOperation('workflow-owner', 'execute_owner_run');
const authorized = generated.assertAgentPermission(
  'workflow-owner', 'repair_owner_run', 'workspace_write'
);
const config = {{execution_classes: {{planner: 'planner-runtime'}}}};
const beforeOperation = owner.operations[0];
const beforeModel = owner.metadata_policy.model;
const mutationErrors = [
  mutationRejected(() => generated.ZCODE_AGENT_REGISTRY.agents.push({{}})),
  mutationRejected(() => {{ owner.operations[0] = 'changed'; }}),
  mutationRejected(() => {{ owner.metadata_policy.model = 'changed'; }}),
  mutationRejected(() => generated.ZCODE_AGENT_REGISTRY.legacy_agents[0].replacements.push('changed')),
];
process.stdout.write(JSON.stringify({{
  exports: Object.keys(generated).sort(),
  owner: owner.id,
  authorized: authorized.id,
  plannerClass: generated.resolveExecutionClass('workflow-planner', config),
  utilityClass: generated.resolveExecutionClass('workflow-config-reader', config),
  missingClass: generated.resolveExecutionClass('missing-agent', config),
  unauthorized: captureError(() => generated.agentForOperation('workflow-owner', 'initial_plan')),
  missingAgent: captureError(() => generated.agentForOperation('missing-agent', 'initial_plan')),
  permissionMismatch: captureError(() => generated.assertAgentPermission(
    'workflow-owner', 'execute_owner_run', 'workspace_review'
  )),
  deeplyFrozen: deeplyFrozen(generated.ZCODE_AGENT_REGISTRY),
  mutationErrors,
  operationUnchanged: owner.operations[0] === beforeOperation,
  modelUnchanged: owner.metadata_policy.model === beforeModel,
}}));
"""
            result = subprocess.run(
                ["node", "--input-type=module", "--eval", source],
                capture_output=True,
                text=True,
                check=False,
            )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(
            payload["exports"],
            [
                "ZCODE_AGENT_BUNDLE_CONTRACT",
                "ZCODE_AGENT_BUNDLE_DIGEST",
                "ZCODE_AGENT_BUNDLE_VERSION",
                "ZCODE_AGENT_REGISTRY",
                "agentForOperation",
                "assertAgentPermission",
                "resolveExecutionClass",
            ],
        )
        self.assertEqual(payload["owner"], "workflow-owner")
        self.assertEqual(payload["authorized"], "workflow-owner")
        self.assertEqual(payload["plannerClass"], "planner-runtime")
        self.assertIsNone(payload["utilityClass"])
        self.assertIsNone(payload["missingClass"])
        self.assertEqual(
            payload["unauthorized"],
            "agent workflow-owner is not authorized for initial_plan",
        )
        self.assertEqual(
            payload["missingAgent"],
            "agent missing-agent is not authorized for initial_plan",
        )
        self.assertEqual(
            payload["permissionMismatch"],
            "permission mismatch for workflow-owner/execute_owner_run",
        )
        self.assertIs(payload["deeplyFrozen"], True)
        self.assertEqual(payload["mutationErrors"], [True, True, True, True])
        self.assertIs(payload["operationUnchanged"], True)
        self.assertIs(payload["modelUnchanged"], True)


if __name__ == "__main__":
    unittest.main()
