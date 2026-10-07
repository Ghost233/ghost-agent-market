from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "codex-market/plugins/ghost-agent-skills/skills/configure-gh-account/scripts/configure_local_git.py"
spec = importlib.util.spec_from_file_location("configure_local_git", SCRIPT)
configure_git = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configure_git)


class ConfigureLocalGitTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="gh local git ")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.global_config = self.root / "global.gitconfig"
        self.global_config.touch()
        tools = self.root / "tools with ' quotes"
        tools.mkdir()
        gh = tools / "gh"
        gh.write_text(
            "#!" + sys.executable + "\n"
            "import json, os, pathlib, sys\n"
            "assert sys.argv[1:] == ['auth', 'git-credential', 'get']\n"
            "assert not any(k in os.environ for k in ('GH_TOKEN', 'GITHUB_TOKEN', 'GH_DEBUG'))\n"
            "data = json.loads((pathlib.Path(os.environ['GH_CONFIG_DIR']) / 'account.json').read_text())\n"
            "print('username=' + data['account'])\n"
            "print('password=' + data['token'])\n",
            encoding="utf-8",
        )
        gh.chmod(0o755)
        self.env = dict(
            os.environ, PATH=str(tools) + os.pathsep + os.environ["PATH"],
            GIT_CONFIG_GLOBAL=str(self.global_config), GIT_CONFIG_NOSYSTEM="1",
            GIT_TERMINAL_PROMPT="0", GH_CONFIG_DIR="/wrong/environment/profile",
            GH_TOKEN="wrong-token", GITHUB_TOKEN="wrong-token", GH_DEBUG="api",
        )
        for key in ("GIT_CONFIG_COUNT", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"):
            self.env.pop(key, None)
        self.git(None, "config", "--file", str(self.global_config), "user.name", "Wrong")
        self.git(None, "config", "--file", str(self.global_config), "user.email", "wrong@example.com")
        self.git(None, "config", "--file", str(self.global_config), "credential.https://github.com.helper", "!printf 'username=wrong\npassword=wrong\n'")
        self.git(None, "config", "--file", str(self.global_config), "credential.https://github.com/ExampleOrg.username", "Wrong")
        self.git(None, "config", "--file", str(self.global_config), "credential.https://gitlab.com.helper", "!printf 'username=gitlab\npassword=gitlab-token\n'")

    def git(self, repository, *args, input_text=None):
        command = ["git"] + (["-C", str(repository)] if repository else []) + list(args)
        return subprocess.run(command, env=self.env, text=True, input=input_text, capture_output=True, check=True).stdout

    def repository(self, name, url):
        repository = self.root / name
        repository.mkdir()
        self.git(repository, "init")
        self.git(repository, "remote", "add", "origin", url)
        return repository

    def profile(self, account):
        directory = self.root / (account + " profile's directory")
        directory.mkdir()
        (directory / "account.json").write_text(json.dumps({"account": account, "token": account + "-token"}))
        return directory

    def configure(self, repository, account, profile):
        return configure_git.configure(repository, account, profile, account + " Name", account.lower() + "@example.com")

    def credentials(self, repository, url):
        output = self.git(repository, "credential", "fill", input_text="url=" + url + "\n\n")
        return dict(line.split("=", 1) for line in output.splitlines() if "=" in line)

    def test_concurrent_accounts_are_local_and_override_inherited_helpers(self):
        url = "https://github.com/ExampleOrg/repository.git"
        first = self.repository("first", url)
        second = self.repository("second", url)
        profiles = [self.profile(account) for account in ("First", "Second")]
        original_global = self.global_config.read_bytes()
        with patch.dict(os.environ, self.env, clear=True):
            with ThreadPoolExecutor(max_workers=2) as executor:
                jobs = [executor.submit(self.configure, repo, account, profile) for repo, account, profile in zip((first, second), ("First", "Second"), profiles)]
                self.assertEqual([job.result() for job in jobs], [1, 1])
            self.configure(first, "First", profiles[0])
        for repository, account in ((first, "First"), (second, "Second")):
            self.assertEqual(self.git(repository, "config", "--local", "user.name").strip(), account + " Name")
            self.assertEqual(self.git(repository, "config", "--local", "user.email").strip(), account.lower() + "@example.com")
            self.assertIn(account + " Name <" + account.lower() + "@example.com>", self.git(repository, "var", "GIT_AUTHOR_IDENT"))
            values = self.git(repository, "config", "--local", "--get-all", "credential.https://github.com.helper").splitlines()
            self.assertEqual(len(values), 2)
            self.assertEqual(values[0], "")
            actual = self.credentials(repository, url)
            self.assertEqual(actual["username"], account)
            self.assertEqual(actual["password"], account + "-token")
            self.assertEqual(self.credentials(repository, "https://gitlab.com/org/repository.git")["username"], "gitlab")
        self.assertEqual(self.global_config.read_bytes(), original_global)

    def test_remote_username_mismatch_stops_before_local_writes(self):
        repository = self.repository("mismatch", "https://Other@github.com/org/repository.git")
        original = (repository / ".git/config").read_bytes()
        with patch.dict(os.environ, self.env, clear=True):
            with self.assertRaisesRegex(ValueError, "username differs"):
                self.configure(repository, "First", self.profile("First"))
        self.assertEqual((repository / ".git/config").read_bytes(), original)

    def test_ssh_keeps_authentication_configuration_and_writes_identity(self):
        repository = self.repository("ssh", "git@github.com:org/repository.git")
        self.git(repository, "config", "--local", "core.sshCommand", "ssh -i existing-key")
        with patch.dict(os.environ, self.env, clear=True):
            self.assertEqual(self.configure(repository, "First", self.profile("First")), 0)
        self.assertEqual(self.git(repository, "config", "--local", "core.sshCommand").strip(), "ssh -i existing-key")
        self.assertEqual(self.git(repository, "remote", "get-url", "origin").strip(), "git@github.com:org/repository.git")
        self.assertEqual(self.git(repository, "config", "--local", "user.name").strip(), "First Name")


if __name__ == "__main__":
    unittest.main()
