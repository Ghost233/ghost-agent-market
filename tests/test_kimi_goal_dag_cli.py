from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
KIMI_SCRIPT = ROOT / "kimi-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs"
FIXTURES = ROOT / "tests/fixtures/goal-dag"
PLATFORM = "kimi"


class KimiGoalDagCliTests(unittest.TestCase):
    @contextmanager
    def workspace(self):
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
            goal["execution_platform"] = PLATFORM
            goal["workspace"] = {"root": str(workspace_root)}
            goal["source"] = {
                "path": str(document),
                "digest": hashlib.sha256(document.read_bytes()).hexdigest(),
                "revision": 1,
            }
            goal["lifecycle"]["controller"] = "local_fallback"
            goal["lifecycle"]["native_goal"] = None
            goal_path = root / "goal.json"
            goal_path.write_text(json.dumps(goal, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

            plan = json.loads((FIXTURES / "plan.json").read_text(encoding="utf-8"))
            plan["execution_platform"] = PLATFORM
            plan["goal_contract_path"] = str(goal_path)
            plan["goal_digest"] = hashlib.sha256(goal_path.read_bytes()).hexdigest()
            plan["plan_source"] = dict(goal["source"])
            plan["coverage_path"] = str(root / "coverage.json")
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

    def run_cli(self, *args: object) -> subprocess.CompletedProcess:
        environment = os.environ.copy()
        environment["GOAL_DAG_EXECUTION_PLATFORM"] = PLATFORM
        return subprocess.run(
            ["node", str(KIMI_SCRIPT), *(str(arg) for arg in args)],
            capture_output=True,
            text=True,
            check=False,
            env=environment,
        )

    def run_json(self, *args: object) -> dict:
        result = self.run_cli(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_goal_validate_and_status_return_kimi_continuation(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            expected = f"/skill:subagent-coordination 继续 `{goal_path}`。"
            payload = self.run_json("goal-validate", goal_path)
            self.assertEqual(payload["continuation_prompt"], expected)
            validated = self.run_json("validate", plan_path)
            state_path = validated["state_path"]
            status = self.run_json("status", plan_path, state_path)
            self.assertEqual(status["continuation_prompt"], expected)
            self.assertIn("next_action", status)
            self.assertIn("summary", status)

    def test_render_is_read_only_and_deterministic(self) -> None:
        with self.workspace() as (_, _, plan_path):
            first = self.run_cli("render", plan_path)
            second = self.run_cli("render", plan_path)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(first.stdout.split("\n", 1)[1], second.stdout.split("\n", 1)[1])
            self.assertRegex(
                first.stdout.splitlines()[0],
                r"^%% goal-dag plan_digest=[0-9a-f]{64} revision=1 safety\.status=parallel_safe$",
            )
            self.assertFalse(plan_path.with_name("state.json").exists())

    def test_reserve_binds_null_runtime_profile(self) -> None:
        with self.workspace() as (_, goal_path, plan_path):
            self.run_json("goal-validate", goal_path)
            validated = self.run_json("validate", plan_path)
            payload = self.run_json("reserve", plan_path, validated["state_path"], 1)
            self.assertEqual(len(payload["actions"]), 1, payload)
            self.assertIsNone(payload["actions"][0]["binding"]["runtime_profile"])

    def test_codex_platform_goal_is_rejected(self) -> None:
        with self.workspace() as (_, goal_path, _):
            goal = json.loads(goal_path.read_text(encoding="utf-8"))
            goal["execution_platform"] = "codex"
            goal_path.write_text(json.dumps(goal), encoding="utf-8")
            rejected = self.run_cli("goal-validate", goal_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("execution_platform must equal kimi", rejected.stderr)

    def test_local_fallback_controller_and_null_native_goal_are_enforced(self) -> None:
        with self.workspace() as (_, goal_path, _):
            goal = json.loads(goal_path.read_text(encoding="utf-8"))
            goal["lifecycle"]["controller"] = "codex_native"
            goal_path.write_text(json.dumps(goal), encoding="utf-8")
            rejected = self.run_cli("goal-validate", goal_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn(
                "kimi execution platform requires local_fallback controller",
                rejected.stderr,
            )

        with self.workspace() as (_, goal_path, _):
            goal = json.loads(goal_path.read_text(encoding="utf-8"))
            goal["lifecycle"]["native_goal"] = {
                "thread_id": "thread-fixture",
                "created_at": 1784390400000,
            }
            goal_path.write_text(json.dumps(goal), encoding="utf-8")
            rejected = self.run_cli("goal-validate", goal_path)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn(
                "kimi goal lifecycle.native_goal must be null",
                rejected.stderr,
            )


if __name__ == "__main__":
    unittest.main()
