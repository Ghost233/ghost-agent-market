#!/usr/bin/env python3
import json
import os
import shlex
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


def first_token(command):
    try:
        return shlex.split(command)[0]
    except (IndexError, ValueError):
        return ""


def hook_output(reason):
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


def denied_reason(command, rules):
    prefix = rules.get("prefix", "rtk")
    return f"RTK requires shell commands to run through `{prefix}`. Rerun as: {prefix} {command}"


def should_deny(command, rules):
    prefix = rules.get("prefix", "rtk")
    token = first_token(command)

    if rules.get("allow_prefixed", True) and token == prefix:
        return False
    if command in set(rules.get("allow_exact", [])):
        return False
    return bool(command)


def decide(payload, rules):
    command = find_command(payload).strip()
    if should_deny(command, rules):
        return hook_output(denied_reason(command, rules))
    return None


def self_test():
    rules = {"prefix": "rtk", "allow_prefixed": True, "allow_exact": ["which rtk"]}
    assert decide({"tool_input": {"command": "git status"}}, rules)
    assert decide({"tool_input": {"command": "rtk git status"}}, rules) is None
    assert decide({"tool_input": {"command": "which rtk"}}, rules) is None


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
