# ZCode Workflow Integration and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate commands, tests, documentation and marketplace metadata; verify the complete stateless ZCode workflow without modifying Claude Code or Codex.

**Architecture:** Commands consume runtime receipts rather than hardcoded role mappings. Marketplace/tests derive inventory from the Registry. Documentation describes immutable online installation, one-time legacy replacement, Config V2 and Dashboard lifecycle. Release state changes remain authorization-gated.

**Tech Stack:** Markdown commands/docs, Python `unittest`, Node `node:test`, JSON manifests, GitHub Raw release tags.

## Global Constraints

- Inherit master constraints and require Plans 01–04 to pass first.
- This plan may update root docs and ZCode versions but does not commit, tag or push without explicit user authorization.
- Online sync examples use immutable `zcode-agent-bundle-v2.0.0`, never raw `main`.
- Creating that tag is a later outward-facing action requiring explicit authorization and a published commit.

---

### Task 1: Rewrite `/parallel-workflow` around runtime receipts

**Files:**
- Modify: `zcode-market/plugins/ghost-agent-workflow/commands/parallel-workflow.md`
- Modify: `tests/test_zcode_marketplace.py`

**Interfaces:**
- Consumes: runtime receipt enum and Registry-generated dispatch job fields.
- Produces: Main coordination command with no hardcoded Agent routing table.

- [ ] **Step 1: Rewrite marketplace test expectations from Registry**

Remove `EXPECTED_SKILLS`/`EXPECTED_AGENTS` constants. Load `zcode-market/agent-registry.json`. Add:

```python
    def test_parallel_workflow_command_uses_next_actions_receipts(self) -> None:
        command = (
            ROOT / "zcode-market/plugins/ghost-agent-workflow/commands/parallel-workflow.md"
        ).read_text(encoding="utf-8")
        self.assertIn("$workflow-coordination", command)
        self.assertIn("workflow next-actions", command)
        self.assertIn("workflow reconcile", command)
        self.assertNotIn("sub-thread-coordination", command)
        self.assertNotIn("sub-thread-goal-worker", command)
        self.assertNotIn("planner-reviewer", command)
        self.assertNotIn("supervisor", command.lower())
```

- [ ] **Step 2: Run and observe old hardcoded mapping failure**

```bash
python3 -m unittest tests.test_zcode_marketplace -v
```

Expected: FAIL.

- [ ] **Step 3: Rewrite command contract**

Frontmatter description: `按 Runtime Receipt 派发当前 ZCode workflow 的一个 action batch。`

Body:

1. Load `$workflow-coordination`.
2. Call `workflow next-actions`.
3. Accept only `dispatch_batch|runtime_action|user_action|completed|failed`.
4. For jobs, use `agent`, `operation`, `execution_class`, `dispatch`, `binding_ref`, `binding_digest` verbatim.
5. Dispatch independent jobs in one tool batch.
6. Do not infer agents or operations.
7. After current calls return, call `workflow reconcile`.
8. No Main/Supervisor Agent.

- [ ] **Step 4: Run command tests**

```bash
python3 -m unittest tests.test_zcode_marketplace.ZCodeMarketplaceTests.test_parallel_workflow_command_uses_next_actions_receipts -v
```

Expected: PASS.

- [ ] **Step 5: Record logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): route parallel workflow through receipts`.

---

### Task 2: Rewrite `/sync-zcode-agents` for pinned transactional bundles

**Files:**
- Modify: `zcode-market/plugins/ghost-agent-workflow/commands/sync-zcode-agents.md`
- Modify: `tests/test_zcode_marketplace.py`

**Interfaces:**
- Consumes: installer V2 CLI/receipt.
- Produces immutable online command using one ref.

- [ ] **Step 1: Add failing pinned-ref test**

```python
    def test_sync_command_uses_fixed_online_release_ref(self) -> None:
        text = (
            ROOT / "zcode-market/plugins/ghost-agent-workflow/commands/sync-zcode-agents.md"
        ).read_text(encoding="utf-8")
        ref = "zcode-agent-bundle-v2.0.0"
        self.assertEqual(text.count(ref), 2)
        self.assertNotIn("/main/zcode-market/install-agents.py", text)
        self.assertNotIn("--force", text)
        self.assertIn("backup", text.lower())
        self.assertIn("sidecar", text.lower())
        self.assertIn("重启 ZCode", text)
```

- [ ] **Step 2: Run and observe old raw-main/force failure**

Expected: FAIL.

- [ ] **Step 3: Rewrite sync command**

Use:

```bash
curl -fsSL https://raw.githubusercontent.com/Ghost233/ghost-agent-market/zcode-agent-bundle-v2.0.0/zcode-market/install-agents.py \
  | python3 - --ref zcode-agent-bundle-v2.0.0
```

Explain full backup, 11 canonical Agents, old Agent removal, metadata notices, sidecar and restart. Do not recommend `--force`.

- [ ] **Step 4: Run focused test**

Expected: PASS.

- [ ] **Step 5: Record logical commit boundary**

No commit without authorization. Logical message: `docs(zcode): pin agent bundle sync`.

---

### Task 3: Update marketplace tests to Registry-owned inventory and final surface guards

**Files:**
- Modify: `tests/test_zcode_marketplace.py`

**Interfaces:**
- Consumes: final Registry, Skills, templates, generated files and commands.

- [ ] **Step 1: Add/replace final marketplace tests**

Required tests:

```text
test_marketplace_sources_are_zcode_plugin_paths
test_marketplace_and_plugin_versions_match_release
test_workflow_plugin_exports_registry_declared_skills_commands_and_runtime_files
test_all_zcode_skills_keep_independent_evolution_notice
test_registry_declared_agent_templates_are_exact_repository_inventory
test_parallel_workflow_command_uses_next_actions_receipts
test_sync_command_uses_fixed_online_release_ref
test_docs_forbid_clone_file_urls_and_local_marketplace_deployment
test_rtk_hook_contract_remains_unchanged
test_zcode_surfaces_do_not_expose_supervisor_or_private_session_apis
```

Runtime file set now includes:

```text
scripts/agent-registry.mjs
scripts/goal-dag.mjs
scripts/owner-registry.mjs
scripts/workflow-config.mjs
scripts/start-dashboard.mjs
scripts/dashboard-status.mjs
scripts/stop-dashboard.mjs
assets/goal-dag-dashboard.html
```

- [ ] **Step 2: Expand forbidden-surface scan**

Scan ZCode commands, Skills, templates, Registry, installer and runtime source for forbidden public/private APIs:

```text
app-server --stdio
session/create
session/resume
create_thread
wait_threads
send_message_to_thread
sub-thread-task-supervisor
parallel-supervisor
```

Do not globally ban the English word `supervisor` in migration comments/error tests; ban dispatch/Agent IDs and private/public API strings precisely.

- [ ] **Step 3: Run marketplace tests**

```bash
python3 -m unittest tests.test_zcode_marketplace -v
```

Expected: PASS.

- [ ] **Step 4: Record logical commit boundary**

No commit without authorization. Logical message: `test(zcode): validate stateless marketplace surface`.

---

### Task 4: Update plugin versions and root marketplace metadata

**Files:**
- Modify: `zcode-market/plugins/ghost-agent-workflow/.zcode-plugin/plugin.json`
- Modify: `zcode-market/plugins/ghost-agent-skills/.zcode-plugin/plugin.json`
- Modify: `marketplace.json`
- Test: `tests/test_zcode_marketplace.py`

**Interfaces:**
- Produces workflow `0.1.6`, skills `0.1.4`, rtk `0.1.0`.

- [ ] **Step 1: Add exact version test**

```python
    def test_release_versions_are_workflow_0_1_6_skills_0_1_4_and_rtk_0_1_0(self) -> None:
        manifest = json.loads(MARKETPLACE.read_text(encoding="utf-8"))
        versions = {item["name"]: item["version"] for item in manifest["plugins"]}
        self.assertEqual(versions, {
            "ghost-agent-workflow": "0.1.6",
            "ghost-agent-skills": "0.1.4",
            "rtk-hook": "0.1.0",
        })
```

- [ ] **Step 2: Run and observe old-version failure**

Expected: FAIL.

- [ ] **Step 3: Update both copies of each affected version**

Update plugin manifests and root marketplace. Refresh descriptions/keywords to mention stateless actions, Registry and 11 user Agents where appropriate. Do not add plugin `agents` fields because distribution remains the online global installer.

- [ ] **Step 4: Validate JSON and tests**

```bash
python3 -m json.tool marketplace.json >/dev/null
python3 -m json.tool zcode-market/plugins/ghost-agent-workflow/.zcode-plugin/plugin.json >/dev/null
python3 -m json.tool zcode-market/plugins/ghost-agent-skills/.zcode-plugin/plugin.json >/dev/null
python3 -m unittest tests.test_zcode_marketplace -v
```

Expected: PASS.

- [ ] **Step 5: Record logical commit boundary**

No commit without authorization. Logical message: `chore(zcode): bump stateless workflow plugins`.

---

### Task 5: Update repository instructions and user documentation

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `tests/test_zcode_marketplace.py`

**Interfaces:**
- Produces accurate maintenance/install/release instructions.

- [ ] **Step 1: Add documentation contract tests**

Assert documentation contains:

```text
11 canonical Agents
8 shared Skills
Main is the only dispatcher
Runtime is the only state writer
workflow next-actions
action open
action result
workflow reconcile
Config V2 main/lite
Dashboard start/status/stop
backup and sidecar
zcode-agent-bundle-v2.0.0
restart ZCode
```

Assert ZCode deployment docs prohibit clone/local path/local marketplace/file URL and do not instruct running Claude/Codex sync or cachebuster.

- [ ] **Step 2: Run and observe stale-doc failures**

Expected: FAIL.

- [ ] **Step 3: Update README ZCode architecture and usage**

Replace 8 same-name Agents with 11 Agents and 8 shared Skills. Explain runtime action loop, Config V2, Dashboard lifecycle, one-time backup/replacement, active legacy workflow refusal and online tagged sync.

- [ ] **Step 4: Update AGENTS/CLAUDE maintenance rules**

Document Registry as sole source, new template/Skill paths, generated ZCode build lane, no Main/Supervisor Agent, immutable release ref and protected platform guard.

- [ ] **Step 5: Run docs/marketplace tests**

```bash
python3 -m unittest tests.test_zcode_marketplace -v
```

Expected: PASS.

- [ ] **Step 6: Record logical commit boundary**

No commit without authorization. Logical message: `docs(zcode): document stateless agent workflow`.

---

### Task 6: Add cross-platform ZCode regression workflow

**Files:**
- Create: `.github/workflows/zcode-regression.yml`
- Modify: `tests/test_zcode_marketplace.py` or `tests/test_zcode_build.py` for workflow-presence contract.

**Interfaces:**
- Produces CI on Ubuntu/macOS/Windows, Node 22, Python 3.11.

- [ ] **Step 1: Add failing CI contract test**

Assert workflow exists, matrix contains three OS values, `fetch-depth: 0`, Node 22, Python 3.11, ZCode tests, Node Dashboard test and protected platform guard.

- [ ] **Step 2: Run and observe missing workflow failure**

Expected: FAIL.

- [ ] **Step 3: Create workflow**

Run:

```text
node tooling/zcode-workflow/build.mjs --check
python -m unittest discover -s tests -p 'test_zcode_*.py' -v
node --test tests/test_zcode_dashboard.mjs
selected shared generated-artifact tests
```

Use cross-platform Python path and no Unix-only shell features beyond those supported by the runner shell. Do not run online installer against user home in CI.

- [ ] **Step 4: Run CI contract test locally**

Expected: PASS.

- [ ] **Step 5: Record logical commit boundary**

No commit without authorization. Logical message: `ci(zcode): add cross-platform workflow regression`.

---

### Task 7: Run complete local verification and spec coverage review

**Files:**
- Modify only the failing implementation or test files already listed in Plans 01–05; do not introduce new product surfaces during final verification.

- [ ] **Step 1: Run generated-artifact check**

```bash
node tooling/zcode-workflow/build.mjs --check
```

Expected: exit 0.

- [ ] **Step 2: Run all ZCode Python tests**

```bash
python3 -m unittest discover -s tests -p 'test_zcode_*.py' -v
```

Expected: PASS.

- [ ] **Step 3: Run ZCode Dashboard tests**

```bash
node --test tests/test_zcode_dashboard.mjs
```

Expected: PASS.

- [ ] **Step 4: Run installer self-test and JSON validation**

```bash
python3 zcode-market/install-agents.py --self-test
python3 -m json.tool zcode-market/agent-registry.json >/dev/null
python3 -m json.tool zcode-market/agent-registry.schema.json >/dev/null
python3 -m json.tool marketplace.json >/dev/null
```

Expected: PASS.

- [ ] **Step 5: Run shared regression suites**

```bash
python3 -m unittest tests.test_goal_dag_cli -v
python3 -m unittest tests.test_workflow_config_cli -v
python3 -m unittest tests.test_owner_registry_cli -v
node --test tests/test_start_dashboard.mjs
```

Expected: PASS.

- [ ] **Step 6: Run full Python suite**

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
```

Expected: PASS.

- [ ] **Step 7: Verify protected platform trees**

```bash
git diff --exit-code -- claude-code-market codex-market .agents .codex
git status --short --untracked-files=all -- claude-code-market codex-market .agents .codex
```

Expected: no output.

- [ ] **Step 8: Verify diff quality**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only authorized ZCode/tooling/test/docs/manifest/spec/plan paths changed.

- [ ] **Step 9: Perform spec coverage review**

Cross-check every section of `docs/superpowers/specs/2026-08-02-zcode-stateless-agent-workflow-design.md` against implemented tests. Add missing tests before claiming completion.

---

### Task 8: Authorization-gated publication sequence

**Files:**
- No implementation files unless verification discovers an issue.

**Interfaces:**
- Consumes verified implementation.
- Produces commit/tag/push only if explicitly authorized later.

- [ ] **Step 1: Stop before staging**

Report verification results and current diff. Ask for explicit commit authorization. Do not run `git add` or `git commit` yet.

- [ ] **Step 2: If and only if authorized, invoke the `git-commit` Skill**

Verify:

```bash
git config user.name
git config user.email
```

Required output:

```text
Ghost233
only.yesc@gmail.com
```

Then use the repository's script-driven commit workflow. Do not push unless separately authorized.

- [ ] **Step 3: If and only if push is authorized, publish online**

Push through the authorized branch flow to `Ghost233/ghost-agent-market`. Confirm the marketplace changes are on the online repository.

- [ ] **Step 4: If and only if tag creation is authorized, create immutable bundle tag**

Create `zcode-agent-bundle-v2.0.0` at the published commit and push the tag. This is outward-facing and must be separately authorized if not already covered.

- [ ] **Step 5: Verify online tagged assets**

```bash
curl -fsSL https://raw.githubusercontent.com/Ghost233/ghost-agent-market/zcode-agent-bundle-v2.0.0/zcode-market/agent-registry.json | python3 -m json.tool >/dev/null
curl -fsSL https://raw.githubusercontent.com/Ghost233/ghost-agent-market/zcode-agent-bundle-v2.0.0/zcode-market/install-agents.py | python3 - --self-test
```

Expected: PASS.

- [ ] **Step 6: Perform online-only ZCode rollout**

Refresh the online marketplace source, update workflow/skills plugins, run the one-time global Agent bundle replacement, inspect backup and sidecar, restart ZCode, then execute Quick/DAG and Dashboard lifecycle smoke tests.

Never use a local checkout, local marketplace JSON, `file://`, or clone-based deployment.
