#!/usr/bin/env python3
import json
import os
import subprocess
import sys
from pathlib import Path


def plugin_root():
    for variable in ("ZCODE_PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT"):
        configured = os.environ.get(variable)
        if configured:
            return Path(configured)
    return Path(__file__).resolve().parents[1]


def load_json(path):
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def tool_input(payload):
    for key in ("tool_input", "toolInput"):
        value = payload.get(key)
        if isinstance(value, dict):
            return value
    return {}


def find_command(payload):
    input_value = tool_input(payload)
    for key in ("command", "cmd"):
        if key in input_value and input_value[key] is not None:
            return str(input_value[key])
    for key in ("command", "cmd"):
        if key in payload and payload[key] is not None:
            return str(payload[key])
    return ""


def rewritten_command(command, rules, runner=subprocess.run):
    prefix = rules.get("prefix", "rtk")
    timeout = rules.get("rewrite_timeout_seconds", 3)

    if not command or not isinstance(prefix, str) or not prefix:
        return None

    try:
        result = runner(
            [prefix, "rewrite", command],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.SubprocessError, ValueError):
        return None

    # RTK uses 0 for an explicitly allowed rewrite and 3 for a supported
    # rewrite that retains the host's normal permission flow.
    if result.returncode not in (0, 3):
        return None

    rewritten = result.stdout.strip()
    if not rewritten:
        return None
    if rules.get("skip_unchanged", True) and rewritten == command:
        return None
    return rewritten


def updated_input(payload, command):
    updated = dict(tool_input(payload))
    command_keys = [key for key in ("command", "cmd") if key in updated]
    if command_keys:
        for key in command_keys:
            updated[key] = command
    else:
        updated["command"] = command
    return updated


def hook_output(payload, command):
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": updated_input(payload, command),
        }
    }


def decide(payload, rules, runner=subprocess.run):
    command = find_command(payload).strip()
    rewritten = rewritten_command(command, rules, runner=runner)
    return hook_output(payload, rewritten) if rewritten is not None else None


def self_test():
    rules = {"prefix": "rtk", "skip_unchanged": True}

    def result(exit_code, stdout=""):
        return lambda *args, **kwargs: subprocess.CompletedProcess(
            args[0], exit_code, stdout=stdout, stderr=""
        )

    assert decide(
        {"tool_input": {"command": "git status", "timeout": 10}},
        rules,
        runner=result(3, "rtk git status"),
    ) == {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": {"command": "rtk git status", "timeout": 10},
        }
    }
    assert decide(
        {"toolInput": {"cmd": "git diff"}},
        rules,
        runner=result(0, "rtk git diff"),
    ) == {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": {"cmd": "rtk git diff"},
        }
    }
    assert decide(
        {"tool_input": {"command": "pwd"}},
        rules,
        runner=result(1),
    ) is None
    assert decide(
        {"tool_input": {"command": "rm -rf /tmp/example"}},
        rules,
        runner=result(2),
    ) is None
    assert decide(
        {"tool_input": {"command": "rtk git status"}},
        rules,
        runner=result(3, "rtk git status"),
    ) is None
    assert decide({"tool_input": {"command": ""}}, rules, runner=result(1)) is None


def main():
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        return

    try:
        payload = json.load(sys.stdin)
        rules = load_json(plugin_root() / "rules.json")
        output = decide(payload, rules)
    except Exception:
        output = None

    if output is not None:
        print(json.dumps(output))


if __name__ == "__main__":
    main()
