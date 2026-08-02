#!/usr/bin/env python3
"""Install Ghost Agent role definitions into ZCode's user agent directory.

The installer intentionally fetches templates over HTTPS from GitHub instead of
cloning a repository. ZCode loads the resulting Markdown files from
~/.zcode/agents on the next run.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


REPOSITORY = "Ghost233/ghost-agent-market"
TEMPLATE_ROOT = "zcode-market/agent-templates"
AGENTS = {
    "ghost-agent-workflow": (
        "parallel-task-planner",
        "planner-reviewer",
        "setup-sub-thread-workflow",
        "start-dag-dashboard",
        "sub-thread-coordination",
        "sub-thread-goal-worker",
    ),
    "ghost-agent-skills": (
        "git-commit",
        "git-merge-conflict",
    ),
}


def all_agent_names() -> set[str]:
    return {name for names in AGENTS.values() for name in names}


def model_scalar(model: str) -> str:
    if re.fullmatch(r"[A-Za-z0-9._-]+", model):
        return model
    return json.dumps(model, ensure_ascii=False)


def set_model(markdown: str, model: str) -> str:
    lines = markdown.splitlines()
    if not lines or lines[0] != "---":
        raise ValueError("agent template is missing YAML frontmatter")
    try:
        end = lines.index("---", 1)
    except ValueError as exc:
        raise ValueError("agent template has unterminated YAML frontmatter") from exc

    replacement = f"model: {model_scalar(model)}"
    for index in range(1, end):
        if lines[index].startswith("model:"):
            lines[index] = replacement
            break
    else:
        lines.insert(end, replacement)

    return "\n".join(lines) + ("\n" if markdown.endswith("\n") else "")


def template_url(agent_group: str, agent_name: str, ref: str) -> str:
    encoded_ref = quote(ref, safe="/._-")
    path = f"{TEMPLATE_ROOT}/{agent_group}/{agent_name}.md"
    encoded_path = quote(path, safe="/._-")
    return (
        f"https://raw.githubusercontent.com/{REPOSITORY}/"
        f"{encoded_ref}/{encoded_path}"
    )


def fetch_template(agent_group: str, agent_name: str, ref: str) -> str:
    url = template_url(agent_group, agent_name, ref)
    request = Request(
        url,
        headers={
            "Accept": "text/plain",
            "User-Agent": "ghost-agent-market-zcode-installer/1",
        },
    )
    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def parse_agent_models(entries: list[str]) -> dict[str, str]:
    result = {}
    names = all_agent_names()
    for entry in entries:
        name, separator, model = entry.partition("=")
        if not separator or name not in names or not model.strip():
            valid = ", ".join(sorted(names))
            raise ValueError(
                f"invalid --agent-model {entry!r}; use NAME=MODEL where NAME is one of: {valid}"
            )
        result[name] = model.strip()
    return result


def print_agents() -> None:
    for group, names in AGENTS.items():
        print(f"{group}:")
        for name in names:
            print(f"  {name}")


def self_test() -> None:
    source = "---\nname: example\ndescription: Example\n---\n\nBody.\n"
    assert "model: inherit" in set_model(source, "inherit")
    assert 'model: "openai/gpt-5"' in set_model(source, "openai/gpt-5")
    existing = "---\nname: example\nmodel: sonnet\n---\nBody\n"
    assert "model: opus" in set_model(existing, "opus")
    assert template_url("ghost-agent-workflow", "planner-reviewer", "main").endswith(
        "/main/zcode-market/agent-templates/ghost-agent-workflow/planner-reviewer.md"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Install Ghost Agent roles into ~/.zcode/agents without cloning."
    )
    parser.add_argument(
        "--model",
        default="inherit",
        help="model for every installed agent (default: inherit)",
    )
    parser.add_argument(
        "--agent-model",
        action="append",
        default=[],
        metavar="NAME=MODEL",
        help="override one agent; may be repeated",
    )
    parser.add_argument(
        "--ref",
        default="main",
        help="GitHub ref to read online (default: main)",
    )
    parser.add_argument(
        "--dest",
        type=Path,
        default=Path.home() / ".zcode" / "agents",
        help="ZCode user agent directory (default: ~/.zcode/agents)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="overwrite existing user agent files",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="list available agents without downloading anything",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="run local installer checks without network access",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.self_test:
        self_test()
        return 0
    if args.list:
        print_agents()
        return 0

    if not args.model.strip() or "\n" in args.model or "\r" in args.model:
        print("model must be a non-empty single-line value", file=sys.stderr)
        return 2

    try:
        overrides = parse_agent_models(args.agent_model)
        args.dest.mkdir(parents=True, exist_ok=True)
    except (OSError, ValueError) as exc:
        print(f"installer error: {exc}", file=sys.stderr)
        return 2

    conflicts = []
    installed = 0
    for group, names in AGENTS.items():
        for name in names:
            destination = args.dest / f"{name}.md"
            try:
                template = fetch_template(group, name, args.ref)
                content = set_model(template, overrides.get(name, args.model.strip()))
            except (HTTPError, URLError, OSError, UnicodeError, ValueError) as exc:
                print(f"failed to fetch {group}/{name}: {exc}", file=sys.stderr)
                return 1

            if destination.exists() and not args.force:
                if destination.read_text(encoding="utf-8") == content:
                    print(f"unchanged {destination}")
                else:
                    conflicts.append(destination)
                continue

            try:
                destination.write_text(content, encoding="utf-8")
            except OSError as exc:
                print(f"failed to write {destination}: {exc}", file=sys.stderr)
                return 1
            installed += 1
            print(f"installed {destination}")

    if conflicts:
        print("existing user agents were not overwritten:", file=sys.stderr)
        for path in conflicts:
            print(f"  {path}", file=sys.stderr)
        print("rerun with --force after reviewing the remote templates", file=sys.stderr)
        return 2

    print(f"installed {installed} ZCode agents with model={args.model}")
    print("restart ZCode or start a new run to load the user-level agents")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
