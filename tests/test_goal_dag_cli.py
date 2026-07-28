from contextlib import contextmanager
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import selectors
import socket
import subprocess
import tempfile
import unittest
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
CODEX_SCRIPT = ROOT / "codex-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs"
CLAUDE_SCRIPT = ROOT / "claude-code-market/scripts/goal-dag.mjs"
KIMI_SCRIPT = ROOT / "kimi-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs"
WORKFLOW_CONFIG_SCRIPT = ROOT / "tooling/workflow-config/workflow-config.mjs"
DASHBOARD_SOURCE = ROOT / "tooling/goal-dag/dashboard.html"
DASHBOARD_STARTER_SOURCE = ROOT / "tooling/goal-dag/start-dashboard.mjs"
CODEX_DASHBOARD_STARTER = ROOT / "codex-market/plugins/ghost-agent-workflow/scripts/start-dashboard.mjs"
CLAUDE_DASHBOARD_STARTER = ROOT / "claude-code-market/scripts/start-dashboard.mjs"
KIMI_DASHBOARD_STARTER = ROOT / "kimi-market/plugins/ghost-agent-workflow/scripts/start-dashboard.mjs"
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
                goal["lifecycle"]["controller"] = "standalone_thread"
                goal["lifecycle"]["native_goal"] = None
            goal_path = root / "goal.json"
            goal_path.write_text(json.dumps(goal, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

            plan = json.loads((FIXTURES / "plan.json").read_text(encoding="utf-8"))
            plan["execution_platform"] = platform
            plan["goal_contract_path"] = str(goal_path)
            plan["goal_digest"] = hashlib.sha256(goal_path.read_bytes()).hexdigest()
            plan["plan_source"] = deepcopy(goal["source"])
            plan["coverage_path"] = str(root / "coverage.json")
            plan_path = root / "plan.json"
            plan_path.write_text(json.dumps(plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            owner_root = workspace_root / ".ghost-agent-workflow" / "owners"
            owner_root.mkdir(parents=True, exist_ok=True)
            persistent_owners = []
            for owner in plan["owners"]:
                if not owner["writable_paths"]:
                    continue
                persistent_owner = {
                    "id": owner["id"],
                    "generation": 1,
                    "status": "active",
                    "responsibility": owner["responsibility"],
                    "scope_patterns": owner["writable_paths"],
                    "scope_excludes": owner["excluded_paths"],
                    "worker_context": owner["worker_context"],
                    "lineage": {
                        "parent_owner_ids": [],
                        "created_by_request_digest": "bootstrap",
                    },
                }
                persistent_owners.append(persistent_owner)
                capsule_path = owner_root / owner["id"] / "capsule.json"
                capsule_path.parent.mkdir(parents=True)
                capsule_path.write_text(
                    json.dumps(
                        {
                            "contract": "OWNER_CAPSULE_V2",
                            "owner_id": owner["id"],
                            "generation": 1,
                            "registry_revision": 1,
                            "scope_patterns": owner["writable_paths"],
                            "scope_excludes": owner["excluded_paths"],
                            "responsibility": owner["responsibility"],
                            "worker_context": owner["worker_context"],
                            "inherited_from": [],
                            "decisions": [],
                            "invariants": [],
                            "risks": [],
                            "important_symbols": [],
                            "next_steps": [],
                            "history": [],
                            "updated_at": "2026-07-27T00:00:00.000Z",
                        },
                        indent=2,
                        ensure_ascii=False,
                    )
                    + "\n",
                    encoding="utf-8",
                )
            (owner_root / "registry.json").write_text(
                json.dumps(
                    {
                        "contract": "OWNER_REGISTRY_V2",
                        "workspace_root": str(workspace_root),
                        "revision": 1,
                        "matcher": "owner-path-expression-v2",
                        "managed_roots": ["src/**", "tests/**"],
                        "owners": persistent_owners,
                        "retired_owner_ids": [],
                        "updated_at": "2026-07-27T00:00:00.000Z",
                    },
                    indent=2,
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
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

    def run_json_input(
        self, payload: dict, *args: object, script: Path | None = None
    ) -> dict:
        script = CODEX_SCRIPT if script is None else script
        environment = os.environ.copy()
        environment["GOAL_DAG_EXECUTION_PLATFORM"] = (
            "claude_code" if script == CLAUDE_SCRIPT else "codex"
        )
        result = subprocess.run(
            ["node", str(script), *(str(arg) for arg in args)],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            check=False,
            env=environment,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def read_progress_events(self, plan_path: Path) -> list[dict]:
        events_path = plan_path.with_name("events.jsonl")
        self.assertTrue(events_path.is_file())
        return [
            json.loads(line)
            for line in events_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def compact_plan_input(self, plan_path: Path) -> dict:
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        coverage = json.loads(Path(plan["coverage_path"]).read_text(encoding="utf-8"))
        tasks = []
        for task in plan["tasks"]:
            item = {
                "id": task["id"],
                "title": task["title"],
                "role": task["role"],
                "work": task["task"],
                "after": task["depends_on"],
                "done": task["done_when"],
                "verify": task["verification_ids"],
                "gates": task["satisfies_goal_gates"],
                "items": task["plan_item_ids"],
                "risk": task["risk_level"],
                "review": task["review_policy"],
                "priority": task["priority"],
                "cost": task["estimated_cost"],
            }
            if task["owner_id"] is not None:
                item["owner"] = task["owner_id"]
            else:
                item["actor"] = task["runtime_actor_id"]
            if task["writable_paths"]:
                item["write"] = task["writable_paths"]
            if task["review_batch_key"] is not None:
                item["review_batch"] = task["review_batch_key"]
                item["review_reason"] = task["review_reasons"][0]
            if task["reviews_task_ids"]:
                item["reviews"] = task["reviews_task_ids"]
            tasks.append(item)
        return {
            "contract": "PLAN_INPUT_V1",
            "items": [
                {
                    "id": item["id"],
                    "description": item["description"],
                    "source_refs": item["source_refs"],
                    "effects": item["required_effects"],
                }
                for item in coverage["required_plan_items"]
            ],
            "tasks": tasks,
            "safety": plan["safety"]["status"],
            "safety_reasons": plan["safety"]["reasons"],
        }

    def initialize(
        self, goal_path: Path, plan_path: Path, script: Path | None = None,
        complete_source_audit: bool = True,
    ) -> Path:
        self.run_json("goal-validate", goal_path, script=script)
        self.run_json("planner-review-context", plan_path, script=script)
        self.run_json_input(
            {
                "parallelism": "pass",
                "too_complex": False,
                "too_simple": False,
                "changes": [],
            },
            "planner-review-submit",
            plan_path,
            script=script,
        )
        payload = self.run_json("validate", plan_path, script=script)
        state_path = Path(payload["state_path"])
        if complete_source_audit:
            action = self.reserve_one(plan_path, state_path, script=script)
            self.assertEqual(action["task_id"], "T0")
            self.assertEqual(action["action"], "run_script")
            self.run_json(
                "runtime-execute",
                plan_path,
                state_path,
                action["task_id"],
                action["reservation_token"],
                script=script,
            )
        return state_path

    def reserve_one(
        self, plan_path: Path, state_path: Path, capacity: int = 1, script: Path | None = None
    ) -> dict:
        payload = self.run_json("reserve", plan_path, state_path, capacity, script=script)
        self.assertEqual(len(payload["actions"]), 1, payload)
        return payload["actions"][0]

    def action_subject_id(self, action: dict) -> str:
        return action["execution_subject_id"]

    def bound_executor_for(self, state: dict, action: dict) -> str | None:
        subject_id = self.action_subject_id(action)
        collection = (
            "runtime_actors"
            if action["runtime_actor_id"]
            else "reviewers"
            if subject_id in state["reviewers"]
            else "owners"
        )
        return state[collection][subject_id]["bound_executor_id"]

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
            "contract": "WORKER_RESULT_V5",
            "status": status,
            "task_id": task_id,
            "logical_id": task["logical_id"],
            "role": task["role"],
            "owner_id": task["owner_id"],
            "runtime_actor_id": task["runtime_actor_id"],
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
            "non_blocking_findings": [],
            "follow_up_suggestions": [],
            "reviewed_results": [
                {
                    "task_id": reviewed_id,
                    "result_ref": state["tasks"][reviewed_id]["result_ref"],
                    "result_digest": state["tasks"][reviewed_id]["result_digest"],
                }
                for reviewed_id in task["reviews_task_ids"]
            ],
            "review_plan_digest": state["plan_digest"] if task["role"] == "review" else None,
            "review_workspace_digest": (
                task_state["task_baseline_digest"] if task["role"] == "review" else None
            ),
            "scope_request": None,
            "summary": f"{task_id} {status}",
            "owner_updates": {
                "decisions": [] if task["role"] != "work" else [f"{task_id} decision"],
                "invariants": [] if task["role"] != "work" else [f"{task_id} invariant"],
                "risks": [],
            },
            "published_artifacts": [],
        }
        result.update(overrides)
        return result

    def bind(
        self, plan_path: Path, state_path: Path, action: dict, executor_id: str,
        script: Path | None = None,
    ) -> dict:
        executor_id = action.get("executor_id") or executor_id
        return self.run_json(
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
                if action["action"] == "run_script":
                    self.run_json(
                        "runtime-execute",
                        plan_path,
                        state_path,
                        action["task_id"],
                        action["reservation_token"],
                        script=script,
                    )
                    continue
                state = json.loads(state_path.read_text(encoding="utf-8"))
                subject_id = self.action_subject_id(action)
                executor = executors.setdefault(
                    subject_id,
                    self.bound_executor_for(state, action) or f"agent-{subject_id}",
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
                if action["action"] == "run_script":
                    if action["task_id"] == target_task_id:
                        self.bind(
                            plan_path,
                            state_path,
                            action,
                            f"runtime-script-{action['runtime_actor_id']}",
                            script=script,
                        )
                        return action
                    self.run_json(
                        "runtime-execute",
                        plan_path,
                        state_path,
                        action["task_id"],
                        action["reservation_token"],
                        script=script,
                    )
                    continue
                subject_id = self.action_subject_id(action)
                executor = executors.setdefault(
                    subject_id, f"agent-{subject_id}"
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
        non_requirements = {}
        for block in source_blocks["blocks"]:
            item_ids = sorted(
                item["id"]
                for item in coverage["required_plan_items"]
                if block["id"] in item["source_refs"]
            )
            if not item_ids:
                non_requirements[block["id"]] = "该行仅为结构或说明，不构成交付要求"
        payload = self.run_json_input(
            {
                "contract": "SOURCE_AUDIT_INPUT_V1",
                "non_requirements": non_requirements,
            },
            "source-audit-auto",
            plan_path,
            state_path,
            action["task_id"],
            action["reservation_token"],
            script=script,
        )
        return Path(payload["artifact_ref"]), payload["artifact_digest"]

    def write_commit_readiness_artifact(
        self, plan_path: Path, state_path: Path, action: dict, script: Path | None = None
    ) -> tuple[Path, str]:
        payload = self.run_json(
            "commit-readiness",
            plan_path,
            state_path,
            action["task_id"],
            action["reservation_token"],
            script=script,
        )
        return Path(payload["artifact_ref"]), payload["artifact_digest"]

    def publish_owner_artifact(
        self,
        plan_path: Path,
        state_path: Path,
        task: dict,
        contract: str,
        audience: list[str],
        **payload: object,
    ) -> dict:
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        goal = json.loads(Path(plan["goal_contract_path"]).read_text(encoding="utf-8"))
        state = json.loads(state_path.read_text(encoding="utf-8"))
        artifact_path = (
            Path(goal["workspace"]["root"])
            / ".ghost-agent-workflow"
            / "owners"
            / task["owner_id"]
            / "interfaces"
            / goal["goal_id"]
            / task["id"]
            / f"attempt-{state['tasks'][task['id']]['attempt']}"
            / f"{task['id']}-{contract.lower()}.json"
        )
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        body = {
            "contract": contract,
            "owner_id": task["owner_id"],
            "producer_task_id": task["id"],
            "audience": audience,
            **payload,
        }
        artifact_path.write_text(
            json.dumps(body, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        return {
            "contract": contract,
            "ref": str(artifact_path),
            "digest": hashlib.sha256(artifact_path.read_bytes()).hexdigest(),
            "audience": audience,
        }

    def accepted_owner_files(self, plan_path: Path, state_path: Path, owner_id: str) -> list[str]:
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        state = json.loads(state_path.read_text(encoding="utf-8"))
        changed: set[str] = set()
        for task in plan["tasks"]:
            task_state = state["tasks"][task["id"]]
            if task["owner_id"] != owner_id or task_state["status"] != "completed":
                continue
            result_ref = task_state["result_ref"]
            if result_ref:
                changed.update(json.loads(Path(result_ref).read_text(encoding="utf-8"))["changed_files"])
        return sorted(changed)

    def finish(
        self, plan_path: Path, state_path: Path, action: dict,
        status: str = "completed", script: Path | None = None, **overrides: object,
    ) -> dict:
        task_id = action["task_id"]
        state_before = json.loads(state_path.read_text(encoding="utf-8"))
        task_state_before = state_before["tasks"][task_id]
        result_path = Path(
            action.get("binding", {}).get("refs", {}).get("result")
            or task_state_before["result_path"]
        )
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
                    f"{task_id} attempt {task_state_before['attempt']}\n", encoding="utf-8"
                )
        if status == "completed" and task["owner_id"] is not None and task["role"] != "review":
            result["published_artifacts"].append(
                self.publish_owner_artifact(
                    plan_path,
                    state_path,
                    task,
                    "OWNER_HANDOFF_V1",
                    ["*"],
                    summary=result["summary"],
                )
            )
        if status == "completed" and task["owner_id"] is not None and task["role"] != "review":
            state = json.loads(state_path.read_text(encoding="utf-8"))
            attested_files = sorted(set(
                self.accepted_owner_files(plan_path, state_path, task["owner_id"])
                + result["changed_files"]
            ))
            result["published_artifacts"].append(
                self.publish_owner_artifact(
                    plan_path,
                    state_path,
                    task,
                    "COMMIT_ATTESTATION_V1",
                    ["commit-readiness", "git-controller"],
                    workspace_change_seq=(
                        state["workspace_change_seq"] + (1 if result["changed_files"] else 0)
                    ),
                    changed_files=attested_files,
                    commit_message="chore(workflow): 交付目标变更",
                    conclusion="approved",
                )
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
        if status == "completed" and "commit-readiness" in task["verification_ids"]:
            artifact_path, artifact_digest = self.write_commit_readiness_artifact(
                plan_path, state_path, action, script=script
            )
            evidence = next(
                item for item in result["evidence"]
                if item["verification_id"] == "commit-readiness"
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

    def test_goal_and_plan_initialize_v5_state_and_capsules(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            goal_state = json.loads((root / "goal-state.json").read_text(encoding="utf-8"))
            state = json.loads(state_path.read_text(encoding="utf-8"))

            self.assertEqual(goal_state["contract"], "GOAL_STATE_V1")
            self.assertEqual(goal_state["active_plan_path"], str(plan_path))
            self.assertEqual(state["contract"], "DAG_RUN_STATE_V5")
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
            self.assertEqual(payload["thread_titles"], {
                "main": "[GA][任务][主控] 重构页面状态并完成集成验证",
                "planner": "[GA][任务][规划] 重构页面状态并完成集成验证",
                "planner_reviewer": "[GA][任务][规划审查] 重构页面状态并完成集成验证",
                "supervisor": "[GA][任务][监督] 重构页面状态并完成集成验证",
            })
            state_path = self.initialize(goal_path, plan_path)
            status = self.run_json("status", plan_path, state_path)
            self.assertNotIn("continuation_prompt", status)

        with self.workspace("claude_code") as (_, goal_path, plan_path):
            expected = f"/ghost-agent-workflow:sub-thread-coordination 继续 `{goal_path}`。"
            payload = self.run_json("goal-validate", goal_path, script=CLAUDE_SCRIPT)
            self.assertEqual(payload["continuation_prompt"], expected)
            state_path = self.initialize(goal_path, plan_path, script=CLAUDE_SCRIPT)
            status = self.run_json("status", plan_path, state_path, script=CLAUDE_SCRIPT)
            self.assertEqual(status["continuation_prompt"], expected)

    def test_non_thread_execution_mode_is_rejected(self) -> None:
        for platform, script in (("codex", CODEX_SCRIPT), ("claude_code", CLAUDE_SCRIPT)):
            with self.workspace(platform) as (_, goal_path, _):
                goal = json.loads(goal_path.read_text(encoding="utf-8"))
                goal["execution"]["mode"] = "unsupported"
                goal_path.write_text(json.dumps(goal), encoding="utf-8")
                rejected = self.run_cli("goal-validate", goal_path, script=script)
                self.assertNotEqual(rejected.returncode, 0)
                self.assertIn("execution.mode must equal thread", rejected.stderr)

    def test_review_policy_requires_an_explicit_review_dag_node(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            self.run_json("goal-validate", goal_path)
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            review = next(task for task in plan["tasks"] if task["id"] == "T5")
            review["reviews_task_ids"] = ["T2"]
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            coverage_path = plan_path.with_name("coverage.json")
            coverage = json.loads(coverage_path.read_text(encoding="utf-8"))
            coverage["plan_digest"] = hashlib.sha256(plan_path.read_bytes()).hexdigest()
            coverage_path.write_text(json.dumps(coverage), encoding="utf-8")
            rejected = self.run_cli("validate", plan_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("task T1 review_policy batch requires an explicit review DAG node", rejected.stderr)

    def test_json_write_validates_contract_and_refuses_runtime_managed_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "threads.json"
            rejected_registry = subprocess.run(
                ["node", str(CODEX_SCRIPT), "json-write", str(target), "THREAD_REGISTRY_V1"],
                input=json.dumps({"contract": "THREAD_REGISTRY_V1"}),
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(rejected_registry.returncode, 0)
            self.assertIn("runtime-managed", rejected_registry.stderr)

            initialized = self.run_json(
                "thread-registry", "init", target, "fixture", "main-thread", "main-host",
            )
            self.assertEqual(initialized["contract"], "THREAD_REGISTRY_RECEIPT_V1")
            self.run_json(
                "thread-registry", "put-thread", target, "wf_planner_fixture",
                "planner-thread", "local", "planner", "idle",
            )
            self.run_json(
                "thread-registry", "put-watch", target, "T2", "1",
                "wf_planner_fixture", "-",
            )
            registry = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(set(registry), {"contract", "goal_id", "main", "threads", "watches"})
            self.assertEqual(registry["watches"][0]["task_id"], "T2")

            protected = subprocess.run(
                ["node", str(CODEX_SCRIPT), "json-write", str(Path(directory) / "state.json"), "-"],
                input="{}",
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(protected.returncode, 0)
            self.assertIn("runtime-managed", protected.stderr)

    def test_supervisor_commands_return_bounded_actions_and_persist_observations(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            threads_path = root / "threads.json"
            self.run_json(
                "thread-registry",
                "init",
                threads_path,
                json.loads(goal_path.read_text(encoding="utf-8"))["goal_id"],
                "main-thread",
                "local",
            )
            action = self.reserve_one(plan_path, state_path)

            pending = self.run_json("supervisor-next", root, "--limit", 8)
            self.assertEqual(
                set(pending), {"main", "create", "wait", "stalled", "notify"}
            )
            self.assertEqual(pending["main"], {"thread": "main-thread", "host": "local"})
            self.assertEqual(len(pending["create"]), 1)
            create = pending["create"][0]
            self.assertEqual(create["task"], action["task_id"])
            self.assertEqual(create["attempt"], 1)
            self.assertIsNone(create["thread"])
            self.assertIsNone(create["host"])
            self.assertEqual(create["model"], "gpt-5.6-sol")
            self.assertEqual(create["effort"], "high")
            self.assertNotIn("binding", create)

            created = self.run_json(
                "supervisor-record",
                root,
                "created",
                action["task_id"],
                1,
                "worker-thread",
                "local",
            )
            self.assertEqual(created["status"], "created")
            self.assertEqual(
                json.loads(Path(created["binding_ref"]).read_text(encoding="utf-8"))["contract"],
                "TASK_BINDING_V6",
            )
            self.assertEqual(
                hashlib.sha256(Path(created["binding_ref"]).read_bytes()).hexdigest(),
                created["binding_digest"],
            )
            self.assertIn("supervisor-record", created["dispatch"])
            self.assertNotIn('"task": {', created["dispatch"])

            binding = self.run_json(
                "supervisor-record",
                root,
                "binding",
                action["task_id"],
                1,
                "worker-thread",
            )
            self.assertEqual(binding["contract"], "TASK_BINDING_V6")
            self.assertEqual(binding["run"]["executor"], "worker-thread")

            watching = self.run_json("supervisor-next", root)
            self.assertEqual(watching["create"], [])
            self.assertEqual(watching["notify"], [])
            self.assertEqual(watching["wait"], [{
                "task": action["task_id"],
                "attempt": 1,
                "thread": "worker-thread",
                "host": "local",
                "title": create["title"],
                "cursor": None,
            }])

            observed = self.run_json(
                "supervisor-record",
                root,
                "observed",
                action["task_id"],
                1,
                "cursor-1",
                "completed",
            )
            self.assertTrue(observed["terminal"])
            terminal = self.run_json("supervisor-next", root)
            self.assertEqual(terminal["wait"], [])
            self.assertEqual(terminal["notify"], [{
                "task": action["task_id"],
                "attempt": 1,
                "thread": "worker-thread",
                "host": "local",
                "title": create["title"],
                "status": "completed",
                "result_ref": None,
                "summary": "线程已结束，但尚未生成有效结果",
            }])

            self.run_json(
                "supervisor-record", root, "notified", action["task_id"], 1
            )
            quiet = self.run_json("supervisor-next", root)
            self.assertEqual(quiet["wait"], [])
            self.assertEqual(quiet["notify"], [])
            registry = json.loads(threads_path.read_text(encoding="utf-8"))
            self.assertEqual(registry["watches"], [])

            accepted = self.finish(plan_path, state_path, action)
            self.assertTrue(accepted["user_message"].startswith(create["title"] + "任务完成："))
            reused_action = self.reserve_one(plan_path, state_path)
            self.assertEqual(reused_action["action"], "reuse_thread")
            reused = self.run_json("supervisor-next", root)
            self.assertEqual(reused["create"][0]["task"], reused_action["task_id"])
            self.assertEqual(reused["create"][0]["thread"], "worker-thread")
            self.assertEqual(reused["create"][0]["host"], "local")
            rebound = self.run_json(
                "supervisor-record",
                root,
                "created",
                reused_action["task_id"],
                reused_action["binding"]["run"]["attempt"],
                "worker-thread",
                "local",
            )
            self.assertEqual(rebound["status"], "created")

    def test_result_submit_writes_full_result_and_returns_compact_receipt(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "thread-state-domain")
            result = self.result_for(plan_path, state_path, action["task_id"])
            minimal = {
                "contract": "TASK_RESULT_INPUT_V2",
                "status": result["status"],
                "summary": result["summary"],
                "evidence": [
                    {
                        "id": item["verification_id"],
                        "outcome": item["outcome"],
                        "summary": item["summary"],
                        "artifact": item["artifact_ref"],
                    }
                    for item in result["evidence"]
                ],
            }
            submitted = subprocess.run(
                [
                    "node", str(CODEX_SCRIPT), "result-submit", str(plan_path),
                    str(state_path), action["task_id"], action["reservation_token"],
                ],
                input=json.dumps(minimal),
                capture_output=True,
                text=True,
                check=False,
                env={**os.environ, "GOAL_DAG_EXECUTION_PLATFORM": "codex"},
            )
            self.assertEqual(submitted.returncode, 0, submitted.stderr)
            receipt = json.loads(submitted.stdout)
            self.assertEqual(
                set(receipt),
                {
                    "contract", "status", "task_id", "attempt", "result_ref",
                    "result_digest", "blocking_count",
                },
            )
            self.assertEqual(receipt["contract"], "THREAD_TASK_RECEIPT_V1")
            full_result = json.loads(Path(receipt["result_ref"]).read_text(encoding="utf-8"))
            self.assertEqual(full_result["contract"], "WORKER_RESULT_V5")
            self.assertIn("owner_updates", full_result)
            self.assertEqual(full_result["task_id"], action["task_id"])
            self.assertEqual(full_result["reservation_token"], action["reservation_token"])
            self.assertNotIn("task_id", minimal)
            submitted_events = [
                event for event in self.read_progress_events(plan_path)
                if event["type"] == "task_result_submitted"
                and event["task_id"] == action["task_id"]
            ]
            self.assertEqual(len(submitted_events), 1)
            self.assertEqual(submitted_events[0]["result_digest"], receipt["result_digest"])

    def test_supervisor_persists_stall_count_and_recovers_closed_thread(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            threads_path = root / "threads.json"
            self.run_json(
                "thread-registry", "init", threads_path,
                json.loads(goal_path.read_text(encoding="utf-8"))["goal_id"],
                "main-thread", "local",
            )
            action = self.reserve_one(plan_path, state_path)
            self.run_json(
                "supervisor-record", root, "created", action["task_id"], 1,
                "worker-thread", "local",
            )
            self.run_json(
                "supervisor-record", root, "observed", action["task_id"], 1,
                "cursor-1", "running",
            )
            for expected in range(1, 4):
                observed = self.run_json(
                    "supervisor-record", root, "observed", action["task_id"], 1,
                    "cursor-1", "running",
                )
                self.assertEqual(observed["unchanged_waits"], expected)
            stalled = self.run_json("supervisor-next", root)
            self.assertEqual(stalled["wait"], [])
            self.assertEqual(stalled["stalled"][0]["task"], action["task_id"])
            self.run_json(
                "supervisor-record", root, "stalled-notified", action["task_id"], 1
            )
            quiet = self.run_json("supervisor-next", root)
            self.assertEqual(quiet["wait"], [])
            self.assertEqual(quiet["stalled"], [])

            recovered = self.run_json(
                "supervisor-recover", root, action["task_id"], 1, "用户确认线程已关闭"
            )
            self.assertEqual(recovered["status"], "recovered")
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["tasks"][action["task_id"]]["status"], "pending")
            self.assertEqual(state["stale_executors"], [])
            registry = json.loads(threads_path.read_text(encoding="utf-8"))
            self.assertEqual(registry["watches"], [])
            self.assertEqual(registry["threads"][next(iter(registry["threads"]))]["status"], "lost")
            repeated = self.run_json(
                "supervisor-recover", root, action["task_id"], 1, "用户确认线程已关闭"
            )
            self.assertEqual(repeated["removed_watches"], 0)

    def test_supervisor_uses_validated_sanitized_result_summary(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            self.run_json(
                "thread-registry",
                "init",
                root / "threads.json",
                json.loads(goal_path.read_text(encoding="utf-8"))["goal_id"],
                "main-thread",
                "local",
            )
            action = self.reserve_one(plan_path, state_path)
            self.run_json(
                "supervisor-record", root, "created", action["task_id"], 1,
                "worker-thread", "local",
            )
            state = json.loads(state_path.read_text(encoding="utf-8"))
            result_path = Path(state["tasks"][action["task_id"]]["result_path"])
            result_path.parent.mkdir(parents=True, exist_ok=True)
            result_path.write_text(
                json.dumps(
                    self.result_for(
                        plan_path,
                        state_path,
                        action["task_id"],
                        "failed",
                        summary="第一行\n" + "测" * 120,
                    ),
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            self.run_json(
                "supervisor-record", root, "observed", action["task_id"], 1,
                "cursor-final", "failed",
            )
            notice = self.run_json("supervisor-next", root)["notify"][0]
            self.assertEqual(notice["result_ref"], str(result_path))
            self.assertNotIn("\n", notice["summary"])
            self.assertLessEqual(len(notice["summary"]), 100)
            self.assertTrue(notice["summary"].endswith("…"))

    def test_goal_create_expands_short_input_without_handwritten_contract_fields(self) -> None:
        with self.workspace() as (_, goal_path, _):
            existing = json.loads(goal_path.read_text(encoding="utf-8"))
            goal_path.unlink()
            business_gates = [
                {
                    "id": gate["id"],
                    "stage": gate["stage"],
                    "description": gate["description"],
                }
                for gate in existing["verification_gates"]
                if gate["id"] not in {
                    "source-coverage-audit", "diff-scope-audit", "commit-readiness"
                }
            ]
            receipt = self.run_json_input(
                {
                    "contract": "GOAL_INPUT_V1",
                    "id": existing["goal_id"],
                    "objective": existing["objective"],
                    "source": existing["source"]["path"],
                    "scope": existing["scope"],
                    "non_goals": existing["non_goals"],
                    "constraints": existing["constraints"],
                    "max_concurrency": 3,
                    "gates": business_gates,
                },
                "goal-create", goal_path, existing["workspace"]["root"],
            )
            self.assertEqual(receipt["contract"], "GOAL_CREATE_RECEIPT_V1")
            generated = json.loads(goal_path.read_text(encoding="utf-8"))
            self.assertEqual(generated["contract"], "GOAL_CONTRACT_V1")
            self.assertEqual(generated["source"]["revision"], 1)
            self.assertEqual(generated["execution"]["mode"], "thread")
            self.assertEqual(generated["lifecycle"]["controller"], "standalone_thread")
            self.assertEqual(
                {gate["id"] for gate in generated["verification_gates"]},
                {gate["id"] for gate in existing["verification_gates"]},
            )

    def test_goal_create_keeps_eight_as_the_runtime_parallel_ceiling(self) -> None:
        with self.workspace() as (_, goal_path, _):
            existing = json.loads(goal_path.read_text(encoding="utf-8"))
            workspace_root = Path(existing["workspace"]["root"])
            configured = subprocess.run(
                [
                    "node",
                    str(WORKFLOW_CONFIG_SCRIPT),
                    "set-parallel",
                    str(workspace_root),
                    "6",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(configured.returncode, 0, configured.stderr)
            goal_path.unlink()
            self.run_json_input(
                {
                    "contract": "GOAL_INPUT_V1",
                    "id": existing["goal_id"],
                    "objective": existing["objective"],
                    "source": existing["source"]["path"],
                    "scope": existing["scope"],
                },
                "goal-create",
                goal_path,
                workspace_root,
            )
            generated = json.loads(goal_path.read_text(encoding="utf-8"))
            self.assertEqual(generated["execution"]["max_concurrency"], 8)

    def test_reserve_reloads_live_parallel_config_and_compact_receipts(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            workspace_root = Path(
                json.loads(goal_path.read_text(encoding="utf-8"))["workspace"]["root"]
            )
            subprocess.run(
                ["node", str(WORKFLOW_CONFIG_SCRIPT), "set-parallel", workspace_root, "1"],
                check=True, capture_output=True, text=True,
            )
            state_path = self.initialize(goal_path, plan_path)
            first = self.run_json("reserve", plan_path, state_path, "--compact")
            self.assertEqual(len(first["actions"]), 1)
            self.assertNotIn("binding", first["actions"][0])
            compact_status = self.run_json("status", plan_path, state_path, "--compact")
            self.assertNotIn("binding", compact_status["active_reservations"][0])

            subprocess.run(
                ["node", str(WORKFLOW_CONFIG_SCRIPT), "set-parallel", workspace_root, "3"],
                check=True, capture_output=True, text=True,
            )
            expanded = self.run_json("reserve", plan_path, state_path, "--compact")
            self.assertGreater(len(expanded["actions"]), 0)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            active = [
                value for value in state["tasks"].values()
                if value["status"] in {"reserved", "running"}
            ]
            self.assertEqual(len(active), 2)

    def test_plan_create_expands_short_tasks_and_writes_coverage_atomically(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            coverage_path = root / "coverage.json"
            compact = self.compact_plan_input(plan_path)
            plan_path.unlink()
            coverage_path.unlink()
            receipt = self.run_json_input(compact, "plan-create", goal_path, plan_path)
            self.assertEqual(receipt["contract"], "PLAN_CREATE_RECEIPT_V1")
            generated = json.loads(plan_path.read_text(encoding="utf-8"))
            self.assertEqual(generated["contract"], "DAG_PLAN_V5")
            self.assertEqual(generated["planner"], "parallel-task-planner")
            self.assertEqual(generated["revision"], 1)
            self.assertEqual(len(generated["runtime_actors"]), 3)
            self.assertEqual(
                json.loads(coverage_path.read_text(encoding="utf-8"))["plan_digest"],
                receipt["plan_digest"],
            )

    def test_plan_activation_requires_planner_reviewer_pass(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            self.run_json("goal-validate", goal_path)
            rejected = self.run_cli("activate", plan_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("Planner Reviewer approval", rejected.stderr)

            context = self.run_json("planner-review-context", plan_path)
            self.assertEqual(context["context"]["contract"], "PLANNER_REVIEW_CONTEXT_V1")
            self.assertEqual(
                context["thread_title"],
                "[GA][任务][规划审查] 重构页面状态并完成集成验证",
            )
            self.assertEqual(
                set(context["context"]["metrics"]),
                {"node_count", "max_ready_width", "critical_path_cost", "configured_parallel"},
            )
            accepted = self.run_json_input(
                {
                    "parallelism": "pass",
                    "too_complex": False,
                    "too_simple": False,
                    "changes": [],
                },
                "planner-review-submit",
                plan_path,
            )
            self.assertEqual(accepted["decision"], "pass")
            activated = self.run_json("activate", plan_path)
            self.assertEqual(activated["status"], "valid")

    def test_planner_reviewer_allows_only_one_revision(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            self.run_json("goal-validate", goal_path)
            self.run_json("planner-review-context", plan_path)
            first = self.run_json_input(
                {
                    "parallelism": "revise",
                    "too_complex": False,
                    "too_simple": False,
                    "changes": ["增加一个可并行节点"],
                },
                "planner-review-submit",
                plan_path,
            )
            self.assertEqual(first["decision"], "revise")

            revised = self.run_json_input(
                self.compact_plan_input(plan_path),
                "plan-revise",
                goal_path,
                plan_path,
            )
            self.assertEqual(revised["revision"], 2)
            self.run_json("planner-review-context", plan_path)
            second = self.run_json_input(
                {
                    "parallelism": "pass",
                    "too_complex": True,
                    "too_simple": False,
                    "changes": ["合并细碎节点"],
                },
                "planner-review-submit",
                plan_path,
            )
            self.assertEqual(second["status"], "needs_main")
            rejected = self.run_cli("activate", plan_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("single allowed retry", rejected.stderr)

    def test_review_upgrade_uses_minimal_delta_and_runtime_rewires_dependents(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            self.assertEqual(action["task_id"], "T1")
            self.bind(plan_path, state_path, action, "thread-state-domain")
            self.finish(
                plan_path,
                state_path,
                action,
                review_upgrade_reason="公共接口发生变化",
            )
            reconciled = self.run_json("reconcile", plan_path, state_path)
            self.assertEqual(reconciled["next_action"], "upgrade_review")
            self.assertEqual(
                reconciled["review_upgrades"],
                [{"task_id": "T1", "reason": "公共接口发生变化"}],
            )

            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            review = deepcopy(next(task for task in plan["tasks"] if task["id"] == "T5"))
            review.update(
                {
                    "id": "T1R",
                    "logical_id": "state.types.immediate-review",
                    "title": "立即审查页面状态接口",
                    "task": "审查 T1 的公共接口变化",
                    "depends_on": ["T1"],
                    "reviews_task_ids": ["T1"],
                }
            )
            delta = {
                "contract": "DAG_DELTA_INPUT_V1",
                "tasks": [
                    {
                        "id": review["id"],
                        "title": review["title"],
                        "role": "review",
                        "owner": review["owner_id"],
                        "work": review["task"],
                        "after": review["depends_on"],
                        "done": review["done_when"],
                        "verify": review["verification_ids"],
                        "gates": review["satisfies_goal_gates"],
                        "items": review["plan_item_ids"],
                        "risk": review["risk_level"],
                        "review": "none",
                        "reviews": review["reviews_task_ids"],
                    }
                ],
                "review": [
                    {
                        "task": "T1",
                        "review_task": "T1R",
                        "reason": "公共接口发生变化",
                    }
                ],
            }
            applied = self.run_json_input(
                delta, "apply-delta", plan_path, state_path, "-",
            )
            self.assertEqual(
                applied["review_upgrades"],
                [{"task_id": "T1", "review_task_id": "T1R", "reason": "公共接口发生变化"}],
            )
            updated_plan = json.loads(plan_path.read_text(encoding="utf-8"))
            updated_state = json.loads(state_path.read_text(encoding="utf-8"))
            t1 = next(task for task in updated_plan["tasks"] if task["id"] == "T1")
            t2 = next(task for task in updated_plan["tasks"] if task["id"] == "T2")
            self.assertEqual(t1["review_policy"], "immediate")
            self.assertEqual(t2["depends_on"], ["T1R"])
            self.assertEqual(updated_state["review_pending"], [])

    def test_owner_change_pause_blocks_new_reservations_with_one_state_field(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            request_path = root / "owner-change-request.json"
            request_path.write_text(
                json.dumps(
                    {
                        "contract": "OWNER_CHANGE_REQUEST_V2",
                        "base_registry_digest": state["owner_registry"]["digest"],
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            paused = self.run_json(
                "owner-change-pause", plan_path, state_path, request_path
            )
            self.assertEqual(paused["status"], "paused")
            self.assertFalse(paused["idempotent"])
            repeated = self.run_json(
                "owner-change-pause", plan_path, state_path, request_path
            )
            self.assertTrue(repeated["idempotent"])
            status = self.run_json("status", plan_path, state_path)
            self.assertEqual(status["next_action"], "awaiting_owner_action")
            self.assertEqual(status["owner_change"]["request_ref"], str(request_path))
            rejected = self.run_cli("reserve", plan_path, state_path, 1)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("awaiting user action", rejected.stderr)

    def test_workspace_fence_is_compact_and_does_not_copy_all_tracked_files(self) -> None:
        with self.workspace() as (root, goal_path, _):
            payload = self.run_json("goal-validate", goal_path)
            fence_path = Path(payload["worktree_baseline"]["ref"])
            self.assertEqual(fence_path.name, "workspace-fence.json")
            fence = json.loads(fence_path.read_text(encoding="utf-8"))
            self.assertEqual(fence["contract"], "WORKSPACE_FENCE_V1")
            self.assertIn("tree_oid", fence)
            self.assertIn("index_digest", fence)
            self.assertNotIn("README.md", {entry["path"] for entry in fence["entries"]})

    def test_v3_plan_is_rejected_without_compatibility_path(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            self.run_json("goal-validate", goal_path)
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan.pop("contract")
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            missing_contract = self.run_cli("validate", plan_path)
            self.assertNotEqual(missing_contract.returncode, 0)
            self.assertIn("plan contract must equal DAG_PLAN_V5", missing_contract.stderr)

        with self.workspace() as (_, goal_path, plan_path):
            self.run_json("goal-validate", goal_path)
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["plan_format_version"] = 3
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            result = self.run_cli("validate", plan_path)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("plan_format_version must equal 5", result.stderr)

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
                    "id": "T11",
                    "logical_id": "coverage.audit-source-r2",
                    "title": "重审第二版计划源覆盖",
                }
            )
            diff_audit_task = deepcopy(next(task for task in plan["tasks"] if task["id"] == "T9"))
            diff_audit_task.update(
                {
                    "id": "T12",
                    "logical_id": "scope.audit-final-diff-r2",
                    "title": "重审第二版最终差异",
                    "depends_on": ["T4", "T11"],
                }
            )
            readiness_task = deepcopy(next(task for task in plan["tasks"] if task["id"] == "T10"))
            readiness_task.update(
                {
                    "id": "T13",
                    "logical_id": "delivery.commit-readiness-r2",
                    "title": "重做第二版提交就绪检查",
                    "depends_on": ["T12"],
                }
            )
            coverage = json.loads((root / "coverage.json").read_text(encoding="utf-8"))
            refreshed_goal_state = json.loads((root / "goal-state.json").read_text(encoding="utf-8"))
            refreshed_blocks = json.loads(
                Path(refreshed_goal_state["source_blocks"]["ref"]).read_text(encoding="utf-8")
            )
            coverage["required_plan_items"][-1]["source_refs"] = sorted(set(
                coverage["required_plan_items"][-1]["source_refs"]
                + [refreshed_blocks["blocks"][-1]["id"]]
            ))
            delta_path = root / "goal-revise-delta.json"
            delta_path.write_text(
                json.dumps(
                    {
                        "contract": "DAG_DELTA_V1",
                        "base_plan_digest": hashlib.sha256(plan_path.read_bytes()).hexdigest(),
                        "revision": 2,
                        "add_owners": [],
                        "add_tasks": [source_audit_task, diff_audit_task, readiness_task],
                        "repairs": [],
                        "source_dispositions": [
                            {
                                "task_id": task["id"],
                                "action": "invalidate" if task["id"] in {"T0", "T9", "T10"} else "carry_forward",
                                "replacement_task_id": (
                                    "T11" if task["id"] == "T0"
                                    else "T12" if task["id"] == "T9"
                                    else "T13" if task["id"] == "T10"
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
            self.assertEqual(action["task_id"], "T11")
            self.run_json(
                "runtime-execute",
                plan_path,
                state_path,
                action["task_id"],
                action["reservation_token"],
            )
            diff_action = self.reserve_one(plan_path, state_path)
            self.assertEqual(diff_action["task_id"], "T12")
            finished = self.run_json(
                "runtime-execute",
                plan_path,
                state_path,
                diff_action["task_id"],
                diff_action["reservation_token"],
            )
            diff_result = json.loads(Path(finished["result_ref"]).read_text(encoding="utf-8"))
            diff_evidence = next(
                item for item in diff_result["evidence"]
                if item["verification_id"] == "diff-scope-audit"
            )
            artifact = json.loads(Path(diff_evidence["artifact_ref"]).read_text(encoding="utf-8"))
            self.assertEqual(
                artifact["input_changes"][0]["path"], "development.md"
            )

    def test_source_refresh_cannot_carry_a_review_of_an_invalidated_result(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            self.complete_all(plan_path, state_path)
            source_path = Path(json.loads(goal_path.read_text(encoding="utf-8"))["source"]["path"])
            source_path.write_text(
                source_path.read_text(encoding="utf-8") + "\n刷新状态实现与审查。\n",
                encoding="utf-8",
            )
            self.run_json(
                "goal-refresh", goal_path, root / "goal-state.json", plan_path, state_path
            )
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            by_id = {task["id"]: task for task in plan["tasks"]}
            replacements = {}
            for old_id, new_id in (("T0", "R0"), ("T1", "R1"), ("T9", "R9"), ("T10", "R10")):
                replacement = deepcopy(by_id[old_id])
                replacement.update(
                    {
                        "id": new_id,
                        "logical_id": f"{replacement['logical_id']}.refresh",
                        "title": f"刷新 {replacement['title']}",
                    }
                )
                replacements[old_id] = replacement
            coverage = json.loads((root / "coverage.json").read_text(encoding="utf-8"))
            delta_path = root / "stale-review-refresh-delta.json"
            delta_path.write_text(
                json.dumps(
                    {
                        "contract": "DAG_DELTA_V1",
                        "base_plan_digest": hashlib.sha256(plan_path.read_bytes()).hexdigest(),
                        "revision": plan["revision"] + 1,
                        "add_owners": [],
                        "add_tasks": list(replacements.values()),
                        "repairs": [],
                        "source_dispositions": [
                            {
                                "task_id": task["id"],
                                "action": "invalidate" if task["id"] in replacements else "carry_forward",
                                "replacement_task_id": (
                                    replacements[task["id"]]["id"] if task["id"] in replacements else None
                                ),
                            }
                            for task in plan["tasks"]
                        ],
                        "coverage_update": {"required_plan_items": coverage["required_plan_items"]},
                        "safety": plan["safety"],
                    },
                    indent=2,
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            rejected = self.run_cli("apply-delta", plan_path, state_path, delta_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn(
                "review task T5 must be invalidated with its reviewed result",
                rejected.stderr,
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
            self.assertEqual({action["action"] for action in actions}, {"create_thread"})
            for action in actions:
                self.assertEqual(action["binding"]["contract"], "TASK_BINDING_V6")
                self.assertEqual(
                    set(action["binding"]),
                    {
                        "contract", "task", "run", "thread", "subject", "scope",
                        "refs", "review", "policy", "audit", "output",
                    },
                )
                self.assertIsNone(action["binding"]["run"]["executor"])
                self.assertIn("checkpoint", action["binding"]["refs"])
                coverage_binding = action["binding"]["refs"]["coverage"]
                self.assertEqual(coverage_binding["ref"], str(plan_path.with_name("coverage.json")))
                self.assertRegex(coverage_binding["digest"], r"^[0-9a-f]{64}$")
                self.assertRegex(coverage_binding["semantic_digest"], r"^[0-9a-f]{64}$")
                self.assertNotIn("reusable_evidence", action["binding"])
                self.assertNotIn("evidence_reuse_policy", action["binding"])
                self.assertNotIn("coverage_semantic_digest", action["binding"])
                self.assertNotIn("READY", json.dumps(action, ensure_ascii=False))
            first = actions[0]
            bound = self.bind(plan_path, state_path, first, "thread-after-create")
            self.assertEqual(bound["binding"]["run"]["executor"], "thread-after-create")
            self.assertEqual(bound["binding"]["run"]["token"], first["reservation_token"])

    def test_owner_affinity_reuses_executor_but_not_as_correctness_dependency(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            first = self.reserve_one(plan_path, state_path)
            self.assertEqual(first["task_id"], "T1")
            self.bind(plan_path, state_path, first, "agent-state-a")
            self.finish(plan_path, state_path, first)

            second = self.reserve_one(plan_path, state_path)
            self.assertEqual(second["task_id"], "T2")
            self.assertEqual(second["action"], "reuse_thread")
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
            self.assertEqual(replacement["action"], "create_thread")
            self.assertEqual(replacement["owner_generation"], 2)

    def test_implementation_review_uses_an_independent_review_thread(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.advance_to_task(plan_path, state_path, "T5")
            self.assertEqual(action["execution_subject_id"], "review-T5")
            self.assertEqual(
                action["binding"]["thread"]["title"],
                "[GA][任务][实现审查] 独立审查状态模块",
            )
            self.assertEqual(action["binding"]["subject"]["kind"], "review")
            self.assertEqual(
                action["binding"]["thread"]["profile"],
                {"model": "gpt-5.6-sol", "reasoning_effort": "high"},
            )
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(
                state["reviewers"]["review-T5"]["bound_executor_id"],
                "agent-review-T5",
            )
            self.assertNotEqual(
                state["reviewers"]["review-T5"]["bound_executor_id"],
                state["owners"]["state-domain"]["bound_executor_id"],
            )

    def test_hung_review_thread_can_be_reclaimed_and_recreated(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.advance_to_task(plan_path, state_path, "T5")
            reclaimed = self.run_json(
                "reclaim",
                plan_path,
                state_path,
                "T5",
                action["reservation_token"],
                "用户确认线程疑似挂死",
            )
            self.assertTrue(reclaimed["reclaimed"])
            self.assertEqual(reclaimed["executor_id"], "agent-review-T5")
            state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(state["reviewers"]["review-T5"]["status"], "unbound")

            blocked = self.run_cli("reserve", plan_path, state_path, 3)
            self.assertNotEqual(blocked.returncode, 0)
            self.assertIn("stale executors", blocked.stderr)
            self.run_json(
                "confirm-stale-executor",
                plan_path,
                state_path,
                "agent-review-T5",
            )
            actions = self.run_json("reserve", plan_path, state_path, 3)["actions"]
            replacement = next(item for item in actions if item["task_id"] == "T5")
            self.assertEqual(replacement["action"], "create_thread")
            self.assertEqual(replacement["execution_subject_id"], "review-T5")

    def test_running_checkpoint_survives_executor_rotation(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "agent-state-a")
            checkpoint_path = Path(action["binding"]["refs"]["checkpoint"])
            payload = self.run_json_input(
                {
                    "contract": "CHECKPOINT_INPUT_V1",
                    "progress": "已完成类型定位，准备移动定义",
                    "decisions": ["保持公开类型名称不变"],
                    "invariants": ["页面读取接口不变"],
                    "risks": ["夹具可能仍引用旧位置"],
                    "symbols": ["PageState"],
                    "next": ["移动类型", "运行 state-unit"],
                },
                "checkpoint-save",
                plan_path,
                state_path,
                "T1",
                action["reservation_token"],
            )
            self.assertTrue(checkpoint_path.is_file())
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
            result_path = Path(second["binding"]["refs"]["result"])
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
            result_path = Path(action["binding"]["refs"]["result"])
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
            self.complete_all(plan_path, state_path)
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
                    "id": "T11",
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
                        "repairs": [{"task_id": "T1", "replacement_task_id": "T11"}],
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
            self.assertEqual(applied["repaired_tasks"][0]["replacement_task_id"], "T11")
            progress = json.loads(
                (plan_path.parent / "progress.json").read_text(encoding="utf-8")
            )
            self.assertEqual(progress["snapshot"]["plan"]["revision"], 2)
            self.assertNotIn("events", progress)
            self.assertTrue(
                any(
                    event["type"] == "dag_updated"
                    for event in self.read_progress_events(plan_path)
                )
            )
            next_payload = self.run_json("reserve", plan_path, state_path, 3)
            self.assertEqual([action["task_id"] for action in next_payload["actions"]], ["T11"])
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
                    "id": "T11",
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
                        "repairs": [{"task_id": "T1", "replacement_task_id": "T11"}],
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
                    "id": "T11",
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
                        "repairs": [{"task_id": "T1", "replacement_task_id": "T11"}],
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
            self.complete_all(plan_path, state_path)
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
            self.assertEqual(
                len(goal_state["completion_evidence"]),
                len(json.loads(plan_path.read_text(encoding="utf-8"))["tasks"]),
            )
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
            self.assertEqual(active["result_path"], first["binding"]["refs"]["result"])
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
            self.assertNotEqual(
                first["binding"]["refs"]["result"], second["binding"]["refs"]["result"]
            )
            self.assertEqual(second["binding"]["run"]["attempt"], 2)
            self.assertEqual(second["owner_generation"], 1)

    def test_abandon_clears_checkpoint_capsule_transactionally(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "agent-state")
            checkpoint_path = Path(action["binding"]["refs"]["checkpoint"])
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
            result_path = Path(action["binding"]["refs"]["result"])
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

    def test_native_goal_is_optional_and_native_state_is_strict(self) -> None:
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
            goal["lifecycle"]["controller"] = "standalone_thread"
            goal["lifecycle"]["native_goal"] = None
            goal_path.write_text(json.dumps(goal), encoding="utf-8")
            accepted = self.run_json("goal-validate", goal_path)
            self.assertEqual(accepted["controller"], "standalone_thread")
            self.assertEqual(accepted["native_sync"]["status"], "not_required")

        with self.workspace("claude_code") as (_, goal_path, _):
            goal = json.loads(goal_path.read_text(encoding="utf-8"))
            goal["lifecycle"]["controller"] = "codex_native"
            goal_path.write_text(json.dumps(goal), encoding="utf-8")
            rejected = self.run_cli("goal-validate", goal_path, script=CLAUDE_SCRIPT)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("cannot use codex_native controller", rejected.stderr)

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
                    if action["action"] == "run_script":
                        if action["task_id"] == "T9":
                            self.bind(
                                plan_path,
                                state_path,
                                action,
                                "runtime-script-diff-audit",
                            )
                            verify_action = action
                        else:
                            self.run_json(
                                "runtime-execute",
                                plan_path,
                                state_path,
                                action["task_id"],
                                action["reservation_token"],
                            )
                        continue
                    subject_id = self.action_subject_id(action)
                    executor = executors.setdefault(subject_id, f"agent-{subject_id}")
                    self.bind(plan_path, state_path, action, executor)
                    if action["task_id"] == "T9":
                        verify_action = action
                    else:
                        self.finish(plan_path, state_path, action)
            result = self.result_for(plan_path, state_path, "T9")
            for evidence in result["evidence"]:
                if evidence["verification_id"] == "diff-scope-audit":
                    evidence["artifact_ref"] = None
            result_path = Path(
                json.loads(state_path.read_text(encoding="utf-8"))["tasks"]["T9"]["result_path"]
            )
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
            result_path = Path(action["binding"]["refs"]["result"])
            result_path.parent.mkdir(parents=True, exist_ok=True)
            result = self.result_for(plan_path, state_path, action["task_id"])
            result["changed_files"] = []
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
            result_path = Path(action["binding"]["refs"]["result"])
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
                    by_id["T3"]["binding"]["refs"]["result"],
            )
            self.assertNotEqual(stale.returncode, 0)

    def test_thread_key_is_canonical_and_stable_across_attempts(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            goal = json.loads(goal_path.read_text(encoding="utf-8"))
            goal["goal_id"] = "Goal.UPPER-With-Hyphen"
            goal_path.write_text(json.dumps(goal, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            plan["goal_id"] = goal["goal_id"]
            plan["goal_digest"] = hashlib.sha256(goal_path.read_bytes()).hexdigest()
            for owner in plan["owners"]:
                if owner["id"] == "state-domain":
                    owner["id"] = "state-domain-with-hyphen"
            for task in plan["tasks"]:
                if task["owner_id"] == "state-domain":
                    task["owner_id"] = "state-domain-with-hyphen"
            owner_root = Path(goal["workspace"]["root"]) / ".ghost-agent-workflow/owners"
            registry_path = owner_root / "registry.json"
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            for owner in registry["owners"]:
                if owner["id"] == "state-domain":
                    owner["id"] = "state-domain-with-hyphen"
            registry_path.write_text(
                json.dumps(registry, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            old_capsule_path = owner_root / "state-domain/capsule.json"
            capsule = json.loads(old_capsule_path.read_text(encoding="utf-8"))
            capsule["owner_id"] = "state-domain-with-hyphen"
            new_capsule_path = owner_root / "state-domain-with-hyphen/capsule.json"
            new_capsule_path.parent.mkdir(parents=True)
            new_capsule_path.write_text(
                json.dumps(capsule, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            plan_path.write_text(json.dumps(plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            coverage = json.loads((root / "coverage.json").read_text(encoding="utf-8"))
            coverage["plan_digest"] = hashlib.sha256(plan_path.read_bytes()).hexdigest()
            (root / "coverage.json").write_text(json.dumps(coverage, indent=2) + "\n", encoding="utf-8")
            state_path = self.initialize(goal_path, plan_path)
            first = self.reserve_one(plan_path, state_path)
            name1 = first["thread_key"]
            self.assertEqual(name1, first["binding"]["thread"]["key"])
            self.assertEqual(
                first["thread_title"],
                "[GA][任务][责任域] 抽离页面状态类型",
            )
            self.assertEqual(first["binding"]["thread"]["title"], first["thread_title"])
            self.assertRegex(name1, r"^[a-z0-9_]{1,64}$")
            self.assertNotRegex(name1, r"[\[\]]")
            self.assertRegex(
                name1,
                r"^wf_state_domain_with_hyphen_g1_[0-9a-f]{6}$",
            )
            self.assertNotIn("goal_upper_with_hyphen", name1)
            self.run_json(
                "abandon", plan_path, state_path, first["task_id"],
                first["reservation_token"], "retry name",
            )
            second = self.reserve_one(plan_path, state_path)
            self.assertEqual(name1, second["thread_key"])

    def test_same_persistent_owner_can_execute_work_and_verify_modes(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            task = next(item for item in plan["tasks"] if item["id"] == "T4")
            task["owner_id"] = "state-domain"
            plan_path.write_text(
                json.dumps(plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            coverage_path = root / "coverage.json"
            coverage = json.loads(coverage_path.read_text(encoding="utf-8"))
            coverage["plan_digest"] = hashlib.sha256(plan_path.read_bytes()).hexdigest()
            coverage_path.write_text(
                json.dumps(coverage, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            state_path = self.initialize(goal_path, plan_path)
            self.assertTrue(state_path.exists())

    def test_plan_owner_metadata_must_exactly_match_approved_registry(self) -> None:
        with self.workspace() as (_, _, plan_path):
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            owner = next(item for item in plan["owners"] if item["id"] == "state-domain")
            owner["writable_paths"] = ["src/state/**"]
            plan_path.write_text(
                json.dumps(plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            rejected = self.run_cli("validate", plan_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("approved persistent owner scope", rejected.stderr)

    def test_binding_carries_permanent_owner_registry_and_access_scopes(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            binding = self.reserve_one(plan_path, state_path)["binding"]
            self.assertEqual(binding["refs"]["registry"]["ref"], str(
                Path(json.loads(goal_path.read_text(encoding="utf-8"))["workspace"]["root"])
                / ".ghost-agent-workflow/owners/registry.json"
            ))
            self.assertNotIn("readable_paths", binding)
            self.assertNotIn("searchable_paths", binding)
            self.assertTrue(Path(binding["refs"]["persistent_capsule"]).exists())
            self.assertTrue(binding["refs"]["artifact_dir"].startswith(
                str(Path(binding["refs"]["persistent_capsule"]).parent / "interfaces")
            ))

    def test_approved_owner_change_pauses_then_recovers_through_transition_delta(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            state = json.loads(state_path.read_text(encoding="utf-8"))
            registry_path = Path(state["owner_registry"]["ref"])
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            base_registry_digest = hashlib.sha256(registry_path.read_bytes()).hexdigest()
            changed_owner = next(owner for owner in registry["owners"] if owner["id"] == "state-domain")
            changed_owner["generation"] += 1
            changed_owner["worker_context"] = "保持状态接口一致，并记录已批准的 Owner 迁移"
            registry["revision"] += 1
            registry["updated_at"] = "2026-07-28T02:00:00.000Z"
            registry_path.write_text(
                json.dumps(registry, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            next_registry_digest = hashlib.sha256(registry_path.read_bytes()).hexdigest()

            persistent_capsule_path = registry_path.parent / "state-domain" / "capsule.json"
            persistent_capsule = json.loads(persistent_capsule_path.read_text(encoding="utf-8"))
            persistent_capsule["generation"] = changed_owner["generation"]
            persistent_capsule["registry_revision"] = registry["revision"]
            persistent_capsule["worker_context"] = changed_owner["worker_context"]
            persistent_capsule_path.write_text(
                json.dumps(persistent_capsule, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )

            paused = self.run_cli("status", plan_path, state_path)
            self.assertNotEqual(paused.returncode, 0)

            validation_path = root / "owner-change-validation.json"
            validation = {
                "contract": "OWNER_CHANGE_VALIDATION_V2",
                "status": "passed",
                "request_digest": "a" * 64,
                "base_registry_digest": base_registry_digest,
                "next_registry_digest": next_registry_digest,
                "checks": ["explicit-user-approval"],
                "next_registry": registry,
            }
            validation_path.write_text(
                json.dumps(validation, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            approval_path = root / "owner-change-approval.json"
            approval = {
                "contract": "OWNER_CHANGE_APPROVAL_V2",
                "decision": "approved",
                "approved_by": "user",
                "approved_at": "2026-07-28T02:01:00.000Z",
                "request_digest": validation["request_digest"],
                "validation_digest": hashlib.sha256(validation_path.read_bytes()).hexdigest(),
                "next_registry_digest": next_registry_digest,
            }
            approval_path.write_text(
                json.dumps(approval, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            coverage = json.loads((root / "coverage.json").read_text(encoding="utf-8"))
            delta_path = root / "owner-transition-delta.json"
            delta = {
                "contract": "DAG_DELTA_V1",
                "base_plan_digest": state["plan_digest"],
                "revision": plan["revision"] + 1,
                "add_owners": [],
                "add_tasks": [],
                "repairs": [],
                "source_dispositions": [],
                "owner_transition": {
                    "contract": "OWNER_TRANSITION_V1",
                    "base_registry_digest": base_registry_digest,
                    "next_registry_digest": next_registry_digest,
                    "validation_ref": str(validation_path),
                    "validation_digest": approval["validation_digest"],
                    "approval_ref": str(approval_path),
                    "approval_digest": hashlib.sha256(approval_path.read_bytes()).hexdigest(),
                    "task_rebindings": [],
                },
                "coverage_update": {"required_plan_items": coverage["required_plan_items"]},
                "safety": plan["safety"],
            }
            delta_path.write_text(
                json.dumps(delta, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
            )
            applied = self.run_json("apply-delta", plan_path, state_path, delta_path)
            self.assertEqual(applied["owner_transition"]["registry_revision"], 2)
            current = self.run_json("status", plan_path, state_path)
            self.assertEqual(current["owners"]["state-domain"]["generation"], 2)
            action = self.reserve_one(plan_path, state_path)
            self.assertEqual(action["binding"]["subject"]["context"], changed_owner["worker_context"])

    def test_repository_owner_lease_is_inspectable_and_token_fenced(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            workspace_root = Path(
                json.loads(goal_path.read_text(encoding="utf-8"))["workspace"]["root"]
            )
            owner_id = action["owner_id"]
            inspected = self.run_json("owner-lease-inspect", workspace_root, owner_id)
            self.assertEqual(inspected["status"], "leased")
            self.assertEqual(inspected["lease"]["task_id"], action["task_id"])
            self.assertEqual(inspected["lease"]["state_path"], str(state_path))
            heartbeat = self.run_json(
                "owner-lease-heartbeat", workspace_root, owner_id,
                action["reservation_token"],
            )
            self.assertEqual(heartbeat["status"], "heartbeat_recorded")
            rejected = self.run_cli(
                "owner-lease-recover", workspace_root, owner_id, "wrong-token", "crashed",
            )
            self.assertNotEqual(rejected.returncode, 0)
            recovered = self.run_json(
                "owner-lease-recover", workspace_root, owner_id,
                action["reservation_token"], "confirmed crashed executor",
            )
            self.assertTrue(recovered["recovered"])
            self.assertTrue(Path(recovered["recovery_ref"]).exists())
            self.assertEqual(
                self.run_json("owner-lease-inspect", workspace_root, owner_id)["status"],
                "free",
            )

    def test_finish_automatically_attributes_changes_from_bind_snapshot(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "agent-auto-attribution")
            workspace_root = Path(
                json.loads(goal_path.read_text(encoding="utf-8"))["workspace"]["root"]
            )
            changed_path = workspace_root / "src/state/auto-attributed.ts"
            changed_path.parent.mkdir(parents=True, exist_ok=True)
            changed_path.write_text("runtime owns attribution\n", encoding="utf-8")
            finished = self.finish(
                plan_path, state_path, action, changed_files=[]
            )
            self.assertEqual(finished["changed_files"], ["src/state/auto-attributed.ts"])
            accepted = json.loads(Path(finished["result_ref"]).read_text(encoding="utf-8"))
            self.assertEqual(accepted["changed_files"], ["src/state/auto-attributed.ts"])
            self.assertEqual(finished["workspace_change_seq"], 1)

    def test_same_owner_scope_request_requeues_without_plan_delta(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "agent-scope-expand")
            scope_request = {
                "paths": ["src/page/extra.ts", "tests/fixtures/foreign.ts"],
                "reason": "初始 task write scope 漏项",
                "required_for_done_when": "同步页面读取",
                "suggested_owner": action["owner_id"],
                "split_hints": [],
                "overlap_hints": [],
            }
            finished = self.finish(
                plan_path,
                state_path,
                action,
                status="needs_repair",
                changed_files=[],
                diff_self_check="scope_exception",
                scope_request=scope_request,
            )
            self.assertEqual(finished["status"], "needs_repair")
            foreign = self.run_cli(
                "expand-task-scope", plan_path, state_path, action["task_id"],
                action["reservation_token"], "tests/fixtures/foreign.ts",
            )
            self.assertNotEqual(foreign.returncode, 0)
            expanded = self.run_json(
                "expand-task-scope", plan_path, state_path, action["task_id"],
                action["reservation_token"], "src/page/extra.ts",
            )
            self.assertEqual(expanded["status"], "expanded_and_queued")
            retry = self.reserve_one(plan_path, state_path)
            self.assertEqual(retry["task_id"], action["task_id"])
            self.assertIn("src/page/extra.ts", retry["binding"]["scope"]["write"])

    def test_delivery_manifest_is_revalidated_for_owner_git_controller(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            self.complete_all(plan_path, state_path)
            self.run_json(
                "finalize", goal_path, root / "goal-state.json", plan_path, state_path,
            )
            state = json.loads(state_path.read_text(encoding="utf-8"))
            readiness_ref = state["tasks"]["T10"]["result_ref"]
            readiness = json.loads(Path(readiness_ref).read_text(encoding="utf-8"))
            evidence = next(
                item for item in readiness["evidence"]
                if item["verification_id"] == "commit-readiness"
            )
            audit = json.loads(Path(evidence["artifact_ref"]).read_text(encoding="utf-8"))
            validated = self.run_json("delivery-validate", audit["delivery_manifest_ref"])
            self.assertEqual(validated["status"], "valid")
            manifest = json.loads(
                Path(audit["delivery_manifest_ref"]).read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["commit_strategy"], "single_atomic")
            self.assertEqual(manifest["commit_message"], "chore(workflow): 交付目标变更")
            self.assertEqual(
                {item["commit_message"] for item in manifest["owner_deliveries"]},
                {manifest["commit_message"]},
            )

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
            task_state = json.loads(state_path.read_text(encoding="utf-8"))["tasks"][action["task_id"]]
            proposal = (
                plan_path.parent
                / "artifacts"
                / "source-coverage-audit"
                / action["task_id"]
                / f"attempt-{task_state['attempt']}-{action['reservation_token']}.json"
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
            result_path = Path(
                json.loads(state_path.read_text(encoding="utf-8"))["tasks"]["T9"]["result_path"]
            )
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
            result_path = Path(
                json.loads(state_path.read_text(encoding="utf-8"))["tasks"]["T9"]["result_path"]
            )
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
                    "id": "T13",
                    "logical_id": "state.late-required-work",
                    "title": "补充规划后发现的实现要求",
                    "task": "实现规划后才发现的必需状态行为",
                    "depends_on": ["T0"],
                    "plan_item_ids": ["PI-late-work"],
                    "priority": 25,
                }
            )
            verification = deepcopy(next(task for task in plan["tasks"] if task["id"] == "T4"))
            verification.update(
                {
                    "id": "T14",
                    "logical_id": "state.verify-late-work",
                    "title": "复验补充实现后的完整流程",
                    "depends_on": ["T4", "T13"],
                    "role": "review",
                    "review_policy": "none",
                    "review_batch_key": None,
                    "review_blocks_dependents": False,
                    "review_reasons": [],
                    "reviews_task_ids": ["T13"],
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
                        "add_tasks": [added, verification],
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
            self.assertEqual(state["tasks"]["T13"]["status"], "completed")
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
            self.bind(plan_path, state_path, failed, "runtime-script-source-audit")
            self.finish(plan_path, state_path, failed, status="failed")

            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            replacement = deepcopy(next(task for task in plan["tasks"] if task["id"] == "T0"))
            replacement.update(
                {
                    "id": "T11",
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
                        "repairs": [{"task_id": "T0", "replacement_task_id": "T11"}],
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
            self.assertEqual(action["task_id"], "T11")
            self.run_json(
                "runtime-execute",
                plan_path,
                state_path,
                action["task_id"],
                action["reservation_token"],
            )
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
                {"id": "T11", "logical_id": "coverage.audit-source-r3", "title": "审计第三版计划源"}
            )
            diff_audit = deepcopy(next(task for task in plan["tasks"] if task["id"] == "T9"))
            diff_audit.update(
                {
                    "id": "T12",
                    "logical_id": "scope.audit-final-diff-r3",
                    "title": "审计第三版最终差异",
                    "depends_on": ["T4", "T11"],
                }
            )
            readiness = deepcopy(next(task for task in plan["tasks"] if task["id"] == "T10"))
            readiness.update(
                {
                    "id": "T13",
                    "logical_id": "delivery.commit-readiness-r3",
                    "title": "审计第三版提交就绪",
                    "depends_on": ["T12"],
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
                        "add_tasks": [source_audit, diff_audit, readiness],
                        "repairs": [],
                        "source_dispositions": [
                            {
                                "task_id": task["id"],
                                "action": "invalidate" if task["id"] in {"T0", "T9", "T10"} else "carry_forward",
                                "replacement_task_id": (
                                    "T11" if task["id"] == "T0"
                                    else "T12" if task["id"] == "T9"
                                    else "T13" if task["id"] == "T10"
                                    else None
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
                    "review_policy": "none",
                    "review_batch_key": None,
                    "review_reasons": [],
                }
            )
            fixture_work = deepcopy(by_id["T3"])
            fixture_work.update(
                {
                    "id": "N2",
                    "logical_id": "fixtures.linear-update",
                    "title": "顺序重做夹具",
                    "depends_on": ["N1"],
                    "review_policy": "none",
                    "review_batch_key": None,
                    "review_reasons": [],
                }
            )
            verification = deepcopy(by_id["T4"])
            verification.update(
                {"id": "N3", "logical_id": "flow.linear-verification", "title": "顺序重做验证", "depends_on": ["N2"]}
            )
            diff_audit = deepcopy(by_id["T9"])
            diff_audit.update(
                {"id": "N4", "logical_id": "scope.linear-final-diff", "title": "顺序最终差异审计", "depends_on": ["N3"]}
            )
            readiness = deepcopy(by_id["T10"])
            readiness.update(
                {"id": "N5", "logical_id": "delivery.linear-readiness", "title": "顺序提交就绪", "depends_on": ["N4"]}
            )
            replacements = {
                "T0": "N0", "T1": "N1", "T2": "N1",
                "T3": "N2", "T4": "N3", "T5": "N3", "T6": "N2",
                "T9": "N4", "T10": "N5",
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
                        "add_tasks": [source_audit, state_work, fixture_work, verification, diff_audit, readiness],
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
                    "review_policy": "none",
                    "review_batch_key": None,
                    "review_reasons": [],
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
            readiness = deepcopy(by_id["T10"])
            readiness.update(
                {
                    "id": "C10",
                    "logical_id": "delivery.commit-readiness-without-fixtures",
                    "title": "检查删除要求后的提交就绪状态",
                    "depends_on": ["D9"],
                }
            )
            fixture_review = deepcopy(by_id["T6"])
            fixture_review.update(
                {
                    "id": "R6",
                    "logical_id": "state.review-obsolete-fixture-cleanup",
                    "title": "审查已删除夹具要求的清理",
                    "depends_on": ["R3"],
                    "reviews_task_ids": ["R3"],
                    "plan_item_ids": ["PI-state-types"],
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
                replacements = {
                    "T0": "S0", "T3": "R3", "T6": "R6", "T9": "D9", "T10": "C10"
                }
                return {
                    "contract": "DAG_DELTA_V1",
                    "base_plan_digest": hashlib.sha256(plan_path.read_bytes()).hexdigest(),
                    "revision": 2,
                    "add_owners": [],
                    "add_tasks": [
                        source_audit, fixture_replacement, fixture_review, diff_audit, readiness
                    ],
                    "repairs": [],
                    "source_dispositions": [
                        {
                            "task_id": task["id"],
                            "action": (
                                action if task["id"] in {"T3", "T6"}
                                else "invalidate" if task["id"] in replacements
                                else "carry_forward"
                            ),
                            "replacement_task_id": (
                                None if task["id"] in {"T3", "T6"} and action == "carry_forward"
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
                {"id": "T12", "logical_id": "scope.audit-duplicate", "title": "重复最终差异审计"}
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
            self.assertIn("exactly one diff-scope-audit", rejected.stderr)

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
            self.assertEqual(recovered[0]["action"], "create_thread")
            self.assertEqual(recovered[0]["phase"], "reserved_unbound")
            self.assertEqual(recovered[0]["binding"], reserved["binding"])
            self.assertEqual(recovered[0]["thread_key"], reserved["thread_key"])

            self.bind(plan_path, state_path, reserved, "agent-state")
            self.finish(plan_path, state_path, reserved)
            reused = self.reserve_one(plan_path, state_path)
            self.assertEqual(reused["action"], "reuse_thread")
            self.bind(plan_path, state_path, reused, "agent-state")
            running = self.run_json("status", plan_path, state_path)["active_reservations"]
            self.assertEqual(len(running), 1)
            self.assertEqual(running[0]["action"], "wait_or_redeliver")
            self.assertEqual(running[0]["phase"], "running_bound")
            self.assertEqual(running[0]["executor_id"], "agent-state")
            self.assertIsNone(reused["binding"]["run"]["executor"])
            self.assertEqual(running[0]["binding"]["run"]["executor"], "agent-state")
            expected_binding = deepcopy(reused["binding"])
            expected_binding["run"]["executor"] = "agent-state"
            self.assertEqual(running[0]["binding"], expected_binding)

    def test_reserved_reuse_loss_detaches_executor_into_stale_ledger(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            first = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, first, "agent-state")
            self.finish(plan_path, state_path, first)
            reused = self.reserve_one(plan_path, state_path)
            self.assertEqual(reused["action"], "reuse_thread")
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
            self.assertEqual(retried["action"], "create_thread")
            self.assertEqual(retried["owner_generation"], 1)

    def test_completed_result_rejects_blockers_and_unpaired_artifact_evidence(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "agent-state")
            result = self.result_for(plan_path, state_path, action["task_id"])
            result["blocking_findings"] = ["仍有阻断问题"]
            result_path = Path(action["binding"]["refs"]["result"])
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
            result_path = Path(action["binding"]["refs"]["result"])
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

    def test_dashboard_snapshot_is_sanitized_and_reports_live_progress(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "agent-dashboard")
            payload = self.run_json("dashboard-snapshot", plan_path, state_path)
            self.assertEqual(payload["contract"], "DAG_DASHBOARD_SNAPSHOT_V1")
            self.assertEqual(payload["progress"]["summary"]["running"], 1)
            task = next(item for item in payload["tasks"] if item["id"] == action["task_id"])
            self.assertEqual(task["phase"], "running")
            self.assertEqual(task["subject"]["id"], action["execution_subject_id"])
            self.assertTrue(payload["edges"])
            serialized = json.dumps(payload)
            for private_field in (
                "reservation_token", "executor_id", "result_path", "binding", "capsule_ref"
            ):
                self.assertNotIn(private_field, serialized)

    def test_fixed_progress_document_tracks_every_accepted_task_result(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            progress_path = plan_path.parent / "progress.json"
            self.assertTrue(progress_path.is_file())
            initial = json.loads(progress_path.read_text(encoding="utf-8"))
            self.assertEqual(initial["contract"], "DAG_PROGRESS_DOCUMENT_V1")
            self.assertEqual(initial["snapshot"]["plan"]["revision"], 1)
            self.assertIn("T0", {item["task_id"] for item in initial["task_results"]})
            self.assertNotIn("events", initial)
            self.assertEqual(initial["event_stream"]["path"], "events.jsonl")
            initial_revision = initial["document_revision"]

            action = self.reserve_one(plan_path, state_path)
            self.bind(plan_path, state_path, action, "agent-progress-document")
            self.finish(plan_path, state_path, action)
            updated = json.loads(progress_path.read_text(encoding="utf-8"))
            self.assertGreater(updated["document_revision"], initial_revision)
            task_results = {item["task_id"]: item for item in updated["task_results"]}
            self.assertEqual(task_results[action["task_id"]]["status"], "completed")
            self.assertTrue(any(
                event["contract"] == "DAG_PROGRESS_EVENT_V1"
                and event["type"] == "task_result_updated"
                and event["task_id"] == action["task_id"]
                for event in self.read_progress_events(plan_path)
            ))
            task_statuses = [
                event["status"]
                for event in self.read_progress_events(plan_path)
                if event["type"] == "task_status_updated"
                and event["task_id"] == action["task_id"]
            ]
            self.assertEqual(task_statuses[-3:], ["reserved", "running", "completed"])
            serialized = json.dumps(updated)
            for private_field in (
                "reservation_token", "executor_id", "result_path", "binding", "capsule_ref"
            ):
                self.assertNotIn(private_field, serialized)
            current = self.run_json("progress-document", plan_path, state_path)
            self.assertEqual(current["status"], "current")
            self.assertEqual(Path(current["document_path"]), progress_path)
            self.assertEqual(Path(current["events_path"]), plan_path.with_name("events.jsonl"))

    def test_active_task_can_expand_into_nested_dag_with_composite_boundary(self) -> None:
        with self.workspace() as (root, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            initial_actions = self.run_json("reserve", plan_path, state_path, 3)["actions"]
            self.assertEqual({action["task_id"] for action in initial_actions}, {"T1", "T3"})
            for action in initial_actions:
                self.bind(plan_path, state_path, action, f"agent-{self.action_subject_id(action)}")
                self.finish(plan_path, state_path, action)

            parent_action = self.reserve_one(plan_path, state_path)
            self.assertEqual(parent_action["task_id"], "T2")
            self.bind(plan_path, state_path, parent_action, "agent-state-domain")
            plan = json.loads(plan_path.read_text(encoding="utf-8"))
            state = json.loads(state_path.read_text(encoding="utf-8"))
            parent = next(task for task in plan["tasks"] if task["id"] == "T2")
            expansion_reason = "运行中发现页面迁移需要先建立适配层，再并行迁移读写并收口"
            request_path = Path(parent_action["binding"]["refs"]["subgraph_request"])
            request_receipt = self.run_json(
                "subgraph-request", plan_path, state_path, "T2",
                parent_action["reservation_token"], expansion_reason,
                "建立适配层", "迁移读取", "迁移写入", "收口验证",
            )
            self.assertEqual(request_receipt["contract"], "TASK_SUBGRAPH_REQUEST_RECEIPT_V1")
            self.assertEqual(
                request_receipt["thread_title"],
                "[GA][任务][子图规划] 迁移页面状态读取",
            )
            self.assertEqual(Path(request_receipt["request_ref"]), request_path)
            reconciled = self.run_json("reconcile", plan_path, state_path)
            self.assertEqual(reconciled["next_action"], "expand_subgraph")
            self.assertEqual(
                reconciled["subgraph_requests"],
                [{
                    "task_id": "T2",
                    "reservation_token": parent_action["reservation_token"],
                    "request_ref": str(request_path),
                    "request_digest": hashlib.sha256(request_path.read_bytes()).hexdigest(),
                }],
            )

            def child(task_id: str, title: str, depends_on: list[str]) -> dict:
                return {
                    "id": task_id,
                    "title": title,
                    "work": f"执行 {title}",
                    "after": depends_on,
                    "write": parent["writable_paths"],
                    "done": parent["done_when"],
                    "verify": parent["verification_ids"],
                    "items": parent["plan_item_ids"],
                }

            expansion = {
                "contract": "TASK_SUBGRAPH_INPUT_V1",
                "children": [
                    child("T2-1", "建立页面状态适配层", []),
                    child("T2-2", "迁移页面状态读取", ["T2-1"]),
                    child("T2-3", "迁移页面状态写入", ["T2-1"]),
                    child("T2-4", "收口页面状态迁移", ["T2-2", "T2-3"]),
                ],
                "entry": ["T2-1"],
                "exit": ["T2-4"],
            }
            payload = self.run_json_input(
                expansion,
                "expand-subgraph",
                plan_path,
                state_path,
                "T2",
                parent_action["reservation_token"],
                "-",
            )
            self.assertEqual(payload["status"], "expanded")
            self.assertEqual(payload["child_task_ids"], ["T2-1", "T2-2", "T2-3", "T2-4"])

            expanded_plan = json.loads(plan_path.read_text(encoding="utf-8"))
            expanded_state = json.loads(state_path.read_text(encoding="utf-8"))
            expanded_parent = next(task for task in expanded_plan["tasks"] if task["id"] == "T2")
            self.assertEqual(expanded_parent["node_type"], "composite")
            self.assertEqual(expanded_parent["subgraph"]["entry_task_ids"], ["T2-1"])
            self.assertEqual(expanded_parent["subgraph"]["exit_task_ids"], ["T2-4"])
            self.assertEqual(expanded_state["tasks"]["T2"]["status"], "pending")
            self.assertIsNone(expanded_state["tasks"]["T2"]["reservation_token"])
            self.assertEqual(
                next(task for task in expanded_plan["tasks"] if task["id"] == "T4")["depends_on"],
                ["T2", "T3"],
            )

            expected_order = ["T2-1", "T2-2", "T2-3", "T2-4"]
            for expected_task_id in expected_order:
                action = self.reserve_one(plan_path, state_path)
                self.assertEqual(action["task_id"], expected_task_id)
                self.bind(plan_path, state_path, action, "agent-state-domain")
                self.finish(plan_path, state_path, action)

            snapshot = self.run_json("dashboard-snapshot", plan_path, state_path)
            parent_snapshot = next(task for task in snapshot["tasks"] if task["id"] == "T2")
            self.assertEqual(parent_snapshot["status"], "completed")
            self.assertEqual(parent_snapshot["phase"], "completed")
            self.assertEqual(parent_snapshot["node_type"], "composite")
            self.assertEqual(parent_snapshot["subgraph"]["task_ids"], expected_order)
            self.assertTrue(any(edge["kind"] == "internal" for edge in snapshot["edges"]))
            self.assertTrue(any(edge["kind"] == "containment" for edge in snapshot["edges"]))
            self.assertEqual(snapshot["progress"]["top_level"]["completed"], 4)

            next_action = self.reserve_one(plan_path, state_path)
            self.assertEqual(next_action["task_id"], "T4")
            progress = self.run_json("progress-document", plan_path, state_path)
            expansion_events = [
                event for event in self.read_progress_events(plan_path)
                if event["type"] == "subgraph_expanded"
            ]
            self.assertEqual(len(expansion_events), 1)
            self.assertEqual(expansion_events[0]["parent_task_id"], "T2")

    def test_dashboard_serves_html_and_snapshot_on_loopback(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            environment = os.environ.copy()
            environment["GOAL_DAG_EXECUTION_PLATFORM"] = "codex"
            process = subprocess.Popen(
                [
                    "node", str(CODEX_SCRIPT), "dashboard", str(plan_path), str(state_path),
                    "--port", "0",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=environment,
            )
            try:
                selector = selectors.DefaultSelector()
                assert process.stdout is not None
                selector.register(process.stdout, selectors.EVENT_READ)
                self.assertTrue(selector.select(timeout=5), "dashboard did not report its URL")
                line = process.stdout.readline()
                if not line:
                    assert process.stderr is not None
                    self.fail(f"dashboard exited before reporting its URL: {process.stderr.read()}")
                serving = json.loads(line)
                self.assertEqual(serving["status"], "serving")
                self.assertTrue(serving["read_only"])
                with urlopen(serving["url"], timeout=5) as response:
                    html = response.read().decode("utf-8")
                    self.assertIn("Goal DAG 进度", html)
                    self.assertEqual(response.headers["X-Frame-Options"], "DENY")
                with urlopen(f'{serving["url"]}api/snapshot', timeout=5) as response:
                    payload = json.loads(response.read())
                    self.assertEqual(payload["contract"], "DAG_DASHBOARD_SNAPSHOT_V1")
                with urlopen(f'{serving["url"]}api/live', timeout=5) as response:
                    self.assertEqual(
                        response.headers.get_content_type(), "text/event-stream"
                    )

                    def read_snapshot_event() -> dict:
                        event = ""
                        data = ""
                        while True:
                            line = response.readline().decode("utf-8").rstrip("\r\n")
                            if not line:
                                if event == "snapshot" and data:
                                    return json.loads(data)
                                event = ""
                                data = ""
                                continue
                            if line.startswith("event: "):
                                event = line.removeprefix("event: ")
                            elif line.startswith("data: "):
                                data = line.removeprefix("data: ")

                    initial_live = read_snapshot_event()
                    self.assertEqual(
                        initial_live["contract"], "DAG_DASHBOARD_SNAPSHOT_V1"
                    )
                    self.reserve_one(plan_path, state_path)
                    pushed_live = read_snapshot_event()
                    self.assertEqual(
                        pushed_live["contract"], "DAG_DASHBOARD_SNAPSHOT_V1"
                    )
                with urlopen(f'{serving["url"]}api/progress-document', timeout=5) as response:
                    progress = json.loads(response.read())
                    self.assertEqual(progress["contract"], "DAG_PROGRESS_DOCUMENT_V1")
                    self.assertNotIn("events", progress)
                    self.assertEqual(
                        Path(serving["progress_document_path"]),
                        plan_path.parent / "progress.json",
                    )
                with urlopen(
                    f'{serving["url"]}api/progress-events?after=0&limit=1', timeout=5
                ) as response:
                    event_page = json.loads(response.read())
                    self.assertEqual(event_page["contract"], "DAG_PROGRESS_EVENT_PAGE_V1")
                    self.assertLessEqual(len(event_page["events"]), 1)
                    self.assertEqual(
                        Path(serving["progress_events_path"]),
                        plan_path.parent / "events.jsonl",
                    )
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                if process.stdout is not None:
                    process.stdout.close()
                if process.stderr is not None:
                    process.stderr.close()

    def test_dashboard_rejects_remote_bind_without_explicit_opt_in(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            rejected = self.run_cli(
                "dashboard", plan_path, state_path, "--host", "0.0.0.0", "--port", "0"
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("requires --allow-remote", rejected.stderr)

    def test_node_launcher_discovers_workspace_and_starts_dashboard_idempotently(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path)
            workspace_root = Path(
                json.loads(goal_path.read_text(encoding="utf-8"))["workspace"]["root"]
            )
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
                listener.bind(("127.0.0.1", 0))
                port = listener.getsockname()[1]
            pid = None
            cleanup_paths: list[Path] = []
            try:
                command = [
                    "node",
                    str(CODEX_DASHBOARD_STARTER),
                    str(workspace_root),
                    "--port",
                    str(port),
                ]
                first = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=15,
                )
                self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
                started = json.loads(first.stdout)
                self.assertEqual(started["contract"], "DAG_DASHBOARD_START_V1")
                self.assertEqual(started["status"], "started")
                self.assertTrue(started["read_only"])
                self.assertEqual(started["workspace_root"], str(workspace_root))
                self.assertEqual(started["goal_id"], "refactor-page-state")
                self.assertEqual(started["live_updates_url"], f'{started["url"]}api/live')
                pid = started["pid"]
                self.assertEqual(
                    Path(started["progress_document_path"]),
                    plan_path.parent / "progress.json",
                )
                self.assertTrue(Path(started["progress_document_path"]).is_file())
                self.assertEqual(
                    Path(started["progress_events_path"]),
                    plan_path.parent / "events.jsonl",
                )
                self.assertTrue(Path(started["progress_events_path"]).is_file())
                cleanup_paths = [
                    Path(started["descriptor_path"]),
                    Path(started["log_path"]),
                ]
                with urlopen(started["url"], timeout=5) as response:
                    self.assertIn("Goal DAG 进度", response.read().decode("utf-8"))

                second = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=15,
                )
                self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
                already_running = json.loads(second.stdout)
                self.assertEqual(already_running["status"], "already_running")
                self.assertEqual(already_running["pid"], pid)
            finally:
                if isinstance(pid, int):
                    try:
                        os.kill(pid, 15)
                    except ProcessLookupError:
                        pass
                for path in cleanup_paths:
                    path.unlink(missing_ok=True)

    def test_claude_driver_uses_default_runtime_profiles(self) -> None:
        with self.workspace("claude_code") as (_, goal_path, plan_path):
            state_path = self.initialize(goal_path, plan_path, script=CLAUDE_SCRIPT)
            payload = self.run_json("reserve", plan_path, state_path, 1, script=CLAUDE_SCRIPT)
            self.assertEqual(
                payload["actions"][0]["binding"]["thread"]["profile"],
                {"model": "gpt-5.6-sol", "reasoning_effort": "high"},
            )

    def test_runtime_binding_uses_script_managed_owner_profile(self) -> None:
        with self.workspace("claude_code") as (_, goal_path, plan_path):
            goal = json.loads(goal_path.read_text(encoding="utf-8"))
            configured = subprocess.run(
                [
                    "node",
                    str(WORKFLOW_CONFIG_SCRIPT),
                    "set-profile",
                    goal["workspace"]["root"],
                    "owner",
                    "gpt-5.6-sol",
                    "xhigh",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(configured.returncode, 0, configured.stderr)
            state_path = self.initialize(goal_path, plan_path, script=CLAUDE_SCRIPT)
            payload = self.run_json("reserve", plan_path, state_path, 1, script=CLAUDE_SCRIPT)
            self.assertEqual(
                payload["actions"][0]["binding"]["thread"]["profile"],
                {"model": "gpt-5.6-sol", "reasoning_effort": "xhigh"},
            )

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
  kimi: template.replaceAll("__EXECUTION_PLATFORM__", "kimi"),
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
        self.assertEqual(expected["kimi"], KIMI_SCRIPT.read_text(encoding="utf-8"))
        starter = DASHBOARD_STARTER_SOURCE.read_text(encoding="utf-8")
        self.assertEqual(starter, CODEX_DASHBOARD_STARTER.read_text(encoding="utf-8"))
        self.assertEqual(starter, CLAUDE_DASHBOARD_STARTER.read_text(encoding="utf-8"))
        self.assertEqual(starter, KIMI_DASHBOARD_STARTER.read_text(encoding="utf-8"))
        dashboard = DASHBOARD_SOURCE.read_text(encoding="utf-8")
        self.assertIn('new EventSource("/api/live")', dashboard)
        self.assertNotIn("setInterval(refresh", dashboard)
        self.assertEqual(
            dashboard,
            (ROOT / "codex-market/plugins/ghost-agent-workflow/assets/goal-dag-dashboard.html")
            .read_text(encoding="utf-8"),
        )
        self.assertEqual(
            dashboard,
            (ROOT / "claude-code-market/assets/goal-dag-dashboard.html")
            .read_text(encoding="utf-8"),
        )
        self.assertEqual(
            dashboard,
            (ROOT / "kimi-market/plugins/ghost-agent-workflow/assets/goal-dag-dashboard.html")
            .read_text(encoding="utf-8"),
        )


if __name__ == "__main__":
    unittest.main()
