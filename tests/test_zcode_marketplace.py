from __future__ import annotations

import json
import importlib.util
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
MARKETPLACE = ROOT / "marketplace.json"
EXPECTED_SKILLS = {
    "ghost-agent-workflow": {
        "parallel-task-planner",
        "planner-reviewer",
        "setup-sub-thread-workflow",
        "start-dag-dashboard",
        "sub-thread-coordination",
        "sub-thread-goal-worker",
    },
    "ghost-agent-skills": {"git-commit", "git-merge-conflict"},
}
EXPECTED_AGENTS = {
    "ghost-agent-workflow": {
        "parallel-task-planner",
        "planner-reviewer",
        "setup-sub-thread-workflow",
        "start-dag-dashboard",
        "sub-thread-coordination",
        "sub-thread-goal-worker",
    },
    "ghost-agent-skills": {"git-commit", "git-merge-conflict"},
}
EXPECTED_PLUGINS = {
    "ghost-agent-workflow",
    "ghost-agent-skills",
    "rtk-hook",
}
FORBIDDEN_ZCODE_TEXT = (
    "sub-thread-task-supervisor",
    "parallel-supervisor",
    "supervisor",
    "subagent",
    "spawn_agent",
    "create_thread",
    "fork_thread",
    "wait_threads",
    "send_message_to_thread",
    "read_thread",
    "disable-model-invocation",
    "require_escalated",
    "Codex",
    "Claude",
)
RUNTIME_FILES = {
    "scripts/goal-dag.mjs",
    "scripts/owner-registry.mjs",
    "scripts/start-dashboard.mjs",
    "scripts/workflow-config.mjs",
    "assets/goal-dag-dashboard.html",
}


def frontmatter(text: str) -> dict[str, str]:
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise AssertionError("missing YAML frontmatter")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise AssertionError("unterminated YAML frontmatter") from exc
    result: dict[str, str] = {}
    for line in lines[1:end]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition(":")
        if not separator or key != key.strip():
            raise AssertionError(f"invalid frontmatter line: {line}")
        result[key] = value.strip()
    return result


def referenced_files(skill_path: Path) -> set[Path]:
    references = set()
    for value in re.findall(r"\]\((references/[^)]+)\)", skill_path.read_text(encoding="utf-8")):
        references.add(skill_path.parent / value)
    return references


class ZCodeMarketplaceTests(unittest.TestCase):
    def test_agent_installer_self_test(self) -> None:
        script = ROOT / "zcode-market/install-agents.py"
        result = subprocess.run(
            [sys.executable, str(script), "--self-test"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rtk_hook_script_self_test(self) -> None:
        script = ROOT / "zcode-market/plugins/rtk-hook/scripts/rtk-zcode-hook.py"
        result = subprocess.run(
            [sys.executable, str(script), "--self-test"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_marketplace_points_to_zcode_compatible_plugins(self) -> None:
        manifest = json.loads(MARKETPLACE.read_text(encoding="utf-8"))

        self.assertEqual(manifest["name"], "ghost-agent-market")
        self.assertNotIn("pluginRoot", manifest)
        self.assertEqual(
            {entry["name"] for entry in manifest["plugins"]},
            EXPECTED_PLUGINS,
        )

        for entry in manifest["plugins"]:
            plugin_root = ROOT / entry["source"]
            self.assertTrue(plugin_root.is_dir(), entry["source"])
            self.assertTrue(
                (plugin_root / ".zcode-plugin/plugin.json").is_file(),
                entry["source"],
            )
            plugin_manifest = json.loads(
                (plugin_root / ".zcode-plugin/plugin.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(plugin_manifest["name"], entry["name"])
            self.assertEqual(plugin_manifest["version"], entry["version"])
            if entry["name"] == "rtk-hook":
                self.assertNotIn("skills", plugin_manifest)
                self.assertNotIn("agents", plugin_manifest)
                hook_path = plugin_root / "hooks/hooks.json"
                self.assertTrue(hook_path.is_file())
                hook_manifest = json.loads(hook_path.read_text(encoding="utf-8"))
                self.assertEqual(
                    list(hook_manifest["hooks"]),
                    ["PreToolUse"],
                )
                hook_entry = hook_manifest["hooks"]["PreToolUse"][0]
                self.assertEqual(hook_entry["matcher"], "Bash")
                hook = hook_entry["hooks"][0]
                self.assertEqual(hook["type"], "process")
                self.assertEqual(hook["command"], "python3")
                self.assertEqual(
                    hook["args"],
                    ["${ZCODE_PLUGIN_ROOT}/scripts/rtk-zcode-hook.py"],
                )
                self.assertEqual(hook["timeoutMs"], 5000)
                self.assertTrue(
                    (plugin_root / "scripts/rtk-zcode-hook.py").is_file()
                )
                self.assertTrue((plugin_root / "rules.json").is_file())
            else:
                self.assertEqual(plugin_manifest["skills"], "skills")
                self.assertNotIn("agents", plugin_manifest)

            if entry["name"] == "ghost-agent-workflow":
                self.assertEqual(plugin_manifest["commands"], "commands")
                command_text = (
                    plugin_root / "commands/parallel-workflow.md"
                ).read_text(encoding="utf-8")
                self.assertNotIn("skills:", command_text)
                self.assertNotIn("parallel-coordinator", command_text)
                self.assertEqual(frontmatter(command_text), {
                    "description": "为当前 workflow action 选择一个对应的 ZCode role agent。",
                })
                for agent_name in EXPECTED_AGENTS[entry["name"]]:
                    self.assertIn(f"`{agent_name}`", command_text)
                sync_command = plugin_root / "commands/sync-zcode-agents.md"
                self.assertTrue(sync_command.is_file())
                sync_text = sync_command.read_text(encoding="utf-8")
                self.assertEqual(
                    frontmatter(sync_text),
                    {
                        "description": "从 Ghost233/ghost-agent-market 在线安装全部 ZCode 用户级 role agent；默认保护已有文件。",
                        "argument-hint": '"[--force]"',
                        "allowed-tools": "Bash",
                    },
                )
                self.assertIn("~/.zcode/agents/", sync_text)
                self.assertIn("--force", sync_text)
            if entry["name"] == "ghost-agent-workflow":
                actual_runtime_files = {
                    path.relative_to(plugin_root).as_posix()
                    for path in plugin_root.rglob("*")
                    if path.is_file()
                    and "__pycache__" not in path.parts
                    and path.relative_to(plugin_root).as_posix()
                    in RUNTIME_FILES
                }
                self.assertEqual(actual_runtime_files, RUNTIME_FILES)

            if entry["name"] != "rtk-hook":
                skill_root = plugin_root / "skills"
                skill_names = {
                    skill_dir.name
                    for skill_dir in skill_root.iterdir()
                    if skill_dir.is_dir() and (skill_dir / "SKILL.md").is_file()
                }
                self.assertEqual(skill_names, EXPECTED_SKILLS[entry["name"]])

                for skill_name in skill_names:
                    skill_dir = skill_root / skill_name
                    self.assertFalse(skill_dir.is_symlink(), skill_name)
                    self.assertFalse((skill_dir / "agents").exists(), skill_name)

                    skill_text = (skill_root / skill_name / "SKILL.md").read_text(
                        encoding="utf-8"
                    )
                    self.assertTrue(skill_text.startswith("---\n"), skill_name)
                    skill_metadata = frontmatter(skill_text)
                    self.assertEqual(skill_metadata["name"], skill_name, skill_name)
                    self.assertEqual(set(skill_metadata), {"name", "description"}, skill_name)
                    self.assertTrue(skill_metadata["description"].strip(), skill_name)
                    self.assertIn("ZCode 独立副本", skill_text, skill_name)
                    for referenced_path in referenced_files(skill_root / skill_name / "SKILL.md"):
                        self.assertTrue(referenced_path.is_file(), referenced_path)

            self.assertFalse(list(plugin_root.rglob("openai.yaml")))

            text_roots = []
            if entry["name"] != "rtk-hook":
                text_roots.append(plugin_root / "skills")
            if entry["name"] == "ghost-agent-workflow":
                text_roots.append(plugin_root / "commands")
            for text_root in text_roots:
                for path in text_root.rglob("*"):
                    if path.is_file() and "__pycache__" not in path.parts:
                        text = path.read_text(encoding="utf-8")
                        for forbidden in FORBIDDEN_ZCODE_TEXT:
                            self.assertNotIn(forbidden, text, path.as_posix())

    def test_agent_templates_are_independent_user_level_sources(self) -> None:
        template_root = ROOT / "zcode-market/agent-templates"
        for group, agent_names in EXPECTED_AGENTS.items():
            group_root = template_root / group
            self.assertTrue(group_root.is_dir(), group)
            self.assertEqual(
                {path.stem for path in group_root.glob("*.md")},
                agent_names,
            )
            for agent_name in agent_names:
                agent_path = group_root / f"{agent_name}.md"
                agent_text = agent_path.read_text(encoding="utf-8")
                self.assertTrue(agent_text.startswith("---\n"), agent_path)
                metadata = frontmatter(agent_text)
                self.assertEqual(metadata["name"], agent_name)
                self.assertEqual(set(metadata), {"name", "description"})
                self.assertTrue(metadata["description"].strip())
                self.assertIn(f"${agent_name}", agent_text)

    def test_agent_installer_is_transactional_on_conflicts(self) -> None:
        script_path = ROOT / "zcode-market/install-agents.py"
        spec = importlib.util.spec_from_file_location("install_agents", script_path)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(installer)

        def fake_fetch(group: str, name: str, ref: str) -> str:
            return f"---\nname: {name}\ndescription: Example\n---\n\nBody.\n"

        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            with mock.patch.object(installer, "fetch_template", side_effect=fake_fetch):
                self.assertEqual(
                    installer.main(["--dest", str(destination), "--model", "inherit"]),
                    0,
                )
                protected = destination / "planner-reviewer.md"
                untouched = destination / "parallel-task-planner.md"
                protected.write_text("local edit\n", encoding="utf-8")
                untouched_before = untouched.read_text(encoding="utf-8")

                self.assertEqual(
                    installer.main(["--dest", str(destination), "--model", "inherit"]),
                    2,
                )
                self.assertEqual(protected.read_text(encoding="utf-8"), "local edit\n")
                self.assertEqual(untouched.read_text(encoding="utf-8"), untouched_before)

                self.assertEqual(
                    installer.main(
                        ["--dest", str(destination), "--model", "inherit", "--force"]
                    ),
                    0,
                )
                self.assertIn(
                    "name: planner-reviewer",
                    protected.read_text(encoding="utf-8"),
                )


if __name__ == "__main__":
    unittest.main()
