from contextlib import contextmanager
from copy import deepcopy
import json
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


if __name__ == "__main__":
    unittest.main()
