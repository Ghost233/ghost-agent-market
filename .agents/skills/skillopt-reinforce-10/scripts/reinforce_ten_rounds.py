#!/usr/bin/env python3
"""Run one reviewed SkillOpt task corpus through exactly ten gated updates."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import shutil
import sys
import tempfile
import uuid
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


class _TrackedBackend:
    def __init__(self, backend: Any) -> None:
        self._backend = backend
        self.errors: list[str] = []

    def __getattr__(self, name: str) -> Any:
        return getattr(self._backend, name)

    def _record_error(self, operation: str, response: Any = None) -> None:
        call_error = str(getattr(self._backend, "last_call_error", "") or "").strip()
        if call_error:
            self.errors.append(f"{operation}: {call_error}")
        if operation in {"attempt", "attempt_with_tools"} and not response:
            self.errors.append(f"{operation}: empty response")

    def attempt(self, *args: Any, **kwargs: Any) -> str:
        response = self._backend.attempt(*args, **kwargs)
        self._record_error("attempt", response)
        return response

    def attempt_with_tools(self, *args: Any, **kwargs: Any) -> tuple[str, list[str]]:
        response, tools = self._backend.attempt_with_tools(*args, **kwargs)
        self._record_error("attempt_with_tools", response)
        return response, tools

    def judge(self, *args: Any, **kwargs: Any) -> tuple[float, float, str]:
        result = self._backend.judge(*args, **kwargs)
        self._record_error("judge")
        return result

    def reflect(self, *args: Any, **kwargs: Any) -> list[Any]:
        result = self._backend.reflect(*args, **kwargs)
        self._record_error("reflect")
        return result

    def _call(self, *args: Any, **kwargs: Any) -> str:
        response = self._backend._call(*args, **kwargs)
        self._record_error("direct_call", response)
        if not response:
            self.errors.append("direct_call: empty response")
        return response


def _validate_task_splits(tasks: list[Any]) -> None:
    train = [task for task in tasks if task.split == "train"]
    validation = [task for task in tasks if task.split == "val"]
    known_splits = {"train", "val", "test"}
    if any(task.split not in known_splits for task in tasks):
        _error("task corpus contains an unknown split")
    if len(train) < 2 or len(validation) < 2:
        _error("task corpus needs at least two train and two validation tasks")

    task_ids: set[str] = set()
    used_sessions: set[str] = set()
    for task in tasks:
        task_id = str(task.id).strip() if isinstance(task.id, str) else ""
        if not task_id or task_id in task_ids:
            _error("reviewed tasks must have unique non-empty string ids")
        task_ids.add(task_id)
        if task.origin != "real":
            _error("all reviewed train, validation, and test tasks must have origin=real")
        if not isinstance(task.source_sessions, list) or not task.source_sessions:
            _error(f"reviewed task has no source session: {task.id}")
        sessions: set[str] = set()
        for source_session in task.source_sessions:
            if not isinstance(source_session, str) or not source_session.strip():
                _error(f"reviewed task has an invalid source session: {task.id}")
            normalized = source_session.strip()
            if normalized in sessions:
                _error(f"reviewed task repeats a source session: {task.id}")
            sessions.add(normalized)
        if sessions & used_sessions:
            _error("reviewed tasks must use independent source sessions")
        used_sessions.update(sessions)


def _validate_corpus_source(metadata: dict[str, Any], requested_source: str) -> None:
    recorded_source = str(metadata.get("transcript_source") or "").strip()
    if not recorded_source:
        _error("task corpus has no transcript_source metadata")
    if recorded_source != requested_source:
        _error(
            "task corpus source does not match --source: "
            f"{recorded_source!r} != {requested_source!r}"
        )


def _configure_backend_environment(args: argparse.Namespace) -> None:
    if args.backend != "codex":
        return
    codex_home = Path(args.codex_home).expanduser().resolve()
    if not codex_home.is_dir():
        _error(f"codex home is not a directory: {codex_home}")
    os.environ["CODEX_HOME"] = str(codex_home)


def _sanitize_report_backend(staging_dir: str, backend: str) -> None:
    report_path = Path(staging_dir) / "report.md"
    try:
        lines = report_path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        _error(f"cannot read round report: {report_path}: {exc}")
    normalized = [
        f"- backend: `{backend}`" if line.startswith("- backend: ") else line
        for line in lines
    ]
    report_path.write_text("\n".join(normalized) + "\n", encoding="utf-8")


def _validate_diagnostics(
    staging_dir: str,
    backend: str,
    expected_holdout_ids: list[str],
) -> dict[str, Any]:
    diagnostics_path = Path(staging_dir) / "diagnostics.json"
    try:
        diagnostics = json.loads(diagnostics_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        _error(f"cannot read round diagnostics: {diagnostics_path}: {exc}")

    if diagnostics.get("backend") != backend:
        _error(
            "round diagnostics used an unexpected backend: "
            f"{diagnostics.get('backend')!r}"
        )
    if diagnostics.get("gate_mode") != "on":
        _error("round diagnostics show that the validation gate was not enabled")

    call_error = str(diagnostics.get("call_error") or "").strip()
    if call_error:
        _error(f"backend call failed: {call_error[:500]}")

    holdout = diagnostics.get("holdout_detail")
    if not isinstance(holdout, list) or len(holdout) != len(expected_holdout_ids):
        _error("round diagnostics have incomplete held-out evidence")
    observed_ids: list[str] = []
    for item in holdout:
        if not isinstance(item, dict):
            _error("round diagnostics contain malformed held-out evidence")
        item_id = item.get("id")
        response_len = item.get("response_len")
        if not isinstance(item_id, str) or not item_id:
            _error("round diagnostics contain a held-out task without an id")
        if not isinstance(response_len, int) or isinstance(response_len, bool):
            _error("round diagnostics contain an invalid held-out response length")
        if response_len <= 0:
            _error("a held-out backend response was empty")
        observed_ids.append(item_id)
    if sorted(observed_ids) != sorted(expected_holdout_ids):
        _error("round diagnostics do not match the validation task ids")
    return diagnostics


def _validate_staging_manifest(
    staging_dir: str,
    project: Path,
    target: Path,
) -> bytes:
    staging = Path(staging_dir).resolve()
    try:
        staging.relative_to(project)
    except ValueError:
        _error(f"staging directory is outside the project: {staging}")
    manifest_path = staging / "manifest.json"
    try:
        manifest_bytes = manifest_path.read_bytes()
        manifest = json.loads(manifest_bytes.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        _error(f"cannot read staging manifest: {manifest_path}: {exc}")
    if manifest.get("has_skill") is not True:
        _error("accepted staging manifest does not contain a skill proposal")
    if manifest.get("has_memory") is not False:
        _error("accepted staging manifest unexpectedly contains a memory proposal")
    live_skill = Path(str(manifest.get("live_skill_path") or "")).expanduser()
    if live_skill.resolve() != target:
        _error("accepted staging manifest points to a different target skill")
    proposal_path = staging / "proposed_SKILL.md"
    if not proposal_path.is_file():
        _error("accepted staging manifest has no proposed_SKILL.md")
    proposal = proposal_path.read_bytes()
    if (
        manifest_path.read_bytes() != manifest_bytes
        or proposal_path.read_bytes() != proposal
    ):
        _error("accepted staging changed while it was being snapshotted")
    return proposal


def _atomic_write_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(
        f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    )
    try:
        with temporary.open("xb") as handle:
            handle.write(content)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _publish_exclusive_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(
        f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    )
    try:
        with temporary.open("xb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _acquire_resource_locks(resources: list[Path]) -> list[Any]:
    lock_root = Path(tempfile.gettempdir()) / "skillopt-reinforce-10-locks"
    lock_root.mkdir(parents=True, exist_ok=True)
    handles: list[Any] = []
    try:
        for resource in sorted({str(path.resolve()) for path in resources}):
            digest = uuid.uuid5(uuid.NAMESPACE_URL, resource).hex
            handle = (lock_root / f"{digest}.lock").open("a+b")
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                handle.close()
                _error(f"another reinforcement run owns this resource: {resource}")
            handles.append(handle)
    except BaseException:
        _release_resource_locks(handles)
        raise
    return handles


def _release_resource_locks(handles: list[Any]) -> None:
    for handle in reversed(handles):
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()


def _process_is_alive(pid: Any) -> bool:
    if not isinstance(pid, int):
        return True
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


class _RoundTransaction:
    def __init__(self, canonical_state: Path, target: Path) -> None:
        self.canonical_state = canonical_state.resolve()
        self.target = target.resolve()
        canonical_state = self.canonical_state
        target = self.target
        self.state_existed = canonical_state.is_file()
        self.state_before = canonical_state.read_bytes() if self.state_existed else b""
        self.target_before = target.read_bytes()
        canonical_state.parent.mkdir(parents=True, exist_ok=True)
        self.directory = Path(
            tempfile.mkdtemp(prefix=".round-", dir=canonical_state.parent)
        ).resolve()
        self.transaction_state = self.directory / "state.json"
        self.state_backup = self.directory / "state.before"
        self.target_backup = self.directory / "target.before"
        self.target_after = self.directory / "target.after"
        self.commit_started = self.directory / "commit.started"
        self.marker = Path(f"{canonical_state}.pending.json")
        self.target_backup.write_bytes(self.target_before)
        if self.state_existed:
            self.state_backup.write_bytes(self.state_before)
            self.transaction_state.write_bytes(self.state_before)


def _recover_pending_transaction(
    canonical_state: Path,
    target: Path,
    *,
    allow_current_process: bool = False,
) -> None:
    canonical_state = canonical_state.resolve()
    target = target.resolve()
    marker = Path(f"{canonical_state}.pending.json")
    if not marker.is_file():
        return
    try:
        payload = json.loads(marker.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        _error(f"cannot read pending round transaction: {marker}: {exc}")
    owner_pid = payload.get("pid")
    if _process_is_alive(owner_pid) and not (
        allow_current_process and owner_pid == os.getpid()
    ):
        _error(f"another round transaction is active: {marker}")
    if Path(str(payload.get("target") or "")).resolve() != target:
        _error("pending round transaction belongs to a different target")
    directory = Path(str(payload.get("directory") or "")).resolve()
    if (
        directory.parent != canonical_state.parent.resolve()
        or not directory.name.startswith(".round-")
    ):
        _error("pending round transaction directory is invalid")
    target_backup = directory / "target.before"
    target_after = directory / "target.after"
    state_backup = directory / "state.before"
    transaction_state = directory / "state.json"
    if not target_backup.is_file() or not target_after.is_file():
        _error("pending round transaction has incomplete target snapshots")
    if not transaction_state.is_file():
        _error("pending round transaction has no candidate state")
    commit_started = directory / "commit.started"
    if payload.get("protocol") == 2 and not commit_started.is_file():
        marker.unlink(missing_ok=True)
        shutil.rmtree(directory, ignore_errors=True)
        return

    current_target = target.read_bytes()
    if current_target not in {target_backup.read_bytes(), target_after.read_bytes()}:
        _error("target changed outside the pending round transaction")
    current_state = canonical_state.read_bytes() if canonical_state.is_file() else b""
    allowed_states = {transaction_state.read_bytes()}
    if payload.get("state_existed") is True:
        if not state_backup.is_file():
            _error("pending round transaction has no state backup")
        allowed_states.add(state_backup.read_bytes())
    else:
        allowed_states.add(b"")
    if current_state not in allowed_states:
        _error("SkillOpt state changed outside the pending round transaction")

    _atomic_write_bytes(target, target_backup.read_bytes())
    if payload.get("state_existed") is True:
        _atomic_write_bytes(canonical_state, state_backup.read_bytes())
    else:
        canonical_state.unlink(missing_ok=True)
    marker.unlink(missing_ok=True)
    shutil.rmtree(directory, ignore_errors=True)


def _begin_round_transaction(
    canonical_state: Path,
    target: Path,
) -> _RoundTransaction:
    _recover_pending_transaction(canonical_state, target)
    return _RoundTransaction(canonical_state, target)


def _commit_round_transaction(
    transaction: _RoundTransaction,
    proposal: bytes | None,
    staging_dir: str,
) -> list[str]:
    if not transaction.transaction_state.is_file():
        _error("sleep cycle did not produce transaction state")

    marker_payload = {
        "protocol": 2,
        "pid": os.getpid(),
        "directory": str(transaction.directory),
        "target": str(transaction.target),
        "state_existed": transaction.state_existed,
    }
    transaction.target_after.write_bytes(
        proposal if proposal is not None else transaction.target_before
    )
    try:
        _publish_exclusive_bytes(
            transaction.marker,
            json.dumps(marker_payload).encode("utf-8"),
        )
    except FileExistsError:
        shutil.rmtree(transaction.directory, ignore_errors=True)
        _error(f"another round transaction is active: {transaction.marker}")

    adopted_paths: list[str] = []
    try:
        current_state = (
            transaction.canonical_state.read_bytes()
            if transaction.canonical_state.is_file()
            else b""
        )
        if (
            current_state != transaction.state_before
            or transaction.target.read_bytes() != transaction.target_before
        ):
            transaction.marker.unlink()
            _error("target skill or SkillOpt state changed during the round")
        _publish_exclusive_bytes(transaction.commit_started, b"started\n")
        if proposal is not None:
            backup_dir = Path(staging_dir) / "backup"
            backup_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(transaction.target, backup_dir / transaction.target.name)
            _atomic_write_bytes(transaction.target, proposal)
            adopted_paths = [str(transaction.target)]
        _atomic_write_bytes(
            transaction.canonical_state,
            transaction.transaction_state.read_bytes(),
        )
        transaction.marker.unlink()
    except BaseException:
        _recover_pending_transaction(
            transaction.canonical_state,
            transaction.target,
            allow_current_process=True,
        )
        raise
    finally:
        if not transaction.marker.exists():
            shutil.rmtree(transaction.directory, ignore_errors=True)
    return adopted_paths


def _validate_adopted_paths(adopted_paths: list[str], target: Path) -> None:
    if [Path(path).resolve() for path in adopted_paths] != [target.resolve()]:
        _error("round adopted a path other than the exact target skill")


def _load_cycle_config(
    load_config: Any,
    args: argparse.Namespace,
    project: Path,
    target: Path,
) -> Any:
    return load_config(
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
        auto_adopt=False,
        progress=True,
    )


def main() -> int:
    args = _parse_args()
    project, target, tasks_file = _validate_paths(args)
    _configure_backend_environment(args)
    _add_checkout_to_path(project)

    try:
        import skillopt_sleep.cycle as cycle_module
        from skillopt_sleep.config import load_config
        from skillopt_sleep.staging import redact_secrets
        from skillopt_sleep.tasks_file import load_tasks_file
    except ModuleNotFoundError:
        _error(
            "cannot import skillopt_sleep; set SKILLOPT_REPO to a SkillOpt checkout "
            "or install the skillopt package"
        )

    tasks, metadata = load_tasks_file(str(tasks_file))
    if metadata.get("reviewed") is not True:
        _error("task corpus is not reviewed; inspect it and set reviewed=true first")
    _validate_corpus_source(metadata, args.source)
    recorded_target = metadata.get("target_skill_path") or ""
    if recorded_target:
        corpus_target = Path(recorded_target).expanduser()
        if not corpus_target.is_absolute():
            corpus_target = project / corpus_target
        if corpus_target.resolve() != target:
            _error("task corpus belongs to a different target skill")
    if len(tasks) < 4:
        _error("task corpus needs at least four real tasks for a meaningful held-out gate")
    _validate_task_splits(tasks)
    validation_task_ids = [task.id for task in tasks if task.split == "val"]

    summaries: list[dict[str, Any]] = []
    trackers: list[_TrackedBackend] = []
    original_get_backend = cycle_module.get_backend

    def get_tracked_backend(*backend_args: Any, **backend_kwargs: Any) -> Any:
        tracker = _TrackedBackend(
            original_get_backend(*backend_args, **backend_kwargs)
        )
        trackers.append(tracker)
        return tracker

    lock_config = _load_cycle_config(load_config, args, project, target)
    canonical_state = Path(lock_config.state_path).resolve()
    resource_locks = _acquire_resource_locks([project, target, canonical_state])
    cycle_module.get_backend = get_tracked_backend
    try:
        for round_number in range(1, ROUNDS + 1):
            config = _load_cycle_config(load_config, args, project, target)
            if Path(config.state_path).resolve() != canonical_state:
                _error("SkillOpt state path changed between rounds")
            transaction = _begin_round_transaction(canonical_state, target)
            config.data["state_dir"] = str(transaction.directory)
            try:
                tracker_count = len(trackers)
                outcome = cycle_module.run_sleep_cycle(config, seed_tasks=tasks)
                if len(trackers) != tracker_count + 1:
                    _error("sleep cycle did not create exactly one tracked backend")
                tracker = trackers[-1]

                # Normalize the audit artifact even when a later fail-fast check
                # rejects the round.
                _sanitize_report_backend(outcome.staging_dir, args.backend)
                if tracker.errors:
                    _error(
                        "backend call failed: "
                        f"{redact_secrets(tracker.errors[0])[:500]}"
                    )

                report = outcome.report
                diagnostics = _validate_diagnostics(
                    outcome.staging_dir,
                    args.backend,
                    validation_task_ids,
                )
                if bool(diagnostics.get("accepted")) != bool(report.accepted):
                    _error("round diagnostics and report disagree about gate acceptance")

                proposal: bytes | None = None
                if report.accepted:
                    proposal = _validate_staging_manifest(
                        outcome.staging_dir,
                        project,
                        target,
                    )
                adopted_paths = _commit_round_transaction(
                    transaction,
                    proposal,
                    outcome.staging_dir,
                )
                if report.accepted:
                    _validate_adopted_paths(adopted_paths, target)
                elif adopted_paths:
                    _error("rejected round unexpectedly adopted a skill proposal")
            except BaseException:
                if not transaction.marker.exists():
                    shutil.rmtree(transaction.directory, ignore_errors=True)
                raise
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
                "adopted": bool(adopted_paths),
                "adopted_paths": adopted_paths,
            }
            summaries.append(summary)
            _print_round(summary)
    finally:
        cycle_module.get_backend = original_get_backend
        _release_resource_locks(resource_locks)

    print(json.dumps({"rounds_completed": ROUNDS, "rounds": summaries}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
