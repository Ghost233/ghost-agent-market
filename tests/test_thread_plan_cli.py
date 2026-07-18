from contextlib import contextmanager
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = Path(
    os.environ.get(
        "THREAD_PLAN_SCRIPT",
        ROOT / "codex-market/plugins/ghost-agent-workflow/scripts/thread-plan.mjs",
    )
)
CLAUDE_SCRIPT = ROOT / "claude-code-market/scripts/thread-plan.mjs"
FIXTURES = ROOT / "tests/fixtures/thread-plan"
TERMINAL_STATUSES = {"completed", "blocked", "failed", "needs_main_review"}


class ThreadPlanCliTests(unittest.TestCase):
    @contextmanager
    def workspace(self, fixture: str = "parallel.json"):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plan_path = root / "plan.json"
            shutil.copyfile(FIXTURES / fixture, plan_path)
            yield plan_path, root / "state.json"

    def run_cli(self, *args: object, script: Path = SCRIPT) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["node", str(script), *(str(arg) for arg in args)],
            capture_output=True,
            text=True,
            check=False,
        )

    def run_json(self, *args: object, script: Path = SCRIPT) -> dict:
        result = self.run_cli(*args, script=script)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def validate(
        self,
        plan_path: Path,
        script: Path = SCRIPT,
        executor_mode: str | None = "thread",
    ) -> Path:
        result = self.run_cli("validate", plan_path, script=script)
        self.assertEqual(result.returncode, 0, result.stderr)
        state_path = plan_path.with_name("state.json")
        if executor_mode is not None:
            mode_result = self.run_cli(
                "mode",
                plan_path,
                state_path,
                executor_mode,
                script=script,
            )
            self.assertEqual(mode_result.returncode, 0, mode_result.stderr)
        return state_path

    def worker_result(
        self,
        plan_path: Path,
        state_path: Path,
        task_id: str,
        status: str,
        **overrides: object,
    ) -> dict:
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        state = json.loads(state_path.read_text(encoding="utf-8"))
        task = next(item for item in plan["tasks"] if item["id"] == task_id)
        needs_review = status == "needs_main_review"
        result = {
            "contract": "WORKER_RESULT_V3",
            "status": status,
            "task_id": task_id,
            "logical_id": task["logical_id"],
            "thread_role": task["thread_role"],
            "module_id": task["module_id"],
            "thread_id": state["tasks"][task_id]["thread_id"],
            "profile_evidence": "profile matched",
            "changed_files": [],
            "verification": ["verification recorded"],
            "diff_self_check": "scope_exception" if needs_review else "pass",
            "scope_request": {
                "paths": ["src/repair/**"],
                "reason": "the task needs a wider write scope",
                "required_for_done_when": "the verification must pass",
                "suggested_owner": task["module_id"],
                "split_hints": [],
                "overlap_hints": [],
            }
            if needs_review
            else None,
            "summary": f"task {status}",
        }
        result.update(overrides)
        return result

    def update(
        self,
        plan_path: Path,
        state_path: Path,
        task_id: str,
        status: str,
        thread_id: str | None = None,
        result: dict | None = None,
        result_path: Path | None = None,
    ) -> subprocess.CompletedProcess[str]:
        args: list[object] = ["update", plan_path, state_path, task_id, status]
        if status == "running":
            args.append(thread_id)
        elif status in TERMINAL_STATUSES:
            result_path = result_path or plan_path.parent / "results" / f"{task_id}.json"
            result_path.parent.mkdir(parents=True, exist_ok=True)
            result_path.write_text(
                json.dumps(
                    result
                    if result is not None
                    else self.worker_result(plan_path, state_path, task_id, status)
                ),
                encoding="utf-8",
            )
            args.append(result_path)
        return self.run_cli(*args)

    def complete(
        self,
        plan_path: Path,
        state_path: Path,
        task_id: str,
        thread_id: str,
    ) -> None:
        self.assertEqual(
            self.update(plan_path, state_path, task_id, "running", thread_id).returncode,
            0,
        )
        result = self.update(plan_path, state_path, task_id, "completed")
        self.assertEqual(result.returncode, 0, result.stderr)

    def successor(self, previous_plan: Path) -> dict:
        plan = json.loads(previous_plan.read_text(encoding="utf-8"))
        plan["revision"] += 1
        plan["continuation"] = {"previous_plan_path": str(previous_plan)}
        return plan

    def test_validate_initializes_state_without_routes(self) -> None:
        with self.workspace() as (plan_path, state_path):
            payload = self.run_json("validate", plan_path)
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            state = json.loads(state_path.read_text(encoding="utf-8"))

            self.assertNotIn("dispatch", plan)
            self.assertEqual(payload["profile_validation"], "syntax_only")
            self.assertEqual(payload["revision"], 1)
            self.assertNotIn("continuation_reuse_count", payload)
            self.assertEqual(state["tasks"]["T1"]["status"], "pending")
            self.assertIsNone(state["tasks"]["T1"]["thread_id"])
            self.assertIsNone(state["tasks"]["T1"]["result"])
            self.assertIsNone(state["continued_by"])
            self.assertIsNone(state["executor_mode"])
            digest = hashlib.sha256(plan_path.read_bytes()).hexdigest()
            self.assertEqual(state["plan_digest"], digest)
            self.assertTrue((plan_path.parent / "results").is_dir())

    def test_executor_mode_is_required_idempotent_and_immutable(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.run_json("validate", plan_path)

            unselected = self.run_cli("next", plan_path, state_path)
            self.assertNotEqual(unselected.returncode, 0)
            self.assertIn("executor mode is not selected", unselected.stderr)

            selected = self.run_json("mode", plan_path, state_path, "subagent")
            self.assertEqual(selected["executor_mode"], "subagent")
            repeated = self.run_json("mode", plan_path, state_path, "subagent")
            self.assertEqual(repeated["executor_mode"], "subagent")

            switched = self.run_cli("mode", plan_path, state_path, "thread")
            self.assertNotEqual(switched.returncode, 0)
            self.assertIn("cannot switch to thread", switched.stderr)

    def test_concurrent_executor_mode_selection_has_one_winner(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.run_json("validate", plan_path)
            processes = [
                subprocess.Popen(
                    [
                        "node",
                        str(SCRIPT),
                        "mode",
                        str(plan_path),
                        str(state_path),
                        mode,
                    ],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                for mode in ("thread", "subagent")
            ]
            results = [
                process.communicate(timeout=10) + (process.returncode,)
                for process in processes
            ]

            self.assertEqual(sum(code == 0 for _, _, code in results), 1, results)
            self.assertEqual(sum(code != 0 for _, _, code in results), 1, results)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertIn(state["executor_mode"], {"thread", "subagent"})

    def test_render_is_read_only_and_deterministic(self) -> None:
        with self.workspace() as (plan_path, state_path):
            original = self.run_cli("render", plan_path)
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["tasks"] = list(reversed(plan["tasks"]))
            for task in plan["tasks"]:
                task["depends_on"] = list(reversed(task["depends_on"]))
            reordered = plan_path.with_name("reordered.json")
            reordered.write_text(json.dumps(plan), encoding="utf-8")
            second = self.run_cli("render", reordered)

            self.assertEqual(original.returncode, 0, original.stderr)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(original.stdout.split("\n", 1)[1], second.stdout.split("\n", 1)[1])
            self.assertRegex(
                original.stdout.splitlines()[0],
                r"^%% thread-plan plan_digest=[0-9a-f]{64} revision=1 safety\.status=parallel_safe$",
            )
            self.assertFalse(state_path.exists())

    def test_next_returns_all_ready_tasks_as_one_action_type(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            payload = self.run_json("next", plan_path, state_path)

            self.assertEqual({item["task_id"] for item in payload["actions"]}, {"T1", "T3"})
            self.assertEqual({item["action"] for item in payload["actions"]}, {"dispatch_task"})
            self.assertTrue(all(item["thread_id"] is None for item in payload["actions"]))
            action = next(item for item in payload["actions"] if item["task_id"] == "T1")
            self.assertEqual(action["thread_role"], "work")
            self.assertEqual(
                action["expected_title"],
                "[GA][实施][待命] 抽离页面状态类型",
            )
            self.assertNotIn(action["logical_id"], action["expected_title"])

    def test_single_work_dag_requires_no_review_or_verify_task(self) -> None:
        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            work = deepcopy(plan["tasks"][0])
            plan["modules"] = [
                next(item for item in plan["modules"] if item["id"] == work["module_id"])
            ]
            plan["tasks"] = [work]
            plan["safety"] = {"status": "sequential_only", "reasons": ["single work task"]}
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            self.validate(plan_path)
            ready = self.run_json("next", plan_path, state_path)
            self.assertEqual([item["task_id"] for item in ready["actions"]], ["T1"])
            self.assertEqual([item["thread_role"] for item in ready["actions"]], ["work"])

            self.complete(plan_path, state_path, "T1", "thread-work")
            finished = self.run_json("next", plan_path, state_path)
            self.assertEqual(finished["actions"], [])
            self.assertEqual(finished["summary"]["completed"], 1)

    def test_same_owner_is_reused_dynamically(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            self.complete(plan_path, state_path, "T1", "thread-state")

            payload = self.run_json("next", plan_path, state_path)
            action = next(item for item in payload["actions"] if item["task_id"] == "T2")
            self.assertEqual(action["action"], "dispatch_task")
            self.assertEqual(action["thread_id"], "thread-state")

            wrong = self.update(plan_path, state_path, "T2", "running", "thread-other")
            self.assertNotEqual(wrong.returncode, 0)
            self.assertIn("must reuse owner executor thread-state", wrong.stderr)
            correct = self.update(plan_path, state_path, "T2", "running", "thread-state")
            self.assertEqual(correct.returncode, 0, correct.stderr)

    def test_different_owner_cannot_share_a_thread(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            self.assertEqual(
                self.update(plan_path, state_path, "T1", "running", "shared-thread").returncode,
                0,
            )
            other = self.update(plan_path, state_path, "T3", "running", "shared-thread")
            self.assertNotEqual(other.returncode, 0)
            self.assertIn("already bound to another task owner", other.stderr)

    def test_update_rejects_a_task_before_its_dependencies_complete(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            original_state = state_path.read_text(encoding="utf-8")

            result = self.update(plan_path, state_path, "T2", "running", "thread-state")

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("task T2 is not ready", result.stderr)
            self.assertEqual(state_path.read_text(encoding="utf-8"), original_state)

    def test_required_plan_fields_are_not_inferred(self) -> None:
        cases = (
            ("revision", lambda plan: plan.pop("revision")),
            ("logical_id", lambda plan: plan["tasks"][0].pop("logical_id")),
            ("title", lambda plan: plan["tasks"][0].pop("title")),
            ("thread_role", lambda plan: plan["tasks"][0].pop("thread_role")),
        )
        for field, mutation in cases:
            with self.subTest(field=field), self.workspace() as (plan_path, _):
                plan = json.loads(plan_path.read_text(encoding="utf-8"))
                mutation(plan)
                plan_path.write_text(json.dumps(plan), encoding="utf-8")

                result = self.run_cli("validate", plan_path)

                self.assertNotEqual(result.returncode, 0)
                self.assertIn(field, result.stderr)

    def test_sequential_dag_releases_one_task_at_a_time(self) -> None:
        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["modules"] = [plan["modules"][0], plan["modules"][1]]
            tasks = [deepcopy(plan["tasks"][0]), deepcopy(plan["tasks"][3])]
            tasks[1].update({"id": "T2", "depends_on": ["T1"]})
            plan["tasks"] = tasks
            plan["safety"] = {"status": "sequential_only", "reasons": ["T2 depends on T1"]}
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            self.validate(plan_path)

            self.assertEqual(
                [item["task_id"] for item in self.run_json("next", plan_path, state_path)["actions"]],
                ["T1"],
            )
            self.complete(plan_path, state_path, "T1", "thread-work")
            self.assertEqual(
                [item["task_id"] for item in self.run_json("next", plan_path, state_path)["actions"]],
                ["T2"],
            )

    def test_needs_user_review_blocks_execution(self) -> None:
        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["safety"] = {"status": "needs_user_review", "reasons": ["external boundary"]}
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            self.validate(plan_path, executor_mode=None)

            next_result = self.run_cli("next", plan_path, state_path)
            self.assertNotEqual(next_result.returncode, 0)
            self.assertIn("plan safety requires user review", next_result.stderr)
            update_result = self.update(plan_path, state_path, "T1", "running", "thread-1")
            self.assertNotEqual(update_result.returncode, 0)

    def test_failure_blocks_only_dependent_tasks(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            self.assertEqual(
                self.update(plan_path, state_path, "T1", "running", "thread-state").returncode,
                0,
            )
            failed = self.update(plan_path, state_path, "T1", "failed")
            self.assertEqual(failed.returncode, 0, failed.stderr)

            payload = self.run_json("next", plan_path, state_path)
            self.assertEqual({item["task_id"] for item in payload["actions"]}, {"T3"})
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["tasks"]["T2"]["status"], "dependency_blocked")
            self.assertEqual(state["tasks"]["T4"]["status"], "dependency_blocked")

    def test_graph_rejects_conflicts_and_parallel_same_owner(self) -> None:
        with self.workspace("conflict.json") as (plan_path, _):
            result = self.run_cli("validate", plan_path)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("writable_paths conflict", result.stderr)

        with self.workspace() as (plan_path, _):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["tasks"][1]["depends_on"] = []
            plan["tasks"][1]["writable_paths"] = ["another/**"]
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            result = self.run_cli("validate", plan_path)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("same module_id and thread_role must be DAG-comparable", result.stderr)

    def test_safety_must_match_topology(self) -> None:
        with self.workspace() as (plan_path, _):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["safety"]["status"] = "sequential_only"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            result = self.run_cli("validate", plan_path)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("contradicts the task DAG", result.stderr)

    def test_terminal_update_embeds_verified_result(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            self.assertEqual(
                self.update(plan_path, state_path, "T1", "running", "thread-1").returncode,
                0,
            )
            result = self.update(plan_path, state_path, "T1", "completed")
            self.assertEqual(result.returncode, 0, result.stderr)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["tasks"]["T1"]["result"]["contract"], "WORKER_RESULT_V3")

    def test_result_identity_scope_and_path_are_enforced(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            self.assertEqual(
                self.update(plan_path, state_path, "T1", "running", "thread-1").returncode,
                0,
            )
            wrong_identity = self.worker_result(
                plan_path,
                state_path,
                "T1",
                "completed",
                module_id="other-module",
            )
            result = self.update(plan_path, state_path, "T1", "completed", result=wrong_identity)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("module_id mismatch", result.stderr)

            wrong_scope = self.worker_result(
                plan_path,
                state_path,
                "T1",
                "completed",
                changed_files=["outside/file.ts"],
            )
            result = self.update(plan_path, state_path, "T1", "completed", result=wrong_scope)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("exceed writable_paths", result.stderr)

            other_path = plan_path.parent / "other-result.json"
            other_path.write_text(json.dumps(self.worker_result(plan_path, state_path, "T1", "completed")), encoding="utf-8")
            result = self.update(
                plan_path,
                state_path,
                "T1",
                "completed",
                result_path=other_path,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("result path must equal", result.stderr)

    def test_review_and_verify_cannot_report_changed_files(self) -> None:
        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            review = deepcopy(plan["tasks"][3])
            review["depends_on"] = []
            plan["tasks"] = [review]
            plan["modules"] = [next(item for item in plan["modules"] if item["id"] == review["module_id"])]
            plan["safety"] = {"status": "sequential_only", "reasons": ["single task"]}
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            self.validate(plan_path)
            self.assertEqual(
                self.update(plan_path, state_path, "T4", "running", "thread-review").returncode,
                0,
            )
            worker_result = self.worker_result(
                plan_path,
                state_path,
                "T4",
                "completed",
                changed_files=["src/review.ts"],
            )
            result = self.update(plan_path, state_path, "T4", "completed", result=worker_result)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("review result must have empty changed_files", result.stderr)

    def test_continuation_only_links_the_current_parent_goal(self) -> None:
        with self.workspace() as (previous_plan, previous_state):
            self.validate(previous_plan)
            current_dir = previous_plan.parent / "revision-2"
            current_dir.mkdir()
            current_plan = current_dir / "plan.json"
            current_plan.write_text(json.dumps(self.successor(previous_plan)), encoding="utf-8")
            payload = self.run_json("validate", current_plan)
            self.assertEqual(payload["revision"], 2)
            normalized = json.loads(current_plan.read_text(encoding="utf-8"))
            self.assertEqual(
                normalized["continuation"],
                {"previous_plan_path": str(previous_plan)},
            )
            previous_state_payload = json.loads(previous_state.read_text(encoding="utf-8"))
            self.assertEqual(previous_state_payload["continued_by"], str(current_plan))
            current_state_payload = json.loads(
                current_plan.with_name("state.json").read_text(encoding="utf-8")
            )
            self.assertEqual(current_state_payload["executor_mode"], "thread")
            switched = self.run_cli(
                "mode",
                current_plan,
                current_plan.with_name("state.json"),
                "subagent",
            )
            self.assertNotEqual(switched.returncode, 0)

    def test_successor_freezes_its_predecessor_and_prevents_forks(self) -> None:
        with self.workspace() as (previous_plan, previous_state):
            self.validate(previous_plan)
            first_dir = previous_plan.parent / "revision-2-a"
            first_dir.mkdir()
            first_plan = first_dir / "plan.json"
            first_plan.write_text(json.dumps(self.successor(previous_plan)), encoding="utf-8")
            self.validate(first_plan)

            repeated = self.run_cli("validate", first_plan)
            self.assertEqual(repeated.returncode, 0, repeated.stderr)
            old_next = self.run_cli("next", previous_plan, previous_state)
            self.assertNotEqual(old_next.returncode, 0)
            self.assertIn("plan already continued by", old_next.stderr)
            old_update = self.update(
                previous_plan,
                previous_state,
                "T1",
                "running",
                "thread-state",
            )
            self.assertNotEqual(old_update.returncode, 0)
            self.assertIn("plan already continued by", old_update.stderr)

            second_dir = previous_plan.parent / "revision-2-b"
            second_dir.mkdir()
            second_plan = second_dir / "plan.json"
            second_plan.write_text(json.dumps(self.successor(previous_plan)), encoding="utf-8")
            fork = self.run_cli("validate", second_plan)
            self.assertNotEqual(fork.returncode, 0)
            self.assertIn("previous plan already continued by", fork.stderr)

    def test_an_unstarted_revision_does_not_preselect_its_successor_mode(self) -> None:
        with self.workspace() as (previous_plan, _):
            self.validate(previous_plan, executor_mode=None)
            current_dir = previous_plan.parent / "revision-2"
            current_dir.mkdir()
            current_plan = current_dir / "plan.json"
            current_plan.write_text(
                json.dumps(self.successor(previous_plan)),
                encoding="utf-8",
            )
            current_state = self.validate(current_plan, executor_mode="subagent")

            state = json.loads(current_state.read_text(encoding="utf-8"))
            self.assertEqual(state["executor_mode"], "subagent")
            payload = self.run_json("next", current_plan, current_state)
            self.assertTrue(payload["actions"])

    def test_concurrent_successors_cannot_fork_one_predecessor(self) -> None:
        with self.workspace() as (previous_plan, previous_state):
            self.validate(previous_plan)
            successors = []
            for suffix in ("a", "b"):
                current_dir = previous_plan.parent / f"revision-2-{suffix}"
                current_dir.mkdir()
                current_plan = current_dir / "plan.json"
                current_plan.write_text(
                    json.dumps(self.successor(previous_plan)),
                    encoding="utf-8",
                )
                successors.append(current_plan)

            processes = [
                subprocess.Popen(
                    ["node", str(SCRIPT), "validate", str(current_plan)],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                )
                for current_plan in successors
            ]
            results = [
                process.communicate(timeout=10) + (process.returncode,)
                for process in processes
            ]

            self.assertEqual(sum(code == 0 for _, _, code in results), 1, results)
            self.assertEqual(sum(code != 0 for _, _, code in results), 1, results)
            previous = json.loads(previous_state.read_text(encoding="utf-8"))
            self.assertIn(previous["continued_by"], {str(path) for path in successors})

    def test_successor_is_initialized_before_predecessor_is_frozen(self) -> None:
        source = (ROOT / "tooling/thread-plan/thread-plan.ts").read_text(
            encoding="utf-8"
        )
        validate_body = source.split("function validateCommand", 1)[1].split(
            "function compareStableStrings", 1
        )[0]
        successor_branch = validate_body.split("const previousStatePath", 1)[1]

        self.assertLess(
            successor_branch.index("initializePlanState("),
            successor_branch.index("previousState.continued_by = planPath"),
        )

    def test_successor_reuses_the_owner_thread_from_the_current_parent_goal(self) -> None:
        with self.workspace() as (previous_plan, previous_state):
            self.validate(previous_plan)
            self.complete(previous_plan, previous_state, "T1", "thread-state")
            current_dir = previous_plan.parent / "revision-2"
            current_dir.mkdir()
            current_plan = current_dir / "plan.json"
            current_plan.write_text(json.dumps(self.successor(previous_plan)), encoding="utf-8")
            current_state = self.validate(current_plan)

            payload = self.run_json("next", current_plan, current_state)
            action = next(item for item in payload["actions"] if item["task_id"] == "T1")
            self.assertEqual(action["thread_id"], "thread-state")
            wrong = self.update(current_plan, current_state, "T1", "running", "thread-other")
            self.assertNotEqual(wrong.returncode, 0)
            self.assertIn("must reuse owner executor thread-state", wrong.stderr)
            correct = self.update(current_plan, current_state, "T1", "running", "thread-state")
            self.assertEqual(correct.returncode, 0, correct.stderr)

    def test_successor_cannot_hijack_another_owner_thread(self) -> None:
        with self.workspace() as (previous_plan, previous_state):
            self.validate(previous_plan)
            self.complete(previous_plan, previous_state, "T3", "thread-api")
            successor = self.successor(previous_plan)
            review = deepcopy(successor["tasks"][3])
            review["depends_on"] = []
            successor["tasks"] = [review]
            successor["safety"] = {
                "status": "sequential_only",
                "reasons": ["single review task"],
            }
            current_dir = previous_plan.parent / "revision-2"
            current_dir.mkdir()
            current_plan = current_dir / "plan.json"
            current_plan.write_text(json.dumps(successor), encoding="utf-8")
            current_state = self.validate(current_plan)

            result = self.update(
                current_plan,
                current_state,
                review["id"],
                "running",
                "thread-api",
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("already bound to another task owner", result.stderr)

    def test_continuation_rejects_running_parent_or_changed_identity(self) -> None:
        with self.workspace() as (previous_plan, previous_state):
            self.validate(previous_plan)
            self.assertEqual(
                self.update(previous_plan, previous_state, "T1", "running", "thread-1").returncode,
                0,
            )
            current_dir = previous_plan.parent / "revision-2"
            current_dir.mkdir()
            current_plan = current_dir / "plan.json"
            current_plan.write_text(json.dumps(self.successor(previous_plan)), encoding="utf-8")
            result = self.run_cli("validate", current_plan)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("still has running tasks", result.stderr)

        for mutation, message in (
            (lambda plan: plan.__setitem__("parent_goal", "another goal"), "parent_goal does not match"),
            (lambda plan: plan.__setitem__("revision", 3), "revision must increment"),
            (
                lambda plan: plan["modules"][0]["worker_profile"].__setitem__("reasoning_effort", "high"),
                "module definition cannot change",
            ),
            (
                lambda plan: plan["modules"][0].__setitem__("worker_context", "changed context"),
                "module definition cannot change",
            ),
            (
                lambda plan: (
                    [
                        task.__setitem__("module_id", "flow-review")
                        for task in plan["tasks"]
                        if task["module_id"] == "state-domain"
                    ],
                    plan["modules"].pop(0),
                ),
                "continuation must retain module definition",
            ),
        ):
            with self.subTest(message=message), self.workspace() as (previous_plan, _):
                self.validate(previous_plan)
                current_dir = previous_plan.parent / "revision-2"
                current_dir.mkdir()
                current_plan = current_dir / "plan.json"
                plan = self.successor(previous_plan)
                mutation(plan)
                current_plan.write_text(json.dumps(plan), encoding="utf-8")
                result = self.run_cli("validate", current_plan)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr)

    def test_old_route_fields_are_rejected(self) -> None:
        with self.workspace() as (plan_path, _):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["dispatch"] = {"strategy": "dependency_ready", "routes": {}}
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            result = self.run_cli("validate", plan_path)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("dispatch routes are not part of the plan", result.stderr)

        with self.workspace() as (previous_plan, _):
            self.validate(previous_plan)
            current_dir = previous_plan.parent / "revision-2"
            current_dir.mkdir()
            current_plan = current_dir / "plan.json"
            plan = self.successor(previous_plan)
            plan["continuation"]["reuse"] = {}
            current_plan.write_text(json.dumps(plan), encoding="utf-8")
            result = self.run_cli("validate", current_plan)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("continuation.reuse is not part", result.stderr)

    def test_plan_digest_detects_mutation(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["parent_goal"] = "mutated"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            result = self.run_cli("next", plan_path, state_path)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("plan digest mismatch", result.stderr)

    def test_concurrent_updates_preserve_both_ready_tasks(self) -> None:
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
                for task_id, thread_id in (("T1", "thread-1"), ("T3", "thread-3"))
            ]
            results = [process.communicate(timeout=10) + (process.returncode,) for process in processes]
            self.assertTrue(all(code == 0 for _, _, code in results), results)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["tasks"]["T1"]["thread_id"], "thread-1")
            self.assertEqual(state["tasks"]["T3"]["thread_id"], "thread-3")

    def test_claude_driver_requires_claude_platform(self) -> None:
        with self.workspace() as (plan_path, _):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["execution_platform"] = "claude_code"
            plan["modules"] = [
                {
                    **module,
                    "worker_profile": {"model": "sonnet", "reasoning_effort": "max"},
                }
                for module in plan["modules"]
            ]
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            payload = self.run_json("validate", plan_path, script=CLAUDE_SCRIPT)
            self.assertEqual(payload["status"], "valid")

    def test_published_drivers_only_differ_by_platform(self) -> None:
        codex = SCRIPT.read_text(encoding="utf-8").replace('"codex"', '"PLATFORM"')
        claude = CLAUDE_SCRIPT.read_text(encoding="utf-8").replace('"claude_code"', '"PLATFORM"')
        self.assertEqual(codex, claude)


if __name__ == "__main__":
    unittest.main()
