// Generated from tooling/zcode-workflow/workflow-config.mjs. Do not edit directly.
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, parse, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import * as registryModule from "./agent-registry.mjs";

const RECEIPT_CONTRACT = "ZCODE_WORKFLOW_CONFIG_RECEIPT_V2";
const MIGRATION_PREVIEW_CONTRACT = "ZCODE_WORKFLOW_CONFIG_MIGRATION_PREVIEW_V1";
const MIGRATION_RECEIPT_CONTRACT = "ZCODE_WORKFLOW_CONFIG_MIGRATION_RECEIPT_V1";
const CONFIG_CONTRACT = "ZCODE_WORKFLOW_CONFIG_V2";
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const EXECUTION_ROLES = ["planner", "planner_reviewer", "owner", "review"];
const EXECUTION_CLASSES = new Set(["main", "lite"]);
const LEGACY_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
const LEGACY_PROFILE_SHAPES = [
  ["owner", "planner", "review"],
  ["owner", "planner", "review", "supervisor"],
  ["main", "owner", "planner", "review"],
  ["main", "owner", "planner", "review", "supervisor"],
];
const DEFAULT_CONFIG = {
  contract: CONFIG_CONTRACT,
  parallel: 4,
  execution_classes: Object.fromEntries(
    EXECUTION_ROLES.map((role) => [role, "main"]),
  ),
};
const WORKFLOW_GITIGNORE = [
  "# Managed by Ghost Agent Workflow.",
  "*",
  "!.gitignore",
  "!config.json",
  "!owners/",
  "!owners/**",
  "owners/*/interfaces/",
  "",
].join("\n");
const WRITER_COMMANDS = new Set([
  "init",
  "migrate",
  "set-parallel",
  "set-execution-class",
]);
const MIGRATION_CHANGED_FIELDS = [
  "/contract",
  "/profiles",
  "/execution_classes",
];
const TEST_FAILURE_STAGES = new Set([
  "after-gitignore-write",
  "after-migration-preflight",
  "after-backup-create",
  "after-config-rename",
  "before-post-write-verification",
  "after-post-write-verification",
  "before-migration-receipt-write",
  "after-migration-receipt-write",
]);
const TEST_MUTATION_STAGES = new Set([
  "after-migration-preview",
  "after-migration-preflight",
]);
const TERMINAL_LEGACY_THREAD_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "archived",
]);
const LEGACY_THREAD_STATUSES = new Set([
  "idle",
  "running",
  "completed",
  "failed",
  "cancelled",
  "archived",
  "needs_attention",
  "attention_notified",
  "stalled",
  "lost",
]);
const LEGACY_THREAD_ROLES = new Set([
  "owner",
  "planner",
  "planner_reviewer",
  "review",
  "supervisor",
]);
const LEGACY_WORKFLOW_STATUSES = new Set([
  "active",
  "completed",
  "stopped",
  "cancelled",
]);
const LEGACY_TASK_STATUSES = new Set([
  "pending",
  "reserved",
  "running",
  "completed",
  "stopped",
  "blocked",
  "failed",
  "needs_repair",
  "superseded",
]);
const LEGACY_STOP_ACTIONS = Object.freeze({
  input_missing: "provide_input",
  decision_required: "await_user",
  task_failed: "repair_task",
  thread_failed: "replace_thread",
  plan_invalid: "revise_plan",
  runtime_failed: "retry_runtime",
});
const THREAD_KEY_PATTERN = /^wf_[a-z0-9_]{1,61}$/u;

class SafeRefusal extends Error {}

function fail(message) {
  throw new Error(message);
}

function refuse(message) {
  throw new SafeRefusal(message);
}

function maybeFailForTest(stage) {
  const requested = process.env.ZCODE_WORKFLOW_CONFIG_TEST_FAIL_STAGE;
  if (requested === stage && TEST_FAILURE_STAGES.has(requested)) {
    fail(`injected test failure: ${stage}`);
  }
}

function maybeMutateForTest(stage) {
  const requested = process.env.ZCODE_WORKFLOW_CONFIG_TEST_MUTATE_STAGE;
  if (requested !== stage || !TEST_MUTATION_STAGES.has(requested)) return;
  const path = process.env.ZCODE_WORKFLOW_CONFIG_TEST_MUTATE_PATH;
  const encoded = process.env.ZCODE_WORKFLOW_CONFIG_TEST_MUTATE_BYTES;
  if (typeof path !== "string" || path === "") {
    fail("test mutation path is missing");
  }
  if (typeof encoded !== "string" || encoded === "") {
    fail("test mutation bytes are missing");
  }
  writeFileSync(path, Buffer.from(encoded, "base64"));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value, label) {
  if (!isRecord(value)) fail(`${label} must be an object`);
  return value;
}

function requireExactKeys(value, expected, label) {
  const actual = Object.keys(value);
  const missing = expected.filter((key) => !Object.hasOwn(value, key));
  const unexpected = actual.filter((key) => !expected.includes(key));
  if (missing.length === 0 && unexpected.length === 0) return;
  const details = [];
  if (missing.length > 0) details.push(`missing keys ${missing.join(", ")}`);
  if (unexpected.length > 0) details.push(`unexpected keys ${unexpected.join(", ")}`);
  fail(`${label}: ${details.join("; ")}`);
}

function requireAllowedKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    fail(`${label}: unexpected keys ${unexpected.sort().join(", ")}`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function requireNullableString(value, label) {
  if (value === null) return null;
  return requireString(value, label);
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") fail(`${label} must be a boolean`);
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    fail(`${label} must be a positive integer`);
  }
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    fail(`${label} must be a non-negative integer`);
  }
  return value;
}

function requireIdentifier(value, label) {
  const result = requireString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u.test(result)) {
    fail(`${label} is invalid: ${result}`);
  }
  return result;
}

function requireStringArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value.map((item, index) => requireString(item, `${label}[${index}]`));
}

function ensureUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) fail(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function parseParallel(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 8) {
    fail("parallel must be an integer from 1 to 8");
  }
  return value;
}

function parseLegacyProfile(value, label) {
  const source = requireRecord(value, label);
  requireExactKeys(source, ["model", "effort"], label);
  if (typeof source.model !== "string" || source.model.trim() === "") {
    fail(`${label}.model must be a non-empty string`);
  }
  if (typeof source.effort !== "string" || !LEGACY_EFFORTS.has(source.effort)) {
    fail(`${label}.effort is invalid`);
  }
  return { model: source.model, effort: source.effort };
}

export function parseV2Config(value) {
  const source = requireRecord(value, "config");
  requireExactKeys(source, ["contract", "parallel", "execution_classes"], "config");
  if (source.contract !== CONFIG_CONTRACT) {
    fail(`config.contract must equal ${JSON.stringify(CONFIG_CONTRACT)}`);
  }
  const executionClasses = requireRecord(
    source.execution_classes,
    "config.execution_classes",
  );
  requireExactKeys(executionClasses, EXECUTION_ROLES, "config.execution_classes");
  return {
    contract: CONFIG_CONTRACT,
    parallel: parseParallel(source.parallel),
    execution_classes: Object.fromEntries(
      EXECUTION_ROLES.map((role) => {
        const executionClass = executionClasses[role];
        if (typeof executionClass !== "string" || !EXECUTION_CLASSES.has(executionClass)) {
          fail(`config.execution_classes.${role} must be one of: main, lite`);
        }
        return [role, executionClass];
      }),
    ),
  };
}

export function parseLegacyV1Config(value) {
  const source = requireRecord(value, "config");
  requireExactKeys(source, ["parallel", "profiles"], "config");
  const profiles = requireRecord(source.profiles, "config.profiles");
  const profileKeys = Object.keys(profiles).sort();
  const shape = LEGACY_PROFILE_SHAPES.find(
    (candidate) => candidate.length === profileKeys.length
      && candidate.every((key, index) => key === profileKeys[index]),
  );
  if (shape === undefined) {
    fail("config.profiles keys must match an allowed legacy shape");
  }
  return {
    parallel: parseParallel(source.parallel),
    profiles: Object.fromEntries(
      shape.map((role) => [
        role,
        parseLegacyProfile(profiles[role], `config.profiles.${role}`),
      ]),
    ),
  };
}

function workspacePath(workspaceRoot) {
  return resolve(workspaceRoot);
}

function workflowDirectory(workspaceRoot) {
  return join(workspacePath(workspaceRoot), ".ghost-agent-workflow");
}

function lexicalComponents(path) {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const suffix = absolute.slice(root.length);
  const components = suffix === "" ? [] : suffix.split(sep).filter(Boolean);
  let current = root;
  return [
    root,
    ...components.map((component) => {
      current = join(current, component);
      return current;
    }),
  ];
}

function inspectLexicalPath(path, options = {}) {
  const absolute = resolve(path);
  const allowMissingFrom = options.allowMissingFrom ?? Number.POSITIVE_INFINITY;
  const targetType = options.targetType ?? "directory";
  const components = lexicalComponents(absolute);
  let missing = false;
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    const metadata = pathMetadata(component);
    if (metadata === null) {
      if (index < allowMissingFrom) {
        fail(`path component is missing: ${component}`);
      }
      missing = true;
      continue;
    }
    if (missing) {
      fail(`path appears beneath a missing lexical component: ${component}`);
    }
    if (metadata.isSymbolicLink()) {
      fail(`path component is a symbolic link: ${component}`);
    }
    const isTarget = index === components.length - 1;
    const expectedType = isTarget ? targetType : "directory";
    if (expectedType === "directory" && !metadata.isDirectory()) {
      fail(`path component must be a directory: ${component}`);
    }
    if (expectedType === "file" && !metadata.isFile()) {
      fail(`target must be a regular file: ${component}`);
    }
  }
  return { path: absolute, missing };
}

function parseStoredConfig(value) {
  if (isRecord(value) && Object.hasOwn(value, "profiles")) {
    parseLegacyV1Config(value);
    return { status: "migration_required", source: "legacy", config: null };
  }
  return { status: "shown", source: "file", config: parseV2Config(value) };
}

function readRegularFileBytesNoFollow(path) {
  let descriptor;
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    const closeOnExec = fsConstants.O_CLOEXEC ?? 0;
    const nonBlocking = fsConstants.O_NONBLOCK ?? 0;
    descriptor = openSync(
      path,
      fsConstants.O_RDONLY | noFollow | closeOnExec | nonBlocking,
    );
    if (!fstatSync(descriptor).isFile()) {
      fail(`workflow config must be a regular file: ${path}`);
    }
    return readFileSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readRegularFileNoFollow(path) {
  return readRegularFileBytesNoFollow(path).toString("utf8");
}

function parseConfigBytes(path, bytes) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot read workflow config ${path}: invalid JSON: ${message}`);
  }
  return value;
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function readConfigStrict(workspaceRoot) {
  const workspace = workspacePath(workspaceRoot);
  inspectLexicalPath(workspace, { targetType: "directory" });
  const directory = join(workspace, ".ghost-agent-workflow");
  const workflow = inspectLexicalPath(directory, {
    allowMissingFrom: lexicalComponents(directory).length - 1,
    targetType: "directory",
  });
  const path = join(directory, "config.json");
  if (workflow.missing) {
    return { status: "missing", path, source: "missing", config: null };
  }
  const config = inspectLexicalPath(path, {
    allowMissingFrom: lexicalComponents(path).length - 1,
    targetType: "file",
  });
  if (config.missing) {
    return { status: "missing", path, source: "missing", config: null };
  }

  let raw;
  try {
    raw = readRegularFileBytesNoFollow(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot read workflow config ${path}: ${message}`);
  }

  const value = parseConfigBytes(path, raw);
  try {
    return { path, ...parseStoredConfig(value) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot read workflow config ${path}: ${message}`);
  }
}

export function readWorkflowConfigForRuntime(workspaceRoot, options = {}) {
  const strict = readConfigStrict(workspaceRoot);
  if (strict.status === "missing" && options.missing !== "error") {
    return { config: structuredClone(DEFAULT_CONFIG), source: "default" };
  }
  if (strict.status === "migration_required") {
    return { status: "migration_required", path: strict.path };
  }
  if (strict.status !== "shown") {
    fail(`workflow config is missing: ${strict.path}`);
  }
  return { config: strict.config, source: "file" };
}

function pathMetadata(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function requireRealDirectory(path, label) {
  inspectLexicalPath(path, { targetType: "directory" });
  return resolve(path);
}

function requireSafeWorkspace(workspaceRoot) {
  const path = workspacePath(workspaceRoot);
  inspectLexicalPath(path, { targetType: "directory" });
  return path;
}

function requireSafeExistingWorkflowDirectory(workspaceRoot) {
  const workspace = requireSafeWorkspace(workspaceRoot);
  const directory = join(workspace, ".ghost-agent-workflow");
  const inspected = inspectLexicalPath(directory, {
    allowMissingFrom: lexicalComponents(directory).length - 1,
    targetType: "directory",
  });
  return { workspace, directory, exists: !inspected.missing };
}

function requireSafeTarget(path, label, { allowMissing }) {
  const metadata = pathMetadata(path);
  if (metadata === null) {
    if (allowMissing) return null;
    fail(`${label} is missing: ${path}`);
  }
  if (metadata.isSymbolicLink()) fail(`${label} is a symbolic link: ${path}`);
  if (!metadata.isFile()) fail(`${label} must be a regular file: ${path}`);
  return metadata;
}

function readConfigStrictForWrite(workspaceRoot) {
  const { directory, exists } = requireSafeExistingWorkflowDirectory(workspaceRoot);
  const path = join(directory, "config.json");
  if (!exists) {
    return { status: "missing", path, source: "missing", config: null };
  }
  requireSafeTarget(path, "workflow config", { allowMissing: true });
  return readConfigStrict(workspaceRoot);
}

function serializedConfig(value) {
  return `${JSON.stringify(parseV2Config(value), null, 2)}\n`;
}

function removedLegacyFields(legacy) {
  return Object.keys(legacy.profiles).sort().flatMap((role) => [
    `/profiles/${role}/model`,
    `/profiles/${role}/effort`,
  ]);
}

function migrationTargetConfig(legacy) {
  return parseV2Config({
    contract: CONFIG_CONTRACT,
    parallel: legacy.parallel,
    execution_classes: Object.fromEntries(
      EXECUTION_ROLES.map((role) => [role, "main"]),
    ),
  });
}

function fsyncDirectory(directory) {
  const directoryDescriptor = openSync(directory, fsConstants.O_RDONLY);
  try {
    fsyncSync(directoryDescriptor);
  } finally {
    closeSync(directoryDescriptor);
  }
}

function tryFsyncDirectory(directory) {
  try {
    fsyncDirectory(directory);
  } catch {
    // Preserve the original operation failure after best-effort rollback durability.
  }
}

function removeRegularFileIfPresent(path) {
  const metadata = pathMetadata(path);
  if (metadata === null) return;
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail(`rollback target is not a regular file: ${path}`);
  }
  unlinkSync(path);
}

function restorePreviousConfig(path, previous) {
  const directory = dirname(path);
  removeRegularFileIfPresent(path);
  if (previous !== null) {
    const restoration = join(
      directory,
      `.config.json.${process.pid}.${randomUUID()}.rollback.tmp`,
    );
    let descriptor;
    let exists = false;
    try {
      const noFollow = fsConstants.O_NOFOLLOW ?? 0;
      const closeOnExec = fsConstants.O_CLOEXEC ?? 0;
      descriptor = openSync(
        restoration,
        fsConstants.O_WRONLY
          | fsConstants.O_CREAT
          | fsConstants.O_EXCL
          | noFollow
          | closeOnExec,
        previous.mode,
      );
      exists = true;
      writeFileSync(descriptor, previous.bytes);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      chmodSync(restoration, previous.mode);
      renameSync(restoration, path);
      exists = false;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      if (exists && pathMetadata(restoration) !== null) unlinkSync(restoration);
    }
  }
  tryFsyncDirectory(directory);
}

function writeTextAtomic(
  path,
  payload,
  { requireExisting, expectedExistingBytes = undefined },
) {
  const directory = dirname(path);
  requireRealDirectory(directory, "workflow directory");
  const existing = requireSafeTarget(
    path,
    "workflow config",
    { allowMissing: !requireExisting },
  );
  const previous = existing === null ? null : {
    bytes: readRegularFileBytesNoFollow(path),
    mode: existing.mode & 0o7777,
  };
  if (
    expectedExistingBytes !== undefined
    && (previous === null || !previous.bytes.equals(expectedExistingBytes))
  ) {
    refuse(`source changed after migration preflight: ${path}`);
  }
  const targetMode = previous === null ? 0o644 : previous.mode;
  const temporaryPath = join(
    directory,
    `.config.json.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor;
  let temporaryExists = false;
  let renamed = false;
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    const closeOnExec = fsConstants.O_CLOEXEC ?? 0;
    descriptor = openSync(
      temporaryPath,
      fsConstants.O_WRONLY
        | fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | noFollow
        | closeOnExec,
      targetMode,
    );
    temporaryExists = true;
    writeFileSync(descriptor, payload, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(temporaryPath, targetMode);
    if (requireExisting) {
      requireSafeTarget(path, "workflow config", { allowMissing: false });
      if (expectedExistingBytes !== undefined) {
        const immediatelyBeforeRename = readRegularFileBytesNoFollow(path);
        if (!immediatelyBeforeRename.equals(expectedExistingBytes)) {
          refuse(`source changed before atomic replacement: ${path}`);
        }
      }
    } else if (pathMetadata(path) !== null) {
      fail(`workflow config already exists: ${path}`);
    }
    renameSync(temporaryPath, path);
    temporaryExists = false;
    renamed = true;
    maybeFailForTest("after-config-rename");
    fsyncDirectory(directory);
  } catch (error) {
    if (renamed) {
      try {
        restorePreviousConfig(path, previous);
      } catch (rollbackError) {
        const rollbackMessage = rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError);
        const originalMessage = error instanceof Error ? error.message : String(error);
        fail(`${originalMessage}; rollback failed: ${rollbackMessage}`);
      }
    }
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (temporaryExists && existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function snapshotConfigForRollback(path) {
  const metadata = requireSafeTarget(
    path,
    "workflow config",
    { allowMissing: true },
  );
  if (metadata === null) return null;
  return {
    bytes: readRegularFileBytesNoFollow(path),
    mode: metadata.mode & 0o7777,
  };
}

function writeConfigAtomic(path, config, options) {
  writeTextAtomic(path, serializedConfig(config), options);
}

function writeExclusiveRegularFile(path, bytes, mode, label) {
  const directory = dirname(path);
  requireRealDirectory(directory, "workflow directory");
  if (pathMetadata(path) !== null) fail(`${label} already exists: ${path}`);
  let descriptor;
  let created = false;
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    const closeOnExec = fsConstants.O_CLOEXEC ?? 0;
    descriptor = openSync(
      path,
      fsConstants.O_WRONLY
        | fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | noFollow
        | closeOnExec,
      mode,
    );
    created = true;
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    chmodSync(path, mode);
    fsyncDirectory(directory);
  } catch (error) {
    if (created) {
      try {
        removeRegularFileIfPresent(path);
        tryFsyncDirectory(directory);
      } catch {
        // Preserve the original backup creation failure.
      }
    }
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function ensureWorkflowDirectoryForInit(workspaceRoot) {
  const checked = requireSafeExistingWorkflowDirectory(workspaceRoot);
  if (checked.exists) return { ...checked, created: false };
  try {
    mkdirSync(checked.directory, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const verified = requireSafeExistingWorkflowDirectory(workspaceRoot);
  if (!verified.exists) fail(`cannot create workflow directory: ${checked.directory}`);
  return { ...verified, created: true };
}

function validateOptionalGitignore(directory) {
  const path = join(directory, ".gitignore");
  const metadata = pathMetadata(path);
  if (metadata !== null) {
    requireSafeTarget(path, "workflow .gitignore", { allowMissing: false });
  }
  return path;
}

function safeDirectoryEntries(path, label) {
  const metadata = pathMetadata(path);
  if (metadata === null) return [];
  if (metadata.isSymbolicLink()) fail(`${label} is a symbolic link: ${path}`);
  if (!metadata.isDirectory()) fail(`${label} must be a directory: ${path}`);
  return readdirSync(path, { withFileTypes: true });
}

function readOptionalRuntimeMarker(path, label, parser) {
  const metadata = pathMetadata(path);
  if (metadata === null) return null;
  try {
    requireSafeTarget(path, label, { allowMissing: false });
    const value = parseConfigBytes(path, readRegularFileBytesNoFollow(path));
    return parser(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    refuse(`invalid recognized runtime marker ${path}: ${message}`);
  }
}

function parseStopDirective(reasonValue, actionValue, status, label) {
  const reason = reasonValue === null ? null : requireString(reasonValue, `${label}.reason`);
  const action = actionValue === null ? null : requireString(actionValue, `${label}.action`);
  if (status !== "stopped") {
    if (reason !== null || action !== null) {
      fail(`${label} non-stopped state cannot contain reason/action`);
    }
    return;
  }
  if (reason === null || action === null) {
    fail(`${label} stopped state requires reason/action`);
  }
  if (!Object.hasOwn(LEGACY_STOP_ACTIONS, reason) || LEGACY_STOP_ACTIONS[reason] !== action) {
    fail(`${label} reason/action pair is invalid`);
  }
}

function parseLegacyQuickRun(value) {
  const source = requireRecord(value, "workflow state.run");
  requireExactKeys(
    source,
    [
      "id", "kind", "owner", "generation", "work", "title", "token", "executor",
      "host", "cursor", "status", "request_dag",
    ],
    "workflow state.run",
  );
  if (source.kind !== "work" && source.kind !== "review") fail("workflow run kind is invalid");
  if (source.status !== "reserved" && source.status !== "running") {
    fail("workflow run status is invalid");
  }
  const owner = requireNullableString(source.owner, "workflow state.run.owner");
  if (owner === null) fail("quick run requires owner");
  return {
    id: requireString(source.id, "workflow state.run.id"),
    kind: source.kind,
    owner,
    generation: requirePositiveInteger(source.generation, "workflow state.run.generation"),
    work: requireString(source.work, "workflow state.run.work"),
    title: requireString(source.title, "workflow state.run.title"),
    token: requireString(source.token, "workflow state.run.token"),
    executor: requireNullableString(source.executor, "workflow state.run.executor"),
    host: requireNullableString(source.host, "workflow state.run.host"),
    cursor: requireNullableString(source.cursor, "workflow state.run.cursor"),
    status: source.status,
    request_dag: requireBoolean(source.request_dag, "workflow state.run.request_dag"),
  };
}

function parseLegacyWorkflowState(value) {
  const source = requireRecord(value, "workflow state");
  requireAllowedKeys(
    source,
    [
      "contract", "status", "reason", "action", "revision", "next", "registry", "run",
      "accepted", "attention", "result_ref",
    ],
    "workflow state",
  );
  if (source.contract !== "WORKFLOW_STATE_V1") {
    fail("workflow state contract must equal WORKFLOW_STATE_V1");
  }
  if (!LEGACY_WORKFLOW_STATUSES.has(source.status)) fail("workflow state.status is invalid");
  parseStopDirective(source.reason ?? null, source.action ?? null, source.status, "workflow state");
  if (!["owner", "decision", "upgrade", "dag", "blocked", "completed"].includes(source.next)) {
    fail("workflow state.next is invalid");
  }
  const registry = requireRecord(source.registry, "workflow state.registry");
  requireExactKeys(registry, ["revision", "digest"], "workflow state.registry");
  requirePositiveInteger(source.revision, "workflow state.revision");
  requirePositiveInteger(registry.revision, "workflow state.registry.revision");
  requireString(registry.digest, "workflow state.registry.digest");
  const run = source.run === null ? null : parseLegacyQuickRun(source.run);
  if (source.accepted !== null) {
    const accepted = requireRecord(source.accepted, "workflow state.accepted");
    requireExactKeys(
      accepted,
      ["owner", "executor", "summary", "files", "review"],
      "workflow state.accepted",
    );
    requireIdentifier(accepted.owner, "workflow state.accepted.owner");
    requireString(accepted.executor, "workflow state.accepted.executor");
    requireString(accepted.summary, "workflow state.accepted.summary");
    requireStringArray(accepted.files, "workflow state.accepted.files");
    requireNullableString(accepted.review, "workflow state.accepted.review");
  }
  requireNullableString(source.attention, "workflow state.attention");
  const resultRef = requireNullableString(source.result_ref, "workflow state.result_ref");
  if (source.status === "completed" && (source.next !== "completed" || resultRef === null)) {
    fail("completed workflow state requires next=completed and result_ref");
  }
  if (source.status === "active" && resultRef !== null) {
    fail("active workflow state cannot contain result_ref");
  }
  if (run !== null && source.next === "completed") fail("completed workflow cannot have a run");
  return { status: source.status, run };
}

function parseLegacyGoalState(value) {
  const source = requireRecord(value, "goal state");
  requireExactKeys(
    source,
    [
      "contract", "goal_digest", "status", "controller", "native_goal",
      "worktree_baseline", "source_blocks", "active_plan_path", "result_ref",
      "completed_at", "native_sync",
    ],
    "goal state",
  );
  if (source.contract !== "GOAL_STATE_V1") fail("goal state contract must equal GOAL_STATE_V1");
  if (source.status !== "active" && source.status !== "completed") {
    fail("goal state.status is invalid");
  }
  requireString(source.goal_digest, "goal state.goal_digest");
  if (!["codex_native", "standalone_thread", "local_fallback"].includes(source.controller)) {
    fail("goal state.controller is invalid");
  }
  if (source.native_goal !== null) {
    const nativeGoal = requireRecord(source.native_goal, "goal state.native_goal");
    requireExactKeys(nativeGoal, ["thread_id", "created_at"], "goal state.native_goal");
    requireString(nativeGoal.thread_id, "goal state.native_goal.thread_id");
    requirePositiveInteger(nativeGoal.created_at, "goal state.native_goal.created_at");
  }
  for (const key of ["worktree_baseline", "source_blocks"]) {
    const artifact = requireRecord(source[key], `goal state.${key}`);
    requireExactKeys(artifact, ["ref", "digest"], `goal state.${key}`);
    requireString(artifact.ref, `goal state.${key}.ref`);
    const digest = requireString(artifact.digest, `goal state.${key}.digest`);
    if (!/^[0-9a-f]{64}$/u.test(digest)) fail(`goal state.${key}.digest is invalid`);
  }
  requireNullableString(source.active_plan_path, "goal state.active_plan_path");
  const resultRef = requireNullableString(source.result_ref, "goal state.result_ref");
  const completedAt = requireNullableString(source.completed_at, "goal state.completed_at");
  if ((source.status === "active") !== (completedAt === null)) {
    fail("goal state.completed_at must be null only while active");
  }
  if (source.status === "active" && resultRef !== null) {
    fail("active goal state cannot contain result_ref");
  }
  const nativeSync = requireRecord(source.native_sync, "goal state.native_sync");
  requireExactKeys(
    nativeSync,
    ["status", "completion_token", "objective_digest", "confirmed_at"],
    "goal state.native_sync",
  );
  if (!["not_started", "not_required", "pending", "confirmed"].includes(nativeSync.status)) {
    fail("goal state.native_sync.status is invalid");
  }
  requireNullableString(nativeSync.completion_token, "goal state.native_sync.completion_token");
  requireString(nativeSync.objective_digest, "goal state.native_sync.objective_digest");
  requireNullableString(nativeSync.confirmed_at, "goal state.native_sync.confirmed_at");
  return { status: source.status };
}

function validateLegacyTaskState(value, taskId) {
  const label = `state.tasks.${taskId}`;
  const source = requireRecord(value, label);
  const status = requireString(source.status, `${label}.status`);
  if (!LEGACY_TASK_STATUSES.has(status)) fail(`${label}.status is invalid`);
  const normalizedStatus = status === "reserved" ? "running" : status;
  parseStopDirective(
    source.reason ?? (status === "blocked" ? "input_missing" : null),
    source.action ?? (status === "blocked" ? "provide_input" : null),
    normalizedStatus === "blocked" || normalizedStatus === "failed"
      || normalizedStatus === "needs_repair" || normalizedStatus === "superseded"
      ? "stopped"
      : normalizedStatus,
    label,
  );
  requireNonNegativeInteger(source.attempt, `${label}.attempt`);
  requireNullableString(source.reservation_token, `${label}.reservation_token`);
  if (source.owner_generation !== null) {
    requirePositiveInteger(source.owner_generation, `${label}.owner_generation`);
  }
  requireNullableString(source.executor_id, `${label}.executor_id`);
  requirePositiveInteger(source.source_revision, `${label}.source_revision`);
  requirePositiveInteger(source.validated_source_revision, `${label}.validated_source_revision`);
  for (const key of [
    "reserved_at", "result_path", "result_ref", "result_digest", "replacement_task_id",
    "last_reclaimed_token", "task_baseline_ref", "task_baseline_digest",
  ]) requireNullableString(source[key], `${label}.${key}`);
  requireStringArray(source.expanded_writable_paths, `${label}.expanded_writable_paths`);
  if (source.accepted_change_seq !== null) {
    requireNonNegativeInteger(source.accepted_change_seq, `${label}.accepted_change_seq`);
  }
  return status;
}

function validateLegacySubjectMap(value, label) {
  const source = requireRecord(value, label);
  for (const [subjectId, subjectValue] of Object.entries(source)) {
    requireIdentifier(subjectId, `${label} key`);
    const subject = requireRecord(subjectValue, `${label}.${subjectId}`);
    if (!["unbound", "idle", "reserved", "running"].includes(subject.status)) {
      fail(`${label}.${subjectId}.status is invalid`);
    }
    requirePositiveInteger(subject.generation, `${label}.${subjectId}.generation`);
    requireNullableString(subject.bound_executor_id, `${label}.${subjectId}.bound_executor_id`);
    requireNullableString(subject.current_task_id, `${label}.${subjectId}.current_task_id`);
    requireNullableString(subject.capsule_ref, `${label}.${subjectId}.capsule_ref`);
    requireStringArray(subject.completed_task_ids, `${label}.${subjectId}.completed_task_ids`);
    requireStringArray(subject.result_refs, `${label}.${subjectId}.result_refs`);
  }
}

function parseLegacyRunState(value) {
  const source = requireRecord(value, "state");
  if (source.contract !== "DAG_RUN_STATE_V5") fail("state contract must equal DAG_RUN_STATE_V5");
  const tasks = requireRecord(source.tasks, "state.tasks");
  const taskStatuses = Object.entries(tasks).map(([taskId, task]) => {
    requireIdentifier(taskId, "state task id");
    return validateLegacyTaskState(task, taskId);
  });
  validateLegacySubjectMap(source.owners, "state.owners");
  validateLegacySubjectMap(source.runtime_actors, "state.runtime_actors");
  validateLegacySubjectMap(source.reviewers, "state.reviewers");
  const status = source.status === undefined ? "active" : requireString(source.status, "state.status");
  if (!LEGACY_WORKFLOW_STATUSES.has(status)) fail("state.status is invalid");
  parseStopDirective(source.reason ?? null, source.action ?? null, status, "state");
  requireString(source.plan_digest, "state.plan_digest");
  requireString(source.goal_digest, "state.goal_digest");
  requireBoolean(source.goal_refresh_pending, "state.goal_refresh_pending");
  requirePositiveInteger(source.source_revision, "state.source_revision");
  requirePositiveInteger(source.revision, "state.revision");
  requireNonNegativeInteger(source.workspace_change_seq, "state.workspace_change_seq");
  const ownerRegistry = requireRecord(source.owner_registry, "state.owner_registry");
  requireString(ownerRegistry.ref, "state.owner_registry.ref");
  requireString(ownerRegistry.digest, "state.owner_registry.digest");
  requirePositiveInteger(ownerRegistry.revision, "state.owner_registry.revision");
  if (source.owner_change !== null) {
    const ownerChange = requireRecord(source.owner_change, "state.owner_change");
    requireExactKeys(ownerChange, ["request_ref", "request_digest"], "state.owner_change");
    requireString(ownerChange.request_ref, "state.owner_change.request_ref");
    requireString(ownerChange.request_digest, "state.owner_change.request_digest");
  }
  requireStringArray(source.review_pending, "state.review_pending");
  if (!Array.isArray(source.stale_executors)) fail("state.stale_executors must be an array");
  source.stale_executors.forEach((entry, index) => {
    const stale = requireRecord(entry, `state.stale_executors[${index}]`);
    if (stale.status !== "stop_pending") {
      fail(`state.stale_executors[${index}].status must equal stop_pending`);
    }
    requireString(stale.executor_id, `state.stale_executors[${index}].executor_id`);
    requireIdentifier(stale.owner_id, `state.stale_executors[${index}].owner_id`);
    requireIdentifier(stale.task_id, `state.stale_executors[${index}].task_id`);
    requirePositiveInteger(stale.attempt, `state.stale_executors[${index}].attempt`);
    requireString(stale.reservation_token, `state.stale_executors[${index}].reservation_token`);
    requirePositiveInteger(stale.source_revision, `state.stale_executors[${index}].source_revision`);
    requireString(stale.reclaimed_at, `state.stale_executors[${index}].reclaimed_at`);
  });
  return { status, taskStatuses };
}

function parseLegacyThreadRegistry(value) {
  const source = requireRecord(value, "thread registry");
  requireExactKeys(
    source,
    ["contract", "goal_id", "main", "threads", "watches"],
    "thread registry",
  );
  if (source.contract !== "THREAD_REGISTRY_V1") {
    fail("thread registry contract must equal THREAD_REGISTRY_V1");
  }
  requireIdentifier(source.goal_id, "thread registry.goal_id");
  const main = requireRecord(source.main, "thread registry.main");
  requireExactKeys(main, ["thread_id", "host_id"], "thread registry.main");
  requireString(main.thread_id, "thread registry.main.thread_id");
  requireString(main.host_id, "thread registry.main.host_id");
  const threads = requireRecord(source.threads, "thread registry.threads");
  const threadIds = [];
  const threadStatuses = [];
  for (const [threadKey, threadValue] of Object.entries(threads)) {
    if (!THREAD_KEY_PATTERN.test(threadKey) || threadKey.length > 64) {
      fail(`thread registry key is invalid: ${threadKey}`);
    }
    const thread = requireRecord(threadValue, `thread registry.threads.${threadKey}`);
    requireExactKeys(
      thread,
      ["thread_id", "host_id", "role", "status", "cursor"],
      `thread registry.threads.${threadKey}`,
    );
    threadIds.push(requireString(thread.thread_id, `thread registry.threads.${threadKey}.thread_id`));
    requireString(thread.host_id, `thread registry.threads.${threadKey}.host_id`);
    if (!LEGACY_THREAD_ROLES.has(thread.role)) {
      fail(`thread registry.threads.${threadKey}.role is invalid`);
    }
    if (!LEGACY_THREAD_STATUSES.has(thread.status)) {
      fail(`thread registry.threads.${threadKey}.status is invalid`);
    }
    threadStatuses.push(thread.status);
    requireNullableString(thread.cursor, `thread registry.threads.${threadKey}.cursor`);
  }
  ensureUnique(threadIds, "thread registry thread id");
  if (!Array.isArray(source.watches)) fail("thread registry.watches must be an array");
  const watchIds = source.watches.map((watchValue, index) => {
    const watch = requireRecord(watchValue, `thread registry.watches[${index}]`);
    requireExactKeys(
      watch,
      ["task_id", "attempt", "thread_key", "unchanged_waits"],
      `thread registry.watches[${index}]`,
    );
    const taskId = requireIdentifier(watch.task_id, `thread registry.watches[${index}].task_id`);
    const attempt = requirePositiveInteger(watch.attempt, `thread registry.watches[${index}].attempt`);
    const threadKey = requireString(watch.thread_key, `thread registry.watches[${index}].thread_key`);
    if (!Object.hasOwn(threads, threadKey)) {
      fail(`thread registry watch references unknown thread: ${threadKey}`);
    }
    requireNonNegativeInteger(
      watch.unchanged_waits,
      `thread registry.watches[${index}].unchanged_waits`,
    );
    return `${taskId}\u0000${attempt}\u0000${threadKey}`;
  });
  ensureUnique(watchIds, "thread registry watch identity");
  return { threadStatuses, watchCount: source.watches.length };
}

function parseLegacyDagWorktrees(value) {
  const source = requireRecord(value, "DAG worktrees");
  requireExactKeys(source, ["contract", "original", "dag", "owners"], "DAG worktrees");
  if (source.contract !== "DAG_WORKTREES_V1") fail("DAG worktrees contract is invalid");
  const original = requireRecord(source.original, "DAG worktrees.original");
  requireExactKeys(original, ["path", "branch", "head"], "DAG worktrees.original");
  requireString(original.path, "DAG worktrees.original.path");
  requireString(original.branch, "DAG worktrees.original.branch");
  requireString(original.head, "DAG worktrees.original.head");
  const dag = requireRecord(source.dag, "DAG worktrees.dag");
  requireExactKeys(dag, ["path", "branch"], "DAG worktrees.dag");
  requireString(dag.path, "DAG worktrees.dag.path");
  const dagBranch = requireString(dag.branch, "DAG worktrees.dag.branch");
  const match = /^ga\/([a-z0-9][a-z0-9_-]{0,63})\/main$/u.exec(dagBranch);
  if (match === null) fail(`invalid DAG integration branch: ${dagBranch}`);
  const owners = requireRecord(source.owners, "DAG worktrees.owners");
  let unfinishedOwnerCount = 0;
  for (const [ownerId, ownerValue] of Object.entries(owners)) {
    requireIdentifier(ownerId, "DAG worktree owner id");
    const owner = requireRecord(ownerValue, `DAG worktrees.owners.${ownerId}`);
    requireExactKeys(
      owner,
      ["branch", "path", "synced_dag_head"],
      `DAG worktrees.owners.${ownerId}`,
    );
    const expectedBranch = `ga/${match[1]}/${ownerId}`;
    if (requireString(owner.branch, `DAG worktrees.owners.${ownerId}.branch`) !== expectedBranch) {
      fail(`Owner ${ownerId} branch must equal ${expectedBranch}`);
    }
    if (owner.path !== null) {
      requireString(owner.path, `DAG worktrees.owners.${ownerId}.path`);
      unfinishedOwnerCount += 1;
    }
    requireString(owner.synced_dag_head, `DAG worktrees.owners.${ownerId}.synced_dag_head`);
  }
  return { unfinishedOwnerCount };
}

function parseOwnerLeaseMarker(value, expectedOwnerId) {
  const source = requireRecord(value, "owner lease");
  requireExactKeys(
    source,
    [
      "contract", "owner_id", "goal_id", "task_id", "state_path", "reservation_token",
      "executor_id", "acquired_at", "heartbeat_at", "status",
    ],
    "owner lease",
  );
  if (source.contract !== "OWNER_LEASE_V1") fail("owner lease contract must equal OWNER_LEASE_V1");
  const ownerId = requireIdentifier(source.owner_id, "owner lease.owner_id");
  if (ownerId !== expectedOwnerId) {
    fail(`owner lease owner_id mismatch: expected ${expectedOwnerId}, got ${ownerId}`);
  }
  requireIdentifier(source.goal_id, "owner lease.goal_id");
  requireIdentifier(source.task_id, "owner lease.task_id");
  requireString(source.state_path, "owner lease.state_path");
  requireString(source.reservation_token, "owner lease.reservation_token");
  requireNullableString(source.executor_id, "owner lease.executor_id");
  requireString(source.acquired_at, "owner lease.acquired_at");
  requireString(source.heartbeat_at, "owner lease.heartbeat_at");
  if (source.status !== "reserved" && source.status !== "running") {
    fail("owner lease.status is invalid");
  }
  return source;
}

function activeLegacyWorkflowMarker(workspaceRoot) {
  const runtime = join(workflowDirectory(workspaceRoot), "runtime");
  const runtimeEntries = safeDirectoryEntries(runtime, "workflow runtime directory");
  if (runtimeEntries.length === 0) return null;

  const ownersRoot = join(runtime, "owners");
  for (const ownerEntry of safeDirectoryEntries(ownersRoot, "runtime owners directory")) {
    if (ownerEntry.isSymbolicLink()) {
      refuse(`invalid recognized runtime marker ${join(ownersRoot, ownerEntry.name)}: runtime owner entry is a symbolic link`);
    }
    if (!ownerEntry.isDirectory()) continue;
    const leasePath = join(ownersRoot, ownerEntry.name, "lease.json");
    const lease = readOptionalRuntimeMarker(
      leasePath,
      "runtime owner lease",
      (value) => parseOwnerLeaseMarker(value, ownerEntry.name),
    );
    if (lease !== null) return leasePath;
  }

  const goalsRoot = join(runtime, "goals");
  for (const goalEntry of safeDirectoryEntries(goalsRoot, "runtime goals directory")) {
    if (goalEntry.isSymbolicLink()) {
      refuse(`invalid recognized runtime marker ${join(goalsRoot, goalEntry.name)}: runtime goal entry is a symbolic link`);
    }
    if (!goalEntry.isDirectory()) continue;
    const directory = join(goalsRoot, goalEntry.name);
    const workflowStatePath = join(directory, "workflow-state.json");
    const workflowState = readOptionalRuntimeMarker(
      workflowStatePath,
      "legacy workflow state",
      parseLegacyWorkflowState,
    );
    const statePath = join(directory, "state.json");
    const state = readOptionalRuntimeMarker(statePath, "legacy run state", parseLegacyRunState);
    const threadsPath = join(directory, "threads.json");
    const threads = readOptionalRuntimeMarker(
      threadsPath,
      "legacy thread registry",
      parseLegacyThreadRegistry,
    );
    const goalStatePath = join(directory, "goal-state.json");
    const goalState = readOptionalRuntimeMarker(
      goalStatePath,
      "legacy goal state",
      parseLegacyGoalState,
    );
    const worktreesPath = join(directory, "worktrees.json");
    const worktrees = readOptionalRuntimeMarker(
      worktreesPath,
      "legacy worktree state",
      parseLegacyDagWorktrees,
    );

    if (workflowState?.run !== null && workflowState?.run !== undefined) return workflowStatePath;
    if (state?.taskStatuses.some((status) => status === "reserved" || status === "running")) {
      return statePath;
    }
    if (threads?.watchCount > 0) return threadsPath;
    if (threads?.threadStatuses.some((status) => !TERMINAL_LEGACY_THREAD_STATUSES.has(status))) {
      return threadsPath;
    }
    const activeGoal = workflowState?.status === "active"
      || goalState?.status === "active"
      || state?.status === "active";
    if (activeGoal && (worktrees?.unfinishedOwnerCount ?? 0) > 0) return worktreesPath;
  }
  return null;
}

function createManagedGitignore(directory) {
  const path = join(directory, ".gitignore");
  const metadata = pathMetadata(path);
  if (metadata !== null) {
    requireSafeTarget(path, "workflow .gitignore", { allowMissing: false });
    return { path, created: false };
  }
  let created = false;
  try {
    writeFileSync(path, WORKFLOW_GITIGNORE, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
    created = true;
    maybeFailForTest("after-gitignore-write");
    fsyncDirectory(directory);
    return { path, created: true };
  } catch (error) {
    if (error?.code === "EEXIST" && !created) {
      requireSafeTarget(path, "workflow .gitignore", { allowMissing: false });
      return { path, created: false };
    }
    if (created) {
      removeRegularFileIfPresent(path);
      tryFsyncDirectory(directory);
    }
    throw error;
  }
}

function cleanupCreatedInitPaths({ directory, directoryCreated, gitignoreCreated }) {
  if (gitignoreCreated) {
    const path = join(directory, ".gitignore");
    const metadata = pathMetadata(path);
    if (metadata !== null && metadata.isFile() && !metadata.isSymbolicLink()) {
      unlinkSync(path);
    }
  }
  if (directoryCreated) {
    try {
      rmdirSync(directory);
    } catch {
      // Leave a directory created by another process or containing unexpected entries.
    }
  }
}

function loadAgentRegistry() {
  if (isRecord(registryModule.ZCODE_AGENT_REGISTRY)) {
    return registryModule.ZCODE_AGENT_REGISTRY;
  }
  if (typeof registryModule.loadAgentRegistry === "function") {
    const path = fileURLToPath(
      new URL("../../zcode-market/agent-registry.json", import.meta.url),
    );
    return registryModule.loadAgentRegistry(path).registry;
  }
  fail("cannot load the ZCode Agent Registry");
}

const AGENT_REGISTRY = loadAgentRegistry();

export function executionClassForOperation(config, operation) {
  const parsedConfig = parseV2Config(config);
  const matches = AGENT_REGISTRY.agents.filter(
    (agent) => agent.execution_class_config_key !== null
      && agent.operations.includes(operation),
  );
  if (matches.length === 0) {
    fail(`operation ${operation} does not have an execution class in the ZCode Agent Registry`);
  }
  if (matches.length > 1) {
    fail(`operation ${operation} has multiple execution classes in the ZCode Agent Registry`);
  }
  return parsedConfig.execution_classes[matches[0].execution_class_config_key];
}

function receipt(operation, status, path, source, config, changedFields) {
  const payload = {
    contract: RECEIPT_CONTRACT,
    operation,
    status,
    path,
    source,
    config,
  };
  if (changedFields !== undefined) payload.changed_fields = changedFields;
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function emitStrictReceipt(operation, strict) {
  const status = strict.status === "shown" && operation === "validate-strict"
    ? "valid"
    : strict.status;
  receipt(operation, status, strict.path, strict.source, strict.config);
}

function emitMigrationRequired(operation, strict) {
  receipt(operation, "migration_required", strict.path, strict.source, null);
  process.stderr.write(`workflow config requires explicit migration: ${strict.path}\n`);
  process.exitCode = 2;
}

function parseParallelArgument(value) {
  if (!/^[1-8]$/u.test(value)) fail("parallel must be an integer from 1 to 8");
  return parseParallel(Number(value));
}

function requireSourceDigest(value) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    refuse("source digest must match sha256:<64 lowercase hexadecimal characters>");
  }
  return value;
}

function readMigrationSource(workspaceRoot) {
  const strict = readConfigStrictForWrite(workspaceRoot);
  if (strict.status === "missing") {
    refuse(`workflow config is missing: ${strict.path}`);
  }
  validateOptionalGitignore(dirname(strict.path));
  if (strict.status === "shown") {
    refuse(`workflow config is already V2: ${strict.path}`);
  }
  const metadata = requireSafeTarget(
    strict.path,
    "workflow config",
    { allowMissing: false },
  );
  const bytes = readRegularFileBytesNoFollow(strict.path);
  let legacy;
  try {
    legacy = parseLegacyV1Config(parseConfigBytes(strict.path, bytes));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot read workflow config ${strict.path}: ${message}`);
  }
  const targetConfig = migrationTargetConfig(legacy);
  const targetBytes = Buffer.from(serializedConfig(targetConfig), "utf8");
  return {
    path: strict.path,
    mode: metadata.mode & 0o7777,
    bytes,
    legacy,
    sourceDigest: digestBytes(bytes),
    targetConfig,
    targetBytes,
    targetDigest: digestBytes(targetBytes),
    removedFields: removedLegacyFields(legacy),
  };
}

function migrationPreviewPayload(source) {
  return {
    contract: MIGRATION_PREVIEW_CONTRACT,
    operation: "migrate",
    status: "preview",
    path: source.path,
    source: "legacy",
    source_digest: source.sourceDigest,
    target_digest: source.targetDigest,
    target_config: source.targetConfig,
    removed_fields: source.removedFields,
    changed_fields: MIGRATION_CHANGED_FIELDS,
  };
}

function migrationReceiptPayload(source, backupPath) {
  return {
    contract: MIGRATION_RECEIPT_CONTRACT,
    operation: "migrate",
    status: "migrated",
    path: source.path,
    source: "legacy",
    source_digest: source.sourceDigest,
    target_digest: source.targetDigest,
    config: source.targetConfig,
    changed_fields: MIGRATION_CHANGED_FIELDS,
    removed_fields: source.removedFields,
    backup_path: backupPath,
  };
}

function emitPayload(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function migrationTimestamp() {
  const override = process.env.ZCODE_WORKFLOW_CONFIG_TEST_UTC;
  if (override !== undefined) {
    if (!/^\d{8}T\d{9}Z$/u.test(override)) fail("test UTC timestamp is invalid");
    return override;
  }
  return new Date().toISOString().replace(/[-:.]/gu, "");
}

function migrationBackupPath(source) {
  return join(
    dirname(source.path),
    `config.v1.backup-${migrationTimestamp()}-${source.sourceDigest.slice(7, 19)}.json`,
  );
}

function previewMigration(workspaceRoot) {
  const source = readMigrationSource(workspaceRoot);
  maybeMutateForTest("after-migration-preview");
  emitPayload(migrationPreviewPayload(source));
}

function applyMigration(workspaceRoot, requestedDigest) {
  const digest = requireSourceDigest(requestedDigest);
  const source = readMigrationSource(workspaceRoot);
  if (source.sourceDigest !== digest) {
    refuse(`source digest mismatch: expected ${source.sourceDigest}, got ${digest}`);
  }
  const activeMarker = activeLegacyWorkflowMarker(workspaceRoot);
  if (activeMarker !== null) {
    refuse(`active legacy workflow prevents config migration: ${activeMarker}`);
  }
  maybeMutateForTest("after-migration-preflight");
  maybeFailForTest("after-migration-preflight");

  const currentBytes = readRegularFileBytesNoFollow(source.path);
  const currentDigest = digestBytes(currentBytes);
  if (!currentBytes.equals(source.bytes) || currentDigest !== source.sourceDigest) {
    refuse(`source changed after migration preflight: ${source.path}`);
  }
  const currentLegacy = parseLegacyV1Config(parseConfigBytes(source.path, currentBytes));
  if (JSON.stringify(currentLegacy) !== JSON.stringify(source.legacy)) {
    refuse(`source changed after migration preflight: ${source.path}`);
  }

  const backupPath = migrationBackupPath(source);
  let backupCreated = false;
  let configReplaced = false;
  try {
    writeExclusiveRegularFile(
      backupPath,
      source.bytes,
      source.mode,
      "workflow config V1 backup",
    );
    backupCreated = true;
    maybeFailForTest("after-backup-create");
    writeTextAtomic(source.path, source.targetBytes, {
      requireExisting: true,
      expectedExistingBytes: source.bytes,
    });
    configReplaced = true;
    maybeFailForTest("before-post-write-verification");
    const verified = readConfigStrictForWrite(workspaceRoot);
    if (verified.status !== "shown") {
      fail(`workflow config migration did not produce valid V2: ${source.path}`);
    }
    const writtenBytes = readRegularFileBytesNoFollow(source.path);
    if (!writtenBytes.equals(source.targetBytes)) {
      fail(`workflow config migration target bytes changed: ${source.path}`);
    }
    if (digestBytes(writtenBytes) !== source.targetDigest) {
      fail(`workflow config migration target digest mismatch: ${source.path}`);
    }
    maybeFailForTest("after-post-write-verification");
    const receiptPayload = migrationReceiptPayload(source, backupPath);
    maybeFailForTest("before-migration-receipt-write");
    emitPayload(receiptPayload);
    maybeFailForTest("after-migration-receipt-write");
  } catch (error) {
    let configRestored = !configReplaced;
    if (configReplaced) {
      try {
        restorePreviousConfig(source.path, { bytes: source.bytes, mode: source.mode });
        configRestored = true;
      } catch (rollbackError) {
        const rollbackMessage = rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError);
        const originalMessage = error instanceof Error ? error.message : String(error);
        fail(`${originalMessage}; rollback failed: ${rollbackMessage}`);
      }
    }
    if (backupCreated && configRestored) {
      try {
        removeRegularFileIfPresent(backupPath);
        tryFsyncDirectory(dirname(backupPath));
      } catch (cleanupError) {
        const cleanupMessage = cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError);
        const originalMessage = error instanceof Error ? error.message : String(error);
        fail(`${originalMessage}; backup cleanup failed: ${cleanupMessage}`);
      }
    }
    throw error;
  }
}

function initializeConfig(workspaceRoot) {
  const strict = readConfigStrictForWrite(workspaceRoot);
  if (strict.status === "shown") {
    createManagedGitignore(dirname(strict.path));
    receipt("init", "existing", strict.path, "file", strict.config);
    return;
  }
  if (strict.status === "migration_required") {
    validateOptionalGitignore(dirname(strict.path));
    emitMigrationRequired("init", strict);
    return;
  }

  const created = ensureWorkflowDirectoryForInit(workspaceRoot);
  let gitignoreCreated = false;
  try {
    const gitignore = createManagedGitignore(created.directory);
    gitignoreCreated = gitignore.created;
    const path = join(created.directory, "config.json");
    writeConfigAtomic(path, DEFAULT_CONFIG, { requireExisting: false });
    try {
      maybeFailForTest("before-post-write-verification");
      const verified = readConfigStrictForWrite(workspaceRoot);
      if (verified.status !== "shown") {
        fail(`workflow config initialization did not produce valid V2: ${path}`);
      }
      maybeFailForTest("after-post-write-verification");
      receipt("init", "created", path, "file", verified.config);
    } catch (error) {
      restorePreviousConfig(path, null);
      throw error;
    }
  } catch (error) {
    cleanupCreatedInitPaths({
      directory: created.directory,
      directoryCreated: created.created,
      gitignoreCreated,
    });
    throw error;
  }
}

function requireExistingV2(operation, workspaceRoot) {
  const strict = readConfigStrictForWrite(workspaceRoot);
  if (strict.status === "missing") {
    fail(`workflow config is missing: ${strict.path}; run init first`);
  }
  validateOptionalGitignore(dirname(strict.path));
  if (strict.status === "migration_required") {
    emitMigrationRequired(operation, strict);
    return null;
  }
  return strict;
}

function updateConfig(operation, workspaceRoot, changedField, mutate) {
  const strict = requireExistingV2(operation, workspaceRoot);
  if (strict === null) return;
  const updated = structuredClone(strict.config);
  mutate(updated);
  const parsed = parseV2Config(updated);
  const previous = snapshotConfigForRollback(strict.path);
  writeConfigAtomic(strict.path, parsed, { requireExisting: true });
  let verified;
  try {
    maybeFailForTest("before-post-write-verification");
    verified = readConfigStrictForWrite(workspaceRoot);
    if (verified.status !== "shown") {
      fail(`workflow config update did not produce valid V2: ${strict.path}`);
    }
    maybeFailForTest("after-post-write-verification");
  } catch (error) {
    restorePreviousConfig(strict.path, previous);
    throw error;
  }
  receipt(
    operation,
    "updated",
    strict.path,
    "file",
    verified.config,
    [changedField],
  );
}

function usage() {
  return "usage: workflow-config.mjs <show-strict|validate-strict|init|migrate|set-parallel|set-execution-class> <workspace> [args]";
}

function main() {
  const [command, workspaceRoot, ...args] = process.argv.slice(2);
  if (command === undefined || workspaceRoot === undefined) fail(usage());

  if (command === "show-strict" || command === "validate-strict") {
    if (args.length !== 0) fail(`${command} takes no extra arguments`);
    const strict = readConfigStrict(workspaceRoot);
    emitStrictReceipt(command, strict);
    if (strict.status === "missing") {
      process.stderr.write(`workflow config is missing: ${strict.path}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (!WRITER_COMMANDS.has(command)) fail(`unknown command: ${command}`);
  if (command === "init") {
    if (args.length !== 0) fail("init takes no extra arguments");
    initializeConfig(workspaceRoot);
    return;
  }
  if (command === "migrate") {
    if (args.length === 0) {
      previewMigration(workspaceRoot);
      return;
    }
    if (args.length === 1 && args[0] === "--apply") {
      refuse("migrate apply requires --apply <sha256-digest>");
    }
    if (args.length !== 2 || args[0] !== "--apply") {
      refuse("migrate takes no arguments or --apply <sha256-digest>");
    }
    applyMigration(workspaceRoot, args[1]);
    return;
  }
  if (command === "set-parallel") {
    if (args.length !== 1) fail("set-parallel requires <1-8>");
    const parallel = parseParallelArgument(args[0]);
    updateConfig(command, workspaceRoot, "/parallel", (config) => {
      config.parallel = parallel;
    });
    return;
  }
  if (args.length !== 2) {
    fail("set-execution-class requires <role> <main|lite>");
  }
  const [role, executionClass] = args;
  if (!EXECUTION_ROLES.includes(role)) {
    fail(`role must be one of: ${EXECUTION_ROLES.join(", ")}`);
  }
  if (!EXECUTION_CLASSES.has(executionClass)) {
    fail("execution class must be one of: main, lite");
  }
  updateConfig(
    command,
    workspaceRoot,
    `/execution_classes/${role}`,
    (config) => {
      config.execution_classes[role] = executionClass;
    },
  );
}

const isDirectExecution = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = error instanceof SafeRefusal ? 2 : 1;
  }
}
