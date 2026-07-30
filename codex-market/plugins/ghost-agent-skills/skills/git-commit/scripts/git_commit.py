#!/usr/bin/env python3
"""Inspect a Git worktree and apply an exact, pre-reviewed commit plan."""

import argparse
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path, PurePosixPath


CO_AUTHOR = "Co-Authored-By: Nexus <nexus@xfinite.global>"
LARGE_FILE_BYTES = 1024 * 1024
COMMIT_RE = re.compile(
    r"^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)"
    r"(?:\([^\)\r\n]+\))?!?:\s+\S.*$"
)
CHINESE_RE = re.compile(r"[\u3400-\u9fff]")
SENSITIVE = (
    re.compile(r"(^|/)\.env($|\.)", re.I),
    re.compile(r"\.(pem|key|p12|pfx|keystore|cer|cert|certificate|crt)$", re.I),
    re.compile(r"(^|/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)($|/)", re.I),
    re.compile(r"credential|secret|oauth", re.I),
    re.compile(r"(^|/)(\.npmrc|\.pypirc|\.netrc)$", re.I),
    re.compile(r"(^|/)token", re.I),
)


class GitError(RuntimeError):
    pass


class PlanError(RuntimeError):
    pass


def git(repo, *args, check=True):
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), *args], capture_output=True, check=False
        )
    except FileNotFoundError as exc:
        raise GitError("git executable not found") from exc
    if check and result.returncode:
        detail = result.stderr.decode("utf-8", "replace").strip()
        raise GitError(f"git {' '.join(args)} failed ({result.returncode}): {detail}")
    return result


def raw(repo, *args, check=True):
    return git(repo, *args, check=check).stdout


def text(repo, *args, check=True):
    return raw(repo, *args, check=check).decode("utf-8", "replace")


def root(start):
    repo = Path(text(start, "rev-parse", "--show-toplevel").strip()).resolve()
    if not repo.is_dir():
        raise GitError(f"repository root is not a directory: {repo}")
    return repo


def head(repo):
    return text(repo, "rev-parse", "--verify", "HEAD").strip()


def find_agents(repo):
    while True:
        candidate = repo / "AGENTS.md"
        if candidate.is_file():
            return candidate
        if repo.parent == repo:
            return None
        repo = repo.parent


def instruction_value(source, key):
    match = re.search(
        rf"^\s*git\s+config\s+{re.escape(key)}\s+([^\r\n]+?)\s*$",
        source,
        re.MULTILINE,
    )
    if not match:
        return None
    try:
        parts = shlex.split(match.group(1))
    except ValueError:
        return None
    return " ".join(parts) if parts else None


def identity(repo):
    agents = find_agents(repo)
    if not agents:
        return True, None
    source = agents.read_text(encoding="utf-8")
    required = {
        "name": instruction_value(source, "user.name"),
        "email": instruction_value(source, "user.email"),
    }
    if not all(required.values()):
        return True, None
    actual = {
        "name": text(repo, "config", "user.name", check=False).strip(),
        "email": text(repo, "config", "user.email", check=False).strip(),
    }
    return actual == required, required


def status(repo):
    return raw(
        repo,
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--no-renames",
    )


def collect_changes(repo):
    changes = {}
    for record in status(repo).split(b"\0"):
        if not record:
            continue
        if len(record) < 4 or record[2:3] != b" ":
            raise GitError("unexpected git status --porcelain record")
        code, path = record[:2].decode("ascii", "replace"), os.fsdecode(record[3:])
        item = changes.setdefault(
            path,
            {
                "path": path,
                "staged": False,
                "unstaged": False,
                "untracked": False,
                "index_status": None,
                "worktree_status": None,
            },
        )
        if code == "??":
            item.update(untracked=True, worktree_status="?")
            continue
        if code[0] not in " ?":
            item.update(staged=True, index_status=code[0])
        if code[1] not in " ?":
            item.update(unstaged=True, worktree_status=code[1])
    return [changes[path] for path in sorted(changes)]


def hash_path(digest, path):
    try:
        info = path.lstat()
    except OSError as exc:
        digest.update(f"missing:{exc.errno}".encode())
        return
    digest.update(f"{info.st_mode:o}:{info.st_size}".encode())
    if path.is_symlink():
        digest.update(b"link:" + os.fsencode(os.readlink(path)))
    elif path.is_file():
        with path.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)


def fingerprint(repo, changes):
    digest = hashlib.sha256()
    parts = (
        ("HEAD", head(repo).encode()),
        ("STATUS", status(repo)),
        (
            "INDEX",
            raw(repo, "diff", "--cached", "--binary", "--no-ext-diff", "--no-renames"),
        ),
        (
            "WORKTREE",
            raw(repo, "diff", "--binary", "--no-ext-diff", "--no-renames"),
        ),
        ("SUBMODULES", raw(repo, "submodule", "status", "--recursive", check=False)),
    )
    for label, value in parts:
        digest.update(label.encode() + b"\0" + value + b"\0")
    for item in changes:
        if item["untracked"]:
            path = item["path"]
            digest.update(b"UNTRACKED\0" + os.fsencode(path) + b"\0")
            hash_path(digest, repo / path)
    return "sha256:" + digest.hexdigest()


def is_binary(path):
    if not path.is_file() or path.is_symlink():
        return False
    try:
        with path.open("rb") as stream:
            return b"\0" in stream.read(8192)
    except OSError:
        return False


def numstat(repo, changes):
    stats = {}
    outputs = (
        raw(repo, "diff", "HEAD", "--numstat", "-z", "--no-renames"),
        raw(repo, "diff", "--cached", "--numstat", "-z", "--no-renames"),
        raw(repo, "diff", "--numstat", "-z", "--no-renames"),
    )
    for position, output in enumerate(outputs):
        for record in output.split(b"\0"):
            if not record:
                continue
            parts = record.split(b"\t", 2)
            if len(parts) != 3:
                raise GitError("unexpected git diff --numstat record")
            added, deleted, raw_path = parts
            path, binary = os.fsdecode(raw_path), b"-" in (added, deleted)
            if position == 0:
                stats[path] = {
                    "added": None if binary else int(added),
                    "deleted": None if binary else int(deleted),
                    "binary": binary,
                }
            elif binary:
                stats[path] = {"added": None, "deleted": None, "binary": True}
    for item in changes:
        if not item["untracked"]:
            continue
        relative, path = item["path"], repo / item["path"]
        binary = is_binary(path)
        try:
            data = path.read_bytes() if not binary else b""
        except OSError:
            data = b""
        lines = data.count(b"\n") + int(bool(data) and not data.endswith(b"\n"))
        stats[relative] = {
            "added": None if binary else lines,
            "deleted": None if binary else 0,
            "binary": binary,
        }
    return stats


def risks(repo, changes):
    stats = numstat(repo, changes)
    paths = [item["path"] for item in changes]
    sensitive = [path for path in paths if any(rule.search(path) for rule in SENSITIVE)]
    large = []
    for path in paths:
        try:
            if (repo / path).lstat().st_size > LARGE_FILE_BYTES:
                large.append(path)
        except OSError:
            pass
    binary = sorted(path for path, info in stats.items() if info["binary"])
    reasons = [
        name
        for name, present in (
            ("sensitive-paths", sensitive),
            ("large-files", large),
            ("binary-files", binary),
        )
        if present
    ]
    return stats, sensitive, large, binary, reasons


def submodule_changes(repo, changes):
    links = {}
    for record in raw(repo, "ls-files", "--stage", "-z").split(b"\0"):
        header, separator, path = record.partition(b"\t")
        fields = header.split()
        if separator and len(fields) == 3 and fields[0] == b"160000":
            name = os.fsdecode(path)
            item = links.setdefault(
                name,
                {
                    "path": name,
                    "index_head": fields[1].decode(),
                    "merge_conflict": False,
                },
            )
            item["merge_conflict"] |= fields[2] != b"0"
    changed = {item["path"] for item in changes}
    result = []
    for path, item in sorted(links.items()):
        nested = repo / path
        initialized = nested.is_dir() and (nested / ".git").exists() and (
            text(nested, "rev-parse", "--is-inside-work-tree", check=False).strip()
            == "true"
        )
        actual = (
            text(nested, "rev-parse", "HEAD", check=False).strip() if initialized else ""
        )
        nested_dirty = initialized and bool(
            raw(
                nested,
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=all",
                check=False,
            )
        )
        pointer_dirty = bool(actual and actual != item["index_head"])
        if path in changed or not initialized or nested_dirty or pointer_dirty or item["merge_conflict"]:
            result.append(
                {
                    **item,
                    "head": actual or None,
                    "dirty": nested_dirty or pointer_dirty,
                    "uninitialized": not initialized,
                }
            )
    return result


def render_diff(repo, changes):
    sections = []
    for title, args in (
        (
            "staged",
            ("diff", "--cached", "--binary", "--no-ext-diff", "--no-renames"),
        ),
        ("unstaged", ("diff", "--binary", "--no-ext-diff", "--no-renames")),
    ):
        content = text(repo, *args)
        if content:
            sections.append(f"### {title}\n{content.rstrip()}")
    untracked = []
    for item in changes:
        if not item["untracked"]:
            continue
        path = item["path"]
        result = git(
            repo,
            "diff",
            "--no-index",
            "--binary",
            "--no-ext-diff",
            "--",
            "/dev/null",
            path,
            check=False,
        )
        if result.returncode not in (0, 1):
            detail = result.stderr.decode("utf-8", "replace").strip()
            raise GitError(f"cannot diff untracked path {path}: {detail}")
        if result.stdout:
            untracked.append(result.stdout.decode("utf-8", "replace").rstrip())
    if untracked:
        sections.append("### untracked\n" + "\n".join(untracked))
    return "\n\n".join(sections) + ("\n" if sections else "")


def inspect(repo, include_diff=False):
    changes = collect_changes(repo)
    identity_ok, required = identity(repo)
    stats, sensitive, large, binary, reasons = risks(repo, changes)
    submodules = submodule_changes(repo, changes)
    if submodules:
        reasons.append("submodule-changes")
    payload = {
        "ok": True,
        "command": "inspect",
        "repo_root": str(repo),
        "head": head(repo),
        "fingerprint": fingerprint(repo, changes),
        "identity_ok": identity_ok,
        "identity_error": (
            None if identity_ok else "git identity does not match AGENTS.md requirement"
        ),
        "required_identity": required,
        "has_changes": bool(changes),
        "changes": changes,
        "numstat": stats,
        "dirty_submodules": submodules,
        "sensitive_paths": sensitive,
        "large_files": large,
        "binary_files": binary,
        "risks": reasons,
    }
    if include_diff:
        payload["diff"] = render_diff(repo, changes)
    return payload


def literal(path):
    return f":(literal){path}"


def path_fingerprint(repo, path):
    digest = hashlib.sha256()
    spec = literal(path)
    digest.update(
        raw(
            repo,
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--no-renames",
            "--",
            spec,
        )
    )
    digest.update(raw(repo, "ls-files", "--stage", "-z", "--", spec))
    hash_path(digest, repo / path)
    return digest.hexdigest()


def staged(repo, paths=None):
    args = ["diff", "--cached", "--name-only", "--no-renames", "-z"]
    if paths is not None:
        args += ["--", *(literal(path) for path in paths)]
    return {os.fsdecode(path) for path in raw(repo, *args).split(b"\0") if path}


def committed(repo, commit):
    output = raw(
        repo,
        "diff-tree",
        "--root",
        "--no-commit-id",
        "--name-only",
        "--no-renames",
        "-r",
        "-z",
        commit,
    )
    return {os.fsdecode(path) for path in output.split(b"\0") if path}


def valid_path(value):
    if not isinstance(value, str) or not value or "\0" in value:
        raise PlanError("each batch path must be a non-empty string")
    parsed = PurePosixPath(value)
    if (
        parsed.is_absolute()
        or value in (".", "..")
        or ".." in parsed.parts
        or str(parsed) != value
    ):
        raise PlanError(f"path must be normalized and repository-relative: {value!r}")
    return value


def validate(plan, snapshot):
    if not isinstance(plan, dict):
        raise PlanError("plan must be a JSON object")
    missing = [
        key
        for key in ("head", "fingerprint")
        if not isinstance(plan.get(key), str) or not plan.get(key)
    ]
    if missing:
        raise PlanError("required plan fields missing: " + ", ".join(missing))
    if plan["head"] != snapshot["head"]:
        raise PlanError("head changed since inspect; re-run inspect")
    if plan["fingerprint"] != snapshot["fingerprint"]:
        raise PlanError("fingerprint changed since inspect; re-run inspect")
    batches = plan.get("batches")
    if not isinstance(batches, list) or not batches:
        raise PlanError("plan must contain a non-empty batches list")
    changed = {item["path"] for item in snapshot["changes"]}
    normalized, seen = [], set()
    for index, batch in enumerate(batches):
        if not isinstance(batch, dict):
            raise PlanError(f"batch {index} must be a JSON object")
        values, message = batch.get("paths"), batch.get("message")
        if not isinstance(values, list) or not values:
            raise PlanError(f"batch {index} must contain paths")
        paths = [valid_path(path) for path in values]
        duplicates = seen.intersection(paths)
        duplicates.update(path for path in paths if paths.count(path) > 1)
        if duplicates:
            raise PlanError("duplicate paths across batches: " + ", ".join(sorted(duplicates)))
        unknown = set(paths) - changed
        if unknown:
            raise PlanError(
                "batch paths are not present in inspected changes: "
                + ", ".join(sorted(unknown))
            )
        if (
            not isinstance(message, str)
            or "\n" in message
            or not COMMIT_RE.fullmatch(message.strip())
            or not CHINESE_RE.search(message)
        ):
            raise PlanError(
                f"batch {index} message must be a Chinese Conventional Commit"
            )
        normalized.append({"paths": paths, "message": message.strip()})
        seen.update(paths)
    return normalized


def report(error, repo=None, results=None, batch_count=0):
    items = results or []
    count = sum(bool(item.get("committed")) for item in items)
    return {
        "ok": False,
        "partial": 0 < count < batch_count,
        "error": error,
        "batches": items,
        "committed_count": count,
        "batch_count": batch_count,
        "final_head": head(repo) if repo else None,
        "final_status": text(repo, "status", "--porcelain").strip() if repo else None,
    }


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def read_plan(path):
    source = path.read_text(encoding="utf-8") if path else sys.stdin.read()
    try:
        return json.loads(source)
    except json.JSONDecodeError as exc:
        raise PlanError(f"invalid plan JSON: {exc}") from exc


def apply_plan(repo, plan_path):
    try:
        snapshot = inspect(repo)
        if not snapshot["identity_ok"]:
            raise PlanError("git identity does not match AGENTS.md requirement")
        if snapshot["dirty_submodules"]:
            raise PlanError("dirty submodules detected; commit submodules separately first")
        batches = validate(read_plan(plan_path), snapshot)
    except (OSError, PlanError) as exc:
        emit(report(str(exc), repo))
        return 2

    expected = {
        path: path_fingerprint(repo, path)
        for batch in batches
        for path in batch["paths"]
    }
    results, failure = [], None
    for index, batch in enumerate(batches):
        paths, message = batch["paths"], batch["message"]
        before_head = head(repo)
        drifted = [
            path for path in paths if path_fingerprint(repo, path) != expected[path]
        ]
        if drifted:
            failure = "batch paths changed during apply: " + ", ".join(drifted)
            results.append(
                {"index": index, "committed": False, "paths": paths, "error": failure}
            )
            break

        unrelated, specs = staged(repo) - set(paths), [literal(path) for path in paths]
        try:
            for path, spec in zip(paths, specs):
                if os.path.lexists(repo / path):
                    raw(repo, "add", "--", spec)
                elif not git(
                    repo, "ls-files", "--error-unmatch", "--", spec, check=False
                ).returncode:
                    raw(repo, "add", "-u", "--", spec)
            actual = staged(repo, paths)
            if actual != set(paths):
                raise GitError(
                    f"staged content mismatch; expected {sorted(paths)}, got {sorted(actual)}"
                )
            check = git(
                repo, "diff", "--cached", "--check", "--", *specs, check=False
            )
            if check.returncode:
                detail = (check.stdout + check.stderr).decode("utf-8", "replace").strip()
                raise GitError("whitespace or conflict marker check failed: " + detail)
            raw(
                repo,
                "commit",
                "--only",
                "-m",
                message,
                "-m",
                CO_AUTHOR,
                "--",
                *specs,
            )
            commit = head(repo)
            actual = committed(repo, commit)
            if actual != set(paths):
                raise GitError(
                    f"committed path mismatch; expected {sorted(paths)}, got {sorted(actual)}"
                )
            missing = unrelated - staged(repo)
            if missing:
                raise GitError(
                    "unrelated staged paths were not preserved: "
                    + ", ".join(sorted(missing))
                )
        except GitError as exc:
            failure = str(exc)
            results.append(
                {
                    "index": index,
                    "committed": head(repo) != before_head,
                    "paths": paths,
                    "error": failure,
                }
            )
            break
        results.append(
            {
                "index": index,
                "committed": True,
                "hash": commit,
                "message": message,
                "paths": paths,
                "remaining_status": text(repo, "status", "--porcelain").strip(),
            }
        )

    if failure:
        emit(report(failure, repo, results, len(batches)))
        return 1
    emit(
        {
            "ok": True,
            "partial": False,
            "error": None,
            "batches": results,
            "committed_count": len(results),
            "batch_count": len(batches),
            "final_head": head(repo),
            "final_status": text(repo, "status", "--porcelain").strip(),
        }
    )
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="git_commit.py")
    commands = parser.add_subparsers(dest="command", required=True)
    inspect_cmd = commands.add_parser("inspect")
    inspect_cmd.add_argument("--repo", type=Path)
    inspect_cmd.add_argument("--diff", action="store_true")
    apply_cmd = commands.add_parser("apply")
    apply_cmd.add_argument("--repo", type=Path)
    apply_cmd.add_argument("plan", type=Path, nargs="?")
    args = parser.parse_args(argv)
    try:
        repo = root(args.repo or Path.cwd())
        if args.command == "inspect":
            emit(inspect(repo, args.diff))
            return 0
        return apply_plan(repo, args.plan)
    except (GitError, OSError) as exc:
        emit(report(str(exc)))
        return 2


if __name__ == "__main__":
    sys.exit(main())
