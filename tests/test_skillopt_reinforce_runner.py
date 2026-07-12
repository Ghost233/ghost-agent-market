import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
RUNNER_PATH = (
    ROOT
    / ".agents/skills/skillopt-reinforce-10/scripts/reinforce_ten_rounds.py"
)
SPEC = importlib.util.spec_from_file_location("skillopt_reinforce_runner", RUNNER_PATH)
assert SPEC is not None and SPEC.loader is not None
RUNNER = importlib.util.module_from_spec(SPEC)
PREVIOUS_DONT_WRITE_BYTECODE = sys.dont_write_bytecode
try:
    sys.dont_write_bytecode = True
    SPEC.loader.exec_module(RUNNER)
finally:
    sys.dont_write_bytecode = PREVIOUS_DONT_WRITE_BYTECODE


def task(
    task_id: str,
    split: str,
    session: str,
    *,
    origin: str = "real",
) -> SimpleNamespace:
    return SimpleNamespace(
        id=task_id,
        split=split,
        origin=origin,
        source_sessions=[session] if session else [],
    )


class FakeBackend:
    name = "codex"

    def __init__(self) -> None:
        self.last_call_error = ""
        self.responses = [("", "first call failed"), ("ok", "")]

    def attempt(self, *args, **kwargs):
        response, self.last_call_error = self.responses.pop(0)
        return response

    def attempt_with_tools(self, *args, **kwargs):
        self.last_call_error = ""
        return "ok", ["search"]

    def judge(self, *args, **kwargs):
        self.last_call_error = ""
        return 1.0, 1.0, "pass"

    def reflect(self, *args, **kwargs):
        self.last_call_error = ""
        return []

    def _call(self, *args, **kwargs):
        self.last_call_error = "direct call failed"
        return ""


class SkillOptReinforceRunnerTests(unittest.TestCase):
    def test_requires_independent_real_train_and_validation_splits(self) -> None:
        valid = [
            task("train-1", "train", "session-train-1"),
            task("train-2", "train", "session-train-2"),
            task("val-1", "val", "session-val-1"),
            task("val-2", "val", "session-val-2"),
        ]
        RUNNER._validate_task_splits(valid)

        with self.assertRaises(SystemExit):
            RUNNER._validate_task_splits(valid[:2])
        with self.assertRaises(SystemExit):
            RUNNER._validate_task_splits(
                [*valid[:3], task("val-2", "val", "session-val-2", origin="dream")]
            )
        with self.assertRaises(SystemExit):
            RUNNER._validate_task_splits(
                [*valid[:3], task("val-2", "val", "session-val-1")]
            )
        with self.assertRaises(SystemExit):
            RUNNER._validate_task_splits(
                [*valid, task("test-1", "test", "session-train-1")]
            )
        for invalid_sessions in ([""], [None], "session-as-string"):
            invalid = task("val-2", "val", "session-val-2")
            invalid.source_sessions = invalid_sessions
            with self.assertRaises(SystemExit):
                RUNNER._validate_task_splits([*valid[:3], invalid])

    def test_backend_tracker_keeps_earlier_failure_after_later_success(self) -> None:
        tracker = RUNNER._TrackedBackend(FakeBackend())

        self.assertEqual(tracker.attempt(None, "", ""), "")
        self.assertEqual(tracker.attempt(None, "", ""), "ok")

        self.assertTrue(tracker.errors)
        self.assertIn("first call failed", tracker.errors[0])
        self.assertTrue(any("empty response" in error for error in tracker.errors))

    def test_backend_tracker_captures_direct_backend_calls(self) -> None:
        tracker = RUNNER._TrackedBackend(FakeBackend())

        self.assertEqual(tracker._call("prompt"), "")

        self.assertTrue(any("direct call failed" in error for error in tracker.errors))
        self.assertTrue(any("direct_call: empty response" == error for error in tracker.errors))

    def test_corpus_source_must_be_recorded_and_match(self) -> None:
        RUNNER._validate_corpus_source({"transcript_source": "codex"}, "codex")
        with self.assertRaises(SystemExit):
            RUNNER._validate_corpus_source({}, "codex")
        with self.assertRaises(SystemExit):
            RUNNER._validate_corpus_source(
                {"transcript_source": "claude"},
                "codex",
            )

    def test_codex_home_is_propagated_to_nested_cli(self) -> None:
        previous = os.environ.get("CODEX_HOME")
        try:
            with tempfile.TemporaryDirectory() as directory:
                args = argparse.Namespace(backend="codex", codex_home=directory)
                RUNNER._configure_backend_environment(args)
                self.assertEqual(os.environ["CODEX_HOME"], str(Path(directory).resolve()))
        finally:
            if previous is None:
                os.environ.pop("CODEX_HOME", None)
            else:
                os.environ["CODEX_HOME"] = previous

    def test_diagnostics_reject_any_empty_holdout_response(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            staging = Path(directory)
            diagnostics = {
                "backend": "codex",
                "gate_mode": "on",
                "call_error": "",
                "holdout_detail": [
                    {"id": "val-1", "response_len": 42},
                    {"id": "val-2", "response_len": 24},
                ],
            }
            (staging / "diagnostics.json").write_text(
                json.dumps(diagnostics),
                encoding="utf-8",
            )

            RUNNER._validate_diagnostics(
                str(staging),
                "codex",
                ["val-1", "val-2"],
            )
            diagnostics["holdout_detail"][1]["response_len"] = 0
            (staging / "diagnostics.json").write_text(
                json.dumps(diagnostics),
                encoding="utf-8",
            )

            with self.assertRaises(SystemExit):
                RUNNER._validate_diagnostics(
                    str(staging),
                    "codex",
                    ["val-1", "val-2"],
                )

            diagnostics["holdout_detail"] = []
            (staging / "diagnostics.json").write_text(
                json.dumps(diagnostics),
                encoding="utf-8",
            )
            with self.assertRaises(SystemExit):
                RUNNER._validate_diagnostics(
                    str(staging),
                    "codex",
                    ["val-1", "val-2"],
                )

    def test_manifest_allows_only_the_exact_target_skill(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory).resolve()
            target = project / "skills/example/SKILL.md"
            target.parent.mkdir(parents=True)
            target.write_text("# Skill\n", encoding="utf-8")
            staging = project / ".skillopt-sleep/staging/night-1"
            staging.mkdir(parents=True)
            manifest_path = staging / "manifest.json"
            manifest = {
                "has_skill": True,
                "has_memory": False,
                "live_skill_path": str(target),
            }
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            (staging / "proposed_SKILL.md").write_text(
                "# Improved\n",
                encoding="utf-8",
            )

            proposal = RUNNER._validate_staging_manifest(str(staging), project, target)
            self.assertEqual(proposal, b"# Improved\n")
            manifest["has_memory"] = True
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaises(SystemExit):
                RUNNER._validate_staging_manifest(str(staging), project, target)

    def test_round_transaction_commits_state_and_exact_proposal_together(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / ".skillopt-sleep/state.json"
            state.parent.mkdir(parents=True)
            state.write_bytes(b'{"night": 1}')
            target = root / "skills/example/SKILL.md"
            target.parent.mkdir(parents=True)
            target.write_bytes(b"# Before\n")
            staging = root / ".skillopt-sleep/staging/night-2"
            staging.mkdir(parents=True)

            transaction = RUNNER._begin_round_transaction(state, target)
            transaction.transaction_state.write_bytes(b'{"night": 2}')
            self.assertEqual(state.read_bytes(), b'{"night": 1}')
            self.assertEqual(target.read_bytes(), b"# Before\n")

            adopted = RUNNER._commit_round_transaction(
                transaction,
                b"# After\n",
                str(staging),
            )

            self.assertEqual(adopted, [str(target.resolve())])
            self.assertEqual(state.read_bytes(), b'{"night": 2}')
            self.assertEqual(target.read_bytes(), b"# After\n")
            self.assertEqual(
                (staging / "backup/SKILL.md").read_bytes(),
                b"# Before\n",
            )
            self.assertFalse(transaction.marker.exists())
            self.assertFalse(transaction.directory.exists())

    def test_stale_transaction_cannot_overwrite_a_newer_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / ".skillopt-sleep/state.json"
            state.parent.mkdir(parents=True)
            state.write_bytes(b'{"night": 1}')
            target_a = root / "skills/a/SKILL.md"
            target_b = root / "skills/b/SKILL.md"
            target_a.parent.mkdir(parents=True)
            target_b.parent.mkdir(parents=True)
            target_a.write_bytes(b"# A before\n")
            target_b.write_bytes(b"# B before\n")
            staging_a = root / ".skillopt-sleep/staging/night-a"
            staging_b = root / ".skillopt-sleep/staging/night-b"
            staging_a.mkdir(parents=True)
            staging_b.mkdir(parents=True)

            transaction_a = RUNNER._begin_round_transaction(state, target_a)
            transaction_b = RUNNER._begin_round_transaction(state, target_b)
            transaction_a.transaction_state.write_bytes(b'{"night": "a"}')
            transaction_b.transaction_state.write_bytes(b'{"night": "b"}')

            RUNNER._commit_round_transaction(
                transaction_a,
                b"# A after\n",
                str(staging_a),
            )
            with self.assertRaises(SystemExit):
                RUNNER._commit_round_transaction(
                    transaction_b,
                    b"# B after\n",
                    str(staging_b),
                )

            self.assertEqual(state.read_bytes(), b'{"night": "a"}')
            self.assertEqual(target_a.read_bytes(), b"# A after\n")
            self.assertEqual(target_b.read_bytes(), b"# B before\n")
            self.assertFalse(transaction_b.marker.exists())
            self.assertFalse(transaction_b.directory.exists())

    def test_pending_marker_is_published_complete_and_without_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "state.pending.json"
            RUNNER._publish_exclusive_bytes(marker, b'{"complete": true}')

            self.assertEqual(marker.read_bytes(), b'{"complete": true}')
            with self.assertRaises(FileExistsError):
                RUNNER._publish_exclusive_bytes(marker, b"replacement")
            self.assertEqual(marker.read_bytes(), b'{"complete": true}')
            self.assertEqual(list(marker.parent.glob(f".{marker.name}.*.tmp")), [])

    def test_resource_lock_rejects_overlap_and_releases_cleanly(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            resource = Path(directory) / "state.json"
            first = RUNNER._acquire_resource_locks([resource])
            try:
                with self.assertRaises(SystemExit):
                    RUNNER._acquire_resource_locks([resource])
            finally:
                RUNNER._release_resource_locks(first)

            second = RUNNER._acquire_resource_locks([resource])
            RUNNER._release_resource_locks(second)

    def test_pending_round_transaction_rolls_back_after_process_death(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / ".skillopt-sleep/state.json"
            state.parent.mkdir(parents=True)
            state.write_bytes(b'{"night": 1}')
            target = root / "skills/example/SKILL.md"
            target.parent.mkdir(parents=True)
            target.write_bytes(b"# Before\n")
            transaction = RUNNER._begin_round_transaction(state, target)
            transaction.transaction_state.write_bytes(b'{"night": 2}')
            transaction.target_after.write_bytes(b"# After\n")
            transaction.marker.write_text(
                json.dumps(
                    {
                        "pid": 99999999,
                        "directory": str(transaction.directory),
                        "target": str(target),
                        "state_existed": True,
                    }
                ),
                encoding="utf-8",
            )
            target.write_bytes(b"# After\n")
            state.write_bytes(b'{"night": 2}')

            with mock.patch.object(RUNNER, "_process_is_alive", return_value=False):
                RUNNER._recover_pending_transaction(state, target)

            self.assertEqual(state.read_bytes(), b'{"night": 1}')
            self.assertEqual(target.read_bytes(), b"# Before\n")
            self.assertFalse(transaction.marker.exists())
            self.assertFalse(transaction.directory.exists())

    def test_prepared_transaction_never_rolls_back_unrelated_newer_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / ".skillopt-sleep/state.json"
            state.parent.mkdir(parents=True)
            state.write_bytes(b'{"night": 1}')
            target = root / "skills/example/SKILL.md"
            target.parent.mkdir(parents=True)
            target.write_bytes(b"# Before\n")
            transaction = RUNNER._begin_round_transaction(state, target)
            transaction.transaction_state.write_bytes(b'{"night": 2}')
            transaction.target_after.write_bytes(b"# Candidate\n")
            transaction.marker.write_text(
                json.dumps(
                    {
                        "protocol": 2,
                        "pid": 99999999,
                        "directory": str(transaction.directory),
                        "target": str(target.resolve()),
                        "state_existed": True,
                    }
                ),
                encoding="utf-8",
            )
            target.write_bytes(b"# Unrelated newer target\n")
            state.write_bytes(b'{"night": "unrelated"}')

            with mock.patch.object(RUNNER, "_process_is_alive", return_value=False):
                RUNNER._recover_pending_transaction(state, target)

            self.assertEqual(state.read_bytes(), b'{"night": "unrelated"}')
            self.assertEqual(target.read_bytes(), b"# Unrelated newer target\n")
            self.assertFalse(transaction.marker.exists())
            self.assertFalse(transaction.directory.exists())

    def test_adoption_must_return_only_the_exact_target(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory, "SKILL.md").resolve()
            RUNNER._validate_adopted_paths([str(target)], target)
            with self.assertRaises(SystemExit):
                RUNNER._validate_adopted_paths(
                    [str(target), str(target.with_name("CLAUDE.md"))],
                    target,
                )

    def test_report_removes_the_unused_replay_label(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            staging = Path(directory)
            report = staging / "report.md"
            report.write_text(
                "# Report\n\n- backend: `codex`  replay: `mock`\n",
                encoding="utf-8",
            )

            RUNNER._sanitize_report_backend(str(staging), "codex")

            text = report.read_text(encoding="utf-8")
            self.assertIn("- backend: `codex`", text)
            self.assertNotIn("replay:", text)


if __name__ == "__main__":
    unittest.main()
