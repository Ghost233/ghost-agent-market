# ZCode Registry and Reproducible Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one canonical ZCode Agent Registry and a reproducible ZCode-only build lane that cannot modify Claude Code or Codex artifacts.

**Architecture:** A checked-in Registry defines all Agents, Skills, Operations, permissions, execution classes, templates, and legacy replacements. A dedicated builder validates the Registry, generates a normalized runtime module, and compiles only ZCode source files into the ZCode workflow plugin.

**Tech Stack:** JSON Schema Draft 2020-12, Node.js 22 ESM, Python 3.11 `unittest`, `stripTypeScriptTypes`.

## Global Constraints

- Inherit every constraint from `docs/superpowers/plans/2026-08-02-zcode-stateless-agent-workflow-master.md`.
- This plan does not implement workflow scheduling yet; it fixes the canonical inventory and build boundary.
- Do not delete old Skills/Templates until Plan 04 installs their replacements into the new Registry-owned bundle.
- Do not alter shared `tooling/goal-dag/build.mjs` outputs.

---

### Task 1: Add shared ZCode test support

**Files:**
- Create: `tests/zcode_test_support.py`
- Test: `tests/test_zcode_build.py`

**Interfaces:**
- Consumes: repository root and Python standard library only.
- Produces:
  - `ROOT: Path`
  - `run_json_cli(argv: list[str], *, stdin: dict | None = None) -> tuple[subprocess.CompletedProcess[str], dict | None]`
  - `snapshot_tree(root: Path) -> dict[str, tuple[bytes, int]]`
  - `sha256_bytes(value: bytes) -> str`
  - `load_agent_registry() -> dict`
  - `assert_zero_write(testcase, before, after) -> None`

- [ ] **Step 1: Write the failing helper smoke test**

Create `tests/test_zcode_build.py`:

```python
from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from zcode_test_support import snapshot_tree


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


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test and verify the import fails**

Run:

```bash
python3 -m unittest tests.test_zcode_build.ZCodeBuildTests.test_snapshot_tree_records_relative_bytes_and_modes -v
```

Expected: `ModuleNotFoundError` for `zcode_test_support`.

- [ ] **Step 3: Implement focused reusable helpers**

Create `tests/zcode_test_support.py`:

```python
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
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
python3 -m unittest tests.test_zcode_build.ZCodeBuildTests.test_snapshot_tree_records_relative_bytes_and_modes -v
```

Expected: PASS.

- [ ] **Step 5: Record the logical commit boundary**

Do not commit without explicit user authorization. Logical message: `test(zcode): add shared workflow test support`.

---

### Task 2: Define the Agent Registry schema and canonical inventory

**Files:**
- Create: `zcode-market/agent-registry.schema.json`
- Create: `zcode-market/agent-registry.json`
- Create the nine workflow templates under `zcode-market/agent-templates/ghost-agent-workflow/`:
  - `workflow-planner.md`
  - `workflow-plan-reviewer.md`
  - `workflow-owner.md`
  - `workflow-implementation-reviewer.md`
  - `workflow-config-reader.md`
  - `workflow-config-writer.md`
  - `workflow-dashboard-starter.md`
  - `workflow-dashboard-status-reader.md`
  - `workflow-dashboard-stopper.md`
- Modify: `zcode-market/agent-templates/ghost-agent-skills/git-commit.md`
- Modify: `zcode-market/agent-templates/ghost-agent-skills/git-merge-conflict.md`
- Create: `tests/test_zcode_agent_registry.py`

**Interfaces:**
- Consumes: locked Agents, Skills, Operations and legacy mappings from the master plan.
- Produces: `ZCODE_AGENT_BUNDLE_V2` bundle version `2.0.0` with exactly 11 Agents and 8 Skills.

- [ ] **Step 1: Write failing Registry contract tests**

Create `tests/test_zcode_agent_registry.py` with the canonical set assertions:

```python
from __future__ import annotations

import unittest

from zcode_test_support import load_agent_registry


EXPECTED_AGENTS = {
    "workflow-planner",
    "workflow-plan-reviewer",
    "workflow-owner",
    "workflow-implementation-reviewer",
    "workflow-config-reader",
    "workflow-config-writer",
    "workflow-dashboard-starter",
    "workflow-dashboard-status-reader",
    "workflow-dashboard-stopper",
    "git-commit",
    "git-merge-conflict",
}

EXPECTED_SKILLS = {
    "ghost-agent-workflow:workflow-coordination",
    "ghost-agent-workflow:workflow-planning",
    "ghost-agent-workflow:workflow-plan-review",
    "ghost-agent-workflow:workflow-bound-run",
    "ghost-agent-workflow:workflow-config",
    "ghost-agent-workflow:workflow-dashboard",
    "ghost-agent-skills:git-commit",
    "ghost-agent-skills:git-merge-conflict",
}


class ZCodeAgentRegistryTests(unittest.TestCase):
    def test_registry_contract_and_bundle_version_are_v2(self) -> None:
        registry = load_agent_registry()
        self.assertEqual(registry["contract"], "ZCODE_AGENT_BUNDLE_V2")
        self.assertEqual(registry["bundle_version"], "2.0.0")

    def test_registry_contains_exactly_eleven_agents_and_eight_skills(self) -> None:
        registry = load_agent_registry()
        self.assertEqual({item["id"] for item in registry["agents"]}, EXPECTED_AGENTS)
        self.assertEqual({item["id"] for item in registry["skills"]}, EXPECTED_SKILLS)

    def test_registry_has_no_main_or_supervisor_agent(self) -> None:
        agent_ids = {item["id"] for item in load_agent_registry()["agents"]}
        self.assertFalse(any("main" in value for value in agent_ids))
        self.assertFalse(any("supervisor" in value for value in agent_ids))
```

- [ ] **Step 2: Run tests and observe missing Registry**

Run:

```bash
python3 -m unittest tests.test_zcode_agent_registry -v
```

Expected: errors because `zcode-market/agent-registry.json` does not exist.

- [ ] **Step 3: Create the strict JSON Schema**

Create `zcode-market/agent-registry.schema.json` using Draft 2020-12. Require exact top-level fields:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://github.com/Ghost233/ghost-agent-market/zcode-market/agent-registry.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "$schema",
    "contract",
    "bundle_version",
    "source_repository",
    "template_root",
    "allowed_custom_metadata",
    "skills",
    "agents",
    "legacy_agents"
  ],
  "properties": {
    "$schema": {"const": "./agent-registry.schema.json"},
    "contract": {"const": "ZCODE_AGENT_BUNDLE_V2"},
    "bundle_version": {"const": "2.0.0"},
    "source_repository": {"const": "Ghost233/ghost-agent-market"},
    "template_root": {"const": "zcode-market/agent-templates"},
    "allowed_custom_metadata": {
      "const": ["model", "color"]
    },
    "skills": {"type": "array", "minItems": 8, "maxItems": 8},
    "agents": {"type": "array", "minItems": 11, "maxItems": 11},
    "legacy_agents": {"type": "array", "minItems": 8, "maxItems": 8}
  }
}
```

Extend `$defs` so every nested object uses `additionalProperties: false`, Agent template hashes match `^sha256:[0-9a-f]{64}$`, IDs match `^[a-z0-9][a-z0-9._-]*$`, and execution classes are `main|lite|null`.

- [ ] **Step 4: Create minimal canonical template bytes for Registry hashing**

Create all 11 canonical template files now so the Registry never contains dummy hashes. Use this exact base form for each workflow template, substituting its canonical `name`, description, fixed Skill ID, allowed Operations and permission boundary:

```markdown
---
name: workflow-owner
description: 执行 Runtime Binding 明确授权的一个 Quick 或 DAG Owner action。
model: inherit
---

# Workflow Owner Agent

先加载 `$workflow-bound-run`；加载失败就停止并说明原因。

只接受 Registry 授权的 `execute_owner_run` 或 `repair_owner_run`。先执行 Runtime 提供的 `action open`，核对 Agent ID、Operation、permission class、revision、token、digest、workspace 与 writable scope；任一不匹配立即停止。

一次调用只执行一个 Binding 并通过 Runtime 提交一个 Result。不得创建、调用、等待或通知其他 Agent，不得执行 Git/worktree/commit/merge 操作。
```

For the two retained Git templates, preserve their existing safety body, add `model: inherit`, and state their single Registry operation. Plan 04 will refine wording together with the shared Skills, but it must not change these files without recomputing Registry hashes.

- [ ] **Step 5: Create the canonical Registry**

Create `zcode-market/agent-registry.json` with the exact inventory from the master plan. Compute every `template_sha256` from the exact canonical bytes created in Step 4. Include exact legacy mappings:

```json
[
  {"id":"parallel-task-planner","replacements":["workflow-planner"],"remove":true},
  {"id":"planner-reviewer","replacements":["workflow-plan-reviewer"],"remove":true},
  {"id":"sub-thread-goal-worker","replacements":["workflow-owner","workflow-implementation-reviewer"],"remove":true},
  {"id":"sub-thread-coordination","replacements":[],"remove":true},
  {"id":"setup-sub-thread-workflow","replacements":["workflow-config-reader","workflow-config-writer"],"remove":true},
  {"id":"start-dag-dashboard","replacements":["workflow-dashboard-starter","workflow-dashboard-status-reader","workflow-dashboard-stopper"],"remove":true},
  {"id":"git-commit","replacements":["git-commit"],"remove":false},
  {"id":"git-merge-conflict","replacements":["git-merge-conflict"],"remove":false}
]
```

- [ ] **Step 6: Add cross-record Registry validation tests**

Extend `tests/test_zcode_agent_registry.py` with:

```python
    def test_every_agent_operation_is_authorized_by_its_skill(self) -> None:
        registry = load_agent_registry()
        skills = {item["id"]: set(item["operations"]) for item in registry["skills"]}
        for agent in registry["agents"]:
            self.assertLessEqual(set(agent["operations"]), skills[agent["skill"]])

    def test_review_agents_have_no_workspace_write_permission(self) -> None:
        agents = {item["id"]: item for item in load_agent_registry()["agents"]}
        self.assertNotEqual(
            agents["workflow-plan-reviewer"]["permission_class"],
            "workspace_write",
        )
        self.assertNotEqual(
            agents["workflow-implementation-reviewer"]["permission_class"],
            "workspace_write",
        )

    def test_legacy_mapping_is_complete_and_exact(self) -> None:
        legacy = {item["id"]: item for item in load_agent_registry()["legacy_agents"]}
        self.assertEqual(
            legacy["sub-thread-goal-worker"]["replacements"],
            ["workflow-owner", "workflow-implementation-reviewer"],
        )
        self.assertEqual(legacy["sub-thread-coordination"]["replacements"], [])
```

- [ ] **Step 7: Run Registry tests**

Run:

```bash
python3 -m unittest tests.test_zcode_agent_registry -v
python3 -m json.tool zcode-market/agent-registry.json >/dev/null
python3 -m json.tool zcode-market/agent-registry.schema.json >/dev/null
```

Expected: PASS.

- [ ] **Step 8: Record the logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): define canonical agent registry`.

---

### Task 3: Implement Registry normalization and generation

**Files:**
- Create: `tooling/zcode-workflow/agent-registry.mjs`
- Create: `tests/test_zcode_build.py` additions

**Interfaces:**
- Consumes: `zcode-market/agent-registry.json`.
- Produces:
  - `parseAgentRegistry(value)`
  - `loadAgentRegistry(path)`
  - `normalizeAgentRegistry(registry)`
  - `registryDigest(rawBytes)`
  - `renderAgentRegistryModule(registry, digest)`

- [ ] **Step 1: Add failing normalization tests**

Extend `tests/test_zcode_build.py`:

```python
    def test_generated_registry_module_exports_contract_version_and_digest(self) -> None:
        result = subprocess.run(
            ["node", str(ROOT / "tooling/zcode-workflow/agent-registry.mjs"), "--print"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('ZCODE_AGENT_BUNDLE_CONTRACT = "ZCODE_AGENT_BUNDLE_V2"', result.stdout)
        self.assertIn('ZCODE_AGENT_BUNDLE_VERSION = "2.0.0"', result.stdout)
        self.assertRegex(result.stdout, r'ZCODE_AGENT_BUNDLE_DIGEST = "sha256:[0-9a-f]{64}"')
```

- [ ] **Step 2: Run the test and verify the script is missing**

Run:

```bash
python3 -m unittest tests.test_zcode_build.ZCodeBuildTests.test_generated_registry_module_exports_contract_version_and_digest -v
```

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement strict Registry normalization**

Create `tooling/zcode-workflow/agent-registry.mjs`. Use exact-key checks and cross-record validation rather than adding a runtime dependency. Export:

```javascript
export function parseAgentRegistry(value) {
  const source = requireRecord(value, "agent registry");
  requireExactKeys(source, [
    "$schema", "contract", "bundle_version", "source_repository",
    "template_root", "allowed_custom_metadata", "skills", "agents",
    "legacy_agents",
  ], "agent registry");
  // Parse every nested record with exact-key checks, then call
  // validateAgentRegistry() for uniqueness, authorization and legacy rules.
  return validateAgentRegistry(parsedRegistry);
}

export function loadAgentRegistry(path) {
  const raw = readFileSync(path);
  return { raw, registry: parseAgentRegistry(JSON.parse(raw.toString("utf8"))) };
}

export function normalizeAgentRegistry(registry) {
  return {
    ...registry,
    skills: [...registry.skills].sort((a, b) => a.id.localeCompare(b.id)),
    agents: [...registry.agents].sort((a, b) => a.id.localeCompare(b.id)),
    legacy_agents: [...registry.legacy_agents].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function registryDigest(rawBytes) {
  return `sha256:${createHash("sha256").update(rawBytes).digest("hex")}`;
}

export function renderAgentRegistryModule(registry, digest) {
  const normalized = JSON.stringify(normalizeAgentRegistry(registry), null, 2);
  return [
    `export const ZCODE_AGENT_BUNDLE_CONTRACT = "${registry.contract}";`,
    `export const ZCODE_AGENT_BUNDLE_VERSION = "${registry.bundle_version}";`,
    `export const ZCODE_AGENT_BUNDLE_DIGEST = "${digest}";`,
    `export const ZCODE_AGENT_REGISTRY = Object.freeze(${normalized});`,
    registryRuntimeHelpersSource,
    "",
  ].join("\n");
}
```

The generated module must expose executable helpers with these exact behaviors:

```javascript
export function agentForOperation(agentId, operation) {
  const agent = ZCODE_AGENT_REGISTRY.agents.find((entry) => entry.id === agentId);
  if (!agent || !agent.operations.includes(operation)) {
    throw new Error(`agent ${agentId} is not authorized for ${operation}`);
  }
  return agent;
}

export function resolveExecutionClass(agentId, workflowConfig) {
  const agent = ZCODE_AGENT_REGISTRY.agents.find((entry) => entry.id === agentId);
  if (!agent || agent.execution_class_config_key === null) return null;
  return workflowConfig.execution_classes[agent.execution_class_config_key];
}

export function assertAgentPermission(agentId, operation, permissionClass) {
  const agent = agentForOperation(agentId, operation);
  if (agent.permission_class !== permissionClass) {
    throw new Error(`permission mismatch for ${agentId}/${operation}`);
  }
  return agent;
}
```

Support `--print` for the test and builder.

- [ ] **Step 4: Run focused Registry generation tests**

Run:

```bash
python3 -m unittest tests.test_zcode_build.ZCodeBuildTests.test_generated_registry_module_exports_contract_version_and_digest -v
node tooling/zcode-workflow/agent-registry.mjs --print >/tmp/zcode-agent-registry.mjs
node --check /tmp/zcode-agent-registry.mjs
```

Expected: PASS.

- [ ] **Step 5: Record the logical commit boundary**

No commit without authorization. Logical message: `build(zcode): add registry compiler`.

---

### Task 4: Establish the dedicated ZCode builder

**Files:**
- Create: `tooling/zcode-workflow/goal-dag.ts`
- Create: `tooling/zcode-workflow/workflow-config.mjs`
- Create: `tooling/zcode-workflow/dashboard-lifecycle.mjs`
- Create: `tooling/zcode-workflow/start-dashboard.mjs`
- Create: `tooling/zcode-workflow/dashboard-status.mjs`
- Create: `tooling/zcode-workflow/stop-dashboard.mjs`
- Create: `tooling/zcode-workflow/build.mjs`
- Modify generated headers only:
  - `zcode-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs`
  - `zcode-market/plugins/ghost-agent-workflow/scripts/workflow-config.mjs`
  - `zcode-market/plugins/ghost-agent-workflow/scripts/start-dashboard.mjs`
- Create generated file: `zcode-market/plugins/ghost-agent-workflow/scripts/agent-registry.mjs`
- Create generated initial implementations:
  - `zcode-market/plugins/ghost-agent-workflow/scripts/dashboard-status.mjs`
  - `zcode-market/plugins/ghost-agent-workflow/scripts/stop-dashboard.mjs`
- Test: `tests/test_zcode_build.py`

**Interfaces:**
- Consumes: Registry compiler from Task 3.
- Produces: `node tooling/zcode-workflow/build.mjs [--check] [--output-root PATH]`.

- [ ] **Step 1: Write failing build-scope tests**

Add:

```python
    def test_zcode_builder_emits_declared_artifacts_only_below_zcode_market(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [
                    "node",
                    str(ROOT / "tooling/zcode-workflow/build.mjs"),
                    "--output-root",
                    directory,
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            emitted = snapshot_tree(Path(directory))
            self.assertEqual(
                set(emitted),
                {
                    "zcode-market/plugins/ghost-agent-workflow/scripts/agent-registry.mjs",
                    "zcode-market/plugins/ghost-agent-workflow/scripts/workflow-config.mjs",
                    "zcode-market/plugins/ghost-agent-workflow/scripts/start-dashboard.mjs",
                    "zcode-market/plugins/ghost-agent-workflow/scripts/dashboard-status.mjs",
                    "zcode-market/plugins/ghost-agent-workflow/scripts/stop-dashboard.mjs",
                    "zcode-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs",
                },
            )
```

- [ ] **Step 2: Run and observe the missing builder failure**

Run:

```bash
python3 -m unittest tests.test_zcode_build.ZCodeBuildTests.test_zcode_builder_emits_declared_artifacts_only_below_zcode_market -v
```

Expected: FAIL because `tooling/zcode-workflow/build.mjs` does not exist.

- [ ] **Step 3: Seed independent ZCode sources**

Copy the current ZCode published behavior into independent sources as a mechanical starting point:

- Copy current published `goal-dag.mjs` body into `tooling/zcode-workflow/goal-dag.ts`, restoring TypeScript source only where required for compilation.
- Copy current ZCode `workflow-config.mjs` into its source path.
- Copy current ZCode `start-dashboard.mjs` into its source path.
- Create `dashboard-lifecycle.mjs` exporting `dashboardDescriptorPath()`, `parseDashboardDescriptorV2()`, `inspectProcessIdentity()`, `processIdentityMatches()`, `expectedDashboardArgv()` and `descriptorMatchesDashboardCommand()`. At this build-bootstrap checkpoint, identity inspection may return `null` on every platform; Plan 02 replaces it with platform-specific inspection under failing tests.
- Create status/stop source files with complete CLI argument parsing and deterministic zero-write `not_found` behavior when no descriptor exists. Plan 02 adds Descriptor V2 identity validation, health probing and stop signaling under TDD.

The goal in this step is build ownership, not behavior change.

- [ ] **Step 4: Implement the build target allowlist**

Create `tooling/zcode-workflow/build.mjs` with a fixed target array and no shared paths. Required CLI:

```text
node tooling/zcode-workflow/build.mjs
node tooling/zcode-workflow/build.mjs --check
node tooling/zcode-workflow/build.mjs --output-root <path>
```

Compile `goal-dag.ts` with `stripTypeScriptTypes`; copy ESM source files; render Registry module. Generated headers must name `tooling/zcode-workflow/...`.

`--check` builds in memory, compares bytes, reports drift, and writes nothing.

- [ ] **Step 5: Add protected-tree regression test**

Add:

```python
    def test_zcode_builder_leaves_protected_platform_trees_unchanged(self) -> None:
        protected = ["claude-code-market", "codex-market", ".agents", ".codex"]
        before = {name: snapshot_tree(ROOT / name) for name in protected}
        result = subprocess.run(
            ["node", str(ROOT / "tooling/zcode-workflow/build.mjs")],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        after = {name: snapshot_tree(ROOT / name) for name in protected}
        self.assertEqual(after, before)
```

- [ ] **Step 6: Generate ZCode artifacts and run checks**

Run:

```bash
node tooling/zcode-workflow/build.mjs
node tooling/zcode-workflow/build.mjs --check
node --check zcode-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs
python3 -m unittest tests.test_zcode_build -v
```

Expected: PASS; generated artifacts match sources; protected trees unchanged.

- [ ] **Step 7: Run existing shared generation tests**

Run:

```bash
python3 -m unittest tests.test_goal_dag_cli.GoalDagCliTests.test_published_drivers_exactly_match_built_typescript_source -v
python3 -m unittest tests.test_workflow_config_cli.WorkflowConfigCliTests.test_published_scripts_match_source -v
```

Expected: PASS.

- [ ] **Step 8: Record the logical commit boundary**

No commit without authorization. Logical message: `build(zcode): add independent workflow build lane`.

---

### Task 5: Complete Registry/build self-review checkpoint

**Files:**
- Modify only when checkpoint tests fail:
  - `zcode-market/agent-registry.json`
  - `zcode-market/agent-registry.schema.json`
  - `tooling/zcode-workflow/agent-registry.mjs`
  - `tooling/zcode-workflow/build.mjs`
  - `tests/test_zcode_agent_registry.py`
  - `tests/test_zcode_build.py`

**Interfaces:**
- Produces stable inputs for Plans 02–04.

- [ ] **Step 1: Add exact inventory and no-duplicate-source tests**

Extend Registry tests to assert:

```python
    def test_installer_and_runtime_do_not_contain_a_second_agent_inventory(self) -> None:
        installer = (ROOT / "zcode-market/install-agents.py").read_text(encoding="utf-8")
        self.assertNotRegex(installer, r"^AGENTS\s*=", "installer must load the Registry")
```

This test remains RED until Plan 04 and is marked expected-failure only temporarily with `@unittest.expectedFailure`; Plan 04 must remove that marker.

Add a generated Registry equality test comparing normalized source JSON with module-exported JSON.

- [ ] **Step 2: Run focused checkpoint**

Run:

```bash
python3 -m unittest tests.test_zcode_agent_registry tests.test_zcode_build -v
node tooling/zcode-workflow/build.mjs --check
```

Expected: all tests pass except the explicitly documented temporary expected failure for the old installer inventory.

- [ ] **Step 3: Verify working-tree scope**

Run:

```bash
git status --short
git diff --exit-code -- claude-code-market codex-market .agents .codex
```

Expected: no protected-platform changes.

- [ ] **Step 4: Stop for review**

Review the Registry and builder interfaces before starting Plan 02. Do not change Agent IDs, Skill IDs, operation names, bundle contract, or target file list afterward without updating all dependent plans.
