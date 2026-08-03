from __future__ import annotations

import json
import re
import unittest

from zcode_test_support import ROOT, load_agent_registry, sha256_bytes


INSTALLER_SOURCE = (ROOT / "zcode-market/install-agents.py").read_text(encoding="utf-8")
HARD_CODED_INSTALLER_INVENTORY = re.compile(r"^AGENTS\s*=", re.MULTILINE)

EXPECTED_SKILL_RECORDS = {
    "ghost-agent-workflow:workflow-coordination": {
        "plugin": "ghost-agent-workflow",
        "path": "skills/workflow-coordination",
        "operations": [],
        "consumers": [],
    },
    "ghost-agent-workflow:workflow-planning": {
        "plugin": "ghost-agent-workflow",
        "path": "skills/workflow-planning",
        "operations": [
            "initial_plan",
            "revise_plan",
            "apply_global_delta",
            "expand_subgraph",
        ],
        "consumers": ["workflow-planner"],
    },
    "ghost-agent-workflow:workflow-plan-review": {
        "plugin": "ghost-agent-workflow",
        "path": "skills/workflow-plan-review",
        "operations": ["review_plan_revision"],
        "consumers": ["workflow-plan-reviewer"],
    },
    "ghost-agent-workflow:workflow-bound-run": {
        "plugin": "ghost-agent-workflow",
        "path": "skills/workflow-bound-run",
        "operations": [
            "execute_owner_run",
            "repair_owner_run",
            "review_implementation",
        ],
        "consumers": ["workflow-owner", "workflow-implementation-reviewer"],
    },
    "ghost-agent-workflow:workflow-config": {
        "plugin": "ghost-agent-workflow",
        "path": "skills/workflow-config",
        "operations": [
            "show_strict",
            "validate_strict",
            "init",
            "migrate",
            "set_parallel",
            "set_execution_class",
        ],
        "consumers": ["workflow-config-reader", "workflow-config-writer"],
    },
    "ghost-agent-workflow:workflow-dashboard": {
        "plugin": "ghost-agent-workflow",
        "path": "skills/workflow-dashboard",
        "operations": [
            "start_dashboard",
            "read_dashboard_status",
            "stop_dashboard",
        ],
        "consumers": [
            "workflow-dashboard-starter",
            "workflow-dashboard-status-reader",
            "workflow-dashboard-stopper",
        ],
    },
    "ghost-agent-skills:git-commit": {
        "plugin": "ghost-agent-skills",
        "path": "skills/git-commit",
        "operations": ["commit_authorized_changes"],
        "consumers": ["git-commit"],
    },
    "ghost-agent-skills:git-merge-conflict": {
        "plugin": "ghost-agent-skills",
        "path": "skills/git-merge-conflict",
        "operations": ["resolve_high_risk_conflict"],
        "consumers": ["git-merge-conflict"],
    },
}

EXPECTED_AGENT_RECORDS = {
    "workflow-planner": {
        "plugin": "ghost-agent-workflow",
        "skill": "ghost-agent-workflow:workflow-planning",
        "operations": [
            "initial_plan",
            "revise_plan",
            "apply_global_delta",
            "expand_subgraph",
        ],
        "permission_class": "plan_write",
        "execution_class": "main",
        "execution_class_config_key": "planner",
        "template": "ghost-agent-workflow/workflow-planner.md",
        "metadata_policy": {"model": "template_inherit", "color": "preserve"},
    },
    "workflow-plan-reviewer": {
        "plugin": "ghost-agent-workflow",
        "skill": "ghost-agent-workflow:workflow-plan-review",
        "operations": ["review_plan_revision"],
        "permission_class": "plan_review",
        "execution_class": "main",
        "execution_class_config_key": "planner_reviewer",
        "template": "ghost-agent-workflow/workflow-plan-reviewer.md",
        "metadata_policy": {"model": "template_inherit", "color": "preserve"},
    },
    "workflow-owner": {
        "plugin": "ghost-agent-workflow",
        "skill": "ghost-agent-workflow:workflow-bound-run",
        "operations": ["execute_owner_run", "repair_owner_run"],
        "permission_class": "workspace_write",
        "execution_class": "main",
        "execution_class_config_key": "owner",
        "template": "ghost-agent-workflow/workflow-owner.md",
        "metadata_policy": {"model": "template_inherit", "color": "preserve"},
    },
    "workflow-implementation-reviewer": {
        "plugin": "ghost-agent-workflow",
        "skill": "ghost-agent-workflow:workflow-bound-run",
        "operations": ["review_implementation"],
        "permission_class": "workspace_review",
        "execution_class": "main",
        "execution_class_config_key": "review",
        "template": "ghost-agent-workflow/workflow-implementation-reviewer.md",
        "metadata_policy": {"model": "template_inherit", "color": "preserve"},
    },
    "workflow-config-reader": {
        "plugin": "ghost-agent-workflow",
        "skill": "ghost-agent-workflow:workflow-config",
        "operations": ["show_strict", "validate_strict"],
        "permission_class": "config_read",
        "execution_class": None,
        "execution_class_config_key": None,
        "template": "ghost-agent-workflow/workflow-config-reader.md",
        "metadata_policy": {"model": "preserve_or_global", "color": "preserve"},
    },
    "workflow-config-writer": {
        "plugin": "ghost-agent-workflow",
        "skill": "ghost-agent-workflow:workflow-config",
        "operations": ["init", "migrate", "set_parallel", "set_execution_class"],
        "permission_class": "config_write",
        "execution_class": None,
        "execution_class_config_key": None,
        "template": "ghost-agent-workflow/workflow-config-writer.md",
        "metadata_policy": {"model": "preserve_or_global", "color": "preserve"},
    },
    "workflow-dashboard-starter": {
        "plugin": "ghost-agent-workflow",
        "skill": "ghost-agent-workflow:workflow-dashboard",
        "operations": ["start_dashboard"],
        "permission_class": "dashboard_start",
        "execution_class": None,
        "execution_class_config_key": None,
        "template": "ghost-agent-workflow/workflow-dashboard-starter.md",
        "metadata_policy": {"model": "preserve_or_global", "color": "preserve"},
    },
    "workflow-dashboard-status-reader": {
        "plugin": "ghost-agent-workflow",
        "skill": "ghost-agent-workflow:workflow-dashboard",
        "operations": ["read_dashboard_status"],
        "permission_class": "dashboard_read",
        "execution_class": None,
        "execution_class_config_key": None,
        "template": "ghost-agent-workflow/workflow-dashboard-status-reader.md",
        "metadata_policy": {"model": "preserve_or_global", "color": "preserve"},
    },
    "workflow-dashboard-stopper": {
        "plugin": "ghost-agent-workflow",
        "skill": "ghost-agent-workflow:workflow-dashboard",
        "operations": ["stop_dashboard"],
        "permission_class": "dashboard_stop",
        "execution_class": None,
        "execution_class_config_key": None,
        "template": "ghost-agent-workflow/workflow-dashboard-stopper.md",
        "metadata_policy": {"model": "preserve_or_global", "color": "preserve"},
    },
    "git-commit": {
        "plugin": "ghost-agent-skills",
        "skill": "ghost-agent-skills:git-commit",
        "operations": ["commit_authorized_changes"],
        "permission_class": "git_commit",
        "execution_class": None,
        "execution_class_config_key": None,
        "template": "ghost-agent-skills/git-commit.md",
        "metadata_policy": {"model": "preserve_or_global", "color": "preserve"},
    },
    "git-merge-conflict": {
        "plugin": "ghost-agent-skills",
        "skill": "ghost-agent-skills:git-merge-conflict",
        "operations": ["resolve_high_risk_conflict"],
        "permission_class": "git_conflict_write",
        "execution_class": None,
        "execution_class_config_key": None,
        "template": "ghost-agent-skills/git-merge-conflict.md",
        "metadata_policy": {"model": "preserve_or_global", "color": "preserve"},
    },
}

EXPECTED_LEGACY_AGENTS = [
    {"id": "parallel-task-planner", "replacements": ["workflow-planner"], "remove": True},
    {"id": "planner-reviewer", "replacements": ["workflow-plan-reviewer"], "remove": True},
    {
        "id": "sub-thread-goal-worker",
        "replacements": ["workflow-owner", "workflow-implementation-reviewer"],
        "remove": True,
    },
    {"id": "sub-thread-coordination", "replacements": [], "remove": True},
    {
        "id": "setup-sub-thread-workflow",
        "replacements": ["workflow-config-reader", "workflow-config-writer"],
        "remove": True,
    },
    {
        "id": "start-dag-dashboard",
        "replacements": [
            "workflow-dashboard-starter",
            "workflow-dashboard-status-reader",
            "workflow-dashboard-stopper",
        ],
        "remove": True,
    },
    {"id": "git-commit", "replacements": ["git-commit"], "remove": False},
    {
        "id": "git-merge-conflict",
        "replacements": ["git-merge-conflict"],
        "remove": False,
    },
]

EXPECTED_SKILL_TOKENS = {
    "workflow-planner": "$workflow-planning",
    "workflow-plan-reviewer": "$workflow-plan-review",
    "workflow-owner": "$workflow-bound-run",
    "workflow-implementation-reviewer": "$workflow-bound-run",
    "workflow-config-reader": "$workflow-config",
    "workflow-config-writer": "$workflow-config",
    "workflow-dashboard-starter": "$workflow-dashboard",
    "workflow-dashboard-status-reader": "$workflow-dashboard",
    "workflow-dashboard-stopper": "$workflow-dashboard",
    "git-commit": "$git-commit",
    "git-merge-conflict": "$git-merge-conflict",
}


def load_schema() -> dict[str, object]:
    return json.loads(
        (ROOT / "zcode-market/agent-registry.schema.json").read_text(encoding="utf-8")
    )


def parse_frontmatter(raw: bytes) -> tuple[dict[str, str], str]:
    text = raw.decode("utf-8")
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise AssertionError("template must start with frontmatter")
    try:
        end = lines.index("---", 1)
    except ValueError as error:
        raise AssertionError("template frontmatter must close") from error
    metadata: dict[str, str] = {}
    for line in lines[1:end]:
        key, separator, value = line.partition(":")
        if not separator:
            raise AssertionError(f"invalid frontmatter line: {line}")
        metadata[key.strip()] = value.strip()
    return metadata, "\n".join(lines[end + 1 :])


class ZCodeAgentRegistryTests(unittest.TestCase):
    @unittest.expectedFailure
    def test_installer_and_runtime_do_not_contain_a_second_agent_inventory(self) -> None:
        self.assertIsNone(
            HARD_CODED_INSTALLER_INVENTORY.search(INSTALLER_SOURCE),
            "installer must load the Registry; found hard-coded AGENTS = inventory",
        )

    def test_registry_contract_and_bundle_version_are_v2(self) -> None:
        registry = load_agent_registry()
        self.assertEqual(registry["$schema"], "./agent-registry.schema.json")
        self.assertEqual(registry["contract"], "ZCODE_AGENT_BUNDLE_V2")
        self.assertEqual(registry["bundle_version"], "2.0.0")
        self.assertEqual(registry["source_repository"], "Ghost233/ghost-agent-market")
        self.assertEqual(registry["template_root"], "zcode-market/agent-templates")
        self.assertEqual(registry["allowed_custom_metadata"], ["model", "color"])

    def test_registry_contains_exact_locked_agent_and_skill_inventories(self) -> None:
        registry = load_agent_registry()
        self.assertEqual(len(registry["agents"]), 11)
        self.assertEqual(len(registry["skills"]), 8)
        self.assertEqual(
            {item["id"] for item in registry["agents"]},
            set(EXPECTED_AGENT_RECORDS),
        )
        self.assertEqual(
            {item["id"] for item in registry["skills"]},
            set(EXPECTED_SKILL_RECORDS),
        )

    def test_registry_has_no_main_or_supervisor_agent(self) -> None:
        agent_ids = {item["id"] for item in load_agent_registry()["agents"]}
        self.assertFalse(any("main" in value for value in agent_ids))
        self.assertFalse(any("supervisor" in value for value in agent_ids))

    def test_skill_records_are_canonical(self) -> None:
        skills = {item["id"]: item for item in load_agent_registry()["skills"]}
        for skill_id, expected in EXPECTED_SKILL_RECORDS.items():
            self.assertEqual(skills[skill_id], {"id": skill_id, **expected})

    def test_agent_records_are_canonical_except_for_computed_hashes(self) -> None:
        agents = {item["id"]: item for item in load_agent_registry()["agents"]}
        hash_pattern = re.compile(r"^sha256:[0-9a-f]{64}$")
        for agent_id, expected in EXPECTED_AGENT_RECORDS.items():
            actual = dict(agents[agent_id])
            template_hash = actual.pop("template_sha256")
            self.assertRegex(template_hash, hash_pattern)
            self.assertEqual(actual, {"id": agent_id, **expected})

    def test_every_agent_operation_is_authorized_by_its_skill(self) -> None:
        registry = load_agent_registry()
        skills = {item["id"]: set(item["operations"]) for item in registry["skills"]}
        for agent in registry["agents"]:
            self.assertLessEqual(set(agent["operations"]), skills[agent["skill"]])

    def test_every_skill_consumer_references_an_authorized_agent(self) -> None:
        registry = load_agent_registry()
        agents = {item["id"]: item for item in registry["agents"]}
        for skill in registry["skills"]:
            for consumer in skill["consumers"]:
                self.assertEqual(agents[consumer]["skill"], skill["id"])
                self.assertLessEqual(
                    set(agents[consumer]["operations"]), set(skill["operations"])
                )

    def test_review_agents_have_locked_read_only_permission_classes(self) -> None:
        agents = {item["id"]: item for item in load_agent_registry()["agents"]}
        self.assertEqual(agents["workflow-plan-reviewer"]["permission_class"], "plan_review")
        self.assertEqual(
            agents["workflow-implementation-reviewer"]["permission_class"],
            "workspace_review",
        )
        self.assertNotEqual(
            agents["workflow-plan-reviewer"]["permission_class"], "workspace_write"
        )
        self.assertNotEqual(
            agents["workflow-implementation-reviewer"]["permission_class"],
            "workspace_write",
        )

    def test_legacy_mapping_is_complete_and_exact(self) -> None:
        self.assertEqual(load_agent_registry()["legacy_agents"], EXPECTED_LEGACY_AGENTS)

    def test_templates_exist_at_registry_paths_with_exact_hashes(self) -> None:
        registry = load_agent_registry()
        root = ROOT / registry["template_root"]
        for agent in registry["agents"]:
            raw = (root / agent["template"]).read_bytes()
            self.assertEqual(sha256_bytes(raw), agent["template_sha256"], agent["id"])

    def test_templates_have_canonical_frontmatter_and_one_skill_token(self) -> None:
        registry = load_agent_registry()
        root = ROOT / registry["template_root"]
        for agent in registry["agents"]:
            raw = (root / agent["template"]).read_bytes()
            self.assertTrue(raw.endswith(b"\n"), agent["id"])
            metadata, body = parse_frontmatter(raw)
            self.assertEqual(set(metadata), {"name", "description", "model"})
            self.assertEqual(metadata["name"], agent["id"])
            self.assertTrue(metadata["description"])
            self.assertEqual(metadata["model"], "inherit")
            tokens = re.findall(r"\$[a-z0-9][a-z0-9._-]*", body)
            self.assertEqual(tokens, [EXPECTED_SKILL_TOKENS[agent["id"]]])
            for operation in agent["operations"]:
                self.assertIn(f"`{operation}`", body)

    def test_schema_has_exact_strict_top_level_shape(self) -> None:
        schema = load_schema()
        required = [
            "$schema",
            "contract",
            "bundle_version",
            "source_repository",
            "template_root",
            "allowed_custom_metadata",
            "skills",
            "agents",
            "legacy_agents",
        ]
        self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertEqual(
            schema["$id"],
            "https://github.com/Ghost233/ghost-agent-market/zcode-market/agent-registry.schema.json",
        )
        self.assertEqual(schema["type"], "object")
        self.assertIs(schema["additionalProperties"], False)
        self.assertEqual(schema["required"], required)
        self.assertEqual(set(schema["properties"]), set(required))
        self.assertEqual(schema["properties"]["skills"]["minItems"], 8)
        self.assertEqual(schema["properties"]["skills"]["maxItems"], 8)
        self.assertEqual(schema["properties"]["agents"]["minItems"], 11)
        self.assertEqual(schema["properties"]["agents"]["maxItems"], 11)
        self.assertEqual(schema["properties"]["legacy_agents"]["minItems"], 8)
        self.assertEqual(schema["properties"]["legacy_agents"]["maxItems"], 8)

    def test_schema_definitions_are_strict_and_require_exact_record_keys(self) -> None:
        schema = load_schema()
        definitions = schema["$defs"]
        expected_keys = {
            "skill": ["id", "plugin", "path", "operations", "consumers"],
            "agent": [
                "id",
                "plugin",
                "skill",
                "operations",
                "permission_class",
                "execution_class",
                "execution_class_config_key",
                "template",
                "template_sha256",
                "metadata_policy",
            ],
            "metadata_policy": ["model", "color"],
            "legacy_agent": ["id", "replacements", "remove"],
        }
        for definition_name, required in expected_keys.items():
            definition = definitions[definition_name]
            self.assertEqual(definition["type"], "object")
            self.assertIs(definition["additionalProperties"], False)
            self.assertEqual(definition["required"], required)
            self.assertEqual(set(definition["properties"]), set(required))
        self.assertEqual(
            definitions["agent"]["properties"]["template_sha256"]["pattern"],
            r"^sha256:[0-9a-f]{64}$",
        )
        self.assertEqual(
            definitions["agent"]["properties"]["execution_class"]["type"],
            ["string", "null"],
        )
        self.assertEqual(
            definitions["agent"]["properties"]["execution_class"]["enum"],
            ["main", "lite", None],
        )
        id_pattern = r"^[a-z0-9][a-z0-9._-]*$"
        self.assertEqual(definitions["simple_id"]["pattern"], id_pattern)
        self.assertEqual(
            definitions["skill_id"]["pattern"],
            r"^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$",
        )


if __name__ == "__main__":
    unittest.main()
