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

Registry source resolution: owner worktrees are sparse checkouts that omit
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


def _glob_segment_regex(segment: str) -> str:
    """Compile one slash-free segment, mirroring goal-dag.mjs globSegmentRegex:
    '*'/'?' single-char wildcards, '[...]' classes with '[!...]' negation,
    '{a,b}' alternation. A bare '*' is [^/]* (segment-scoped); only a whole
    '**' segment is a cross-segment wildcard (handled by glob_to_regex)."""
    expr = []
    i = 0
    n = len(segment)
    while i < n:
        c = segment[i]
        if c == "*":
            expr.append("[^/]*")
            i += 1
        elif c == "?":
            expr.append("[^/]")
            i += 1
        elif c == "[":
            j = segment.find("]", i + 1)
            if j == -1:
                expr.append("\\[")
                i += 1
            else:
                contents = segment[i + 1 : j]
                # mjs: a leading '!' negates the class -> '[^...]'
                inner = "^" + contents[1:] if contents.startswith("!") else contents
                expr.append("[" + inner + "]")
                i = j + 1
        elif c == "{":
            j = segment.find("}", i + 1)
            body = segment[i + 1 : j] if j != -1 else None
            alternatives = body.split(",") if body is not None else []
            # mjs: legal alternation needs >=2 non-empty options, no '{','}','/'.
            if (
                j != -1
                and len(alternatives) >= 2
                and all(alt != "" for alt in alternatives)
                and not any(ch in body for ch in "{}/")
            ):
                expr.append("(?:" + "|".join(re.escape(alt) for alt in alternatives) + ")")
                i = j + 1
            else:
                # Unbalanced/invalid brace — mjs rejects it before storage; here
                # fall back to a literal so the hook never mis-matches.
                expr.append("\\{" if j == -1 else "\\{" + re.escape(body) + "\\}")
                i = (j + 1) if j != -1 else i + 1
        else:
            expr.append(re.escape(c))
            i += 1
    return "".join(expr)


def glob_to_regex(pattern: str) -> str:
    """Compile an owned_modules glob to a regex with the SAME semantics as the
    goal-dag.mjs glob engine (globRegex + globSegmentRegex) used by L3 scope
    audit. L1 (this hook) and L3 must agree, or a write can be falsely denied
    in-scope or falsely allowed out-of-scope.

    Compiled segment-by-segment (split on '/') so '**' matches zero-or-more
    COMPLETE slash-free segments — not a greedy '.*'. A non-final '**/' yields
    '(?:[^/]+/)*'; a final '**' yields '(?:[^/]+(?:/|$))*'. Within a segment,
    '*'/'?' are single-char wildcards and '[...]'/  '{a,b}' work as in mjs.
    """
    out = ["^"]
    segments = pattern.split("/")
    last = len(segments) - 1
    for idx, seg in enumerate(segments):
        if seg == "**":
            out.append("(?:[^/]+(?:/|$))*" if idx == last else "(?:[^/]+/)*")
        else:
            out.append(_glob_segment_regex(seg))
            if idx < last:
                out.append("/")
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
    registry from ``cwd`` would miss it and the hook would fail-open. We therefore
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
            return list(owner.get("owned_modules", []))
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


def _is_owner_mutation_without_plan(payload: dict) -> bool:
    """True when a Bash command runs ``owner-add``/``owner-split`` without
    ``--plan`` (the registry-writing form). The ``--plan`` dry-run is allowed.

    owner-add/owner-split rewrite the cross-Goal owner topology and are
    irreversible, so the write form is blocked for ANY agent — the skill must
    run ``--plan`` (exposes the proposal) and confirm via AskUserQuestion before
    the real write. This is the hard backstop for the skill's soft constraint.
    """
    tool_input = payload.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        return False
    command = tool_input.get("command")
    if not isinstance(command, str):
        return False
    if not re.search(r"\bowner-(?:add|split)\b", command):
        return False
    return re.search(r"--plan\b", command) is None


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (OSError, ValueError):
        return 0  # fail-open: cannot parse, let the platform decide
    if _is_owner_mutation_without_plan(payload):
        emit_deny(
            "owner-add/owner-split 改写跨 Goal owner 拓扑（不可逆）。必须先 "
            "owner-add/owner-split --plan 拿方案，经 AskUserQuestion 由用户确认后，"
            "再执行不带 --plan 的落盘命令。dry-run 请加 --plan。"
        )
        return 0
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
