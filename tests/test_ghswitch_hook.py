import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
PLUGINS = [
    ROOT / "codex-market/plugins/ghost-agent-skills",
    ROOT / "claude-code-market/plugins/ghost-agent-skills",
]
SCRIPT = PLUGINS[0] / "hooks/ghswitch.sh"
SWITCH = ["auth", "switch", "--hostname", "github.com", "--user", "Ghost233"]
VERIFY = ["api", "--hostname", "github.com", "user", "--jq", ".login"]


class GhSwitchHookTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        (self.repo / ".git").mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "calls.jsonl"
        fake = self.bin / "gh"
        fake.write_text(
            "#!/bin/bash\n"
            "printf '%s\\n' \"$*\" >> \"$GHSWITCH_TEST_LOG\"\n"
            "if [[ $1 == auth && $2 == switch ]]; then\n"
            "    if [[ -n ${GHSWITCH_TEST_SWITCH_SLEEP:-} ]]; then\n"
            "        exec sleep \"$GHSWITCH_TEST_SWITCH_SLEEP\"\n"
            "    fi\n"
            "    exit \"${GHSWITCH_TEST_SWITCH_EXIT:-0}\"\n"
            "fi\n"
            "if [[ $1 == api ]]; then\n"
            "    printf '%s\\n' \"${GHSWITCH_TEST_LOGIN:-Ghost233}\"\n"
            "    exit \"${GHSWITCH_TEST_API_EXIT:-0}\"\n"
            "fi\n",
            encoding="utf-8",
        )
        fake.chmod(0o755)
        for name in ["bash", "jq", "cat", "mktemp", "rm", "sleep", "tr"]:
            executable = shutil.which(name)
            self.assertIsNotNone(executable, name + " is required for shell hook tests")
            (self.bin / name).symlink_to(executable)
        self.env = {
            key: value for key, value in os.environ.items()
            if key not in {"GH_TOKEN", "GITHUB_TOKEN", "GH_HOST", "GH_CONFIG_DIR"}
        }
        self.env.update(PATH=str(self.bin) + os.pathsep + os.environ["PATH"],
                        GHSWITCH_TEST_LOG=str(self.log))

    def configure(self, text="Ghost233\n", repo=None):
        (repo or self.repo).joinpath(".ghswitch").write_text(text, encoding="utf-8")

    def run_hook(self, command, cwd=None, tool_input=None, script=SCRIPT):
        result = subprocess.run(
            ["/bin/bash", str(script)],
            input=json.dumps({"hook_event_name": "PreToolUse", "tool_name": "Bash",
                              "cwd": str(cwd or self.repo),
                              "tool_input": tool_input or {"command": command}}),
            text=True, capture_output=True, env=self.env, cwd=self.repo,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def calls(self):
        return [shlex.split(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def run_registered_hook(self, plugin, cwd=None, payload=None, environment=None):
        definition = json.loads((plugin / "hooks/hooks.json").read_text())
        command = definition["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
        hook_cwd = cwd or self.repo
        return subprocess.run(
            command, shell=True, cwd=hook_cwd,
            env=dict(environment or self.env, CLAUDE_PLUGIN_ROOT=str(plugin)),
            input=payload if payload is not None else json.dumps({
                "cwd": str(hook_cwd), "tool_name": "Bash",
                "tool_input": {"command": "git status"},
            }), text=True, capture_output=True,
        )

    def test_registered_hook_without_config_needs_no_dependencies_or_input(self):
        environment = dict(self.env, PATH=str(self.root / "empty"))
        for plugin in PLUGINS:
            with self.subTest(plugin=plugin):
                result = self.run_registered_hook(plugin, payload="not JSON", environment=environment)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout + result.stderr, "")
        self.assertEqual(self.calls(), [])

    def test_registered_hook_does_not_start_main_script_without_config(self):
        marker = self.root / "main-script-started"
        fake_plugin = self.root / "fake plugin"
        (fake_plugin / "hooks").mkdir(parents=True)
        (fake_plugin / "hooks/ghswitch.sh").write_text(
            "#!/bin/bash\nprintf started > " + shlex.quote(str(marker)) + "\nexit 98\n",
            encoding="utf-8",
        )
        for plugin in PLUGINS:
            (fake_plugin / "hooks/hooks.json").write_bytes((plugin / "hooks/hooks.json").read_bytes())
            result = self.run_registered_hook(fake_plugin)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout + result.stderr, "")
            self.assertFalse(marker.exists())

    def test_registered_hook_stops_at_nested_repository_boundary(self):
        self.configure()
        child = self.repo / "nested"
        child.mkdir()
        (child / ".git").write_text("gitdir: /unused\n")
        environment = dict(self.env, PATH=str(self.root / "empty"))
        for plugin in PLUGINS:
            result = self.run_registered_hook(plugin, cwd=child, environment=environment)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout + result.stderr, "")
        self.assertEqual(self.calls(), [])

    def test_registered_hook_finds_parent_config_from_subdirectory(self):
        self.configure()
        child = self.repo / "src"
        child.mkdir()
        for plugin in PLUGINS:
            result = self.run_registered_hook(plugin, cwd=child)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, "")
        self.assertEqual(self.calls(), [SWITCH, VERIFY, SWITCH, VERIFY])

    def test_registered_hook_with_config_still_requires_jq(self):
        self.configure()
        (self.bin / "jq").unlink()
        environment = dict(self.env, PATH=str(self.bin))
        for plugin in PLUGINS:
            result = self.run_registered_hook(plugin, environment=environment)
            self.assertEqual(result.returncode, 2)
            self.assertIn("jq", result.stderr)
        self.assertEqual(self.calls(), [])

    def assert_denied(self, result, reason):
        self.assertEqual(result.returncode, 0, result.stderr)
        decision = json.loads(result.stdout)["hookSpecificOutput"]
        self.assertEqual(decision["hookEventName"], "PreToolUse")
        self.assertEqual(decision["permissionDecision"], "deny")
        self.assertIn(reason, decision["permissionDecisionReason"])

    def test_missing_config_does_not_call_gh(self):
        result = self.run_hook("git status && gh pr list")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertEqual(self.calls(), [])

    def test_unrelated_commands_and_mentions_do_not_call_gh(self):
        self.configure()
        for command in ["python3 --version", "echo git gh", "printf '%s' 'git status'", "rg gh README.md",
                        "cd $PROJECT; python3 --version"]:
            with self.subTest(command=command):
                self.assertEqual(self.run_hook(command).stdout, "")
        self.assertEqual(self.calls(), [])

    def test_switch_then_verify_for_both_platforms(self):
        self.configure("  Ghost233  \n")
        for plugin in PLUGINS:
            with self.subTest(plugin=plugin):
                result = self.run_hook("git status", script=plugin / "hooks/ghswitch.sh")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, "")
        self.assertEqual(self.calls(), [SWITCH, VERIFY, SWITCH, VERIFY])

    def test_compound_commands_wrappers_and_shell_commands(self):
        self.configure()
        for command in [
            "echo ready && git status", "echo ready\ngh pr list",
            "command /usr/bin/git diff | cat", "env LANG=C gh pr list",
            "bash -lc 'git status && gh pr list'", "(git status)",
            "echo ready # comment\ngit status", "echo GH_TOKEN; gh pr list",
            "bash -lc 'git status\ngh pr list'",
        ]:
            with self.subTest(command=command):
                result = self.run_hook(command)
                self.assertEqual(result.stdout, "", result.stdout)
                self.assertEqual(self.calls()[-2:], [SWITCH, VERIFY])
        self.assertEqual(len(self.calls()), 18)

    def test_dynamic_target_requires_explicit_workdir(self):
        self.configure()
        self.assert_denied(self.run_hook("cd $PROJECT && gh pr list"), "workdir")
        self.assertEqual(self.calls(), [])

    def test_subdirectory_and_tool_workdir(self):
        self.configure()
        child = self.repo / "src"
        child.mkdir()
        for fields in [{"command": "gh pr list", "workdir": str(child)},
                       {"cmd": "git diff", "workdir": str(child)}]:
            result = self.run_hook("", cwd=self.root, tool_input=fields)
            self.assertEqual(result.stdout, "", result.stdout)
        self.assertEqual(self.calls(), [SWITCH, VERIFY, SWITCH, VERIFY])

    def test_cd_and_git_C_find_target_config(self):
        other = self.root / "other project"
        other.mkdir()
        self.configure(repo=other)
        for command in ["cd " + shlex.quote(str(other)) + " && gh pr list",
                        "git -C " + shlex.quote(str(other)) + " status"]:
            result = self.run_hook(command)
            self.assertEqual(result.stdout, "", result.stdout)
        self.assertEqual(self.calls(), [SWITCH, VERIFY, SWITCH, VERIFY])

    def test_escaped_paths_and_quoted_operator_arguments(self):
        other = self.root / "other project"
        other.mkdir()
        self.configure(repo=other)
        command = "git -C " + str(other).replace(" ", "\\ ") + " status"
        self.assertEqual(self.run_hook(command).stdout, "")
        self.assertEqual(self.calls(), [SWITCH, VERIFY])
        self.configure()
        self.assertEqual(self.run_hook("echo ';' git status").stdout, "")
        self.assertEqual(self.calls(), [SWITCH, VERIFY])

    def test_pending_command_is_never_evaluated(self):
        self.configure()
        marker = self.root / "should-not-exist"
        command = "git status; touch " + shlex.quote(str(marker))
        self.assertEqual(self.run_hook(command).stdout, "")
        self.assertFalse(marker.exists())
        self.assertEqual(self.calls(), [SWITCH, VERIFY])

    def test_nested_repo_does_not_inherit_parent_config(self):
        self.configure()
        child = self.repo / "nested"
        child.mkdir()
        (child / ".git").write_text("gitdir: /unused\n")
        self.assertEqual(self.run_hook("git status", cwd=child).stdout, "")
        self.assertEqual(self.calls(), [])

    def test_invalid_config_denies_without_running_gh(self):
        for text in ["", "Ghost233\nOtherUser\n", "--user OtherUser", "$(touch injected)"]:
            with self.subTest(text=text):
                self.configure(text)
                self.assert_denied(self.run_hook("git status"), ".ghswitch")
        self.assertEqual(self.calls(), [])

    def test_failed_switch_denies_without_verification(self):
        self.configure()
        self.env["GHSWITCH_TEST_SWITCH_EXIT"] = "1"
        self.assert_denied(self.run_hook("gh pr list"), "gh auth switch")
        self.assertEqual(self.calls(), [SWITCH])

    def test_switch_timeout_denies_without_verification(self):
        self.configure()
        self.env["GHSWITCH_TEST_SWITCH_SLEEP"] = "30"
        self.assert_denied(self.run_hook("git push"), "超时")
        self.assertEqual(self.calls(), [SWITCH])

    def test_api_failure_or_wrong_effective_token_identity_denies(self):
        self.configure()
        self.env["GH_TOKEN"] = "test-token-never-print"
        self.env["GHSWITCH_TEST_LOGIN"] = "OtherUser"
        result = self.run_hook("git push")
        self.assert_denied(result, "Ghost233")
        self.assertNotIn(self.env["GH_TOKEN"], result.stdout + result.stderr)
        self.env["GHSWITCH_TEST_API_EXIT"] = "1"
        self.assert_denied(self.run_hook("gh pr list"), "gh api")
        self.assertEqual(self.calls(), [SWITCH, VERIFY, SWITCH, VERIFY])

    def test_missing_gh_denies(self):
        self.configure()
        (self.bin / "gh").unlink()
        self.env["PATH"] = str(self.bin)
        self.assert_denied(self.run_hook("git status"), "gh")

    def test_hook_runs_without_python_on_PATH(self):
        self.configure()
        self.env["PATH"] = str(self.bin)
        self.assertIsNone(shutil.which("python3", path=self.env["PATH"]))
        self.assertEqual(self.run_hook("git status").stdout, "")
        self.assertEqual(self.calls(), [SWITCH, VERIFY])

    def test_missing_jq_blocks_with_exit_2(self):
        environment = dict(self.env, PATH=str(self.root / "empty"))
        result = subprocess.run(["/bin/bash", str(SCRIPT)], input="{}",
                                text=True, capture_output=True, env=environment)
        self.assertEqual(result.returncode, 2)
        self.assertIn("jq", result.stderr)
        self.assertEqual(self.calls(), [])

    def test_conflicting_projects_must_be_separate_tool_calls(self):
        self.configure()
        other = self.root / "other"
        other.mkdir()
        self.configure("OtherUser\n", repo=other)
        result = self.run_hook("git status; git -C " + str(other) + " status")
        self.assert_denied(result, "分别")
        self.assertEqual(self.calls(), [])

    def test_inline_auth_environment_override_denies(self):
        self.configure()
        for command in ["GH_TOKEN=secret gh pr list", "export GITHUB_TOKEN=secret; git push",
                        "env -u GH_TOKEN gh pr list"]:
            with self.subTest(command=command):
                result = self.run_hook(command)
                self.assert_denied(result, "环境")
                self.assertNotIn("secret", result.stdout + result.stderr)
        self.assertEqual(self.calls(), [])

    def test_plugin_hook_registration_runs_packaged_script(self):
        self.configure()
        self.assertEqual((PLUGINS[0] / "hooks/ghswitch.sh").read_bytes(),
                         (PLUGINS[1] / "hooks/ghswitch.sh").read_bytes())
        for plugin in PLUGINS:
            self.assertFalse((plugin / "hooks/ghswitch.py").exists())
        for plugin in PLUGINS:
            definition = json.loads((plugin / "hooks/hooks.json").read_text())
            group = definition["hooks"]["PreToolUse"][0]
            self.assertEqual(group["matcher"], "Bash")
            result = self.run_registered_hook(plugin)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, "")
        self.assertEqual(self.calls(), [SWITCH, VERIFY, SWITCH, VERIFY])


if __name__ == "__main__":
    unittest.main()
