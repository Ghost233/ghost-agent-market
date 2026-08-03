import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TOP_LEVEL_KEYS = [
  "$schema",
  "contract",
  "bundle_version",
  "source_repository",
  "template_root",
  "allowed_custom_metadata",
  "skills",
  "agents",
  "legacy_agents",
];
const SKILL_KEYS = ["id", "plugin", "path", "operations", "consumers"];
const AGENT_KEYS = [
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
];
const METADATA_POLICY_KEYS = ["model", "color"];
const LEGACY_AGENT_KEYS = ["id", "replacements", "remove"];

const TOP_LEVEL_CONSTANTS = {
  $schema: "./agent-registry.schema.json",
  contract: "ZCODE_AGENT_BUNDLE_V2",
  bundle_version: "2.0.0",
  source_repository: "Ghost233/ghost-agent-market",
  template_root: "zcode-market/agent-templates",
};
const ALLOWED_CUSTOM_METADATA = ["model", "color"];
const SIMPLE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const SKILL_ID_PATTERN = /^([a-z0-9][a-z0-9._-]*):([a-z0-9][a-z0-9._-]*)$/;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const PLUGINS = new Set(["ghost-agent-workflow", "ghost-agent-skills"]);
const OPERATIONS = new Set([
  "initial_plan",
  "revise_plan",
  "apply_global_delta",
  "expand_subgraph",
  "review_plan_revision",
  "execute_owner_run",
  "repair_owner_run",
  "review_implementation",
  "show_strict",
  "validate_strict",
  "init",
  "migrate",
  "set_parallel",
  "set_execution_class",
  "start_dashboard",
  "read_dashboard_status",
  "stop_dashboard",
  "commit_authorized_changes",
  "resolve_high_risk_conflict",
]);
const PERMISSION_CLASSES = new Set([
  "plan_write",
  "plan_review",
  "workspace_write",
  "workspace_review",
  "config_read",
  "config_write",
  "dashboard_start",
  "dashboard_read",
  "dashboard_stop",
  "git_commit",
  "git_conflict_write",
]);
const EXECUTION_CLASSES = new Set(["main", "lite"]);
const EXECUTION_CLASS_CONFIG_KEYS = new Set([
  "planner",
  "planner_reviewer",
  "owner",
  "review",
]);
const MODEL_POLICIES = new Set(["template_inherit", "preserve_or_global"]);

const SKILL_INVENTORY = {
  "ghost-agent-workflow:workflow-coordination": {
    plugin: "ghost-agent-workflow",
    path: "skills/workflow-coordination",
    operations: [],
    consumers: [],
  },
  "ghost-agent-workflow:workflow-planning": {
    plugin: "ghost-agent-workflow",
    path: "skills/workflow-planning",
    operations: ["initial_plan", "revise_plan", "apply_global_delta", "expand_subgraph"],
    consumers: ["workflow-planner"],
  },
  "ghost-agent-workflow:workflow-plan-review": {
    plugin: "ghost-agent-workflow",
    path: "skills/workflow-plan-review",
    operations: ["review_plan_revision"],
    consumers: ["workflow-plan-reviewer"],
  },
  "ghost-agent-workflow:workflow-bound-run": {
    plugin: "ghost-agent-workflow",
    path: "skills/workflow-bound-run",
    operations: ["execute_owner_run", "repair_owner_run", "review_implementation"],
    consumers: ["workflow-owner", "workflow-implementation-reviewer"],
  },
  "ghost-agent-workflow:workflow-config": {
    plugin: "ghost-agent-workflow",
    path: "skills/workflow-config",
    operations: [
      "show_strict",
      "validate_strict",
      "init",
      "migrate",
      "set_parallel",
      "set_execution_class",
    ],
    consumers: ["workflow-config-reader", "workflow-config-writer"],
  },
  "ghost-agent-workflow:workflow-dashboard": {
    plugin: "ghost-agent-workflow",
    path: "skills/workflow-dashboard",
    operations: ["start_dashboard", "read_dashboard_status", "stop_dashboard"],
    consumers: [
      "workflow-dashboard-starter",
      "workflow-dashboard-status-reader",
      "workflow-dashboard-stopper",
    ],
  },
  "ghost-agent-skills:git-commit": {
    plugin: "ghost-agent-skills",
    path: "skills/git-commit",
    operations: ["commit_authorized_changes"],
    consumers: ["git-commit"],
  },
  "ghost-agent-skills:git-merge-conflict": {
    plugin: "ghost-agent-skills",
    path: "skills/git-merge-conflict",
    operations: ["resolve_high_risk_conflict"],
    consumers: ["git-merge-conflict"],
  },
};

const AGENT_INVENTORY = {
  "workflow-planner": {
    plugin: "ghost-agent-workflow",
    skill: "ghost-agent-workflow:workflow-planning",
    operations: ["initial_plan", "revise_plan", "apply_global_delta", "expand_subgraph"],
    permission_class: "plan_write",
    execution_class: "main",
    execution_class_config_key: "planner",
    template: "ghost-agent-workflow/workflow-planner.md",
    metadata_model: "template_inherit",
  },
  "workflow-plan-reviewer": {
    plugin: "ghost-agent-workflow",
    skill: "ghost-agent-workflow:workflow-plan-review",
    operations: ["review_plan_revision"],
    permission_class: "plan_review",
    execution_class: "main",
    execution_class_config_key: "planner_reviewer",
    template: "ghost-agent-workflow/workflow-plan-reviewer.md",
    metadata_model: "template_inherit",
  },
  "workflow-owner": {
    plugin: "ghost-agent-workflow",
    skill: "ghost-agent-workflow:workflow-bound-run",
    operations: ["execute_owner_run", "repair_owner_run"],
    permission_class: "workspace_write",
    execution_class: "main",
    execution_class_config_key: "owner",
    template: "ghost-agent-workflow/workflow-owner.md",
    metadata_model: "template_inherit",
  },
  "workflow-implementation-reviewer": {
    plugin: "ghost-agent-workflow",
    skill: "ghost-agent-workflow:workflow-bound-run",
    operations: ["review_implementation"],
    permission_class: "workspace_review",
    execution_class: "main",
    execution_class_config_key: "review",
    template: "ghost-agent-workflow/workflow-implementation-reviewer.md",
    metadata_model: "template_inherit",
  },
  "workflow-config-reader": {
    plugin: "ghost-agent-workflow",
    skill: "ghost-agent-workflow:workflow-config",
    operations: ["show_strict", "validate_strict"],
    permission_class: "config_read",
    execution_class: null,
    execution_class_config_key: null,
    template: "ghost-agent-workflow/workflow-config-reader.md",
    metadata_model: "preserve_or_global",
  },
  "workflow-config-writer": {
    plugin: "ghost-agent-workflow",
    skill: "ghost-agent-workflow:workflow-config",
    operations: ["init", "migrate", "set_parallel", "set_execution_class"],
    permission_class: "config_write",
    execution_class: null,
    execution_class_config_key: null,
    template: "ghost-agent-workflow/workflow-config-writer.md",
    metadata_model: "preserve_or_global",
  },
  "workflow-dashboard-starter": {
    plugin: "ghost-agent-workflow",
    skill: "ghost-agent-workflow:workflow-dashboard",
    operations: ["start_dashboard"],
    permission_class: "dashboard_start",
    execution_class: null,
    execution_class_config_key: null,
    template: "ghost-agent-workflow/workflow-dashboard-starter.md",
    metadata_model: "preserve_or_global",
  },
  "workflow-dashboard-status-reader": {
    plugin: "ghost-agent-workflow",
    skill: "ghost-agent-workflow:workflow-dashboard",
    operations: ["read_dashboard_status"],
    permission_class: "dashboard_read",
    execution_class: null,
    execution_class_config_key: null,
    template: "ghost-agent-workflow/workflow-dashboard-status-reader.md",
    metadata_model: "preserve_or_global",
  },
  "workflow-dashboard-stopper": {
    plugin: "ghost-agent-workflow",
    skill: "ghost-agent-workflow:workflow-dashboard",
    operations: ["stop_dashboard"],
    permission_class: "dashboard_stop",
    execution_class: null,
    execution_class_config_key: null,
    template: "ghost-agent-workflow/workflow-dashboard-stopper.md",
    metadata_model: "preserve_or_global",
  },
  "git-commit": {
    plugin: "ghost-agent-skills",
    skill: "ghost-agent-skills:git-commit",
    operations: ["commit_authorized_changes"],
    permission_class: "git_commit",
    execution_class: null,
    execution_class_config_key: null,
    template: "ghost-agent-skills/git-commit.md",
    metadata_model: "preserve_or_global",
  },
  "git-merge-conflict": {
    plugin: "ghost-agent-skills",
    skill: "ghost-agent-skills:git-merge-conflict",
    operations: ["resolve_high_risk_conflict"],
    permission_class: "git_conflict_write",
    execution_class: null,
    execution_class_config_key: null,
    template: "ghost-agent-skills/git-merge-conflict.md",
    metadata_model: "preserve_or_global",
  },
};

const LEGACY_AGENT_INVENTORY = {
  "parallel-task-planner": { replacements: ["workflow-planner"], remove: true },
  "planner-reviewer": { replacements: ["workflow-plan-reviewer"], remove: true },
  "sub-thread-goal-worker": {
    replacements: ["workflow-owner", "workflow-implementation-reviewer"],
    remove: true,
  },
  "sub-thread-coordination": { replacements: [], remove: true },
  "setup-sub-thread-workflow": {
    replacements: ["workflow-config-reader", "workflow-config-writer"],
    remove: true,
  },
  "start-dag-dashboard": {
    replacements: [
      "workflow-dashboard-starter",
      "workflow-dashboard-status-reader",
      "workflow-dashboard-stopper",
    ],
    remove: true,
  },
  "git-commit": { replacements: ["git-commit"], remove: false },
  "git-merge-conflict": { replacements: ["git-merge-conflict"], remove: false },
};

function fail(field, message) {
  throw new Error(`${field}: ${message}`);
}

function requireRecord(value, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(field, "must be an object");
  }
  return value;
}

function requireExactKeys(value, expectedKeys, field) {
  const actualKeys = Object.keys(value);
  const missing = expectedKeys.filter((key) => !Object.hasOwn(value, key));
  const extra = actualKeys.filter((key) => !expectedKeys.includes(key));
  if (missing.length || extra.length) {
    const details = [];
    if (missing.length) details.push(`missing keys ${missing.join(", ")}`);
    if (extra.length) details.push(`unexpected keys ${extra.join(", ")}`);
    fail(field, details.join("; "));
  }
}

function requireString(value, field) {
  if (typeof value !== "string") fail(field, "must be a string");
  return value;
}

function requireNullableString(value, field) {
  if (value !== null && typeof value !== "string") {
    fail(field, "must be a string or null");
  }
  return value;
}

function requireBoolean(value, field) {
  if (typeof value !== "boolean") fail(field, "must be a boolean");
  return value;
}

function requireArray(value, field) {
  if (!Array.isArray(value)) fail(field, "must be an array");
  return value;
}

function requireStringArray(value, field, { min = 0, max = Infinity } = {}) {
  const array = requireArray(value, field);
  if (array.length < min || array.length > max) {
    fail(field, `must contain between ${min} and ${max} entries`);
  }
  return array.map((entry, index) => requireString(entry, `${field}[${index}]`));
}

function requirePattern(value, pattern, field, description) {
  const stringValue = requireString(value, field);
  if (!pattern.test(stringValue)) fail(field, description);
  return stringValue;
}

function requireAllowed(value, allowed, field) {
  if (!allowed.has(value)) fail(field, `unsupported value ${JSON.stringify(value)}`);
  return value;
}

function requireUnique(values, field) {
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) fail(field, `duplicate value ${JSON.stringify(value)} at index ${index}`);
    seen.add(value);
  }
}

function requireCount(values, expected, field) {
  if (values.length !== expected) fail(field, `must contain exactly ${expected} records`);
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requireArrayEqual(actual, expected, field) {
  if (!arraysEqual(actual, expected)) {
    fail(field, `must equal ${JSON.stringify(expected)}`);
  }
}

function parseSkill(value, index) {
  const preliminary = requireRecord(value, `skill at index ${index}`);
  const idHint = typeof preliminary.id === "string" ? preliminary.id : `at index ${index}`;
  const field = `skill ${idHint}`;
  requireExactKeys(preliminary, SKILL_KEYS, field);
  return {
    id: requirePattern(
      preliminary.id,
      SKILL_ID_PATTERN,
      `${field}.id`,
      "must be a plugin-qualified skill id",
    ),
    plugin: requireAllowed(requireString(preliminary.plugin, `${field}.plugin`), PLUGINS, `${field}.plugin`),
    path: requirePattern(
      preliminary.path,
      /^skills\/[a-z0-9][a-z0-9._-]*$/,
      `${field}.path`,
      "must be a canonical skills/<name> path",
    ),
    operations: requireStringArray(preliminary.operations, `${field}.operations`, { max: 6 }),
    consumers: requireStringArray(preliminary.consumers, `${field}.consumers`, { max: 3 }),
  };
}

function parseMetadataPolicy(value, agentField) {
  const field = `${agentField}.metadata_policy`;
  const source = requireRecord(value, field);
  requireExactKeys(source, METADATA_POLICY_KEYS, field);
  return {
    model: requireAllowed(
      requireString(source.model, `${field}.model`),
      MODEL_POLICIES,
      `${field}.model`,
    ),
    color: requireString(source.color, `${field}.color`),
  };
}

function parseAgent(value, index) {
  const preliminary = requireRecord(value, `agent at index ${index}`);
  const idHint = typeof preliminary.id === "string" ? preliminary.id : `at index ${index}`;
  const field = `agent ${idHint}`;
  requireExactKeys(preliminary, AGENT_KEYS, field);
  return {
    id: requirePattern(
      preliminary.id,
      SIMPLE_ID_PATTERN,
      `${field}.id`,
      "must be a lowercase simple id",
    ),
    plugin: requireAllowed(requireString(preliminary.plugin, `${field}.plugin`), PLUGINS, `${field}.plugin`),
    skill: requirePattern(
      preliminary.skill,
      SKILL_ID_PATTERN,
      `${field}.skill`,
      "must be a plugin-qualified skill id",
    ),
    operations: requireStringArray(preliminary.operations, `${field}.operations`, { min: 1, max: 4 }),
    permission_class: requireAllowed(
      requireString(preliminary.permission_class, `${field}.permission_class`),
      PERMISSION_CLASSES,
      `${field}.permission_class`,
    ),
    execution_class:
      preliminary.execution_class === null
        ? null
        : requireAllowed(
            requireNullableString(preliminary.execution_class, `${field}.execution_class`),
            EXECUTION_CLASSES,
            `${field}.execution_class`,
          ),
    execution_class_config_key:
      preliminary.execution_class_config_key === null
        ? null
        : requireAllowed(
            requireNullableString(
              preliminary.execution_class_config_key,
              `${field}.execution_class_config_key`,
            ),
            EXECUTION_CLASS_CONFIG_KEYS,
            `${field}.execution_class_config_key`,
          ),
    template: requirePattern(
      preliminary.template,
      /^(ghost-agent-workflow|ghost-agent-skills)\/[a-z0-9][a-z0-9._-]*\.md$/,
      `${field}.template`,
      "must be a canonical plugin template path",
    ),
    template_sha256: requirePattern(
      preliminary.template_sha256,
      SHA256_PATTERN,
      `${field}.template_sha256`,
      "must match sha256:<64 lowercase hexadecimal characters>",
    ),
    metadata_policy: parseMetadataPolicy(preliminary.metadata_policy, field),
  };
}

function parseLegacyAgent(value, index) {
  const preliminary = requireRecord(value, `legacy agent at index ${index}`);
  const idHint = typeof preliminary.id === "string" ? preliminary.id : `at index ${index}`;
  const field = `legacy agent ${idHint}`;
  requireExactKeys(preliminary, LEGACY_AGENT_KEYS, field);
  return {
    id: requirePattern(
      preliminary.id,
      SIMPLE_ID_PATTERN,
      `${field}.id`,
      "must be a lowercase simple id",
    ),
    replacements: requireStringArray(preliminary.replacements, `${field}.replacements`, { max: 3 }),
    remove: requireBoolean(preliminary.remove, `${field}.remove`),
  };
}

function validateInventoryIds(records, expectedInventory, field) {
  const expectedIds = Object.keys(expectedInventory);
  const actualIds = records.map((entry) => entry.id);
  requireUnique(actualIds, field);
  for (const id of actualIds) {
    if (!Object.hasOwn(expectedInventory, id)) fail(`${field.slice(0, -1)} ${id}.id`, "is not in the locked inventory");
  }
  for (const id of expectedIds) {
    if (!actualIds.includes(id)) fail(field, `is missing locked id ${id}`);
  }
}

function validateAgentRegistry(registry) {
  for (const [key, expected] of Object.entries(TOP_LEVEL_CONSTANTS)) {
    if (registry[key] !== expected) fail(`agent registry.${key}`, `must equal ${JSON.stringify(expected)}`);
  }
  requireArrayEqual(
    registry.allowed_custom_metadata,
    ALLOWED_CUSTOM_METADATA,
    "agent registry.allowed_custom_metadata",
  );
  requireCount(registry.skills, 8, "agent registry.skills");
  requireCount(registry.agents, 11, "agent registry.agents");
  requireCount(registry.legacy_agents, 8, "agent registry.legacy_agents");
  validateInventoryIds(registry.skills, SKILL_INVENTORY, "agent registry.skills");
  validateInventoryIds(registry.agents, AGENT_INVENTORY, "agent registry.agents");
  validateInventoryIds(registry.legacy_agents, LEGACY_AGENT_INVENTORY, "agent registry.legacy_agents");

  const skillsById = new Map(registry.skills.map((skill) => [skill.id, skill]));
  const agentsById = new Map(registry.agents.map((agent) => [agent.id, agent]));

  for (const skill of registry.skills) {
    const field = `skill ${skill.id}`;
    const expected = SKILL_INVENTORY[skill.id];
    requireUnique(skill.operations, `${field}.operations`);
    requireUnique(skill.consumers, `${field}.consumers`);
    if (skill.plugin !== expected.plugin) fail(`${field}.plugin`, `must equal ${expected.plugin}`);
    if (skill.path !== expected.path) fail(`${field}.path`, `must equal ${expected.path}`);
    const match = SKILL_ID_PATTERN.exec(skill.id);
    if (match[1] !== skill.plugin) fail(`${field}.plugin`, `must match the plugin prefix in ${skill.id}`);
    if (`skills/${match[2]}` !== skill.path) fail(`${field}.path`, `must match the skill suffix in ${skill.id}`);
    for (const [index, operation] of skill.operations.entries()) {
      requireAllowed(operation, OPERATIONS, `${field}.operations[${index}]`);
    }
    for (const [index, consumerId] of skill.consumers.entries()) {
      if (!agentsById.has(consumerId)) fail(`${field}.consumers[${index}]`, `unknown agent ${consumerId}`);
    }
    requireArrayEqual(skill.operations, expected.operations, `${field}.operations`);
    requireArrayEqual(skill.consumers, expected.consumers, `${field}.consumers`);
  }

  const templateOwners = new Map();
  for (const agent of registry.agents) {
    const field = `agent ${agent.id}`;
    const expected = AGENT_INVENTORY[agent.id];
    requireUnique(agent.operations, `${field}.operations`);
    if (agent.plugin !== expected.plugin) fail(`${field}.plugin`, `must equal ${expected.plugin}`);
    if (agent.skill !== expected.skill) fail(`${field}.skill`, `must equal ${expected.skill}`);
    if (agent.template !== expected.template) fail(`${field}.template`, `must equal ${expected.template}`);
    if (agent.permission_class !== expected.permission_class) {
      fail(`${field}.permission_class`, `must equal ${expected.permission_class}`);
    }
    if (agent.execution_class !== expected.execution_class) {
      fail(`${field}.execution_class`, `must equal ${JSON.stringify(expected.execution_class)}`);
    }
    if (agent.execution_class_config_key !== expected.execution_class_config_key) {
      fail(
        `${field}.execution_class_config_key`,
        `must equal ${JSON.stringify(expected.execution_class_config_key)}`,
      );
    }
    if (agent.execution_class === null && agent.execution_class_config_key !== null) {
      fail(`${field}.execution_class_config_key`, "must be null when execution_class is null");
    }
    if (agent.execution_class !== null && agent.execution_class_config_key === null) {
      fail(`${field}.execution_class_config_key`, "must be set when execution_class is set");
    }
    if (agent.metadata_policy.model !== expected.metadata_model) {
      fail(`${field}.metadata_policy.model`, `must equal ${expected.metadata_model}`);
    }
    if (agent.metadata_policy.color !== "preserve") {
      fail(`${field}.metadata_policy.color`, "must equal preserve");
    }
    if (!skillsById.has(agent.skill)) fail(`${field}.skill`, `unknown skill ${agent.skill}`);
    if (!agent.skill.startsWith(`${agent.plugin}:`)) {
      fail(`${field}.skill`, `must belong to plugin ${agent.plugin}`);
    }
    if (!agent.template.startsWith(`${agent.plugin}/`)) {
      fail(`${field}.template`, `must belong to plugin ${agent.plugin}`);
    }
    if (templateOwners.has(agent.template)) {
      fail(`${field}.template`, `duplicates agent ${templateOwners.get(agent.template)}`);
    }
    templateOwners.set(agent.template, agent.id);
    const skill = skillsById.get(agent.skill);
    for (const [index, operation] of agent.operations.entries()) {
      requireAllowed(operation, OPERATIONS, `${field}.operations[${index}]`);
      if (!skill.operations.includes(operation)) {
        fail(`${field}.operations[${index}]`, `is not authorized by skill ${agent.skill}`);
      }
    }
    requireArrayEqual(agent.operations, expected.operations, `${field}.operations`);
  }

  for (const skill of registry.skills) {
    const expectedConsumers = new Set(
      registry.agents
        .filter((agent) => agent.skill === skill.id)
        .map((agent) => agent.id),
    );
    if (
      skill.consumers.length !== expectedConsumers.size ||
      skill.consumers.some((consumerId) => !expectedConsumers.has(consumerId))
    ) {
      fail(`skill ${skill.id}.consumers`, "must reciprocally list every agent using the skill");
    }
    for (const [index, consumerId] of skill.consumers.entries()) {
      const consumer = agentsById.get(consumerId);
      if (consumer.skill !== skill.id) {
        fail(`skill ${skill.id}.consumers[${index}]`, `agent ${consumerId} references ${consumer.skill}`);
      }
      for (const operation of consumer.operations) {
        if (!skill.operations.includes(operation)) {
          fail(
            `skill ${skill.id}.consumers[${index}]`,
            `agent ${consumerId} uses unauthorized operation ${operation}`,
          );
        }
      }
    }
  }

  for (const legacy of registry.legacy_agents) {
    const field = `legacy agent ${legacy.id}`;
    const expected = LEGACY_AGENT_INVENTORY[legacy.id];
    requireUnique(legacy.replacements, `${field}.replacements`);
    for (const [index, replacement] of legacy.replacements.entries()) {
      if (!agentsById.has(replacement)) {
        fail(`${field}.replacements[${index}]`, `unknown agent ${replacement}`);
      }
    }
    requireArrayEqual(legacy.replacements, expected.replacements, `${field}.replacements`);
    if (legacy.remove !== expected.remove) {
      fail(`${field}.remove`, `must equal ${expected.remove}`);
    }
    if (!legacy.remove && !legacy.replacements.includes(legacy.id)) {
      fail(`${field}.replacements`, "a retained legacy agent must replace itself");
    }
  }

  return registry;
}

export function parseAgentRegistry(value) {
  const source = requireRecord(value, "agent registry");
  requireExactKeys(source, TOP_LEVEL_KEYS, "agent registry");
  const parsedRegistry = {
    $schema: requireString(source.$schema, "agent registry.$schema"),
    contract: requireString(source.contract, "agent registry.contract"),
    bundle_version: requireString(source.bundle_version, "agent registry.bundle_version"),
    source_repository: requireString(source.source_repository, "agent registry.source_repository"),
    template_root: requireString(source.template_root, "agent registry.template_root"),
    allowed_custom_metadata: requireStringArray(
      source.allowed_custom_metadata,
      "agent registry.allowed_custom_metadata",
    ),
    skills: requireArray(source.skills, "agent registry.skills").map(parseSkill),
    agents: requireArray(source.agents, "agent registry.agents").map(parseAgent),
    legacy_agents: requireArray(source.legacy_agents, "agent registry.legacy_agents").map(
      parseLegacyAgent,
    ),
  };
  return validateAgentRegistry(parsedRegistry);
}

export function loadAgentRegistry(path) {
  const raw = readFileSync(path);
  let value;
  try {
    value = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    throw new Error(`agent registry ${path}: invalid JSON: ${error.message}`, { cause: error });
  }
  return { raw, registry: parseAgentRegistry(value) };
}

export function normalizeAgentRegistry(registry) {
  const clone = typeof structuredClone === "function"
    ? structuredClone(registry)
    : JSON.parse(JSON.stringify(registry));
  clone.skills.sort((left, right) => left.id.localeCompare(right.id));
  clone.agents.sort((left, right) => left.id.localeCompare(right.id));
  clone.legacy_agents.sort((left, right) => left.id.localeCompare(right.id));
  return clone;
}

export function registryDigest(rawBytes) {
  return `sha256:${createHash("sha256").update(rawBytes).digest("hex")}`;
}

const registryRuntimeHelpersSource = [
  "export function agentForOperation(agentId, operation) {",
  "  const agent = ZCODE_AGENT_REGISTRY.agents.find((entry) => entry.id === agentId);",
  "  if (!agent || !agent.operations.includes(operation)) {",
  '    throw new Error(`agent ${agentId} is not authorized for ${operation}`);',
  "  }",
  "  return agent;",
  "}",
  "",
  "export function resolveExecutionClass(agentId, workflowConfig) {",
  "  const agent = ZCODE_AGENT_REGISTRY.agents.find((entry) => entry.id === agentId);",
  "  if (!agent || agent.execution_class_config_key === null) return null;",
  "  return workflowConfig.execution_classes[agent.execution_class_config_key];",
  "}",
  "",
  "export function assertAgentPermission(agentId, operation, permissionClass) {",
  "  const agent = agentForOperation(agentId, operation);",
  "  if (agent.permission_class !== permissionClass) {",
  '    throw new Error(`permission mismatch for ${agentId}/${operation}`);',
  "  }",
  "  return agent;",
  "}",
].join("\n");

export function renderAgentRegistryModule(registry, digest) {
  const normalized = JSON.stringify(normalizeAgentRegistry(registry), null, 2);
  return [
    `export const ZCODE_AGENT_BUNDLE_CONTRACT = ${JSON.stringify(registry.contract)};`,
    `export const ZCODE_AGENT_BUNDLE_VERSION = ${JSON.stringify(registry.bundle_version)};`,
    `export const ZCODE_AGENT_BUNDLE_DIGEST = ${JSON.stringify(digest)};`,
    "function deepFreeze(value) {",
    "  if (value !== null && typeof value === \"object\" && !Object.isFrozen(value)) {",
    "    for (const nested of Object.values(value)) deepFreeze(nested);",
    "    Object.freeze(value);",
    "  }",
    "  return value;",
    "}",
    `export const ZCODE_AGENT_REGISTRY = deepFreeze(${normalized});`,
    registryRuntimeHelpersSource,
    "",
  ].join("\n");
}

const isDirectExecution =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === fileURLToPath(new URL(process.argv[1], "file:"));

if (isDirectExecution) {
  if (process.argv.length !== 3 || process.argv[2] !== "--print") {
    process.stderr.write("usage: node tooling/zcode-workflow/agent-registry.mjs --print\n");
    process.exitCode = 2;
  } else {
    const registryPath = fileURLToPath(new URL("../../zcode-market/agent-registry.json", import.meta.url));
    const { raw, registry } = loadAgentRegistry(registryPath);
    process.stdout.write(renderAgentRegistryModule(registry, registryDigest(raw)));
  }
}
