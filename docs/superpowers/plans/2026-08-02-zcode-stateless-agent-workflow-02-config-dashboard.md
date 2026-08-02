# ZCode Config V2 and Dashboard Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement zero-write config readers, explicit Config V2 migration, and separate non-destructive Dashboard start/status/stop lifecycles.

**Architecture:** ZCode owns independent config and dashboard sources under `tooling/zcode-workflow/`. Config reads never initialize or migrate; writes are explicit and single-field. Dashboard descriptors bind a process to a token, PID start identity, command digest, workspace and Goal so start never reclaims a live process and stop never kills by port.

**Tech Stack:** Node.js 22 ESM, Python 3.11 `unittest`, Node `node:test`, platform process inspection via `/proc`, `/bin/ps`, or PowerShell/CIM.

## Global Constraints

- Inherit the master plan constraints.
- Consume the builder and generated Registry module from Plan 01.
- Do not modify shared Config or Dashboard sources/tests for Claude/Codex.
- Strict read commands must produce zero filesystem writes.
- Stop requires explicit user authorization at the Agent/Skill layer; the CLI additionally requires an exact descriptor token.

---

### Task 1: Implement Workflow Config V2 parser and strict reads

**Files:**
- Modify: `tooling/zcode-workflow/workflow-config.mjs`
- Generate: `zcode-market/plugins/ghost-agent-workflow/scripts/workflow-config.mjs`
- Create: `tests/test_zcode_workflow_config_cli.py`

**Interfaces:**
- Consumes: `ZCODE_WORKFLOW_CONFIG_V2` schema from the master plan.
- Produces:
  - `parseV2Config(value)`
  - `parseLegacyV1Config(value)`
  - `readConfigStrict(workspaceRoot)`
  - `readWorkflowConfigForRuntime(workspaceRoot, options)`
  - `executionClassForOperation(config, operation)`

- [ ] **Step 1: Write failing zero-write strict-read tests**

Create tests:

```python
class ZCodeWorkflowConfigCliTests(unittest.TestCase):
    def test_show_strict_missing_is_read_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            before = snapshot_tree(root)
            result, payload = self.run_json("show-strict", root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(payload["status"], "missing")
            self.assertIsNone(payload["config"])
            assert_zero_write(self, before, snapshot_tree(root))

    def test_show_strict_detects_v1_without_migrating(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / ".ghost-agent-workflow/config.json"
            path.parent.mkdir()
            original = json.dumps({
                "parallel": 8,
                "profiles": {
                    "planner": {"model": "gpt-5.6-sol", "effort": "high"},
                    "owner": {"model": "gpt-5.6-sol", "effort": "high"},
                    "review": {"model": "gpt-5.6-sol", "effort": "high"},
                },
            }).encode()
            path.write_bytes(original)
            result, payload = self.run_json("show-strict", root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(payload["status"], "migration_required")
            self.assertEqual(path.read_bytes(), original)
```

The test helper invokes the source script with Node and parses one JSON receipt.

- [ ] **Step 2: Run and observe unknown-command/current-write failures**

Run:

```bash
python3 -m unittest tests.test_zcode_workflow_config_cli -v
```

Expected: FAIL because strict commands and V2 receipts do not exist.

- [ ] **Step 3: Replace the old profile parser with V2 exact-key parsing**

Implement:

```javascript
const RECEIPT_CONTRACT = "ZCODE_WORKFLOW_CONFIG_RECEIPT_V2";
const CONFIG_CONTRACT = "ZCODE_WORKFLOW_CONFIG_V2";
const EXECUTION_ROLES = ["planner", "planner_reviewer", "owner", "review"];
const EXECUTION_CLASSES = new Set(["main", "lite"]);
const DEFAULT_CONFIG = {
  contract: CONFIG_CONTRACT,
  parallel: 4,
  execution_classes: Object.fromEntries(
    EXECUTION_ROLES.map((role) => [role, "main"]),
  ),
};
```

`parseV2Config()` requires exact top-level keys and exact role keys. `readConfigStrict()` only reads; it never calls `mkdirSync` or write functions.

Recognize the four allowed legacy profile-key shapes but do not normalize or write them.

- [ ] **Step 4: Implement `show-strict` and `validate-strict` receipts**

Receipt shape:

```json
{
  "contract": "ZCODE_WORKFLOW_CONFIG_RECEIPT_V2",
  "operation": "show-strict",
  "status": "missing|shown|valid|migration_required",
  "path": "/absolute/path/config.json",
  "source": "missing|file|legacy",
  "config": null
}
```

Malformed JSON and unknown fields exit 1. Recognized V1 exits 0 with `migration_required`.

- [ ] **Step 5: Implement runtime read and operation mapping**

```javascript
export function readWorkflowConfigForRuntime(workspaceRoot, options = {}) {
  const strict = readConfigStrict(workspaceRoot);
  if (strict.status === "missing" && options.missing !== "error") {
    return { config: structuredClone(DEFAULT_CONFIG), source: "default" };
  }
  if (strict.status === "migration_required") {
    return { status: "migration_required", path: strict.path };
  }
  if (strict.status !== "shown") throw new Error(...);
  return { config: strict.config, source: "file" };
}
```

Map planning, plan review, owner and implementation-review operations to their four config keys.

- [ ] **Step 6: Generate and run tests**

Run:

```bash
node tooling/zcode-workflow/build.mjs
python3 -m unittest tests.test_zcode_workflow_config_cli -v
node tooling/zcode-workflow/build.mjs --check
```

Expected: PASS.

- [ ] **Step 7: Record logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): add strict workflow config v2 reads`.

---

### Task 2: Add explicit Config V2 initialization and single-field writes

**Files:**
- Modify: `tooling/zcode-workflow/workflow-config.mjs`
- Test: `tests/test_zcode_workflow_config_cli.py`

**Interfaces:**
- Produces CLI operations `init`, `set-parallel`, `set-execution-class`.

- [ ] **Step 1: Write failing writer tests**

Add:

```python
    def test_init_writes_exact_v2_defaults_only_when_requested(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result, payload = self.run_json("init", directory)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(payload["status"], "created")
            self.assertEqual(payload["config"], {
                "contract": "ZCODE_WORKFLOW_CONFIG_V2",
                "parallel": 4,
                "execution_classes": {
                    "planner": "main",
                    "planner_reviewer": "main",
                    "owner": "main",
                    "review": "main",
                },
            })

    def test_set_execution_class_changes_only_requested_role(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            self.run_json("init", directory)
            _, before = self.run_json("show-strict", directory)
            _, updated = self.run_json(
                "set-execution-class", directory, "review", "lite"
            )
            self.assertEqual(updated["changed_fields"], ["/execution_classes/review"])
            self.assertEqual(updated["config"]["execution_classes"]["review"], "lite")
            self.assertEqual(
                updated["config"]["execution_classes"]["owner"],
                before["config"]["execution_classes"]["owner"],
            )
```

- [ ] **Step 2: Run and observe failures**

Run:

```bash
python3 -m unittest tests.test_zcode_workflow_config_cli.ZCodeWorkflowConfigCliTests.test_init_writes_exact_v2_defaults_only_when_requested tests.test_zcode_workflow_config_cli.ZCodeWorkflowConfigCliTests.test_set_execution_class_changes_only_requested_role -v
```

Expected: FAIL until V2 writer behavior exists.

- [ ] **Step 3: Implement explicit initialization**

`init` creates `.ghost-agent-workflow`, its managed `.gitignore`, and `config.json` only when missing. Valid V2 returns `existing`; V1 returns `migration_required` with exit 2 and no write.

Use an atomic temporary file and rename.

- [ ] **Step 4: Implement single-field updates**

`set-parallel` requires an existing V2 and range 1–8. `set-execution-class` requires an exact role and `main|lite`. Each update:

1. Reads and validates V2.
2. Mutates one field in memory.
3. Atomically writes.
4. Reads with the strict parser.
5. Returns `changed_fields` with exactly one JSON pointer.

Remove public `ensure`, `show`, `validate`, and `set-profile` cases from the ZCode source.

- [ ] **Step 5: Run full config tests and generation check**

Run:

```bash
node tooling/zcode-workflow/build.mjs
python3 -m unittest tests.test_zcode_workflow_config_cli -v
node tooling/zcode-workflow/build.mjs --check
```

Expected: PASS.

- [ ] **Step 6: Record logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): separate workflow config reads and writes`.

---

### Task 3: Implement digest-bound explicit V1 migration

**Files:**
- Modify: `tooling/zcode-workflow/workflow-config.mjs`
- Test: `tests/test_zcode_workflow_config_cli.py`

**Interfaces:**
- Produces:
  - `ZCODE_WORKFLOW_CONFIG_MIGRATION_PREVIEW_V1`
  - `ZCODE_WORKFLOW_CONFIG_MIGRATION_RECEIPT_V1`
  - `migrate <workspace>` and `migrate <workspace> --apply <sha256-digest>`

- [ ] **Step 1: Add failing preview/apply tests**

Add tests that assert preview is zero-write, removed fields are listed, apply preserves `parallel`, all execution classes become `main`, source digest drift is rejected, and active legacy workflow refuses migration.

Representative assertion:

```python
self.assertIn("/profiles/planner/model", preview["removed_fields"])
self.assertEqual(preview["target_config"]["parallel"], 8)
self.assertEqual(set(preview["target_config"]["execution_classes"].values()), {"main"})
```

- [ ] **Step 2: Run and observe missing migration failures**

Run:

```bash
python3 -m unittest tests.test_zcode_workflow_config_cli -v
```

Expected: migration tests fail.

- [ ] **Step 3: Implement migration preview**

Compute digest from exact source bytes. Validate every legacy profile's `model` and `effort`; do not infer `lite`. Return removed JSON-pointer fields and target V2 without writing.

- [ ] **Step 4: Implement migration apply**

Require the exact source digest. Re-read under the same operation, reject drift, reject active legacy runtime markers, write backup:

```text
<workspace>/.ghost-agent-workflow/config.v1.backup-<UTC>-<digest-prefix>.json
```

Then atomically replace and strict-validate the result. Exit 2 for safe refusal.

- [ ] **Step 5: Run config tests**

Run:

```bash
node tooling/zcode-workflow/build.mjs
python3 -m unittest tests.test_zcode_workflow_config_cli -v
```

Expected: PASS.

- [ ] **Step 6: Record logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): add explicit config v1 migration`.

---

### Task 4: Implement Dashboard descriptor V2 and process identity

**Files:**
- Modify: `tooling/zcode-workflow/dashboard-lifecycle.mjs`
- Modify: `tooling/zcode-workflow/start-dashboard.mjs`
- Modify: `tooling/zcode-workflow/dashboard-status.mjs`
- Modify: `tooling/zcode-workflow/stop-dashboard.mjs`
- Create: `tests/test_zcode_dashboard.mjs`

**Interfaces:**
- Produces:
  - `ZCODE_DASHBOARD_DESCRIPTOR_V2`
  - `inspectProcessIdentity(pid)`
  - `processIdentityMatches(expected, observed)`
  - `expectedDashboardArgv(data, options, runtimeId)`
  - `descriptorMatchesDashboardCommand(descriptor, driverPath)`

- [ ] **Step 1: Write failing status and descriptor tests**

Use `node:test` to assert:

```javascript
test("status on a missing descriptor performs zero writes", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "zcode-dashboard-"));
  const before = await snapshotDirectory(workspace);
  const result = runNode(DASHBOARD_STATUS, [workspace, "--goal", "g1"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "not_found");
  assert.deepEqual(await snapshotDirectory(workspace), before);
});

test("descriptor contains token start marker and command digest", async () => {
  const fixture = await startDashboardFixture();
  const descriptor = JSON.parse(await readFile(fixture.descriptorPath, "utf8"));
  assert.equal(descriptor.contract, "ZCODE_DASHBOARD_DESCRIPTOR_V2");
  assert.match(descriptor.descriptor_token, /^[0-9a-f-]{36}$/);
  assert.ok(descriptor.process_identity.start_marker);
  assert.match(descriptor.process_identity.command_digest, /^sha256:[0-9a-f]{64}$/);
});

test("status rejects identity mismatch without cleanup", async () => {
  const fixture = await writeDescriptorFixture({ start_marker: "wrong-marker" });
  const before = await snapshotDirectory(fixture.workspace);
  const result = runNode(DASHBOARD_STATUS, [fixture.workspace, "--goal", fixture.goalId]);
  assert.equal(JSON.parse(result.stdout).status, "identity_mismatch");
  assert.deepEqual(await snapshotDirectory(fixture.workspace), before);
});
```

- [ ] **Step 2: Run and observe missing-script failures**

Run:

```bash
node --test tests/test_zcode_dashboard.mjs
```

Expected: FAIL because the build-bootstrap status/stop implementations only handle missing descriptors and V1 descriptors lack required identity fields.

- [ ] **Step 3: Implement portable process identity**

Darwin: call `/bin/ps` with `spawnSync`, `LC_ALL=C`, wide output, start marker, executable and command. Linux: read `/proc/<pid>/stat`, `cmdline`, `exe`. Windows: use noninteractive PowerShell/CIM with argument arrays and no shell interpolation.

Unknown/unparseable identity returns `null`; never fall back to PID-only matching.

- [ ] **Step 4: Implement Descriptor V2 serialization/validation**

Include UUID descriptor token, runtime/source IDs, full expected argv, workspace/Goal paths, PID identity, URL, host, port, log and timestamp. Require exact keys.

- [ ] **Step 5: Implement zero-write status**

Statuses:

```text
running
unhealthy
stopped
identity_mismatch
invalid_descriptor
not_found
ambiguous
```

The status path does not delete descriptors/logs or refresh workflow files.

- [ ] **Step 6: Generate and run focused tests**

Run:

```bash
node tooling/zcode-workflow/build.mjs
node --test tests/test_zcode_dashboard.mjs
```

Expected: status and descriptor tests PASS.

- [ ] **Step 7: Record logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): add dashboard process identity`.

---

### Task 5: Make Dashboard start non-destructive and stop token-bound

**Files:**
- Modify: Dashboard sources from Task 4.
- Test: `tests/test_zcode_dashboard.mjs`

**Interfaces:**
- Produces:
  - `ZCODE_DASHBOARD_START_RECEIPT_V2`
  - `ZCODE_DASHBOARD_STATUS_RECEIPT_V1`
  - `ZCODE_DASHBOARD_STOP_RECEIPT_V1`

- [ ] **Step 1: Add failing lifecycle safety tests**

Add exact tests:

```text
starter returns conflict without terminating a live conflicting process
starter does not delete a live conflicting descriptor
starter may clean only a dead descriptor
stop requires the descriptor token and explicit target identity
stop rejects pid process workspace and goal mismatches
stop never kills an unrelated process sharing the port
stop terminates only the exact registered dashboard
stop removes only its own descriptor and log
```

- [ ] **Step 2: Run and observe current destructive behavior failures**

Run:

```bash
node --test tests/test_zcode_dashboard.mjs
```

Expected: start safety and stop tests fail.

- [ ] **Step 3: Remove live-process termination from start**

Delete calls that signal pre-existing tracked PIDs. A live invalid/unhealthy/mismatched descriptor becomes `conflict`, exit 2. A dead descriptor may be cleaned. Starter may signal only a child created in the current invocation, after matching captured identity.

- [ ] **Step 4: Implement token-bound stop**

CLI:

```text
stop-dashboard.mjs <workspace> --goal <goal-id> --descriptor-token <uuid> [--host <host>] [--port <port>]
```

Validate contract, timing-safe token equality, workspace, Goal, host/port, PID liveness, start marker, executable, command digest and canonical argv before `SIGTERM`. Never search or kill by port.

- [ ] **Step 5: Run Dashboard and shared regression tests**

Run:

```bash
node tooling/zcode-workflow/build.mjs
node --test tests/test_zcode_dashboard.mjs
node --test tests/test_start_dashboard.mjs
node tooling/zcode-workflow/build.mjs --check
```

Expected: all PASS; shared dashboard behavior remains unchanged.

- [ ] **Step 6: Record logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): split dashboard start status and stop`.

---

### Task 6: Config/Dashboard checkpoint

**Files:**
- Modify only when checkpoint verification fails:
  - `tooling/zcode-workflow/workflow-config.mjs`
  - `tooling/zcode-workflow/dashboard-lifecycle.mjs`
  - `tooling/zcode-workflow/start-dashboard.mjs`
  - `tooling/zcode-workflow/dashboard-status.mjs`
  - `tooling/zcode-workflow/stop-dashboard.mjs`
  - `tests/test_zcode_workflow_config_cli.py`
  - `tests/test_zcode_dashboard.mjs`

- [ ] **Step 1: Run focused suites**

```bash
python3 -m unittest tests.test_zcode_workflow_config_cli -v
node --test tests/test_zcode_dashboard.mjs
node tooling/zcode-workflow/build.mjs --check
```

Expected: PASS.

- [ ] **Step 2: Verify strict-read zero writes manually**

Run strict commands in an empty temp directory and inspect that no `.ghost-agent-workflow` exists afterward.

- [ ] **Step 3: Verify protected paths**

```bash
git diff --exit-code -- claude-code-market codex-market .agents .codex
```

Expected: no diff.

- [ ] **Step 4: Stop for interface review**

Plan 03 consumes `readWorkflowConfigForRuntime()` and `executionClassForOperation()`. Do not change their signatures after this checkpoint without updating runtime tests and plans.
