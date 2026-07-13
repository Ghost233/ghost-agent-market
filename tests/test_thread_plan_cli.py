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

    def render_graph(
        self,
        stdout: str,
        safety_status: str,
        revision: int = 1,
    ) -> str:
        marker, graph = stdout.split("\n", 1)
        self.assertRegex(
            marker,
            rf"^%% thread-plan plan_digest=[0-9a-f]{{64}} revision={revision} safety\.status={safety_status}$",
        )
        return graph

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
        result: dict | None = None,
        result_path: Path | None = None,
    ) -> subprocess.CompletedProcess[str]:
        args: list[object] = ["update", plan_path, state_path, task_id, status]
        if status == "running" and thread_id is not None:
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

    def worker_result(
        self,
        plan_path: Path,
        state_path: Path,
        task_id: str,
        status: str,
    ) -> dict:
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        state = json.loads(state_path.read_text(encoding="utf-8"))
        task = next(task for task in plan["tasks"] if task["id"] == task_id)
        needs_review = status == "needs_main_review"
        return {
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
                "reason": "verification requires a repair task",
                "required_for_done_when": "the verification must pass",
                "suggested_owner": task["module_id"],
                "split_hints": [],
                "overlap_hints": [],
            }
            if needs_review
            else None,
            "summary": f"task {status}",
        }

    def continuation_plan(
        self,
        previous_plan: Path,
        previous_state: Path,
    ) -> dict:
        plan = json.loads(previous_plan.read_text(encoding="utf-8"))
        plan.pop("dispatch", None)
        plan["revision"] += 1
        state = json.loads(previous_state.read_text(encoding="utf-8"))
        unfinished = sorted(
            task_id
            for task_id, task_state in state["tasks"].items()
            if task_state["status"] != "completed"
        )
        plan["continuation"] = {
            "previous_plan_path": str(previous_plan),
            "reviewed_task_ids": unfinished,
            "replacements": {task_id: [task_id] for task_id in unfinished},
        }
        return plan

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
            self.assertIsNone(state["tasks"]["T1"]["result"])
            self.assertTrue(state["plan_digest"])
            self.assertTrue((plan_path.parent / "results").is_dir())
            render_result = self.run_cli("render", plan_path)
            self.assertEqual(render_result.returncode, 0, render_result.stderr)
            self.assertIn(
                f"plan_digest={state['plan_digest']}",
                render_result.stdout.split("\n", 1)[0],
            )

    def test_render_single_node_dag(self) -> None:
        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["modules"] = [plan["modules"][0]]
            plan["tasks"] = [plan["tasks"][0]]
            plan["safety"] = {
                "status": "sequential_only",
                "reasons": ["Only one task is present."],
            }
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            result = self.run_cli("render", plan_path)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                self.render_graph(result.stdout, "sequential_only"),
                "flowchart LR\n"
                '  N0["T1 · [实施] 抽离页面状态类型 · state-domain"]\n',
            )
            self.assertFalse(state_path.exists())
            self.assertFalse((plan_path.parent / "results").exists())

    def test_render_sequential_dag_with_roles_and_escaped_labels(self) -> None:
        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            work = deepcopy(plan["tasks"][0])
            review = deepcopy(plan["tasks"][3])
            review.update({
                "id": "T2",
                "logical_id": "state.review-flow",
                "title": '审查 "页面" <集成> & 回归\n结果 ```mermaid',
                "depends_on": ["T1"],
            })
            verify = deepcopy(plan["tasks"][3])
            verify.update({
                "id": "T3",
                "logical_id": "state.verify-flow",
                "title": "验证完整页面流程",
                "thread_role": "verify",
                "depends_on": ["T2"],
            })
            plan["tasks"] = [verify, work, review]
            plan["safety"] = {
                "status": "sequential_only",
                "reasons": ["Every task depends on the preceding task."],
            }
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            result = self.run_cli("render", plan_path)

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                self.render_graph(result.stdout, "sequential_only"),
                "flowchart LR\n"
                '  N0["T1 · [实施] 抽离页面状态类型 · state-domain"]\n'
                '  N1["T2 · [审查] 审查 &quot;页面&quot; &lt;集成&gt; &amp; 回归&#10;结果 &#96;&#96;&#96;mermaid · flow-review"]\n'
                '  N2["T3 · [验证] 验证完整页面流程 · flow-review"]\n'
                "  N0 --> N1\n"
                "  N1 --> N2\n",
            )
            self.assertFalse(state_path.exists())

    def test_render_parallel_dag_uses_only_dependency_edges(self) -> None:
        with self.workspace() as (plan_path, state_path):
            result = self.run_cli("render", plan_path)

            self.assertEqual(result.returncode, 0, result.stderr)
            graph = self.render_graph(result.stdout, "parallel_safe")
            self.assertIn("  N0 --> N1\n", graph)
            self.assertIn("  N1 --> N3\n", graph)
            self.assertIn("  N2 --> N3\n", graph)
            self.assertNotIn("  N0 --> N2\n", graph)
            self.assertFalse(state_path.exists())

    def test_render_is_deterministic_across_array_order(self) -> None:
        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            reordered_path = plan_path.with_name("reordered.json")
            reordered = deepcopy(plan)
            reordered["tasks"] = list(reversed(reordered["tasks"]))
            for task in reordered["tasks"]:
                task["depends_on"] = list(reversed(task["depends_on"]))
            reordered_path.write_text(json.dumps(reordered), encoding="utf-8")

            original_result = self.run_cli("render", plan_path)
            reordered_result = self.run_cli("render", reordered_path)

            self.assertEqual(original_result.returncode, 0, original_result.stderr)
            self.assertEqual(reordered_result.returncode, 0, reordered_result.stderr)
            self.assertEqual(
                self.render_graph(original_result.stdout, "parallel_safe"),
                self.render_graph(reordered_result.stdout, "parallel_safe"),
            )
            self.assertFalse(state_path.exists())

    def test_render_marker_distinguishes_plans_with_same_revision_and_safety(self) -> None:
        with self.workspace() as (plan_path, state_path):
            original_result = self.run_cli("render", plan_path)
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["parent_goal"] = "A different parent goal"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            changed_result = self.run_cli("render", plan_path)

            self.assertEqual(original_result.returncode, 0, original_result.stderr)
            self.assertEqual(changed_result.returncode, 0, changed_result.stderr)
            original_marker = original_result.stdout.split("\n", 1)[0]
            changed_marker = changed_result.stdout.split("\n", 1)[0]
            self.assertNotEqual(original_marker, changed_marker)
            self.assertEqual(
                self.render_graph(original_result.stdout, "parallel_safe"),
                self.render_graph(changed_result.stdout, "parallel_safe"),
            )
            self.assertFalse(state_path.exists())

    def test_render_rejects_invalid_plan_without_writing_state(self) -> None:
        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["tasks"][0]["depends_on"] = ["missing-task"]
            original = json.dumps(plan)
            plan_path.write_text(original, encoding="utf-8")

            result = self.run_cli("render", plan_path)

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")
            self.assertIn("references unknown task: missing-task", result.stderr)
            self.assertEqual(plan_path.read_text(encoding="utf-8"), original)
            self.assertFalse(state_path.exists())
            self.assertFalse((plan_path.parent / "results").exists())

    def test_single_node_sequential_dag_validates_and_is_ready(self) -> None:
        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["modules"] = [plan["modules"][0]]
            plan["tasks"] = [plan["tasks"][0]]
            plan["safety"] = {
                "status": "sequential_only",
                "reasons": ["Only one task is present."],
            }
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            self.validate(plan_path)
            payload = self.run_json("next", plan_path, state_path)

            self.assertEqual(
                [action["task_id"] for action in payload["actions"]],
                ["T1"],
            )

    def test_next_and_update_reject_needs_user_review_without_changing_state(self) -> None:
        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["safety"] = {
                "status": "needs_user_review",
                "reasons": ["An external approval boundary is unresolved."],
            }
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            self.validate(plan_path)
            original_state = state_path.read_text(encoding="utf-8")

            result = self.run_cli("next", plan_path, state_path)

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")
            self.assertIn(
                "plan safety requires user review; next is not executable",
                result.stderr,
            )
            self.assertEqual(state_path.read_text(encoding="utf-8"), original_state)

            update_result = self.update(
                plan_path,
                state_path,
                "T1",
                "running",
                "thread-1",
            )
            self.assertNotEqual(update_result.returncode, 0)
            self.assertIn(
                "plan safety requires user review; update is not executable",
                update_result.stderr,
            )
            self.assertEqual(state_path.read_text(encoding="utf-8"), original_state)

    def test_sequential_dag_releases_exactly_one_task_at_a_time(self) -> None:
        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            work = deepcopy(plan["tasks"][0])
            review = deepcopy(plan["tasks"][3])
            review.update({"id": "T2", "depends_on": ["T1"]})
            verify = deepcopy(review)
            verify.update({
                "id": "T3",
                "logical_id": "flow.verify-integration",
                "title": "验证页面集成流程",
                "thread_role": "verify",
                "depends_on": ["T2"],
            })
            plan["tasks"] = [work, review, verify]
            plan["safety"] = {
                "status": "sequential_only",
                "reasons": ["Every task depends on the preceding task."],
            }
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            self.validate(plan_path)

            for task_id, thread_id, expected_next in (
                ("T1", "thread-1", "T2"),
                ("T2", "thread-2", "T3"),
            ):
                payload = self.run_json("next", plan_path, state_path)
                self.assertEqual(
                    [action["task_id"] for action in payload["actions"]],
                    [task_id],
                )
                self.assertEqual(
                    self.update(
                        plan_path,
                        state_path,
                        task_id,
                        "running",
                        thread_id,
                    ).returncode,
                    0,
                )
                self.assertEqual(
                    self.update(
                        plan_path,
                        state_path,
                        task_id,
                        "completed",
                    ).returncode,
                    0,
                )
                next_payload = self.run_json("next", plan_path, state_path)
                self.assertEqual(
                    [action["task_id"] for action in next_payload["actions"]],
                    [expected_next],
                )

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
            self.assertEqual(actions["T1"]["thread_role"], "work")
            self.assertEqual(
                actions["T1"]["expected_title"],
                "[GA][实施][待命] state.extract-types · 抽离页面状态类型",
            )
            self.assertEqual(
                actions["T1"]["result_path"],
                str(plan_path.parent / "results" / "T1.json"),
            )
            self.assertEqual(actions["T3"]["thread_role"], "work")

    def test_next_exposes_review_role_after_dependencies_complete(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            for task_id, thread_id in (("T1", "thread-1"), ("T3", "thread-3")):
                self.assertEqual(
                    self.update(plan_path, state_path, task_id, "running", thread_id).returncode,
                    0,
                )
                self.assertEqual(
                    self.update(plan_path, state_path, task_id, "completed").returncode,
                    0,
                )
            self.assertEqual(
                self.update(plan_path, state_path, "T2", "running", "thread-1").returncode,
                0,
            )
            self.assertEqual(
                self.update(plan_path, state_path, "T2", "completed").returncode,
                0,
            )

            payload = self.run_json("next", plan_path, state_path)

            self.assertEqual(len(payload["actions"]), 1)
            self.assertEqual(payload["actions"][0]["task_id"], "T4")
            self.assertEqual(payload["actions"][0]["thread_role"], "review")
            self.assertEqual(payload["actions"][0]["action"], "create_thread")

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
                "result": None,
            })
            self.assertEqual(state["tasks"]["T3"], {
                "status": "running",
                "thread_id": "thread-3",
                "result": None,
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
                "result": None,
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

    def test_validate_rejects_invalid_thread_roles(self) -> None:
        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["tasks"][0]["thread_role"] = "observer"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            result = self.run_cli("validate", plan_path)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("thread_role is invalid", result.stderr)
            self.assertFalse(state_path.exists())

        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["tasks"][0]["thread_role"] = "review"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            result = self.run_cli("validate", plan_path)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("review thread must have empty writable_paths", result.stderr)
            self.assertFalse(state_path.exists())

        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["tasks"][0]["writable_paths"] = []
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            result = self.run_cli("validate", plan_path)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("work thread must have non-empty writable_paths", result.stderr)
            self.assertFalse(state_path.exists())

    def test_validate_derives_roles_for_legacy_v3_plans(self) -> None:
        with self.workspace() as (plan_path, _):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            for task in plan["tasks"]:
                task.pop("thread_role")
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            self.validate(plan_path)

            normalized = json.loads(plan_path.read_text(encoding="utf-8"))
            roles = {task["id"]: task["thread_role"] for task in normalized["tasks"]}
            self.assertEqual(roles["T1"], "work")
            self.assertEqual(roles["T4"], "review")

    def test_verify_role_requires_an_empty_write_scope_and_exposes_titles(self) -> None:
        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["tasks"][0]["thread_role"] = "verify"
            plan["tasks"][0]["writable_paths"] = []
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            self.validate(plan_path)
            action = next(
                action
                for action in self.run_json("next", plan_path, state_path)["actions"]
                if action["task_id"] == "T1"
            )
            self.assertEqual(action["thread_role"], "verify")
            self.assertEqual(
                action["expected_title"],
                "[GA][验证][待命] state.extract-types · 抽离页面状态类型",
            )

            running = self.run_json(
                "update", plan_path, state_path, "T1", "running", "thread-verify"
            )
            self.assertEqual(
                running["expected_title"],
                "[GA][验证][执行] state.extract-types · 抽离页面状态类型",
            )
            completed = self.update(plan_path, state_path, "T1", "completed")
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(
                json.loads(completed.stdout)["expected_title"],
                "[GA][验证][完成] state.extract-types · 抽离页面状态类型",
            )
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["tasks"]["T1"]["result"]["status"], "completed")

        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["tasks"][0]["thread_role"] = "verify"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            result = self.run_cli("validate", plan_path)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("verify thread must have empty writable_paths", result.stderr)
            self.assertFalse(state_path.exists())

        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["tasks"][0]["thread_role"] = "verify"
            plan["tasks"][0]["writable_paths"] = []
            plan["tasks"][0]["verification"] = []
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            result = self.run_cli("validate", plan_path)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("verification must not be empty", result.stderr)
            self.assertFalse(state_path.exists())

    def test_route_reuse_requires_the_same_thread_role(self) -> None:
        with self.workspace() as (plan_path, _):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["tasks"][1]["thread_role"] = "review"
            plan["tasks"][1]["writable_paths"] = []
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            self.validate(plan_path)

            normalized = json.loads(plan_path.read_text(encoding="utf-8"))
            self.assertEqual(
                normalized["dispatch"]["routes"]["T2"],
                {"action": "create"},
            )

    def test_route_reuse_requires_the_same_module_boundary(self) -> None:
        with self.workspace() as (plan_path, _):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["tasks"][1]["module_id"] = "flow-review"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            self.validate(plan_path)

            normalized = json.loads(plan_path.read_text(encoding="utf-8"))
            self.assertEqual(
                normalized["dispatch"]["routes"]["T2"],
                {"action": "create"},
            )

    def test_same_thread_owner_key_requires_dag_comparability(self) -> None:
        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["tasks"][2]["module_id"] = "state-domain"
            plan_path.write_text(json.dumps(plan), encoding="utf-8")

            result = self.run_cli("validate", plan_path)

            self.assertNotEqual(result.returncode, 0)
            self.assertIn(
                "same module_id and thread_role must be DAG-comparable",
                result.stderr,
            )
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

    def test_terminal_update_requires_the_canonical_result_path(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            self.assertEqual(
                self.update(
                    plan_path, state_path, "T1", "running", "thread-1"
                ).returncode,
                0,
            )

            missing = self.run_cli(
                "update", plan_path, state_path, "T1", "completed"
            )
            outside = self.update(
                plan_path,
                state_path,
                "T1",
                "completed",
                result_path=plan_path.parent / "outside.json",
            )

            self.assertNotEqual(missing.returncode, 0)
            self.assertIn("result_path must be a non-empty string", missing.stderr)
            self.assertNotEqual(outside.returncode, 0)
            self.assertIn("result path must equal the canonical path", outside.stderr)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["tasks"]["T1"]["status"], "running")
            self.assertIsNone(state["tasks"]["T1"]["result"])

    def test_terminal_result_identity_must_match_the_running_binding(self) -> None:
        mutations = (
            ("status", "blocked", "status mismatch"),
            ("task_id", "T9", "task_id mismatch"),
            ("logical_id", "state.other", "logical_id mismatch"),
            ("thread_role", "verify", "thread_role mismatch"),
            ("module_id", "other", "module_id mismatch"),
            ("thread_id", "thread-other", "thread_id mismatch"),
        )
        for field, value, error in mutations:
            with self.subTest(field=field), self.workspace() as (plan_path, state_path):
                self.validate(plan_path)
                self.assertEqual(
                    self.update(
                        plan_path, state_path, "T1", "running", "thread-1"
                    ).returncode,
                    0,
                )
                result = self.worker_result(
                    plan_path, state_path, "T1", "completed"
                )
                result[field] = value

                update = self.update(
                    plan_path,
                    state_path,
                    "T1",
                    "completed",
                    result=result,
                )

                self.assertNotEqual(update.returncode, 0)
                self.assertIn(error, update.stderr)

    def test_terminal_result_validates_changed_files_and_scope_exception(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            self.assertEqual(
                self.update(
                    plan_path, state_path, "T1", "running", "thread-1"
                ).returncode,
                0,
            )
            result = self.worker_result(plan_path, state_path, "T1", "completed")
            result["changed_files"] = ["outside/file.ts"]

            update = self.update(
                plan_path, state_path, "T1", "completed", result=result
            )

            self.assertNotEqual(update.returncode, 0)
            self.assertIn("changed_files exceed writable_paths", update.stderr)

        with self.workspace() as (plan_path, state_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["tasks"][0]["thread_role"] = "verify"
            plan["tasks"][0]["writable_paths"] = []
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            self.validate(plan_path)
            self.assertEqual(
                self.update(
                    plan_path, state_path, "T1", "running", "thread-verify"
                ).returncode,
                0,
            )
            result = self.worker_result(plan_path, state_path, "T1", "completed")
            result["changed_files"] = ["src/generated.swift"]

            update = self.update(
                plan_path, state_path, "T1", "completed", result=result
            )

            self.assertNotEqual(update.returncode, 0)
            self.assertIn("verify result must have empty changed_files", update.stderr)

        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            self.assertEqual(
                self.update(
                    plan_path, state_path, "T1", "running", "thread-1"
                ).returncode,
                0,
            )
            result = self.worker_result(
                plan_path, state_path, "T1", "needs_main_review"
            )
            result["changed_files"] = ["src/repair/generated.ts"]

            update = self.update(
                plan_path,
                state_path,
                "T1",
                "needs_main_review",
                result=result,
            )

            self.assertEqual(update.returncode, 0, update.stderr)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(
                state["tasks"]["T1"]["result"]["scope_request"]["paths"],
                ["src/repair/**"],
            )

        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            self.assertEqual(
                self.update(
                    plan_path, state_path, "T1", "running", "thread-1"
                ).returncode,
                0,
            )
            result = self.worker_result(plan_path, state_path, "T1", "completed")
            result["diff_self_check"] = "fail"

            update = self.update(
                plan_path, state_path, "T1", "completed", result=result
            )

            self.assertNotEqual(update.returncode, 0)
            self.assertIn("completed requires diff_self_check pass", update.stderr)

        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            self.assertEqual(
                self.update(
                    plan_path, state_path, "T1", "running", "thread-1"
                ).returncode,
                0,
            )
            result = self.worker_result(
                plan_path, state_path, "T1", "needs_main_review"
            )
            result["diff_self_check"] = "pass"

            update = self.update(
                plan_path,
                state_path,
                "T1",
                "needs_main_review",
                result=result,
            )

            self.assertNotEqual(update.returncode, 0)
            self.assertIn("requires diff_self_check scope_exception", update.stderr)

    def test_terminal_result_is_persisted_and_survives_revalidation(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            self.assertEqual(
                self.update(
                    plan_path, state_path, "T1", "running", "thread-1"
                ).returncode,
                0,
            )
            expected = self.worker_result(
                plan_path, state_path, "T1", "completed"
            )

            completed = self.update(
                plan_path, state_path, "T1", "completed", result=expected
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.validate(plan_path)

            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["tasks"]["T1"]["result"], expected)

    def test_legacy_state_without_result_remains_readable(self) -> None:
        with self.workspace() as (plan_path, state_path):
            self.validate(plan_path)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            for task_state in state["tasks"].values():
                task_state.pop("result")
            state_path.write_text(json.dumps(state), encoding="utf-8")

            payload = self.run_json("next", plan_path, state_path)

            self.assertEqual(
                {action["task_id"] for action in payload["actions"]},
                {"T1", "T3"},
            )

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

    def test_continuation_automatically_reuses_every_terminal_status(self) -> None:
        for status in ("completed", "blocked", "failed", "needs_main_review"):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as directory:
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
                        f"thread-{status}",
                    ).returncode,
                    0,
                )
                terminal = self.update(
                    previous_plan,
                    previous_state,
                    "T1",
                    status,
                )
                self.assertEqual(terminal.returncode, 0, terminal.stderr)

                plan = self.continuation_plan(previous_plan, previous_state)
                if status == "blocked":
                    plan["continuation"]["reuse"] = {}
                current_plan.write_text(json.dumps(plan), encoding="utf-8")

                validation = self.run_json("validate", current_plan)
                self.assertEqual(validation["continuation_reuse_count"], 1)
                action = next(
                    action
                    for action in self.run_json(
                        "next", current_plan, current_plan.with_name("state.json")
                    )["actions"]
                    if action["task_id"] == "T1"
                )
                self.assertEqual(action["action"], "reuse_existing_thread")
                self.assertEqual(action["thread_id"], f"thread-{status}")
                self.assertEqual(action["reuse_mode"], "continue")

    def test_module_profile_and_context_changes_do_not_break_automatic_reuse(self) -> None:
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

            plan = self.continuation_plan(previous_plan, previous_state)
            plan["modules"][0]["worker_profile"] = {
                "model": "gpt-5.6-terra",
                "reasoning_effort": "high",
            }
            plan["modules"][0]["worker_context"] = "Use the revised task context."
            current_plan.write_text(json.dumps(plan), encoding="utf-8")

            self.validate(current_plan)
            action = next(
                action
                for action in self.run_json(
                    "next", current_plan, current_plan.with_name("state.json")
                )["actions"]
                if action["task_id"] == "T1"
            )
            self.assertEqual(action["thread_id"], "thread-existing")

    def test_handoff_mode_and_replacements_are_independent_of_thread_reuse(self) -> None:
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
                    "thread-failed",
                ).returncode,
                0,
            )
            failed = self.update(
                previous_plan,
                previous_state,
                "T1",
                "failed",
            )
            self.assertEqual(failed.returncode, 0, failed.stderr)

            plan = self.continuation_plan(previous_plan, previous_state)
            plan["tasks"][0]["logical_id"] = "state.changed-responsibility"
            plan["continuation"]["replacements"]["T1"] = ["T4"]
            current_plan.write_text(json.dumps(plan), encoding="utf-8")

            self.validate(current_plan)
            action = next(
                action
                for action in self.run_json(
                    "next", current_plan, current_plan.with_name("state.json")
                )["actions"]
                if action["task_id"] == "T1"
            )
            self.assertEqual(action["thread_id"], "thread-failed")
            self.assertEqual(action["reuse_mode"], "handoff")
            self.assertEqual(action["from_task"], "T1")

    def test_nonempty_legacy_reuse_must_match_the_automatic_route(self) -> None:
        invalid_assertions = (
            {"T1": {"from_task": "T2", "mode": "continue"}},
            {"T1": {"from_task": "T1", "mode": "handoff"}},
        )
        for reuse in invalid_assertions:
            with self.subTest(reuse=reuse), tempfile.TemporaryDirectory() as directory:
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
                plan = self.continuation_plan(previous_plan, previous_state)
                plan["continuation"]["reuse"] = reuse
                current_plan.write_text(json.dumps(plan), encoding="utf-8")

                result = self.run_cli("validate", current_plan)

                self.assertNotEqual(result.returncode, 0)
                self.assertIn(
                    "reuse assertion does not match automatic route",
                    result.stderr,
                )
                self.assertFalse(current_plan.with_name("state.json").exists())

    def test_automatic_reuse_searches_the_complete_continuation_ancestry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            revision_1_dir = root / "revision-1"
            revision_2_dir = root / "revision-2"
            revision_3_dir = root / "revision-3"
            revision_1_dir.mkdir()
            revision_2_dir.mkdir()
            revision_3_dir.mkdir()
            revision_1_plan = revision_1_dir / "plan.json"
            revision_2_plan = revision_2_dir / "plan.json"
            revision_3_plan = revision_3_dir / "plan.json"
            shutil.copyfile(FIXTURES / "parallel.json", revision_1_plan)
            revision_1_state = self.validate(revision_1_plan)
            self.assertEqual(
                self.update(
                    revision_1_plan,
                    revision_1_state,
                    "T1",
                    "running",
                    "thread-ancestor",
                ).returncode,
                0,
            )
            self.assertEqual(
                self.update(
                    revision_1_plan,
                    revision_1_state,
                    "T1",
                    "completed",
                ).returncode,
                0,
            )

            revision_2 = self.continuation_plan(
                revision_1_plan,
                revision_1_state,
            )
            revision_2_task = deepcopy(revision_2["tasks"][0])
            revision_2_task.update({
                "id": "U1",
                "title": "保留同一模块的待执行任务",
                "depends_on": [],
            })
            revision_2["tasks"] = [revision_2_task]
            revision_2["continuation"]["replacements"] = {
                task_id: ["U1"]
                for task_id in revision_2["continuation"]["reviewed_task_ids"]
            }
            revision_2["safety"] = {
                "status": "sequential_only",
                "reasons": ["Only one task is present."],
            }
            revision_2_plan.write_text(json.dumps(revision_2), encoding="utf-8")
            revision_2_state = self.validate(revision_2_plan)

            revision_3 = self.continuation_plan(
                revision_2_plan,
                revision_2_state,
            )
            revision_3_task = revision_3["tasks"][0]
            revision_3_task["id"] = "V1"
            revision_3_task["title"] = "恢复祖先模块线程"
            revision_3["continuation"]["replacements"] = {"U1": ["V1"]}
            revision_3_plan.write_text(json.dumps(revision_3), encoding="utf-8")

            validation = self.run_json("validate", revision_3_plan)
            self.assertEqual(validation["continuation_reuse_count"], 1)
            action = self.run_json(
                "next",
                revision_3_plan,
                revision_3_plan.with_name("state.json"),
            )["actions"][0]
            self.assertEqual(action["task_id"], "V1")
            self.assertEqual(action["thread_id"], "thread-ancestor")
            self.assertEqual(action["from_plan"], str(revision_1_plan))
            self.assertEqual(action["from_task"], "T1")

    def test_latest_terminal_task_owns_a_legacy_key_with_multiple_threads(self) -> None:
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
                    "thread-older",
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
            self.assertEqual(
                self.update(
                    previous_plan,
                    previous_state,
                    "T2",
                    "running",
                    "thread-older",
                ).returncode,
                0,
            )
            self.assertEqual(
                self.update(
                    previous_plan,
                    previous_state,
                    "T2",
                    "completed",
                ).returncode,
                0,
            )

            legacy_state = json.loads(previous_state.read_text(encoding="utf-8"))
            legacy_state["tasks"]["T2"]["thread_id"] = "thread-newer"
            legacy_state["tasks"]["T2"]["result"]["thread_id"] = "thread-newer"
            previous_state.write_text(json.dumps(legacy_state), encoding="utf-8")

            current = self.continuation_plan(previous_plan, previous_state)
            current_task = deepcopy(current["tasks"][1])
            current_task.update({
                "id": "U1",
                "title": "继续最近的模块任务",
                "depends_on": [],
            })
            current["tasks"] = [current_task]
            current["continuation"]["replacements"] = {
                task_id: ["U1"]
                for task_id in current["continuation"]["reviewed_task_ids"]
            }
            current["safety"] = {
                "status": "sequential_only",
                "reasons": ["Only one task is present."],
            }
            current_plan.write_text(json.dumps(current), encoding="utf-8")

            self.validate(current_plan)
            action = self.run_json(
                "next", current_plan, current_plan.with_name("state.json")
            )["actions"][0]
            self.assertEqual(action["thread_id"], "thread-newer")
            self.assertEqual(action["from_task"], "T2")
            self.assertEqual(action["reuse_mode"], "continue")

    def test_legacy_history_with_incomparable_owner_keys_remains_readable(self) -> None:
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
                    "thread-legacy",
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
            self.assertEqual(
                self.update(
                    previous_plan,
                    previous_state,
                    "T3",
                    "running",
                    "thread-legacy-later",
                ).returncode,
                0,
            )
            self.assertEqual(
                self.update(
                    previous_plan,
                    previous_state,
                    "T3",
                    "completed",
                ).returncode,
                0,
            )

            legacy_plan = json.loads(previous_plan.read_text(encoding="utf-8"))
            legacy_plan["tasks"][2]["module_id"] = "state-domain"
            previous_plan.write_text(
                f"{json.dumps(legacy_plan, indent=2)}\n",
                encoding="utf-8",
            )
            legacy_state = json.loads(previous_state.read_text(encoding="utf-8"))
            legacy_state["tasks"]["T3"]["result"]["module_id"] = "state-domain"
            legacy_state["plan_digest"] = hashlib.sha256(
                previous_plan.read_bytes()
            ).hexdigest()
            previous_state.write_text(
                f"{json.dumps(legacy_state, indent=2)}\n",
                encoding="utf-8",
            )

            current = deepcopy(legacy_plan)
            current.pop("dispatch")
            current["revision"] = 2
            current["tasks"] = [current["tasks"][0]]
            current["safety"] = {
                "status": "sequential_only",
                "reasons": ["Only one current task is present."],
            }
            current["continuation"] = {
                "previous_plan_path": str(previous_plan),
                "reviewed_task_ids": ["T2", "T4"],
                "replacements": {
                    "T2": ["T1"],
                    "T4": ["T1"],
                },
            }
            current_plan.write_text(json.dumps(current), encoding="utf-8")

            self.validate(current_plan)
            action = self.run_json(
                "next", current_plan, current_plan.with_name("state.json")
            )["actions"][0]
            self.assertEqual(action["thread_id"], "thread-legacy-later")
            self.assertEqual(action["from_task"], "T3")
            self.assertEqual(action["reuse_mode"], "handoff")

    def test_sequential_successor_revision_validates_renders_and_runs(self) -> None:
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
            for task, dependencies in zip(
                plan["tasks"],
                ([], ["T1"], ["T2"], ["T3"]),
                strict=True,
            ):
                task["depends_on"] = dependencies
            plan["safety"] = {
                "status": "sequential_only",
                "reasons": ["All tasks form one dependency chain."],
            }
            plan["continuation"] = {
                "previous_plan_path": str(previous_plan),
                "reviewed_task_ids": ["T2", "T3", "T4"],
                "replacements": {
                    "T2": ["T2"],
                    "T3": ["T3"],
                    "T4": ["T4"],
                },
                "reuse": {"T1": {"from_task": "T1", "mode": "continue"}},
            }
            current_plan.write_text(json.dumps(plan), encoding="utf-8")

            validation = self.run_json("validate", current_plan)
            self.assertEqual(validation["revision"], 2)
            self.assertEqual(validation["safety"], "sequential_only")
            render_result = self.run_cli("render", current_plan)
            self.assertEqual(render_result.returncode, 0, render_result.stderr)
            graph = self.render_graph(
                render_result.stdout,
                "sequential_only",
                revision=2,
            )
            self.assertIn("  N0 --> N1\n", graph)
            self.assertIn("  N1 --> N2\n", graph)
            self.assertIn("  N2 --> N3\n", graph)

            current_state = current_plan.with_name("state.json")
            payload = self.run_json("next", current_plan, current_state)
            self.assertEqual(
                [action["task_id"] for action in payload["actions"]],
                ["T1"],
            )
            self.assertEqual(
                payload["actions"][0]["action"],
                "reuse_existing_thread",
            )
            self.assertEqual(payload["actions"][0]["thread_id"], "thread-existing")

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
