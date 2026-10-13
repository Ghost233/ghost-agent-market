import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = [
    ROOT / platform / "plugins/mattpocock-skills-zh/skills/wizard/template.sh"
    for platform in ("claude-code-market", "codex-market")
]


class MattWizardTemplateTests(unittest.TestCase):
    def run_library(self, template, directory, body, input_text="", **environment):
        library = re.split(r"(?m)^# STAGES(?:[:：]| —)", template.read_text(), maxsplit=1)[0]
        self.assertNotEqual(library, template.read_text(), "Missing library boundary")
        env = dict(os.environ, ENV_FILE=str(directory / ".env"), **environment)
        return subprocess.run(
            ["/bin/bash", "-c", library + "\n" + body],
            cwd=directory, env=env, input=input_text,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )

    def test_env_values_round_trip_without_shell_expansion(self):
        value = "a'b $HOME $(touch should-not-exist) `touch other-marker` \\ end"
        for template in TEMPLATES:
            with self.subTest(template=template), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                result = self.run_library(
                    template, directory,
                    'write_env TOKEN "$TEST_VALUE"\n'
                    'decoded=$(_existing TOKEN)\n'
                    '[[ "$decoded" == "$TEST_VALUE" ]]\n'
                    '. "$ENV_FILE"\n[[ "$TOKEN" == "$TEST_VALUE" ]]',
                    TEST_VALUE=value,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(stat.S_IMODE((directory / ".env").stat().st_mode), 0o600)
                self.assertFalse((directory / "should-not-exist").exists())
                self.assertFalse((directory / "other-marker").exists())

    def test_env_upsert_preserves_symlink_permissions_and_other_keys(self):
        for template in TEMPLATES:
            with self.subTest(template=template), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                target = directory / "actual.env"
                target.write_text("OTHER=kept\nTOKEN=old\n")
                target.chmod(0o640)
                (directory / ".env").symlink_to(target)
                result = self.run_library(
                    template, directory,
                    'write_env TOKEN "first"\nwrite_env TOKEN "updated"',
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue((directory / ".env").is_symlink())
                self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o640)
                self.assertEqual(target.read_text(), "OTHER=kept\nTOKEN='updated'\n")

    def test_empty_eof_fails_even_with_an_existing_default(self):
        for template in TEMPLATES:
            for function in ("ask", "ask_secret"):
                with self.subTest(template=template, function=function):
                    with tempfile.TemporaryDirectory() as temp:
                        directory = Path(temp)
                        (directory / ".env").write_text("TOKEN='existing'\n")
                        result = self.run_library(template, directory, function + ' TOKEN "prompt"')
                        self.assertNotEqual(result.returncode, 0)

    def test_enter_keeps_default_and_partial_eof_keeps_input(self):
        for template in TEMPLATES:
            for function in ("ask", "ask_secret"):
                for input_text, expected in (("\n", "existing"), ("partial", "partial")):
                    with self.subTest(template=template, function=function, input=input_text):
                        with tempfile.TemporaryDirectory() as temp:
                            directory = Path(temp)
                            (directory / ".env").write_text("TOKEN='existing'\n")
                            result = self.run_library(
                                template, directory,
                                function + ' TOKEN "prompt"\n[[ "$TOKEN" == "$EXPECTED" ]]',
                                input_text=input_text, EXPECTED=expected,
                            )
                            self.assertEqual(result.returncode, 0, result.stderr)

    def test_opener_failure_warns_without_launching_a_browser(self):
        for template in TEMPLATES:
            with self.subTest(template=template), tempfile.TemporaryDirectory() as temp:
                result = self.run_library(
                    template, Path(temp),
                    'wslview() { return 1; }\nopen_url "https://example.invalid/"',
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("https://example.invalid/", result.stdout)
                self.assertIn("无法打开浏览器", result.stdout)


if __name__ == "__main__":
    unittest.main()
