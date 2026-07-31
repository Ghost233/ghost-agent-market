#!/usr/bin/env python3
import json
import os
import subprocess
import sys
from pathlib import Path


def plugin_root():
    return Path(os.environ.get("PLUGIN_ROOT") or Path(__file__).resolve().parents[1])


def load_json(path):
    with path.open() as f:
        return json.load(f)


def find_command(payload):
    tool_input = payload.get("tool_input") or payload.get("toolInput") or {}
    if not isinstance(tool_input, dict):
        return ""
    return str(
        tool_input.get("cmd")
        or tool_input.get("command")
        or payload.get("cmd")
        or payload.get("command")
        or ""
    )


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

    # RTK's rewrite protocol uses 0 for an explicitly allowed rewrite and 3
    # for a supported rewrite that should retain the host's normal permission
    # flow. Codex currently requires an allow decision alongside updatedInput,
    # so both supported outcomes use the same rewrite response here.
    if result.returncode not in (0, 3):
        return None

    rewritten = result.stdout.strip()
    if not rewritten:
        return None
    if rules.get("skip_unchanged", True) and rewritten == command:
        return None
    return rewritten


def hook_output(command):
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": {"command": command},
        }
    }


def decide(payload, rules, runner=subprocess.run):
    command = find_command(payload).strip()
    rewritten = rewritten_command(command, rules, runner=runner)
    return hook_output(rewritten) if rewritten is not None else None


def self_test():
    rules = {"prefix": "rtk", "skip_unchanged": True}

    def result(exit_code, stdout=""):
        return lambda *args, **kwargs: subprocess.CompletedProcess(
            args[0], exit_code, stdout=stdout, stderr=""
        )

    assert decide(
        {"tool_input": {"command": "git status"}},
        rules,
        runner=result(3, "rtk git status"),
    ) == {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "updatedInput": {"command": "rtk git status"},
        }
    }
    assert (
        decide(
            {"tool_input": {"command": "pwd"}}, rules, runner=result(1)
        )
        is None
    )
    assert (
        decide(
            {"tool_input": {"command": "rm -rf /tmp/example"}},
            rules,
            runner=result(2),
        )
        is None
    )
    assert (
        decide(
            {"tool_input": {"command": "rtk git status"}},
            rules,
            runner=result(3, "rtk git status"),
        )
        is None
    )
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
