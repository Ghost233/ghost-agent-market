#!/usr/bin/env python3
"""Owner ACL PreToolUse hook (Claude Code).

Denies file writes by an owner subagent outside its owned_modules. The active
owner is identified by `agent_type` (the subagent frontmatter name, shaped
`owner-<owner_id>`). Non-owner agents are allowed through (fail-open).

Isolation layers (defense in depth; the L1/L2/L3 numbering is shared across the
whole owner-registry chain — keep it identical in every skill / hook / audit):
  L1  this hook (PreToolUse) — hard deny at write time, keyed on agent_type
  L2  sparse worktree        — out-of-module files are physically absent from
                               the per-owner worktree (sparse checkout)
  L3  worktree-merge-back    — per-owner scope audit (diff feature..owner; any
                               file outside owned_modules fails the merge)

Registry source (R9): owner worktrees are sparse checkouts that omit
.ghost-agent-workflow, so this hook never reads cwd-local. It resolves the MAIN
workspace (walk up from cwd to .ghost-agent-workflow, else CLAUDE_PROJECT_DIR)
and always reads that workspace's registry.json — so L1 holds whether the
subagent's cwd is the main repo or a per-owner worktree.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path


OWNER_PREFIX = "owner-"


def emit_deny(reason: str) -> None:
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        },
        sys.stdout,
    )
    sys.stdout.write("\n")


def glob_to_regex(pattern: str) -> str:
    out = ["^"]
    i = 0
    while i < len(pattern):
        c = pattern[i]
        if c == "*":
            if i + 1 < len(pattern) and pattern[i + 1] == "*":
                out.append(".*")
                i += 2
                if i < len(pattern) and pattern[i] == "/":
                    i += 1
                continue
            out.append("[^/]*")
            i += 1
        elif c == "?":
            out.append("[^/]")
            i += 1
        elif c == "[":
            j = pattern.find("]", i + 1)
            if j == -1:
                out.append("\\[")
                i += 1
            else:
                out.append(pattern[i : j + 1])
                i = j + 1
        else:
            out.append(re.escape(c))
            i += 1
    out.append("$")
    return "".join(out)


def path_matches(rel_path: str, globs: list[str]) -> bool:
    for pattern in globs:
        if re.match(glob_to_regex(pattern), rel_path):
            return True
    return False


def workspace_root(payload: dict) -> Path:
    """Root used to normalize a write target to a repo-relative path.

    For an owner subagent this is its own working directory — the worktree root
    when running inside a sparse worktree, or the main workspace otherwise. The
    repo-relative path is what owned_modules globs are matched against. This is
    deliberately distinct from main_workspace_root(), which locates the registry.
    """
    cwd = payload.get("cwd")
    if cwd:
        return Path(cwd)
    env_root = os.environ.get("CLAUDE_PROJECT_DIR") or os.environ.get("PLUGIN_ROOT")
    return Path(env_root) if env_root else Path.cwd()


def main_workspace_root(payload: dict) -> Path:
    """Locate the MAIN workspace that owns ``.ghost-agent-workflow/registry.json``.

    Owner worktrees are sparse checkouts that deliberately omit
    ``.ghost-agent-workflow`` (see goal-dag.mjs WORKTREE_BASELINE), so reading the
    registry from ``cwd`` would miss it and the hook would fail-open. Per R9 we
    resolve the main workspace by (in order):

      1. walk up from the agent cwd to the nearest ancestor containing
         ``.ghost-agent-workflow`` (covers cwd == main workspace, and worktrees
         nested under it);
      2. ``CLAUDE_PROJECT_DIR`` / ``PLUGIN_ROOT`` env (the authoritative main
         workspace pointer set by Claude Code; survives sibling worktrees that
         live outside the main repo);
      3. the cwd itself (the registry is then absent and the hook fails open,
         matching the missing-registry contract).
    """
    cwd = payload.get("cwd")
    if cwd:
        start = Path(cwd).resolve()
        for candidate in [start, *start.parents]:
            if (candidate / ".ghost-agent-workflow").is_dir():
                return candidate
    env_root = os.environ.get("CLAUDE_PROJECT_DIR") or os.environ.get("PLUGIN_ROOT")
    if env_root:
        return Path(env_root)
    return Path(cwd) if cwd else Path.cwd()


def load_owner_modules(registry_path: Path, owner_id: str) -> list[str] | None:
    if not registry_path.is_file():
        return None
    try:
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    for owner in registry.get("owners", []):
        if owner.get("owner_id") == owner_id and owner.get("lifecycle") == "active":
            modules = list(owner.get("owned_modules", []))
            modules.extend(owner.get("interfaces", []))
            return modules
    return None


def target_rel_path(payload: dict) -> str | None:
    tool_input = payload.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        return None
    raw = (
        tool_input.get("file_path")
        or tool_input.get("notebook_path")
        or tool_input.get("path")
    )
    if not raw:
        return None
    target = Path(raw)
    root = workspace_root(payload)
    try:
        rel = target.resolve().relative_to(root.resolve())
        return rel.as_posix()
    except ValueError:
        pass
    if target.is_absolute():
        return None
    return raw.replace("\\", "/")


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (OSError, ValueError):
        return 0  # fail-open: cannot parse, let the platform decide
    agent_type = payload.get("agent_type") or ""
    if not isinstance(agent_type, str) or not agent_type.startswith(OWNER_PREFIX):
        return 0  # not an owner subagent
    owner_id = agent_type[len(OWNER_PREFIX) :]
    if not owner_id:
        return 0
    rel = target_rel_path(payload)
    if rel is None:
        return 0  # no resolvable file target (e.g. Bash) — defer to other layers
    root = main_workspace_root(payload)
    registry_path = root / ".ghost-agent-workflow" / "owners" / "registry.json"
    modules = load_owner_modules(registry_path, owner_id)
    if modules is None:
        return 0  # registry missing or owner unknown — fail-open
    if path_matches(rel, modules):
        return 0
    emit_deny(
        f'owner {owner_id} 写入被拒: {rel} 不在其 owned_modules 内。'
        f'owner 间严格文件隔离，仅可写自己负责的模块。'
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
