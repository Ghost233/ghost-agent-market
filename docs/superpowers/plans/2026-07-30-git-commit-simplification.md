# Git Commit Skill Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the nested review flow with one executor subagent and a smaller Python 3 safety driver that commits exact batches without stale-snapshot or staged-content leakage.

**Architecture:** The dispatcher only launches one context-free executor and forwards its result. The executor invokes `git_commit.py` exclusively through `python3`: `inspect --diff` produces a complete review snapshot, and `apply` validates a JSON plan before committing exact path batches.

**Tech Stack:** Python 3 standard library, Git CLI, `unittest`, Markdown skill files, JSON plugin manifests.

## Global Constraints

- All runtime script examples and calls use `python3`, never bare `python` or direct script execution.
- The complete Git workflow runs inside one executor subagent; the dispatcher runs no Git command and reads no diff.
- The executor may not create another agent.
- Git writes are allowed only through `python3 <script> apply`.
- Do not push, amend, rewrite history, bypass hooks, or automatically roll back partial failure.
- Keep `Co-Authored-By: Nexus <nexus@xfinite.global>` on every commit.
- Synchronize the shared skill across Claude Code, Codex, and `.codex/skills/git-commit`.
- Bump `ghost-agent-skills` from `0.1.2` to `0.1.3`, then replace only the Codex cachebuster suffix.
- Do not create a Git commit for this implementation unless the user separately authorizes it.

---

### Task 1: Add executable regression coverage for inspection

**Files:**
- Create: `tests/test_git_commit_script.py`
- Modify: `codex-market/plugins/ghost-agent-skills/skills/git-commit/scripts/git_commit.py`

**Interfaces:**
- Consumes: `python3 git_commit.py inspect [--diff] --repo <path>`
- Produces: JSON containing normalized `head`, `fingerprint`, `changes`, `risks`, `dirty_submodules`, and optional `diff`.

- [ ] **Step 1: Create a real temporary-repository test harness**

Use `unittest`, `tempfile.TemporaryDirectory`, and `subprocess.run`. Initialize each repository with:

```python
def init_repo(self) -> Path:
    repo = Path(self.tempdir.name)
    self.git(repo, "init", "-q")
    self.git(repo, "config", "user.name", "Test User")
    self.git(repo, "config", "user.email", "test@example.com")
    (repo / "tracked.txt").write_text("base\n", encoding="utf-8")
    self.git(repo, "add", "tracked.txt")
    self.git(repo, "commit", "-qm", "initial")
    return repo
```

Run the real script through:

```python
subprocess.run(
    ["python3", str(SCRIPT), "inspect", "--diff", "--repo", str(repo)],
    text=True,
    capture_output=True,
    check=False,
)
```

- [ ] **Step 2: Add failing tests for inspection defects**

Cover these observable behaviors:

```python
def test_reports_same_path_as_staged_and_unstaged(self): ...
def test_rename_records_do_not_create_fake_paths(self): ...
def test_fingerprint_changes_when_modified_content_changes(self): ...
def test_diff_and_risks_include_untracked_text_and_binary_files(self): ...
```

Each assertion must inspect JSON fields or diff content rather than source text.

- [ ] **Step 3: Run the tests and verify RED**

Run:

```bash
python3 -m unittest tests.test_git_commit_script -v
```

Expected: failures showing the existing classifier misses dual state, rename parsing is malformed, fingerprint ignores same-status content changes, and untracked content is absent.

- [ ] **Step 4: Replace porcelain parsing with normalized change collection**

Implement focused helpers:

```python
def collect_changes(repo: Path) -> list[dict[str, object]]: ...
def snapshot_fingerprint(repo: Path, changes: list[dict[str, object]]) -> str: ...
def render_diff(repo: Path, changes: list[dict[str, object]]) -> str: ...
def inspect_payload(repo: Path, include_diff: bool) -> dict[str, object]: ...
```

Use NUL-delimited Git output and disable rename compaction where it makes records ambiguous. Hash the cached diff, worktree diff, every untracked file or symlink, HEAD, and submodule status.

- [ ] **Step 5: Run the inspection tests and verify GREEN**

Run:

```bash
python3 -m unittest tests.test_git_commit_script -v
```

Expected: the four inspection regression tests pass with no warnings.

---

### Task 2: Make apply validate plans and isolate commit batches

**Files:**
- Modify: `tests/test_git_commit_script.py`
- Modify: `codex-market/plugins/ghost-agent-skills/skills/git-commit/scripts/git_commit.py`

**Interfaces:**
- Consumes:

```json
{
  "head": "<40-character commit id>",
  "fingerprint": "sha256:<digest>",
  "batches": [
    {
      "paths": ["path/to/file"],
      "message": "fix(scope): 中文说明"
    }
  ]
}
```

- Produces: JSON with `ok`, `partial`, `batches`, `committed_count`, `batch_count`, `final_head`, `final_status`, and `error`.

- [ ] **Step 1: Add failing apply tests**

Add real-repository tests:

```python
def test_apply_commits_only_current_batch_and_preserves_other_staged_files(self): ...
def test_apply_rejects_changed_content_with_same_status(self): ...
def test_apply_rejects_duplicate_paths_across_batches(self): ...
def test_apply_rejects_non_conventional_message(self): ...
def test_apply_reports_hook_failure_without_retry_or_rollback(self): ...
```

For batch isolation, pre-stage an unrelated file, apply a plan for another file, then assert the commit tree excludes the unrelated file while `git diff --cached --name-only` still contains it.

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
python3 -m unittest tests.test_git_commit_script -v
```

Expected: failures reproduce staged leakage, weak fingerprinting, missing schema validation, and insufficient hook reporting.

- [ ] **Step 3: Add strict plan validation**

Implement:

```python
CONVENTIONAL_COMMIT = re.compile(
    r"^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)"
    r"(?:\([^)\\r\\n]+\))?!?:\\s+\\S.+$"
)

def validate_plan(repo: Path, plan: object, snapshot: dict[str, object]) -> list[dict[str, object]]: ...
```

Require non-empty string paths, repository-relative paths, disjoint batches, non-empty messages matching the pattern, and mandatory exact `head` and `fingerprint`.

- [ ] **Step 4: Commit exact paths while preserving unrelated staged entries**

For each validated batch:

1. Record the unrelated index entries.
2. `git add -- <batch paths>`.
3. Run cached `diff --check` for those paths.
4. Commit with an explicit pathspec so other staged paths are excluded.
5. Verify the committed path set equals the batch path set after normalizing rename/delete behavior.
6. Stop on the first failure and report the untouched or partially completed state.

- [ ] **Step 5: Run all script tests and verify GREEN**

Run:

```bash
python3 -m unittest tests.test_git_commit_script -v
```

Expected: all inspection and apply tests pass.

---

### Task 3: Compress the skill to one executor and remove reviewer assets

**Files:**
- Modify: `codex-market/plugins/ghost-agent-skills/skills/git-commit/SKILL.md`
- Delete: `codex-market/plugins/ghost-agent-skills/skills/git-commit/references/reviewer.md`
- Modify: `tests/test_codex_sub_thread_contract.py`
- Modify: `codex-market/README.md`

**Interfaces:**
- Dispatcher creates exactly one `git_commit_executor`.
- Executor calls:

```text
python3 <absolute-script-path> inspect --diff --repo <start-directory>
python3 <absolute-script-path> apply --repo <repo-root> <plan.json>
```

- [ ] **Step 1: Change contract tests to the new runtime behavior**

Replace text-presence assertions for reviewer behavior with contract assertions that:

- require `ROLE=executor`, `task_name="git_commit_executor"`, `fork_turns: "none"`;
- require both explicit `python3` commands;
- require all Git work to remain in executor;
- forbid `ROLE=reviewer`, `references/reviewer.md`, and nested agents;
- synchronize only `SKILL.md` and `scripts/git_commit.py`.

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
python3 -m unittest tests.test_codex_sub_thread_contract -v
```

Expected: the existing skill still contains reviewer behavior and does not include the required Python 3 command shape.

- [ ] **Step 3: Rewrite the canonical SKILL.md**

Keep the body under 500 words and organize it as:

1. one-sentence scope;
2. dispatcher rules;
3. executor workflow;
4. hard safety rules;
5. compact result contract.

The executor must read the skill and applicable `AGENTS.md`, inspect with `python3`, review the full diff itself, build the plan, run `apply` with `python3`, and return once.

- [ ] **Step 4: Delete reviewer.md and update repository copy**

Remove the reviewer reference and change `codex-market/README.md` to describe a single isolated executor with script-enforced validation.

- [ ] **Step 5: Run contract tests and verify GREEN**

Run:

```bash
python3 -m unittest tests.test_codex_sub_thread_contract -v
```

Expected: all Codex contract tests pass.

---

### Task 4: Synchronize all platforms and publish version metadata

**Files:**
- Modify: `.codex/skills/git-commit/SKILL.md`
- Modify: `.codex/skills/git-commit/scripts/git_commit.py`
- Delete: `.codex/skills/git-commit/references/reviewer.md`
- Modify: `claude-code-market/plugins/ghost-agent-skills/skills/git-commit/SKILL.md`
- Modify: `claude-code-market/plugins/ghost-agent-skills/skills/git-commit/scripts/git_commit.py`
- Delete: `claude-code-market/plugins/ghost-agent-skills/skills/git-commit/references/reviewer.md`
- Modify: `tooling/update-ghost-agent-skills.mjs`
- Modify: `codex-market/plugins/ghost-agent-skills/.codex-plugin/plugin.json`
- Modify: `claude-code-market/plugins/ghost-agent-skills/.claude-plugin/plugin.json`

**Interfaces:**
- All four skill/script copies are byte-identical.
- All base versions equal `0.1.3`; Codex additionally has one `+codex.<UTC timestamp>` suffix.

- [ ] **Step 1: Update the repository metadata tool**

Replace `conditional-review` with keywords describing the remaining architecture, such as `explicit-paths` and `content-fingerprint`. Keep `single-executor` and the existing description.

- [ ] **Step 2: Mechanically synchronize the canonical skill and script**

Copy the canonical Codex marketplace `SKILL.md` and `scripts/git_commit.py` to Claude and `.codex`; remove all reviewer references.

- [ ] **Step 3: Bump base versions and cachebuster**

Run:

```bash
node tooling/update-ghost-agent-skills.mjs --bump-base
```

Expected: Claude becomes `0.1.3`; Codex becomes `0.1.3+codex.<UTC timestamp>`.

- [ ] **Step 4: Update version tests and run the full relevant suite**

Run:

```bash
python3 -m unittest \
  tests.test_git_commit_script \
  tests.test_codex_sub_thread_contract \
  tests.test_start_dag_dashboard_skill -v
```

Expected: all tests pass.

- [ ] **Step 5: Validate the Codex skill and plugin**

Run:

```bash
python3 /Users/admin/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  codex-market/plugins/ghost-agent-skills/skills/git-commit
python3 /Users/admin/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py \
  codex-market/plugins/ghost-agent-skills
```

Expected: both validators exit successfully.

- [ ] **Step 6: Perform final repository verification**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Confirm only the planned skill, test, documentation, README, tooling, and manifest files changed. Do not stage or commit.
