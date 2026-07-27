#!/usr/bin/env python3
"""Owner ACL PreToolUse hook (Claude Code).

Denies file writes by an owner subagent outside its owned_modules and denies
Owner Bash entirely. The active owner is identified by `agent_type` (the
subagent frontmatter name, shaped `owner-<owner_id>`). Non-owner agents are
allowed through, while any identified Owner with missing/malformed registry,
unknown/inactive identity, or an unresolved target fails closed.

Isolation layers (defense in depth; the L1/L2/L3 numbering is shared across the
whole owner-registry chain — keep it identical in every skill / hook / audit):
  L1  this hook (PreToolUse) — exact structured-path ACL; Owner Bash denied
  L2  sparse worktree        — conservative visibility superset that reduces
                               exposure; it is not an authorization boundary
  L3  commit/merge audit     — exact owned_modules scope audit before transport

Registry source resolution: owner worktrees are sparse checkouts that omit
.ghost-agent-workflow, so this hook never reads cwd-local. It resolves the MAIN
workspace (walk up from cwd to .ghost-agent-workflow, else CLAUDE_PROJECT_DIR)
and always reads that workspace's registry.json — so L1 holds whether the
subagent's cwd is the main repo or a per-owner worktree.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shlex
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


OWNER_PREFIX = "owner-"
PROVENANCE_ENV = "GHOST_AGENT_HOOK_PROVENANCE"
OWNER_LIKE_FIELDS = frozenset(
    {"owner_id", "owner_exec", "owner_branch", "worktree_path", "owned_modules_glob"}
)
IDENTITY_FIELDS = (
    "agent_type",
    "agent_id",
    "agent_name",
    "session_id",
    "hook_event_name",
    "tool_name",
    "permission_mode",
)


def _redacted_sample(value: Any) -> dict[str, Any]:
    """Describe an identity value without persisting the identity itself."""
    sample: dict[str, Any] = {"type": type(value).__name__}
    if isinstance(value, str):
        sample.update(
            {
                "present": bool(value),
                "length": len(value),
                "sha256_12": hashlib.sha256(value.encode("utf-8")).hexdigest()[:12],
            }
        )
        if value.startswith(OWNER_PREFIX):
            sample["owner_like"] = True
    else:
        sample["present"] = value is not None
    return sample


def record_provenance(
    outcome: str,
    payload: dict[str, Any] | None,
    *,
    reason_code: str,
    raw: str | None = None,
) -> None:
    """Append an opt-in, redacted hook observation artifact.

    The environment value is the artifact path. Recording is best-effort and
    never changes the ACL decision. Payload values, paths, commands, and IDs are
    intentionally not retained.
    """
    artifact = os.environ.get(PROVENANCE_ENV)
    if not artifact:
        return
    observation: dict[str, Any] = {
        "schema_version": 1,
        "kind": "claude_hook_provenance",
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "host": {"name": "claude-code", "observed_version": os.environ.get("CLAUDE_CODE_VERSION")},
        "hook": "owner-acl-hook",
        "outcome": outcome,
        "reason_code": reason_code,
        "identity_fields": {},
    }
    if payload is not None:
        observation["identity_fields"] = {
            field: _redacted_sample(payload[field])
            for field in IDENTITY_FIELDS
            if field in payload
        }
        observation["payload_keys"] = sorted(str(key) for key in payload)[:64]
    elif raw is not None:
        observation["malformed_input"] = {
            "length": len(raw),
            "sha256_12": hashlib.sha256(raw.encode("utf-8", errors="replace")).hexdigest()[:12],
        }
    try:
        path = Path(artifact).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(observation, ensure_ascii=False, sort_keys=True) + "\n")
    except OSError:
        pass


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
        try:
            if re.match(glob_to_regex(pattern), rel_path):
                return True
        except re.error:
            # Registry tampering or an invalid persisted glob must fail closed.
            return False
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


def load_owner_record(registry_path: Path, owner_id: str) -> tuple[dict | None, str | None]:
    if not registry_path.is_file():
        return None, "registry missing"
    try:
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None, "registry malformed"
    if not isinstance(registry, dict) or not isinstance(registry.get("owners"), list):
        return None, "registry malformed"
    for owner in registry["owners"]:
        if not isinstance(owner, dict):
            return None, "registry malformed"
        if owner.get("owner_id") != owner_id:
            continue
        if owner.get("lifecycle") != "active":
            return None, f"owner {owner_id} is inactive"
        modules = owner.get("owned_modules")
        if not isinstance(modules, list) or not modules or not all(isinstance(x, str) for x in modules):
            return None, f"owner {owner_id} owned_modules is invalid"
        return owner, None
    return None, f"owner {owner_id} is unknown"


def target_rel_path(payload: dict, execution_root: Path | None = None) -> str | None:
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
    root = execution_root or workspace_root(payload)
    try:
        rel = target.resolve().relative_to(root.resolve())
        return rel.as_posix()
    except (OSError, ValueError):
        return None


_SHELL_META = re.compile(r"(?:&&|\|\||[;|<>\n\r`]|\$\()")
_CONFIRM_DIGEST = re.compile(r"^[0-9a-f]{64}$")


def _owner_mutation_denial(payload: dict) -> str | None:
    """Validate owner topology mutation Bash as one strict direct argv command."""
    tool_input = payload.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        return None
    command = tool_input.get("command")
    if not isinstance(command, str):
        return None
    try:
        argv = shlex.split(command, posix=True)
    except ValueError:
        if "owner-" in command:
            return "owner-add/owner-split 命令无法按严格 argv 解析。"
        return None
    mutation_indexes = [i for i, arg in enumerate(argv) if arg in {"owner-add", "owner-split"}]
    if not mutation_indexes:
        return None
    if _SHELL_META.search(command):
        return "owner-add/owner-split 必须是单一直接命令；禁止复合 shell、管道、重定向、命令替换或换行。"
    if len(mutation_indexes) != 1:
        return "owner-add/owner-split 命令必须且只能包含一个 mutation 子命令。"
    index = mutation_indexes[0]
    subcommand = argv[index]
    tail = argv[index + 1 :]
    positional_count = 2 if subcommand == "owner-add" else 3
    if len(tail) == positional_count + 1 and tail[positional_count:] == ["--plan"]:
        return None
    option = tail[positional_count:]
    if len(tail) == positional_count + 2 and len(option) == 2 and option[0] == "--confirm" and _CONFIRM_DIGEST.fullmatch(option[1]):
        return None
    return "owner mutation 只允许 --plan 或 --confirm <64hex>，二者互斥。"


def _contains_owner_like(value: Any) -> bool:
    if isinstance(value, dict):
        if any(key in OWNER_LIKE_FIELDS for key in value):
            return True
        return any(_contains_owner_like(item) for item in value.values())
    if isinstance(value, list):
        return any(_contains_owner_like(item) for item in value)
    return isinstance(value, str) and value.startswith(OWNER_PREFIX)


def _deny(payload: dict[str, Any] | None, reason: str, reason_code: str) -> int:
    emit_deny(reason)
    record_provenance("failed", payload, reason_code=reason_code)
    return 0


def main() -> int:
    raw = sys.stdin.read()
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        # A corrupt payload that still claims Owner provenance must not erase the
        # authorization boundary. Generic corrupt host input remains unsupported.
        owner_like = "owner-" in raw or any(f'"{field}"' in raw for field in OWNER_LIKE_FIELDS)
        if owner_like:
            emit_deny("Owner-like hook payload malformed；Owner 模式 fail closed。")
            record_provenance("failed", None, reason_code="malformed_owner_like_payload", raw=raw)
        else:
            record_provenance("unsupported", None, reason_code="malformed_payload", raw=raw)
        return 0
    if not isinstance(parsed, dict):
        if _contains_owner_like(parsed):
            return _deny(None, "Owner-like hook payload 必须是 object；Owner 模式 fail closed。", "non_object_owner_like_payload")
        record_provenance("unsupported", None, reason_code="non_object_payload", raw=raw)
        return 0
    payload: dict[str, Any] = parsed
    mutation_denial = _owner_mutation_denial(payload)
    if mutation_denial is not None:
        return _deny(payload, mutation_denial, "invalid_owner_mutation")
    agent_type = payload.get("agent_type")
    owner_like = _contains_owner_like(payload)
    if agent_type is None:
        if owner_like:
            return _deny(payload, "Owner-like payload 缺少 agent_type；Owner 模式 fail closed。", "missing_owner_identity")
        record_provenance("unsupported", payload, reason_code="identity_field_unavailable")
        return 0
    if not isinstance(agent_type, str):
        if owner_like:
            return _deny(payload, "Owner-like payload 的 agent_type 非字符串；Owner 模式 fail closed。", "malformed_owner_identity")
        record_provenance("unsupported", payload, reason_code="identity_field_unsupported")
        return 0
    if not agent_type.startswith(OWNER_PREFIX):
        if owner_like:
            return _deny(payload, "Owner-like payload 与 agent_type 身份冲突；Owner 模式 fail closed。", "conflicting_owner_identity")
        record_provenance("unsupported", payload, reason_code="non_owner_agent")
        return 0
    owner_id = agent_type[len(OWNER_PREFIX) :]
    if not owner_id:
        return _deny(payload, "owner agent_type 缺少 owner identity；Owner 模式 fail closed。", "empty_owner_identity")
    tool_input = payload.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        return _deny(payload, "Owner tool_input malformed；Owner 模式 fail closed。", "malformed_tool_input")
    if isinstance(tool_input.get("command"), str):
        return _deny(payload, "Owner agent 禁止 Bash；必须使用具有结构化路径的写工具。", "owner_bash_denied")
    root = main_workspace_root(payload)
    registry_path = root / ".ghost-agent-workflow" / "owners" / "registry.json"
    owner, registry_error = load_owner_record(registry_path, owner_id)
    if owner is None:
        return _deny(payload, f"Owner ACL 无法建立可信绑定: {registry_error}; Owner 模式 fail closed。", "owner_registry_untrusted")
    binding = owner.get("worktree_binding")
    if not isinstance(binding, dict) or binding.get("status") not in {"active", "sealed"}:
        return _deny(payload, f"Owner ACL 无法建立可信 worktree binding: owner {owner_id}; Owner 模式 fail closed。", "worktree_binding_untrusted")
    worktree_path = binding.get("worktree_path")
    if not isinstance(worktree_path, str) or not worktree_path:
        return _deny(payload, f"Owner ACL worktree path 无效: owner {owner_id}; Owner 模式 fail closed。", "worktree_path_invalid")
    execution_root = Path(worktree_path).resolve()
    cwd_value = payload.get("cwd")
    if not isinstance(cwd_value, str) or not cwd_value:
        return _deny(payload, "Owner agent cwd 缺失或无效；Owner 模式 fail closed。", "cwd_invalid")
    cwd = Path(cwd_value).resolve()
    try:
        cwd.relative_to(execution_root)
    except ValueError:
        return _deny(payload, f"Owner agent cwd 不在登记 worktree 内: {cwd}; Owner 模式 fail closed。", "cwd_outside_worktree")
    rel = target_rel_path(payload, execution_root)
    if rel is None:
        return _deny(payload, "Owner 写操作缺少可解析的登记 worktree 内结构化路径；Owner 模式 fail closed。", "target_path_unresolved")
    modules = list(owner["owned_modules"])
    if path_matches(rel, modules):
        record_provenance("passed", payload, reason_code="owner_write_in_scope")
        return 0
    return _deny(
        payload,
        f'owner {owner_id} 写入被拒: {rel} 不在其 owned_modules 内。'
        f'owner 间严格文件隔离，仅可写自己负责的模块。',
        "owner_write_out_of_scope",
    )


if __name__ == "__main__":
    sys.exit(main())
