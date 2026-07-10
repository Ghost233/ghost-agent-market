# Ghost Agent Workflow Codex Plugin

Codex plugin packaging for:

- `parallel-task-planner`
- `thread-coordination`
- `thread-goal-worker`
- `git-commit`

`parallel-task-planner` writes v2 dependency-safe plans. With explicit user authorization, `thread-coordination` creates one retained user-visible child thread per ready module in the current project's local workspace, applies the module profile at thread creation, and aggregates bound `WORKER_RESULT` values. `thread-goal-worker` owns goal, scope, verification, and diff self-check inside that module thread.

Module threads may use ordinary internal subagents, but the coordinator does not configure or track those internal agents.
