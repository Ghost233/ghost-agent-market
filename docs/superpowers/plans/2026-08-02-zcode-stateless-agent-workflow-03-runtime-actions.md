# ZCode Stateless Runtime Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ZCode's Supervisor/thread public flow with stateless action offers, immutable bindings, result candidates, mechanical reconcile, explicit reclaim, and safe dispatch batches.

**Architecture:** The independent ZCode runtime preserves core Goal/Plan/State/Owner contracts but adds an action-runtime layer. `workflow next-actions` projects work without marking tasks running; `action open` atomically activates exactly one offer; `action result` writes one candidate; `workflow reconcile` validates and accepts it.

**Tech Stack:** TypeScript, Node.js ESM, Git CLI via argv arrays, Python `unittest` black-box CLI tests.

## Global Constraints

- Inherit master constraints and consume Registry/build/config interfaces from Plans 01–02.
- Preserve `DAG_PLAN_V5`, `DAG_RUN_STATE_V5`, task roles `work|review|verify`, Owner IDs, `review-<task>` subjects, and persisted `planner: parallel-task-planner` provenance.
- Do not expose Supervisor, thread-create/wait/notify, private Session, or Agent-to-Agent actions.
- Do not modify shared Claude/Codex runtime source or tests.

---

### Task 1: Add action contracts and workflow context helpers

**Files:**
- Modify: `tooling/zcode-workflow/goal-dag.ts`
- Generate: `zcode-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs`
- Create: `tests/test_zcode_runtime_cli.py`

**Interfaces:**
- Consumes: generated `agent-registry.mjs`, `readWorkflowConfigForRuntime()`, `executionClassForOperation()`.
- Produces TypeScript types and serializers for public receipts and action files.

- [ ] **Step 1: Add failing public-enum and no-Supervisor tests**

Create tests that call the ZCode source/generated CLI fixture and assert:

```python
    def test_next_actions_returns_only_the_public_action_enum(self) -> None:
        receipt = self.start_quick_and_next_actions()
        self.assertIn(
            receipt["kind"],
            {"dispatch_batch", "runtime_action", "user_action", "completed", "failed"},
        )

    def test_runtime_never_dispatches_supervisor(self) -> None:
        receipt = self.start_dag_and_next_actions()
        serialized = json.dumps(receipt)
        self.assertNotIn("supervisor", serialized.lower())
        self.assertNotIn("create_thread", serialized)
        self.assertNotIn("wait_threads", serialized)
```

- [ ] **Step 2: Run and observe unknown `next-actions` failure**

Run:

```bash
python3 -m unittest tests.test_zcode_runtime_cli -v
```

Expected: FAIL because public action commands do not exist.

- [ ] **Step 3: Define locked types**

Add:

```typescript
type ZcodeWorkflowOperation =
  | "initial_plan"
  | "revise_plan"
  | "apply_global_delta"
  | "expand_subgraph"
  | "review_plan_revision"
  | "execute_owner_run"
  | "repair_owner_run"
  | "review_implementation";

type WorkflowActionStatus =
  | "offered"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "repair_required"
  | "reclaimed";
```

Define the receipt structures listed in the master plan. Add exact parsers/serializers and stable error codes.

- [ ] **Step 4: Add action-path ownership**

Under each workflow directory, add script-owned paths:

```text
actions/offers/<action-id>.json
actions/bindings/<action-id>.json
actions/results/<action-id>.json
actions/runtime.json
```

Only runtime writes these files. Cleanup/finalization knows these paths.

- [ ] **Step 5: Add WorkflowContext helpers**

Implement:

```typescript
function loadWorkflowContext(goalDirectory: string): WorkflowContext
function actionPaths(goalDirectory: string, actionId: string): ActionPaths
function readActionOffer(path: string): WorkflowActionOfferV1
function writeActionOfferAtomic(path: string, offer: WorkflowActionOfferV1): void
function writeBindingAtomic(path: string, binding: WorkflowActionBindingV1): void
function writeActionResultAtomic(path: string, result: WorkflowActionResultV1): void
```

- [ ] **Step 6: Generate and run syntax tests**

Run:

```bash
node tooling/zcode-workflow/build.mjs
node --check zcode-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs
```

Expected: PASS.

- [ ] **Step 7: Record logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): add stateless workflow action contracts`.

---

### Task 2: Implement legacy inspection and safe `workflow next-actions`

**Files:**
- Modify: ZCode goal-dag source.
- Test: `tests/test_zcode_runtime_cli.py`

**Interfaces:**
- Produces:
  - `inspectLegacyWorkflow(goalDirectory)`
  - `projectWorkflowNextAction(context)`
  - `workflowNextActionsCommand(goalDirectory)`

- [ ] **Step 1: Write failing legacy no-mutation tests**

Add:

```python
    def test_active_legacy_workflow_returns_user_action_without_mutation(self) -> None:
        self.make_legacy_running_task_and_thread_watch()
        before = self.workflow_tree_snapshot()
        receipt = self.run_json("workflow", "next-actions", self.goal_dir)
        self.assertEqual(receipt["kind"], "user_action")
        self.assertEqual(receipt["code"], "LEGACY_ACTIVE_WORKFLOW_REQUIRES_USER_ACTION")
        self.assertEqual(self.workflow_tree_snapshot(), before)
```

Also test completed legacy is read-only and unstarted legacy requires explicit migration.

- [ ] **Step 2: Run and observe failures**

```bash
python3 -m unittest tests.test_zcode_runtime_cli -v
```

Expected: FAIL.

- [ ] **Step 3: Implement exact legacy dispositions**

```typescript
type LegacyWorkflowDisposition =
  | "current_action_runtime"
  | "completed_legacy"
  | "migratable_legacy"
  | "active_legacy";
```

Active means any Quick run, running/reserved task, thread watch, nonterminal registered thread, Owner lease, or unfinished active Owner worktree. Inspection writes nothing.

- [ ] **Step 4: Implement public next-action projection skeleton**

Order:

```text
legacy gate
→ submitted result detection
→ reconcile requirement
→ runtime mechanical action
→ planner/review operation
→ safe dispatch candidates
→ completion/failure
```

Initially implement Planner/Plan Review projection only; Owner batching comes in Task 4.

- [ ] **Step 5: Add CLI routing**

Add `workflow next-actions <workflow-dir>` and ensure its stdout is one JSON receipt.

- [ ] **Step 6: Run focused tests**

```bash
node tooling/zcode-workflow/build.mjs
python3 -m unittest tests.test_zcode_runtime_cli -v
```

Expected: legacy and planner projection tests PASS; owner tests may remain expected failures until Task 4.

- [ ] **Step 7: Record logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): project stateless workflow actions`.

---

### Task 3: Route Planner and Plan Review through action offers

**Files:**
- Modify: ZCode goal-dag source.
- Test: `tests/test_zcode_runtime_cli.py`

**Interfaces:**
- Produces operation mapping:
  - no Plan → `initial_plan`
  - reviewer revise → `revise_plan`
  - active delta/repair → `apply_global_delta`
  - subgraph request → `expand_subgraph`
  - unapproved Plan → `review_plan_revision`

- [ ] **Step 1: Add failing planning dispatch tests**

Exact tests:

```text
test_next_actions_dispatches_initial_planner
test_next_actions_dispatches_plan_reviewer_for_current_revision
test_planner_operations_cover_initial_revision_delta_and_subgraph
test_dispatch_agents_and_operations_exist_in_registry
```

Each job must include `action_id`, `agent`, `operation`, `execution_class`, `dispatch`, `binding_ref`, `binding_digest`, and `open_token`.

- [ ] **Step 2: Run and observe old planner prompt failures**

Run focused tests and confirm old names such as `$parallel-task-planner` still appear.

- [ ] **Step 3: Implement `createActionOffer()` for control operations**

```typescript
function createActionOffer(
  context: WorkflowContext,
  operation: ZcodeWorkflowOperation,
  subject: PlannerActionSubject,
): WorkflowActionOfferV1
```

Pre-materialize immutable prospective Binding with `attempt = current + 1`. Generating the offer must not mark Plan/task running or increment attempt.

- [ ] **Step 4: Build Planner and Plan Review Bindings**

Planner gets only runtime-projected source blocks/context and the one operation. Plan Reviewer gets current digest and mechanical verification status. Both have empty business writable scope.

- [ ] **Step 5: Run planning tests**

```bash
node tooling/zcode-workflow/build.mjs
python3 -m unittest tests.test_zcode_runtime_cli.ZCodeRuntimeCliTests.test_next_actions_dispatches_initial_planner tests.test_zcode_runtime_cli.ZCodeRuntimeCliTests.test_next_actions_dispatches_plan_reviewer_for_current_revision tests.test_zcode_runtime_cli.ZCodeRuntimeCliTests.test_planner_operations_cover_initial_revision_delta_and_subgraph -v
```

Expected: PASS.

- [ ] **Step 6: Record logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): dispatch planner actions through bindings`.

---

### Task 4: Split candidate selection from action activation and batch Owners/Reviews

**Files:**
- Modify: ZCode goal-dag source.
- Test: `tests/test_zcode_runtime_cli.py`

**Interfaces:**
- Produces:
  - `selectDispatchCandidates(...)`
  - `makeDispatchBatch(...)`
  - `buildActionBinding(...)`
  - `activateActionOffer(...)`
  - CLI `action open`

- [ ] **Step 1: Add failing offer/open/batching tests**

Required tests:

```text
test_dispatch_batch_does_not_mark_offered_tasks_running
test_quick_mode_dispatches_one_owner_action_at_a_time
test_dag_mode_batches_independent_owner_actions
test_dag_batch_respects_parallel_limit
test_dag_batch_excludes_dependency_conflicts
test_dag_batch_excludes_owner_lease_conflicts
test_dag_batch_excludes_writable_scope_conflicts
test_next_actions_dispatches_independent_implementation_reviewer
test_action_open_atomically_creates_binding_and_marks_task_running
test_action_open_rejects_wrong_agent_token_revision_and_bundle_digest
```

- [ ] **Step 2: Run and confirm current reservation mutates too early**

Expected: offered tasks become running under old reserve path, causing tests to fail.

- [ ] **Step 3: Implement pure candidate selection**

Reuse existing dependency, critical-path, parallel, lease and `tasksConflict` calculations, but perform no writes.

- [ ] **Step 4: Implement safe batch construction**

Use Registry operation/Agent mapping. Quick capacity is always one. Review tasks map to `workflow-implementation-reviewer` and have empty writable scope. Work tasks map to `workflow-owner` and use `execute_owner_run` unless reclaimed.

- [ ] **Step 5: Implement atomic `action open`**

Validate offer revision, Plan/source digest, bundle digest, Agent ID, operation and open token. Under locks:

- acquire Owner lease when required;
- increment attempt;
- mark exactly one task/subject running;
- capture baseline;
- set opaque executor ID to `action:<action-id>`;
- activate the precomputed Binding without changing its semantic fields.

Repeated/stale open fails with a stable code.

- [ ] **Step 6: Run focused batching/open tests**

```bash
node tooling/zcode-workflow/build.mjs
python3 -m unittest tests.test_zcode_runtime_cli -v
```

Expected: owner/review offer and open tests PASS.

- [ ] **Step 7: Record logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): add safe action batching and activation`.

---

### Task 5: Add result submission and mechanical reconcile

**Files:**
- Modify: ZCode goal-dag source.
- Test: `tests/test_zcode_runtime_cli.py`

**Interfaces:**
- Produces:
  - `action result`
  - `workflow reconcile`
  - `reconcileSubmittedAction()`
  - `acceptActionResult()`

- [ ] **Step 1: Add failing result integrity tests**

Required tests:

```text
test_action_result_rejects_stale_attempt
test_action_result_rejects_duplicate_submission
test_action_result_rejects_binding_digest_mismatch
test_action_result_rejects_unauthorized_result_action
test_result_submission_does_not_complete_task_before_reconcile
test_reconcile_accepts_valid_owner_result_and_unbinds_owner
test_reconcile_accepts_plan_submission_and_plan_review
test_runtime_executes_source_diff_commit_and_owner_integration_actions_mechanically
```

- [ ] **Step 2: Run and observe missing commands**

Expected: FAIL.

- [ ] **Step 3: Implement exact result parser and candidate write**

`action result` reads `WORKFLOW_ACTION_RESULT_V1` from stdin, validates action ID, attempt, binding digest, result token and allowed result action, then writes once. It does not mutate core task status.

- [ ] **Step 4: Implement reconcile acceptance**

For owner complete, run Plan-bound verification, scope/diff checks, Owner integration and existing finish validations. For Planner/Plan Review, invoke existing semantic submit validators. For review, preserve independent reviewer subject and zero writable scope.

After terminal acceptance:

```typescript
ownerState.bound_executor_id = null;
ownerState.status = "unbound";
ownerState.current_task_id = null;
```

Keep capsule/result history.

- [ ] **Step 5: Run result/reconcile tests**

```bash
node tooling/zcode-workflow/build.mjs
python3 -m unittest tests.test_zcode_runtime_cli -v
```

Expected: PASS.

- [ ] **Step 6: Record logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): reconcile stateless action results`.

---

### Task 6: Add explicit reclaim and repair semantics

**Files:**
- Modify: ZCode goal-dag source.
- Test: `tests/test_zcode_runtime_cli.py`

**Interfaces:**
- Produces `action reclaim` and `repair_owner_run` offers.

- [ ] **Step 1: Add failing crash/reclaim tests**

Required tests:

```text
test_open_action_without_result_reports_running_and_requires_user_reclaim
test_dag_reclaim_preserves_worktree_and_dispatches_repair_owner_run
test_quick_dirty_reclaim_returns_user_action
test_reclaim_requires_confirmation_token
```

- [ ] **Step 2: Run and observe failures**

Expected: no explicit reclaim flow exists.

- [ ] **Step 3: Implement `action reclaim`**

Require current running action, a runtime-issued confirmation token and user decision flow. Do not infer Agent liveness. DAG preserves worktree and next offer uses `repair_owner_run`. Quick with dirty unaccepted changes returns `user_action`; no rollback.

- [ ] **Step 4: Run reclaim tests**

```bash
node tooling/zcode-workflow/build.mjs
python3 -m unittest tests.test_zcode_runtime_cli -v
```

Expected: PASS.

- [ ] **Step 5: Record logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): add explicit workflow action reclaim`.

---

### Task 7: Make Git/worktree lifecycle mechanical and migrate safe legacy workflows

**Files:**
- Modify: ZCode goal-dag source.
- Test: `tests/test_zcode_runtime_cli.py`

**Interfaces:**
- Produces:
  - `ensureDagWorktree(workspaceRoot, developmentKey)`
  - `ensureOwnerWorktree(goalDirectory, ownerId)`
  - `workflow migrate-actions`

- [ ] **Step 1: Add failing mechanical-worktree and migration tests**

Tests:

```text
test_dag_start_creates_runtime_worktree_without_main_handoff_agent
test_owner_offer_has_runtime_prepared_worktree
test_unstarted_legacy_plan_migrates_only_by_explicit_command
test_completed_legacy_workflow_remains_read_only
test_active_legacy_workflow_never_auto_migrates
```

- [ ] **Step 2: Run and observe old handoff/thread failures**

Expected: old workflow emits `sub-thread-coordination` and Agent-created worktree instructions.

- [ ] **Step 3: Implement mechanical worktree preparation**

Runtime creates DAG and Owner worktrees before offering owner work. Dispatch contains no Git commands. Integration remains a runtime reconcile action.

- [ ] **Step 4: Implement explicit migration**

Under locks, re-inspect. Only all-pending/attempt-zero/no-result/no-lease/no-watch workflows are migratable. Back up routes/threads metadata, mark execution mode action, update necessary digests, and never infer one-shot actions from old threads.

- [ ] **Step 5: Run focused tests**

```bash
node tooling/zcode-workflow/build.mjs
python3 -m unittest tests.test_zcode_runtime_cli -v
```

Expected: PASS.

- [ ] **Step 6: Record logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): make workflow worktrees runtime-owned`.

---

### Task 8: Remove public Supervisor/thread CLI and finalize runtime cleanup

**Files:**
- Modify: ZCode goal-dag source and generated runtime.
- Test: `tests/test_zcode_runtime_cli.py`, `tests/test_zcode_build.py`

**Interfaces:**
- Removes old ZCode public thread/supervisor cases.

- [ ] **Step 1: Add source-scan and CLI-rejection tests**

Assert the final ZCode runtime has no public cases or dispatches for:

```text
workflow step
workflow dispatch
workflow review
workflow attach
workflow thread
workflow observe
workflow supervisor-init
worker open/verify/complete/block/fail/request-*
thread-registry
supervisor *
create_thread
wait_threads
send_message_to_thread
app-server --stdio
```

- [ ] **Step 2: Run and observe failures**

Expected: many old cases remain.

- [ ] **Step 3: Remove Supervisor/thread public blocks**

Delete ZCode-only Supervisor registry/state/facade/recovery/prompt code. Replace old `workflow step` with `workflow next-actions`; remove continuation payloads that name old skills or threads. Cleanup action directories instead of `threads.json` for new workflows.

- [ ] **Step 4: Add final public CLI usage text**

Usage lists only the locked public action CLI plus necessary workflow setup/runtime-internal commands. It must not advertise old Agent worker commands.

- [ ] **Step 5: Run runtime and build regression suites**

```bash
node tooling/zcode-workflow/build.mjs
node tooling/zcode-workflow/build.mjs --check
python3 -m unittest tests.test_zcode_runtime_cli tests.test_zcode_build -v
python3 -m unittest tests.test_goal_dag_cli -v
```

Expected: all PASS.

- [ ] **Step 6: Verify protected trees**

```bash
git diff --exit-code -- claude-code-market codex-market .agents .codex
```

Expected: no diff.

- [ ] **Step 7: Stop for runtime review**

Do not proceed to Agent templates/installer until public receipts, operation names and CLI signatures are stable.
