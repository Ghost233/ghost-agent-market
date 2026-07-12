from contextlib import contextmanager
from copy import deepcopy
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "codex-market/plugins/ghost-agent-workflow/scripts/thread-plan.mjs"
FIXTURES = ROOT / "tests/fixtures/thread-plan"


class ThreadPlanCliTests(unittest.TestCase):
    @contextmanager
    def workspace(self, fixture: str = "parallel.json"):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan_path = root / "plan.json"
            shutil.copyfile(FIXTURES / fixture, plan_path)
            yield plan_path, root / "state.json"

    def run_cli(self, *args: object) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["node", str(SCRIPT), *(str(arg) for arg in args)],
            capture_output=True,
            text=True,
            check=False,
        )

    def run_json(self, *args: object) -> dict:
        result = self.run_cli(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def validate(self, plan_path: Path) -> Path:
        result = self.run_cli("validate", plan_path)
        self.assertEqual(result.returncode, 0, result.stderr)
        return plan_path.with_name("state.json")

    def update(
        self,
        plan_path: Path,
        state_path: Path,
        task_id: str,
        status: str,
        thread_id: str | None = None,
    ) -> subprocess.CompletedProcess[str]:
        args: list[object] = ["update", plan_path, state_path, task_id, status]
        if thread_id is not None:
            args.append(thread_id)
        return self.run_cli(*args)

    def test_validate_builds_routes_and_state(self) -> None:
        with self.workspace() as (plan_path, state_path):
            payload = self.run_json("validate", plan_path)

            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["profile_validation"], "syntax_only")
            self.assertEqual(
                plan["dispatch"]["routes"]["T2"],
                {"action": "reuse", "from_task": "T1"},
            )
            self.assertEqual(state["tasks"]["T1"]["status"], "pending")
            self.assertTrue(state["plan_digest"])

    def test_next_returns_every_ready_task_without_limit(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)

            payload = self.run_json("next", plan_path, state_path)

            self.assertEqual(
                {action["task_id"] for action in payload["actions"]},
                {"T1", "T3"},
            )
            self.assertEqual(
                {action["action"] for action in payload["actions"]},
                {"create_thread"},
            )
            actions = {action["task_id"]: action for action in payload["actions"]}
            self.assertEqual(actions["T1"]["logical_id"], "state.extract-types")
            self.assertEqual(actions["T1"]["title"], "抽离页面状态类型")

    def test_concurrent_running_updates_preserve_both_tasks(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            processes = [
                subprocess.Popen(
                    [
                        "node",
                        str(SCRIPT),
                        "update",
                        str(plan_path),
                        str(state_path),
                        task_id,
                        "running",
                        thread_id,
                    ],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                for task_id, thread_id in (
                    ("T1", "thread-1"),
                    ("T3", "thread-3"),
                )
            ]
            results = [process.communicate() for process in processes]

            self.assertEqual([process.returncode for process in processes], [0, 0], results)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["tasks"]["T1"], {
                "status": "running",
                "thread_id": "thread-1",
            })
            self.assertEqual(state["tasks"]["T3"], {
                "status": "running",
                "thread_id": "thread-3",
            })
            self.assertFalse(Path(f"{state_path}.lock").exists())

    def test_live_lock_owner_is_never_reaped_by_age(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            lock_path = Path(f"{state_path}.lock")
            lock = {
                "pid": os.getpid(),
                "created_at": 0,
                "token": "live-owner",
            }
            lock_path.write_text(json.dumps(lock), encoding="utf-8")
            try:
                result = self.run_cli("next", plan_path, state_path)

                self.assertNotEqual(result.returncode, 0)
                self.assertIn("state is busy", result.stderr)
                self.assertEqual(
                    json.loads(lock_path.read_text(encoding="utf-8")),
                    lock,
                )
            finally:
                lock_path.unlink(missing_ok=True)

    def test_concurrent_waiters_reap_one_dead_lock_without_lost_updates(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            lock_path = Path(f"{state_path}.lock")
            lock_path.write_text(
                json.dumps({
                    "pid": 99_999_999,
                    "created_at": 0,
                    "token": "dead-owner",
                }),
                encoding="utf-8",
            )
            processes = [
                subprocess.Popen(
                    [
                        "node",
                        str(SCRIPT),
                        "update",
                        str(plan_path),
                        str(state_path),
                        task_id,
                        "running",
                        thread_id,
                    ],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                for task_id, thread_id in (
                    ("T1", "thread-1"),
                    ("T3", "thread-3"),
                )
            ]
            results = [process.communicate() for process in processes]

            self.assertEqual([process.returncode for process in processes], [0, 0], results)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["tasks"]["T1"]["status"], "running")
            self.assertEqual(state["tasks"]["T3"]["status"], "running")
            self.assertFalse(lock_path.exists())
            self.assertFalse(Path(f"{lock_path}.reaper").exists())

    def test_dead_reaper_is_taken_over_without_manual_cleanup(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            lock_path = Path(f"{state_path}.lock")
            lock_path.write_text(
                json.dumps({
                    "pid": 99_999_999,
                    "created_at": 0,
                    "token": "dead-owner",
                }),
                encoding="utf-8",
            )
            reaper_path = Path(f"{lock_path}.reaper")
            reaper_path.write_text(
                json.dumps({
                    "pid": 99_999_998,
                    "token": "dead-reaper",
                    "lock_token": "dead-owner",
                }),
                encoding="utf-8",
            )

            result = self.run_cli("next", plan_path, state_path)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(lock_path.exists())
            payload = json.loads(result.stdout)
            self.assertEqual(
                {action["task_id"] for action in payload["actions"]},
                {"T1", "T3"},
            )

    def test_noncanonical_state_path_is_rejected(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            copied_state = state_path.with_name("state-copy.json")
            shutil.copyfile(state_path, copied_state)

            result = self.run_cli("next", plan_path, copied_state)
            update = self.update(
                plan_path,
                copied_state,
                "T1",
                "running",
                "thread-copy",
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("canonical path", result.stderr)
            self.assertNotEqual(update.returncode, 0)
            self.assertIn("canonical path", update.stderr)

    def test_concurrent_next_and_update_preserve_both_changes(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            self.assertEqual(
                self.update(
                    plan_path,
                    state_path,
                    "T1",
                    "running",
                    "thread-1",
                ).returncode,
                0,
            )
            self.assertEqual(
                self.update(plan_path, state_path, "T1", "blocked").returncode,
                0,
            )
            processes = [
                subprocess.Popen(
                    command,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                for command in (
                    ["node", str(SCRIPT), "next", str(plan_path), str(state_path)],
                    [
                        "node",
                        str(SCRIPT),
                        "update",
                        str(plan_path),
                        str(state_path),
                        "T3",
                        "running",
                        "thread-3",
                    ],
                )
            ]
            results = [process.communicate() for process in processes]

            self.assertEqual([process.returncode for process in processes], [0, 0], results)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["tasks"]["T2"]["status"], "dependency_blocked")
            self.assertEqual(state["tasks"]["T4"]["status"], "dependency_blocked")
            self.assertEqual(state["tasks"]["T3"], {
                "status": "running",
                "thread_id": "thread-3",
            })

    def test_completed_predecessor_releases_reuse_action_immediately(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            self.assertEqual(
                self.update(plan_path, state_path, "T1", "running", "thread-1").returncode,
                0,
            )
            self.assertEqual(
                self.update(plan_path, state_path, "T1", "completed").returncode,
                0,
            )

            payload = self.run_json("next", plan_path, state_path)
            actions = {action["task_id"]: action for action in payload["actions"]}
            self.assertEqual(actions["T2"]["action"], "reuse_thread")
            self.assertEqual(actions["T2"]["thread_id"], "thread-1")
            self.assertEqual(actions["T3"]["action"], "create_thread")

    def test_failure_blocks_only_descendants(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            running = self.update(
                plan_path, state_path, "T1", "running", "thread-1"
            )
            self.assertEqual(running.returncode, 0, running.stderr)
            result = self.update(plan_path, state_path, "T1", "blocked")
            self.assertEqual(result.returncode, 0, result.stderr)

            payload = self.run_json("next", plan_path, state_path)
            self.assertEqual(
                {action["task_id"] for action in payload["actions"]},
                {"T3"},
            )
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["tasks"]["T2"]["status"], "dependency_blocked")
            self.assertEqual(state["tasks"]["T4"]["status"], "dependency_blocked")

    def test_dispatch_failure_cannot_block_a_pending_task(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)

            result = self.update(plan_path, state_path, "T1", "blocked")

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("illegal status transition", result.stderr)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["tasks"]["T1"]["status"], "pending")

    def test_validate_rejects_unknown_reasoning_effort(self) -> None:
        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["modules"][0]["worker_profile"]["reasoning_effort"] = "extreme"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            result = self.run_cli("validate", plan_path)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("reasoning_effort is invalid", result.stderr)
            self.assertFalse(state_path.exists())

    def test_conflicting_incomparable_tasks_are_rejected(self) -> None:
        with self.workspace("conflict.json") as (plan_path, state_path):
            result = self.run_cli("validate", plan_path)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("writable_paths conflict", result.stderr)
            self.assertFalse(state_path.exists())

    def test_cycle_and_unknown_references_are_rejected(self) -> None:
        with self.workspace() as (plan_path, _):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["tasks"][0]["depends_on"] = ["T2"]
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            cycle = self.run_cli("validate", plan_path)
            self.assertNotEqual(cycle.returncode, 0)
            self.assertIn("cycle", cycle.stderr)

        with self.workspace() as (plan_path, _):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["tasks"][0]["module_id"] = "missing"
            plan["tasks"][1]["depends_on"] = ["missing-task"]
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            unknown = self.run_cli("validate", plan_path)
            self.assertNotEqual(unknown.returncode, 0)
            self.assertIn("unknown module_id", unknown.stderr)

    def test_plan_digest_change_is_rejected(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["parent_goal"] = "Mutated goal"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            result = self.run_cli("next", plan_path, state_path)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("plan digest mismatch", result.stderr)

    def test_illegal_status_transition_is_rejected(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)

            result = self.update(plan_path, state_path, "T1", "completed")

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("illegal status transition", result.stderr)

    def test_reuse_requires_the_source_thread(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            self.assertEqual(
                self.update(plan_path, state_path, "T1", "running", "thread-1").returncode,
                0,
            )
            self.assertEqual(
                self.update(plan_path, state_path, "T1", "completed").returncode,
                0,
            )

            wrong = self.update(plan_path, state_path, "T2", "running", "thread-2")

            self.assertNotEqual(wrong.returncode, 0)
            self.assertIn("must reuse thread", wrong.stderr)

    def test_validate_does_not_reset_existing_state(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            self.assertEqual(
                self.update(plan_path, state_path, "T1", "running", "thread-1").returncode,
                0,
            )

            self.validate(plan_path)

            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["tasks"]["T1"]["status"], "running")
            self.assertEqual(state["tasks"]["T1"]["thread_id"], "thread-1")

    def test_continuation_resumes_a_terminal_previous_thread(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            previous_dir = root / "revision-1"
            current_dir = root / "revision-2"
            previous_dir.mkdir()
            current_dir.mkdir()
            previous_plan = previous_dir / "plan.json"
            current_plan = current_dir / "plan.json"
            shutil.copyfile(FIXTURES / "parallel.json", previous_plan)
            previous_state = self.validate(previous_plan)
            self.assertEqual(
                self.update(
                    previous_plan,
                    previous_state,
                    "T1",
                    "running",
                    "thread-existing",
                ).returncode,
                0,
            )
            self.assertEqual(
                self.update(
                    previous_plan,
                    previous_state,
                    "T1",
                    "completed",
                ).returncode,
                0,
            )

            plan = json.loads(previous_plan.read_text(encoding="utf-8"))
            plan.pop("dispatch")
            plan["revision"] = 2
            plan["tasks"][0]["title"] = "复核页面状态类型"
            plan["continuation"] = {
                "previous_plan_path": str(previous_plan),
                "reviewed_task_ids": ["T2", "T3", "T4"],
                "replacements": {
                    "T2": ["T2"],
                    "T3": ["T3"],
                    "T4": ["T4"],
                },
                "reuse": {
                    "T1": {"from_task": "T1", "mode": "continue"}
                },
            }
            current_plan.write_text(json.dumps(plan), encoding="utf-8")

            validation = self.run_json("validate", current_plan)
            self.assertEqual(validation["revision"], 2)
            self.assertEqual(validation["continuation_reuse_count"], 1)
            claim_path = Path(f"{previous_state}.continued-by.claim")
            claim = json.loads(claim_path.read_text(encoding="utf-8"))
            self.assertEqual(claim["plan_path"], str(current_plan))
            self.assertEqual(
                list(
                    previous_state.parent.glob(
                        f"{previous_state.name}.continued-by.claim.*.tmp"
                    )
                ),
                [],
            )
            stopped_next = self.run_cli("next", previous_plan, previous_state)
            self.assertNotEqual(stopped_next.returncode, 0)
            self.assertIn("plan already continued by", stopped_next.stderr)
            stopped_start = self.update(
                previous_plan,
                previous_state,
                "T3",
                "running",
                "thread-late",
            )
            self.assertNotEqual(stopped_start.returncode, 0)
            self.assertIn("plan already continued by", stopped_start.stderr)
            stopped_state = json.loads(previous_state.read_text(encoding="utf-8"))
            self.assertEqual(stopped_state["tasks"]["T3"]["status"], "pending")
            self.assertIsNone(stopped_state["tasks"]["T3"]["thread_id"])
            branch_dir = root / "revision-2-branch"
            branch_dir.mkdir()
            branch_plan = branch_dir / "plan.json"
            branch = json.loads(current_plan.read_text(encoding="utf-8"))
            branch.pop("dispatch")
            branch_plan.write_text(json.dumps(branch), encoding="utf-8")
            branched = self.run_cli("validate", branch_plan)
            self.assertNotEqual(branched.returncode, 0)
            self.assertIn("already continued by", branched.stderr)
            current_state = current_plan.with_name("state.json")
            next_payload = self.run_json("next", current_plan, current_state)
            actions = {
                action["task_id"]: action for action in next_payload["actions"]
            }
            self.assertEqual(actions["T1"]["action"], "reuse_existing_thread")
            self.assertEqual(actions["T1"]["thread_id"], "thread-existing")
            self.assertEqual(actions["T1"]["from_task"], "T1")
            self.assertEqual(actions["T1"]["reuse_mode"], "continue")
            self.assertEqual(actions["T1"]["title"], "复核页面状态类型")

            wrong = self.update(
                current_plan,
                current_state,
                "T1",
                "running",
                "thread-wrong",
            )
            self.assertNotEqual(wrong.returncode, 0)
            self.assertIn("must resume thread", wrong.stderr)
            duplicate = self.update(
                current_plan,
                current_state,
                "T3",
                "running",
                "thread-existing",
            )
            self.assertNotEqual(duplicate.returncode, 0)
            self.assertIn("create route must use a new thread", duplicate.stderr)
            correct = self.update(
                current_plan,
                current_state,
                "T1",
                "running",
                "thread-existing",
            )
            self.assertEqual(correct.returncode, 0, correct.stderr)

    def test_continuation_rejects_a_different_parent_goal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            previous_dir = root / "revision-1"
            current_dir = root / "revision-2"
            previous_dir.mkdir()
            current_dir.mkdir()
            previous_plan = previous_dir / "plan.json"
            current_plan = current_dir / "plan.json"
            shutil.copyfile(FIXTURES / "parallel.json", previous_plan)
            previous_state = self.validate(previous_plan)
            self.assertEqual(
                self.update(
                    previous_plan,
                    previous_state,
                    "T1",
                    "running",
                    "thread-existing",
                ).returncode,
                0,
            )
            self.assertEqual(
                self.update(
                    previous_plan,
                    previous_state,
                    "T1",
                    "completed",
                ).returncode,
                0,
            )

            plan = json.loads(previous_plan.read_text(encoding="utf-8"))
            plan.pop("dispatch")
            plan["revision"] = 2
            plan["parent_goal"] = "A different parent goal"
            plan["continuation"] = {
                "previous_plan_path": str(previous_plan),
                "reviewed_task_ids": ["T2", "T3", "T4"],
                "replacements": {
                    "T2": ["T2"],
                    "T3": ["T3"],
                    "T4": ["T4"],
                },
                "reuse": {
                    "T1": {"from_task": "T1", "mode": "continue"}
                },
            }
            current_plan.write_text(json.dumps(plan), encoding="utf-8")

            result = self.run_cli("validate", current_plan)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("parent_goal does not match", result.stderr)

            plan["parent_goal"] = "Refactor page state"
            plan["revision"] = 3
            current_plan.write_text(json.dumps(plan), encoding="utf-8")
            skipped_revision = self.run_cli("validate", current_plan)
            self.assertNotEqual(skipped_revision.returncode, 0)
            self.assertIn("increment the previous revision by one", skipped_revision.stderr)

            plan["revision"] = 2
            plan["modules"][0]["worker_profile"]["reasoning_effort"] = "high"
            current_plan.write_text(json.dumps(plan), encoding="utf-8")
            changed_module = self.run_cli("validate", current_plan)
            self.assertNotEqual(changed_module.returncode, 0)
            self.assertIn("module definition changed", changed_module.stderr)

            plan["modules"][0]["worker_profile"]["reasoning_effort"] = "medium"
            plan["tasks"][0]["logical_id"] = "state.changed-responsibility"
            current_plan.write_text(json.dumps(plan), encoding="utf-8")
            changed_logical_id = self.run_cli("validate", current_plan)
            self.assertNotEqual(changed_logical_id.returncode, 0)
            self.assertIn("logical_id changed", changed_logical_id.stderr)

            plan["tasks"][0]["logical_id"] = "state.extract-types"
            plan["continuation"]["reuse"]["T1"]["mode"] = "handoff"
            current_plan.write_text(json.dumps(plan), encoding="utf-8")
            same_logical_handoff = self.run_cli("validate", current_plan)
            self.assertNotEqual(same_logical_handoff.returncode, 0)
            self.assertIn("handoff must change logical_id", same_logical_handoff.stderr)

            plan["continuation"]["reuse"]["T1"]["mode"] = "continue"
            plan["continuation"]["reviewed_task_ids"].remove("T4")
            current_plan.write_text(json.dumps(plan), encoding="utf-8")
            incomplete_review = self.run_cli("validate", current_plan)
            self.assertNotEqual(incomplete_review.returncode, 0)
            self.assertIn("cover every unfinished", incomplete_review.stderr)

    def test_concurrent_continuations_have_exactly_one_winner(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            previous_dir = root / "revision-1"
            previous_dir.mkdir()
            previous_plan = previous_dir / "plan.json"
            shutil.copyfile(FIXTURES / "parallel.json", previous_plan)
            previous_state = self.validate(previous_plan)

            source = json.loads(previous_plan.read_text(encoding="utf-8"))
            source.pop("dispatch")
            source["revision"] = 2
            source["continuation"] = {
                "previous_plan_path": str(previous_plan),
                "reviewed_task_ids": ["T1", "T2", "T3", "T4"],
                "replacements": {
                    "T1": ["T1"],
                    "T2": ["T2"],
                    "T3": ["T3"],
                    "T4": ["T4"],
                },
                "reuse": {},
            }
            candidates = []
            for name in ("revision-2-a", "revision-2-b"):
                candidate_dir = root / name
                candidate_dir.mkdir()
                candidate_plan = candidate_dir / "plan.json"
                candidate_plan.write_text(json.dumps(source), encoding="utf-8")
                candidates.append(candidate_plan)

            processes = [
                subprocess.Popen(
                    ["node", str(SCRIPT), "validate", str(candidate)],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                for candidate in candidates
            ]
            results = [process.communicate() for process in processes]
            return_codes = [process.returncode for process in processes]

            self.assertEqual(return_codes.count(0), 1, results)
            self.assertEqual(sum(code != 0 for code in return_codes), 1, results)
            winner = candidates[return_codes.index(0)]
            claim_path = Path(f"{previous_state}.continued-by.claim")
            claim = json.loads(claim_path.read_text(encoding="utf-8"))
            self.assertEqual(claim["plan_path"], str(winner))
            retry = self.run_cli("validate", winner)
            self.assertEqual(retry.returncode, 0, retry.stderr)
            loser_index = next(
                index for index, code in enumerate(return_codes) if code != 0
            )
            self.assertIn("already continued by", results[loser_index][1])
            loser = candidates[loser_index]
            loser_state = loser.with_name("state.json")
            self.assertFalse(loser_state.exists())

            winner_state = winner.with_name("state.json")
            shutil.copyfile(winner, loser)
            shutil.copyfile(winner_state, loser_state)
            stopped_loser = self.run_cli("next", loser, loser_state)
            stopped_loser_update = self.update(
                loser,
                loser_state,
                "T1",
                "running",
                "thread-loser",
            )
            self.assertNotEqual(stopped_loser.returncode, 0)
            self.assertIn("continuation claim belongs to", stopped_loser.stderr)
            self.assertNotEqual(stopped_loser_update.returncode, 0)
            self.assertIn(
                "continuation claim belongs to",
                stopped_loser_update.stderr,
            )

    def test_duplicate_logical_task_ids_are_rejected(self) -> None:
        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["tasks"][1]["logical_id"] = plan["tasks"][0]["logical_id"]
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            result = self.run_cli("validate", plan_path)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("duplicate logical task id", result.stderr)
            self.assertFalse(state_path.exists())

    def test_generic_task_title_is_rejected(self) -> None:
        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["tasks"][0]["title"] = "等待完整绑定包"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            result = self.run_cli("validate", plan_path)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("generic placeholder", result.stderr)
            self.assertFalse(state_path.exists())


if __name__ == "__main__":
    unittest.main()
