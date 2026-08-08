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
import tempfile
from pathlib import Path, PurePosixPath


CO_AUTHOR = "Co-Authored-By: Nexus <nexus@xfinite.global>"
LARGE_FILE_BYTES = 1024 * 1024
COMMIT_RE = re.compile(
    r"^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)"
    r"(?:\([^\)\r\n]+\))?!?:\s+\S.*$"
)
CHINESE_RE = re.compile(r"[\u3400-\u9fff]")
ENV_TEMPLATE_RULE = (
    "environment-template-file",
    re.compile(r"(^|/)\.env(?:\.[^/]+)*\.(example|sample|template)$", re.I),
    "该路径是常见的环境变量模板；模板应只包含占位值，但仍建议审查。",
    "文件名以 .example、.sample 或 .template 结尾",
)
SENSITIVE_CONFIRMATION_RULES = (
    (
        "environment-secret-file",
        re.compile(r"(^|/)\.env($|\.)", re.I),
        "环境变量文件通常可能包含未加密的密码、令牌或密钥。",
        "文件名匹配 .env 或 .env.*，且不是已知模板后缀",
    ),
    (
        "private-key-file",
        re.compile(r"\.(pem|key|p12|pfx|keystore)$", re.I),
        "该文件类型常用于保存私钥或密钥库。",
        "扩展名匹配 .pem、.key、.p12、.pfx 或 .keystore",
    ),
    (
        "ssh-private-key-file",
        re.compile(r"(^|/)(id_rsa|id_ed25519|id_ecdsa|id_dsa)$", re.I),
        "该文件名是常见的 SSH 私钥名称。",
        "文件名匹配常见 SSH 私钥名称",
    ),
    (
        "credential-config-file",
        re.compile(r"(^|/)(\.npmrc|\.pypirc|\.netrc)$", re.I),
        "该配置文件可能直接保存包仓库或网络服务凭据。",
        "文件名匹配 .npmrc、.pypirc 或 .netrc",
    ),
    (
        "credential-directory-data-file",
        re.compile(
            r"(^|/)(credentials?|secrets?|tokens?|oauth)/"
            r"(?:[^/]+/)*[^/]+\.(?:json|ya?ml|toml|ini|conf|config|txt)$",
            re.I,
        ),
        "该数据或配置文件位于名称明确表示凭据、秘密或令牌的目录中。",
        "敏感目录名称与数据/配置扩展名同时匹配",
    ),
    (
        "credential-data-file",
        re.compile(
            r"(^|/)(credentials?|secrets?|tokens?|client[_-]?secret|"
            r"api[_-]?key|access[_-]?token|refresh[_-]?token|"
            r"oauth(?:[_-]?(?:client|credentials?))?)"
            r"(?:$|(?:[._-][A-Za-z0-9_-]+)*"
            r"\.(?:json|ya?ml|toml|ini|conf|config|txt)$)",
            re.I,
        ),
        "该数据或配置文件名明确表示其可能保存凭据、密钥或访问令牌。",
        "文件基名是常见凭据名称，且没有扩展名或使用数据/配置扩展名",
    ),
)
SENSITIVE_WARNING_RULES = (
    (
        "public-certificate-file",
        re.compile(r"\.(cer|cert|certificate|crt)$", re.I),
        "该文件看起来是公开证书而非私钥，因此只提示审查。",
        "扩展名匹配 .cer、.cert、.certificate 或 .crt",
    ),
    (
        "sensitive-path-keyword",
        re.compile(r"credential|secret|oauth|token", re.I),
        "路径含常见安全关键词，但仅凭名称不能判断文件包含秘密内容。",
        "路径名称命中 credential、secret、oauth 或 token 关键词",
    ),
)
MARKDOWN_SUFFIXES = {".md", ".markdown", ".mdx"}
DIFF_CHECK_RE = re.compile(
    r"^(.+):(\d+): "
    r"(trailing whitespace\.|new blank line at EOF\.|"
    r"space before tab in indent\.|leftover conflict marker)$"
)
HUNK_RE = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")
CONFLICT_MARKER_RE = re.compile(r"^(?:<{7}|={7}|>{7})(?: |$)")


class GitError(RuntimeError):
    pass


class PlanError(RuntimeError):
    pass


def git(repo, *args, check=True, env=None):
    process_env = None
    if env:
        process_env = os.environ.copy()
        process_env.update(env)
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True,
            check=False,
            env=process_env,
        )
    except FileNotFoundError as exc:
        raise GitError("git executable not found") from exc
    if check and result.returncode:
        detail = result.stderr.decode("utf-8", "replace").strip()
        raise GitError(f"git {' '.join(args)} failed ({result.returncode}): {detail}")
    return result


def raw(repo, *args, check=True, env=None):
    return git(repo, *args, check=check, env=env).stdout


def text(repo, *args, check=True, env=None):
    return raw(repo, *args, check=check, env=env).decode("utf-8", "replace")


def root(start):
    repo = Path(text(start, "rev-parse", "--show-toplevel").strip()).resolve()
    if not repo.is_dir():
        raise GitError(f"repository root is not a directory: {repo}")
    return repo


def head(repo):
    return text(repo, "rev-parse", "--verify", "HEAD").strip()


def git_metadata(repo):
    git_dir = Path(
        text(repo, "rev-parse", "--absolute-git-dir").strip()
    ).resolve()
    common_dir = Path(text(repo, "rev-parse", "--git-common-dir").strip())
    if not common_dir.is_absolute():
        common_dir = repo / common_dir
    common_dir = common_dir.resolve()
    return {
        "git_dir": str(git_dir),
        "git_common_dir": str(common_dir),
        "linked_worktree": git_dir != common_dir,
    }


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
        "--ignore-submodules=none",
        "--no-renames",
    )


def status_summary(repo):
    return text(
        repo,
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignore-submodules=none",
    ).strip()


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


def risk_finding(path, severity, rule):
    rule_id, _, reason, evidence = rule
    return {
        "path": path,
        "severity": severity,
        "rule_id": rule_id,
        "reason": reason,
        "evidence": evidence,
        "required_action": (
            "明确确认包含该文件，或将其排除"
            if severity == "confirmation-required"
            else "审查文件内容；无需额外确认即可继续"
        ),
    }


def sensitive_findings(paths):
    findings = []
    for path in paths:
        if ENV_TEMPLATE_RULE[1].search(path):
            findings.append(risk_finding(path, "warning", ENV_TEMPLATE_RULE))
            continue
        confirmation_rule = next(
            (
                rule
                for rule in SENSITIVE_CONFIRMATION_RULES
                if rule[1].search(path)
            ),
            None,
        )
        if confirmation_rule:
            findings.append(
                risk_finding(path, "confirmation-required", confirmation_rule)
            )
            continue
        warning_rule = next(
            (rule for rule in SENSITIVE_WARNING_RULES if rule[1].search(path)),
            None,
        )
        if warning_rule:
            findings.append(risk_finding(path, "warning", warning_rule))
    return findings


def risks(repo, changes):
    stats = numstat(repo, changes)
    paths = [item["path"] for item in changes]
    findings = sensitive_findings(paths)
    sensitive = [
        item["path"]
        for item in findings
        if item["severity"] == "confirmation-required"
    ]
    sensitive_warnings = [
        item["path"] for item in findings if item["severity"] == "warning"
    ]
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
            ("sensitive-warnings", sensitive_warnings),
            ("large-files", large),
            ("binary-files", binary),
        )
        if present
    ]
    return stats, sensitive, sensitive_warnings, findings, large, binary, reasons


def submodule_changes(repo, changes):
    recorded = {}
    for record in raw(repo, "ls-tree", "-r", "-z", "HEAD").split(b"\0"):
        header, separator, path = record.partition(b"\t")
        fields = header.split()
        if separator and len(fields) == 3 and fields[0] == b"160000":
            recorded[os.fsdecode(path)] = fields[2].decode()

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
        nested_root = (
            text(nested, "rev-parse", "--show-toplevel", check=False).strip()
            if nested.is_dir()
            else ""
        )
        initialized = bool(
            nested_root
            and Path(nested_root).resolve() == nested.resolve()
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
                "--ignore-submodules=none",
                check=False,
            )
        )
        recorded_head = recorded.get(path)
        pointer_dirty = bool(actual and actual != item["index_head"])
        pointer_update = bool(actual and actual != recorded_head)
        staged_pointer = bool(
            recorded_head and item["index_head"] != recorded_head
        )
        blocking_reasons = []
        if item["merge_conflict"]:
            blocking_reasons.append("merge-conflict")
        if path in changed and not initialized:
            blocking_reasons.append("uninitialized-changed")
        if nested_dirty:
            blocking_reasons.append("worktree-dirty")
        if (
            initialized
            and staged_pointer
            and actual == recorded_head
            and item["index_head"] != actual
        ):
            blocking_reasons.append("staged-pointer-not-checked-out")
        if (
            path in changed
            or nested_dirty
            or pointer_dirty
            or pointer_update
            or staged_pointer
            or item["merge_conflict"]
        ):
            result.append(
                {
                    **item,
                    "recorded_head": recorded_head,
                    "head": actual or None,
                    "worktree_dirty": nested_dirty,
                    "pointer_dirty": pointer_dirty,
                    "pointer_update": pointer_update,
                    "staged_pointer": staged_pointer,
                    "blocking": bool(blocking_reasons),
                    "blocking_reasons": blocking_reasons,
                    "dirty": bool(blocking_reasons),
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
    (
        stats,
        sensitive,
        sensitive_warnings,
        findings,
        large,
        binary,
        reasons,
    ) = risks(repo, changes)
    submodules = submodule_changes(repo, changes)
    blocking_submodules = [item for item in submodules if item["blocking"]]
    gitlink_updates = [
        item
        for item in submodules
        if not item["blocking"] and item["pointer_update"]
    ]
    if submodules:
        reasons.append("submodule-changes")
    if blocking_submodules:
        reasons.append("blocking-submodules")
    if gitlink_updates:
        reasons.append("gitlink-updates")
    payload = {
        "ok": True,
        "command": "inspect",
        "repo_root": str(repo),
        **git_metadata(repo),
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
        "submodules": submodules,
        "blocking_submodules": blocking_submodules,
        "gitlink_updates": gitlink_updates,
        "dirty_submodules": blocking_submodules,
        "sensitive_paths": sensitive,
        "sensitive_warnings": sensitive_warnings,
        "risk_findings": findings,
        "large_files": large,
        "binary_files": binary,
        "risks": reasons,
    }
    if include_diff:
        payload["diff"] = render_diff(repo, changes)
    return payload


def literal(path):
    return f":(literal){path}"


def stage_paths(repo, paths, env=None):
    for path in paths:
        spec = literal(path)
        if os.path.lexists(repo / path):
            raw(repo, "add", "--", spec, env=env)
        elif not git(
            repo,
            "ls-files",
            "--error-unmatch",
            "--",
            spec,
            check=False,
            env=env,
        ).returncode:
            raw(repo, "add", "-u", "--", spec, env=env)


def added_conflict_markers(repo, paths, env):
    issues = []
    for path in paths:
        patch = text(
            repo,
            "diff",
            "--cached",
            "--unified=0",
            "--no-ext-diff",
            "--no-renames",
            "--",
            literal(path),
            env=env,
        )
        line_number = None
        for line in patch.splitlines():
            match = HUNK_RE.match(line)
            if match:
                line_number = int(match.group(1))
                continue
            if line_number is None or line.startswith(("diff ", "index ", "---", "+++")):
                continue
            if line.startswith("+"):
                if CONFLICT_MARKER_RE.match(line[1:]):
                    issues.append(
                        {
                            "path": path,
                            "line": line_number,
                            "kind": "leftover conflict marker",
                        }
                    )
                line_number += 1
            elif not line.startswith("-"):
                line_number += 1
    return issues


def diff_check(repo, paths):
    with tempfile.TemporaryDirectory(prefix="git-commit-index-") as directory:
        env = {
            "GIT_INDEX_FILE": str(Path(directory) / "index"),
            "LC_ALL": "C",
        }
        raw(repo, "read-tree", "HEAD", env=env)
        stage_paths(repo, paths, env=env)
        result = git(
            repo,
            "diff",
            "--cached",
            "--check",
            "--",
            *(literal(path) for path in paths),
            check=False,
            env=env,
        )
        return result, added_conflict_markers(repo, paths, env)


def parse_diff_check(result):
    detail = (result.stdout + result.stderr).decode("utf-8", "replace").strip()
    issues, unknown = [], []
    for line in detail.splitlines():
        match = DIFF_CHECK_RE.match(line)
        if match:
            issues.append(
                {
                    "path": match.group(1),
                    "line": int(match.group(2)),
                    "kind": match.group(3)[:-1],
                }
            )
        elif not line.startswith(("+", "-")):
            unknown.append(line)
    return issues, unknown, detail


def line_ending(line):
    if line.endswith("\r\n"):
        return line[:-2], "\r\n"
    if line.endswith(("\n", "\r")):
        return line[:-1], line[-1]
    return line, ""


def repair_simple_whitespace(repo, paths, issues):
    selected = set(paths)
    grouped = {}
    blocked = []
    for issue in issues:
        if issue["path"] not in selected:
            blocked.append(issue)
            continue
        grouped.setdefault(issue["path"], []).append(issue)

    repairs, allowed = [], []
    for relative, path_issues in grouped.items():
        path = repo / relative
        if not path.is_file() or path.is_symlink():
            blocked.extend(path_issues)
            continue
        try:
            source = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            blocked.extend(path_issues)
            continue

        lines = source.splitlines(keepends=True)
        changed = False
        for issue in path_issues:
            kind, number = issue["kind"], issue["line"]
            if kind == "leftover conflict marker" or kind == "space before tab in indent":
                blocked.append(issue)
                continue
            if kind == "trailing whitespace":
                if not 1 <= number <= len(lines):
                    blocked.append(issue)
                    continue
                body, ending = line_ending(lines[number - 1])
                match = re.search(r"[ \t]+$", body)
                if not match:
                    blocked.append(issue)
                    continue
                suffix = match.group(0)
                if path.suffix.lower() in MARKDOWN_SUFFIXES and suffix == "  ":
                    allowed.append(
                        {
                            "path": relative,
                            "line": number,
                            "action": "preserve-markdown-hard-break",
                        }
                    )
                    continue
                lines[number - 1] = body[: match.start()] + ending
                changed = True
                repairs.append(
                    {
                        "path": relative,
                        "line": number,
                        "action": "remove-trailing-whitespace",
                    }
                )

        eof_issues = [
            issue
            for issue in path_issues
            if issue["kind"] == "new blank line at EOF"
        ]
        if eof_issues:
            original_length = len(lines)
            while len(lines) > 1:
                body, _ = line_ending(lines[-1])
                if body:
                    break
                lines.pop()
            if len(lines) != original_length:
                changed = True
                repairs.append(
                    {
                        "path": relative,
                        "line": eof_issues[0]["line"],
                        "action": "remove-extra-eof-blank-lines",
                    }
                )
            else:
                blocked.extend(eof_issues)

        if changed:
            path.write_text("".join(lines), encoding="utf-8", newline="")
    return repairs, allowed, blocked


def preflight_batch(repo, paths):
    repairs, allowed = [], []
    for _ in range(2):
        result, conflict_issues = diff_check(repo, paths)
        if result.returncode == 0 and not conflict_issues:
            return repairs, allowed
        issues, unknown, detail = parse_diff_check(result)
        issues.extend(conflict_issues)
        if conflict_issues:
            marker_detail = "\n".join(
                f"{issue['path']}:{issue['line']}: leftover conflict marker"
                for issue in conflict_issues
            )
            detail = "\n".join(part for part in (detail, marker_detail) if part)
        if unknown or not issues:
            raise GitError("whitespace or conflict marker check failed: " + detail)
        fixed, accepted, blocked = repair_simple_whitespace(repo, paths, issues)
        repairs.extend(fixed)
        allowed.extend(accepted)
        if blocked:
            raise GitError("whitespace or conflict marker check failed: " + detail)
        if not fixed:
            return repairs, allowed
    result, conflict_issues = diff_check(repo, paths)
    if result.returncode or conflict_issues:
        _, _, detail = parse_diff_check(result)
        if conflict_issues:
            detail = "\n".join(
                [detail]
                + [
                    f"{issue['path']}:{issue['line']}: leftover conflict marker"
                    for issue in conflict_issues
                ]
            ).strip()
        raise GitError("whitespace or conflict marker check failed: " + detail)
    return repairs, allowed


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
            "--ignore-submodules=none",
            "--no-renames",
            "--",
            spec,
        )
    )
    index_entry = raw(repo, "ls-files", "--stage", "-z", "--", spec)
    digest.update(index_entry)
    hash_path(digest, repo / path)
    is_gitlink = any(
        record.partition(b"\t")[0].split()[:1] == [b"160000"]
        for record in index_entry.split(b"\0")
        if record
    )
    if is_gitlink:
        nested = repo / path
        digest.update(b"GITLINK\0")
        digest.update(
            text(nested, "rev-parse", "HEAD", check=False).strip().encode()
            + b"\0"
        )
        digest.update(
            raw(
                nested,
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=all",
                "--ignore-submodules=none",
                check=False,
            )
        )
    return digest.hexdigest()


def workspace_state(repo, excluded):
    return {
        item["path"]: path_fingerprint(repo, item["path"])
        for item in collect_changes(repo)
        if item["path"] not in excluded
    }


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
        "final_status": status_summary(repo) if repo else None,
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
        if snapshot["blocking_submodules"]:
            details = ", ".join(
                f"{item['path']}[{','.join(item['blocking_reasons'])}]"
                for item in snapshot["blocking_submodules"]
            )
            raise PlanError(
                "blocking submodules detected: " + details
            )
        batches = validate(read_plan(plan_path), snapshot)
    except (OSError, PlanError) as exc:
        emit(report(str(exc), repo))
        return 2

    preflight = []
    try:
        for batch in batches:
            repairs, allowed = preflight_batch(repo, batch["paths"])
            preflight.append({"repairs": repairs, "allowed": allowed})
    except GitError as exc:
        emit(report(str(exc), repo, batch_count=len(batches)))
        return 1

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

        repairs = list(preflight[index]["repairs"])
        allowed = list(preflight[index]["allowed"])
        retry_count = 0
        unrelated, specs = staged(repo) - set(paths), [literal(path) for path in paths]
        try:
            stage_paths(repo, paths)
            actual = staged(repo, paths)
            if actual != set(paths):
                raise GitError(
                    f"staged content mismatch; expected {sorted(paths)}, got {sorted(actual)}"
                )
            while True:
                selected_before = {
                    path: path_fingerprint(repo, path) for path in paths
                }
                unrelated_before = workspace_state(repo, set(paths))
                commit_result = git(
                    repo,
                    "commit",
                    "--only",
                    "-m",
                    message,
                    "-m",
                    CO_AUTHOR,
                    "--",
                    *specs,
                    check=False,
                )
                if commit_result.returncode == 0:
                    break
                detail = (commit_result.stdout + commit_result.stderr).decode(
                    "utf-8", "replace"
                ).strip()
                if head(repo) != before_head:
                    raise GitError(
                        "git commit returned failure after creating a commit; "
                        "refusing automatic retry: " + detail
                    )
                selected_changed = any(
                    path_fingerprint(repo, path) != selected_before[path]
                    for path in paths
                )
                unrelated_unchanged = (
                    workspace_state(repo, set(paths)) == unrelated_before
                )
                if results or retry_count or not selected_changed or not unrelated_unchanged:
                    raise GitError(
                        f"git commit failed ({commit_result.returncode}): {detail}"
                    )

                retry_count = 1
                hook_repairs, hook_allowed = preflight_batch(repo, paths)
                repairs.extend(hook_repairs)
                allowed.extend(hook_allowed)
                repairs.append(
                    {
                        "paths": paths,
                        "action": "retry-after-hook-updated-selected-paths",
                    }
                )
                for path in paths:
                    expected[path] = path_fingerprint(repo, path)
                stage_paths(repo, paths)
                actual = staged(repo, paths)
                if actual != set(paths):
                    raise GitError(
                        "staged content mismatch after hook repair; "
                        f"expected {sorted(paths)}, got {sorted(actual)}"
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
                    "repairs": repairs,
                    "allowed_whitespace": allowed,
                    "retry_count": retry_count,
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
                "repairs": repairs,
                "allowed_whitespace": allowed,
                "retry_count": retry_count,
                "remaining_status": status_summary(repo),
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
            "final_status": status_summary(repo),
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
