import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "claude-code-market"
SKILLS = (
    "git-commit",
    "owner-registry",
    "parallel-task-planner",
    "subagent-coordination",
    "subagent-goal-worker",
)
OWNER_SKILLS = (
    "owner-registry",
    "parallel-task-planner",
    "subagent-coordination",
    "subagent-goal-worker",
)


class ClaudePluginContractTests(unittest.TestCase):
    def skill(self, name: str) -> str:
        return (PLUGIN / "skills" / name / "SKILL.md").read_text(encoding="utf-8")

    def test_manifest_versions_and_skill_inventory_match(self) -> None:
        plugin = json.loads((PLUGIN / ".claude-plugin/plugin.json").read_text(encoding="utf-8"))
        marketplace = json.loads(
            (PLUGIN / ".claude-plugin/marketplace.json").read_text(encoding="utf-8")
        )
        entry = marketplace["plugins"][0]
        self.assertEqual(plugin["name"], entry["name"])
        self.assertEqual(plugin["version"], entry["version"])
        self.assertEqual(plugin["version"], "0.5.0")
        actual = sorted(
            path.name
            for path in (PLUGIN / "skills").iterdir()
            if path.is_dir() and (path / "SKILL.md").is_file()
        )
        self.assertEqual(actual, sorted(SKILLS))
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        self.assertIn("包含五个 skill", readme)
        for name in SKILLS:
            self.assertIn(f"`{name}`", readme)

    def test_owner_acl_hook_is_wired_for_all_mutating_tools_and_bash(self) -> None:
        hooks = json.loads((PLUGIN / "hooks/hooks.json").read_text(encoding="utf-8"))
        entries = hooks["hooks"]["PreToolUse"]
        owner = next(
            item
            for item in entries
            if any("owner-acl-hook.py" in hook["command"] for hook in item["hooks"])
        )
        self.assertEqual(
            set(owner["matcher"].split("|")),
            {"Edit", "Write", "MultiEdit", "NotebookEdit", "Bash"},
        )
        command = owner["hooks"][0]["command"]
        self.assertIn("${CLAUDE_PLUGIN_ROOT}/hooks/scripts/owner-acl-hook.py", command)

    def test_claude_owner_host_adapter_contract(self) -> None:
        adapter = (PLUGIN / "scripts/claude-owner-host.py").read_text(encoding="utf-8")
        self.assertIn('HOST_VERSION_VALIDATED = "2.1.220"', adapter)
        self.assertIn('REAL_SMOKE_ENV = "GHOST_AGENT_REAL_HOST_SMOKE"', adapter)
        self.assertIn('"kind": "claude_owner_host_capability"', adapter)
        self.assertIn('"mode": "worktree_local_controller"', adapter)
        self.assertIn('else "direct_probe"', adapter)
        self.assertIn('"--worktree"', adapter)  # rejection guard, never child argv
        self.assertIn('cwd=worktree', adapter)

    def test_owner_hook_provenance_contract(self) -> None:
        hook = (PLUGIN / "hooks/scripts/owner-acl-hook.py").read_text(encoding="utf-8")
        self.assertIn('PROVENANCE_ENV = "GHOST_AGENT_HOOK_PROVENANCE"', hook)
        self.assertIn('"kind": "claude_hook_provenance"', hook)
        self.assertIn('"sha256_12"', hook)
        for outcome in ('"passed"', '"failed"', '"unsupported"'):
            self.assertIn(outcome, hook)

    def test_claude_skill_md_is_the_only_contract_source(self) -> None:
        references = sorted((PLUGIN / "skills").glob("*/references/*.md"))
        self.assertTrue(references)
        forbidden = re.compile(r"```json|^## (?:OWNERS_|GOAL_|TASK_|PLAN_|DAG_)", re.MULTILINE)
        for path in references:
            text = path.read_text(encoding="utf-8")
            self.assertIn("已弃用", text, str(path))
            self.assertIn("SKILL.md", text, str(path))
            self.assertIsNone(forbidden.search(text), str(path))
        for name in OWNER_SKILLS:
            text = self.skill(name)
            self.assertIn("## 契约与模板", text, name)
            self.assertIn("已内联", text, name)

    def test_owner_delivery_contract_is_consistent_across_skills(self) -> None:
        per_skill_requirements = {
            "owner-registry": (
                "--confirm <proposal_digest>", "不能证明 AskUserQuestion", "owner-bind-goal",
                "worktree-commit", "owner-delivery-reconcile", "owner-delivery-recover",
                "OWNER_GIT_INTENT_V1", "visibility superset",
                "tombstone", "depends_on_owners",
            ),
            "parallel-task-planner": (
                "--confirm <proposal_digest>", "不能证明 AskUserQuestion", "depends_on_owners",
            ),
            "subagent-coordination": (
                "owner-bind-goal", "worktree-commit", "owner-delivery-reconcile",
                "owner-delivery-recover", "claude-owner-host.py",
                "owner_commit_pending", "owner_merge_pending", "owner_exec", "Bash",
            ),
            "subagent-goal-worker": ("owner_exec", "Bash", "owner-<owner_id>"),
        }
        for name, requirements in per_skill_requirements.items():
            text = self.skill(name)
            for requirement in requirements:
                self.assertIn(requirement, text, f"{name}: {requirement}")
            self.assertNotIn("isolation: worktree", text, name)
            self.assertNotIn("isolation:worktree", text, name)
        worker = self.skill("subagent-goal-worker")
        self.assertIn('"agent_type": "owner-runtime-core"', worker)
        self.assertIn('"owner_branch": "owner_runtime-core_', worker)

    def test_archival_policy_does_not_ignore_owner_truth(self) -> None:
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        self.assertIn("owners/registry.json", readme)
        self.assertIn("memory.md", readme)
        self.assertIn("requirements/", readme)
        self.assertIn("runtime worktrees", readme)
        self.assertIn("runtime transaction", readme)
        self.assertIn("OWNER_GIT_INTENT_V1", readme)
        self.assertIn("owner-delivery-recover", readme)
        self.assertNotIn("没有完整 crash-intent journal", readme)
        self.assertNotIn("`.ghost-agent-workflow/` 是本地 runtime state，不应提交", readme)

    def test_git_commit_keeps_fixed_nexus_trailer(self) -> None:
        skill = self.skill("git-commit")
        trailer = "Co-Authored-By: Nexus <nexus@xfinite.global>"
        self.assertEqual(skill.count(trailer), 1)


if __name__ == "__main__":
    unittest.main()
