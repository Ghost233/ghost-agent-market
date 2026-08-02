# ZCode Stateless Agent Workflow Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ZCode's thread/Supervisor-oriented workflow with a Registry-driven, stateless Action/Binding/Result runtime that dispatches one bounded operation to one short-lived Agent at a time.

**Architecture:** Main remains the only dispatcher; the ZCode runtime owns all persistent state and mechanical scheduling; four semantic workflow Agents and seven utility/safety Agents execute Registry-authorized operations. A dedicated ZCode-only build lane produces runtime artifacts without modifying Claude Code or Codex outputs.

**Tech Stack:** Node.js 22 ESM, TypeScript stripped with `node:module.stripTypeScriptTypes`, Python 3.11 `unittest`, JSON Schema Draft 2020-12, Git, ZCode Markdown Skills/Agents.

## Global Constraints

- Implement only the confirmed design in `docs/superpowers/specs/2026-08-02-zcode-stateless-agent-workflow-design.md`.
- ZCode-only divergence may modify `zcode-market/`, `tooling/zcode-workflow/`, ZCode-specific tests, root ZCode documentation, and ZCode marketplace metadata.
- Do not modify `claude-code-market/`, `codex-market/`, `.agents/`, or `.codex/`.
- Do not run Claude/Codex Skill sync scripts or Codex cachebuster scripts.
- Do not use ZCode private Session APIs, `app-server --stdio`, private IPC, or hidden thread APIs.
- Main is the only Agent dispatcher; no installed Main or Supervisor Agent is permitted.
- Runtime is the only workflow-state writer; Agents never hand-write Plan, State, Binding, Result, Registry, or Dashboard state.
- Continue installing user Agents only from the online GitHub repository `Ghost233/ghost-agent-market`; no clone, local path, `file://`, or offline marketplace deployment.
- The canonical Agent bundle contract is `ZCODE_AGENT_BUNDLE_V2`, bundle version `2.0.0`.
- The canonical workflow config contract is `ZCODE_WORKFLOW_CONFIG_V2`.
- The workflow plugin base version changes from `0.1.5` to `0.1.6`.
- The ordinary skills plugin base version changes from `0.1.3` to `0.1.4` because the two retained Git Skills/Templates join the Registry contract.
- `rtk-hook` remains `0.1.0`.
- Do not commit, tag, or push unless the user separately and explicitly authorizes that action.
- Before any authorized commit, verify Git identity is exactly `Ghost233` and `only.yesc@gmail.com`.
- Use TDD: add a focused failing test, observe the expected failure, implement the minimum behavior, then rerun focused and relevant regression tests.

---

## Plan Set and Dependency Graph

Execute these plans in order:

```text
01 Registry + ZCode build lane
          |
          v
02 Config V2 + Dashboard lifecycle
          |
          v
03 Stateless runtime Action protocol
          |
          v
04 Agent/Skill bundle + transactional installer
          |
          v
05 Integration, docs, versions, release verification
```

Plan files:

1. `docs/superpowers/plans/2026-08-02-zcode-stateless-agent-workflow-01-registry-build.md`
2. `docs/superpowers/plans/2026-08-02-zcode-stateless-agent-workflow-02-config-dashboard.md`
3. `docs/superpowers/plans/2026-08-02-zcode-stateless-agent-workflow-03-runtime-actions.md`
4. `docs/superpowers/plans/2026-08-02-zcode-stateless-agent-workflow-04-agents-installer.md`
5. `docs/superpowers/plans/2026-08-02-zcode-stateless-agent-workflow-05-integration-release.md`

Each plan ends at an independently testable checkpoint. Do not start a dependent plan while its consumed interfaces are still changing.

## Locked Public Interfaces

### Canonical Agents

Exactly these 11 Agent IDs are installed:

```text
workflow-planner
workflow-plan-reviewer
workflow-owner
workflow-implementation-reviewer
workflow-config-reader
workflow-config-writer
workflow-dashboard-starter
workflow-dashboard-status-reader
workflow-dashboard-stopper
git-commit
git-merge-conflict
```

There is no `workflow-main` and no Supervisor Agent.

### Canonical Skills

Exactly these 8 Skill IDs are Registry-owned:

```text
ghost-agent-workflow:workflow-coordination
ghost-agent-workflow:workflow-planning
ghost-agent-workflow:workflow-plan-review
ghost-agent-workflow:workflow-bound-run
ghost-agent-workflow:workflow-config
ghost-agent-workflow:workflow-dashboard
ghost-agent-skills:git-commit
ghost-agent-skills:git-merge-conflict
```

### Workflow Operations

```text
initial_plan
revise_plan
apply_global_delta
expand_subgraph
review_plan_revision
execute_owner_run
repair_owner_run
review_implementation
```

### Config Operations

```text
show_strict
validate_strict
init
migrate
set_parallel
set_execution_class
```

### Dashboard Operations

```text
start_dashboard
read_dashboard_status
stop_dashboard
```

### Runtime Receipts

```text
WORKFLOW_DISPATCH_BATCH_V1
WORKFLOW_RUNTIME_ACTION_V1
WORKFLOW_USER_ACTION_V1
WORKFLOW_COMPLETED_V1
WORKFLOW_FAILED_V1
WORKFLOW_ACTION_OFFER_V1
WORKFLOW_ACTION_BINDING_V1
WORKFLOW_ACTION_RESULT_V1
```

### Public Runtime CLI

```text
workflow next-actions <workflow-dir>
workflow reconcile <workflow-dir>
workflow migrate-actions <workflow-dir>
action open <workflow-dir> <action-id> <open-token>
action result <workflow-dir> <action-id>
action reclaim <workflow-dir> <action-id> <confirmation-token>
```

### Workflow Config V2

```json
{
  "contract": "ZCODE_WORKFLOW_CONFIG_V2",
  "parallel": 4,
  "execution_classes": {
    "planner": "main",
    "planner_reviewer": "main",
    "owner": "main",
    "review": "main"
  }
}
```

The only execution-class values are `main` and `lite`.

## Locked File Ownership

### Canonical source files

```text
zcode-market/agent-registry.json
zcode-market/agent-registry.schema.json
tooling/zcode-workflow/agent-registry.mjs
tooling/zcode-workflow/workflow-config.mjs
tooling/zcode-workflow/dashboard-lifecycle.mjs
tooling/zcode-workflow/start-dashboard.mjs
tooling/zcode-workflow/dashboard-status.mjs
tooling/zcode-workflow/stop-dashboard.mjs
tooling/zcode-workflow/goal-dag.ts
tooling/zcode-workflow/build.mjs
```

### Generated plugin artifacts

```text
zcode-market/plugins/ghost-agent-workflow/scripts/agent-registry.mjs
zcode-market/plugins/ghost-agent-workflow/scripts/workflow-config.mjs
zcode-market/plugins/ghost-agent-workflow/scripts/start-dashboard.mjs
zcode-market/plugins/ghost-agent-workflow/scripts/dashboard-status.mjs
zcode-market/plugins/ghost-agent-workflow/scripts/stop-dashboard.mjs
zcode-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs
```

The ZCode builder must write only below `zcode-market/plugins/ghost-agent-workflow/`.

## Shared Testing Support

Create `tests/zcode_test_support.py` during Plan 01. Later plans consume:

```python
def run_json_cli(argv: list[str], *, stdin: dict | None = None) -> tuple[subprocess.CompletedProcess[str], dict | None]
def snapshot_tree(root: Path) -> dict[str, tuple[bytes, int]]
def sha256_bytes(value: bytes) -> str
def load_agent_registry() -> dict
def assert_zero_write(testcase: unittest.TestCase, before: dict, after: dict) -> None
```

Do not duplicate subprocess and filesystem-snapshot helpers across ZCode tests.

## Verification Layers

Every subplan runs its focused tests. Plan 05 runs the complete matrix:

```bash
node tooling/zcode-workflow/build.mjs --check
python3 -m unittest discover -s tests -p 'test_zcode_*.py' -v
node --test tests/test_zcode_dashboard.mjs
python3 -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/test_start_dashboard.mjs
git diff --exit-code -- claude-code-market codex-market .agents .codex
```

Expected final result: all tests pass and the protected platform guard prints no diff.

## Authorization-Gated Git Step

Every task may identify a logical commit boundary, but implementation must stop before `git add`, `git commit`, tag creation, or push unless the user explicitly authorizes it. When authorization is later given, use the `git-commit` Skill and verify repository Git identity first.
