#!/usr/bin/env python3
"""Bind a repository's local identity and GitHub HTTPS credentials."""

import argparse
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
from urllib.parse import unquote, urlsplit, urlunsplit


def git(project, *args):
    return subprocess.run(
        ["git", "-C", str(project)] + list(args),
        check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    ).stdout.strip()


def configure(project, account, profile, name, email):
    project = Path(project).resolve()
    profile = Path(profile).resolve()
    if Path(git(project, "rev-parse", "--show-toplevel")).resolve() != project:
        raise ValueError("Use the target repository root as --project.")
    if not profile.is_dir():
        raise ValueError("Verify an existing account directory before configuring Git.")
    if not all(value.strip() for value in (account, name, email)):
        raise ValueError("Account, commit name and email must be supplied.")

    urls = set()
    for remote in git(project, "remote").splitlines():
        for flags in (("--all",), ("--push", "--all")):
            for value in git(project, "remote", "get-url", *flags, remote).splitlines():
                url = urlsplit(value)
                if url.scheme != "https" or url.hostname != "github.com":
                    continue
                if url.password is not None:
                    raise ValueError("A GitHub remote contains credentials; resolve its URL first.")
                if url.username and unquote(url.username).lower() != account.lower():
                    raise ValueError("A GitHub remote username differs from the selected account.")
                host = url.netloc.rsplit("@", 1)[-1].lower()
                urls.add(urlunsplit(("https", host, url.path, "", "")))

    helper = None
    if urls:
        executable = shutil.which("gh")
        if not executable:
            raise ValueError("gh is required for GitHub HTTPS credentials.")
        helper = "!env -u GH_TOKEN -u GITHUB_TOKEN -u GH_DEBUG GH_CONFIG_DIR={} {} auth git-credential".format(
            shlex.quote(str(profile)), shlex.quote(str(Path(executable).resolve())),
        )

    git(project, "config", "--local", "user.name", name)
    git(project, "config", "--local", "user.email", email)
    if helper:
        for url in ["https://github.com"] + sorted(urls):
            key = "credential." + url
            git(project, "config", "--local", key + ".username", account)
            git(project, "config", "--local", "--replace-all", key + ".helper", "")
            git(project, "config", "--local", "--add", key + ".helper", helper)
    return len(urls)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ("project", "account", "profile", "name", "email"):
        parser.add_argument("--" + option, required=True)
    args = parser.parse_args()
    try:
        count = configure(args.project, args.account, args.profile, args.name, args.email)
    except (ValueError, subprocess.CalledProcessError) as error:
        message = str(error) if isinstance(error, ValueError) else "Git configuration command failed."
        print(message, file=sys.stderr)
        return 1
    print("Local commit identity configured; GitHub HTTPS URLs bound: {}.".format(count))
    return 0


if __name__ == "__main__":
    sys.exit(main())
