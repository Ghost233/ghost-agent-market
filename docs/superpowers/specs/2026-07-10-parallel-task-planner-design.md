# Parallel Task Planner Design

## Goal

Add a lightweight `$parallel-task-planner` skill that turns either a natural-language request or an existing plan document into a small, executable parallel-task plan. When the plan passes explicit safety gates, it immediately hands the plan to `$thread-coordination`, which dispatches independent modules to `$thread-goal-worker` threads and performs a simple overall completion check.

The design is for tasks the user already knows are plausibly parallel. It does not create a persistent ownership registry, a cross-thread goal-control service, or a general project-management system.

## Entry Points

The planner accepts either:

1. A natural-language request containing the desired work and any known constraints.
2. A path to an existing plan document. The planner preserves its decisions and converts only its executable work into modules.

The skill does the minimum repository reading needed to confirm paths, dependencies, and write-conflict risk. When it cannot establish safe parallelism from the supplied material and that evidence, it does not dispatch workers.

## Output Contract

The planner writes one concise contract document at:

```text
docs/parallel-task-plans/YYYY-MM-DD-<goal-slug>.md
```

The document has this stable shape:

```yaml
parent_goal: <one-sentence outcome>
source: natural_language | <plan path>
modules:
  - id: M1
    task: <single executable outcome>
    writable_paths:
      - <path or narrow glob>
    depends_on: []
    done_when:
      - <observable completion condition>
    verification:
      - <targeted command or equivalent evidence>
    worker_context: <only the necessary source context>
safety:
  status: parallel_safe | sequential_only | needs_user_review
  reasons:
    - <decision evidence>
dispatch:
  batches:
    - [M1, M2]
```

The plan is the only handoff contract consumed by the coordination skill. It replaces verbose chat-history forwarding and is retained as an audit-friendly record of why modules were run concurrently.

## Safety Gates

`parallel_safe` requires all of the following:

- At least two executable modules exist.
- Each module has a narrow, non-overlapping writable scope. Shared files, API contracts, migrations, generated outputs, and global configuration belong to one module or are serialized.
- The dependency graph is acyclic; every module in a dispatch batch has all dependencies satisfied.
- Every module has a measurable `done_when` and targeted verification.
- Verification commands or their artifacts cannot race with other running modules. Conflicting verification is put in a later batch.
- The parent goal's completion conditions are covered by one or more modules.

Any uncertainty about writable scope, a hidden shared contract, or an incomplete task becomes `needs_user_review`. A plan with genuine dependencies but no ambiguity becomes `sequential_only`; it is documented but not automatically dispatched in parallel.

## Automatic Dispatch

For `parallel_safe` plans, the planner invokes `$thread-coordination` immediately with the generated plan path. It does not re-decompose the work.

`thread-coordination` gains a lightweight `parallel-plan` mode:

1. Read the plan and dispatch each ready module to a worker thread.
2. Keep writes disjoint and honor the planned batches.
3. Collect a concise result for every module.
4. Check plan coverage, declared verification, cross-module file conflicts, unresolved items, and `git diff --check` when permitted as a read-only check.
5. Send at most one targeted repair round to the owning worker for a failed or incomplete module.
6. Report `completed`, `partial`, or `blocked` against `parent_goal`.

The coordinator does not edit implementation files and does not create a persistent thread or module registry. Existing threads may be reused only when their visible recent context covers a module; otherwise it creates threads only under the existing user-visible-thread rules.

## Worker Loop

`thread-goal-worker` gains a lightweight `parallel-plan` worker mode. It receives exactly one module and follows a bounded execution loop:

```text
set/confirm child goal -> inspect scoped state -> implement -> verify -> inspect own diff -> repair once -> WORKER_RESULT
```

The worker keeps the existing active-goal and scope protections, but this mode replaces mandatory reviewer-subagent ceremony with a simple self-check of its scoped diff, `done_when`, and verification result. It does not create, route, or manage other threads. A failed verification or unresolved scope question returns `blocked` or `needs_fix` instead of claiming completion.

The minimal result is:

```yaml
module_id: M1
status: completed | needs_fix | blocked
changed_files: []
verification: []
diff_self_check: pass | failed
goal_alignment: <how done_when was met>
risks: []
```

## Bounded Double Loop

The system has two small, explicitly bounded loops:

- Coordinator loop: dispatch -> await results -> check overall completion -> one repair round -> complete, partial, or blocked.
- Worker loop: implement -> verify -> diff self-check -> one repair attempt -> return result.

There is no cross-thread goal mutation, pause-reset state machine, or automatic retry beyond these bounds. A paused, failed, or inaccessible worker is reported to the coordinator as unavailable; the coordinator may make one normal repair/reassignment decision only when the module remains safely isolated.

## Scope and Non-Goals

This feature does not:

- Infer that arbitrary work is parallel merely to use more workers.
- Maintain permanent module ownership or thread affinity.
- Require full-project builds for every module.
- Let the coordinator silently repair worker code.
- Replace a user-authored plan; it preserves plan decisions and only structures execution.

## Marketplace Changes

Create and keep in sync:

- `claude-code-market/skills/parallel-task-planner/`
- `codex-market/plugins/ghost-agent-workflow/skills/parallel-task-planner/`

Add the Codex-facing `agents/openai.yaml` metadata alongside the new skill, matching the repository's existing skill layout. Update both existing thread skills in the Claude Code and Codex trees so their `parallel-plan` contracts, result fields, and safety limits are identical.

## Verification

Implementation verification will check:

1. Both marketplace copies contain equivalent planner and parallel-plan wording.
2. All referenced skill names and plan fields agree across the three skills.
3. A natural-language fixture produces a `parallel_safe` plan with two independent modules.
4. A plan-document fixture preserves dependencies and is `sequential_only` or `needs_user_review` when writes conflict.
5. The coordination instructions contain the one-repair-round limit and final completion checklist.
