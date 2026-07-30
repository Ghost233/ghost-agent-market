#!/usr/bin/env python3
"""Deterministic Git commit driver: inspect (read-only) / apply (write).

inspect emits a compact JSON snapshot. apply stages explicit paths and
commits from a plan JSON. All Git writes go through apply; inspect never
mutates state. apply aborts on any drift or error -- never rolls back.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

CO_AUTHOR = "Co-Authored-By: Nexus <nexus@xfinite.global>"

LARGE_FILE_BYTES = 1 * 1024 * 1024

SENSITIVE_PATTERNS = [
    re.compile(r"(^|/)\.env($|\.)", re.I),
    re.compile(r"\.pem$", re.I),
    re.compile(r"\.key$", re.I),
    re.compile(r"\.p12$", re.I),
    re.compile(r"\.pfx$", re.I),
    re.compile(r"\.keystore$", re.I),
    re.compile(r"\.cer(t|tificate)?$", re.I),
    re.compile(r"\.crt$", re.I),
    re.compile(r"(^|/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)", re.I),
    re.compile(r"credential", re.I),
    re.compile(r"(^|/)\.npmrc$", re.I),
    re.compile(r"(^|/)\.pypirc$", re.I),
    re.compile(r"(^|/)\.netrc$", re.I),
    re.compile(r"secret", re.I),
    re.compile(r"oauth", re.I),
    re.compile(r"(^|/)token", re.I),
]


class GitError(RuntimeError):
    pass


def git(repo, args, *, binary=False, check=True):
    try:
        r = subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True, check=False,
        )
    except FileNotFoundError as e:
        raise GitError("git executable not found") from e
    if check and r.returncode != 0:
        stderr = r.stderr.decode("utf-8", "replace").strip()
        raise GitError(f"git {' '.join(args)} failed ({r.returncode}): {stderr}")
    return r.stdout


def git_text(repo, args, *, check=True):
    return git(repo, args, binary=True, check=check).decode("utf-8", "replace")


def toplevel(repo):
    root = Path(git_text(repo, ["rev-parse", "--show-toplevel"]).strip())
    if not root.is_dir():
        raise GitError(f"not a directory: {root}")
    return root


def config_value(repo, key):
    return git_text(repo, ["config", key], check=False).strip()


def find_agents_md(repo):
    d = repo
    while True:
        c = d / "AGENTS.md"
        if c.is_file():
            return c
        if d.parent == d:
            return None
        d = d.parent


def parse_required_identity(agents_md):
    if agents_md is None or not agents_md.is_file():
        return None
    text = agents_md.read_text(encoding="utf-8")
    nm = re.search(r"git\s+config\s+user\.name\s+(\S+)", text)
    em = re.search(r"git\s+config\s+user\.email\s+(\S+)", text)
    if not nm or not em:
        return None
    return {"name": nm.group(1), "email": em.group(1)}


def porcelain_entries(repo):
    raw = git(repo, ["status", "--porcelain=v1", "-z"], binary=True)
    entries = []
    for rec in raw.split(b"\x00"):
        if not rec:
            continue
        entries.append({
            "status": rec[:2].decode("ascii", "replace"),
            "path": rec[3:].decode("utf-8", "replace"),
        })
    return entries


def classify(entries):
    staged, unstaged, untracked = [], [], []
    for e in entries:
        code, path = e["status"], e["path"]
        if code.startswith("??"):
            untracked.append(e)
        elif code[0] not in (" ", "?"):
            staged.append(e)
        elif code[1] not in (" ",):
            unstaged.append(e)
        elif code[0] != " ":
            staged.append(e)
    return {"staged": staged, "unstaged": unstaged, "untracked": untracked}


def numstat(repo):
    raw = git_text(repo, ["diff", "HEAD", "--numstat", "-z"])
    result = {}
    if not raw.strip():
        return result
    for rec in raw.split("\x00"):
        if not rec.strip():
            continue
        parts = rec.split("\t", 2)
        if len(parts) < 3:
            continue
        a, d, path = parts
        result[path] = {
            "added": None if a == "-" else int(a),
            "deleted": None if d == "-" else int(d),
            "binary": a == "-",
        }
    return result


def file_size(repo, path):
    try:
        return (repo / path).stat().st_size
    except OSError:
        return -1


def is_sensitive(path):
    return any(p.search(path) for p in SENSITIVE_PATTERNS)


def submodule_status(repo):
    raw = git_text(repo, ["submodule", "status"], check=False)
    if not raw.strip():
        return []
    result = []
    for line in raw.splitlines():
        line = line.rstrip()
        if not line:
            continue
        marker = line[0] if line[0] in ("+", "-", "U") else " "
        rest = line[1:].strip()
        parts = rest.split(None, 1)
        head = parts[0] if parts else ""
        remainder = parts[1] if len(parts) > 1 else ""
        name = remainder
        if remainder.startswith("("):
            close = remainder.find(")")
            name = remainder[close + 1:].strip() if close != -1 else remainder
        result.append({
            "name": name,
            "head": head,
            "dirty": marker == "+",
            "uninitialized": marker == "-",
            "merge_conflict": marker == "U",
        })
    return result


def compute_fingerprint(repo):
    """Lightweight: hash of HEAD + status porcelain + submodule status."""
    parts = [
        b"HEAD=" + git_text(repo, ["rev-parse", "HEAD"]).encode(),
        b"STATUS=" + git(repo, ["status", "--porcelain=v1", "-z"], binary=True),
        b"SUBMODULES=" + git(repo, ["submodule", "status"], binary=True),
    ]
    return "sha256:" + hashlib.sha256(b"\x00".join(parts)).hexdigest()


def detect_risks(groups, stat, repo):
    all_paths = [e["path"] for g in groups.values() for e in g]
    sensitive = [p for p in all_paths if is_sensitive(p)]
    large = [p for p in all_paths if file_size(repo, p) > LARGE_FILE_BYTES]
    binary = [p for p, info in stat.items() if info.get("binary")]
    reasons = []
    if sensitive:
        reasons.append("sensitive-paths")
    if large:
        reasons.append("large-files")
    if binary:
        reasons.append("binary-files")
    return {
        "sensitive_paths": sensitive,
        "large_files": large,
        "binary_files": binary,
        "review_reasons": reasons,
        "review_recommended": bool(reasons),
    }


def cmd_inspect(repo_arg, include_diff):
    repo = toplevel(repo_arg or Path.cwd())
    required = parse_required_identity(find_agents_md(repo))
    name = config_value(repo, "user.name")
    email = config_value(repo, "user.email")
    identity_ok = required is None or (
        name == required["name"] and email == required["email"]
    )
    groups = classify(porcelain_entries(repo))
    stat = numstat(repo)
    risks = detect_risks(groups, stat, repo)
    head = git_text(repo, ["rev-parse", "HEAD"])
    has_changes = any(groups.values())

    dirty = [s for s in submodule_status(repo)
             if s["dirty"] or s["uninitialized"] or s["merge_conflict"]]
    if dirty:
        risks["review_reasons"].append("submodule-changes")
        risks["review_recommended"] = True

    payload = {
        "ok": True,
        "command": "inspect",
        "repo_root": str(repo),
        "head": head,
        "identity_ok": identity_ok,
        "identity_error": None if identity_ok
            else "git identity does not match AGENTS.md requirement",
        "has_changes": has_changes,
        "staged": groups["staged"],
        "unstaged": groups["unstaged"],
        "untracked": groups["untracked"],
        "numstat": stat,
        "fingerprint": compute_fingerprint(repo),
        "dirty_submodules": dirty,
        **risks,
    }
    if include_diff:
        payload["diff"] = git_text(repo, ["diff", "HEAD"])
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def staged_names(repo):
    raw = git_text(repo, ["diff", "--cached", "--name-only", "-z"])
    return {n for n in raw.split("\x00") if n}


def cmd_apply(repo_arg, plan_path):
    repo = toplevel(repo_arg or Path.cwd())
    plan_text = (
        plan_path.read_text(encoding="utf-8")
        if plan_path is not None
        else sys.stdin.read()
    )
    try:
        plan = json.loads(plan_text)
    except json.JSONDecodeError as exc:
        fail("invalid plan JSON: " + str(exc))
        return 2
    batches = plan.get("batches", [])
    if not isinstance(batches, list) or not batches:
        fail("plan must contain a non-empty batches list")
        return 2

    expected_fp = plan.get("fingerprint")
    expected_head = plan.get("head")
    actual_fp = compute_fingerprint(repo)
    actual_head = git_text(repo, ["rev-parse", "HEAD"])

    required = parse_required_identity(find_agents_md(repo))
    if required:
        if (config_value(repo, "user.name") != required["name"]
                or config_value(repo, "user.email") != required["email"]):
            report("git identity does not match AGENTS.md requirement",
                   identity_ok=False, fp_ok=True, head_ok=True)
            return 3
    if expected_fp and expected_fp != actual_fp:
        report("working-tree fingerprint changed since inspect; re-run inspect",
               identity_ok=True, fp_ok=False, head_ok=actual_head == expected_head)
        return 3
    if expected_head and expected_head != actual_head:
        report("HEAD moved since inspect; re-run inspect",
               identity_ok=True, fp_ok=True, head_ok=False)
        return 3

    dirty = [s for s in submodule_status(repo)
             if s["dirty"] or s["uninitialized"] or s["merge_conflict"]]
    if dirty:
        report("dirty submodules detected; commit submodules separately first",
               identity_ok=True, fp_ok=True, head_ok=True,
               extra={"dirty_submodules": dirty})
        return 3

    results = []
    committed_count = 0
    for index, batch in enumerate(batches):
        paths = batch.get("paths")
        message = batch.get("message", "").strip()
        if not isinstance(paths, list) or not paths:
            results.append({"index": index, "committed": False,
                            "error": "batch missing paths"})
            break
        if not message:
            results.append({"index": index, "committed": False,
                            "error": "batch missing non-empty message"})
            break

        before = staged_names(repo)
        try:
            git(repo, ["add", "--", *paths])
        except GitError as exc:
            results.append({"index": index, "committed": False,
                            "error": "staging failed: " + str(exc)})
            break

        after = staged_names(repo)
        not_staged = set(paths) - after
        unexpected = (after - before) - set(paths)
        if not_staged or unexpected:
            results.append({
                "index": index, "committed": False,
                "error": "staged content mismatch",
                "not_staged": sorted(not_staged),
                "unexpected_staged": sorted(unexpected),
                "paths": paths,
            })
            break

        check_out = git_text(repo, ["diff", "--cached", "--check", "--", *paths],
                             check=False)
        if check_out.strip():
            results.append({
                "index": index, "committed": False,
                "error": "whitespace/conflict markers in batch",
                "detail": check_out.strip(),
                "paths": paths,
            })
            break

        try:
            git(repo, ["commit", "-m", message, "-m", CO_AUTHOR])
            commit_hash = git_text(repo, ["rev-parse", "HEAD"]).strip()
        except GitError as exc:
            results.append({"index": index, "committed": False,
                            "error": "commit failed: " + str(exc),
                            "paths": paths})
            break

        committed_count += 1
        results.append({
            "index": index, "committed": True,
            "hash": commit_hash, "message": message,
            "paths": paths,
            "remaining_status": git_text(repo, ["status", "--porcelain"]).strip(),
        })

    ok = committed_count == len(batches)
    final_report = {
        "ok": ok,
        "partial": 0 < committed_count < len(batches),
        "identity_ok": True,
        "fingerprint_verified": True,
        "head_verified": True,
        "batches": results,
        "committed_count": committed_count,
        "batch_count": len(batches),
        "final_head": git_text(repo, ["rev-parse", "HEAD"]).strip(),
        "final_status": git_text(repo, ["status", "--porcelain"]).strip(),
        "error": None if ok else (
            results[-1].get("error") if results else "no batches processed"),
    }
    print(json.dumps(final_report, ensure_ascii=False, indent=2))
    return 0 if ok else 1


def fail(msg):
    print(json.dumps({"ok": False, "error": msg, "partial": False},
                     ensure_ascii=False, indent=2))


def report(error, *, identity_ok=True, fp_ok=True, head_ok=True, extra=None):
    payload = {
        "ok": False, "partial": False, "error": error,
        "identity_ok": identity_ok,
        "fingerprint_verified": fp_ok,
        "head_verified": head_ok,
    }
    if extra:
        payload.update(extra)
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def main(argv=None):
    parser = argparse.ArgumentParser(prog="git_commit.py")
    sub = parser.add_subparsers(dest="command", required=True)

    p_inspect = sub.add_parser("inspect")
    p_inspect.add_argument("--diff", action="store_true")
    p_inspect.add_argument("--repo", type=Path, default=None)

    p_apply = sub.add_parser("apply")
    p_apply.add_argument("--repo", type=Path, default=None)
    p_apply.add_argument("plan", type=Path, nargs="?", default=None)

    args = parser.parse_args(list(argv) if argv is not None else None)
    if args.command == "inspect":
        return cmd_inspect(args.repo, args.diff)
    return cmd_apply(args.repo, args.plan)


if __name__ == "__main__":
    sys.exit(main())
