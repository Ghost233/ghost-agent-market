import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "codex-market/plugins/rtk-hook"
SCRIPT = PLUGIN / "scripts/rtk-codex-hook.sh"
HOOKS = PLUGIN / "hooks/hooks.json"


class RtkHookScriptTests(unittest.TestCase):
    def setUp(self) -> None:
        if shutil.which("jq") is None:
            self.skipTest("jq is required by the RTK hook")

        self.temp_dir = tempfile.TemporaryDirectory()
        self.plugin_root = Path(self.temp_dir.name) / "plugin"
        self.plugin_root.mkdir()
        self.fake_rtk = self.plugin_root / "fake-rtk"
        self.fake_rtk.write_text(
            """#!/bin/sh
[ "$1" = "rewrite" ] || exit 64
case "$2" in
  supported-3)
    printf '%s\\n' 'rtk transformed "quoted"'
    exit 3
    ;;
  supported-0)
    printf '%s\\n' 'rtk transformed safely'
    exit 0
    ;;
  unchanged)
    printf '%s\\n' 'unchanged'
    exit 3
    ;;
  delayed)
    exec sleep 2
    ;;
  rejected)
    exit 2
    ;;
  *)
    exit 1
    ;;
esac
""",
            encoding="utf-8",
        )
        self.fake_rtk.chmod(self.fake_rtk.stat().st_mode | stat.S_IXUSR)
        self.write_rules()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def write_rules(self, **overrides: object) -> None:
        rules: dict[str, object] = {
            "prefix": str(self.fake_rtk),
            "rewrite_timeout_seconds": 3,
            "skip_unchanged": True,
        }
        rules.update(overrides)
        (self.plugin_root / "rules.json").write_text(
            json.dumps(rules),
            encoding="utf-8",
        )

    def run_hook(self, payload: object | str) -> subprocess.CompletedProcess[str]:
        hook_input = payload if isinstance(payload, str) else json.dumps(payload)
        return subprocess.run(
            ["sh", str(SCRIPT)],
            input=hook_input,
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={**os.environ, "PLUGIN_ROOT": str(self.plugin_root), "LC_ALL": "C"},
            timeout=3,
        )

    def assert_rewrite(self, payload: object, expected_command: str) -> None:
        result = self.run_hook(payload)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertEqual(
            json.loads(result.stdout),
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow",
                    "updatedInput": {"command": expected_command},
                }
            },
        )

    def test_hook_config_invokes_shell_without_python(self) -> None:
        hooks = json.loads(HOOKS.read_text(encoding="utf-8"))
        command = hooks["hooks"]["PreToolUse"][0]["hooks"][0]["command"]
        self.assertIn("rtk-codex-hook.sh", command)
        self.assertNotIn("python", command.lower())

    def test_shell_syntax_is_valid(self) -> None:
        result = subprocess.run(
            ["sh", "-n", str(SCRIPT)],
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_supported_exit_codes_emit_safe_json(self) -> None:
        self.assert_rewrite(
            {"tool_input": {"command": "supported-3"}},
            'rtk transformed "quoted"',
        )
        self.assert_rewrite(
            {"toolInput": {"cmd": "supported-0"}},
            "rtk transformed safely",
        )

    def test_top_level_command_fallback_is_preserved(self) -> None:
        self.assert_rewrite(
            {"tool_input": {}, "command": "supported-0"},
            "rtk transformed safely",
        )

    def test_unsupported_unchanged_empty_and_malformed_inputs_fail_open(self) -> None:
        payloads: list[object | str] = [
            {"tool_input": {"command": "unsupported"}},
            {"tool_input": {"command": "rejected"}},
            {"tool_input": {"command": "unchanged"}},
            {"tool_input": {"command": ""}},
            "not-json",
        ]
        for payload in payloads:
            with self.subTest(payload=payload):
                result = self.run_hook(payload)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, "")
                self.assertEqual(result.stderr, "")

    def test_rewrite_timeout_fails_open_before_host_timeout(self) -> None:
        self.write_rules(rewrite_timeout_seconds=0.1)
        started = time.monotonic()
        result = self.run_hook({"tool_input": {"command": "delayed"}})
        elapsed = time.monotonic() - started
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertLess(elapsed, 1.0)


if __name__ == "__main__":
    unittest.main()
