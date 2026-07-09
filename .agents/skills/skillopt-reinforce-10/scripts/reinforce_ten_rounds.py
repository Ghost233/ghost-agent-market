#!/usr/bin/env python3
"""Run one reviewed SkillOpt task corpus through exactly ten gated updates."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

ROUNDS = 10
REAL_BACKENDS = ("claude", "codex", "copilot")


def _error(message: str) -> None:
    raise SystemExit(f"skillopt-reinforce-10: {message}")


def _add_checkout_to_path(project: Path) -> None:
    candidates: list[Path] = []
    configured = os.environ.get("SKILLOPT_REPO")
    if configured:
        candidates.append(Path(configured).expanduser())

    current = Path.cwd().resolve()
    candidates.extend([project, project / "SkillOpt", current, current / "SkillOpt"])
    for parent in current.parents:
        candidates.extend([parent, parent / "SkillOpt"])

    for candidate in candidates:
        if (candidate / "skillopt_sleep").is_dir():
            sys.path.insert(0, str(candidate))
            return


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run exactly ten validation-gated SkillOpt reinforcement rounds."
    )
    parser.add_argument("--project", required=True, help="Project that owns the target skill")
    parser.add_argument("--target-skill-path", required=True, help="Existing target SKILL.md")
    parser.add_argument("--tasks-file", required=True, help="Reviewed TaskRecord JSON corpus")
    parser.add_argument("--backend", required=True, choices=REAL_BACKENDS)
    parser.add_argument("--source", required=True, choices=("claude", "codex", "auto"))
    parser.add_argument("--confirm-auto-adopt", action="store_true")
    parser.add_argument("--model", default="")
    parser.add_argument("--codex-path", default="")
    parser.add_argument("--claude-home", default=os.path.expanduser("~/.claude"))
    parser.add_argument("--codex-home", default=os.path.expanduser("~/.codex"))
    parser.add_argument("--edit-budget", type=int, default=4)
    parser.add_argument("--dream-rollouts", type=int, default=1)
    parser.add_argument("--recall-k", type=int, default=8)
    return parser.parse_args()


def _validate_paths(args: argparse.Namespace) -> tuple[Path, Path, Path]:
    project = Path(args.project).expanduser().resolve()
    target = Path(args.target_skill_path).expanduser().resolve()
    tasks_file = Path(args.tasks_file).expanduser().resolve()

    if not project.is_dir():
        _error(f"project is not a directory: {project}")
    if not target.is_file() or target.name != "SKILL.md":
        _error(f"target must be an existing SKILL.md: {target}")
    try:
        target.relative_to(project)
    except ValueError:
        _error(f"target SKILL.md must be inside project: {project}")
    if not tasks_file.is_file():
        _error(f"reviewed task corpus does not exist: {tasks_file}")
    if args.edit_budget < 1:
        _error("edit budget must be at least 1")
    if args.dream_rollouts < 1:
        _error("dream rollouts must be at least 1")
    if args.recall_k < 0:
        _error("recall-k cannot be negative")
    if not args.confirm_auto_adopt:
        _error("pass --confirm-auto-adopt only after explicit user approval")
    return project, target, tasks_file


def _print_round(summary: dict[str, Any]) -> None:
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))


def main() -> int:
    args = _parse_args()
    project, target, tasks_file = _validate_paths(args)
    _add_checkout_to_path(project)

    try:
        from skillopt_sleep.config import load_config
        from skillopt_sleep.cycle import run_sleep_cycle
        from skillopt_sleep.tasks_file import load_tasks_file
    except ModuleNotFoundError:
        _error(
            "cannot import skillopt_sleep; set SKILLOPT_REPO to a SkillOpt checkout "
            "or install the skillopt package"
        )

    tasks, metadata = load_tasks_file(str(tasks_file))
    if metadata.get("reviewed") is not True:
        _error("task corpus is not reviewed; inspect it and set reviewed=true first")
    recorded_target = metadata.get("target_skill_path") or ""
    if recorded_target:
        corpus_target = Path(recorded_target).expanduser()
        if not corpus_target.is_absolute():
            corpus_target = project / corpus_target
        if corpus_target.resolve() != target:
            _error("task corpus belongs to a different target skill")
    if len(tasks) < 4:
        _error("task corpus needs at least four real tasks for a meaningful held-out gate")

    summaries: list[dict[str, Any]] = []
    for round_number in range(1, ROUNDS + 1):
        config = load_config(
            projects="invoked",
            invoked_project=str(project),
            target_skill_path=str(target),
            backend=args.backend,
            model=args.model,
            codex_path=args.codex_path,
            claude_home=args.claude_home,
            codex_home=args.codex_home,
            transcript_source=args.source,
            edit_budget=args.edit_budget,
            dream_rollouts=args.dream_rollouts,
            recall_k=args.recall_k,
            evolve_memory=False,
            evolve_skill=True,
            gate_mode="on",
            auto_adopt=True,
            progress=True,
        )
        outcome = run_sleep_cycle(config, seed_tasks=tasks)
        report = outcome.report
        summary = {
            "round": round_number,
            "night": report.night,
            "tasks": report.n_tasks,
            "baseline_score": report.baseline_score,
            "candidate_score": report.candidate_score,
            "gate_action": report.gate_action,
            "accepted": report.accepted,
            "accepted_edits": len(report.edits),
            "rejected_edits": len(report.rejected_edits),
            "staging_dir": outcome.staging_dir,
            "adopted": outcome.adopted,
            "adopted_paths": outcome.adopted_paths,
        }
        summaries.append(summary)
        _print_round(summary)

    print(json.dumps({"rounds_completed": ROUNDS, "rounds": summaries}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
