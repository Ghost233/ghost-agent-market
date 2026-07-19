from contextlib import contextmanager
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
CODEX_SCRIPT = ROOT / "codex-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs"
CLAUDE_SCRIPT = ROOT / "claude-code-market/scripts/goal-dag.mjs"
FIXTURES = ROOT / "tests/fixtures/goal-dag"


class GoalDagCliTests(unittest.TestCase):
    @contextmanager
    def workspace(self, platform: str = "codex"):
        with tempfile.TemporaryDirectory() as directory:
            workspace_root = Path(directory)
            subprocess.run(["git", "init", "-q", str(workspace_root)], check=True)
            (workspace_root / "README.md").write_text("fixture repository\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(workspace_root), "add", "README.md"], check=True)
            subprocess.run(
                ["git", "-C", str(workspace_root), "-c", "user.name=Goal DAG", "-c", "user.email=goal-dag@example.invalid", "commit", "-q", "-m", "fixture baseline"],
                check=True,
            )
            root = workspace_root / ".ghost-agent-workflow" / "goal-fixture"
            root.mkdir(parents=True)
            document = workspace_root / "development.md"
            document.write_text("# 页面状态重构\n\n完成状态抽离、夹具与集成验证。\n", encoding="utf-8")

            goal = json.loads((FIXTURES / "goal.json").read_text(encoding="utf-8"))
            goal["execution_platform"] = platform
            goal["workspace"] = {"root": str(workspace_root)}
            goal["source"] = {
                "path": str(document),
                "digest": hashlib.sha256(document.read_bytes()).hexdigest(),
                "revision": 1,
            }
            if platform == "claude_code":
                goal["lifecycle"]["controller"] = "local_fallback"
                goal["lifecycle"]["native_goal"] = None
            goal_path = root / "goal.json"
            goal_path.write_text(json.dumps(goal, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

            plan = json.loads((FIXTURES / "plan.json").read_text(encoding="utf-8"))
            plan["execution_platform"] = platform
            plan["goal_contract_path"] = str(goal_path)
            plan["goal_digest"] = hashlib.sha256(goal_path.read_bytes()).hexdigest()
            plan["plan_source"] = deepcopy(goal["source"])
            plan["coverage_path"] = str(root / "coverage.json")
            if platform == "claude_code":
                for owner in plan["owners"]:
                    owner["runtime_profile"] = None
            plan_path = root / "plan.json"
            plan_path.write_text(json.dumps(plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            coverage = json.loads((FIXTURES / "coverage.json").read_text(encoding="utf-8"))
            source_blocks = []
            for line_number, line in enumerate(document.read_text(encoding="utf-8").splitlines(), 1):
                if line.strip():
                    source_blocks.append(
                        f"L{line_number}-{hashlib.sha256(line.encode()).hexdigest()[:12]}"
                    )
            for item in coverage["required_plan_items"]:
                item["source_refs"] = [
                    source_blocks[0] if item["id"] == "PI-state-types" else source_blocks[-1]
                ]
            coverage.update(
                {
                    "source_path": str(document),
                    "source_digest": goal["source"]["digest"],
                    "source_revision": goal["source"]["revision"],
                    "plan_path": str(plan_path),
                    "plan_digest": hashlib.sha256(plan_path.read_bytes()).hexdigest(),
                    "plan_revision": plan["revision"],
                }
            )
            (root / "coverage.json").write_text(
                json.dumps(coverage, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            yield root, goal_path, plan_path

    def run_cli(self, *args: object, script: Path | None = None) -> subprocess.CompletedProcess[str]:
        return self.run_cli_with_env({}, *args, script=script)

    def run_cli_with_env(
        self, extra_env: dict[str, str], *args: object, script: Path | None = None
    ) -> subprocess.CompletedProcess[str]:
        script = CODEX_SCRIPT if script is None else script
        environment = os.environ.copy()
        environment["GOAL_DAG_EXECUTION_PLATFORM"] = (
            "claude_code" if script == CLAUDE_SCRIPT else "codex"
        )
        environment.update(extra_env)
        return subprocess.run(
            ["node", str(script), *(str(arg) for arg in args)],
            capture_output=True,
            text=True,
            check=False,
            env=environment,
        )

    def run_json(self, *args: object, script: Path | None = None) -> dict:
        result = self.run_cli(*args, script=script)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def initialize(
        self, goal_path: Path, plan_path: Path, script: Path | None = None,
        complete_source_audit: bool = True,
    ) -> Path:
        self.run_json("goal-validate", goal_path, script=script)
        payload = self.run_json("validate", plan_path, script=script)
        state_path = Path(payload["state_path"])
        if complete_source_audit:
            action = self.reserve_one(plan_path, state_path, script=script)
            self.assertEqual(action["task_id"], "T0")
            self.bind(plan_path, state_path, action, "agent-flow-verification", script=script)
            self.finish(plan_path, state_path, action, script=script)
        return state_path

    def reserve_one(
        self, plan_path: Path, state_path: Path, capacity: int = 1, script: Path | None = None
    ) -> dict:
        payload = self.run_json("reserve", plan_path, state_path, capacity, script=script)
        self.assertEqual(len(payload["actions"]), 1, payload)
        return payload["actions"][0]

    def result_for(self, plan_path: Path, state_path: Path, task_id: str, status: str = "completed", **overrides: object) -> dict:
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        state = json.loads(state_path.read_text(encoding="utf-8"))
        task = next(item for item in plan["tasks"] if item["id"] == task_id)
        task_state = state["tasks"][task_id]
        changed_files = []
        if task["role"] == "work" and status == "completed":
            prefix = task["writable_paths"][0].split("*", 1)[0].rstrip("/")
            changed_files = [f"{prefix}/changed.ts"]
        evidence_outcome = "passed" if status == "completed" else "failed"
        result = {
            "contract": "WORKER_RESULT_V4",
            "status": status,
            "task_id": task_id,
            "logical_id": task["logical_id"],
            "role": task["role"],
            "owner_id": task["owner_id"],
            "owner_generation": task_state["owner_generation"],
            "executor_id": task_state["executor_id"],
            "reservation_token": task_state["reservation_token"],
            "attempt": task_state["attempt"],
            "source_revision": task_state["source_revision"],
            "changed_files": changed_files,
            "evidence": [
                {
                    "verification_id": verification_id,
                    "outcome": evidence_outcome,
                    "summary": f"{verification_id} {evidence_outcome}",
                    "artifact_ref": (
                        None
                    ),
                    "artifact_digest": None,
                }
                for verification_id in task["verification_ids"]
            ],
            "diff_self_check": "pass" if status == "completed" else "fail",
            "blocking_findings": [],
            "scope_request": None,
            "summary": f"{task_id} {status}",
            "owner_updates": {
                "decisions": [f"{task_id} decision"],
                "invariants": [f"{task_id} invariant"],
                "risks": [],
            },
        }
        result.update(overrides)
        return result

    def bind(
        self, plan_path: Path, state_path: Path, action: dict, executor_id: str,
        script: Path | None = None,
    ) -> None:
        self.run_json(
            "bind",
            plan_path,
            state_path,
            action["task_id"],
            action["reservation_token"],
            executor_id,
            script=script,
        )

    def complete_all(
        self, plan_path: Path, state_path: Path, script: Path | None = None
    ) -> None:
        executors: dict[str, str] = {}
        while True:
            payload = self.run_json("reserve", plan_path, state_path, 3, script=script)
            if not payload["actions"]:
                return
            for action in payload["actions"]:
                state = json.loads(state_path.read_text(encoding="utf-8"))
                executor = executors.setdefault(
                    action["owner_id"],
                    state["owners"][action["owner_id"]]["bound_executor_id"]
                    or f"agent-{action['owner_id']}",
                )
                self.bind(plan_path, state_path, action, executor, script=script)
                self.finish(plan_path, state_path, action, script=script)

    def advance_to_task(
        self, plan_path: Path, state_path: Path, target_task_id: str,
        script: Path | None = None,
    ) -> dict:
        executors: dict[str, str] = {}
        while True:
            actions = self.run_json("reserve", plan_path, state_path, 3, script=script)["actions"]
            self.assertTrue(actions)
            for action in actions:
                executor = executors.setdefault(
                    action["owner_id"], f"agent-{action['owner_id']}"
                )
                self.bind(plan_path, state_path, action, executor, script=script)
                if action["task_id"] == target_task_id:
                    return action
                self.finish(plan_path, state_path, action, script=script)

    def write_diff_scope_artifact(
        self, plan_path: Path, state_path: Path, action: dict, script: Path | None = None
    ) -> tuple[Path, str]:
        payload = self.run_json(
            "diff-audit",
            plan_path,
            state_path,
            action["task_id"],
            action["reservation_token"],
            script=script,
        )
        return Path(payload["artifact_ref"]), payload["artifact_digest"]

    def write_source_coverage_artifact(
        self, plan_path: Path, state_path: Path, action: dict, script: Path | None = None
    ) -> tuple[Path, str]:
        goal_state = json.loads((plan_path.parent / "goal-state.json").read_text(encoding="utf-8"))
        source_blocks = json.loads(
            Path(goal_state["source_blocks"]["ref"]).read_text(encoding="utf-8")
        )
        coverage = json.loads((plan_path.parent / "coverage.json").read_text(encoding="utf-8"))
        classifications = []
        for block in source_blocks["blocks"]:
            item_ids = sorted(
                item["id"]
                for item in coverage["required_plan_items"]
                if block["id"] in item["source_refs"]
            )
            classifications.append(
                {
                    "block_id": block["id"],
                    "disposition": "mapped" if item_ids else "non_requirement",
                    "plan_item_ids": item_ids,
                    "reason": None if item_ids else "该行仅为结构或说明，不构成交付要求",
                }
            )
        proposal_path = Path(
            action["binding"]["evidence_artifact_paths"]["source-coverage-audit"]
        )
        proposal_path.parent.mkdir(parents=True, exist_ok=True)
        proposal_path.write_text(
            json.dumps({"classifications": classifications}, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        payload = self.run_json(
            "source-audit",
            plan_path,
            state_path,
            action["task_id"],
            action["reservation_token"],
            proposal_path,
            script=script,
        )
        return Path(payload["artifact_ref"]), payload["artifact_digest"]

    def finish(
        self, plan_path: Path, state_path: Path, action: dict,
        status: str = "completed", script: Path | None = None, **overrides: object,
    ) -> dict:
        task_id = action["task_id"]
        result_path = Path(action["binding"]["result_path"])
        result_path.parent.mkdir(parents=True, exist_ok=True)
        result = self.result_for(plan_path, state_path, task_id, status, **overrides)
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        task = next(item for item in plan["tasks"] if item["id"] == task_id)
        if status == "completed" and task["role"] == "work":
            goal = json.loads(Path(plan["goal_contract_path"]).read_text(encoding="utf-8"))
            workspace_root = Path(goal["workspace"]["root"])
            for changed_file in result["changed_files"]:
                changed_path = workspace_root / changed_file
                changed_path.parent.mkdir(parents=True, exist_ok=True)
                changed_path.write_text(
                    f"{task_id} attempt {action['binding']['attempt']}\n", encoding="utf-8"
                )
        if status == "completed" and "diff-scope-audit" in task["verification_ids"]:
            artifact_path, artifact_digest = self.write_diff_scope_artifact(
                plan_path, state_path, action, script=script
            )
            evidence = next(
                item for item in result["evidence"]
                if item["verification_id"] == "diff-scope-audit"
            )
            evidence["artifact_ref"] = str(artifact_path)
            evidence["artifact_digest"] = artifact_digest
        if status == "completed" and "source-coverage-audit" in task["verification_ids"]:
            artifact_path, artifact_digest = self.write_source_coverage_artifact(
                plan_path, state_path, action, script=script
            )
            evidence = next(
                item for item in result["evidence"]
                if item["verification_id"] == "source-coverage-audit"
            )
            evidence["artifact_ref"] = str(artifact_path)
            evidence["artifact_digest"] = artifact_digest
        result_path.write_text(
            json.dumps(
                result,
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        return self.run_json(
            "finish",
            plan_path,
            state_path,
            task_id,
            action["reservation_token"],
            result_path,
            script=script,
        )

    def test_goal_and_plan_initialize_v4_state_and_capsules(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            goal_state = json.loads((root / "goal-state.json").read_text(encoding="utf-8"))
            state = json.loads(state_path.read_text(encoding="utf-8"))

            self.assertEqual(goal_state["contract"], "GOAL_STATE_V1")
            self.assertEqual(goal_state["active_plan_path"], str(plan_path))
            self.assertEqual(state["contract"], "DAG_RUN_STATE_V4")
            self.assertEqual(state["tasks"]["T1"]["status"], "pending")
            self.assertEqual(state["owners"]["state-domain"]["generation"], 1)
            capsule = json.loads(
                Path(state["owners"]["state-domain"]["capsule_ref"]).read_text(encoding="utf-8")
            )
            self.assertEqual(capsule["contract"], "OWNER_CAPSULE_V1")
            self.assertIsNone(capsule["active_task_id"])

    def test_platform_continuation_contract(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            payload = self.run_json("goal-validate", goal_path)
            self.assertNotIn("continuation_prompt", payload)
            state_path = self.initialize(goal_path, plan_path)
            status = self.run_json("status", plan_path, state_path)
            self.assertNotIn("continuation_prompt", status)

        with self.workspace("claude_code") as (_, goal_path, plan_path):
            expected = f"/ghost-agent-workflow:subagent-coordination 继续 `{goal_path}`。"
            payload = self.run_json("goal-validate", goal_path, script=CLAUDE_SCRIPT)
            self.assertEqual(payload["continuation_prompt"], expected)
            state_path = self.initialize(goal_path, plan_path, script=CLAUDE_SCRIPT)
            status = self.run_json("status", plan_path, state_path, script=CLAUDE_SCRIPT)
            self.assertEqual(status["continuation_prompt"], expected)

    def test_non_subagent_execution_mode_is_rejected(self) -> None:
        for platform, script in (("codex", CODEX_SCRIPT), ("claude_code", CLAUDE_SCRIPT)):
            with self.workspace(platform) as (_, goal_path, _):
                goal = json.loads(goal_path.read_text(encoding="utf-8"))
                goal["execution"]["mode"] = "unsupported"
                goal_path.write_text(json.dumps(goal), encoding="utf-8")
                rejected = self.run_cli("goal-validate", goal_path, script=script)
                self.assertNotEqual(rejected.returncode, 0)
                self.assertIn("execution.mode must equal subagent", rejected.stderr)

    def test_v3_plan_is_rejected_without_compatibility_path(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            self.run_json("goal-validate", goal_path)
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan.pop("contract")
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            missing_contract = self.run_cli("validate", plan_path)
            self.assertNotEqual(missing_contract.returncode, 0)
            self.assertIn("plan contract must equal DAG_PLAN_V4", missing_contract.stderr)

        with self.workspace() as (_, goal_path, plan_path):
            self.run_json("goal-validate", goal_path)
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["plan_format_version"] = 3
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            result = self.run_cli("validate", plan_path)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("plan_format_version must equal 4", result.stderr)

    def test_goal_refresh_updates_digests_without_replacing_active_plan(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            self.complete_all(plan_path, state_path)
            document = Path(json.loads(goal_path.read_text(encoding="utf-8"))["source"]["path"])
            document.write_text(
                document.read_text(encoding="utf-8") + "\n追加运行中 checkpoint 验收。\n",
                encoding="utf-8",
            )
            drift = self.run_json("goal-validate", goal_path)
            self.assertEqual(drift["status"], "source_changed")

            payload = self.run_json(
                "goal-refresh",
                goal_path,
                root / "goal-state.json",
                plan_path,
                state_path,
            )
            self.assertEqual(payload["status"], "refreshed")
            self.assertEqual(payload["required_next_action"], "apply_delta")
            state = json.loads(state_path.read_text(encoding="utf-8"))
            goal_state = json.loads((root / "goal-state.json").read_text(encoding="utf-8"))
            self.assertEqual(state["goal_digest"], payload["goal_digest"])
            self.assertEqual(goal_state["goal_digest"], payload["goal_digest"])
            self.assertEqual(
                hashlib.sha256(plan_path.read_bytes()).hexdigest(),
                state["plan_digest"],
            )
            blocked = self.run_cli("reserve", plan_path, state_path, 1)
            self.assertNotEqual(blocked.returncode, 0)
            self.assertIn("goal refresh requires DAG delta", blocked.stderr)

            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            source_audit_task = deepcopy(next(task for task in plan["tasks"] if task["id"] == "T0"))
            source_audit_task.update(
                {
                    "id": "T5",
                    "logical_id": "coverage.audit-source-r2",
                    "title": "重审第二版计划源覆盖",
                }
            )
            diff_audit_task = deepcopy(next(task for task in plan["tasks"] if task["id"] == "T9"))
            diff_audit_task.update(
                {
                    "id": "T8",
                    "logical_id": "scope.audit-final-diff-r2",
                    "title": "重审第二版最终差异",
                    "depends_on": ["T4", "T5"],
                }
            )
            coverage = json.loads((root / "coverage.json").read_text(encoding="utf-8"))
            delta_path = root / "goal-revise-delta.json"
            delta_path.write_text(
                json.dumps(
                    {
                        "contract": "DAG_DELTA_V1",
                        "base_plan_digest": hashlib.sha256(plan_path.read_bytes()).hexdigest(),
                        "revision": 2,
                        "add_owners": [],
                        "add_tasks": [source_audit_task, diff_audit_task],
                        "repairs": [],
                        "source_dispositions": [
                            {
                                "task_id": task["id"],
                                "action": "invalidate" if task["id"] in {"T0", "T9"} else "carry_forward",
                                "replacement_task_id": (
                                    "T5" if task["id"] == "T0"
                                    else "T8" if task["id"] == "T9"
                                    else None
                                ),
                            }
                            for task in plan["tasks"]
                        ],
                        "coverage_update": {"required_plan_items": coverage["required_plan_items"]},
                        "safety": plan["safety"],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            applied = self.run_json("apply-delta", plan_path, state_path, delta_path)
            self.assertEqual(applied["revision"], 2)
            action = self.reserve_one(plan_path, state_path)
            self.assertEqual(action["task_id"], "T5")
            self.bind(
                plan_path, state_path, action, "agent-flow-verification"
            )
            self.finish(plan_path, state_path, action)
            diff_action = self.reserve_one(plan_path, state_path)
            self.assertEqual(diff_action["task_id"], "T8")
            self.bind(
                plan_path, state_path, diff_action, "agent-flow-verification"
            )
            finished = self.finish(plan_path, state_path, diff_action)
            diff_result = json.loads(Path(finished["result_ref"]).read_text(encoding="utf-8"))
            diff_evidence = next(
                item for item in diff_result["evidence"]
                if item["verification_id"] == "diff-scope-audit"
            )
            artifact = json.loads(Path(diff_evidence["artifact_ref"]).read_text(encoding="utf-8"))
            self.assertEqual(
                artifact["input_changes"][0]["path"], "development.md"
            )

    def test_reserve_is_atomic_and_returns_direct_binding(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            processes = [
                subprocess.Popen(
                    ["node", str(CODEX_SCRIPT), "reserve", str(plan_path), str(state_path), "2"],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    env={**os.environ, "GOAL_DAG_EXECUTION_PLATFORM": "codex"},
                )
                for _ in range(2)
            ]
            outputs = [process.communicate(timeout=10) + (process.returncode,) for process in processes]
            self.assertTrue(all(code == 0 for _, _, code in outputs), outputs)
            actions = [action for stdout, _, _ in outputs for action in json.loads(stdout)["actions"]]
            self.assertEqual({action["task_id"] for action in actions}, {"T1", "T3"})
            self.assertEqual(len(actions), 2)
            self.assertEqual({action["action"] for action in actions}, {"spawn_executor"})
            for action in actions:
                self.assertEqual(action["binding"]["contract"], "TASK_BINDING_V4")
                self.assertIn("checkpoint_path", action["binding"])
                coverage_binding = action["binding"]["coverage"]
                self.assertEqual(coverage_binding["ref"], str(plan_path.with_name("coverage.json")))
                self.assertRegex(coverage_binding["digest"], r"^[0-9a-f]{64}$")
                self.assertRegex(coverage_binding["semantic_digest"], r"^[0-9a-f]{64}$")
                self.assertNotIn("coverage_semantic_digest", action["binding"])
                self.assertNotIn("READY", json.dumps(action, ensure_ascii=False))

    def test_owner_affinity_reuses_executor_but_not_as_correctness_dependency(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            first = self.reserve_one(plan_path, state_path)
            self.assertEqual(first["task_id"], "T1")
            self.bind(plan_path, state_path, first, "agent-state-a")
            self.finish(plan_path, state_path, first)

            second = self.reserve_one(plan_path, state_path)
            self.assertEqual(second["task_id"], "T2")
            self.assertEqual(second["action"], "reuse_executor")
            self.assertEqual(second["executor_id"], "agent-state-a")

            self.run_json(
                "abandon",
                plan_path,
                state_path,
                "T2",
                second["reservation_token"],
                "executor context pressure",
            )
            rotated = self.run_json(
                "rotate-owner",
                plan_path,
                state_path,
                "state-domain",
                1,
                "context pressure",
            )
            self.assertEqual(rotated["generation"], 2)
            replacement = self.reserve_one(plan_path, state_path)
            self.assertEqual(replacement["task_id"], "T2")
            self.assertEqual(replacement["action"], "spawn_executor")
            self.assertEqual(replacement["owner_generation"], 2)

    def test_running_checkpoint_survives_executor_rotation(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "agent-state-a")
            checkpoint_path = Path(action["binding"]["checkpoint_path"])
            checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
            checkpoint_path.write_text(
                json.dumps(
                    {
                        "contract": "OWNER_CHECKPOINT_V1",
                        "task_id": "T1",
                        "owner_id": "state-domain",
                        "owner_generation": 1,
                        "reservation_token": action["reservation_token"],
                        "progress": "已完成类型定位，准备移动定义",
                        "decisions": ["保持公开类型名称不变"],
                        "invariants": ["页面读取接口不变"],
                        "risks": ["夹具可能仍引用旧位置"],
                        "important_symbols": ["PageState"],
                        "next_steps": ["移动类型", "运行 state-unit"],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            payload = self.run_json(
                "checkpoint",
                plan_path,
                state_path,
                "T1",
                action["reservation_token"],
                checkpoint_path,
            )
            capsule = json.loads(Path(payload["capsule_ref"]).read_text(encoding="utf-8"))
            self.assertEqual(capsule["active_task_id"], "T1")
            self.assertIn("PageState", capsule["important_symbols"])
            self.assertIn("保持公开类型名称不变", capsule["decisions"])

    def test_generation_and_reservation_fence_stale_results(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            first = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, first, "agent-state-a")
            stale_result = self.result_for(plan_path, state_path, "T1")
            self.run_json(
                "reclaim",
                plan_path,
                state_path,
                "T1",
                first["reservation_token"],
                "agent lost",
            )
            self.run_json(
                "confirm-stale-executor", plan_path, state_path, "agent-state-a"
            )
            self.run_json("rotate-owner", plan_path, state_path, "state-domain", 1, "agent lost")
            second = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, second, "agent-state-b")
            result_path = Path(second["binding"]["result_path"])
            result_path.parent.mkdir(parents=True, exist_ok=True)
            result_path.write_text(json.dumps(stale_result), encoding="utf-8")
            rejected = self.run_cli(
                "finish",
                plan_path,
                state_path,
                "T1",
                second["reservation_token"],
                result_path,
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("owner_generation mismatch", rejected.stderr)

    def test_result_scope_and_executor_identity_are_enforced(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "agent-state")
            result_path = Path(action["binding"]["result_path"])
            result_path.parent.mkdir(parents=True, exist_ok=True)
            result_path.write_text(
                json.dumps(
                    self.result_for(
                        plan_path,
                        state_path,
                        "T1",
                        changed_files=["outside/file.ts"],
                    )
                ),
                encoding="utf-8",
            )
            rejected = self.run_cli(
                "finish",
                plan_path,
                state_path,
                "T1",
                action["reservation_token"],
                result_path,
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("exceed task scope", rejected.stderr)

    def test_finalize_rejects_result_mutated_after_finish(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            executors: dict[str, str] = {}
            while True:
                payload = self.run_json("reserve", plan_path, state_path, 3)
                if not payload["actions"]:
                    break
                for action in payload["actions"]:
                    executor = executors.setdefault(action["owner_id"], f"agent-{action['owner_id']}")
                    self.bind(plan_path, state_path, action, executor)
                    self.finish(plan_path, state_path, action)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            result_path = Path(state["tasks"]["T1"]["result_ref"])
            result = json.loads(result_path.read_text(encoding="utf-8"))
            result["summary"] = "tampered after finish"
            result_path.write_text(json.dumps(result), encoding="utf-8")
            rejected = self.run_cli(
                "finalize",
                goal_path,
                root / "goal-state.json",
                plan_path,
                state_path,
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("result digest mismatch", rejected.stderr)

    def test_delta_repairs_only_affected_subgraph_while_unrelated_owner_runs(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            reserved = self.run_json("reserve", plan_path, state_path, 2)["actions"]
            by_id = {action["task_id"]: action for action in reserved}
            self.bind(plan_path, state_path, by_id["T1"], "agent-state")
            self.bind(plan_path, state_path, by_id["T3"], "agent-fixtures")
            self.finish(plan_path, state_path, by_id["T1"], status="failed")

            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            replacement = deepcopy(next(task for task in plan["tasks"] if task["id"] == "T1"))
            replacement.update(
                {
                    "id": "T5",
                    "logical_id": "state.repair-types",
                    "title": "修复页面状态类型",
                    "task": "根据失败证据修复页面状态类型",
                    "depends_on": ["T0"],
                    "priority": 20,
                    "estimated_cost": 2,
                }
            )
            delta_path = plan_path.parent / "delta.json"
            delta_path.write_text(
                json.dumps(
                    {
                        "contract": "DAG_DELTA_V1",
                        "base_plan_digest": hashlib.sha256(plan_path.read_bytes()).hexdigest(),
                        "revision": 2,
                        "add_owners": [],
                        "add_tasks": [replacement],
                        "repairs": [{"task_id": "T1", "replacement_task_id": "T5"}],
                        "source_dispositions": [],
                        "coverage_update": {
                            "required_plan_items": json.loads(
                                (plan_path.parent / "coverage.json").read_text(encoding="utf-8")
                            )["required_plan_items"]
                        },
                        "safety": plan["safety"],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            applied = self.run_json("apply-delta", plan_path, state_path, delta_path)
            self.assertEqual(applied["unrelated_running_tasks"], ["T3"])
            self.assertEqual(applied["repaired_tasks"][0]["replacement_task_id"], "T5")
            next_payload = self.run_json("reserve", plan_path, state_path, 3)
            self.assertEqual([action["task_id"] for action in next_payload["actions"]], ["T5"])
            repaired_action = next_payload["actions"][0]
            self.bind(plan_path, state_path, repaired_action, "agent-state")
            self.finish(plan_path, state_path, repaired_action)
            self.finish(plan_path, state_path, by_id["T3"])
            self.complete_all(plan_path, state_path)
            finalized = self.run_json(
                "finalize", goal_path, root / "goal-state.json", plan_path, state_path
            )
            self.assertEqual(finalized["status"], "completed")

    def test_delta_replacement_cannot_depend_on_repaired_task(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "agent-state")
            self.finish(plan_path, state_path, action, status="failed")

            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            replacement = deepcopy(next(task for task in plan["tasks"] if task["id"] == "T1"))
            replacement.update(
                {
                    "id": "T5",
                    "logical_id": "state.invalid-repair",
                    "title": "无效的状态修复",
                    "task": "错误地依赖被修复任务",
                    "depends_on": ["T1"],
                }
            )
            delta_path = plan_path.parent / "invalid-delta.json"
            delta_path.write_text(
                json.dumps(
                    {
                        "contract": "DAG_DELTA_V1",
                        "base_plan_digest": hashlib.sha256(plan_path.read_bytes()).hexdigest(),
                        "revision": 2,
                        "add_owners": [],
                        "add_tasks": [replacement],
                        "repairs": [{"task_id": "T1", "replacement_task_id": "T5"}],
                        "source_dispositions": [],
                        "coverage_update": {
                            "required_plan_items": json.loads(
                                (plan_path.parent / "coverage.json").read_text(encoding="utf-8")
                            )["required_plan_items"]
                        },
                        "safety": plan["safety"],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            rejected = self.run_cli("apply-delta", plan_path, state_path, delta_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("delta replacement cannot depend on repaired task", rejected.stderr)

    def test_non_refresh_delta_cannot_rewrite_required_plan_items(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "agent-state")
            self.finish(plan_path, state_path, action, status="failed")
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            replacement = deepcopy(next(task for task in plan["tasks"] if task["id"] == "T1"))
            replacement.update(
                {
                    "id": "T5",
                    "logical_id": "state.repair-types",
                    "title": "修复页面状态类型",
                    "task": "修复失败状态类型",
                    "depends_on": ["T0"],
                }
            )
            items = json.loads(
                (plan_path.parent / "coverage.json").read_text(encoding="utf-8")
            )["required_plan_items"]
            mutated_items = deepcopy(items)
            mutated_items[0]["description"] = "偷偷改写覆盖定义"
            delta_path = plan_path.parent / "coverage-rewrite-delta.json"
            delta_path.write_text(
                json.dumps(
                    {
                        "contract": "DAG_DELTA_V1",
                        "base_plan_digest": hashlib.sha256(plan_path.read_bytes()).hexdigest(),
                        "revision": 2,
                        "add_owners": [],
                        "add_tasks": [replacement],
                        "repairs": [{"task_id": "T1", "replacement_task_id": "T5"}],
                        "source_dispositions": [],
                        "coverage_update": {"required_plan_items": mutated_items},
                        "safety": plan["safety"],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            rejected = self.run_cli("apply-delta", plan_path, state_path, delta_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("cannot change required_plan_items", rejected.stderr)

    def test_finalize_requires_all_tasks_and_goal_gate_evidence(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            executors: dict[str, str] = {}
            while True:
                payload = self.run_json("reserve", plan_path, state_path, 3)
                if not payload["actions"]:
                    break
                for action in payload["actions"]:
                    executor = executors.setdefault(action["owner_id"], f"agent-{action['owner_id']}")
                    self.bind(plan_path, state_path, action, executor)
                    self.finish(plan_path, state_path, action)
            finalized = self.run_json(
                "finalize",
                goal_path,
                root / "goal-state.json",
                plan_path,
                state_path,
            )
            self.assertEqual(finalized["status"], "completed")
            self.assertEqual(finalized["native_sync"], "pending")
            self.assertEqual(finalized["native_action"]["action"], "update_goal")
            goal_state = json.loads((root / "goal-state.json").read_text(encoding="utf-8"))
            self.assertEqual(goal_state["status"], "completed")
            self.assertEqual(len(goal_state["completion_evidence"]), 6)
            blocked = self.run_cli("reserve", plan_path, state_path, 1)
            self.assertNotEqual(blocked.returncode, 0)
            self.assertIn("completed and immutable", blocked.stderr)
            confirmed = self.run_json(
                "native-confirm",
                goal_path,
                root / "goal-state.json",
                finalized["native_action"]["completion_token"],
            )
            self.assertFalse(confirmed["idempotent"])
            repeated = self.run_json(
                "native-confirm",
                goal_path,
                root / "goal-state.json",
                finalized["native_action"]["completion_token"],
            )
            self.assertTrue(repeated["idempotent"])

    def test_unplanned_required_item_exhausts_to_needs_delta_and_blocks_finalize(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            coverage_path = root / "coverage.json"
            coverage = json.loads(coverage_path.read_text(encoding="utf-8"))
            coverage["required_plan_items"].append(
                {
                    "id": "PI-omitted",
                    "description": "故意遗漏的计划项",
                    "source_refs": coverage["required_plan_items"][0]["source_refs"],
                    "required_effects": ["implementation"],
                }
            )
            coverage_path.write_text(
                json.dumps(coverage, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            state_path = self.initialize(
                goal_path, plan_path, complete_source_audit=False
            )
            status = self.run_json("status", plan_path, state_path)
            self.assertEqual(status["coverage"]["uncovered_plan_item_ids"], ["PI-omitted"])
            rejected = self.run_cli(
                "finalize", goal_path, root / "goal-state.json", plan_path, state_path
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertTrue(
                "required plan items are not planned" in rejected.stderr
                or "unresolved tasks" in rejected.stderr,
                rejected.stderr,
            )

    def test_reconcile_lists_and_idempotently_reclaims_orphan_reservation(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            first = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, first, "agent-orphan")
            reconciled = self.run_json("reconcile", plan_path, state_path)
            active = reconciled["active_reservations"][0]
            self.assertEqual(active["reservation_token"], first["reservation_token"])
            self.assertEqual(active["result_path"], first["binding"]["result_path"])
            self.assertEqual(active["executor_id"], "agent-orphan")
            self.assertEqual(active["attempt"], 1)
            reclaimed = self.run_json(
                "reclaim", plan_path, state_path, "T1", first["reservation_token"], "executor lost"
            )
            self.assertTrue(reclaimed["reclaimed"])
            self.assertEqual(reclaimed["owner_generation"], 1)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertIsNone(state["owners"]["state-domain"]["bound_executor_id"])
            capsule = json.loads(
                Path(state["owners"]["state-domain"]["capsule_ref"]).read_text(encoding="utf-8")
            )
            self.assertIsNone(capsule["active_task_id"])
            self.assertIsNone(capsule["checkpoint_ref"])
            self.assertTrue(any("orphan reservation reclaimed" in risk for risk in capsule["risks"]))
            repeated = self.run_json(
                "reclaim", plan_path, state_path, "T1", first["reservation_token"], "executor lost"
            )
            self.assertTrue(repeated["idempotent"])
            self.run_json(
                "confirm-stale-executor", plan_path, state_path, "agent-orphan"
            )
            second = self.reserve_one(plan_path, state_path)
            self.assertNotEqual(first["binding"]["result_path"], second["binding"]["result_path"])
            self.assertEqual(second["binding"]["attempt"], 2)
            self.assertEqual(second["owner_generation"], 1)

    def test_abandon_clears_checkpoint_capsule_transactionally(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "agent-state")
            checkpoint_path = Path(action["binding"]["checkpoint_path"])
            checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
            checkpoint_path.write_text(
                json.dumps(
                    {
                        "contract": "OWNER_CHECKPOINT_V1",
                        "task_id": "T1",
                        "owner_id": "state-domain",
                        "owner_generation": 1,
                        "reservation_token": action["reservation_token"],
                        "progress": "进行中",
                        "decisions": [],
                        "invariants": [],
                        "risks": [],
                        "important_symbols": [],
                        "next_steps": ["继续"],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            self.run_json(
                "checkpoint", plan_path, state_path, "T1",
                action["reservation_token"], checkpoint_path,
            )
            self.run_json(
                "reclaim", plan_path, state_path, "T1",
                action["reservation_token"], "restart executor",
            )
            self.run_json(
                "confirm-stale-executor", plan_path, state_path, "agent-state"
            )
            state = json.loads(state_path.read_text(encoding="utf-8"))
            capsule = json.loads(
                Path(state["owners"]["state-domain"]["capsule_ref"]).read_text(encoding="utf-8")
            )
            self.assertIsNone(capsule["active_task_id"])
            self.assertIsNone(capsule["checkpoint_ref"])
            self.assertTrue(any("reclaimed" in risk for risk in capsule["risks"]))

    def test_paths_reject_traversal_and_glob_is_not_a_prefix(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            next(task for task in plan["tasks"] if task["id"] == "T1")["writable_paths"] = ["../outside/**"]
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            rejected = self.run_cli("validate", plan_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("must not contain ..", rejected.stderr)

        with self.workspace() as (_, goal_path, plan_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            next(task for task in plan["tasks"] if task["id"] == "T1")["writable_paths"] = ["src/state/*.ts"]
            plan_path.write_text(json.dumps(plan, indent=2) + "\n", encoding="utf-8")
            coverage_path = plan_path.with_name("coverage.json")
            coverage = json.loads(coverage_path.read_text(encoding="utf-8"))
            coverage["plan_digest"] = hashlib.sha256(plan_path.read_bytes()).hexdigest()
            coverage_path.write_text(json.dumps(coverage), encoding="utf-8")
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "agent-state")
            result_path = Path(action["binding"]["result_path"])
            result_path.parent.mkdir(parents=True, exist_ok=True)
            result_path.write_text(
                json.dumps(
                    self.result_for(
                        plan_path,
                        state_path,
                        "T1",
                        changed_files=["src/state/nested/changed.ts"],
                    )
                ),
                encoding="utf-8",
            )
            rejected = self.run_cli(
                "finish", plan_path, state_path, "T1", action["reservation_token"], result_path
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("exceed task scope", rejected.stderr)

    def test_state_rejects_external_capsule_and_result_paths(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            state["owners"]["state-domain"]["capsule_ref"] = "/tmp/attacker-capsule.json"
            state_path.write_text(json.dumps(state), encoding="utf-8")
            rejected = self.run_cli("status", plan_path, state_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("capsule_ref must equal", rejected.stderr)

        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            self.reserve_one(plan_path, state_path)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            state["tasks"]["T1"]["result_path"] = "/tmp/attacker-result.json"
            state_path.write_text(json.dumps(state), encoding="utf-8")
            rejected = self.run_cli("status", plan_path, state_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("result_path must equal", rejected.stderr)

    def test_controller_is_fixed_by_platform_and_native_state_is_strict(self) -> None:
        with self.workspace() as (root, goal_path, _):
            initialized = self.run_json("goal-validate", goal_path)
            self.assertEqual(initialized["native_sync"]["status"], "not_started")
            goal_state_path = root / "goal-state.json"
            state = json.loads(goal_state_path.read_text(encoding="utf-8"))
            state["native_sync"].update(
                {"status": "pending", "completion_token": "premature", "confirmed_at": None}
            )
            goal_state_path.write_text(json.dumps(state), encoding="utf-8")
            rejected = self.run_cli("goal-validate", goal_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("active codex_native", rejected.stderr)

        with self.workspace() as (_, goal_path, _):
            goal = json.loads(goal_path.read_text(encoding="utf-8"))
            goal["lifecycle"]["controller"] = "local_fallback"
            goal_path.write_text(json.dumps(goal), encoding="utf-8")
            rejected = self.run_cli("goal-validate", goal_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("requires codex_native controller", rejected.stderr)

        with self.workspace("claude_code") as (_, goal_path, _):
            goal = json.loads(goal_path.read_text(encoding="utf-8"))
            goal["lifecycle"]["controller"] = "codex_native"
            goal_path.write_text(json.dumps(goal), encoding="utf-8")
            rejected = self.run_cli("goal-validate", goal_path, script=CLAUDE_SCRIPT)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("requires local_fallback controller", rejected.stderr)

        with self.workspace() as (_, goal_path, _):
            goal = json.loads(goal_path.read_text(encoding="utf-8"))
            goal["lifecycle"]["native_goal"] = None
            goal_path.write_text(json.dumps(goal), encoding="utf-8")
            rejected = self.run_cli("goal-validate", goal_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("lifecycle.native_goal must be an object", rejected.stderr)

        with self.workspace("claude_code") as (_, goal_path, _):
            goal = json.loads(goal_path.read_text(encoding="utf-8"))
            goal["lifecycle"]["native_goal"] = {
                "thread_id": "unexpected",
                "created_at": 1784390400000,
            }
            goal_path.write_text(json.dumps(goal), encoding="utf-8")
            rejected = self.run_cli("goal-validate", goal_path, script=CLAUDE_SCRIPT)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("native_goal must be null", rejected.stderr)

    def test_mixed_failed_and_pending_work_keeps_execute_next_action(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            actions = self.run_json("reserve", plan_path, state_path, 2)["actions"]
            by_id = {action["task_id"]: action for action in actions}
            self.bind(plan_path, state_path, by_id["T1"], "agent-state")
            self.bind(plan_path, state_path, by_id["T3"], "agent-fixtures")
            self.finish(plan_path, state_path, by_id["T1"], status="failed")
            status = self.run_json("status", plan_path, state_path)
            self.assertEqual(status["next_action"], "execute")

    def test_diff_scope_audit_requires_independent_artifact_evidence(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            executors: dict[str, str] = {}
            verify_action = None
            while verify_action is None:
                actions = self.run_json("reserve", plan_path, state_path, 3)["actions"]
                for action in actions:
                    executor = executors.setdefault(
                        action["owner_id"], f"agent-{action['owner_id']}"
                    )
                    self.bind(plan_path, state_path, action, executor)
                    if action["task_id"] == "T9":
                        verify_action = action
                    else:
                        self.finish(plan_path, state_path, action)
            result = self.result_for(plan_path, state_path, "T9")
            for evidence in result["evidence"]:
                if evidence["verification_id"] == "diff-scope-audit":
                    evidence["artifact_ref"] = None
            result_path = Path(verify_action["binding"]["result_path"])
            result_path.parent.mkdir(parents=True, exist_ok=True)
            result_path.write_text(json.dumps(result), encoding="utf-8")
            rejected = self.run_cli(
                "finish", plan_path, state_path, "T9",
                verify_action["reservation_token"], result_path,
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("requires artifact_ref and artifact_digest", rejected.stderr)

    def test_local_fallback_finalizes_without_native_bridge(self) -> None:
        with self.workspace("claude_code") as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path, script=CLAUDE_SCRIPT)
            self.complete_all(plan_path, state_path, script=CLAUDE_SCRIPT)
            finalized = self.run_json(
                "finalize", goal_path, root / "goal-state.json", plan_path, state_path,
                script=CLAUDE_SCRIPT,
            )
            self.assertEqual(finalized["native_sync"], "not_required")
            self.assertNotIn("native_action", finalized)

    def test_goal_validate_recovers_interrupted_refresh_transaction(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            document = Path(json.loads(goal_path.read_text(encoding="utf-8"))["source"]["path"])
            document.write_text(document.read_text(encoding="utf-8") + "\n新修订。\n", encoding="utf-8")

            failed = self.run_cli_with_env(
                {"GOAL_DAG_TEST_FAIL_AFTER_WRITES": "1"},
                "goal-refresh", goal_path, root / "goal-state.json", plan_path, state_path,
            )
            self.assertNotEqual(failed.returncode, 0)
            self.assertTrue(Path(f"{state_path}.transaction.json").exists())
            recovered = self.run_json("goal-validate", goal_path)
            self.assertEqual(recovered["goal_digest"], hashlib.sha256(goal_path.read_bytes()).hexdigest())
            self.assertFalse(Path(f"{state_path}.transaction.json").exists())
            status = self.run_json("status", plan_path, state_path)
            self.assertEqual(status["next_action"], "needs_delta")

    def test_finish_retries_are_idempotent_before_and_after_state_commit(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "agent-state")
            result_path = Path(action["binding"]["result_path"])
            result_path.parent.mkdir(parents=True, exist_ok=True)
            result = self.result_for(plan_path, state_path, action["task_id"])
            result_path.write_text(
                json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            accepted_path = Path(f"{result_path}.accepted.json")
            accepted_path.write_text(
                json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            first = self.run_json(
                "finish", plan_path, state_path, action["task_id"],
                action["reservation_token"], result_path,
            )
            self.assertFalse(first["idempotent"])
            repeated = self.run_json(
                "finish", plan_path, state_path, action["task_id"],
                action["reservation_token"], result_path,
            )
            self.assertTrue(repeated["idempotent"])

        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "agent-state")
            result_path = Path(action["binding"]["result_path"])
            result_path.parent.mkdir(parents=True, exist_ok=True)
            result_path.write_text(
                json.dumps(
                    self.result_for(plan_path, state_path, action["task_id"]),
                    indent=2, ensure_ascii=False,
                ) + "\n",
                encoding="utf-8",
            )
            failed = self.run_cli_with_env(
                {"GOAL_DAG_TEST_FAIL_AFTER_WRITES": "0"},
                "finish", plan_path, state_path, action["task_id"],
                action["reservation_token"], result_path,
            )
            self.assertNotEqual(failed.returncode, 0)
            retried = self.run_json(
                "finish", plan_path, state_path, action["task_id"],
                action["reservation_token"], result_path,
            )
            self.assertTrue(retried["idempotent"])

    def test_goal_validate_initial_artifacts_recover_as_one_transaction(self) -> None:
        for fail_after in (1, 2):
            with self.subTest(fail_after=fail_after), self.workspace() as (root, goal_path, _):
                failed = self.run_cli_with_env(
                    {"GOAL_DAG_TEST_FAIL_AFTER_WRITES": str(fail_after)},
                    "goal-validate", goal_path,
                )
                self.assertNotEqual(failed.returncode, 0)
                journal = root / "state.json.transaction.json"
                self.assertTrue(journal.exists())
                recovered = self.run_json("goal-validate", goal_path)
                self.assertEqual(recovered["status"], "valid")
                self.assertFalse(journal.exists())
                for field in ("worktree_baseline", "source_blocks"):
                    ref = Path(recovered[field]["ref"])
                    self.assertEqual(
                        recovered[field]["digest"], hashlib.sha256(ref.read_bytes()).hexdigest()
                    )

    def test_source_drift_drains_old_revision_and_fences_stale_binding(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            actions = self.run_json("reserve", plan_path, state_path, 2)["actions"]
            by_id = {action["task_id"]: action for action in actions}
            self.bind(plan_path, state_path, by_id["T1"], "agent-state")
            source_path = Path(json.loads(goal_path.read_text(encoding="utf-8"))["source"]["path"])
            source_path.write_text(source_path.read_text(encoding="utf-8") + "\n新版本。\n", encoding="utf-8")
            self.assertEqual(self.run_json("goal-validate", goal_path)["status"], "source_changed")
            status = self.run_json("status", plan_path, state_path)
            self.assertEqual(status["next_action"], "source_drift_drain")
            rejected_bind = self.run_cli(
                "bind", plan_path, state_path, "T3", by_id["T3"]["reservation_token"],
                "agent-fixtures",
            )
            self.assertNotEqual(rejected_bind.returncode, 0)
            self.finish(plan_path, state_path, by_id["T1"])
            self.run_json(
                "abandon", plan_path, state_path, "T3", by_id["T3"]["reservation_token"],
                "source drift cancelled unbound reservation",
            )
            refreshed = self.run_json(
                "goal-refresh", goal_path, root / "goal-state.json", plan_path, state_path,
            )
            self.assertEqual(refreshed["source_revision"], 2)
            stale = self.run_cli(
                "finish", plan_path, state_path, "T3", by_id["T3"]["reservation_token"],
                by_id["T3"]["binding"]["result_path"],
            )
            self.assertNotEqual(stale.returncode, 0)

    def test_executor_spawn_name_is_canonical_and_attempt_unique(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            goal = json.loads(goal_path.read_text(encoding="utf-8"))
            goal["goal_id"] = "Goal.UPPER-With-Hyphen"
            goal_path.write_text(json.dumps(goal, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["goal_id"] = goal["goal_id"]
            plan["goal_digest"] = hashlib.sha256(goal_path.read_bytes()).hexdigest()
            for owner in plan["owners"]:
                if owner["id"] == "state-domain":
                    owner["id"] = "State.Domain-With-Hyphen"
            for task in plan["tasks"]:
                if task["owner_id"] == "state-domain":
                    task["owner_id"] = "State.Domain-With-Hyphen"
            plan_path.write_text(json.dumps(plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            coverage = json.loads((root / "coverage.json").read_text(encoding="utf-8"))
            coverage["plan_digest"] = hashlib.sha256(plan_path.read_bytes()).hexdigest()
            (root / "coverage.json").write_text(json.dumps(coverage, indent=2) + "\n", encoding="utf-8")
            state_path = self.initialize(goal_path, plan_path)
            first = self.reserve_one(plan_path, state_path)
            name1 = first["executor_spawn_name"]
            self.assertEqual(name1, first["binding"]["executor_spawn_name"])
            self.assertRegex(name1, r"^[a-z0-9_]{1,64}$")
            self.run_json(
                "abandon", plan_path, state_path, first["task_id"],
                first["reservation_token"], "retry name",
            )
            second = self.reserve_one(plan_path, state_path)
            self.assertNotEqual(name1, second["executor_spawn_name"])

    def test_completed_native_bridge_survives_deleted_execution_inputs(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            self.complete_all(plan_path, state_path)
            finalized = self.run_json(
                "finalize", goal_path, root / "goal-state.json", plan_path, state_path,
            )
            goal_state = json.loads((root / "goal-state.json").read_text(encoding="utf-8"))
            run_state = json.loads(state_path.read_text(encoding="utf-8"))
            Path(json.loads(goal_path.read_text(encoding="utf-8"))["source"]["path"]).unlink()
            Path(goal_state["worktree_baseline"]["ref"]).unlink()
            Path(goal_state["source_blocks"]["ref"]).unlink()
            for owner in run_state["owners"].values():
                Path(owner["capsule_ref"]).unlink()
            self.assertEqual(self.run_json("goal-validate", goal_path)["status"], "valid")
            self.assertEqual(self.run_json("status", plan_path, state_path)["source_status"], "frozen")
            confirmed = self.run_json(
                "native-confirm", goal_path, root / "goal-state.json",
                finalized["native_action"]["completion_token"],
            )
            self.assertEqual(confirmed["status"], "confirmed")

    def test_coverage_effects_and_source_classification_are_runtime_checked(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            coverage_path = plan_path.with_name("coverage.json")
            coverage = json.loads(coverage_path.read_text(encoding="utf-8"))
            coverage["required_plan_items"][0]["required_effects"] = ["audit"]
            coverage_path.write_text(json.dumps(coverage, indent=2) + "\n", encoding="utf-8")
            self.run_json("goal-validate", goal_path)
            rejected = self.run_cli("validate", plan_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("required_effects is invalid", rejected.stderr)

        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(
                goal_path, plan_path, complete_source_audit=False
            )
            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "agent-flow-verification")
            proposal = Path(
                action["binding"]["evidence_artifact_paths"]["source-coverage-audit"]
            )
            proposal.parent.mkdir(parents=True, exist_ok=True)
            proposal.write_text(json.dumps({"classifications": []}), encoding="utf-8")
            omitted = self.run_cli(
                "source-audit", plan_path, state_path, action["task_id"],
                action["reservation_token"], proposal,
            )
            self.assertNotEqual(omitted.returncode, 0)
            self.assertIn("block is omitted", omitted.stderr)
            external = root.parent.parent / "external-classification.json"
            external.write_text(json.dumps({"classifications": []}), encoding="utf-8")
            escaped = self.run_cli(
                "source-audit", plan_path, state_path, action["task_id"],
                action["reservation_token"], external,
            )
            self.assertNotEqual(escaped.returncode, 0)
            self.assertIn("must equal", escaped.stderr)

    def test_real_diff_scan_handles_dirty_baseline_and_rejects_late_drift(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            workspace_root = Path(json.loads(goal_path.read_text(encoding="utf-8"))["workspace"]["root"])
            (workspace_root / "preexisting.txt").write_text("already dirty\n", encoding="utf-8")
            state_path = self.initialize(goal_path, plan_path)
            action = self.advance_to_task(plan_path, state_path, "T9")
            artifact_path, artifact_digest = self.write_diff_scope_artifact(
                plan_path, state_path, action
            )
            artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
            self.assertNotIn(
                "preexisting.txt", set(artifact["observed_changed_files"])
            )
            (workspace_root / "src/state/changed.ts").write_text("late drift\n", encoding="utf-8")
            result = self.result_for(plan_path, state_path, "T9")
            evidence = next(item for item in result["evidence"] if item["verification_id"] == "diff-scope-audit")
            evidence["artifact_ref"] = str(artifact_path)
            evidence["artifact_digest"] = artifact_digest
            result_path = Path(action["binding"]["result_path"])
            result_path.parent.mkdir(parents=True, exist_ok=True)
            result_path.write_text(json.dumps(result), encoding="utf-8")
            rejected = self.run_cli(
                "finish", plan_path, state_path, "T9", action["reservation_token"], result_path,
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("content does not match", rejected.stderr)

    def test_diff_scan_detects_index_blob_change_with_same_xy_and_worktree_bytes(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            workspace_root = Path(
                json.loads(goal_path.read_text(encoding="utf-8"))["workspace"]["root"]
            )
            readme = workspace_root / "README.md"
            readme.write_text("staged baseline blob\n", encoding="utf-8")
            subprocess.run(
                ["git", "-C", str(workspace_root), "add", "README.md"], check=True
            )
            readme.write_text("stable worktree bytes\n", encoding="utf-8")
            baseline_status = subprocess.run(
                ["git", "-C", str(workspace_root), "status", "--porcelain=v1", "--", "README.md"],
                capture_output=True,
                text=True,
                check=True,
            ).stdout
            self.assertEqual(baseline_status, "MM README.md\n")

            state_path = self.initialize(goal_path, plan_path)
            action = self.advance_to_task(plan_path, state_path, "T9")
            artifact_path, artifact_digest = self.write_diff_scope_artifact(
                plan_path, state_path, action
            )
            baseline_artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
            self.assertNotIn("README.md", baseline_artifact["observed_changed_files"])

            readme.write_text("different staged blob\n", encoding="utf-8")
            subprocess.run(
                ["git", "-C", str(workspace_root), "add", "README.md"], check=True
            )
            readme.write_text("stable worktree bytes\n", encoding="utf-8")
            current_status = subprocess.run(
                ["git", "-C", str(workspace_root), "status", "--porcelain=v1", "--", "README.md"],
                capture_output=True,
                text=True,
                check=True,
            ).stdout
            self.assertEqual(current_status, baseline_status)

            rejected_audit = self.run_cli(
                "diff-audit", plan_path, state_path, "T9", action["reservation_token"]
            )
            self.assertNotEqual(rejected_audit.returncode, 0)
            self.assertIn("observed undeclared worktree files: README.md", rejected_audit.stderr)

            result = self.result_for(plan_path, state_path, "T9")
            evidence = next(
                item for item in result["evidence"]
                if item["verification_id"] == "diff-scope-audit"
            )
            evidence["artifact_ref"] = str(artifact_path)
            evidence["artifact_digest"] = artifact_digest
            result_path = Path(action["binding"]["result_path"])
            result_path.parent.mkdir(parents=True, exist_ok=True)
            result_path.write_text(json.dumps(result), encoding="utf-8")
            rejected_finish = self.run_cli(
                "finish", plan_path, state_path, "T9",
                action["reservation_token"], result_path,
            )
            self.assertNotEqual(rejected_finish.returncode, 0)
            self.assertIn("observed undeclared worktree files: README.md", rejected_finish.stderr)

    def test_diff_scan_allows_multiple_sequential_contributors_to_one_file(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            t2 = next(task for task in plan["tasks"] if task["id"] == "T2")
            t2["writable_paths"] = ["src/state/**"]
            plan_path.write_text(json.dumps(plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            coverage = json.loads((root / "coverage.json").read_text(encoding="utf-8"))
            coverage["plan_digest"] = hashlib.sha256(plan_path.read_bytes()).hexdigest()
            (root / "coverage.json").write_text(json.dumps(coverage, indent=2) + "\n", encoding="utf-8")
            state_path = self.initialize(goal_path, plan_path)
            self.complete_all(plan_path, state_path)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            result = json.loads(Path(state["tasks"]["T9"]["result_ref"]).read_text(encoding="utf-8"))
            evidence = next(item for item in result["evidence"] if item["verification_id"] == "diff-scope-audit")
            artifact = json.loads(Path(evidence["artifact_ref"]).read_text(encoding="utf-8"))
            reviewed = next(item for item in artifact["reviewed_files"] if item["path"] == "src/state/changed.ts")
            self.assertEqual(len(reviewed["contributors"]), 2)

    def test_unplanned_delta_runs_added_work_before_dynamic_final_diff_barrier(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            coverage_path = root / "coverage.json"
            coverage = json.loads(coverage_path.read_text(encoding="utf-8"))
            coverage["required_plan_items"].append(
                {
                    "id": "PI-late-work",
                    "description": "规划后发现的实现要求",
                    "source_refs": coverage["required_plan_items"][0]["source_refs"],
                    "required_effects": ["implementation"],
                }
            )
            coverage_path.write_text(
                json.dumps(coverage, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            state_path = self.initialize(
                goal_path, plan_path, complete_source_audit=False
            )
            self.assertEqual(
                self.run_json("status", plan_path, state_path)["next_action"], "needs_delta"
            )
            blocked_reserve = self.run_json("reserve", plan_path, state_path, 3)
            self.assertEqual(blocked_reserve["actions"], [])
            self.assertEqual(blocked_reserve["required_next_action"], "needs_delta")

            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            added = deepcopy(next(task for task in plan["tasks"] if task["id"] == "T1"))
            added.update(
                {
                    "id": "T10",
                    "logical_id": "state.late-required-work",
                    "title": "补充规划后发现的实现要求",
                    "task": "实现规划后才发现的必需状态行为",
                    "depends_on": ["T0"],
                    "plan_item_ids": ["PI-late-work"],
                    "priority": 25,
                }
            )
            delta_path = root / "late-work-delta.json"
            delta_path.write_text(
                json.dumps(
                    {
                        "contract": "DAG_DELTA_V1",
                        "base_plan_digest": hashlib.sha256(plan_path.read_bytes()).hexdigest(),
                        "revision": 2,
                        "add_owners": [],
                        "add_tasks": [added],
                        "repairs": [],
                        "source_dispositions": [],
                        "coverage_update": {
                            "required_plan_items": coverage["required_plan_items"]
                        },
                        "safety": plan["safety"],
                    },
                    indent=2,
                    ensure_ascii=False,
                ) + "\n",
                encoding="utf-8",
            )
            self.run_json("apply-delta", plan_path, state_path, delta_path)
            self.complete_all(plan_path, state_path)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["tasks"]["T10"]["status"], "completed")
            self.assertEqual(state["tasks"]["T9"]["status"], "completed")
            finalized = self.run_json(
                "finalize", goal_path, root / "goal-state.json", plan_path, state_path
            )
            self.assertEqual(finalized["status"], "completed")

    def test_source_audit_repair_is_a_logical_ancestor_of_existing_pending_work(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(
                goal_path, plan_path, complete_source_audit=False
            )
            failed = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, failed, "agent-flow-verification")
            self.finish(plan_path, state_path, failed, status="failed")

            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            replacement = deepcopy(next(task for task in plan["tasks"] if task["id"] == "T0"))
            replacement.update(
                {
                    "id": "T5",
                    "logical_id": "coverage.audit-source-repair",
                    "title": "修复计划源覆盖审计",
                }
            )
            coverage = json.loads((root / "coverage.json").read_text(encoding="utf-8"))
            delta_path = root / "source-audit-repair-delta.json"
            delta_path.write_text(
                json.dumps(
                    {
                        "contract": "DAG_DELTA_V1",
                        "base_plan_digest": hashlib.sha256(plan_path.read_bytes()).hexdigest(),
                        "revision": 2,
                        "add_owners": [],
                        "add_tasks": [replacement],
                        "repairs": [{"task_id": "T0", "replacement_task_id": "T5"}],
                        "source_dispositions": [],
                        "coverage_update": {
                            "required_plan_items": coverage["required_plan_items"]
                        },
                        "safety": plan["safety"],
                    },
                    indent=2,
                    ensure_ascii=False,
                ) + "\n",
                encoding="utf-8",
            )
            self.run_json("apply-delta", plan_path, state_path, delta_path)
            action = self.reserve_one(plan_path, state_path)
            self.assertEqual(action["task_id"], "T5")
            self.bind(plan_path, state_path, action, "agent-flow-verification")
            self.finish(plan_path, state_path, action)
            ready = self.run_json("reserve", plan_path, state_path, 2)["actions"]
            self.assertEqual({item["task_id"] for item in ready}, {"T1", "T3"})

    def test_double_source_drift_before_delta_coalesces_into_latest_revision(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            source_path = Path(
                json.loads(goal_path.read_text(encoding="utf-8"))["source"]["path"]
            )
            source_path.write_text("# 第二版\n\n第二版要求。\n", encoding="utf-8")
            first = self.run_json(
                "goal-refresh", goal_path, root / "goal-state.json", plan_path, state_path
            )
            self.assertEqual(first["source_revision"], 2)
            source_path.write_text("# 第三版\n\n最终第三版要求。\n", encoding="utf-8")
            second = self.run_json(
                "goal-refresh", goal_path, root / "goal-state.json", plan_path, state_path
            )
            self.assertEqual(second["source_revision"], 3)

            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            source_audit = deepcopy(next(task for task in plan["tasks"] if task["id"] == "T0"))
            source_audit.update(
                {"id": "T5", "logical_id": "coverage.audit-source-r3", "title": "审计第三版计划源"}
            )
            diff_audit = deepcopy(next(task for task in plan["tasks"] if task["id"] == "T9"))
            diff_audit.update(
                {
                    "id": "T8",
                    "logical_id": "scope.audit-final-diff-r3",
                    "title": "审计第三版最终差异",
                    "depends_on": ["T4", "T5"],
                }
            )
            coverage = json.loads((root / "coverage.json").read_text(encoding="utf-8"))
            blocks = json.loads((root / "source-blocks.json").read_text(encoding="utf-8"))["blocks"]
            for item in coverage["required_plan_items"]:
                item["source_refs"] = [blocks[0]["id"] if item["id"] == "PI-state-types" else blocks[-1]["id"]]
            delta_path = root / "coalesced-refresh-delta.json"
            delta_path.write_text(
                json.dumps(
                    {
                        "contract": "DAG_DELTA_V1",
                        "base_plan_digest": hashlib.sha256(plan_path.read_bytes()).hexdigest(),
                        "revision": 2,
                        "add_owners": [],
                        "add_tasks": [source_audit, diff_audit],
                        "repairs": [],
                        "source_dispositions": [
                            {
                                "task_id": task["id"],
                                "action": "invalidate" if task["id"] in {"T0", "T9"} else "carry_forward",
                                "replacement_task_id": (
                                    "T5" if task["id"] == "T0" else "T8" if task["id"] == "T9" else None
                                ),
                            }
                            for task in plan["tasks"]
                        ],
                        "coverage_update": {
                            "required_plan_items": coverage["required_plan_items"]
                        },
                        "safety": plan["safety"],
                    },
                    indent=2,
                    ensure_ascii=False,
                ) + "\n",
                encoding="utf-8",
            )
            applied = self.run_json("apply-delta", plan_path, state_path, delta_path)
            self.assertEqual(applied["revision"], 2)
            self.complete_all(plan_path, state_path)
            finalized = self.run_json(
                "finalize", goal_path, root / "goal-state.json", plan_path, state_path
            )
            self.assertEqual(finalized["status"], "completed")

    def test_refresh_delta_safety_ignores_superseded_historical_topology(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            source_path = Path(
                json.loads(goal_path.read_text(encoding="utf-8"))["source"]["path"]
            )
            source_path.write_text(
                source_path.read_text(encoding="utf-8") + "\n顺序重做全部交付。\n",
                encoding="utf-8",
            )
            self.run_json(
                "goal-refresh", goal_path, root / "goal-state.json", plan_path, state_path
            )
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            by_id = {task["id"]: task for task in plan["tasks"]}
            source_audit = deepcopy(by_id["T0"])
            source_audit.update(
                {"id": "N0", "logical_id": "coverage.audit-source-linear", "title": "顺序重审计划源"}
            )
            state_work = deepcopy(by_id["T1"])
            state_work.update(
                {
                    "id": "N1",
                    "logical_id": "state.linear-implementation",
                    "title": "顺序重做状态实现",
                    "depends_on": ["N0"],
                    "writable_paths": ["src/state/**", "src/page/**"],
                    "plan_item_ids": ["PI-state-types", "PI-page-reads"],
                }
            )
            fixture_work = deepcopy(by_id["T3"])
            fixture_work.update(
                {"id": "N2", "logical_id": "fixtures.linear-update", "title": "顺序重做夹具", "depends_on": ["N1"]}
            )
            verification = deepcopy(by_id["T4"])
            verification.update(
                {"id": "N3", "logical_id": "flow.linear-verification", "title": "顺序重做验证", "depends_on": ["N2"]}
            )
            diff_audit = deepcopy(by_id["T9"])
            diff_audit.update(
                {"id": "N4", "logical_id": "scope.linear-final-diff", "title": "顺序最终差异审计", "depends_on": ["N3"]}
            )
            replacements = {
                "T0": "N0", "T1": "N1", "T2": "N1",
                "T3": "N2", "T4": "N3", "T9": "N4",
            }
            coverage = json.loads((root / "coverage.json").read_text(encoding="utf-8"))
            delta_path = root / "linear-refresh-delta.json"
            delta_path.write_text(
                json.dumps(
                    {
                        "contract": "DAG_DELTA_V1",
                        "base_plan_digest": hashlib.sha256(plan_path.read_bytes()).hexdigest(),
                        "revision": 2,
                        "add_owners": [],
                        "add_tasks": [source_audit, state_work, fixture_work, verification, diff_audit],
                        "repairs": [],
                        "source_dispositions": [
                            {
                                "task_id": task_id,
                                "action": "invalidate",
                                "replacement_task_id": replacement_id,
                            }
                            for task_id, replacement_id in replacements.items()
                        ],
                        "coverage_update": {
                            "required_plan_items": coverage["required_plan_items"]
                        },
                        "safety": {
                            "status": "sequential_only",
                            "reasons": ["刷新后所有 live task 组成单一顺序链"],
                        },
                    },
                    indent=2,
                    ensure_ascii=False,
                ) + "\n",
                encoding="utf-8",
            )
            applied = self.run_json("apply-delta", plan_path, state_path, delta_path)
            self.assertEqual(applied["revision"], 2)
            self.assertEqual(self.run_json("validate", plan_path)["safety"], "sequential_only")
            self.assertEqual(self.run_cli("render", plan_path).returncode, 0)

    def test_source_refresh_can_delete_plan_item_only_from_superseded_history(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            source_path = Path(
                json.loads(goal_path.read_text(encoding="utf-8"))["source"]["path"]
            )
            source_path.write_text(
                "# 页面状态重构\n\n完成状态抽离、页面读取与集成验证。\n",
                encoding="utf-8",
            )
            self.run_json(
                "goal-refresh", goal_path, root / "goal-state.json", plan_path, state_path
            )

            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            by_id = {task["id"]: task for task in plan["tasks"]}
            source_audit = deepcopy(by_id["T0"])
            source_audit.update(
                {
                    "id": "S0",
                    "logical_id": "coverage.audit-source-without-fixtures",
                    "title": "审计删除夹具要求后的计划源",
                    "plan_item_ids": [
                        item_id for item_id in source_audit["plan_item_ids"]
                        if item_id != "PI-fixtures"
                    ],
                }
            )
            fixture_replacement = deepcopy(by_id["T3"])
            fixture_replacement.update(
                {
                    "id": "R3",
                    "logical_id": "state.remove-obsolete-fixture-requirement",
                    "title": "清理已删除的夹具要求",
                    "depends_on": ["S0"],
                    "plan_item_ids": ["PI-state-types"],
                }
            )
            diff_audit = deepcopy(by_id["T9"])
            diff_audit.update(
                {
                    "id": "D9",
                    "logical_id": "scope.audit-final-diff-without-fixtures",
                    "title": "审计删除要求后的最终差异",
                    "depends_on": ["T4", "S0", "R3"],
                }
            )
            coverage = json.loads((root / "coverage.json").read_text(encoding="utf-8"))
            coverage["required_plan_items"] = [
                item for item in coverage["required_plan_items"]
                if item["id"] != "PI-fixtures"
            ]
            blocks = json.loads((root / "source-blocks.json").read_text(encoding="utf-8"))["blocks"]
            for item in coverage["required_plan_items"]:
                item["source_refs"] = [
                    blocks[0]["id"] if item["id"] == "PI-state-types" else blocks[-1]["id"]
                ]

            def delta_with_fixture_disposition(action: str) -> dict:
                replacements = {"T0": "S0", "T3": "R3", "T9": "D9"}
                return {
                    "contract": "DAG_DELTA_V1",
                    "base_plan_digest": hashlib.sha256(plan_path.read_bytes()).hexdigest(),
                    "revision": 2,
                    "add_owners": [],
                    "add_tasks": [source_audit, fixture_replacement, diff_audit],
                    "repairs": [],
                    "source_dispositions": [
                        {
                            "task_id": task["id"],
                            "action": (
                                action if task["id"] == "T3"
                                else "invalidate" if task["id"] in replacements
                                else "carry_forward"
                            ),
                            "replacement_task_id": (
                                None if task["id"] == "T3" and action == "carry_forward"
                                else replacements.get(task["id"])
                            ),
                        }
                        for task in plan["tasks"]
                    ],
                    "coverage_update": {
                        "required_plan_items": coverage["required_plan_items"]
                    },
                    "safety": plan["safety"],
                }

            invalid_delta = root / "invalid-delete-plan-item-delta.json"
            invalid_delta.write_text(
                json.dumps(delta_with_fixture_disposition("carry_forward"), ensure_ascii=False),
                encoding="utf-8",
            )
            rejected = self.run_cli("apply-delta", plan_path, state_path, invalid_delta)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("task T3 references unknown plan item: PI-fixtures", rejected.stderr)

            valid_delta = root / "delete-plan-item-delta.json"
            valid_delta.write_text(
                json.dumps(delta_with_fixture_disposition("invalidate"), ensure_ascii=False),
                encoding="utf-8",
            )
            self.run_json("apply-delta", plan_path, state_path, valid_delta)
            self.assertEqual(
                self.run_json("status", plan_path, state_path)["next_action"], "execute"
            )
            self.assertEqual(
                self.run_json("reconcile", plan_path, state_path)["next_action"], "execute"
            )
            self.complete_all(plan_path, state_path)
            finalized = self.run_json(
                "finalize", goal_path, root / "goal-state.json", plan_path, state_path
            )
            self.assertEqual(finalized["status"], "completed")

    def test_multiple_live_diff_audits_are_rejected_instead_of_deadlocking(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            duplicate = deepcopy(next(task for task in plan["tasks"] if task["id"] == "T9"))
            duplicate.update(
                {"id": "T8", "logical_id": "scope.audit-duplicate", "title": "重复最终差异审计"}
            )
            coverage = json.loads((root / "coverage.json").read_text(encoding="utf-8"))
            delta_path = root / "duplicate-diff-delta.json"
            delta_path.write_text(
                json.dumps(
                    {
                        "contract": "DAG_DELTA_V1",
                        "base_plan_digest": hashlib.sha256(plan_path.read_bytes()).hexdigest(),
                        "revision": 2,
                        "add_owners": [],
                        "add_tasks": [duplicate],
                        "repairs": [],
                        "source_dispositions": [],
                        "coverage_update": {
                            "required_plan_items": coverage["required_plan_items"]
                        },
                        "safety": plan["safety"],
                    },
                    indent=2,
                    ensure_ascii=False,
                ) + "\n",
                encoding="utf-8",
            )
            rejected = self.run_cli("apply-delta", plan_path, state_path, delta_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("exactly one live diff-scope-audit", rejected.stderr)

    def test_active_reservation_recovery_rebuilds_canonical_binding(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            reserved = self.reserve_one(plan_path, state_path)
            rejected_reclaim = self.run_cli(
                "reclaim", plan_path, state_path, reserved["task_id"],
                reserved["reservation_token"], "spawn never bound",
            )
            self.assertNotEqual(rejected_reclaim.returncode, 0)
            self.assertIn("use abandon instead of reclaim", rejected_reclaim.stderr)
            recovered = self.run_json("reconcile", plan_path, state_path)["active_reservations"]
            self.assertEqual(len(recovered), 1)
            self.assertEqual(recovered[0]["action"], "spawn_executor")
            self.assertEqual(recovered[0]["phase"], "reserved_unbound")
            self.assertEqual(recovered[0]["binding"], reserved["binding"])
            self.assertEqual(recovered[0]["executor_spawn_name"], reserved["executor_spawn_name"])

            self.bind(plan_path, state_path, reserved, "agent-state")
            self.finish(plan_path, state_path, reserved)
            reused = self.reserve_one(plan_path, state_path)
            self.assertEqual(reused["action"], "reuse_executor")
            self.bind(plan_path, state_path, reused, "agent-state")
            running = self.run_json("status", plan_path, state_path)["active_reservations"]
            self.assertEqual(len(running), 1)
            self.assertEqual(running[0]["action"], "wait_or_redeliver")
            self.assertEqual(running[0]["phase"], "running_bound")
            self.assertEqual(running[0]["executor_id"], "agent-state")
            self.assertEqual(running[0]["binding"], reused["binding"])

    def test_reserved_reuse_loss_detaches_executor_into_stale_ledger(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            first = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, first, "agent-state")
            self.finish(plan_path, state_path, first)
            reused = self.reserve_one(plan_path, state_path)
            self.assertEqual(reused["action"], "reuse_executor")
            reclaimed = self.run_json(
                "reclaim", plan_path, state_path, reused["task_id"],
                reused["reservation_token"], "reuse target disappeared before followup",
            )
            self.assertEqual(reclaimed["executor_id"], "agent-state")
            self.assertEqual(reclaimed["owner_generation"], 1)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertIsNone(state["owners"][reused["owner_id"]]["bound_executor_id"])
            self.assertEqual(state["stale_executors"][0]["executor_id"], "agent-state")
            self.run_json(
                "confirm-stale-executor", plan_path, state_path, "agent-state"
            )
            retried = self.reserve_one(plan_path, state_path)
            self.assertEqual(retried["action"], "spawn_executor")
            self.assertEqual(retried["owner_generation"], 1)

    def test_completed_result_rejects_blockers_and_unpaired_artifact_evidence(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "agent-state")
            result = self.result_for(plan_path, state_path, action["task_id"])
            result["blocking_findings"] = ["仍有阻断问题"]
            result_path = Path(action["binding"]["result_path"])
            result_path.parent.mkdir(parents=True, exist_ok=True)
            result_path.write_text(json.dumps(result), encoding="utf-8")
            rejected = self.run_cli(
                "finish", plan_path, state_path, action["task_id"],
                action["reservation_token"], result_path,
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("completed requires blocking_findings empty", rejected.stderr)

        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "agent-state")
            result = self.result_for(plan_path, state_path, action["task_id"])
            result["evidence"][0]["artifact_ref"] = str(plan_path)
            result_path = Path(action["binding"]["result_path"])
            result_path.parent.mkdir(parents=True, exist_ok=True)
            result_path.write_text(json.dumps(result), encoding="utf-8")
            rejected = self.run_cli(
                "finish", plan_path, state_path, action["task_id"],
                action["reservation_token"], result_path,
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("artifact_ref and artifact_digest must be paired", rejected.stderr)

    def test_blocked_dependency_exhaustion_routes_to_repair(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            actions = self.run_json("reserve", plan_path, state_path, 2)["actions"]
            by_id = {action["task_id"]: action for action in actions}
            self.bind(plan_path, state_path, by_id["T1"], "agent-state")
            self.bind(plan_path, state_path, by_id["T3"], "agent-fixtures")
            self.finish(plan_path, state_path, by_id["T1"], status="failed")
            self.finish(plan_path, state_path, by_id["T3"])
            self.assertEqual(
                self.run_json("status", plan_path, state_path)["next_action"], "repair"
            )
            self.assertEqual(
                self.run_json("reserve", plan_path, state_path, 3)["actions"], []
            )

    def test_render_is_read_only_and_deterministic(self) -> None:
        with self.workspace() as (_, _, plan_path):
            first = self.run_cli("render", plan_path)
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["tasks"] = list(reversed(plan["tasks"]))
            plan_path.write_text(json.dumps(plan, indent=2) + "\n", encoding="utf-8")
            coverage_path = plan_path.with_name("coverage.json")
            coverage = json.loads(coverage_path.read_text(encoding="utf-8"))
            coverage["plan_digest"] = hashlib.sha256(plan_path.read_bytes()).hexdigest()
            coverage_path.write_text(json.dumps(coverage, indent=2) + "\n", encoding="utf-8")
            second = self.run_cli("render", plan_path)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(first.stdout.split("\n", 1)[1], second.stdout.split("\n", 1)[1])
            self.assertRegex(
                first.stdout.splitlines()[0],
                r"^%% goal-dag plan_digest=[0-9a-f]{64} revision=1 safety\.status=parallel_safe$",
            )
            self.assertFalse(plan_path.with_name("state.json").exists())

    def test_claude_driver_uses_null_runtime_profiles(self) -> None:
        with self.workspace("claude_code") as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path, script=CLAUDE_SCRIPT)
            payload = self.run_json("reserve", plan_path, state_path, 1, script=CLAUDE_SCRIPT)
            self.assertIsNone(payload["actions"][0]["binding"]["runtime_profile"])

    def test_published_drivers_exactly_match_built_typescript_source(self) -> None:
        source_path = ROOT / "tooling/goal-dag/goal-dag.ts"
        builder = """
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
const source = readFileSync(process.argv[1], "utf8");
const template = [
  "// Generated from tooling/goal-dag/goal-dag.ts. Do not edit directly.",
  stripTypeScriptTypes(source, { mode: "strip" }).replace(/[ \\t]+$/gm, ""),
].join("\\n");
process.stdout.write(JSON.stringify({
  codex: template.replaceAll("__EXECUTION_PLATFORM__", "codex"),
  claude_code: template.replaceAll("__EXECUTION_PLATFORM__", "claude_code"),
}));
"""
        built = subprocess.run(
            ["node", "--input-type=module", "-e", builder, str(source_path)],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(built.returncode, 0, built.stderr)
        expected = json.loads(built.stdout)
        self.assertEqual(expected["codex"], CODEX_SCRIPT.read_text(encoding="utf-8"))
        self.assertEqual(expected["claude_code"], CLAUDE_SCRIPT.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
