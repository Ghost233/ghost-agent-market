# ZCode Agent Skills and Transactional Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the 11 canonical user Agents and 8 shared Skills through a Registry-driven, pinned-ref, backup-and-rollback installer.

**Architecture:** Agent templates define narrow execution identities; Skills define shared operation flows and fail closed against Registry/Binding mismatches. Installer V2 downloads one Registry and every template at one immutable ref, validates everything before touching the destination, backs up all managed paths, stages replacements, removes declared legacy Agents, writes a sidecar last, and rolls back on any failure.

**Tech Stack:** Python 3.11 standard library, Markdown/YAML scalar frontmatter, JSON, GitHub Raw HTTPS.

## Global Constraints

- Inherit master constraints and consume final Registry/runtime operation interfaces from Plans 01–03.
- Continue installing into `~/.zcode/agents/` via online GitHub Raw only.
- Workflow semantic Agents always render `model: inherit`; installer model overrides apply only to Utility/Git Agents.
- Unrelated user Agents are never read, modified or deleted.
- Old Agent bodies are backed up but never merged into canonical templates.

---

### Task 1: Create the six shared workflow Skills

**Files:**
- Create:
  - `zcode-market/plugins/ghost-agent-workflow/skills/workflow-coordination/SKILL.md`
  - `zcode-market/plugins/ghost-agent-workflow/skills/workflow-planning/SKILL.md`
  - `zcode-market/plugins/ghost-agent-workflow/skills/workflow-planning/references/templates.md`
  - `zcode-market/plugins/ghost-agent-workflow/skills/workflow-plan-review/SKILL.md`
  - `zcode-market/plugins/ghost-agent-workflow/skills/workflow-bound-run/SKILL.md`
  - `zcode-market/plugins/ghost-agent-workflow/skills/workflow-bound-run/references/templates.md`
  - `zcode-market/plugins/ghost-agent-workflow/skills/workflow-config/SKILL.md`
  - `zcode-market/plugins/ghost-agent-workflow/skills/workflow-dashboard/SKILL.md`
- Modify:
  - `zcode-market/plugins/ghost-agent-skills/skills/git-commit/SKILL.md`
  - `zcode-market/plugins/ghost-agent-skills/skills/git-merge-conflict/SKILL.md`
- Test: `tests/test_zcode_agent_registry.py`

**Interfaces:**
- Consumes: Registry Skill IDs/operations and public runtime/config/dashboard CLI.
- Produces: 8 Skill contracts with ZCode independent-copy notice.

- [ ] **Step 1: Add failing Skill path and operation tests**

Extend Registry tests to assert every Skill path exists, frontmatter name equals the unqualified tail, independent-copy notice exists, every referenced file exists, and each Skill text names its Registry operations.

- [ ] **Step 2: Run and observe missing Skill failures**

```bash
python3 -m unittest tests.test_zcode_agent_registry -v
```

Expected: FAIL for new paths.

- [ ] **Step 3: Write `workflow-coordination`**

Document Main's loop:

```text
workflow next-actions
→ dispatch batch/runtime action/user action/completed/failed
→ use receipt fields verbatim
→ parallel-call independent jobs
→ workflow reconcile
```

Main must not guess Agents, edit state or dispatch Main/Supervisor.

- [ ] **Step 4: Write planning/review/bound-run Skills**

Each Skill starts with exact Agent/Operation/permission/revision/digest validation. `workflow-bound-run` distinguishes owner and implementation review by Registry operation, not by free-form choice. Reviewer write scope must be empty.

- [ ] **Step 5: Write config/dashboard Skills**

Explicit allowlists:

```text
workflow-config-reader → show_strict, validate_strict
workflow-config-writer → init, migrate, set_parallel, set_execution_class
workflow-dashboard-starter → start_dashboard
workflow-dashboard-status-reader → read_dashboard_status
workflow-dashboard-stopper → stop_dashboard
```

Stopper requires explicit user authorization and descriptor token.

- [ ] **Step 6: Update retained Git Skills**

Keep existing behavior and scripts, add Registry operation identity and fail-closed one-action wording. Preserve independent-copy note.

- [ ] **Step 7: Run Skill contract tests**

```bash
python3 -m unittest tests.test_zcode_agent_registry -v
```

Expected: Skill-related tests PASS; templates may still fail until Task 2.

- [ ] **Step 8: Record logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): add shared stateless workflow skills`.

---

### Task 2: Create the 11 canonical Agent templates and finalize template digests

**Files:**
- Create nine workflow templates under `zcode-market/agent-templates/ghost-agent-workflow/`:
  - `workflow-planner.md`
  - `workflow-plan-reviewer.md`
  - `workflow-owner.md`
  - `workflow-implementation-reviewer.md`
  - `workflow-config-reader.md`
  - `workflow-config-writer.md`
  - `workflow-dashboard-starter.md`
  - `workflow-dashboard-status-reader.md`
  - `workflow-dashboard-stopper.md`
- Modify retained Git templates.
- Modify: `zcode-market/agent-registry.json` template hashes.
- Test: `tests/test_zcode_agent_registry.py`

**Interfaces:**
- Produces exact bytes whose hashes are stored in the Registry.

- [ ] **Step 1: Add failing template identity tests**

Assert exact canonical file set, frontmatter `name`, nonempty description, `model: inherit`, fixed Skill token, allowed operations, no Agent-to-Agent wording, and Registry SHA-256 equality.

- [ ] **Step 2: Run and observe missing template failures**

```bash
python3 -m unittest tests.test_zcode_agent_registry -v
```

Expected: FAIL.

- [ ] **Step 3: Write semantic workflow templates**

Each template contains:

```yaml
---
name: workflow-owner
description: 执行 Runtime Binding 明确授权的一个 Quick 或 DAG Owner action。
model: inherit
---
```

Body states one fixed Skill, allowed operations, permission class, Binding checks, one operation per invocation and no Agent creation/wait/message.

- [ ] **Step 4: Write utility templates**

Reader/write/start/status/stop boundaries must match the shared Skills exactly. All base templates use `model: inherit`; installer policy later allows direct model metadata only on Utility/Git installs.

- [ ] **Step 5: Update Git templates**

Retain the existing names and script-driven safety behavior; add `model: inherit` to the canonical base template and the one Registry operation.

- [ ] **Step 6: Compute and write exact template hashes**

Use a short Python command over exact UTF-8 bytes to update each `template_sha256` in the Registry. Do not normalize line endings before hashing.

- [ ] **Step 7: Run Registry/template tests**

```bash
python3 -m unittest tests.test_zcode_agent_registry -v
python3 -m json.tool zcode-market/agent-registry.json >/dev/null
```

Expected: PASS.

- [ ] **Step 8: Record logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): add canonical user agent templates`.

---

### Task 3: Refactor installer around immutable Registry data

**Files:**
- Modify: `zcode-market/install-agents.py`
- Create: `tests/test_zcode_installer.py`

**Interfaces:**
- Consumes: Registry contract and canonical templates.
- Produces immutable dataclasses and pure functions described below.

- [ ] **Step 1: Write failing Registry-download and zero-write tests**

Tests:

```text
test_installer_downloads_registry_and_all_templates_before_any_write
test_registry_validation_failure_has_zero_destination_writes
test_template_validation_failure_has_zero_destination_writes
test_network_failure_has_zero_destination_writes
test_installer_uses_one_fixed_ref_for_registry_and_templates
test_installer_rejects_mutable_main_ref
```

Use injected fetch functions and a nonexistent destination. Assert the directory remains absent after preflight failure.

- [ ] **Step 2: Run and observe hardcoded V1 failures**

```bash
python3 -m unittest tests.test_zcode_installer -v
```

Expected: FAIL.

- [ ] **Step 3: Add immutable dataclasses**

Implement frozen dataclasses with these exact fields:

```python
@dataclass(frozen=True)
class SkillSpec:
    id: str
    plugin: str
    path: str
    operations: tuple[str, ...]
    consumers: tuple[str, ...]

@dataclass(frozen=True)
class MetadataPolicy:
    model: Literal["template_inherit", "preserve_or_global"]
    color: Literal["preserve"]

@dataclass(frozen=True)
class AgentSpec:
    id: str
    plugin: str
    skill: str
    operations: tuple[str, ...]
    permission_class: str
    execution_class: Literal["main", "lite"] | None
    execution_class_config_key: Literal["planner", "planner_reviewer", "owner", "review"] | None
    template: str
    template_sha256: str
    metadata_policy: MetadataPolicy
    replaces: tuple[str, ...]

@dataclass(frozen=True)
class LegacyAgentSpec:
    id: str
    replacements: tuple[str, ...]
    remove: bool

@dataclass(frozen=True)
class BundleSpec:
    contract: Literal["ZCODE_AGENT_BUNDLE_V2"]
    bundle_version: str
    source_repository: str
    template_root: str
    allowed_custom_metadata: tuple[Literal["model", "color"], ...]
    skills: tuple[SkillSpec, ...]
    agents: tuple[AgentSpec, ...]
    legacy_agents: tuple[LegacyAgentSpec, ...]

@dataclass(frozen=True)
class FrontmatterDocument:
    metadata: Mapping[str, str]
    body: str
    had_trailing_newline: bool

@dataclass(frozen=True)
class ValidatedTemplate:
    agent: AgentSpec
    raw: bytes
    document: FrontmatterDocument

@dataclass(frozen=True)
class DownloadedBundle:
    source_ref: str
    registry_raw: bytes
    registry_digest: str
    spec: BundleSpec
    templates: Mapping[str, ValidatedTemplate]

@dataclass(frozen=True)
class CustomMetadata:
    model: str | None
    color: str | None

@dataclass(frozen=True)
class FileSnapshot:
    path: Path
    existed: bool
    content: bytes | None
    mode: int | None

@dataclass(frozen=True)
class InstallationSnapshot:
    files: tuple[FileSnapshot, ...]
    digest: str

@dataclass(frozen=True)
class StagedAgent:
    agent: AgentSpec
    stage_path: Path
    destination: Path
    content: bytes
    metadata: CustomMetadata

@dataclass(frozen=True)
class InstallPlan:
    source_ref: str
    bundle: DownloadedBundle
    snapshot: InstallationSnapshot
    staged_agents: tuple[StagedAgent, ...]
    legacy_removals: tuple[Path, ...]
    metadata_migrations: tuple[dict[str, object], ...]

@dataclass(frozen=True)
class BackupManifest:
    root: Path
    manifest_path: Path
    snapshot: InstallationSnapshot

@dataclass(frozen=True)
class InstallReceipt:
    status: Literal["installed", "unchanged", "rolled_back", "failed"]
    bundle_version: str
    source_ref: str
    contract_digest: str
    installed: tuple[str, ...]
    unchanged: tuple[str, ...]
    removed_legacy: tuple[str, ...]
    metadata_migrations: tuple[dict[str, object], ...]
    backup_path: str | None
    sidecar_path: str
    restart_required: bool
```

- [ ] **Step 4: Implement pinned-ref and fetch APIs**

```python
def validate_source_ref(ref: str) -> str
def raw_url(ref: str, repository_path: str) -> str
def fetch_bytes(repository_path: str, ref: str, *, opener=urlopen, timeout=30.0) -> bytes
def parse_registry(raw: bytes) -> BundleSpec
def validate_registry(bundle: BundleSpec) -> None
def download_bundle(ref: str, *, fetch=fetch_bytes) -> DownloadedBundle
def validate_bundle(downloaded: DownloadedBundle) -> None
```

Accept full 40-hex commit or `zcode-agent-bundle-v<semver>`. Reject `main`, `master`, `HEAD`, branches and newlines.

- [ ] **Step 5: Implement restricted frontmatter and template validation**

```python
def parse_frontmatter(markdown: str) -> FrontmatterDocument
def validate_template(bundle: BundleSpec, agent: AgentSpec, raw: bytes) -> ValidatedTemplate
```

Check exact digest, name, `model: inherit`, fixed Skill token, bounded-agent text and UTF-8. Preflight writes nothing.

- [ ] **Step 6: Run preflight tests**

```bash
python3 -m unittest tests.test_zcode_installer -v
```

Expected: preflight and pinned-ref tests PASS; transaction tests pending.

- [ ] **Step 7: Record logical commit boundary**

No commit without authorization. Logical message: `refactor(zcode): load agent bundle from registry`.

---

### Task 4: Implement metadata migration and deterministic rendering

**Files:**
- Modify installer.
- Test: `tests/test_zcode_installer.py`

**Interfaces:**
- Produces:
  - `read_custom_metadata()`
  - `collect_metadata_sources()`
  - `resolve_agent_metadata()`
  - `render_agent()`

- [ ] **Step 1: Add failing metadata tests**

Tests:

```text
test_one_to_many_legacy_metadata_is_copied_to_each_replacement
test_workflow_agent_preserves_color_but_forces_model_inherit
test_utility_agent_preserves_legacy_model_and_color
test_global_model_override_applies_only_to_utility_and_git_agents
test_explicit_model_override_rejects_workflow_execution_agent
test_custom_legacy_body_is_backed_up_but_not_merged
```

- [ ] **Step 2: Run and observe failures**

Expected: V1 installer overwrites model only and has no color/legacy policy.

- [ ] **Step 3: Implement metadata collection**

Read only `model` and `color`; reject managed symlinks/non-regular files. Support quoted/unquoted scalar frontmatter.

- [ ] **Step 4: Implement exact precedence**

Workflow semantic agents: always `model: inherit`; preserve canonical color, else legacy color. Emit notice when discarding legacy model.

Utility/Git: explicit `--agent-model`, canonical model, legacy model, global `--model`, template model. Preserve canonical/legacy color.

- [ ] **Step 5: Implement canonical rendering**

Only allowed metadata changes; exact template body. Never merge custom body.

- [ ] **Step 6: Run metadata tests**

```bash
python3 -m unittest tests.test_zcode_installer -v
```

Expected: metadata tests PASS.

- [ ] **Step 7: Record logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): migrate safe agent metadata`.

---

### Task 5: Implement whole-bundle backup, staging, lock and rollback

**Files:**
- Modify installer.
- Test: `tests/test_zcode_installer.py`

**Interfaces:**
- Produces transaction APIs from the confirmed design.

- [ ] **Step 1: Add failing transaction tests**

Tests:

```text
test_installer_creates_complete_backup_before_replacement
test_success_installs_eleven_canonical_agents_and_removes_legacy_agents
test_unmanaged_user_agents_are_untouched
test_transaction_failure_rolls_back_every_managed_file
test_sidecar_write_failure_rolls_back_agents_and_legacy_deletions
test_rollback_removes_files_that_did_not_exist_before_install
test_installer_lock_prevents_concurrent_replacement
test_snapshot_drift_before_lock_aborts_without_replacement
test_managed_symlink_is_rejected_without_following_it
test_reinstall_is_idempotent
```

- [ ] **Step 2: Run and observe failures**

Expected: FAIL.

- [ ] **Step 3: Implement snapshot and backup**

```python
def snapshot_installation(...)
def create_backup(...)
```

Snapshot canonical targets, removable legacy files and sidecar, including missing paths and modes. Backup location:

```text
~/.zcode/agent-backups/ghost-agent-market/<UTC>-<bundle>-<nonce>/
```

- [ ] **Step 4: Implement staging and cross-platform lock**

Stage all 11 files in the same destination filesystem before replacement. Implement lock by atomically creating `.ghost-agent-market.lock` with exclusive create and unique token; do not depend on `fcntl`.

- [ ] **Step 5: Implement replacement and rollback**

Under lock, verify snapshot unchanged, `os.replace` canonical files, remove only Registry `remove: true` legacy files, write sidecar last. Any post-replacement failure restores all previous bytes/modes and removes newly created paths.

- [ ] **Step 6: Implement idempotence**

If canonical bytes, legacy absence and sidecar already match the downloaded bundle, return unchanged without a new backup.

- [ ] **Step 7: Run transaction tests**

```bash
python3 -m unittest tests.test_zcode_installer -v
```

Expected: PASS.

- [ ] **Step 8: Record logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): install agent bundles transactionally`.

---

### Task 6: Add Sidecar V2 and JSON receipt CLI

**Files:**
- Modify installer.
- Test: `tests/test_zcode_installer.py`

**Interfaces:**
- Produces `ZCODE_AGENT_INSTALLATION_V2` sidecar and `ZCODE_AGENT_INSTALL_RECEIPT_V2` stdout.

- [ ] **Step 1: Add failing sidecar/CLI tests**

Tests:

```text
test_sidecar_records_bundle_ref_digest_agents_replacements_and_backup
test_success_receipt_requires_zcode_restart
test_deprecated_force_flag_does_not_change_transaction_semantics
test_list_reads_registry_instead_of_hardcoded_inventory
test_self_test_validates_registry_and_transaction_primitives
```

- [ ] **Step 2: Run and observe failures**

Expected: FAIL.

- [ ] **Step 3: Implement Sidecar V2**

Write exact source repository/ref, exact Registry byte digest, installed/template digests, metadata, legacy replacements, backup and UTC timestamp.

- [ ] **Step 4: Implement CLI semantics**

Retain `--model`, repeated `--agent-model`, `--ref`, `--dest`, `--list`, `--self-test`. Hide/deprecate `--force`, emit warning, do not change transaction behavior. Stdout is one JSON receipt; diagnostics to stderr.

Exit codes:

```text
0 installed/unchanged
1 pre-mutation operational failure
2 invalid CLI/ref/model
3 transaction failed and rollback succeeded
4 rollback incomplete
```

- [ ] **Step 5: Run installer suite and self-test**

```bash
python3 -m unittest tests.test_zcode_installer -v
python3 zcode-market/install-agents.py --self-test
```

Expected: PASS.

- [ ] **Step 6: Remove temporary expected-failure from Registry test**

The installer no longer contains `AGENTS = {...}`. Enable and pass the no-second-inventory test from Plan 01.

- [ ] **Step 7: Record logical commit boundary**

No commit without authorization. Logical message: `feat(zcode): publish agent bundle installation receipts`.

---

### Task 7: Replace old templates/Skills in repository inventory

**Files:**
- Delete six old workflow Skill directories.
- Delete six old workflow templates.
- Modify: `tests/test_zcode_agent_registry.py`, `tests/test_zcode_marketplace.py` later in Plan 05.

**Interfaces:**
- Consumes: completed Registry, canonical replacements and transactional installer.

- [ ] **Step 1: Add exact repository-inventory test**

Assert the only workflow Skill directories are the six new shared Skills, and the only workflow templates are the nine canonical workflow Agents.

- [ ] **Step 2: Run and observe old paths still present**

Expected: FAIL.

- [ ] **Step 3: Delete obsolete repository sources**

Remove old Skill/template paths listed in the confirmed design. Do not touch Claude/Codex copies.

- [ ] **Step 4: Run Registry, installer and build tests**

```bash
python3 -m unittest tests.test_zcode_agent_registry tests.test_zcode_installer -v
node tooling/zcode-workflow/build.mjs --check
```

Expected: PASS.

- [ ] **Step 5: Verify protected platforms**

```bash
git diff --exit-code -- claude-code-market codex-market .agents .codex
```

Expected: no diff.

- [ ] **Step 6: Stop for bundle review**

Review Agent wording, Skill action allowlists, metadata policy, backup/rollback paths and sidecar before integration/docs.
