// Generated from tooling/goal-dag/goal-dag.ts. Do not edit directly.
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer,                                           } from "node:http";
import {
  appendFileSync,
  closeSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";









































































































































































































































































































































































































































































































const COMPILED_PLATFORM = "claude_code";
const EXPECTED_PLATFORM = (
  COMPILED_PLATFORM.startsWith("__")
    ? process.env.GOAL_DAG_EXECUTION_PLATFORM
    : COMPILED_PLATFORM
)                     ;
if (
  EXPECTED_PLATFORM !== "codex" && EXPECTED_PLATFORM !== "claude_code" &&
  EXPECTED_PLATFORM !== "kimi"
) {
  fail("GOAL_DAG_EXECUTION_PLATFORM must equal codex, claude_code or kimi for an unbuilt runtime");
}
const DIFF_SCOPE_GATE_ID = "diff-scope-audit";
const SOURCE_COVERAGE_GATE_ID = "source-coverage-audit";
const COMMIT_READINESS_GATE_ID = "commit-readiness";
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
const ROLES = new Set          (["work", "review", "verify"]);
const RUNTIME_ACTOR_IDS = new Set                ([
  "source-audit",
  "diff-audit",
  "commit-readiness",
]);

function taskSubjectId(task                )         {
  if (task.role === "review") return `review-${task.id}`;
  return task.owner_id ?? task.runtime_actor_id ?? fail(`task ${task.id} has no execution subject`);
}

function isModuleTask(task                )          {
  return task.owner_id !== null;
}

function executionSubjects(plan      )                     {
  return [
    ...plan.owners,
    ...plan.runtime_actors,
    ...plan.tasks.filter((task) => task.role === "review").map((task) => ({
      id: taskSubjectId(task),
      role: "review"         ,
      responsibility: `独立审查 ${task.id}`,
      worker_context: "只执行绑定的 Implementation Review",
    })),
  ];
}

function subjectForTask(plan      , task                )                   {
  if (task.role === "review") {
    return {
      id: taskSubjectId(task),
      role: "review",
      responsibility: `独立审查 ${task.id}`,
      worker_context: "只执行绑定的 Implementation Review",
    };
  }
  const id = taskSubjectId(task);
  const subject = executionSubjects(plan).find((candidate) => candidate.id === id);
  if (subject === undefined) fail(`task ${task.id} references unknown execution subject: ${id}`);
  return subject;
}

function subjectStateForTask(state          , task                )             {
  const id = taskSubjectId(task);
  const subjectState = task.role === "review"
    ? state.reviewers[id]
    : task.owner_id === null
      ? state.runtime_actors[id]
      : state.owners[id];
  if (subjectState === undefined) fail(`runtime state is missing execution subject: ${id}`);
  return subjectState;
}

function subjectScope(subject                  )           {
  return "writable_paths" in subject ? subject.writable_paths : [];
}

function ownerAllowsPath(owner                 , path        )          {
  return owner.writable_paths.some((pattern) => pathMatchesPattern(path, pattern)) &&
    !owner.excluded_paths.some((pattern) => pathMatchesPattern(path, pattern));
}

function subjectReusePolicy(subject                  )                                 {
  return "reuse_policy" in subject ? subject.reuse_policy : "ephemeral";
}

function isOwnerDefinition(subject                  )                             {
  return "writable_paths" in subject;
}
const TERMINAL_STATUSES = new Set                      ([
  "completed",
  "blocked",
  "failed",
  "needs_repair",
]);
const REASONING_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
const MAX_PARALLEL_THREADS = 8;
const THREAD_PROFILE_ROLES                      = [
  "planner",
  "owner",
  "review",
  "supervisor",
];
const DEFAULT_THREAD_WORKFLOW_CONFIG                       = {
  parallel: 8,
  profiles: {
    planner: { model: "gpt-5.6-sol", reasoning_effort: "high" },
    owner: { model: "gpt-5.6-sol", reasoning_effort: "high" },
    review: { model: "gpt-5.6-sol", reasoning_effort: "high" },
    supervisor: { model: "gpt-5.6-luna", reasoning_effort: "medium" },
  },
};
const ROLE_LABELS                           = {
  work: "实施",
  review: "审查",
  verify: "验证",
};

function fail(message        )        {
  throw new Error(message);
}

function isRecord(value         )                                   {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value         , label        )                          {
  if (!isRecord(value)) fail(`${label} must be an object`);
  return value;
}

function requireString(value         , label        )         {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function requireChineseText(value         , label        )         {
  const text = requireString(value, label).trim();
  if (!/[\u3400-\u9fff]/u.test(text)) {
    fail(`${label} must contain a Chinese character`);
  }
  return text;
}

function compactUserSummary(value        )         {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const characters = [...normalized];
  return characters.length <= 100
    ? normalized
    : `${characters.slice(0, 99).join("")}…`;
}

function requireNullableString(value         , label        )                {
  if (value === null) return null;
  return requireString(value, label);
}

function requirePositiveInteger(value         , label        )         {
  if (!Number.isInteger(value) || (value          ) < 1) {
    fail(`${label} must be a positive integer`);
  }
  return value          ;
}

function requireParallelCount(value         , label        )         {
  const result = requirePositiveInteger(value, label);
  if (result > MAX_PARALLEL_THREADS) {
    fail(`${label} must not exceed ${MAX_PARALLEL_THREADS}`);
  }
  return result;
}

function requireNonNegativeInteger(value         , label        )         {
  if (!Number.isInteger(value) || (value          ) < 0) {
    fail(`${label} must be a non-negative integer`);
  }
  return value          ;
}

function requireStringArray(
  value         ,
  label        ,
  allowEmpty = true,
)           {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const result = value.map((item, index) =>
    requireString(item, `${label}[${index}]`),
  );
  if (!allowEmpty && result.length === 0) fail(`${label} must not be empty`);
  return result;
}

function requireBoolean(value         , label        )          {
  if (typeof value !== "boolean") fail(`${label} must be a boolean`);
  return value;
}

function ensureUnique(values          , label        )       {
  const seen = new Set        ();
  for (const value of values) {
    if (seen.has(value)) fail(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function requireIdentifier(value         , label        )         {
  const result = requireString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(result)) {
    fail(`${label} is invalid: ${result}`);
  }
  return result;
}

function readJson(path        )          {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot read JSON ${path}: ${message}`);
  }
}

function serializedJson(value         )         {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeTextAtomic(path        , payload        )       {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, payload, {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function writeJson(path        , value         )       {
  writeTextAtomic(path, serializedJson(value));
  refreshProgressDocumentsForMutation([path], true);
}

function threadWorkflowConfigPath(workspaceRoot        )         {
  return join(resolve(workspaceRoot), ".ghost-agent-workflow", "config.json");
}

function ensureWorkflowGitignore(workspaceRoot        )         {
  const root = join(resolve(workspaceRoot), ".ghost-agent-workflow");
  const path = join(root, ".gitignore");
  mkdirSync(root, { recursive: true });
  if (existsSync(path)) return path;
  try {
    writeFileSync(path, WORKFLOW_GITIGNORE, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (!isRecord(error) || error.code !== "EEXIST") throw error;
  }
  return path;
}

function parseThreadWorkflowConfig(value         )                       {
  const source = requireRecord(value, "thread workflow config");
  requireExactKeys(source, ["parallel", "profiles"], "thread workflow config");
  const rawProfiles = requireRecord(source.profiles, "thread workflow config.profiles");
  requireExactKeys(rawProfiles, THREAD_PROFILE_ROLES, "thread workflow config.profiles");
  const profiles = {}                                            ;
  for (const role of THREAD_PROFILE_ROLES) {
    const rawProfile = requireRecord(
      rawProfiles[role],
      `thread workflow config.profiles.${role}`,
    );
    requireAllowedKeys(
      rawProfile,
      ["model", "effort"],
      `thread workflow config.profiles.${role}`,
    );
    const effort = requireString(
      rawProfile.effort,
      `thread workflow config.profiles.${role}.effort`,
    );
    if (!REASONING_EFFORTS.has(effort)) {
      fail(`thread workflow config.profiles.${role}.effort is invalid: ${effort}`);
    }
    profiles[role] = {
      model: requireString(
        rawProfile.model,
        `thread workflow config.profiles.${role}.model`,
      ),
      reasoning_effort: effort,
    };
  }
  return {
    parallel: requireParallelCount(source.parallel, "thread workflow config.parallel"),
    profiles,
  };
}

function loadThreadWorkflowConfig(workspaceRoot        )                       {
  ensureWorkflowGitignore(workspaceRoot);
  const path = threadWorkflowConfigPath(workspaceRoot);
  if (!existsSync(path)) {
    writeTextAtomic(path, serializedJson({
      parallel: DEFAULT_THREAD_WORKFLOW_CONFIG.parallel,
      profiles: Object.fromEntries(THREAD_PROFILE_ROLES.map((role) => [role, {
        model: DEFAULT_THREAD_WORKFLOW_CONFIG.profiles[role].model,
        effort: DEFAULT_THREAD_WORKFLOW_CONFIG.profiles[role].reasoning_effort,
      }])),
    }));
  }
  const value = requireRecord(readJson(path), "thread workflow config");
  const rawProfiles = requireRecord(value.profiles, "thread workflow config.profiles");
  if (!Object.hasOwn(rawProfiles, "supervisor") &&
      Object.keys(rawProfiles).sort().join(",") === "owner,planner,review") {
    rawProfiles.supervisor = {
      model: DEFAULT_THREAD_WORKFLOW_CONFIG.profiles.supervisor.model,
      effort: DEFAULT_THREAD_WORKFLOW_CONFIG.profiles.supervisor.reasoning_effort,
    };
    writeTextAtomic(path, serializedJson(value));
  }
  return parseThreadWorkflowConfig(value);
}

function writeImmutableJson(path        , value         )                         {
  const payload = serializedJson(value);
  if (existsSync(path)) {
    if (digestFile(path) === createHash("sha256").update(payload).digest("hex")) {
      return "existing";
    }
    fail(`immutable result already exists with different content: ${path}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, payload, { encoding: "utf8", flag: "wx" });
  try {
    linkSync(temporaryPath, path);
  } catch (error) {
    if (isRecord(error) && error.code === "EEXIST") {
      if (digestFile(path) === createHash("sha256").update(payload).digest("hex")) {
        return "existing";
      }
      fail(`immutable result already exists with different content: ${path}`);
    }
    throw error;
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
  return "created";
}



function transactionPathFor(anchorPath        )         {
  return `${anchorPath}.transaction.json`;
}

function assertTransactionTarget(anchorPath        , targetPath        )         {
  const root = dirname(resolve(anchorPath));
  const target = resolve(targetPath);
  const relativePath = target.slice(root.length + (root.endsWith("/") ? 0 : 1));
  if (target === root || target.startsWith(`${root}/`) === false || relativePath.startsWith("../")) {
    fail(`transaction target escapes goal directory: ${targetPath}`);
  }
  return target;
}

function parseTransaction(value         , anchorPath        )                     {
  const source = requireRecord(value, "transaction journal");
  if (source.contract !== "GOAL_DAG_TRANSACTION_V1") {
    fail("transaction journal contract must equal GOAL_DAG_TRANSACTION_V1");
  }
  if (!Array.isArray(source.writes) || source.writes.length === 0) {
    fail("transaction journal.writes must be a non-empty array");
  }
  const writes = source.writes.map((value, index) => {
    const item = requireRecord(value, `transaction journal.writes[${index}]`);
    const path = assertTransactionTarget(
      anchorPath,
      requireString(item.path, `transaction journal.writes[${index}].path`),
    );
    const payload = requireString(item.payload, `transaction journal.writes[${index}].payload`);
    const digest = requireString(item.digest, `transaction journal.writes[${index}].digest`);
    if (createHash("sha256").update(payload).digest("hex") !== digest) {
      fail(`transaction journal payload digest mismatch: ${path}`);
    }
    JSON.parse(payload);
    return { path, payload, digest };
  });
  ensureUnique(writes.map((item) => item.path), "transaction target");
  return writes;
}

function recoverTransaction(anchorPath        )          {
  const journalPath = transactionPathFor(anchorPath);
  if (!existsSync(journalPath)) return false;
  const writes = parseTransaction(readJson(journalPath), anchorPath);
  for (const write of writes) {
    if (!existsSync(write.path) || digestFile(write.path) !== write.digest) {
      writeTextAtomic(write.path, write.payload);
    }
  }
  refreshProgressDocumentsForMutation(writes.map((write) => write.path), true);
  unlinkSync(journalPath);
  return true;
}

function writeTransaction(anchorPath        , entries                          )       {
  const writes                     = entries.map(([path, value]) => {
    const target = assertTransactionTarget(anchorPath, path);
    const payload = serializedJson(value);
    return {
      path: target,
      payload,
      digest: createHash("sha256").update(payload).digest("hex"),
    };
  });
  ensureUnique(writes.map((item) => item.path), "transaction target");
  const journalPath = transactionPathFor(anchorPath);
  if (existsSync(journalPath)) fail(`unrecovered transaction exists: ${journalPath}`);
  writeJson(journalPath, {
    contract: "GOAL_DAG_TRANSACTION_V1",
    transaction_id: randomUUID(),
    created_at: new Date().toISOString(),
    writes,
  });
  const failAfterRaw = process.env.GOAL_DAG_TEST_FAIL_AFTER_WRITES;
  const failAfter = failAfterRaw === undefined ? null : requireNonNegativeInteger(
    Number(failAfterRaw),
    "GOAL_DAG_TEST_FAIL_AFTER_WRITES",
  );
  if (failAfter === 0) fail("injected transaction failure after 0 writes");
  for (let index = 0; index < writes.length; index += 1) {
    writeTextAtomic(writes[index].path, writes[index].payload);
    if (failAfter !== null && index + 1 === failAfter) {
      fail(`injected transaction failure after ${failAfter} writes`);
    }
  }
  refreshProgressDocumentsForMutation(writes.map((write) => write.path), true);
  unlinkSync(journalPath);
}

const PROGRESS_MUTATION_FILES = new Set([
  "plan.json",
  "state.json",
  "coverage.json",
  "goal-state.json",
]);

function refreshProgressDocumentsForMutation(paths          , strict = false)       {
  const directories = new Set(
    paths
      .filter((path) => PROGRESS_MUTATION_FILES.has(basename(path)))
      .map((path) => dirname(resolve(path))),
  );
  for (const directory of directories) {
    const planPath = join(directory, "plan.json");
    const statePath = join(directory, "state.json");
    if (!existsSync(planPath) || !existsSync(statePath)) continue;
    try {
      refreshProgressDocument(planPath, statePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (strict) throw error;
      process.stderr.write(`warning: progress document refresh failed: ${message}\n`);
    }
  }
}

function digestFile(path        )         {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function digestJson(value         )         {
  return createHash("sha256").update(serializedJson(value)).digest("hex");
}

function gitOutput(workspaceRoot        , args          , label        )         {
  const result = spawnSync("git", ["-C", workspaceRoot, ...args], {
    encoding: "utf8",
    shell: false,
  });
  if (result.error !== undefined || result.status !== 0) {
    const detail = result.error?.message ?? String(result.stderr).trim();
    fail(`${label} failed: ${detail || `exit ${result.status}`}`);
  }
  return result.stdout;
}

function isRuntimeWorkspacePath(path        )          {
  return path === ".ghost-agent-workflow" || path.startsWith(".ghost-agent-workflow/");
}

function gitStatusMap(workspaceRoot        )                      {
  const output = gitOutput(
    workspaceRoot,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"],
    "git worktree status",
  );
  const result = new Map                ();
  for (const record of output.split("\0")) {
    if (!record) continue;
    if (record.length < 4 || record[2] !== " ") fail("git status returned malformed porcelain");
    const path = normalizePathPattern(record.slice(3));
    if (!isRuntimeWorkspacePath(path)) result.set(path, record.slice(0, 2));
  }
  return result;
}

function gitIndexMap(
  workspaceRoot        ,
)                                                      {
  const output = gitOutput(
    workspaceRoot,
    ["ls-files", "--stage", "-z"],
    "git index listing",
  );
  const result = new Map                                                ();
  for (const record of output.split("\0")) {
    if (!record) continue;
    const separator = record.indexOf("\t");
    if (separator < 0) fail("git index listing returned malformed output");
    const match = /^([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-3])$/u.exec(
      record.slice(0, separator),
    );
    if (match === null) fail("git index listing returned malformed stage metadata");
    const path = normalizePathPattern(record.slice(separator + 1));
    if (isRuntimeWorkspacePath(path)) continue;
    const entries = result.get(path) ?? [];
    entries.push({ mode: match[1], object_id: match[2], stage: Number(match[3]) });
    result.set(path, entries);
  }
  for (const entries of result.values()) {
    entries.sort((left, right) =>
      left.stage - right.stage ||
      compareStableStrings(left.mode, right.mode) ||
      compareStableStrings(left.object_id, right.object_id),
    );
  }
  return result;
}

function snapshotEntry(
  workspaceRoot        ,
  path        ,
  status        ,
  indexEntries                                        ,
)                        {
  const absolutePath = resolve(workspaceRoot, path);
  if (absolutePath !== workspaceRoot && !absolutePath.startsWith(`${workspaceRoot}/`)) {
    fail(`git worktree path escapes workspace: ${path}`);
  }
  let stat                              ;
  try {
    stat = lstatSync(absolutePath);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return { path, status, mode: null, content_digest: null, index_entries: indexEntries };
    }
    throw error;
  }
  let contents        ;
  let mode = stat.mode.toString(8);
  if (stat.isSymbolicLink()) contents = Buffer.from(readlinkSync(absolutePath), "utf8");
  else if (stat.isFile()) contents = readFileSync(absolutePath);
  else if (stat.isDirectory()) {
    const submoduleHead = gitOutput(
      absolutePath,
      ["rev-parse", "--verify", "HEAD"],
      `gitlink HEAD lookup for ${path}`,
    ).trim();
    const submoduleStatus = gitOutput(
      absolutePath,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"],
      `gitlink status for ${path}`,
    );
    contents = Buffer.from(serializedJson({ head_oid: submoduleHead, status: submoduleStatus }));
    mode = "160000";
  }
  else fail(`git worktree entry is not a file or symlink: ${path}`);
  return {
    path,
    status,
    mode,
    content_digest: createHash("sha256").update(contents).digest("hex"),
    index_entries: indexEntries,
  };
}

function captureWorktreeSnapshot(workspaceRootArgument        )                     {
  const workspaceRoot = resolve(workspaceRootArgument);
  const headOid = gitOutput(
    workspaceRoot,
    ["rev-parse", "--verify", "HEAD"],
    "git HEAD lookup",
  ).trim();
  if (!/^[0-9a-f]{40,64}$/u.test(headOid)) fail("git HEAD lookup returned an invalid object id");
  const treeOid = gitOutput(
    workspaceRoot,
    ["rev-parse", "--verify", "HEAD^{tree}"],
    "git tree lookup",
  ).trim();
  if (!/^[0-9a-f]{40,64}$/u.test(treeOid)) fail("git tree lookup returned an invalid object id");
  const status = gitStatusMap(workspaceRoot);
  const index = gitIndexMap(workspaceRoot);
  const uniquePaths = [...status.keys()].sort(compareStableStrings);
  return {
    contract: "WORKSPACE_FENCE_V1",
    workspace_root: workspaceRoot,
    head_oid: headOid,
    tree_oid: treeOid,
    index_digest: createHash("sha256").update(serializedJson(
      [...index.entries()].sort(([left], [right]) => compareStableStrings(left, right)),
    )).digest("hex"),
    entries: uniquePaths.map((path) => snapshotEntry(
      workspaceRoot,
      path,
      status.get(path) ?? "  ",
      index.get(path) ?? [],
    )),
  };
}

function parseWorktreeBaseline(
  value         ,
  expectedWorkspaceRoot        ,
)                     {
  const source = requireRecord(value, "worktree baseline");
  if (source.contract !== "WORKSPACE_FENCE_V1") {
    fail("workspace fence contract must equal WORKSPACE_FENCE_V1");
  }
  const root = canonicalPath(
    expectedWorkspaceRoot,
    requireString(source.workspace_root, "worktree baseline.workspace_root"),
    "worktree baseline.workspace_root",
  );
  const headOid = requireString(source.head_oid, "worktree baseline.head_oid");
  if (!/^[0-9a-f]{40,64}$/u.test(headOid)) fail("worktree baseline.head_oid is invalid");
  const treeOid = requireString(source.tree_oid, "workspace fence.tree_oid");
  if (!/^[0-9a-f]{40,64}$/u.test(treeOid)) fail("workspace fence.tree_oid is invalid");
  const indexDigest = requireString(source.index_digest, "workspace fence.index_digest");
  if (!/^[0-9a-f]{64}$/u.test(indexDigest)) fail("workspace fence.index_digest is invalid");
  if (!Array.isArray(source.entries)) fail("worktree baseline.entries must be an array");
  const entries = source.entries.map((value, index) => {
    const item = requireRecord(value, `worktree baseline.entries[${index}]`);
    const mode = requireNullableString(item.mode, `worktree baseline.entries[${index}].mode`);
    const contentDigest = requireNullableString(
      item.content_digest,
      `worktree baseline.entries[${index}].content_digest`,
    );
    if (contentDigest !== null && !/^[0-9a-f]{64}$/u.test(contentDigest)) {
      fail(`worktree baseline.entries[${index}].content_digest is invalid`);
    }
    const status = item.status;
    if (typeof status !== "string" || status.length !== 2) {
      fail(`worktree baseline.entries[${index}].status must be a two-character porcelain status`);
    }
    if (!Array.isArray(item.index_entries)) {
      fail(`worktree baseline.entries[${index}].index_entries must be an array`);
    }
    const indexEntries = item.index_entries.map((value, entryIndex) => {
      const entry = requireRecord(
        value,
        `worktree baseline.entries[${index}].index_entries[${entryIndex}]`,
      );
      const indexMode = requireString(
        entry.mode,
        `worktree baseline.entries[${index}].index_entries[${entryIndex}].mode`,
      );
      if (!/^[0-7]{6}$/u.test(indexMode)) {
        fail(`worktree baseline.entries[${index}].index_entries[${entryIndex}].mode is invalid`);
      }
      const objectId = requireString(
        entry.object_id,
        `worktree baseline.entries[${index}].index_entries[${entryIndex}].object_id`,
      );
      if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(objectId)) {
        fail(`worktree baseline.entries[${index}].index_entries[${entryIndex}].object_id is invalid`);
      }
      const stage = requireNonNegativeInteger(
        entry.stage,
        `worktree baseline.entries[${index}].index_entries[${entryIndex}].stage`,
      );
      if (stage > 3) {
        fail(`worktree baseline.entries[${index}].index_entries[${entryIndex}].stage is invalid`);
      }
      return { mode: indexMode, object_id: objectId, stage };
    });
    ensureUnique(
      indexEntries.map((entry) => String(entry.stage)),
      `worktree baseline.entries[${index}] index stage`,
    );
    return {
      path: normalizePathPattern(
        requireString(item.path, `worktree baseline.entries[${index}].path`),
      ),
      status,
      mode,
      content_digest: contentDigest,
      index_entries: indexEntries,
    };
  });
  ensureUnique(entries.map((item) => item.path), "worktree baseline path");
  if (entries.some((item) => isRuntimeWorkspacePath(item.path))) {
    fail("worktree baseline must exclude .ghost-agent-workflow");
  }
  return {
    contract: "WORKSPACE_FENCE_V1",
    workspace_root: root,
    head_oid: headOid,
    tree_oid: treeOid,
    index_digest: indexDigest,
    entries,
  };
}

function buildSourceBlocks(goal              )                 {
  const sourceBytes = readFileSync(goal.source.path);
  if (createHash("sha256").update(sourceBytes).digest("hex") !== goal.source.digest) {
    fail("goal source changed while source blocks were being captured");
  }
  const lines = sourceBytes.toString("utf8").split(/\r?\n/u);
  const blocks                = [];
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index];
    if (text.trim() === "") continue;
    const textDigest = createHash("sha256").update(text).digest("hex");
    blocks.push({
      id: `L${index + 1}-${textDigest.slice(0, 12)}`,
      line_start: index + 1,
      line_end: index + 1,
      text_digest: textDigest,
    });
  }
  if (blocks.length === 0) fail("goal source must contain at least one non-empty line");
  return {
    contract: "SOURCE_BLOCKS_V1",
    source_path: goal.source.path,
    source_digest: goal.source.digest,
    source_revision: goal.source.revision,
    blocks,
  };
}

function parseSourceBlocks(value         , goal              )                 {
  const source = requireRecord(value, "source blocks");
  if (source.contract !== "SOURCE_BLOCKS_V1") {
    fail("source blocks contract must equal SOURCE_BLOCKS_V1");
  }
  const sourcePath = canonicalPath(
    goal.source.path,
    requireString(source.source_path, "source blocks.source_path"),
    "source blocks.source_path",
  );
  const sourceDigest = requireString(source.source_digest, "source blocks.source_digest");
  const sourceRevision = requirePositiveInteger(
    source.source_revision,
    "source blocks.source_revision",
  );
  if (sourceDigest !== goal.source.digest) fail("source blocks source_digest mismatch");
  if (sourceRevision !== goal.source.revision) fail("source blocks source_revision mismatch");
  if (!Array.isArray(source.blocks) || source.blocks.length === 0) {
    fail("source blocks.blocks must be a non-empty array");
  }
  const blocks = source.blocks.map((value, index) => {
    const item = requireRecord(value, `source blocks.blocks[${index}]`);
    const block              = {
      id: requireIdentifier(item.id, `source blocks.blocks[${index}].id`),
      line_start: requirePositiveInteger(
        item.line_start,
        `source blocks.blocks[${index}].line_start`,
      ),
      line_end: requirePositiveInteger(item.line_end, `source blocks.blocks[${index}].line_end`),
      text_digest: requireString(item.text_digest, `source blocks.blocks[${index}].text_digest`),
    };
    if (block.line_end < block.line_start) fail("source block line span is invalid");
    if (!/^[0-9a-f]{64}$/u.test(block.text_digest)) fail("source block text_digest is invalid");
    return block;
  });
  ensureUnique(blocks.map((block) => block.id), "source block id");
  return {
    contract: "SOURCE_BLOCKS_V1",
    source_path: sourcePath,
    source_digest: sourceDigest,
    source_revision: sourceRevision,
    blocks,
  };
}

function sleep(milliseconds        )       {
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
    0,
    0,
    milliseconds,
  );
}

function processIsAlive(pid         )          {
  if (!Number.isInteger(pid)) return true;
  try {
    process.kill(pid          , 0);
    return true;
  } catch (error) {
    return !isRecord(error) || error.code !== "ESRCH";
  }
}

function removeStaleLock(lockPath        )          {
  const reaperRoot = `${lockPath}.reaper`;
  const reaperToken = randomUUID();
  const temporaryPath = `${reaperRoot}.${process.pid}.${reaperToken}.tmp`;
  let ownedReaperPath = "";
  try {
    const observed = requireRecord(readJson(lockPath), "state lock");
    if (processIsAlive(observed.pid)) return false;
    if (typeof observed.token !== "string" || !observed.token) return false;
    const lockToken = observed.token;
    const lockTokenDigest = createHash("sha256")
      .update(lockToken)
      .digest("hex")
      .slice(0, 16);
    writeFileSync(
      temporaryPath,
      `${JSON.stringify({ pid: process.pid, token: reaperToken, lock_token: lockToken })}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    for (let generation = 0; generation < 1_024; generation += 1) {
      const reaperPath = generation === 0
        ? (reaperRoot)
        : `${reaperRoot}.${lockTokenDigest}.${generation}`;
      try {
        linkSync(temporaryPath, reaperPath);
        ownedReaperPath = reaperPath;
        break;
      } catch (error) {
        if (!isRecord(error) || error.code !== "EEXIST") throw error;
        const incumbent = requireRecord(readJson(reaperPath), "state lock reaper");
        if (processIsAlive(incumbent.pid)) return false;
        if (generation > 0 && incumbent.lock_token !== lockToken) return false;
      }
    }
    if (!ownedReaperPath) return false;
    const current = requireRecord(readJson(lockPath), "state lock");
    if (current.token !== lockToken || processIsAlive(current.pid)) return false;
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  } finally {
    if (ownedReaperPath) {
      try {
        const reaper = requireRecord(readJson(ownedReaperPath), "state lock reaper");
        if (reaper.token === reaperToken) unlinkSync(ownedReaperPath);
      } catch {
        // Never remove a reaper that can no longer be proven to be ours.
      }
    }
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function withStateLock   (statePath        , operation         )    {
  const lockPath = `${statePath}.lock`;
  const token = randomUUID();
  const temporaryPath = `${lockPath}.${process.pid}.${token}.tmp`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify({ pid: process.pid, created_at: Date.now(), token })}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  const deadline = Date.now() + 5_000;
  let acquired = false;
  try {
    while (!acquired) {
      try {
        linkSync(temporaryPath, lockPath);
        acquired = true;
      } catch (error) {
        if (!isRecord(error) || error.code !== "EEXIST") throw error;
        if (removeStaleLock(lockPath)) continue;
        if (Date.now() >= deadline) fail(`state is busy: ${statePath}`);
        sleep(10);
      }
    }
    recoverTransaction(statePath);
    return operation();
  } finally {
    if (acquired) {
      try {
        const lock = requireRecord(readJson(lockPath), "state lock");
        if (lock.token === token) unlinkSync(lockPath);
      } catch {
        // Never remove a lock that can no longer be proven to be ours.
      }
    }
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function normalizePathPattern(value        )         {
  const normalized = value.replaceAll("\\", "/");
  if (isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)) {
    fail(`path must be repository-relative: ${value}`);
  }
  const segments = normalized.split("/");
  if (segments.includes("..")) fail(`path must not contain ..: ${value}`);
  const cleaned = segments.filter((segment, index) => segment !== "" && !(segment === "." && index === 0));
  if (cleaned.includes(".")) fail(`path must be normalized: ${value}`);
  const result = cleaned.join("/");
  if (!result) fail(`path must be non-empty: ${value}`);
  return result;
}

function regexEscape(value        )         {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globSegmentRegex(segment        )         {
  let expression = "";
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];
    if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else if (character === "[") {
      const end = segment.indexOf("]", index + 1);
      if (end === -1) fail(`invalid glob character class: ${segment}`);
      const contents = segment.slice(index + 1, end);
      if (!contents || contents.includes("/")) fail(`invalid glob character class: ${segment}`);
      expression += `[${contents.startsWith("!") ? `^${contents.slice(1)}` : contents}]`;
      index = end;
    } else if (character === "{") {
      const end = segment.indexOf("}", index + 1);
      if (end === -1) fail(`invalid glob alternation: ${segment}`);
      const alternatives = segment.slice(index + 1, end).split(",");
      if (alternatives.length < 2 || alternatives.some((item) => item === "" || /[{}\/]/.test(item))) {
        fail(`invalid glob alternation: ${segment}`);
      }
      expression += `(?:${alternatives.map(regexEscape).join("|")})`;
      index = end;
    } else {
      expression += regexEscape(character);
    }
  }
  return new RegExp(`^${expression}$`, "u");
}

function globRegex(pattern        )         {
  const segments = normalizePathPattern(pattern).split("/");
  let expression = "^";
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === "**") {
      if (index === segments.length - 1) expression += "(?:[^/]+(?:/|$))*";
      else expression += "(?:[^/]+/)*";
    } else {
      expression += globSegmentRegex(segment).source.slice(1, -1);
      if (index < segments.length - 1) expression += "/";
    }
  }
  expression += "$";
  return new RegExp(expression, "u");
}

function segmentMayOverlap(left        , right        )          {
  const leftGlob = /[?*[{]/.test(left);
  const rightGlob = /[?*[{]/.test(right);
  if (!leftGlob && !rightGlob) return left === right;
  if (!leftGlob) return globSegmentRegex(right).test(left);
  if (!rightGlob) return globSegmentRegex(left).test(right);
  return true;
}

function pathsOverlap(left        , right        )          {
  const a = normalizePathPattern(left).split("/");
  const b = normalizePathPattern(right).split("/");
  const memo = new Map                 ();
  function visit(ai        , bi        )          {
    const key = `${ai}:${bi}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    if (ai === a.length && bi === b.length) return true;
    if (ai === a.length) return b.slice(bi).every((segment) => segment === "**");
    if (bi === b.length) return a.slice(ai).every((segment) => segment === "**");
    memo.set(key, false);
    const result = a[ai] === "**"
      ? visit(ai + 1, bi) || visit(ai, bi + 1)
      : b[bi] === "**"
        ? visit(ai, bi + 1) || visit(ai + 1, bi)
        : segmentMayOverlap(a[ai], b[bi]) && visit(ai + 1, bi + 1);
    memo.set(key, result);
    return result;
  }
  return visit(0, 0);
}

function patternCovers(parent        , child        )          {
  const normalizedParent = normalizePathPattern(parent);
  const normalizedChild = normalizePathPattern(child);
  if (normalizedParent === normalizedChild) return true;
  if (!/[?*[{]/.test(normalizedChild)) return globRegex(normalizedParent).test(normalizedChild);
  const parentSegments = normalizedParent.split("/");
  const childSegments = normalizedChild.split("/");
  for (let index = 0; index < parentSegments.length; index += 1) {
    const parentSegment = parentSegments[index];
    const childSegment = childSegments[index];
    if (parentSegment === "**") return index === parentSegments.length - 1;
    if (childSegment === undefined) return false;
    if (parentSegment === childSegment) continue;
    if (/[?*[{]/.test(childSegment)) return false;
    if (!globSegmentRegex(parentSegment).test(childSegment)) return false;
  }
  return parentSegments.length === childSegments.length;
}

function pathMatchesPattern(path        , pattern        )          {
  return globRegex(pattern).test(normalizePathPattern(path));
}










function ownerRegistryPathFor(workspaceRoot        )         {
  return join(resolve(workspaceRoot), ".ghost-agent-workflow", "owners", "registry.json");
}

function persistentOwnerCapsulePathFor(workspaceRoot        , ownerId        )         {
  return join(resolve(workspaceRoot), ".ghost-agent-workflow", "owners", ownerId, "capsule.json");
}

function persistentOwnerInterfaceDirectoryFor(
  workspaceRoot        ,
  goalId        ,
  taskId        ,
)         {
  return join(
    resolve(workspaceRoot),
    ".ghost-agent-workflow",
    "runtime",
    "goals",
    goalId,
    "handoffs",
    taskId,
  );
}

function ownerLeasePathFor(workspaceRoot        , ownerId        )         {
  return join(
    resolve(workspaceRoot),
    ".ghost-agent-workflow",
    "runtime",
    "owners",
    ownerId,
    "lease.json",
  );
}

function parseOwnerLease(value         , expectedOwnerId         )               {
  const source = requireRecord(value, "owner lease");
  if (source.contract !== "OWNER_LEASE_V1") fail("owner lease contract must equal OWNER_LEASE_V1");
  const ownerId = requireIdentifier(source.owner_id, "owner lease.owner_id");
  if (expectedOwnerId !== undefined && ownerId !== expectedOwnerId) {
    fail(`owner lease owner_id mismatch: expected ${expectedOwnerId}, got ${ownerId}`);
  }
  const status = requireString(source.status, "owner lease.status");
  if (status !== "reserved" && status !== "running") fail("owner lease.status is invalid");
  return {
    contract: "OWNER_LEASE_V1",
    owner_id: ownerId,
    goal_id: requireIdentifier(source.goal_id, "owner lease.goal_id"),
    task_id: requireIdentifier(source.task_id, "owner lease.task_id"),
    state_path: requireString(source.state_path, "owner lease.state_path"),
    reservation_token: requireString(
      source.reservation_token,
      "owner lease.reservation_token",
    ),
    executor_id: requireNullableString(source.executor_id, "owner lease.executor_id"),
    acquired_at: requireString(source.acquired_at, "owner lease.acquired_at"),
    heartbeat_at: requireString(source.heartbeat_at, "owner lease.heartbeat_at"),
    status,
  };
}

function acquireOwnerLease(
  goal              ,
  statePath        ,
  task                ,
  reservationToken        ,
)                                             {
  if (task.owner_id === null) fail(`runtime actor task ${task.id} cannot acquire an owner lease`);
  const leasePath = ownerLeasePathFor(goal.workspace.root, task.owner_id);
  mkdirSync(dirname(leasePath), { recursive: true });
  return withStateLock(leasePath, () => {
    if (existsSync(leasePath)) {
      const existing = parseOwnerLease(readJson(leasePath), task.owner_id          );
      if (
        existing.goal_id === goal.goal_id && existing.task_id === task.id &&
        existing.state_path === statePath && existing.reservation_token === reservationToken
      ) return { acquired: true, lease: existing };
      return { acquired: false, lease: existing };
    }
    const now = new Date().toISOString();
    const lease               = {
      contract: "OWNER_LEASE_V1",
      owner_id: task.owner_id,
      goal_id: goal.goal_id,
      task_id: task.id,
      state_path: statePath,
      reservation_token: reservationToken,
      executor_id: null,
      acquired_at: now,
      heartbeat_at: now,
      status: "reserved",
    };
    writeJson(leasePath, lease);
    return { acquired: true, lease };
  });
}

function updateOwnerLease(
  goal              ,
  task                ,
  reservationToken        ,
  update                                                                  ,
)                      {
  if (task.owner_id === null || task.role === "review") return null;
  const leasePath = ownerLeasePathFor(goal.workspace.root, task.owner_id);
  mkdirSync(dirname(leasePath), { recursive: true });
  return withStateLock(leasePath, () => {
    if (!existsSync(leasePath)) fail(`owner lease is missing for ${task.owner_id}`);
    const lease = parseOwnerLease(readJson(leasePath), task.owner_id          );
    if (lease.reservation_token !== reservationToken) fail("owner lease reservation token mismatch");
    lease.executor_id = update.executor_id === undefined ? lease.executor_id : update.executor_id;
    lease.status = update.status ?? lease.status;
    lease.heartbeat_at = new Date().toISOString();
    writeJson(leasePath, lease);
    return lease;
  });
}

function releaseOwnerLease(
  goal              ,
  task                ,
  reservationToken        ,
)          {
  if (task.owner_id === null || task.role === "review") return false;
  const leasePath = ownerLeasePathFor(goal.workspace.root, task.owner_id);
  mkdirSync(dirname(leasePath), { recursive: true });
  return withStateLock(leasePath, () => {
    if (!existsSync(leasePath)) return false;
    const lease = parseOwnerLease(readJson(leasePath), task.owner_id          );
    if (lease.reservation_token !== reservationToken) fail("owner lease reservation token mismatch");
    unlinkSync(leasePath);
    return true;
  });
}

function approvedOwnerRegistry(goal              )




  {
  const path = ownerRegistryPathFor(goal.workspace.root);
  if (!existsSync(path)) {
    fail(`approved owner registry is missing: ${path}; owner creation requires validated user approval`);
  }
  const source = requireRecord(readJson(path), "owner registry");
  const legacy = source.contract === "OWNER_REGISTRY_V1" && source.matcher === "owner-path-glob-v1";
  if (!legacy && source.contract !== "OWNER_REGISTRY_V2") {
    fail("owner registry contract must equal OWNER_REGISTRY_V2");
  }
  if (!legacy && source.matcher !== "owner-path-expression-v2") {
    fail("owner registry matcher must equal owner-path-expression-v2");
  }
  canonicalPath(
    goal.workspace.root,
    requireString(source.workspace_root, "owner registry.workspace_root"),
    "owner registry.workspace_root",
  );
  if (!Array.isArray(source.owners)) fail("owner registry.owners must be an array");
  const owners = source.owners.map((value, index) => {
    const owner = requireRecord(value, `owner registry.owners[${index}]`);
    if (owner.status !== "active") fail(`owner registry.owners[${index}].status must equal active`);
    const scopePatterns = requireStringArray(
      owner.scope_patterns,
      `owner registry.owners[${index}].scope_patterns`,
      false,
    ).map(normalizePathPattern);
    ensureUnique(scopePatterns, `owner registry scope in owner ${String(owner.id)}`);
    const scopeExcludes = owner.scope_excludes === undefined
      ? []
      : requireStringArray(
        owner.scope_excludes,
        `owner registry.owners[${index}].scope_excludes`,
      ).map(normalizePathPattern);
    ensureUnique(scopeExcludes, `owner registry exclusions in owner ${String(owner.id)}`);
    return {
      id: requireIdentifier(owner.id, `owner registry.owners[${index}].id`),
      generation: requirePositiveInteger(
        owner.generation,
        `owner registry.owners[${index}].generation`,
      ),
      responsibility: requireString(
        owner.responsibility,
        `owner registry.owners[${index}].responsibility`,
      ),
      scope_patterns: scopePatterns,
      scope_excludes: scopeExcludes,
      worker_context: requireString(
        owner.worker_context,
        `owner registry.owners[${index}].worker_context`,
      ),
    };
  });
  ensureUnique(owners.map((owner) => owner.id), "approved owner id");
  for (let leftIndex = 0; leftIndex < owners.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < owners.length; rightIndex += 1) {
      for (const left of owners[leftIndex].scope_patterns) {
        for (const right of owners[rightIndex].scope_patterns) {
          if (pathsOverlap(left, right)) {
            const leftRemovesRight = owners[leftIndex].scope_excludes.some((exclude) =>
              patternCovers(exclude, right),
            );
            const rightRemovesLeft = owners[rightIndex].scope_excludes.some((exclude) =>
              patternCovers(exclude, left),
            );
            if (leftRemovesRight || rightRemovesLeft) continue;
            fail(
              `approved owner scope conflict: ${owners[leftIndex].id}:${left} overlaps ` +
              `${owners[rightIndex].id}:${right}`,
            );
          }
        }
      }
    }
  }
  return {
    ref: path,
    digest: digestFile(path),
    revision: requirePositiveInteger(source.revision, "owner registry.revision"),
    owners,
  };
}

function validatePlanOwnersAgainstRegistry(
  plan      ,
  goal              ,
  ownerValidationTaskIds              ,
)       {
  const ownerIdsInScope = ownerValidationTaskIds === undefined
    ? new Set(plan.tasks.map((task) => task.owner_id).filter((value)                  => value !== null))
    : new Set(plan.tasks
      .filter((task) => ownerValidationTaskIds.has(task.id))
      .map((task) => task.owner_id)
      .filter((value)                  => value !== null));
  const moduleOwners = plan.owners.filter((owner) => ownerIdsInScope.has(owner.id));
  if (moduleOwners.length === 0) return;
  const registry = approvedOwnerRegistry(goal);
  const approvedById = new Map(registry.owners.map((owner) => [owner.id, owner]));
  for (const owner of moduleOwners) {
    const approved = approvedById.get(owner.id);
    if (approved === undefined) {
      fail(
        `plan owner ${owner.id} is not approved; planner cannot create owners and must request user approval`,
      );
    }
    const plannedScope = [...owner.writable_paths].sort(compareStableStrings);
    const approvedScope = [...approved.scope_patterns].sort(compareStableStrings);
    if (serializedJson(plannedScope) !== serializedJson(approvedScope)) {
      fail(`plan owner ${owner.id} scope must exactly match the approved persistent owner scope`);
    }
    if (serializedJson([...owner.excluded_paths].sort(compareStableStrings)) !==
      serializedJson([...approved.scope_excludes].sort(compareStableStrings))) {
      fail(`plan owner ${owner.id} exclusions must exactly match the approved owner registry`);
    }
    if (
      owner.responsibility !== approved.responsibility ||
      owner.worker_context !== approved.worker_context
    ) fail(`plan owner ${owner.id} metadata must exactly match the approved owner registry`);
    const capsulePath = persistentOwnerCapsulePathFor(goal.workspace.root, owner.id);
    if (!existsSync(capsulePath)) fail(`persistent owner capsule is missing: ${capsulePath}`);
  }
}

function parseGoalGate(value         , index        )           {
  const source = requireRecord(value, `verification_gates[${index}]`);
  return {
    id: requireIdentifier(source.id, `verification_gates[${index}].id`),
    stage: requireString(source.stage, `verification_gates[${index}].stage`),
    description: requireString(
      source.description,
      `verification_gates[${index}].description`,
    ),
    required: requireBoolean(source.required, `verification_gates[${index}].required`),
  };
}

function parseGoal(value         , verifySourceDigest = true)               {
  const source = requireRecord(value, "goal contract");
  if (source.contract !== "GOAL_CONTRACT_V1") {
    fail("goal contract must equal GOAL_CONTRACT_V1");
  }
  if (source.execution_platform !== EXPECTED_PLATFORM) {
    fail(`execution_platform must equal ${EXPECTED_PLATFORM}`);
  }
  const workspace = requireRecord(source.workspace, "goal workspace");
  const workspaceRoot = requireString(workspace.root, "goal workspace.root");
  if (!isAbsolute(workspaceRoot)) fail("goal workspace.root must be absolute");
  if (!existsSync(workspaceRoot)) {
    fail(`goal workspace.root does not exist: ${workspaceRoot}`);
  }
  const sourceDocument = requireRecord(source.source, "goal source");
  const sourcePath = requireString(sourceDocument.path, "goal source.path");
  if (!isAbsolute(sourcePath)) fail("goal source.path must be absolute");
  if (verifySourceDigest && !existsSync(sourcePath)) {
    fail(`goal source.path does not exist: ${sourcePath}`);
  }
  const sourceDigest = requireString(sourceDocument.digest, "goal source.digest");
  if (verifySourceDigest && sourceDigest !== digestFile(sourcePath)) {
    fail("goal source digest mismatch");
  }
  const sourceRevision = requirePositiveInteger(
    sourceDocument.revision,
    "goal source.revision",
  );

  const lifecycle = requireRecord(source.lifecycle, "goal lifecycle");
  if (
    lifecycle.controller !== "codex_native" &&
    lifecycle.controller !== "standalone_thread" &&
    lifecycle.controller !== "local_fallback"
  ) {
    fail("goal lifecycle.controller is invalid");
  }
  if (lifecycle.controller === "codex_native" && EXPECTED_PLATFORM !== "codex") {
    fail(`${EXPECTED_PLATFORM} execution platform cannot use codex_native controller`);
  }
  let nativeGoal                                           = null;
  if (lifecycle.controller === "codex_native") {
    const nativeGoalSource = requireRecord(lifecycle.native_goal, "goal lifecycle.native_goal");
    nativeGoal = {
      thread_id: requireString(nativeGoalSource.thread_id, "goal lifecycle.native_goal.thread_id"),
      created_at: requirePositiveInteger(
        nativeGoalSource.created_at,
        "goal lifecycle.native_goal.created_at",
      ),
    };
  } else if (lifecycle.native_goal !== null) {
    fail(`${lifecycle.controller} goal lifecycle.native_goal must be null`);
  }

  const execution = requireRecord(source.execution, "goal execution");
  if (execution.mode !== "thread") {
    fail("goal execution.mode must equal thread");
  }
  if (execution.reuse_policy !== "owner_affinity") {
    fail("goal execution.reuse_policy must equal owner_affinity");
  }
  if (!Array.isArray(source.verification_gates) || source.verification_gates.length === 0) {
    fail("goal verification_gates must be a non-empty array");
  }
  const gates = source.verification_gates.map(parseGoalGate);
  ensureUnique(gates.map((gate) => gate.id), "goal gate id");
  const diffScopeGate = gates.find((gate) => gate.id === DIFF_SCOPE_GATE_ID);
  if (diffScopeGate === undefined || !diffScopeGate.required) {
    fail(`goal requires required verification gate: ${DIFF_SCOPE_GATE_ID}`);
  }
  const sourceCoverageGate = gates.find((gate) => gate.id === SOURCE_COVERAGE_GATE_ID);
  if (sourceCoverageGate === undefined || !sourceCoverageGate.required) {
    fail(`goal requires required verification gate: ${SOURCE_COVERAGE_GATE_ID}`);
  }

  const sideEffects = requireRecord(source.side_effects, "goal side_effects");
  for (const field of ["deploy", "external_write"]         ) {
    if (sideEffects[field] !== "forbidden" && sideEffects[field] !== "explicitly_authorized") {
      fail(`goal side_effects.${field} is invalid`);
    }
  }
  const completion = requireRecord(source.completion, "goal completion");
  for (const field of [
    "all_tasks_completed",
    "plan_coverage_100",
    "required_gates_passed",
    "blocking_findings_zero",
    "diff_in_scope",
  ]         ) {
    if (completion[field] !== true) fail(`goal completion.${field} must equal true`);
  }

  return {
    contract: "GOAL_CONTRACT_V1",
    goal_id: requireIdentifier(source.goal_id, "goal_id"),
    execution_platform: source.execution_platform                     ,
    workspace: { root: resolve(workspaceRoot) },
    source: { path: resolve(sourcePath), digest: sourceDigest, revision: sourceRevision },
    objective: requireChineseText(source.objective, "goal objective"),
    scope: requireStringArray(source.scope, "goal scope", false),
    non_goals: requireStringArray(source.non_goals, "goal non_goals"),
    constraints: requireStringArray(source.constraints, "goal constraints"),
    lifecycle: { controller: lifecycle.controller                  , native_goal: nativeGoal },
    execution: {
      mode: execution.mode                ,
      max_concurrency: requireParallelCount(
        execution.max_concurrency,
        "goal execution.max_concurrency",
      ),
      reuse_policy: "owner_affinity",
    },
    verification_gates: gates,
    side_effects: {
      deploy: sideEffects.deploy                                          ,
      external_write: sideEffects.external_write                                                  ,
    },
    completion: {
      all_tasks_completed: true,
      plan_coverage_100: true,
      required_gates_passed: true,
      blocking_findings_zero: true,
      diff_in_scope: true,
    },
  };
}

function fixedGoalGates()             {
  return [
    {
      id: SOURCE_COVERAGE_GATE_ID,
      stage: "audit",
      description: "计划源覆盖审计通过",
      required: true,
    },
    {
      id: DIFF_SCOPE_GATE_ID,
      stage: "audit",
      description: "最终差异范围审计通过",
      required: true,
    },
    {
      id: COMMIT_READINESS_GATE_ID,
      stage: "delivery",
      description: "提交就绪检查通过",
      required: true,
    },
  ];
}

function goalCreateCommand(targetArgument        , workspaceArgument        )       {
  const targetPath = resolve(targetArgument);
  const workspaceRoot = resolve(workspaceArgument);
  if (!existsSync(workspaceRoot)) fail(`workspace root does not exist: ${workspaceRoot}`);
  const input = readStructuredInput("GOAL_INPUT_V1");
  requireAllowedKeys(input, [
    "contract",
    "id",
    "objective",
    "source",
    "scope",
    "non_goals",
    "constraints",
    "max_concurrency",
    "controller",
    "native_thread_id",
    "gates",
    "allow_deploy",
    "allow_external_write",
  ], "goal input");
  const sourceValue = requireString(input.source, "goal input.source");
  const sourcePath = isAbsolute(sourceValue)
    ? resolve(sourceValue)
    : resolve(workspaceRoot, sourceValue);
  if (!existsSync(sourcePath)) fail(`goal source does not exist: ${sourcePath}`);
  const controller = (input.controller ?? "standalone_thread")                  ;
  if (!new Set                (["codex_native", "standalone_thread", "local_fallback"]).has(controller)) {
    fail(`goal input.controller is invalid: ${String(input.controller)}`);
  }
  if (controller === "codex_native" && EXPECTED_PLATFORM !== "codex") {
    fail(`${EXPECTED_PLATFORM} execution platform cannot use codex_native controller`);
  }
  const nativeThreadId = input.native_thread_id === undefined || input.native_thread_id === null
    ? null
    : requireString(input.native_thread_id, "goal input.native_thread_id");
  if ((controller === "codex_native") !== (nativeThreadId !== null)) {
    fail("goal input.native_thread_id is required only for codex_native");
  }
  const rawGates = input.gates ?? [];
  if (!Array.isArray(rawGates)) fail("goal input.gates must be an array");
  const customGates = rawGates.map((value, index) => {
    const gate = requireRecord(value, `goal input.gates[${index}]`);
    requireAllowedKeys(gate, ["id", "description", "stage"], `goal input.gates[${index}]`);
    return {
      id: requireIdentifier(gate.id, `goal input.gates[${index}].id`),
      stage: gate.stage === undefined
        ? "verification"
        : requireString(gate.stage, `goal input.gates[${index}].stage`),
      description: requireString(gate.description, `goal input.gates[${index}].description`),
      required: true         ,
    };
  });
  const fixedIds = new Set(fixedGoalGates().map((gate) => gate.id));
  if (customGates.some((gate) => fixedIds.has(gate.id))) {
    fail("goal input.gates must not repeat runtime-managed gates");
  }
  for (const field of ["allow_deploy", "allow_external_write"]         ) {
    if (input[field] !== undefined) requireBoolean(input[field], `goal input.${field}`);
  }
  ensureUnique(customGates.map((gate) => gate.id), "goal input gate id");
  const goal               = {
    contract: "GOAL_CONTRACT_V1",
    goal_id: requireIdentifier(input.id, "goal input.id"),
    execution_platform: EXPECTED_PLATFORM,
    workspace: { root: workspaceRoot },
    source: { path: sourcePath, digest: digestFile(sourcePath), revision: 1 },
    objective: requireChineseText(input.objective, "goal input.objective"),
    scope: requireStringArray(input.scope, "goal input.scope", false),
    non_goals: input.non_goals === undefined
      ? []
      : requireStringArray(input.non_goals, "goal input.non_goals"),
    constraints: input.constraints === undefined
      ? []
      : requireStringArray(input.constraints, "goal input.constraints"),
    lifecycle: {
      controller,
      native_goal: nativeThreadId === null
        ? null
        : { thread_id: nativeThreadId, created_at: Date.now() },
    },
    execution: {
      mode: "thread",
      max_concurrency: input.max_concurrency === undefined
        ? MAX_PARALLEL_THREADS
        : requireParallelCount(input.max_concurrency, "goal input.max_concurrency"),
      reuse_policy: "owner_affinity",
    },
    verification_gates: [...customGates, ...fixedGoalGates()],
    side_effects: {
      deploy: input.allow_deploy === true ? "explicitly_authorized" : "forbidden",
      external_write: input.allow_external_write === true
        ? "explicitly_authorized"
        : "forbidden",
    },
    completion: {
      all_tasks_completed: true,
      plan_coverage_100: true,
      required_gates_passed: true,
      blocking_findings_zero: true,
      diff_in_scope: true,
    },
  };
  parseGoal(goal);
  const status = writeImmutableJson(targetPath, goal);
  process.stdout.write(`${JSON.stringify({
    contract: "GOAL_CREATE_RECEIPT_V1",
    status,
    goal_ref: targetPath,
    goal_digest: digestFile(targetPath),
  })}\n`);
}

function parseOwner(value         , index        )                  {
  const source = requireRecord(value, `owners[${index}]`);
  const role = requireString(source.role, `owners[${index}].role`);
  if (!ROLES.has(role            )) fail(`owners[${index}].role is invalid: ${role}`);
  const writablePaths = requireStringArray(
    source.writable_paths,
    `owners[${index}].writable_paths`,
    false,
  ).map(normalizePathPattern);
  ensureUnique(writablePaths, `owner writable path in owners[${index}]`);
  const excludedPaths = requireStringArray(
    source.excluded_paths,
    `owners[${index}].excluded_paths`,
  ).map(normalizePathPattern);
  ensureUnique(excludedPaths, `owner excluded path in owners[${index}]`);
  if (source.reuse_policy !== "owner_affinity") {
    fail(`owners[${index}].reuse_policy must equal owner_affinity`);
  }
  return {
    id: requireIdentifier(source.id, `owners[${index}].id`),
    role: role            ,
    responsibility: requireString(source.responsibility, `owners[${index}].responsibility`),
    writable_paths: writablePaths,
    excluded_paths: excludedPaths,
    worker_context: requireString(source.worker_context, `owners[${index}].worker_context`),
    reuse_policy: "owner_affinity",
  };
}

function parseRuntimeActor(value         , index        )                         {
  const source = requireRecord(value, `runtime_actors[${index}]`);
  requireExactKeys(
    source,
    ["id", "role", "responsibility", "worker_context"],
    `runtime_actors[${index}]`,
  );
  const id = requireIdentifier(source.id, `runtime_actors[${index}].id`)                  ;
  if (!RUNTIME_ACTOR_IDS.has(id)) {
    fail(`runtime_actors[${index}].id is not a fixed runtime actor: ${id}`);
  }
  if (source.role !== "verify") {
    fail(`runtime_actors[${index}].role must equal verify`);
  }
  return {
    id,
    role: "verify",
    responsibility: requireString(
      source.responsibility,
      `runtime_actors[${index}].responsibility`,
    ),
    worker_context: requireString(
      source.worker_context,
      `runtime_actors[${index}].worker_context`,
    ),
  };
}

function parseTaskSubgraph(value         , taskId        , index        )                      {
  if (value === undefined || value === null) return null;
  const source = requireRecord(value, `tasks[${index}].subgraph`);
  if (source.contract !== "TASK_SUBGRAPH_V1") {
    fail(`tasks[${index}].subgraph.contract must equal TASK_SUBGRAPH_V1`);
  }
  const parentTaskId = requireIdentifier(
    source.parent_task_id,
    `tasks[${index}].subgraph.parent_task_id`,
  );
  if (parentTaskId !== taskId) {
    fail(`tasks[${index}].subgraph.parent_task_id must equal ${taskId}`);
  }
  if (source.completion_policy !== "all_required") {
    fail(`tasks[${index}].subgraph.completion_policy must equal all_required`);
  }
  const taskIds = requireStringArray(
    source.task_ids,
    `tasks[${index}].subgraph.task_ids`,
    false,
  ).map((id, childIndex) => requireIdentifier(
    id,
    `tasks[${index}].subgraph.task_ids[${childIndex}]`,
  ));
  const entryTaskIds = requireStringArray(
    source.entry_task_ids,
    `tasks[${index}].subgraph.entry_task_ids`,
    false,
  ).map((id, childIndex) => requireIdentifier(
    id,
    `tasks[${index}].subgraph.entry_task_ids[${childIndex}]`,
  ));
  const exitTaskIds = requireStringArray(
    source.exit_task_ids,
    `tasks[${index}].subgraph.exit_task_ids`,
    false,
  ).map((id, childIndex) => requireIdentifier(
    id,
    `tasks[${index}].subgraph.exit_task_ids[${childIndex}]`,
  ));
  ensureUnique(taskIds, `subgraph child in task ${taskId}`);
  ensureUnique(entryTaskIds, `subgraph entry in task ${taskId}`);
  ensureUnique(exitTaskIds, `subgraph exit in task ${taskId}`);
  return {
    contract: "TASK_SUBGRAPH_V1",
    parent_task_id: parentTaskId,
    task_ids: taskIds,
    entry_task_ids: entryTaskIds,
    exit_task_ids: exitTaskIds,
    completion_policy: "all_required",
    expanded_from_attempt: requirePositiveInteger(
      source.expanded_from_attempt,
      `tasks[${index}].subgraph.expanded_from_attempt`,
    ),
    expansion_reason: requireString(
      source.expansion_reason,
      `tasks[${index}].subgraph.expansion_reason`,
    ),
    expansion_ref: requireString(
      source.expansion_ref,
      `tasks[${index}].subgraph.expansion_ref`,
    ),
    expansion_digest: requireString(
      source.expansion_digest,
      `tasks[${index}].subgraph.expansion_digest`,
    ),
  };
}

function parseTask(value         , index        )                 {
  const source = requireRecord(value, `tasks[${index}]`);
  const id = requireIdentifier(source.id, `tasks[${index}].id`);
  const nodeTypeRaw = source.node_type ?? "leaf";
  if (nodeTypeRaw !== "leaf" && nodeTypeRaw !== "composite") {
    fail(`tasks[${index}].node_type must equal leaf or composite`);
  }
  const parentTaskIdRaw = source.parent_task_id ?? null;
  const parentTaskId = parentTaskIdRaw === null
    ? null
    : requireIdentifier(parentTaskIdRaw, `tasks[${index}].parent_task_id`);
  const subgraph = parseTaskSubgraph(source.subgraph, id, index);
  if ((nodeTypeRaw === "composite") !== (subgraph !== null)) {
    fail(`tasks[${index}] composite node_type and subgraph must be paired`);
  }
  const role = requireString(source.role, `tasks[${index}].role`);
  if (!ROLES.has(role            )) fail(`tasks[${index}].role is invalid: ${role}`);
  const title = requireChineseText(source.title, `tasks[${index}].title`);
  if (title.length > 80) fail(`tasks[${index}].title must be at most 80 characters`);
  const writablePaths = requireStringArray(
    source.writable_paths,
    `tasks[${index}].writable_paths`,
  ).map(normalizePathPattern);
  ensureUnique(writablePaths, `task writable path in tasks[${index}]`);
  if (role === "work" && writablePaths.length === 0) {
    fail(`tasks[${index}] work task must have non-empty writable_paths`);
  }
  if (role !== "work" && writablePaths.length > 0) {
    fail(`tasks[${index}] ${role} task must have empty writable_paths`);
  }
  const coverageEffect = requireString(
    source.coverage_effect,
    `tasks[${index}].coverage_effect`,
  );
  if (
    coverageEffect !== "implementation" && coverageEffect !== "verification" &&
    coverageEffect !== "audit"
  ) fail(`tasks[${index}].coverage_effect is invalid`);
  if (role === "work" && coverageEffect !== "implementation") {
    fail(`tasks[${index}] work task coverage_effect must equal implementation`);
  }
  if (role !== "work" && coverageEffect === "implementation") {
    fail(`tasks[${index}] ${role} task cannot use implementation coverage_effect`);
  }
  const ownerIdRaw = requireNullableString(source.owner_id, `tasks[${index}].owner_id`);
  const runtimeActorIdRaw = requireNullableString(
    source.runtime_actor_id,
    `tasks[${index}].runtime_actor_id`,
  );
  if ((ownerIdRaw === null) === (runtimeActorIdRaw === null)) {
    fail(`tasks[${index}] must set exactly one of owner_id or runtime_actor_id`);
  }
  const runtimeActorId = runtimeActorIdRaw                         ;
  if (runtimeActorId !== null && !RUNTIME_ACTOR_IDS.has(runtimeActorId)) {
    fail(`tasks[${index}].runtime_actor_id is invalid: ${runtimeActorId}`);
  }
  const riskLevel = requireString(source.risk_level, `tasks[${index}].risk_level`);
  if (riskLevel !== "low" && riskLevel !== "medium" && riskLevel !== "high") {
    fail(`tasks[${index}].risk_level is invalid: ${riskLevel}`);
  }
  const reviewPolicy = requireString(source.review_policy, `tasks[${index}].review_policy`);
  if (
    reviewPolicy !== "batch" && reviewPolicy !== "immediate" &&
    reviewPolicy !== "final_only" && reviewPolicy !== "none"
  ) fail(`tasks[${index}].review_policy is invalid: ${reviewPolicy}`);
  const reviewBatchKey = requireNullableString(
    source.review_batch_key,
    `tasks[${index}].review_batch_key`,
  );
  const reviewReasons = requireStringArray(
    source.review_reasons,
    `tasks[${index}].review_reasons`,
  );
  const reviewsTaskIds = requireStringArray(
    source.reviews_task_ids,
    `tasks[${index}].reviews_task_ids`,
  );
  if (reviewPolicy === "none" && reviewBatchKey !== null) {
    fail(`tasks[${index}] review_batch_key must be null when review_policy is none`);
  }
  if (reviewPolicy !== "none" && reviewBatchKey === null) {
    fail(`tasks[${index}] review_batch_key is required when review_policy is ${reviewPolicy}`);
  }
  if (riskLevel === "high" && reviewPolicy !== "immediate") {
    fail(`tasks[${index}] high risk task must use immediate review`);
  }
  if (reviewPolicy === "immediate" && source.review_blocks_dependents !== true) {
    fail(`tasks[${index}] immediate review must block dependents`);
  }
  if (reviewPolicy !== "none" && reviewReasons.length === 0) {
    fail(`tasks[${index}] reviewed task requires review_reasons`);
  }
  if (role === "review" && reviewsTaskIds.length === 0) {
    fail(`tasks[${index}] review task requires reviews_task_ids`);
  }
  if (role !== "review" && reviewsTaskIds.length > 0) {
    fail(`tasks[${index}] only review tasks may set reviews_task_ids`);
  }
  return {
    id,
    logical_id: requireIdentifier(source.logical_id, `tasks[${index}].logical_id`),
    title,
    role: role            ,
    owner_id: ownerIdRaw === null
      ? null
      : requireIdentifier(ownerIdRaw, `tasks[${index}].owner_id`),
    runtime_actor_id: runtimeActorId,
    task: requireString(source.task, `tasks[${index}].task`),
    depends_on: requireStringArray(source.depends_on, `tasks[${index}].depends_on`),
    writable_paths: writablePaths,
    resource_locks: requireStringArray(source.resource_locks, `tasks[${index}].resource_locks`),
    done_when: requireStringArray(source.done_when, `tasks[${index}].done_when`, false),
    verification_ids: requireStringArray(
      source.verification_ids,
      `tasks[${index}].verification_ids`,
      false,
    ),
    satisfies_goal_gates: requireStringArray(
      source.satisfies_goal_gates,
      `tasks[${index}].satisfies_goal_gates`,
    ),
    plan_item_ids: requireStringArray(
      source.plan_item_ids,
      `tasks[${index}].plan_item_ids`,
      false,
    ).map((item, itemIndex) => requireIdentifier(item, `tasks[${index}].plan_item_ids[${itemIndex}]`)),
    coverage_effect: coverageEffect                  ,
    priority: requireNonNegativeInteger(source.priority, `tasks[${index}].priority`),
    estimated_cost: requirePositiveInteger(
      source.estimated_cost,
      `tasks[${index}].estimated_cost`,
    ),
    risk_level: riskLevel             ,
    review_policy: reviewPolicy                ,
    review_batch_key: reviewBatchKey,
    review_blocks_dependents: requireBoolean(
      source.review_blocks_dependents,
      `tasks[${index}].review_blocks_dependents`,
    ),
    review_reasons: reviewReasons,
    reviews_task_ids: reviewsTaskIds.map((taskId, taskIndex) => requireIdentifier(
      taskId,
      `tasks[${index}].reviews_task_ids[${taskIndex}]`,
    )),
    node_type: nodeTypeRaw                ,
    parent_task_id: parentTaskId,
    subgraph,
  };
}

function fixedRuntimeActors()                           {
  return [
    {
      id: "source-audit",
      role: "verify",
      responsibility: "机械审计计划源覆盖",
      worker_context: "仅运行 source-audit 脚本",
    },
    {
      id: "diff-audit",
      role: "verify",
      responsibility: "机械审计最终差异",
      worker_context: "仅运行 diff-audit 脚本",
    },
    {
      id: "commit-readiness",
      role: "verify",
      responsibility: "机械生成提交就绪清单",
      worker_context: "仅运行 commit-readiness 脚本",
    },
  ];
}

function parsePlanInputItem(value         , index        )                   {
  const item = requireRecord(value, `plan input.items[${index}]`);
  requireAllowedKeys(
    item,
    ["id", "description", "source_refs", "effects"],
    `plan input.items[${index}]`,
  );
  const effects = requireStringArray(
    item.effects,
    `plan input.items[${index}].effects`,
    false,
  );
  for (const effect of effects) {
    if (effect !== "implementation" && effect !== "verification") {
      fail(`plan input.items[${index}].effects is invalid: ${effect}`);
    }
  }
  return {
    id: requireIdentifier(item.id, `plan input.items[${index}].id`),
    description: requireString(item.description, `plan input.items[${index}].description`),
    source_refs: requireStringArray(
      item.source_refs,
      `plan input.items[${index}].source_refs`,
      false,
    ).map((ref, refIndex) =>
      requireIdentifier(ref, `plan input.items[${index}].source_refs[${refIndex}]`)
    ),
    required_effects: effects                    ,
  };
}

function expandPlanInputTask(
  value         ,
  index        ,
  defaults                                                               = {},
)                 {
  const input = requireRecord(value, `plan input.tasks[${index}]`);
  requireAllowedKeys(input, [
    "id",
    "logical_id",
    "title",
    "role",
    "owner",
    "actor",
    "work",
    "after",
    "write",
    "locks",
    "done",
    "verify",
    "gates",
    "items",
    "risk",
    "review",
    "review_batch",
    "review_reason",
    "reviews",
    "priority",
    "cost",
    "parent",
  ], `plan input.tasks[${index}]`);
  const reviews = input.reviews === undefined
    ? []
    : requireStringArray(input.reviews, `plan input.tasks[${index}].reviews`);
  const actor = input.actor === undefined || input.actor === null
    ? null
    : requireIdentifier(input.actor, `plan input.tasks[${index}].actor`)                  ;
  if (actor !== null && !RUNTIME_ACTOR_IDS.has(actor)) {
    fail(`plan input.tasks[${index}].actor is invalid: ${actor}`);
  }
  const inferredRole           = reviews.length > 0 ? "review" : actor !== null ? "verify" : "work";
  const role = input.role === undefined
    ? inferredRole
    : requireString(input.role, `plan input.tasks[${index}].role`)            ;
  if (!ROLES.has(role)) fail(`plan input.tasks[${index}].role is invalid: ${role}`);
  const ownerRaw = input.owner === undefined ? (defaults.owner_id ?? null) : input.owner;
  const ownerId = ownerRaw === null
    ? null
    : requireIdentifier(ownerRaw, `plan input.tasks[${index}].owner`);
  if ((ownerId === null) === (actor === null)) {
    fail(`plan input.tasks[${index}] must set exactly one of owner or actor`);
  }
  const writablePaths = input.write === undefined
    ? []
    : requireStringArray(input.write, `plan input.tasks[${index}].write`).map(normalizePathPattern);
  if (role === "work" && writablePaths.length === 0) {
    fail(`plan input.tasks[${index}] work task requires write`);
  }
  if (role !== "work" && writablePaths.length > 0) {
    fail(`plan input.tasks[${index}] ${role} task cannot set write`);
  }
  const verificationIds = requireStringArray(
    input.verify,
    `plan input.tasks[${index}].verify`,
    false,
  );
  const risk = (input.risk ?? (role === "work" ? "medium" : "low"))             ;
  if (!new Set           (["low", "medium", "high"]).has(risk)) {
    fail(`plan input.tasks[${index}].risk is invalid: ${String(input.risk)}`);
  }
  const defaultReview               = role === "work" && risk === "high" ? "immediate" : "none";
  const review = (input.review ?? defaultReview)                ;
  if (!new Set              (["batch", "immediate", "final_only", "none"]).has(review)) {
    fail(`plan input.tasks[${index}].review is invalid: ${String(input.review)}`);
  }
  if (risk === "high" && review !== "immediate") {
    fail(`plan input.tasks[${index}] high risk task requires immediate Review`);
  }
  const parentRaw = input.parent === undefined ? (defaults.parent_task_id ?? null) : input.parent;
  const parentTaskId = parentRaw === null
    ? null
    : requireIdentifier(parentRaw, `plan input.tasks[${index}].parent`);
  const reviewBatchKey = review === "none"
    ? null
    : input.review_batch === undefined
      ? ownerId ?? parentTaskId ?? requireIdentifier(input.id, `plan input.tasks[${index}].id`)
      : requireString(input.review_batch, `plan input.tasks[${index}].review_batch`);
  const reviewReason = input.review_reason === undefined
    ? `${review} Review`
    : requireString(input.review_reason, `plan input.tasks[${index}].review_reason`);
  const coverageEffect                 = role === "work"
    ? "implementation"
    : role === "verify" && actor === null
      ? "verification"
      : "audit";
  const resourceLocks = input.locks === undefined
    ? role === "work" ? writablePaths : verificationIds
    : requireStringArray(input.locks, `plan input.tasks[${index}].locks`);
  const canonical = {
    id: requireIdentifier(input.id, `plan input.tasks[${index}].id`),
    logical_id: input.logical_id === undefined
      ? requireIdentifier(input.id, `plan input.tasks[${index}].id`)
      : requireIdentifier(input.logical_id, `plan input.tasks[${index}].logical_id`),
    title: requireString(input.title, `plan input.tasks[${index}].title`),
    role,
    owner_id: ownerId,
    runtime_actor_id: actor,
    task: requireString(input.work, `plan input.tasks[${index}].work`),
    depends_on: input.after === undefined
      ? []
      : requireStringArray(input.after, `plan input.tasks[${index}].after`),
    writable_paths: writablePaths,
    resource_locks: resourceLocks,
    done_when: requireStringArray(input.done, `plan input.tasks[${index}].done`, false),
    verification_ids: verificationIds,
    satisfies_goal_gates: input.gates === undefined
      ? []
      : requireStringArray(input.gates, `plan input.tasks[${index}].gates`),
    plan_item_ids: requireStringArray(input.items, `plan input.tasks[${index}].items`, false),
    coverage_effect: coverageEffect,
    priority: input.priority === undefined
      ? 0
      : requireNonNegativeInteger(input.priority, `plan input.tasks[${index}].priority`),
    estimated_cost: input.cost === undefined
      ? 1
      : requirePositiveInteger(input.cost, `plan input.tasks[${index}].cost`),
    risk_level: risk,
    review_policy: review,
    review_batch_key: reviewBatchKey,
    review_blocks_dependents: review === "immediate",
    review_reasons: review === "none" ? [] : [reviewReason],
    reviews_task_ids: reviews,
    node_type: "leaf",
    parent_task_id: parentTaskId,
    subgraph: null,
  };
  return parseTask(canonical, index);
}

function addFixedRuntimeTasks(
  semanticTasks                  ,
  itemIds          ,
)                   {
  const fixedActors = new Set(["source-audit", "diff-audit", "commit-readiness"]);
  const existing = semanticTasks.filter((task) =>
    task.runtime_actor_id !== null && fixedActors.has(task.runtime_actor_id)
  );
  if (existing.length === 3) return semanticTasks;
  if (existing.length !== 0) {
    fail("plan input must omit all runtime gate tasks or provide all three legacy gate tasks");
  }
  const usedIds = new Set(semanticTasks.map((task) => task.id));
  for (const id of ["GA-SOURCE", "GA-DIFF", "GA-COMMIT"]) {
    if (usedIds.has(id)) fail(`plan input task id is reserved by runtime: ${id}`);
  }
  const sourceId = "GA-SOURCE";
  const diffId = "GA-DIFF";
  const commitId = "GA-COMMIT";
  const businessTasks = semanticTasks.map((task) =>
    task.role === "work"
      ? { ...task, depends_on: uniqueStrings([...task.depends_on, sourceId]) }
      : task
  );
  const dependedOn = new Set(businessTasks.flatMap((task) => task.depends_on));
  const exitIds = businessTasks
    .filter((task) => !dependedOn.has(task.id))
    .map((task) => task.id)
    .sort(compareStableStrings);
  if (exitIds.length === 0) fail("plan input has no business DAG exit task");
  const runtimeTask = (
    id        ,
    logicalId        ,
    title        ,
    actor                                                    ,
    task        ,
    after          ,
    gate        ,
    done        ,
  )                 => parseTask({
    id,
    logical_id: logicalId,
    title,
    role: "verify",
    owner_id: null,
    runtime_actor_id: actor,
    task,
    depends_on: after,
    writable_paths: [],
    resource_locks: [gate],
    done_when: [done],
    verification_ids: [gate],
    satisfies_goal_gates: [gate],
    plan_item_ids: itemIds,
    coverage_effect: "audit",
    priority: 100,
    estimated_cost: 1,
    risk_level: "low",
    review_policy: "none",
    review_batch_key: null,
    review_blocks_dependents: false,
    review_reasons: [],
    reviews_task_ids: [],
    node_type: "leaf",
    parent_task_id: null,
    subgraph: null,
  }, semanticTasks.length);
  return [
    runtimeTask(
      sourceId,
      "runtime.source-coverage",
      "审计计划源覆盖",
      "source-audit",
      "由运行时审计计划源与覆盖项映射",
      [],
      SOURCE_COVERAGE_GATE_ID,
      "计划源覆盖审计通过",
    ),
    ...businessTasks,
    runtimeTask(
      diffId,
      "runtime.diff-scope",
      "审计最终差异范围",
      "diff-audit",
      "由运行时审计最终工作树差异",
      exitIds,
      DIFF_SCOPE_GATE_ID,
      "最终差异全部在已接受范围内",
    ),
    runtimeTask(
      commitId,
      "runtime.commit-readiness",
      "检查提交就绪状态",
      "commit-readiness",
      "由运行时检查提交就绪状态",
      [diffId],
      COMMIT_READINESS_GATE_ID,
      "提交就绪检查通过",
    ),
  ];
}

function buildPlanDraft(
  goalPath        ,
  planPath        ,
  input                         ,
  revision        ,
)                                                             {
  const goal = parseGoal(readJson(goalPath));
  requireAllowedKeys(
    input,
    ["contract", "items", "tasks", "safety", "safety_reasons"],
    "plan input",
  );
  if (!Array.isArray(input.items) || input.items.length === 0) {
    fail("plan input.items must be a non-empty array");
  }
  if (!Array.isArray(input.tasks) || input.tasks.length === 0) {
    fail("plan input.tasks must be a non-empty array");
  }
  const items = input.items.map(parsePlanInputItem);
  const semanticTasks = input.tasks.map((value, index) => expandPlanInputTask(value, index));
  const prematureChildren = semanticTasks.filter((task) => task.parent_task_id !== null);
  if (prematureChildren.length > 0) {
    fail(
      `initial Plan must contain only top-level tasks; expand children on demand: ${
        prematureChildren.map((task) => task.id).join(", ")
      }`,
    );
  }
  ensureUnique(items.map((item) => item.id), "plan input item id");
  const tasks = addFixedRuntimeTasks(semanticTasks, items.map((item) => item.id));
  ensureUnique(tasks.map((task) => task.id), "plan input task id");
  const registry = approvedOwnerRegistry(goal);
  const owners = registry.owners.map(ownerDefinitionFromApproved);
  const safetyStatus = (input.safety ?? "parallel_safe")                ;
  if (!new Set              (["parallel_safe", "sequential_only", "needs_user_review"]).has(
    safetyStatus,
  )) fail(`plan input.safety is invalid: ${String(input.safety)}`);
  const plan       = {
    contract: "DAG_PLAN_V5",
    planner: "parallel-task-planner",
    plan_format_version: 5,
    revision,
    execution_platform: EXPECTED_PLATFORM,
    goal_contract_path: goalPath,
    goal_digest: digestFile(goalPath),
    goal_id: goal.goal_id,
    plan_source: { ...goal.source },
    coverage_path: join(dirname(planPath), "coverage.json"),
    owners,
    runtime_actors: fixedRuntimeActors(),
    tasks,
    safety: {
      status: safetyStatus,
      reasons: input.safety_reasons === undefined
        ? []
        : requireStringArray(input.safety_reasons, "plan input.safety_reasons"),
    },
  };
  const planDigest = digestJson(plan);
  const coverage               = {
    contract: "PLAN_COVERAGE_V1",
    source_path: goal.source.path,
    source_digest: goal.source.digest,
    source_revision: goal.source.revision,
    plan_path: planPath,
    plan_digest: planDigest,
    plan_revision: plan.revision,
    required_plan_items: items,
  };
  parsePlan(plan, planPath, {
    coverageValue: coverage,
    expectedPlanDigest: planDigest,
    goalValue: goal,
    expectedGoalDigest: digestFile(goalPath),
    sourceBlocksValue: buildSourceBlocks(goal),
  });
  return { plan, coverage, planDigest };
}

function planCreateCommand(goalArgument        , planArgument        )       {
  const goalPath = resolve(goalArgument);
  const planPath = resolve(planArgument);
  if (goalPath !== join(dirname(planPath), "goal.json")) {
    fail(`goal path must equal ${join(dirname(planPath), "goal.json")}`);
  }
  const input = readStructuredInput("PLAN_INPUT_V1");
  const { plan, coverage, planDigest } = buildPlanDraft(goalPath, planPath, input, 1);
  if (existsSync(planPath) || existsSync(plan.coverage_path)) {
    if (
      existsSync(planPath) && existsSync(plan.coverage_path) &&
      digestFile(planPath) === planDigest && digestJson(readJson(plan.coverage_path)) === digestJson(coverage)
    ) {
      process.stdout.write(`${JSON.stringify({
        contract: "PLAN_CREATE_RECEIPT_V1",
        status: "existing",
        plan_ref: planPath,
        plan_digest: planDigest,
        coverage_ref: plan.coverage_path,
      })}\n`);
      return;
    }
    fail("plan or coverage already exists with different content");
  }
  writeTransaction(planPath, [[planPath, plan], [plan.coverage_path, coverage]]);
  process.stdout.write(`${JSON.stringify({
    contract: "PLAN_CREATE_RECEIPT_V1",
    status: "created",
    plan_ref: planPath,
    plan_digest: planDigest,
    coverage_ref: plan.coverage_path,
  })}\n`);
}















function plannerReviewDirectory(planPath        )         {
  return join(dirname(planPath), "planner-reviews");
}

function plannerReviewContextPath(planPath        , revision        )         {
  return join(plannerReviewDirectory(planPath), `context-${revision}.json`);
}

function plannerReviewPath(planPath        , revision        )         {
  return join(plannerReviewDirectory(planPath), `review-${revision}.json`);
}

function plannerReviewMetrics(plan      , configuredParallel        )                          {
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const levels = new Map                ();
  const levelFor = (taskId        )         => {
    const existing = levels.get(taskId);
    if (existing !== undefined) return existing;
    const task = byId.get(taskId) ?? fail(`unknown task in planner metrics: ${taskId}`);
    const level = task.depends_on.length === 0
      ? 0
      : Math.max(...task.depends_on.map((dependency) => levelFor(dependency))) + 1;
    levels.set(taskId, level);
    return level;
  };
  for (const task of plan.tasks) levelFor(task.id);
  const widths = new Map                ();
  for (const level of levels.values()) widths.set(level, (widths.get(level) ?? 0) + 1);
  const scores = criticalScores(plan.tasks);
  return {
    node_count: plan.tasks.length,
    max_ready_width: Math.max(0, ...widths.values()),
    critical_path_cost: Math.max(0, ...scores.values()),
    configured_parallel: configuredParallel,
  };
}

function buildPlannerReviewContext(planPath        , plan      )                          {
  const goal = parseGoal(readJson(plan.goal_contract_path));
  const config = loadThreadWorkflowConfig(goal.workspace.root);
  return {
    contract: "PLANNER_REVIEW_CONTEXT_V1",
    plan_ref: planPath,
    plan_digest: digestFile(planPath),
    revision: plan.revision,
    metrics: plannerReviewMetrics(plan, config.parallel),
    tasks: plan.tasks.map((task) => ({
      id: task.id,
      goal: task.task,
      owner: task.owner_id ?? "runtime-script",
      after: task.depends_on,
    })),
  };
}

function plannerReviewContextCommand(planArgument        , compact = false)       {
  const planPath = resolve(planArgument);
  if (existsSync(statePathFor(planPath))) fail("planner review is only allowed before Plan activation");
  const { plan } = parsePlan(readJson(planPath), planPath);
  if (plan.revision > 2) fail("planner review supports only the initial draft and one revision");
  const context = buildPlannerReviewContext(planPath, plan);
  const contextPath = plannerReviewContextPath(planPath, plan.revision);
  const status = writeImmutableJson(contextPath, context);
  const goal = parseGoal(readJson(plan.goal_contract_path));
  process.stdout.write(`${JSON.stringify({
    contract: "PLANNER_REVIEW_CONTEXT_RECEIPT_V1",
    status,
    thread_title: goalThreadTitles(goal).planner_reviewer,
    context_ref: contextPath,
    context_digest: digestFile(contextPath),
    ...(compact ? {} : { context }),
  })}\n`);
}

function parsePlannerReview(value         , planPath        , plan      )                {
  const source = requireRecord(value, "planner review");
  requireExactKeys(source, [
    "contract",
    "round",
    "plan_ref",
    "plan_digest",
    "context_ref",
    "context_digest",
    "decision",
    "parallelism",
    "too_complex",
    "too_simple",
    "changes",
  ], "planner review");
  if (source.contract !== "PLANNER_REVIEW_V1") {
    fail("planner review.contract must equal PLANNER_REVIEW_V1");
  }
  const review                = {
    contract: "PLANNER_REVIEW_V1",
    round: requirePositiveInteger(source.round, "planner review.round"),
    plan_ref: canonicalPath(planPath, requireString(source.plan_ref, "planner review.plan_ref"), "planner review.plan_ref"),
    plan_digest: requireString(source.plan_digest, "planner review.plan_digest"),
    context_ref: requireString(source.context_ref, "planner review.context_ref"),
    context_digest: requireString(source.context_digest, "planner review.context_digest"),
    decision: source.decision === "pass" ? "pass" : source.decision === "revise" ? "revise" : fail("planner review.decision is invalid"),
    parallelism: source.parallelism === "pass" ? "pass" : source.parallelism === "revise" ? "revise" : fail("planner review.parallelism is invalid"),
    too_complex: requireBoolean(source.too_complex, "planner review.too_complex"),
    too_simple: requireBoolean(source.too_simple, "planner review.too_simple"),
    changes: requireStringArray(source.changes, "planner review.changes"),
  };
  if (review.round !== plan.revision) fail("planner review round must equal plan revision");
  if (review.plan_digest !== digestFile(planPath)) fail("planner review plan digest mismatch");
  const expectedContextPath = plannerReviewContextPath(planPath, plan.revision);
  canonicalPath(expectedContextPath, review.context_ref, "planner review.context_ref");
  if (!existsSync(expectedContextPath) || digestFile(expectedContextPath) !== review.context_digest) {
    fail("planner review context is missing or changed");
  }
  return review;
}

function acceptedPlannerReview(planPath        , plan      )                {
  const reviewPath = plannerReviewPath(planPath, plan.revision);
  if (!existsSync(reviewPath)) fail("Plan requires Planner Reviewer approval before activation");
  const review = parsePlannerReview(readJson(reviewPath), planPath, plan);
  if (review.decision !== "pass") {
    fail(plan.revision >= 2
      ? "Planner Reviewer still requests revision after the single allowed retry; notify Main"
      : "Planner Reviewer requests one Plan revision before activation");
  }
  return review;
}

function plannerReviewSubmitCommand(planArgument        )       {
  const planPath = resolve(planArgument);
  if (existsSync(statePathFor(planPath))) fail("planner review is only allowed before Plan activation");
  const { plan } = parsePlan(readJson(planPath), planPath);
  if (plan.revision > 2) fail("planner review supports only two rounds");
  const contextPath = plannerReviewContextPath(planPath, plan.revision);
  if (!existsSync(contextPath)) fail("run planner-review-context before submitting a review");
  const input = readStructuredInput("-");
  requireExactKeys(
    input,
    ["parallelism", "too_complex", "too_simple", "changes"],
    "planner review input",
  );
  if (input.parallelism !== "pass" && input.parallelism !== "revise") {
    fail("planner review input.parallelism must equal pass or revise");
  }
  const changes = requireStringArray(input.changes, "planner review input.changes");
  const tooComplex = requireBoolean(input.too_complex, "planner review input.too_complex");
  const tooSimple = requireBoolean(input.too_simple, "planner review input.too_simple");
  const decision = input.parallelism === "pass" && !tooComplex && !tooSimple && changes.length === 0
    ? "pass"
    : "revise";
  const review                = {
    contract: "PLANNER_REVIEW_V1",
    round: plan.revision,
    plan_ref: planPath,
    plan_digest: digestFile(planPath),
    context_ref: contextPath,
    context_digest: digestFile(contextPath),
    decision,
    parallelism: input.parallelism,
    too_complex: tooComplex,
    too_simple: tooSimple,
    changes,
  };
  parsePlannerReview(review, planPath, plan);
  const reviewPath = plannerReviewPath(planPath, plan.revision);
  const status = writeImmutableJson(reviewPath, review);
  process.stdout.write(`${JSON.stringify({
    contract: "PLANNER_REVIEW_RECEIPT_V1",
    status: decision === "revise" && plan.revision >= 2 ? "needs_main" : status,
    decision,
    round: plan.revision,
    review_ref: reviewPath,
    review_digest: digestFile(reviewPath),
  })}\n`);
}

function planReviseCommand(goalArgument        , planArgument        )       {
  const goalPath = resolve(goalArgument);
  const planPath = resolve(planArgument);
  if (existsSync(statePathFor(planPath))) fail("an active Plan cannot be revised by Planner Reviewer");
  const { plan } = parsePlan(readJson(planPath), planPath);
  canonicalPath(plan.goal_contract_path, goalPath, "plan revise goal path");
  if (plan.revision !== 1) fail("Planner may revise the initial draft only once");
  const reviewPath = plannerReviewPath(planPath, 1);
  if (!existsSync(reviewPath)) fail("Planner revision requires a submitted review");
  const review = parsePlannerReview(readJson(reviewPath), planPath, plan);
  if (review.decision !== "revise") fail("Planner revision requires a revise decision");
  const input = readStructuredInput("PLAN_INPUT_V1");
  const next = buildPlanDraft(goalPath, planPath, input, 2);
  writeTransaction(planPath, [[planPath, next.plan], [next.plan.coverage_path, next.coverage]]);
  process.stdout.write(`${JSON.stringify({
    contract: "PLAN_REVISE_RECEIPT_V1",
    status: "revised",
    revision: 2,
    plan_ref: planPath,
    plan_digest: next.planDigest,
    coverage_ref: next.plan.coverage_path,
  })}\n`);
}
















function liveTaskIdsFromRawState(value         )              {
  const state = requireRecord(value, "state");
  const tasks = requireRecord(state.tasks, "state.tasks");
  return new Set(Object.entries(tasks)
    .filter(([, taskValue]) => requireRecord(taskValue, "state task").status !== "superseded")
    .map(([taskId]) => taskId));
}

function ownerValidationTaskIdsFromRawState(value         )              {
  const state = requireRecord(value, "state");
  const tasks = requireRecord(state.tasks, "state.tasks");
  return new Set(Object.entries(tasks)
    .filter(([, taskValue]) => {
      const status = requireRecord(taskValue, "state task").status;
      return status === "pending" || status === "reserved" || status === "running" ||
        status === "blocked" || status === "failed" || status === "needs_repair";
    })
    .map(([taskId]) => taskId));
}

function parseCoverage(
  value         ,
  coveragePath        ,
  planPath        ,
  planDigest        ,
  plan      ,
  goal              ,
  sourceBlocksValue          ,
  allowStaleSourceRefs = false,
  skipSourceBlockValidation = false,
  liveTaskIds              ,
)               {
  const source = requireRecord(value, "coverage");
  if (source.contract !== "PLAN_COVERAGE_V1") {
    fail("coverage contract must equal PLAN_COVERAGE_V1");
  }
  const sourcePath = canonicalPath(goal.source.path, requireString(source.source_path, "coverage.source_path"), "coverage source_path");
  const boundPlanPath = canonicalPath(planPath, requireString(source.plan_path, "coverage.plan_path"), "coverage plan_path");
  const rawItems = source.required_plan_items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    fail("coverage.required_plan_items must be a non-empty array");
  }
  const items = rawItems.map((value, index) => {
    const item = requireRecord(value, `coverage.required_plan_items[${index}]`);
    const sourceRefs = requireStringArray(
      item.source_refs,
      `coverage.required_plan_items[${index}].source_refs`,
      false,
    ).map((ref, refIndex) =>
      requireIdentifier(ref, `coverage.required_plan_items[${index}].source_refs[${refIndex}]`),
    );
    const requiredEffects = requireStringArray(
      item.required_effects,
      `coverage.required_plan_items[${index}].required_effects`,
      false,
    );
    for (const effect of requiredEffects) {
      if (effect !== "implementation" && effect !== "verification") {
        fail(`coverage.required_plan_items[${index}].required_effects is invalid: ${effect}`);
      }
    }
    ensureUnique(sourceRefs, `coverage item ${String(item.id)} source ref`);
    ensureUnique(requiredEffects, `coverage item ${String(item.id)} required effect`);
    return {
      id: requireIdentifier(item.id, `coverage.required_plan_items[${index}].id`),
      description: requireString(item.description, `coverage.required_plan_items[${index}].description`),
      source_refs: sourceRefs,
      required_effects: requiredEffects                    ,
    };
  });
  ensureUnique(items.map((item) => item.id), "coverage plan item id");
  if (!skipSourceBlockValidation) {
    const sourceBlocks = parseSourceBlocks(
      sourceBlocksValue ?? (
        existsSync(join(dirname(planPath), "source-blocks.json"))
          ? readJson(join(dirname(planPath), "source-blocks.json"))
          : buildSourceBlocks(goal)
      ),
      goal,
    );
    const sourceBlockIds = new Set(sourceBlocks.blocks.map((block) => block.id));
    for (const item of items) {
      for (const sourceRef of item.source_refs) {
        if (!allowStaleSourceRefs && !sourceBlockIds.has(sourceRef)) {
          fail(`coverage item ${item.id} references unknown source block: ${sourceRef}`);
        }
      }
    }
  }
  const coverage               = {
    contract: "PLAN_COVERAGE_V1",
    source_path: sourcePath,
    source_digest: requireString(source.source_digest, "coverage.source_digest"),
    source_revision: requirePositiveInteger(source.source_revision, "coverage.source_revision"),
    plan_path: boundPlanPath,
    plan_digest: requireString(source.plan_digest, "coverage.plan_digest"),
    plan_revision: requirePositiveInteger(source.plan_revision, "coverage.plan_revision"),
    required_plan_items: items,
  };
  if (resolve(coveragePath) !== join(dirname(planPath), "coverage.json")) {
    fail(`coverage path must equal ${join(dirname(planPath), "coverage.json")}`);
  }
  if (coverage.source_digest !== goal.source.digest) fail("coverage source_digest mismatch");
  if (coverage.source_revision !== goal.source.revision) fail("coverage source_revision mismatch");
  if (coverage.plan_digest !== planDigest) fail("coverage plan_digest mismatch");
  if (coverage.plan_revision !== plan.revision) fail("coverage plan_revision mismatch");
  const itemIds = new Set(items.map((item) => item.id));
  for (const task of plan.tasks) {
    ensureUnique(task.plan_item_ids, `plan item id in task ${task.id}`);
    if (liveTaskIds !== undefined && !liveTaskIds.has(task.id)) continue;
    for (const itemId of task.plan_item_ids) {
      if (!itemIds.has(itemId)) fail(`task ${task.id} references unknown plan item: ${itemId}`);
    }
  }
  return coverage;
}

function parsePlan(
  value         ,
  planPath        ,
  options                   = {},
)                                                             {
  const source = requireRecord(value, "plan");
  if (source.contract !== "DAG_PLAN_V5") fail("plan contract must equal DAG_PLAN_V5");
  if (source.planner !== "parallel-task-planner") {
    fail("planner must equal parallel-task-planner");
  }
  if (source.plan_format_version !== 5) fail("plan_format_version must equal 5");
  if (source.execution_platform !== EXPECTED_PLATFORM) {
    fail(`execution_platform must equal ${EXPECTED_PLATFORM}`);
  }
  const goalPath = requireString(source.goal_contract_path, "goal_contract_path");
  if (!isAbsolute(goalPath)) fail("goal_contract_path must be absolute");
  if (resolve(goalPath) !== join(dirname(planPath), "goal.json")) {
    fail(`goal_contract_path must equal ${join(dirname(planPath), "goal.json")}`);
  }
  const goal = parseGoal(
    options.goalValue ?? readJson(goalPath),
    options.verifySourceDigest ?? true,
  );
  const goalDigest = requireString(source.goal_digest, "goal_digest");
  if (goalDigest !== (options.expectedGoalDigest ?? digestFile(goalPath))) {
    fail("plan goal_digest mismatch");
  }
  const goalId = requireIdentifier(source.goal_id, "goal_id");
  if (goalId !== goal.goal_id) fail("plan goal_id mismatch");
  const planSource = requireRecord(source.plan_source, "plan_source");
  const planSourcePath = canonicalPath(
    goal.source.path,
    requireString(planSource.path, "plan_source.path"),
    "plan_source.path",
  );
  const planSourceDigest = requireString(planSource.digest, "plan_source.digest");
  const planSourceRevision = requirePositiveInteger(planSource.revision, "plan_source.revision");
  if (planSourceDigest !== goal.source.digest) fail("plan_source.digest mismatch");
  if (planSourceRevision !== goal.source.revision) fail("plan_source.revision mismatch");
  const coveragePath = requireString(source.coverage_path, "coverage_path");
  if (!isAbsolute(coveragePath)) fail("coverage_path must be absolute");
  if (resolve(coveragePath) !== join(dirname(planPath), "coverage.json")) {
    fail(`coverage_path must equal ${join(dirname(planPath), "coverage.json")}`);
  }
  if (!Array.isArray(source.owners) || source.owners.length === 0) {
    fail("owners must be a non-empty array");
  }
  if (!Array.isArray(source.runtime_actors) || source.runtime_actors.length === 0) {
    fail("runtime_actors must be a non-empty array");
  }
  if (!Array.isArray(source.tasks) || source.tasks.length === 0) {
    fail("tasks must be a non-empty array");
  }
  const safety = requireRecord(source.safety, "safety");
  if (
    safety.status !== "parallel_safe" &&
    safety.status !== "sequential_only" &&
    safety.status !== "needs_user_review"
  ) {
    fail("safety.status is invalid");
  }
  const plan       = {
    contract: "DAG_PLAN_V5",
    planner: "parallel-task-planner",
    plan_format_version: 5,
    revision: requirePositiveInteger(source.revision, "revision"),
    execution_platform: source.execution_platform                     ,
    goal_contract_path: resolve(goalPath),
    goal_digest: goalDigest,
    goal_id: goalId,
    plan_source: {
      path: planSourcePath,
      digest: planSourceDigest,
      revision: planSourceRevision,
    },
    coverage_path: resolve(coveragePath),
    owners: source.owners.map(parseOwner),
    runtime_actors: source.runtime_actors.map(parseRuntimeActor),
    tasks: source.tasks.map(parseTask),
    safety: {
      status: safety.status                ,
      reasons: requireStringArray(safety.reasons, "safety.reasons"),
    },
  };
  validateGraph(
    plan,
    goal,
    options.allowUncoveredRequiredGates ?? false,
    options.liveTaskIds,
    options.ownerValidationTaskIds,
    options.skipOwnerRegistryValidation ?? false,
  );
  const expectedPlanDigest = options.expectedPlanDigest ?? digestFile(planPath);
  const coverage = parseCoverage(
    options.coverageValue ?? readJson(plan.coverage_path),
    plan.coverage_path,
    planPath,
    expectedPlanDigest,
    plan,
    goal,
    options.sourceBlocksValue,
    options.allowStaleCoverageSourceRefs ?? false,
    options.skipSourceBlockValidation ?? false,
    options.liveTaskIds,
  );
  return { plan, goal, coverage };
}

function buildAncestors(tasks                  )                           {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set        ();
  const complete = new Set        ();
  const ancestors = new Map                     ();
  function visit(taskId        )              {
    if (complete.has(taskId)) return ancestors.get(taskId)               ;
    if (visiting.has(taskId)) fail(`task dependency cycle detected at ${taskId}`);
    visiting.add(taskId);
    const task = byId.get(taskId)                  ;
    const result = new Set        ();
    for (const dependencyId of task.depends_on) {
      result.add(dependencyId);
      for (const ancestorId of visit(dependencyId)) result.add(ancestorId);
    }
    visiting.delete(taskId);
    complete.add(taskId);
    ancestors.set(taskId, result);
    return result;
  }
  for (const task of tasks) visit(task.id);
  return ancestors;
}

function directChildrenFor(taskId        , plan      )                   {
  return plan.tasks.filter((task) => task.parent_task_id === taskId);
}

function descendantTaskIds(taskId        , plan      , visited = new Set        ())              {
  if (visited.has(taskId)) fail(`task containment cycle detected at ${taskId}`);
  visited.add(taskId);
  const result = new Set        ();
  for (const child of directChildrenFor(taskId, plan)) {
    result.add(child.id);
    for (const descendantId of descendantTaskIds(child.id, plan, new Set(visited))) {
      result.add(descendantId);
    }
  }
  return result;
}

function buildEffectiveAncestors(plan      )                           {
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const effectiveDependencies = (task                )           => {
    const result = new Set(task.depends_on);
    let parentId = task.parent_task_id;
    const containmentVisited = new Set        ();
    while (parentId !== null) {
      if (containmentVisited.has(parentId)) fail(`task containment cycle detected at ${parentId}`);
      containmentVisited.add(parentId);
      const parent = byId.get(parentId);
      if (parent === undefined) fail(`task ${task.id} references unknown parent: ${parentId}`);
      for (const dependencyId of parent.depends_on) result.add(dependencyId);
      parentId = parent.parent_task_id;
    }
    for (const dependencyId of [...result]) {
      const dependency = byId.get(dependencyId);
      if (dependency?.node_type !== "composite") continue;
      for (const descendantId of descendantTaskIds(dependencyId, plan)) result.add(descendantId);
    }
    return [...result];
  };
  return buildAncestors(plan.tasks.map((task) => ({
    ...task,
    depends_on: effectiveDependencies(task),
  })));
}

function validateTaskHierarchy(plan      )       {
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  for (const task of plan.tasks) {
    if (task.parent_task_id !== null) {
      const parent = byId.get(task.parent_task_id);
      if (parent === undefined) fail(`task ${task.id} references unknown parent: ${task.parent_task_id}`);
      if (parent.node_type !== "composite") {
        fail(`task ${task.id} parent must be composite: ${parent.id}`);
      }
      if (!task.id.startsWith(`${parent.id}-`)) {
        fail(`subgraph task ${task.id} must use parent prefix ${parent.id}-`);
      }
      for (const dependencyId of task.depends_on) {
        const dependency = byId.get(dependencyId);
        if (dependency?.parent_task_id !== parent.id) {
          fail(`subgraph task ${task.id} dependency escapes parent ${parent.id}: ${dependencyId}`);
        }
      }
    } else {
      for (const dependencyId of task.depends_on) {
        if (byId.get(dependencyId)?.parent_task_id !== null) {
          fail(`top-level task ${task.id} must depend on composite boundary, not child ${dependencyId}`);
        }
      }
    }
    const containmentVisited = new Set([task.id]);
    let parentId = task.parent_task_id;
    while (parentId !== null) {
      if (containmentVisited.has(parentId)) fail(`task containment cycle detected at ${parentId}`);
      containmentVisited.add(parentId);
      parentId = byId.get(parentId)?.parent_task_id ?? null;
    }
    if (task.node_type !== "composite") continue;
    const subgraph = task.subgraph                ;
    const directChildren = directChildrenFor(task.id, plan);
    const actualIds = directChildren.map((child) => child.id).sort(compareStableStrings);
    const declaredIds = [...subgraph.task_ids].sort(compareStableStrings);
    if (JSON.stringify(actualIds) !== JSON.stringify(declaredIds)) {
      fail(`composite task ${task.id} subgraph.task_ids must equal its direct children`);
    }
    const childIds = new Set(actualIds);
    for (const entryId of subgraph.entry_task_ids) {
      if (!childIds.has(entryId)) fail(`composite task ${task.id} has unknown entry: ${entryId}`);
    }
    for (const exitId of subgraph.exit_task_ids) {
      if (!childIds.has(exitId)) fail(`composite task ${task.id} has unknown exit: ${exitId}`);
    }
    const computedEntries = directChildren
      .filter((child) => child.depends_on.length === 0)
      .map((child) => child.id)
      .sort(compareStableStrings);
    const dependedOn = new Set(directChildren.flatMap((child) => child.depends_on));
    const computedExits = directChildren
      .filter((child) => !dependedOn.has(child.id))
      .map((child) => child.id)
      .sort(compareStableStrings);
    if (JSON.stringify(computedEntries) !== JSON.stringify([...subgraph.entry_task_ids].sort(compareStableStrings))) {
      fail(`composite task ${task.id} entry_task_ids do not match its internal DAG`);
    }
    if (JSON.stringify(computedExits) !== JSON.stringify([...subgraph.exit_task_ids].sort(compareStableStrings))) {
      fail(`composite task ${task.id} exit_task_ids do not match its internal DAG`);
    }
    if (task.satisfies_goal_gates.length > 0) {
      fail(`composite task ${task.id} cannot directly satisfy goal gates`);
    }
  }
}

function validateExplicitReviews(
  plan      ,
  ancestors                          ,
  liveTaskIds              ,
)       {
  const live = (task                )          => liveTaskIds === undefined || liveTaskIds.has(task.id);
  const liveTasks = plan.tasks.filter(live);
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const reviews = liveTasks.filter((task) => task.role === "review");
  for (const review of reviews) {
    for (const reviewedId of review.reviews_task_ids) {
      const reviewed = byId.get(reviewedId);
      if (reviewed === undefined) fail(`review task ${review.id} references unknown task: ${reviewedId}`);
      if (!live(reviewed)) continue;
      if (!(ancestors.get(review.id) ?? new Set()).has(reviewedId)) {
        fail(`review task ${review.id} must depend on reviewed task ${reviewedId}`);
      }
    }
  }
  for (const task of liveTasks) {
    if (task.role === "review" || task.review_policy === "none") continue;
    const reviewBoundaryIds = new Set([task.id]);
    let parentId = task.parent_task_id;
    while (parentId !== null) {
      reviewBoundaryIds.add(parentId);
      parentId = byId.get(parentId)?.parent_task_id ?? null;
    }
    const matchingReviews = reviews.filter((review) =>
      review.reviews_task_ids.some((reviewedId) => reviewBoundaryIds.has(reviewedId))
    );
    if (matchingReviews.length === 0) {
      fail(
        `task ${task.id} review_policy ${task.review_policy} requires an explicit review DAG node`,
      );
    }
    if (task.review_policy !== "immediate") continue;
    const reviewIds = new Set(matchingReviews.map((review) => review.id));
    for (const dependent of liveTasks.filter((candidate) => candidate.depends_on.includes(task.id))) {
      if (dependent.role === "review" && reviewIds.has(dependent.id)) continue;
      if (![...(ancestors.get(dependent.id) ?? [])].some((ancestorId) => reviewIds.has(ancestorId))) {
        fail(`task ${dependent.id} bypasses immediate review for ${task.id}`);
      }
    }
  }
}

function tasksConflict(left                , right                )          {
  if (taskSubjectId(left) === taskSubjectId(right)) return true;
  if (left.resource_locks.some((lock) => right.resource_locks.includes(lock))) return true;
  return left.writable_paths.some((leftPath) =>
    right.writable_paths.some((rightPath) => pathsOverlap(leftPath, rightPath)),
  );
}

function validateGraph(
  plan      ,
  goal              ,
  allowUncoveredRequiredGates = false,
  liveTaskIds              ,
  ownerValidationTaskIds              ,
  skipOwnerRegistryValidation = false,
)                           {
  if (!skipOwnerRegistryValidation) {
    validatePlanOwnersAgainstRegistry(plan, goal, ownerValidationTaskIds);
  }
  ensureUnique(plan.owners.map((owner) => owner.id), "owner id");
  ensureUnique(plan.runtime_actors.map((actor) => actor.id), "runtime actor id");
  ensureUnique(executionSubjects(plan).map((subject) => subject.id), "execution subject id");
  const actorIds = new Set(plan.runtime_actors.map((actor) => actor.id));
  for (const actorId of RUNTIME_ACTOR_IDS) {
    if (!actorIds.has(actorId)) fail(`plan is missing fixed runtime actor: ${actorId}`);
  }
  if (actorIds.size !== RUNTIME_ACTOR_IDS.size) fail("plan runtime actor set is invalid");
  ensureUnique(plan.tasks.map((task) => task.id), "task id");
  ensureUnique(plan.tasks.map((task) => task.logical_id), "logical task id");
  validateTaskHierarchy(plan);
  const subjectById = new Map(executionSubjects(plan).map((subject) => [subject.id, subject]));
  const taskIds = new Set(plan.tasks.map((task) => task.id));
  const goalGateIds = new Set(goal.verification_gates.map((gate) => gate.id));
  const sourceRelativeRaw = relative(goal.workspace.root, goal.source.path).replaceAll("\\", "/");
  const sourceRelative = sourceRelativeRaw !== "" && sourceRelativeRaw !== ".." &&
      !sourceRelativeRaw.startsWith("../") && !isAbsolute(sourceRelativeRaw)
    ? normalizePathPattern(sourceRelativeRaw)
    : null;
  for (const task of plan.tasks) {
    const subjectId = taskSubjectId(task);
    const owner = subjectById.get(subjectId);
    if (owner === undefined) fail(`task ${task.id} references unknown execution subject: ${subjectId}`);
    if (task.role === "work" && !isModuleTask(task)) {
      fail(`work task ${task.id} requires a persistent module owner with approved scope`);
    }
    if (task.runtime_actor_id !== null && task.role !== "verify") {
      fail(`runtime actor task ${task.id} must use verify role`);
    }
    ensureUnique(task.depends_on, `dependency in task ${task.id}`);
    ensureUnique(task.resource_locks, `resource lock in task ${task.id}`);
    ensureUnique(task.verification_ids, `verification id in task ${task.id}`);
    ensureUnique(task.satisfies_goal_gates, `goal gate in task ${task.id}`);
    const fixedAuditCount = [
      DIFF_SCOPE_GATE_ID,
      SOURCE_COVERAGE_GATE_ID,
      COMMIT_READINESS_GATE_ID,
    ].filter((gateId) => task.verification_ids.includes(gateId)).length;
    if (fixedAuditCount > 1) fail(`task ${task.id} cannot own multiple fixed audit gates`);
    for (const dependencyId of task.depends_on) {
      if (!taskIds.has(dependencyId)) fail(`task ${task.id} references unknown task: ${dependencyId}`);
      if (dependencyId === task.id) fail(`task dependency cycle detected at ${task.id}`);
    }
    for (const writablePath of task.writable_paths) {
      if (!subjectScope(owner).some((scope) => patternCovers(scope, writablePath))) {
        fail(`task ${task.id} writable_paths exceed owner scope: ${writablePath}`);
      }
      if (isOwnerDefinition(owner) && owner.excluded_paths.some((excluded) =>
        pathsOverlap(excluded, writablePath)
      )) fail(`task ${task.id} writable_paths overlap owner exclusion: ${writablePath}`);
      if (sourceRelative !== null && pathMatchesPattern(sourceRelative, writablePath)) {
        fail(`task ${task.id} writable_paths must exclude goal source input: ${sourceRelative}`);
      }
    }
    for (const gateId of task.satisfies_goal_gates) {
      if (!goalGateIds.has(gateId)) fail(`task ${task.id} references unknown goal gate: ${gateId}`);
      if (gateId === DIFF_SCOPE_GATE_ID && task.role === "work") {
        fail(`${DIFF_SCOPE_GATE_ID} must be satisfied by an independent review or verify task`);
      }
      if (gateId === DIFF_SCOPE_GATE_ID && task.coverage_effect !== "audit") {
        fail(`${DIFF_SCOPE_GATE_ID} task coverage_effect must equal audit`);
      }
      if (gateId === SOURCE_COVERAGE_GATE_ID) {
        if (task.role !== "verify" || task.coverage_effect !== "audit") {
          fail(`${SOURCE_COVERAGE_GATE_ID} must be satisfied by an independent verify audit task`);
        }
      }
      if (gateId === SOURCE_COVERAGE_GATE_ID && task.runtime_actor_id !== "source-audit") {
        fail(`${SOURCE_COVERAGE_GATE_ID} must use runtime actor source-audit`);
      }
      if (gateId === DIFF_SCOPE_GATE_ID && task.runtime_actor_id !== "diff-audit") {
        fail(`${DIFF_SCOPE_GATE_ID} must use runtime actor diff-audit`);
      }
      if (gateId === COMMIT_READINESS_GATE_ID && task.runtime_actor_id !== "commit-readiness") {
        fail(`${COMMIT_READINESS_GATE_ID} must use runtime actor commit-readiness`);
      }
      if (!task.verification_ids.includes(gateId)) {
        fail(`task ${task.id} goal gate must also appear in verification_ids: ${gateId}`);
      }
    }
  }
  const coveredGates = new Set(plan.tasks.flatMap((task) => task.satisfies_goal_gates));
  for (const gate of goal.verification_gates) {
    if (!allowUncoveredRequiredGates && gate.required && !coveredGates.has(gate.id)) {
      fail(`required goal gate is not covered by any task: ${gate.id}`);
    }
  }
  for (const fixedGateId of [
    SOURCE_COVERAGE_GATE_ID,
    DIFF_SCOPE_GATE_ID,
    COMMIT_READINESS_GATE_ID,
  ]) {
    const matching = plan.tasks.filter((task) =>
      (liveTaskIds === undefined || liveTaskIds.has(task.id)) &&
      task.satisfies_goal_gates.includes(fixedGateId),
    );
    if (matching.length !== 1) fail(`exactly one ${fixedGateId} task is required`);
  }
  buildAncestors(plan.tasks);
  const ancestors = buildEffectiveAncestors(plan);
  validateExplicitReviews(plan, ancestors, liveTaskIds);
  const sourceAuditTaskIds = new Set(
    plan.tasks
      .filter((task) =>
        (liveTaskIds === undefined || liveTaskIds.has(task.id)) &&
        task.satisfies_goal_gates.includes(SOURCE_COVERAGE_GATE_ID),
      )
      .map((task) => task.id),
  );
  if (liveTaskIds === undefined) {
    for (const task of plan.tasks.filter((candidate) => candidate.role === "work")) {
      if (![...(ancestors.get(task.id) ?? [])].some((taskId) => sourceAuditTaskIds.has(taskId))) {
        fail(`work task ${task.id} must depend on ${SOURCE_COVERAGE_GATE_ID}`);
      }
    }
  }
  const commitReadinessTask = plan.tasks.find((task) =>
    (liveTaskIds === undefined || liveTaskIds.has(task.id)) &&
    task.satisfies_goal_gates.includes(COMMIT_READINESS_GATE_ID),
  )                  ;
  const readinessAncestors = ancestors.get(commitReadinessTask.id) ?? new Set        ();
  const diffTask = plan.tasks.find((task) =>
    (liveTaskIds === undefined || liveTaskIds.has(task.id)) &&
    task.satisfies_goal_gates.includes(DIFF_SCOPE_GATE_ID),
  )                  ;
  if (!readinessAncestors.has(diffTask.id)) {
    fail(`${COMMIT_READINESS_GATE_ID} must depend on ${DIFF_SCOPE_GATE_ID}`);
  }
  const safetyTasks = (liveTaskIds === undefined
    ? plan.tasks
    : plan.tasks.filter((task) => liveTaskIds.has(task.id)))
    .filter((task) => task.node_type === "leaf");
  const hasRunnableParallelPair = safetyTasks.some((left, leftIndex) =>
    safetyTasks.slice(leftIndex + 1).some((right) =>
      !ancestors.get(left.id)?.has(right.id) &&
      !ancestors.get(right.id)?.has(left.id) &&
      !tasksConflict(left, right),
    ),
  );
  if (plan.safety.status === "parallel_safe" && !hasRunnableParallelPair) {
    fail("safety.status parallel_safe requires at least two runnable parallel tasks");
  }
  if (plan.safety.status === "sequential_only" && hasRunnableParallelPair) {
    fail("safety.status sequential_only contradicts the executable task topology");
  }
  return ancestors;
}

function goalStatePathFor(goalPath        )         {
  return join(dirname(goalPath), "goal-state.json");
}

function goalResultPathFor(goalPath        )         {
  return join(dirname(goalPath), "result.json");
}

function cleanupCompletedGoal(goalPath        )       {
  const goalDirectory = dirname(goalPath);
  if (existsSync(goalPath)) {
    const goal = parseGoal(readJson(goalPath), false);
    const ownerRoot = join(goal.workspace.root, ".ghost-agent-workflow", "owners");
    if (existsSync(ownerRoot)) {
      for (const entry of readdirSync(ownerRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        rmSync(join(ownerRoot, entry.name, "interfaces", goal.goal_id), {
          recursive: true,
          force: true,
        });
      }
    }
  }
  for (const directory of [
    "artifacts",
    "bindings",
    "delivery",
    "evidence",
    "execution-fences",
    "handoffs",
    "owners",
    "planner-reviews",
    "quick",
    "results",
  ]) {
    rmSync(join(goalDirectory, directory), { recursive: true, force: true });
  }
  for (const file of [
    "dashboard.json",
    "source-blocks.json",
    "source.md",
    "threads.json",
    "workspace-fence.json",
  ]) {
    rmSync(join(goalDirectory, file), { force: true });
  }
}

function continuationPayloadFor(goalPath        )                         {
  if (EXPECTED_PLATFORM === "codex") return {};
  if (EXPECTED_PLATFORM === "kimi") {
    return {
      continuation_prompt:
        `/skill:sub-thread-coordination 继续 \`${resolve(goalPath)}\`。`,
    };
  }
  return {
    continuation_prompt:
      `/ghost-agent-workflow:sub-thread-coordination 继续 \`${resolve(goalPath)}\`。`,
  };
}

function statePathFor(planPath        )         {
  return join(dirname(planPath), "state.json");
}

function resultPathFor(
  planPath        ,
  taskId        ,
  attempt        ,
  reservationToken        ,
)         {
  return join(
    dirname(planPath),
    "results",
    taskId,
    `attempt-${attempt}-${reservationToken}.json`,
  );
}

function subgraphRequestPathFor(resultPath        )         {
  return `${resultPath}.subgraph-request.json`;
}

function taskBaselinePathFor(
  planPath        ,
  taskId        ,
  attempt        ,
  reservationToken        ,
)         {
  return join(
    dirname(planPath),
    "execution-fences",
    taskId,
    `attempt-${attempt}-${reservationToken}.json`,
  );
}

function diffScopeArtifactPathFor(
  planPath        ,
  taskId        ,
  attempt        ,
  reservationToken        ,
)         {
  return join(
    dirname(planPath),
    "artifacts",
    DIFF_SCOPE_GATE_ID,
    taskId,
    `attempt-${attempt}-${reservationToken}.json`,
  );
}

function sourceCoverageArtifactPathFor(
  planPath        ,
  taskId        ,
  attempt        ,
  reservationToken        ,
)         {
  return join(
    dirname(planPath),
    "artifacts",
    SOURCE_COVERAGE_GATE_ID,
    taskId,
    `attempt-${attempt}-${reservationToken}.json`,
  );
}

function commitReadinessArtifactPathFor(
  planPath        ,
  taskId        ,
  attempt        ,
  reservationToken        ,
)         {
  return join(
    dirname(planPath),
    "evidence",
    `${taskId}-attempt-${attempt}-${reservationToken}-commit-readiness.json`,
  );
}

function deliveryManifestPathFor(
  planPath        ,
  taskId        ,
  attempt        ,
  reservationToken        ,
)         {
  return join(
    dirname(planPath),
    "delivery",
    `${taskId}-attempt-${attempt}-${reservationToken}.json`,
  );
}

function capsulePathFor(planPath        , ownerId        )         {
  return join(dirname(planPath), "owners", ownerId, "capsule.json");
}

function checkpointPathFor(planPath        , ownerId        , taskId        )         {
  return join(dirname(planPath), "owners", ownerId, "checkpoints", `${taskId}.json`);
}

function taskAttemptCleanupPaths(
  planPath        ,
  task                ,
  taskState           ,
)           {
  const result = [
    ...(taskState.result_path === null ? [] : [taskState.result_path]),
    ...(taskState.task_baseline_ref === null ? [] : [taskState.task_baseline_ref]),
    taskBindingSnapshotPath(dirname(planPath), task, taskState),
    join(dirname(planPath), "artifacts", "verification", task.id),
  ];
  if (task.owner_id !== null) result.push(checkpointPathFor(planPath, task.owner_id, task.id));
  return uniqueStrings(result);
}

function canonicalPath(expected        , actual        , label        )         {
  const normalizedExpected = resolve(expected);
  if (resolve(actual) !== normalizedExpected) fail(`${label} must equal ${normalizedExpected}`);
  return normalizedExpected;
}

function parseGoalState(
  value         ,
  goal              ,
  options                                         = {},
)            {
  const source = requireRecord(value, "goal state");
  if (source.contract !== "GOAL_STATE_V1") fail("goal state contract must equal GOAL_STATE_V1");
  if (source.status !== "active" && source.status !== "completed") {
    fail("goal state.status is invalid");
  }
  const controller = requireString(source.controller, "goal state.controller");
  if (
    controller !== "codex_native" &&
    controller !== "standalone_thread" &&
    controller !== "local_fallback"
  ) {
    fail("goal state.controller is invalid");
  }
  if (controller !== goal.lifecycle.controller) fail("goal state.controller mismatch");
  const stateNativeGoal = source.native_goal === null
    ? null
    : (() => {
      const nativeGoalSource = requireRecord(source.native_goal, "goal state.native_goal");
      return {
        thread_id: requireString(nativeGoalSource.thread_id, "goal state.native_goal.thread_id"),
        created_at: requirePositiveInteger(nativeGoalSource.created_at, "goal state.native_goal.created_at"),
      };
    })();
  if (serializedJson(stateNativeGoal) !== serializedJson(goal.lifecycle.native_goal)) {
    fail("goal state.native_goal mismatch");
  }
  const baselineSource = requireRecord(
    source.worktree_baseline,
    "goal state.worktree_baseline",
  );
  const baselineRef = requireString(
    baselineSource.ref,
    "goal state.worktree_baseline.ref",
  );
  if (!isAbsolute(baselineRef)) fail("goal state.worktree_baseline.ref must be absolute");
  const runtimeRoot = join(goal.workspace.root, ".ghost-agent-workflow");
  if (resolve(baselineRef) !== runtimeRoot && !resolve(baselineRef).startsWith(`${runtimeRoot}/`)) {
    fail("goal state.worktree_baseline.ref must be under .ghost-agent-workflow");
  }
  const baselineDigest = requireString(
    baselineSource.digest,
    "goal state.worktree_baseline.digest",
  );
  if (!/^[0-9a-f]{64}$/u.test(baselineDigest)) {
    fail("goal state.worktree_baseline.digest is invalid");
  }
  const verifyExecutionArtifacts = options.verifyExecutionArtifacts ?? source.status !== "completed";
  if (verifyExecutionArtifacts) {
    if (!existsSync(baselineRef) || digestFile(baselineRef) !== baselineDigest) {
      fail("goal state worktree baseline is missing or has a digest mismatch");
    }
    parseWorktreeBaseline(readJson(baselineRef), goal.workspace.root);
  }
  const sourceBlocksSource = requireRecord(source.source_blocks, "goal state.source_blocks");
  const sourceBlocksRef = requireString(sourceBlocksSource.ref, "goal state.source_blocks.ref");
  if (!isAbsolute(sourceBlocksRef)) fail("goal state.source_blocks.ref must be absolute");
  if (
    resolve(sourceBlocksRef) !== runtimeRoot &&
    !resolve(sourceBlocksRef).startsWith(`${runtimeRoot}/`)
  ) fail("goal state.source_blocks.ref must be under .ghost-agent-workflow");
  const sourceBlocksDigest = requireString(
    sourceBlocksSource.digest,
    "goal state.source_blocks.digest",
  );
  if (!/^[0-9a-f]{64}$/u.test(sourceBlocksDigest)) {
    fail("goal state.source_blocks.digest is invalid");
  }
  if (verifyExecutionArtifacts) {
    if (!existsSync(sourceBlocksRef) || digestFile(sourceBlocksRef) !== sourceBlocksDigest) {
      fail("goal state source blocks are missing or have a digest mismatch");
    }
    parseSourceBlocks(readJson(sourceBlocksRef), goal);
  }
  const nativeSyncSource = requireRecord(source.native_sync, "goal state.native_sync");
  if (
    nativeSyncSource.status !== "not_started" &&
    nativeSyncSource.status !== "not_required" &&
    nativeSyncSource.status !== "pending" &&
    nativeSyncSource.status !== "confirmed"
  ) {
    fail("goal state.native_sync.status is invalid");
  }
  const nativeSync = {
    status: nativeSyncSource.status                    ,
    completion_token: requireNullableString(
      nativeSyncSource.completion_token,
      "goal state.native_sync.completion_token",
    ),
    objective_digest: requireString(
      nativeSyncSource.objective_digest,
      "goal state.native_sync.objective_digest",
    ),
    confirmed_at: requireNullableString(
      nativeSyncSource.confirmed_at,
      "goal state.native_sync.confirmed_at",
    ),
  };
  const expectedObjectiveDigest = createHash("sha256").update(goal.objective).digest("hex");
  if (nativeSync.objective_digest !== expectedObjectiveDigest) {
    fail("goal state.native_sync.objective_digest mismatch");
  }
  if (controller !== "codex_native") {
    if (
      nativeSync.status !== "not_required" || nativeSync.completion_token !== null ||
      nativeSync.confirmed_at !== null
    ) fail(`${controller} goal must use empty native_sync not_required`);
  } else if (source.status === "active") {
    if (
      nativeSync.status !== "not_started" || nativeSync.completion_token !== null ||
      nativeSync.confirmed_at !== null
    ) fail("active codex_native goal must use empty native_sync not_started");
  } else if (nativeSync.status === "pending") {
    if (nativeSync.completion_token === null || nativeSync.confirmed_at !== null) {
      fail("pending native_sync requires completion_token and null confirmed_at");
    }
  } else if (nativeSync.status === "confirmed") {
    if (nativeSync.completion_token === null || nativeSync.confirmed_at === null) {
      fail("confirmed native_sync requires completion_token and confirmed_at");
    }
  } else {
    fail("completed codex_native goal requires pending or confirmed native_sync");
  }
  const completedAt = requireNullableString(source.completed_at, "goal state.completed_at");
  if ((source.status === "active") !== (completedAt === null)) {
    fail("goal state.completed_at must be null only while active");
  }
  const resultRef = source.result_ref === undefined
    ? null
    : requireNullableString(source.result_ref, "goal state.result_ref");
  if (source.status === "active" && resultRef !== null) {
    fail("active goal state cannot contain result_ref");
  }
  if (source.status === "completed" && resultRef !== null) {
    canonicalPath(join(dirname(baselineRef), "result.json"), resultRef, "goal state.result_ref");
    if (!existsSync(resultRef)) fail("completed goal result is missing");
  }
  return {
    contract: "GOAL_STATE_V1",
    goal_digest: requireString(source.goal_digest, "goal state.goal_digest"),
    status: source.status,
    controller: controller                  ,
    native_goal: stateNativeGoal,
    worktree_baseline: { ref: resolve(baselineRef), digest: baselineDigest },
    source_blocks: { ref: resolve(sourceBlocksRef), digest: sourceBlocksDigest },
    active_plan_path: requireNullableString(source.active_plan_path, "goal state.active_plan_path"),
    result_ref: resultRef,
    completed_at: completedAt,
    native_sync: nativeSync,
  };
}

function parseTaskState(
  value         ,
  task                ,
  planPath        ,
  verifyExecutionArtifacts = true,
)            {
  const taskId = task.id;
  const source = requireRecord(value, `state.tasks.${taskId}`);
  const statuses = new Set            ([
    "pending", "reserved", "running", "completed", "blocked", "failed", "needs_repair", "superseded",
  ]);
  if (!statuses.has(source.status              )) {
    fail(`state.tasks.${taskId}.status is invalid`);
  }
  const result            = {
    status: source.status              ,
    attempt: requireNonNegativeInteger(source.attempt, `state.tasks.${taskId}.attempt`),
    reservation_token: requireNullableString(
      source.reservation_token,
      `state.tasks.${taskId}.reservation_token`,
    ),
    owner_generation: source.owner_generation === null
      ? null
      : requirePositiveInteger(source.owner_generation, `state.tasks.${taskId}.owner_generation`),
    executor_id: requireNullableString(source.executor_id, `state.tasks.${taskId}.executor_id`),
    source_revision: requirePositiveInteger(
      source.source_revision,
      `state.tasks.${taskId}.source_revision`,
    ),
    validated_source_revision: requirePositiveInteger(
      source.validated_source_revision,
      `state.tasks.${taskId}.validated_source_revision`,
    ),
    reserved_at: requireNullableString(source.reserved_at, `state.tasks.${taskId}.reserved_at`),
    result_path: requireNullableString(source.result_path, `state.tasks.${taskId}.result_path`),
    result_ref: requireNullableString(source.result_ref, `state.tasks.${taskId}.result_ref`),
    result_digest: requireNullableString(
      source.result_digest,
      `state.tasks.${taskId}.result_digest`,
    ),
    replacement_task_id: requireNullableString(
      source.replacement_task_id,
      `state.tasks.${taskId}.replacement_task_id`,
    ),
    last_reclaimed_token: requireNullableString(
      source.last_reclaimed_token,
      `state.tasks.${taskId}.last_reclaimed_token`,
    ),
    task_baseline_ref: requireNullableString(
      source.task_baseline_ref,
      `state.tasks.${taskId}.task_baseline_ref`,
    ),
    task_baseline_digest: requireNullableString(
      source.task_baseline_digest,
      `state.tasks.${taskId}.task_baseline_digest`,
    ),
    expanded_writable_paths: requireStringArray(
      source.expanded_writable_paths,
      `state.tasks.${taskId}.expanded_writable_paths`,
    ).map(normalizePathPattern),
    accepted_change_seq: source.accepted_change_seq === null
      ? null
      : requireNonNegativeInteger(
        source.accepted_change_seq,
        `state.tasks.${taskId}.accepted_change_seq`,
      ),
  };
  const active = result.status === "reserved" || result.status === "running";
  const workerTerminal = ["completed", "blocked", "failed", "needs_repair"].includes(result.status);
  if (result.status === "pending") {
    if (
      result.reservation_token !== null || result.owner_generation !== null ||
      result.executor_id !== null || result.reserved_at !== null || result.result_path !== null ||
      result.result_ref !== null || result.result_digest !== null ||
      result.replacement_task_id !== null || result.task_baseline_ref !== null ||
      result.task_baseline_digest !== null || result.accepted_change_seq !== null
    ) {
      fail(`state.tasks.${taskId} pending state contains active or result fields`);
    }
  }
  if (active || workerTerminal) {
    if (
      result.attempt < 1 || result.reservation_token === null ||
      result.owner_generation === null || result.reserved_at === null ||
      result.result_path === null
    ) {
      fail(`state.tasks.${taskId} ${result.status} state is missing reservation fields`);
    }
    canonicalPath(
      resultPathFor(planPath, taskId, result.attempt, result.reservation_token),
      result.result_path,
      `state.tasks.${taskId}.result_path`,
    );
  }
  if (result.status === "reserved" && result.executor_id !== null) {
    fail(`state.tasks.${taskId} reserved state must not have executor_id`);
  }
  if ((result.status === "running" || workerTerminal) && result.executor_id === null) {
    fail(`state.tasks.${taskId} ${result.status} state requires executor_id`);
  }
  if (result.status === "running" && (
    result.task_baseline_ref === null || result.task_baseline_digest === null
  )) fail(`state.tasks.${taskId} running state requires task baseline`);
  if ((result.task_baseline_ref === null) !== (result.task_baseline_digest === null)) {
    fail(`state.tasks.${taskId} task baseline ref and digest must be paired`);
  }
  if (result.task_baseline_ref !== null && result.task_baseline_digest !== null) {
    canonicalPath(
      taskBaselinePathFor(planPath, taskId, result.attempt, result.reservation_token          ),
      result.task_baseline_ref,
      `state.tasks.${taskId}.task_baseline_ref`,
    );
    if (verifyExecutionArtifacts && (
      !existsSync(result.task_baseline_ref) ||
      digestFile(result.task_baseline_ref) !== result.task_baseline_digest
    )) {
      fail(`state.tasks.${taskId} task baseline is missing or changed`);
    }
  }
  if (active && (result.result_ref !== null || result.result_digest !== null)) {
    fail(`state.tasks.${taskId} active state must not have accepted result fields`);
  }
  if (workerTerminal) {
    if (result.result_ref === null || result.result_digest === null || result.result_path === null) {
      fail(`state.tasks.${taskId} ${result.status} state requires accepted result fields`);
    }
    canonicalPath(
      `${result.result_path}.accepted.json`,
      result.result_ref,
      `state.tasks.${taskId}.result_ref`,
    );
    if (result.accepted_change_seq === null) {
      fail(`state.tasks.${taskId} ${result.status} requires accepted_change_seq`);
    }
  }
  if (result.status !== "superseded" && result.replacement_task_id !== null) {
    fail(`state.tasks.${taskId} replacement_task_id requires superseded status`);
  }
  if (result.status === "superseded" && result.replacement_task_id === null) {
    fail(`state.tasks.${taskId} superseded state requires replacement_task_id`);
  }
  if (result.result_path !== null) {
    if (result.attempt < 1 || result.reservation_token === null) {
      fail(`state.tasks.${taskId}.result_path requires attempt and reservation_token`);
    }
    canonicalPath(
      resultPathFor(planPath, taskId, result.attempt, result.reservation_token),
      result.result_path,
      `state.tasks.${taskId}.result_path`,
    );
  }
  if (result.result_ref !== null && result.result_path !== null) {
    canonicalPath(
      `${result.result_path}.accepted.json`,
      result.result_ref,
      `state.tasks.${taskId}.result_ref`,
    );
  }
  return result;
}

function parseSubjectState(
  value         ,
  subject                  ,
  planPath        ,
  stateKey                                           ,
)             {
  const label = `state.${stateKey}.${subject.id}`;
  const source = requireRecord(value, label);
  const statuses = new Set                    (["unbound", "idle", "reserved", "running"]);
  if (!statuses.has(source.status                      )) {
    fail(`${label}.status is invalid`);
  }
  const rawCapsuleRef = requireNullableString(source.capsule_ref, `${label}.capsule_ref`);
  const moduleOwner = "writable_paths" in subject;
  if (moduleOwner && rawCapsuleRef === null) fail(`${label}.capsule_ref is required`);
  if (!moduleOwner && rawCapsuleRef !== null) fail(`${label}.capsule_ref must be null`);
  const result             = {
    generation: requirePositiveInteger(source.generation, `${label}.generation`),
    bound_executor_id: requireNullableString(
      source.bound_executor_id,
      `${label}.bound_executor_id`,
    ),
    status: source.status                      ,
    current_task_id: requireNullableString(
      source.current_task_id,
      `${label}.current_task_id`,
    ),
    capsule_ref: rawCapsuleRef === null
      ? null
      : canonicalPath(capsulePathFor(planPath, subject.id), rawCapsuleRef, `${label}.capsule_ref`),
    completed_task_ids: requireStringArray(
      source.completed_task_ids,
      `${label}.completed_task_ids`,
    ),
    result_refs: requireStringArray(source.result_refs, `${label}.result_refs`),
  };
  if (result.status === "unbound" && (result.bound_executor_id !== null || result.current_task_id !== null)) {
    fail(`${label} unbound state is inconsistent`);
  }
  if (result.status === "idle" && (result.bound_executor_id === null || result.current_task_id !== null)) {
    fail(`${label} idle state is inconsistent`);
  }
  if ((result.status === "reserved" || result.status === "running") && result.current_task_id === null) {
    fail(`${label} active state requires current_task_id`);
  }
  if (result.status === "running" && result.bound_executor_id === null) {
    fail(`${label} running state requires bound_executor_id`);
  }
  return result;
}

function parseStaleExecutor(value         , index        )                {
  const source = requireRecord(value, `state.stale_executors[${index}]`);
  if (source.status !== "stop_pending") {
    fail(`state.stale_executors[${index}].status must equal stop_pending`);
  }
  return {
    executor_id: requireString(source.executor_id, `state.stale_executors[${index}].executor_id`),
    owner_id: requireIdentifier(source.owner_id, `state.stale_executors[${index}].owner_id`),
    task_id: requireIdentifier(source.task_id, `state.stale_executors[${index}].task_id`),
    attempt: requirePositiveInteger(source.attempt, `state.stale_executors[${index}].attempt`),
    reservation_token: requireString(
      source.reservation_token,
      `state.stale_executors[${index}].reservation_token`,
    ),
    source_revision: requirePositiveInteger(
      source.source_revision,
      `state.stale_executors[${index}].source_revision`,
    ),
    status: "stop_pending",
    reclaimed_at: requireString(
      source.reclaimed_at,
      `state.stale_executors[${index}].reclaimed_at`,
    ),
  };
}

function parseState(
  value         ,
  plan      ,
  planPath        ,
  options                                         = {},
)           {
  const source = requireRecord(value, "state");
  if (source.contract !== "DAG_RUN_STATE_V5") {
    fail("state contract must equal DAG_RUN_STATE_V5");
  }
  const rawTasks = requireRecord(source.tasks, "state.tasks");
  const rawOwners = requireRecord(source.owners, "state.owners");
  const rawActors = requireRecord(source.runtime_actors, "state.runtime_actors");
  const rawReviewers = requireRecord(source.reviewers, "state.reviewers");
  const tasks = Object.fromEntries(
    plan.tasks.map((task) => [
      task.id,
      parseTaskState(
        rawTasks[task.id],
        task,
        planPath,
        options.verifyExecutionArtifacts ?? true,
      ),
    ]),
  );
  const owners = Object.fromEntries(
    plan.owners.map((owner) => [
      owner.id,
      parseSubjectState(rawOwners[owner.id], owner, planPath, "owners"),
    ]),
  );
  const runtimeActors = Object.fromEntries(
    plan.runtime_actors.map((actor) => [
      actor.id,
      parseSubjectState(rawActors[actor.id], actor, planPath, "runtime_actors"),
    ]),
  );
  const reviewTasks = plan.tasks.filter((task) => task.role === "review");
  const reviewers = Object.fromEntries(reviewTasks.map((task) => {
    const subject = subjectForTask(plan, task);
    return [subject.id, parseSubjectState(rawReviewers[subject.id], subject, planPath, "reviewers")];
  }));
  if (!Array.isArray(source.stale_executors)) fail("state.stale_executors must be an array");
  const staleExecutors = source.stale_executors.map(parseStaleExecutor);
  ensureUnique(
    staleExecutors.map((item) => `${item.executor_id}\u0000${item.reservation_token}`),
    "state stale executor identity",
  );
  if (Object.keys(rawTasks).length !== plan.tasks.length) fail("state task set does not match plan tasks");
  if (Object.keys(rawOwners).length !== plan.owners.length) fail("state owner set does not match plan owners");
  if (Object.keys(rawActors).length !== plan.runtime_actors.length) {
    fail("state runtime actor set does not match plan runtime actors");
  }
  if (Object.keys(rawReviewers).length !== reviewTasks.length) {
    fail("state reviewer set does not match plan review tasks");
  }
  const rawOwnerRegistry = requireRecord(source.owner_registry, "state.owner_registry");
  const result           = {
    contract: "DAG_RUN_STATE_V5",
    plan_digest: requireString(source.plan_digest, "state.plan_digest"),
    goal_digest: requireString(source.goal_digest, "state.goal_digest"),
    goal_refresh_pending: requireBoolean(
      source.goal_refresh_pending,
      "state.goal_refresh_pending",
    ),
    source_revision: requirePositiveInteger(source.source_revision, "state.source_revision"),
    revision: requirePositiveInteger(source.revision, "state.revision"),
    workspace_change_seq: requireNonNegativeInteger(
      source.workspace_change_seq,
      "state.workspace_change_seq",
    ),
    owner_registry: {
      ref: requireString(rawOwnerRegistry.ref, "state.owner_registry.ref"),
      digest: requireString(rawOwnerRegistry.digest, "state.owner_registry.digest"),
      revision: requirePositiveInteger(
        rawOwnerRegistry.revision,
        "state.owner_registry.revision",
      ),
    },
    owner_change: source.owner_change === undefined || source.owner_change === null
      ? null
      : (() => {
        const change = requireRecord(source.owner_change, "state.owner_change");
        assertExactFields(change, ["request_ref", "request_digest"], "state.owner_change");
        const requestRef = requireString(change.request_ref, "state.owner_change.request_ref");
        const requestDigest = requireString(
          change.request_digest,
          "state.owner_change.request_digest",
        );
        if (!isAbsolute(requestRef) || !existsSync(requestRef) || digestFile(requestRef) !== requestDigest) {
          fail("state.owner_change request is missing or changed");
        }
        return { request_ref: requestRef, request_digest: requestDigest };
      })(),
    tasks,
    owners,
    runtime_actors: runtimeActors,
    reviewers,
    review_pending: source.review_pending === undefined
      ? []
      : requireStringArray(source.review_pending, "state.review_pending")
        .map((taskId, index) => requireIdentifier(taskId, `state.review_pending[${index}]`)),
    stale_executors: staleExecutors,
  };
  ensureUnique(result.review_pending, "state pending Review task id");
  const taskById = new Map(plan.tasks.map((task) => [task.id, task]));
  for (const task of plan.tasks) {
    const taskState = result.tasks[task.id];
    if (taskState.source_revision > result.source_revision || taskState.validated_source_revision > result.source_revision) {
      fail(`state.tasks.${task.id} revision exceeds state source_revision`);
    }
    if (
      taskState.accepted_change_seq !== null &&
      taskState.accepted_change_seq > result.workspace_change_seq
    ) fail(`state.tasks.${task.id}.accepted_change_seq exceeds workspace_change_seq`);
  }
  for (const owner of plan.owners) {
    const ownerState = result.owners[owner.id];
    if (ownerState.current_task_id !== null) {
      const currentTask = taskById.get(ownerState.current_task_id);
      if (currentTask === undefined || currentTask.owner_id !== owner.id) {
        fail(`state.owners.${owner.id}.current_task_id is outside owner`);
      }
      const taskStatus = result.tasks[currentTask.id].status;
      if (ownerState.status !== taskStatus) {
        fail(`state owner/task active status mismatch: ${owner.id}/${currentTask.id}`);
      }
    }
    const allowedResultRefs = new Set(
      plan.tasks
        .filter((task) => task.owner_id === owner.id)
        .map((task) => result.tasks[task.id].result_ref)
        .filter((value)                  => value !== null),
    );
    for (const resultRef of ownerState.result_refs) {
      if (!allowedResultRefs.has(resultRef)) fail(`state.owners.${owner.id}.result_refs is outside owner results`);
    }
    for (const completedTaskId of ownerState.completed_task_ids) {
      const completedTask = taskById.get(completedTaskId);
      if (
        completedTask === undefined || completedTask.owner_id !== owner.id ||
        result.tasks[completedTaskId].status !== "completed"
      ) {
        fail(`state.owners.${owner.id}.completed_task_ids is inconsistent`);
      }
    }
  }
  for (const actor of plan.runtime_actors) {
    const actorState = result.runtime_actors[actor.id];
    if (actorState.current_task_id !== null) {
      const currentTask = taskById.get(actorState.current_task_id);
      if (currentTask === undefined || currentTask.runtime_actor_id !== actor.id) {
        fail(`state.runtime_actors.${actor.id}.current_task_id is outside actor`);
      }
      if (actorState.status !== result.tasks[currentTask.id].status) {
        fail(`state actor/task active status mismatch: ${actor.id}/${currentTask.id}`);
      }
    }
    const actorTasks = plan.tasks.filter((task) => task.runtime_actor_id === actor.id);
    const allowedResultRefs = new Set(actorTasks
      .map((task) => result.tasks[task.id].result_ref)
      .filter((value)                  => value !== null));
    for (const resultRef of actorState.result_refs) {
      if (!allowedResultRefs.has(resultRef)) {
        fail(`state.runtime_actors.${actor.id}.result_refs is outside actor results`);
      }
    }
    for (const completedTaskId of actorState.completed_task_ids) {
      const completedTask = taskById.get(completedTaskId);
      if (
        completedTask === undefined || completedTask.runtime_actor_id !== actor.id ||
        result.tasks[completedTaskId].status !== "completed"
      ) fail(`state.runtime_actors.${actor.id}.completed_task_ids is inconsistent`);
    }
  }
  for (const task of reviewTasks) {
    const subjectId = taskSubjectId(task);
    const reviewerState = result.reviewers[subjectId];
    if (reviewerState.current_task_id !== null && reviewerState.current_task_id !== task.id) {
      fail(`state.reviewers.${subjectId}.current_task_id is outside reviewer`);
    }
    if (reviewerState.current_task_id !== null && reviewerState.status !== result.tasks[task.id].status) {
      fail(`state reviewer/task active status mismatch: ${subjectId}/${task.id}`);
    }
    const allowedResult = result.tasks[task.id].result_ref;
    if (reviewerState.result_refs.some((ref) => ref !== allowedResult)) {
      fail(`state.reviewers.${subjectId}.result_refs is outside reviewer result`);
    }
    if (reviewerState.completed_task_ids.some((id) => id !== task.id || result.tasks[id].status !== "completed")) {
      fail(`state.reviewers.${subjectId}.completed_task_ids is inconsistent`);
    }
  }
  for (const stale of result.stale_executors) {
    const task = taskById.get(stale.task_id);
    if (task === undefined || taskSubjectId(task) !== stale.owner_id) {
      fail(`state stale executor references an invalid owner/task pair: ${stale.executor_id}`);
    }
    if (stale.source_revision > result.source_revision) {
      fail(`state stale executor cannot be from a future source revision: ${stale.executor_id}`);
    }
  }
  for (const taskId of result.review_pending) {
    const task = taskById.get(taskId);
    if (task === undefined || task.role !== "work" || result.tasks[taskId].status !== "completed") {
      fail(`state.review_pending references an invalid completed work task: ${taskId}`);
    }
  }
  return result;
}

function newCapsule(
  owner                 ,
  goalDigest        ,
  sourceRevision        ,
  generation = 1,
)               {
  return {
    contract: "OWNER_CAPSULE_V1",
    owner_id: owner.id,
    generation,
    goal_digest: goalDigest,
    source_revision: sourceRevision,
    scope: owner.writable_paths,
    scope_excludes: owner.excluded_paths,
    responsibility: owner.responsibility,
    worker_context: owner.worker_context,
    decisions: [],
    invariants: [],
    completed_tasks: [],
    result_refs: [],
    verification: [],
    risks: [],
    active_task_id: null,
    progress: "尚未开始",
    important_symbols: [],
    next_steps: [],
    checkpoint_ref: null,
    updated_at: new Date().toISOString(),
  };
}

function loadOwnerCapsule(
  owner                 ,
  ownerState            ,
  goalDigest        ,
  sourceRevision        ,
)               {
  const source = requireRecord(readJson(ownerState.capsule_ref), "owner capsule");
  if (source.contract !== "OWNER_CAPSULE_V1") {
    fail(`invalid owner capsule contract: ${ownerState.capsule_ref}`);
  }
  if (source.owner_id !== owner.id) {
    fail(`owner capsule owner_id mismatch: ${ownerState.capsule_ref}`);
  }
  if (source.generation !== ownerState.generation) {
    fail(`owner capsule generation mismatch: ${ownerState.capsule_ref}`);
  }
  if (source.goal_digest !== goalDigest) {
    fail(`owner capsule goal_digest mismatch: ${ownerState.capsule_ref}`);
  }
  if (source.source_revision !== sourceRevision) {
    fail(`owner capsule source_revision mismatch: ${ownerState.capsule_ref}`);
  }
  return source                           ;
}

function updatePersistentOwnerCapsule(
  goal              ,
  owner                 ,
  result                ,
  resultDigest        ,
)       {
  if (result.status !== "completed") return;
  const path = persistentOwnerCapsulePathFor(goal.workspace.root, owner.id);
  withStateLock(path, () => {
    const source = requireRecord(readJson(path), `persistent owner capsule ${owner.id}`);
    if (source.contract !== "OWNER_CAPSULE_V2" || source.owner_id !== owner.id) {
      fail(`invalid persistent owner capsule: ${path}`);
    }
    const decisions = uniqueStrings([
      ...requireStringArray(source.decisions, `persistent owner capsule ${owner.id}.decisions`),
      ...result.owner_updates.decisions,
    ]).slice(-100);
    const invariants = uniqueStrings([
      ...requireStringArray(source.invariants, `persistent owner capsule ${owner.id}.invariants`),
      ...result.owner_updates.invariants,
    ]).slice(-100);
    const risks = uniqueStrings([
      ...requireStringArray(source.risks, `persistent owner capsule ${owner.id}.risks`),
      ...result.owner_updates.risks,
    ]).slice(-100);
    const {
      history: _history,
      history_journal: _historyJournal,
      ...current
    } = source;
    void resultDigest;
    writeJson(path, {
      ...current,
      decisions,
      invariants,
      risks,
      updated_at: new Date().toISOString(),
    });
    const historyDirectory = join(dirname(path), "history");
    if (existsSync(historyDirectory)) rmSync(historyDirectory, { recursive: true, force: true });
  });
}

function initializeState(planPath        , plan      )           {
  mkdirSync(join(dirname(planPath), "results"), { recursive: true });
  const goal = parseGoal(readJson(plan.goal_contract_path));
  const registry = approvedOwnerRegistry(goal);
  const approvedOwners = new Map(registry.owners.map((owner) => [owner.id, owner]));
  const owners                             = {};
  for (const owner of plan.owners) {
    const capsuleRef = capsulePathFor(planPath, owner.id);
    if (!existsSync(capsuleRef)) {
      writeJson(
        capsuleRef,
        newCapsule(
          owner,
          plan.goal_digest,
          plan.plan_source.revision,
          approvedOwners.get(owner.id)?.generation ?? 1,
        ),
      );
    }
    owners[owner.id] = {
      generation: approvedOwners.get(owner.id)?.generation ?? 1,
      bound_executor_id: null,
      status: "unbound",
      current_task_id: null,
      capsule_ref: capsuleRef,
      completed_task_ids: [],
      result_refs: [],
    };
  }
  const runtimeActors                             = Object.fromEntries(
    plan.runtime_actors.map((actor) => [actor.id, {
      generation: 1,
      bound_executor_id: null,
      status: "unbound",
      current_task_id: null,
      capsule_ref: null,
      completed_task_ids: [],
      result_refs: [],
    }]),
  );
  const reviewers                             = Object.fromEntries(
    plan.tasks.filter((task) => task.role === "review").map((task) => [taskSubjectId(task), {
      generation: 1,
      bound_executor_id: null,
      status: "unbound",
      current_task_id: null,
      capsule_ref: null,
      completed_task_ids: [],
      result_refs: [],
    }]),
  );
  return {
    contract: "DAG_RUN_STATE_V5",
    plan_digest: digestFile(planPath),
    goal_digest: plan.goal_digest,
    goal_refresh_pending: false,
    source_revision: plan.plan_source.revision,
    revision: plan.revision,
    workspace_change_seq: 0,
    owner_registry: {
      ref: registry.ref,
      digest: registry.digest,
      revision: registry.revision,
    },
    owner_change: null,
    tasks: Object.fromEntries(plan.tasks.map((task) => [task.id, {
      status: "pending",
      attempt: 0,
      reservation_token: null,
      owner_generation: null,
      executor_id: null,
      source_revision: plan.plan_source.revision,
      validated_source_revision: plan.plan_source.revision,
      reserved_at: null,
      result_path: null,
      result_ref: null,
      result_digest: null,
      replacement_task_id: null,
      last_reclaimed_token: null,
      task_baseline_ref: null,
      task_baseline_digest: null,
      expanded_writable_paths: [],
      accepted_change_seq: null,
    }])),
    owners,
    runtime_actors: runtimeActors,
    reviewers,
    review_pending: [],
    stale_executors: [],
  };
}

function loadPlanAndState(
  planPath        ,
  statePath        ,
  options                                                                    = {},
)




  {
  const rawState = readJson(statePath);
  const stateRecord = requireRecord(rawState, "state");
  const allowUncoveredRequiredGates = stateRecord.goal_refresh_pending === true;
  const rawGoalState = existsSync(join(dirname(planPath), "goal-state.json"))
    ? requireRecord(readJson(join(dirname(planPath), "goal-state.json")), "goal state")
    : null;
  const completedFrozen = rawGoalState?.status === "completed";
  const { plan, goal, coverage } = parsePlan(
    readJson(planPath),
    planPath,
    {
      allowUncoveredRequiredGates,
      allowStaleCoverageSourceRefs: allowUncoveredRequiredGates,
      skipSourceBlockValidation: completedFrozen,
      verifySourceDigest: !completedFrozen && !(options.allowSourceDrift ?? false),
      liveTaskIds: liveTaskIdsFromRawState(rawState),
      ownerValidationTaskIds: ownerValidationTaskIdsFromRawState(rawState),
      skipOwnerRegistryValidation: options.allowOwnerRegistryDrift ?? false,
    },
  );
  const state = parseState(rawState, plan, planPath, {
    verifyExecutionArtifacts: !completedFrozen,
  });
  const currentRegistry = approvedOwnerRegistry(goal);
  if (!completedFrozen && resolve(state.owner_registry.ref) !== resolve(currentRegistry.ref)) {
    fail("state owner registry ref mismatch");
  }
  if (!completedFrozen && !(options.allowOwnerRegistryDrift ?? false) && (
    state.owner_registry.digest !== currentRegistry.digest ||
    state.owner_registry.revision !== currentRegistry.revision
  )) fail("owner registry changed; an approved owner transition delta is required");
  if (state.plan_digest !== digestFile(planPath)) fail("plan digest mismatch");
  if (state.goal_digest !== plan.goal_digest) fail("state goal_digest mismatch");
  if (state.revision !== plan.revision) fail("state revision mismatch");
  if (state.source_revision !== plan.plan_source.revision) fail("state source_revision mismatch");
  validateLiveDiffBarriers(plan, state);
  if (!completedFrozen) {
    for (const owner of plan.owners) {
      loadOwnerCapsule(
        owner,
        state.owners[owner.id],
        state.goal_digest,
        state.source_revision,
      );
    }
  }
  return { plan, goal, coverage, state };
}

function goalStateForPlan(
  planPath        ,
  plan      ,
  goal              ,
)                                     {
  const path = goalStatePathFor(plan.goal_contract_path);
  if (!existsSync(path)) fail("goal state is not initialized; run goal-validate first");
  const rawState = readJson(path);
  const rawStateRecord = requireRecord(rawState, "goal state");
  const state = parseGoalState(rawState, goal, {
    verifyExecutionArtifacts: rawStateRecord.status !== "completed",
  });
  if (state.goal_digest !== plan.goal_digest) fail("goal state digest mismatch");
  if (state.active_plan_path !== planPath) fail("plan is not the active goal plan");
  return { path, state };
}

function assertGoalMutable(planPath        , plan      , goal              )            {
  const goalState = goalStateForPlan(planPath, plan, goal).state;
  if (goalState.status === "completed") fail("goal is completed and immutable");
  return goalState;
}

function goalValidateCommand(goalArgument        )       {
  const goalPath = resolve(goalArgument);
  const goalStatePath = goalStatePathFor(goalPath);
  const dagStatePath = join(dirname(goalPath), "state.json");
  const payload = withStateLock(goalStatePath, () => withStateLock(dagStatePath, () => {
    const rawGoal = readJson(goalPath);
    const storedGoal = parseGoal(rawGoal, false);
    const goalDigest = digestFile(goalPath);
    if (existsSync(goalStatePath)) {
      const existingValue = readJson(goalStatePath);
      const existingRecord = requireRecord(existingValue, "goal state");
      const existing = parseGoalState(existingValue, storedGoal, {
        verifyExecutionArtifacts: existingRecord.status !== "completed",
      });
      if (existing.goal_digest !== goalDigest) fail("goal digest mismatch");
      if (existing.status === "completed") {
        return { status: "valid", goal: storedGoal, state: existing };
      }
      if (!existsSync(storedGoal.source.path)) {
        return {
          status: "source_missing",
          goal: storedGoal,
          state: existing,
          missing_source_path: storedGoal.source.path,
        };
      }
      const actualSourceDigest = digestFile(storedGoal.source.path);
      if (actualSourceDigest !== storedGoal.source.digest) {
        return {
          status: "source_changed",
          goal: storedGoal,
          state: existing,
          stored_source_digest: storedGoal.source.digest,
          actual_source_digest: actualSourceDigest,
          current_source_revision: storedGoal.source.revision,
          proposed_source_revision: storedGoal.source.revision + 1,
        };
      }
      return { status: "valid", goal: storedGoal, state: existing };
    }
    const goal = parseGoal(rawGoal);
    const baselinePath = join(dirname(goalPath), "workspace-fence.json");
    const baseline = captureWorktreeSnapshot(goal.workspace.root);
    const sourceBlocksPath = join(dirname(goalPath), "source-blocks.json");
    const sourceBlocks = buildSourceBlocks(goal);
    const state            = {
      contract: "GOAL_STATE_V1",
      goal_digest: goalDigest,
      status: "active",
      controller: goal.lifecycle.controller,
      native_goal: goal.lifecycle.native_goal,
      worktree_baseline: {
        ref: baselinePath,
        digest: digestJson(baseline),
      },
      source_blocks: {
        ref: sourceBlocksPath,
        digest: digestJson(sourceBlocks),
      },
      active_plan_path: null,
      result_ref: null,
      completed_at: null,
      native_sync: {
        status: goal.lifecycle.controller === "codex_native" ? "not_started" : "not_required",
        completion_token: null,
        objective_digest: createHash("sha256").update(goal.objective).digest("hex"),
        confirmed_at: null,
      },
    };
    if (!existsSync(goal.source.path) || digestFile(goal.source.path) !== goal.source.digest) {
      fail("goal source changed before initialization commit");
    }
    writeTransaction(dagStatePath, [
      [baselinePath, baseline],
      [sourceBlocksPath, sourceBlocks],
      [goalStatePath, state],
    ]);
    return { status: "valid", goal, state };
  }));
  process.stdout.write(`${JSON.stringify({
    ...payload.state,
    status: payload.status,
    goal_id: payload.goal.goal_id,
    goal_path: goalPath,
    goal_state_path: goalStatePath,
    thread_titles: goalThreadTitles(payload.goal),
    ...continuationPayloadFor(goalPath),
    ...(payload.status === "source_changed"
      ? {
        stored_source_digest: payload.stored_source_digest,
        actual_source_digest: payload.actual_source_digest,
        current_source_revision: payload.current_source_revision,
        proposed_source_revision: payload.proposed_source_revision,
      }
      : {}),
    ...(payload.status === "source_missing"
      ? { missing_source_path: payload.missing_source_path }
      : {}),
  })}\n`);
}

function validateCommand(planArgument        )       {
  const planPath = resolve(planArgument);
  const statePath = statePathFor(planPath);
  const goalStatePath = join(dirname(planPath), "goal-state.json");
  const payload = withStateLock(goalStatePath, () => withStateLock(statePath, () => {
    const existingStateValue = existsSync(statePath) ? readJson(statePath) : null;
    const { plan, coverage } = parsePlan(readJson(planPath), planPath, {
      ...(existingStateValue === null
        ? {}
        : {
          liveTaskIds: liveTaskIdsFromRawState(existingStateValue),
          ownerValidationTaskIds: ownerValidationTaskIdsFromRawState(existingStateValue),
        }),
    });
    if (existingStateValue === null) acceptedPlannerReview(planPath, plan);
    if (!existsSync(goalStatePath)) fail("goal state is not initialized; run goal-validate first");
    const goal = parseGoal(readJson(plan.goal_contract_path));
    const goalState = parseGoalState(readJson(goalStatePath), goal);
    if (goalState.status !== "active") fail("goal is already completed");
    if (goalState.goal_digest !== plan.goal_digest) fail("goal state digest mismatch");
    let state          ;
    let stateCreated = false;
    if (existingStateValue !== null) {
      state = parseState(existingStateValue, plan, planPath);
      if (state.plan_digest !== digestFile(planPath)) fail("plan digest mismatch");
    } else {
      state = initializeState(planPath, plan);
      stateCreated = true;
    }
    if (goalState.active_plan_path !== null && goalState.active_plan_path !== planPath) {
      fail(`goal already has an active plan: ${goalState.active_plan_path}`);
    }
    validateLiveDiffBarriers(plan, state);
    const goalStateChanged = goalState.active_plan_path === null;
    if (goalStateChanged) {
      goalState.active_plan_path = planPath;
    }
    const writes                           = [];
    if (stateCreated) writes.push([statePath, state]);
    if (goalStateChanged) writes.push([goalStatePath, goalState]);
    if (writes.length > 0) writeTransaction(statePath, writes);
    return { state, plan, coverage };
  }));
  const { state, plan, coverage } = payload;
  rmSync(plannerReviewDirectory(planPath), { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify({ status: "valid", plan_path: planPath, state_path: statePath, coverage_path: plan.coverage_path, progress_document_path: progressDocumentPathFor(planPath), goal_id: plan.goal_id, revision: plan.revision, safety: plan.safety.status, owner_count: plan.owners.length, task_count: plan.tasks.length, required_plan_item_count: coverage.required_plan_items.length, state_contract: state.contract })}\n`);
}

function refreshGoalCommand(
  goalArgument        ,
  goalStateArgument        ,
  planArgument        ,
  stateArgument        ,
)       {
  const goalPath = resolve(goalArgument);
  const goalStatePath = canonicalPath(goalStatePathFor(goalPath), goalStateArgument, "goal state path");
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const payload = withStateLock(goalStatePath, () => withStateLock(statePath, () => {
    const storedGoalValue = readJson(goalPath);
    const storedGoal = parseGoal(storedGoalValue, false);
    const storedGoalDigest = digestFile(goalPath);
    const goalState = parseGoalState(readJson(goalStatePath), storedGoal);
    if (goalState.goal_digest !== storedGoalDigest) fail("goal digest mismatch");
    if (goalState.status !== "active") fail("goal is completed and immutable");
    if (goalState.active_plan_path !== planPath) fail("goal refresh plan is not active");
    const actualSourceDigest = digestFile(storedGoal.source.path);
    if (actualSourceDigest === storedGoal.source.digest) {
      fail("goal source has not changed");
    }
    const oldPlanValue = readJson(planPath);
    const oldPlanDigest = digestFile(planPath);
    const rawStateValue = readJson(statePath);
    const liveTaskIds = liveTaskIdsFromRawState(rawStateValue);
    const { plan: oldPlan, coverage: oldCoverage } = parsePlan(
      oldPlanValue,
      planPath,
      {
        verifySourceDigest: false,
        allowUncoveredRequiredGates: true,
        allowStaleCoverageSourceRefs: true,
        liveTaskIds,
      },
    );
    if (oldPlan.goal_contract_path !== goalPath) fail("goal refresh path mismatch");
    if (oldPlan.goal_id !== storedGoal.goal_id) fail("goal refresh cannot change goal_id");
    if (oldPlan.goal_digest !== storedGoalDigest) fail("goal refresh goal digest mismatch");
    if (oldPlan.plan_source.path !== storedGoal.source.path) {
      fail("goal refresh cannot change source.path");
    }
    if (oldPlan.plan_source.revision !== storedGoal.source.revision) {
      fail("goal refresh source revision mismatch");
    }
    const state = parseState(rawStateValue, oldPlan, planPath);
    if (state.plan_digest !== oldPlanDigest) fail("plan digest mismatch");
    if (state.goal_digest !== storedGoalDigest) fail("goal state and DAG state digest mismatch");
    if (state.source_revision !== storedGoal.source.revision) {
      fail("state source_revision mismatch");
    }
    const active = activeTasks(oldPlan, state);
    if (active.length > 0) {
      fail(`source drift must drain active reservations before refresh: ${active.map((task) => task.id).join(", ")}`);
    }
    if (state.stale_executors.length > 0) {
      fail("source drift has stop-pending stale executors; confirm them before refresh");
    }
    for (const owner of oldPlan.owners) {
      loadOwnerCapsule(
        owner,
        state.owners[owner.id],
        storedGoalDigest,
        storedGoal.source.revision,
      );
    }

    const candidateGoal               = {
      ...storedGoal,
      source: {
        path: storedGoal.source.path,
        digest: actualSourceDigest,
        revision: storedGoal.source.revision + 1,
      },
    };
    const parsedCandidateGoal = parseGoal(candidateGoal);
    if (parsedCandidateGoal.source.path !== storedGoal.source.path) {
      fail("goal refresh cannot change source.path");
    }
    const newGoalDigest = digestJson(parsedCandidateGoal);
    const candidateSourceBlocks = buildSourceBlocks(parsedCandidateGoal);
    const candidateSourceBlocksDigest = digestJson(candidateSourceBlocks);
    const candidatePlanValue = {
      ...oldPlan,
      goal_digest: newGoalDigest,
      plan_source: { ...parsedCandidateGoal.source },
    };
    const candidatePlanDigest = digestJson(candidatePlanValue);
    const coverageCandidate               = {
      ...oldCoverage,
      source_path: parsedCandidateGoal.source.path,
      source_digest: parsedCandidateGoal.source.digest,
      source_revision: parsedCandidateGoal.source.revision,
      plan_digest: candidatePlanDigest,
    };
    const { plan, coverage } = parsePlan(candidatePlanValue, planPath, {
      allowUncoveredRequiredGates: true,
      coverageValue: coverageCandidate,
      expectedPlanDigest: candidatePlanDigest,
      goalValue: parsedCandidateGoal,
      expectedGoalDigest: newGoalDigest,
      sourceBlocksValue: candidateSourceBlocks,
      allowStaleCoverageSourceRefs: true,
      liveTaskIds,
    });
    const capsuleWrites                           = [];
    for (const owner of oldPlan.owners) {
      const ownerState = state.owners[owner.id];
      const capsule = loadOwnerCapsule(
        owner,
        ownerState,
        storedGoalDigest,
        storedGoal.source.revision,
      );
      capsule.goal_digest = newGoalDigest;
      capsule.source_revision = parsedCandidateGoal.source.revision;
      capsule.risks = uniqueStrings([
        ...capsule.risks,
        `source refreshed ${storedGoal.source.revision}->${parsedCandidateGoal.source.revision}; prior evidence requires explicit delta disposition`,
      ]);
      capsule.updated_at = new Date().toISOString();
      capsuleWrites.push([ownerState.capsule_ref, capsule]);
    }
    const canonicalPlanDigest = digestJson(plan);
    coverage.plan_digest = canonicalPlanDigest;
    state.plan_digest = canonicalPlanDigest;
    state.goal_digest = newGoalDigest;
    state.goal_refresh_pending = true;
    state.source_revision = parsedCandidateGoal.source.revision;
    goalState.goal_digest = newGoalDigest;
    goalState.source_blocks.digest = candidateSourceBlocksDigest;
    if (
      !existsSync(parsedCandidateGoal.source.path) ||
      digestFile(parsedCandidateGoal.source.path) !== (parsedCandidateGoal.source.digest)
    ) fail("goal source changed before refresh commit");
    writeTransaction(statePath, [
      ...capsuleWrites,
      [goalPath, parsedCandidateGoal],
      [goalState.source_blocks.ref, candidateSourceBlocks],
      [planPath, plan],
      [plan.coverage_path, coverage],
      [statePath, state],
      [goalStatePath, goalState],
    ]);
    return {
      status: "refreshed",
      goal_id: parsedCandidateGoal.goal_id,
      goal_digest: newGoalDigest,
      plan_digest: state.plan_digest,
      source_revision: state.source_revision,
      required_next_action: "apply_delta",
    };
  }));
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function compareStableStrings(left        , right        )         {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escapeMermaidLabel(value        )         {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("`", "&#96;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\n", "&#10;");
}

function renderCommand(planArgument        )       {
  const planPath = resolve(planArgument);
  const statePath = statePathFor(planPath);
  const rendered = withStateLock(statePath, () => {
    const source = readJson(planPath);
    const { plan } = parsePlan(source, planPath, {
      ...(existsSync(statePath)
        ? { liveTaskIds: liveTaskIdsFromRawState(readJson(statePath)) }
        : {}),
    });
  const tasks = [...plan.tasks].sort((left, right) => compareStableStrings(left.id, right.id));
  const aliases = new Map(tasks.map((task, index) => [task.id, `N${index}`]));
  const lines = [
    `%% goal-dag plan_digest=${digestJson(source)} revision=${plan.revision} safety.status=${plan.safety.status}`,
    "flowchart LR",
  ];
  for (const task of tasks) {
    const kind = task.role === "review" ? "review" : task.owner_id === null ? "actor" : "owner";
    const hierarchy = task.node_type === "composite"
      ? ` · composite:${(task.subgraph                ).task_ids.length}`
      : task.parent_task_id === null ? "" : ` · child-of:${task.parent_task_id}`;
    const label = escapeMermaidLabel(
      `${task.id} · [${ROLE_LABELS[task.role]}] ${task.title} · ${kind}:${taskSubjectId(task)}${hierarchy}`,
    );
    lines.push(`  ${aliases.get(task.id)}["${label}"]`);
  }
  for (const task of tasks) {
    for (const dependencyId of [...task.depends_on].sort(compareStableStrings)) {
      lines.push(`  ${aliases.get(dependencyId)} --> ${aliases.get(task.id)}`);
    }
    if (task.parent_task_id !== null && task.depends_on.length === 0) {
      lines.push(`  ${aliases.get(task.parent_task_id)} -. subgraph .-> ${aliases.get(task.id)}`);
    }
  }
    return `${lines.join("\n")}\n`;
  });
  process.stdout.write(rendered);
}

function dependencyResolved(
  taskId        ,
  plan      ,
  state          ,
  visited = new Set        (),
)          {
  if (visited.has(taskId)) fail(`replacement cycle detected at ${taskId}`);
  visited.add(taskId);
  const taskState = state.tasks[taskId];
  const task = plan.tasks.find((candidate) => candidate.id === taskId);
  if (taskState === undefined || task === undefined) fail(`dependency references unknown task: ${taskId}`);
  if (task.node_type === "composite") {
    return (task.subgraph                ).task_ids.every((childId) =>
      dependencyResolved(childId, plan, state, new Set(visited))
    );
  }
  if (taskState.status === "completed") return !state.review_pending.includes(taskId);
  if (taskState.status === "superseded" && taskState.replacement_task_id !== null) {
    return dependencyResolved(taskState.replacement_task_id, plan, state, visited);
  }
  return false;
}

function effectiveTaskStatus(task                , plan      , state          )             {
  if (task.node_type === "leaf") return state.tasks[task.id].status;
  const childStatuses = (task.subgraph                ).task_ids.map((childId) => {
    const child = plan.tasks.find((candidate) => candidate.id === childId);
    if (child === undefined) fail(`composite task ${task.id} references unknown child: ${childId}`);
    const childState = state.tasks[child.id];
    if (childState.status === "superseded" && childState.replacement_task_id !== null) {
      const replacementId = replacementTerminalTaskId(childState.replacement_task_id, state);
      const replacement = plan.tasks.find((candidate) => candidate.id === replacementId);
      if (replacement === undefined) fail(`replacement references unknown task: ${replacementId}`);
      return effectiveTaskStatus(replacement, plan, state);
    }
    return effectiveTaskStatus(child, plan, state);
  });
  if ((task.subgraph                ).task_ids.every((childId) =>
    dependencyResolved(childId, plan, state)
  )) {
    return "completed";
  }
  for (const attention of ["needs_repair", "failed", "blocked"]                ) {
    if (childStatuses.includes(attention)) return attention;
  }
  if (childStatuses.some((status) => status === "running" || status === "reserved" || status === "completed")) {
    return "running";
  }
  return "pending";
}

function taskDepth(task                , plan      )         {
  const byId = new Map(plan.tasks.map((candidate) => [candidate.id, candidate]));
  let depth = 0;
  let parentId = task.parent_task_id;
  const visited = new Set        ();
  while (parentId !== null) {
    if (visited.has(parentId)) fail(`task containment cycle detected at ${parentId}`);
    visited.add(parentId);
    depth += 1;
    parentId = byId.get(parentId)?.parent_task_id ?? null;
  }
  return depth;
}

function boundaryDependenciesForTask(task                , plan      )           {
  const byId = new Map(plan.tasks.map((candidate) => [candidate.id, candidate]));
  const result = new Set(task.depends_on);
  let parentId = task.parent_task_id;
  const visited = new Set        ();
  while (parentId !== null) {
    if (visited.has(parentId)) fail(`task containment cycle detected at ${parentId}`);
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (parent === undefined) fail(`task ${task.id} references unknown parent: ${parentId}`);
    for (const dependencyId of parent.depends_on) result.add(dependencyId);
    parentId = parent.parent_task_id;
  }
  return [...result];
}

function replacementTerminalTaskId(
  taskId        ,
  state          ,
  visited = new Set        (),
)         {
  if (visited.has(taskId)) fail(`replacement cycle detected at ${taskId}`);
  visited.add(taskId);
  const taskState = state.tasks[taskId];
  if (taskState === undefined) fail(`replacement references unknown task: ${taskId}`);
  if (taskState.status === "superseded" && taskState.replacement_task_id !== null) {
    return replacementTerminalTaskId(taskState.replacement_task_id, state, visited);
  }
  return taskId;
}

function logicalAncestorsFor(
  taskId        ,
  plan      ,
  state          ,
  cache = new Map                     (),
  visiting = new Set        (),
)              {
  const terminalId = replacementTerminalTaskId(taskId, state);
  const cached = cache.get(terminalId);
  if (cached !== undefined) return cached;
  if (visiting.has(terminalId)) fail(`logical dependency cycle detected at ${terminalId}`);
  visiting.add(terminalId);
  const task = plan.tasks.find((candidate) => candidate.id === terminalId);
  if (task === undefined) fail(`logical dependency references unknown task: ${terminalId}`);
  const result = new Set        ();
  for (const dependencyId of task.depends_on) {
    const terminalDependencyId = replacementTerminalTaskId(dependencyId, state);
    result.add(terminalDependencyId);
    for (const ancestorId of logicalAncestorsFor(
      terminalDependencyId,
      plan,
      state,
      cache,
      visiting,
    )) result.add(ancestorId);
  }
  visiting.delete(terminalId);
  cache.set(terminalId, result);
  return result;
}

function resultRefsForDependency(taskId        , state          , visited = new Set        ())           {
  if (visited.has(taskId)) fail(`replacement cycle detected at ${taskId}`);
  visited.add(taskId);
  const taskState = state.tasks[taskId];
  if (taskState.status === "completed" && taskState.result_ref !== null) return [taskState.result_ref];
  if (taskState.status === "superseded" && taskState.replacement_task_id !== null) {
    return resultRefsForDependency(taskState.replacement_task_id, state, visited);
  }
  return [];
}

function resultTasksForDependency(
  taskId        ,
  plan      ,
  state          ,
  visited = new Set        (),
)                   {
  if (visited.has(taskId)) fail(`dependency or subgraph cycle detected at ${taskId}`);
  visited.add(taskId);
  const task = plan.tasks.find((candidate) => candidate.id === taskId);
  if (task === undefined) fail(`dependency references unknown task: ${taskId}`);
  const taskState = state.tasks[task.id];
  if (task.node_type === "composite") {
    return (task.subgraph                ).task_ids.flatMap((childId) =>
      resultTasksForDependency(childId, plan, state, new Set(visited))
    );
  }
  if (taskState.status === "superseded" && taskState.replacement_task_id !== null) {
    return resultTasksForDependency(taskState.replacement_task_id, plan, state, visited);
  }
  return taskState.status === "completed" && taskState.result_ref !== null ? [task] : [];
}

function dependencyInputsForTask(
  plan      ,
  state          ,
  consumer                ,
)                            {
  const inputs                            = [];
  for (const dependencyId of boundaryDependenciesForTask(consumer, plan)) {
    const producers = resultTasksForDependency(dependencyId, plan, state);
    for (const producer of producers) {
    const producerState = state.tasks[producer.id];
    if (producerState.status !== "completed" || producerState.result_ref === null) continue;
    if (taskSubjectId(producer) === taskSubjectId(consumer)) {
      inputs.push({
        kind: "same_owner_result",
        producer_task_id: producer.id,
        result_ref: producerState.result_ref,
        result_digest: producerState.result_digest,
      });
      continue;
    }
    if (consumer.runtime_actor_id !== null || producer.runtime_actor_id !== null) {
      inputs.push({
        kind: "runtime_evidence",
        producer_task_id: producer.id,
        result_digest: producerState.result_digest,
        workspace_change_seq: producerState.accepted_change_seq,
      });
      continue;
    }
    const producerResult = parseWorkerResult(
      readJson(producerState.result_ref),
      producer,
      subjectForTask(plan, producer),
      producerState,
    );
    const published = producerResult.published_artifacts.filter((artifact) =>
      artifact.audience.includes("*") || artifact.audience.includes(taskSubjectId(consumer)),
    );
    if (published.length === 0) {
      fail(
        `cross-owner dependency ${producer.id} -> ${consumer.id} has no published ` +
        `OWNER_INTERFACE_V1 or OWNER_HANDOFF_V1 for ${taskSubjectId(consumer)}`,
      );
    }
    inputs.push(...published.map((artifact) => ({
      kind: "published_owner_artifact",
      boundary_task_id: dependencyId,
      producer_task_id: producer.id,
      producer_owner_id: producer.owner_id,
      ...artifact,
    })));
    }
  }
  return inputs;
}

function criticalScores(tasks                  )                      {
  const children = new Map(tasks.map((task) => [task.id, []            ]));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const task of tasks) {
    for (const dependencyId of task.depends_on) children.get(dependencyId)?.push(task.id);
  }
  const scores = new Map                ();
  function score(taskId        )         {
    const cached = scores.get(taskId);
    if (cached !== undefined) return cached;
    const childScores = (children.get(taskId) ?? []).map(score);
    const result = (byId.get(taskId)                  ).estimated_cost + Math.max(0, ...childScores);
    scores.set(taskId, result);
    return result;
  }
  for (const task of tasks) score(task.id);
  return scores;
}

function activeTasks(plan      , state          )                   {
  return plan.tasks.filter((task) => {
    const status = state.tasks[task.id].status;
    return status === "reserved" || status === "running";
  });
}

function taskReadyForReservation(
  task                ,
  plan      ,
  state          ,
  coverageFullyPlanned         ,
)          {
  if (task.node_type === "composite") return false;
  if (state.tasks[task.id].status !== "pending") return false;
  if (!boundaryDependenciesForTask(task, plan).every((dependencyId) =>
    dependencyResolved(dependencyId, plan, state)
  )) {
    return false;
  }
  if (!task.verification_ids.includes(DIFF_SCOPE_GATE_ID)) return true;
  if (!coverageFullyPlanned) return false;
  return plan.tasks.every((other) =>
    other.id === task.id || other.verification_ids.includes(COMMIT_READINESS_GATE_ID) ||
    state.tasks[other.id].status === "superseded" ||
    (
      state.tasks[other.id].status === "completed" &&
      state.tasks[other.id].validated_source_revision === state.source_revision
    ),
  );
}

function validateLiveDiffBarriers(plan      , state          )       {
  const liveTasks = plan.tasks.filter((task) => state.tasks[task.id].status !== "superseded");
  const liveDiffTasks = liveTasks.filter((task) =>
    task.satisfies_goal_gates.includes(DIFF_SCOPE_GATE_ID),
  );
  if (liveDiffTasks.length !== 1) {
    fail(`exactly one live ${DIFF_SCOPE_GATE_ID} task is required`);
  }
  const diffTask = liveDiffTasks[0];
  const readinessTasks = liveTasks.filter((task) =>
    task.satisfies_goal_gates.includes(COMMIT_READINESS_GATE_ID),
  );
  if (readinessTasks.length !== 1) {
    fail(`exactly one live ${COMMIT_READINESS_GATE_ID} task is required`);
  }
  const readinessTask = readinessTasks[0];
  const cache = new Map                     ();
  const descendants = liveTasks.filter((task) =>
    task.id !== diffTask.id && logicalAncestorsFor(task.id, plan, state, cache).has(diffTask.id),
  );
  if (descendants.some((task) => task.id !== readinessTask.id)) {
    fail(
      `${DIFF_SCOPE_GATE_ID} task ${diffTask.id} may only precede ` +
      `${COMMIT_READINESS_GATE_ID}: ${descendants.map((task) => task.id).join(", ")}`,
    );
  }
  if (!descendants.some((task) => task.id === readinessTask.id)) {
    fail(`${COMMIT_READINESS_GATE_ID} must be a descendant of ${DIFF_SCOPE_GATE_ID}`);
  }
}

const THREAD_KEY_MAX_LENGTH = 64;
const THREAD_KEY_SUBJECT_MAX_LENGTH = 40;
const THREAD_KEY_PATTERN = /^wf_[a-z0-9_]{1,61}$/;

function executorNameSegment(value        , fallback        )         {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function threadKey(
  planPath        ,
  plan      ,
  goal              ,
  task                ,
  subject                  ,
  ownerState            ,
  taskState           ,
)         {
  const instanceIdentity = goal.lifecycle.native_goal === null
    ? {
      execution_platform: goal.execution_platform,
      goal_contract_path: resolve(plan.goal_contract_path),
      plan_directory: dirname(resolve(planPath)),
    }
    : {
      execution_platform: goal.execution_platform,
      native_goal: goal.lifecycle.native_goal,
      plan_path: resolve(planPath),
    };
  const identityDigest = createHash("sha256")
    .update(serializedJson({
      instance: instanceIdentity,
      goal_id: goal.goal_id,
    }))
    .digest("hex")
    .slice(0, 6);
  let subjectSegment = executorNameSegment(subject.id, "owner")
    .slice(0, THREAD_KEY_SUBJECT_MAX_LENGTH)
    .replace(/_+$/g, "");
  const suffix = `_g${ownerState.generation}_${identityDigest}`;
  const fixedLength = "wf_".length + suffix.length;
  const segmentBudget = THREAD_KEY_MAX_LENGTH - fixedLength;
  if (segmentBudget < 1) fail("thread incarnation exceeds name length limit");
  subjectSegment = subjectSegment.slice(0, segmentBudget).replace(/_+$/g, "");
  if (!subjectSegment) fail("thread readable segment is empty");
  const result = `wf_${subjectSegment}${suffix}`;
  if (result.length > THREAD_KEY_MAX_LENGTH || !THREAD_KEY_PATTERN.test(result)) {
    fail(`thread key violates canonical naming policy: ${result}`);
  }
  return result;
}

function threadTitle(task                , subject                   )         {
  void subject;
  return task.role === "review"
    ? `[GA][任务][实现审查] ${compactUserSummary(task.title)}`
    : `[GA][任务][责任域] ${compactUserSummary(task.title)}`;
}

function goalThreadTitles(goal              )                         {
  const title = compactUserSummary(goal.objective);
  return {
    main: `[GA][任务][主控] ${title}`,
    planner: `[GA][任务][规划] ${title}`,
    planner_reviewer: `[GA][任务][规划审查] ${title}`,
    supervisor: `[GA][任务][监督] ${title}`,
  };
}

function compositePlannerThreadTitle(task                )         {
  return `[GA][任务][子图规划] ${compactUserSummary(task.title)}`;
}

function acceptedResultUserMessage(task                , result                )         {
  const title = threadTitle(task);
  const summary = compactUserSummary(result.summary);
  return result.status === "completed"
    ? `${title}任务完成：${summary}`
    : `${title}结果已验收：${summary}`;
}

function effectiveWritablePaths(task                , taskState           )           {
  return uniqueStrings([...task.writable_paths, ...taskState.expanded_writable_paths])
    .sort(compareStableStrings);
}

function reviewContextForTask(
  plan      ,
  state          ,
  task                ,
)



         {
  if (task.role !== "review") return null;
  return {
    plan_digest: state.plan_digest,
    workspace_digest: state.tasks[task.id].task_baseline_digest,
    reviewed_results: task.reviews_task_ids.map((taskId) => {
      const reviewedState = state.tasks[taskId];
      if (
        reviewedState === undefined || reviewedState.status !== "completed" ||
        reviewedState.result_ref === null || reviewedState.result_digest === null
      ) fail(`review task ${task.id} requires an accepted result for ${taskId}`);
      return {
        task_id: taskId,
        result_ref: reviewedState.result_ref,
        result_digest: reviewedState.result_digest,
      };
    }),
  };
}

function runtimeProfileForTask(
  goal              ,
  task                ,
)                {
  const config = loadThreadWorkflowConfig(goal.workspace.root);
  if (task.role === "review") return config.profiles.review;
  if (task.owner_id === null) fail(`runtime actor ${task.runtime_actor_id} is script-only`);
  return config.profiles.owner;
}

function threadProfileReceipt(
  workspaceRoot        ,
  role                   ,
)                                    {
  const profile = loadThreadWorkflowConfig(workspaceRoot).profiles[role];
  return { model: profile.model, effort: profile.reasoning_effort };
}

function taskBinding(
  planPath        ,
  plan      ,
  goal              ,
  state          ,
  task                ,
)                          {
  const taskState = state.tasks[task.id];
  const subject = subjectForTask(plan, task);
  const subjectState = subjectStateForTask(state, task);
  const canonicalThreadKey = threadKey(planPath, plan, goal, task, subject, subjectState, taskState);
  const goalState = goalStateForPlan(planPath, plan, goal).state;
  const diffArtifactPath = task.verification_ids.includes(DIFF_SCOPE_GATE_ID) &&
      taskState.reservation_token !== null
    ? diffScopeArtifactPathFor(
      planPath,
      task.id,
      taskState.attempt,
      taskState.reservation_token,
    )
    : null;
  const sourceCoverageArtifactPath = task.verification_ids.includes(SOURCE_COVERAGE_GATE_ID) &&
      taskState.reservation_token !== null
    ? sourceCoverageArtifactPathFor(
      planPath,
      task.id,
      taskState.attempt,
      taskState.reservation_token,
    )
    : null;
  const commitReadinessArtifactPath = task.verification_ids.includes(COMMIT_READINESS_GATE_ID) &&
      taskState.reservation_token !== null
    ? commitReadinessArtifactPathFor(
      planPath,
      task.id,
      taskState.attempt,
      taskState.reservation_token,
    )
    : null;
  const coverage = parseCoverage(
    readJson(plan.coverage_path),
    plan.coverage_path,
    planPath,
    state.plan_digest,
    plan,
    goal,
    undefined,
    false,
    false,
    liveTaskIdsFromRawState(state),
  );
  const coverageDigest = digestFile(plan.coverage_path);
  const semanticDigest = coverageSemanticDigest(coverage);
  const registryPath = ownerRegistryPathFor(goal.workspace.root);
  const moduleOwner = isOwnerDefinition(subject);
  const registryBinding = existsSync(registryPath)
    ? { ref: registryPath, digest: digestFile(registryPath) }
    : null;
  const audit                                                     = {};
  if (diffArtifactPath !== null) {
    audit[DIFF_SCOPE_GATE_ID] = { path: diffArtifactPath, contract: "DIFF_SCOPE_AUDIT_V1" };
  }
  if (sourceCoverageArtifactPath !== null) {
    audit[SOURCE_COVERAGE_GATE_ID] = {
      path: sourceCoverageArtifactPath,
      contract: "SOURCE_COVERAGE_AUDIT_V1",
    };
  }
  if (commitReadinessArtifactPath !== null) {
    audit[COMMIT_READINESS_GATE_ID] = {
      path: commitReadinessArtifactPath,
      contract: "COMMIT_READINESS_AUDIT_V1",
    };
  }
  return {
    contract: "TASK_BINDING_V6",
    task: {
      id: task.id,
      title: task.title,
      role: task.role,
      work: task.task,
      done: task.done_when,
      verify: task.verification_ids,
      items: task.plan_item_ids,
      risk: task.risk_level,
      dependencies: dependencyInputsForTask(plan, state, task),
    },
    run: {
      attempt: taskState.attempt,
      token: taskState.reservation_token,
      source_revision: taskState.source_revision,
      generation: subjectState.generation,
      executor: taskState.executor_id,
      workspace_change_seq: state.workspace_change_seq,
    },
    thread: {
      key: canonicalThreadKey,
      title: threadTitle(task, subject),
      profile: runtimeProfileForTask(goal, task),
    },
    subject: {
      id: subject.id,
      kind: task.role === "review" ? "review" : moduleOwner ? "owner" : "runtime",
      responsibility: subject.responsibility,
      context: subject.worker_context,
    },
    scope: {
      read: subjectScope(subject),
      exclude: moduleOwner ? (subject                   ).excluded_paths : [],
      write: effectiveWritablePaths(task, taskState),
    },
    refs: {
      plan: planPath,
      state: statePathFor(planPath),
      coverage: { ref: plan.coverage_path, digest: coverageDigest, semantic_digest: semanticDigest },
      source_blocks: goalState.source_blocks,
      registry: registryBinding,
      capsule: subjectState.capsule_ref,
      persistent_capsule: moduleOwner
        ? persistentOwnerCapsulePathFor(goal.workspace.root, subject.id)
        : null,
      artifact_dir: moduleOwner
        ? persistentOwnerInterfaceDirectoryFor(
          goal.workspace.root,
          goal.goal_id,
          task.id,
        )
        : null,
      checkpoint: moduleOwner ? checkpointPathFor(planPath, subject.id, task.id) : null,
      result: taskState.result_path,
      subgraph_request: taskState.result_path === null
        ? null
        : subgraphRequestPathFor(taskState.result_path),
    },
    review: {
      policy: task.review_policy,
      subjects: task.reviews_task_ids,
      context: reviewContextForTask(plan, state, task),
    },
    policy: {
      objective: goal.objective,
      scope: goal.scope,
      non_goals: goal.non_goals,
      constraints: goal.constraints,
      side_effects: goal.side_effects,
    },
    audit,
    output: {
      input: "TASK_RESULT_INPUT_V2",
      stored: "WORKER_RESULT_V5",
    },
  };
}

function reserveCommand(
  planArgument        ,
  stateArgument        ,
  capacityArgument         ,
  compact = false,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const payload = withStateLock(statePath, () => {
    const { plan, goal, coverage, state } = loadPlanAndState(planPath, statePath);
    assertGoalMutable(planPath, plan, goal);
    if (plan.safety.status === "needs_user_review") fail("plan safety requires user review");
    if (state.goal_refresh_pending) fail("goal refresh requires DAG delta before reserve");
    if (state.owner_change !== null) fail("owner change is awaiting user action");
    if (state.stale_executors.length > 0) {
      fail("stale executors are stop-pending; confirm them before reserve");
    }
    const workflowConfig = loadThreadWorkflowConfig(goal.workspace.root);
    const requestedCapacity = capacityArgument === undefined
      ? workflowConfig.parallel
      : requirePositiveInteger(Number(capacityArgument), "capacity");
    const capacity = Math.min(
      requestedCapacity,
      workflowConfig.parallel,
      goal.execution.max_concurrency,
    );
    const currentActive = activeTasks(plan, state);
    let slots = Math.max(0, capacity - currentActive.length);
    const selected = [...currentActive];
    const scores = criticalScores(plan.tasks);
    const coverageSummary = summarizeCoverage(plan, coverage, state);
    const coverageFullyPlanned =
      (coverageSummary.uncovered_plan_item_effects            ).length === 0;
    const ready = coverageFullyPlanned
      ? plan.tasks
        .filter((task) => taskReadyForReservation(task, plan, state, true))
        .sort((left, right) =>
          (scores.get(right.id)          ) - (scores.get(left.id)          ) ||
          right.priority - left.priority ||
          compareStableStrings(left.id, right.id),
        )
      : [];
    const actions                            = [];
    const ownerBusy                            = [];
    for (const task of ready) {
      if (slots === 0) break;
      const ownerState = subjectStateForTask(state, task);
      if (ownerState.status === "reserved" || ownerState.status === "running") continue;
      if (selected.some((active) => tasksConflict(task, active))) continue;
      const taskState = state.tasks[task.id];
      dependencyInputsForTask(plan, state, task);
      const reservationToken = randomUUID();
      if (task.owner_id !== null && task.role !== "review") {
        const lease = acquireOwnerLease(goal, statePath, task, reservationToken);
        if (!lease.acquired) {
          ownerBusy.push({
            task_id: task.id,
            owner_id: task.owner_id,
            lease: lease.lease,
            inspect_command: `owner-lease-inspect ${JSON.stringify(goal.workspace.root)} ${task.owner_id}`,
          });
          continue;
        }
      }
      taskState.status = "reserved";
      taskState.attempt += 1;
      taskState.reservation_token = reservationToken;
      taskState.owner_generation = ownerState.generation;
      taskState.executor_id = null;
      taskState.source_revision = state.source_revision;
      taskState.validated_source_revision = state.source_revision;
      taskState.reserved_at = new Date().toISOString();
      taskState.result_path = resultPathFor(
        planPath,
        task.id,
        taskState.attempt,
        taskState.reservation_token,
      );
      taskState.result_ref = null;
      taskState.result_digest = null;
      taskState.last_reclaimed_token = null;
      taskState.task_baseline_ref = null;
      taskState.task_baseline_digest = null;
      taskState.accepted_change_seq = null;
      ownerState.status = "reserved";
      ownerState.current_task_id = task.id;
      if (task.owner_id === null) {
        actions.push({
          action: "run_script",
          task_id: task.id,
          runtime_actor_id: task.runtime_actor_id,
          reservation_token: taskState.reservation_token,
          command: `runtime-execute ${JSON.stringify(planPath)} ${JSON.stringify(statePath)} ${task.id} ${taskState.reservation_token}`,
        });
      } else {
        const action = ownerState.bound_executor_id === null ? "create_thread" : "reuse_thread";
        const subject = subjectForTask(plan, task);
        const canonicalThreadKey = threadKey(
          planPath,
          plan,
          goal,
          task,
          subject,
          ownerState,
          taskState,
        );
        const binding = taskBinding(planPath, plan, goal, state, task);
        actions.push({
          action,
          task_id: task.id,
          attempt: taskState.attempt,
          owner_id: task.owner_id,
          runtime_actor_id: null,
          execution_subject_id: subject.id,
          owner_generation: ownerState.generation,
          executor_id: ownerState.bound_executor_id,
          thread_key: canonicalThreadKey,
          thread_title: threadTitle(task, subject),
          reservation_token: taskState.reservation_token,
          critical_score: scores.get(task.id),
          ...(compact ? {} : { binding }),
        });
      }
      selected.push(task);
      slots -= 1;
    }
    if (actions.length > 0) writeJson(statePath, state);
    const repairRequired = plan.tasks
      .filter((task) => ["blocked", "failed", "needs_repair"].includes(state.tasks[task.id].status))
      .map((task) => ({ task_id: task.id, status: state.tasks[task.id].status, result_ref: state.tasks[task.id].result_ref }));
    return {
      actions,
      owner_busy: ownerBusy,
      repair_required: repairRequired,
      summary: summarizeState(state),
      coverage: coverageSummary,
      ...(coverageFullyPlanned ? {} : { required_next_action: "needs_delta" }),
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function bindTaskState(
  planPath        ,
  plan      ,
  goal              ,
  state          ,
  task                ,
  reservationToken        ,
  executorId        ,
)                          {
    const taskId = task.id;
    const taskState = state.tasks[taskId];
    const ownerState = subjectStateForTask(state, task);
    const subjectId = taskSubjectId(task);
    if (taskState.status !== "reserved") fail(`task ${taskId} is not reserved`);
    if (ownerState.status !== "reserved" || ownerState.current_task_id !== taskId) {
      fail(`execution subject ${subjectId} is not reserved for task ${taskId}`);
    }
    if (taskState.reservation_token !== reservationToken) fail("reservation token mismatch");
    if (taskState.source_revision !== state.source_revision) fail("source revision mismatch");
    if (taskState.owner_generation !== ownerState.generation) fail("owner generation mismatch");
    const actualExecutorId = requireString(executorId, "executor_id");
    if (ownerState.bound_executor_id !== null && ownerState.bound_executor_id !== actualExecutorId) {
      fail(`execution subject ${subjectId} must reuse executor ${ownerState.bound_executor_id}`);
    }
    for (const [otherId, other] of [
      ...Object.entries(state.owners),
      ...Object.entries(state.runtime_actors),
      ...Object.entries(state.reviewers),
    ]) {
      if (otherId !== subjectId && other.bound_executor_id === actualExecutorId) {
        fail(`executor ${actualExecutorId} is already bound to execution subject ${otherId}`);
      }
    }
    const baselineRef = taskBaselinePathFor(
      planPath,
      task.id,
      taskState.attempt,
      reservationToken,
    );
    writeImmutableJson(baselineRef, captureWorktreeSnapshot(goal.workspace.root));
    taskState.task_baseline_ref = baselineRef;
    taskState.task_baseline_digest = digestFile(baselineRef);
    ownerState.bound_executor_id = actualExecutorId;
    ownerState.status = "running";
    taskState.status = "running";
    taskState.executor_id = actualExecutorId;
    updateOwnerLease(goal, task, reservationToken, {
      executor_id: actualExecutorId,
      status: "running",
    });
    return {
      task_id: taskId,
      owner_id: task.owner_id,
      runtime_actor_id: task.runtime_actor_id,
      execution_subject_id: subjectId,
      owner_generation: ownerState.generation,
      executor_id: actualExecutorId,
      status: "running",
      ...(task.owner_id === null ? {} : { binding: taskBinding(planPath, plan, goal, state, task) }),
    };
}

function bindCommand(
  planArgument        ,
  stateArgument        ,
  taskId        ,
  reservationToken        ,
  executorId        ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const payload = withStateLock(statePath, () => {
    const { plan, goal, state } = loadPlanAndState(planPath, statePath);
    assertGoalMutable(planPath, plan, goal);
    const task = plan.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) fail(`unknown task: ${taskId}`);
    const result = bindTaskState(
      planPath,
      plan,
      goal,
      state,
      task,
      reservationToken,
      executorId,
    );
    writeJson(statePath, state);
    return result;
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function abandonCommand(
  planArgument        ,
  stateArgument        ,
  taskId        ,
  reservationToken        ,
  reason        ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const abandonReason = requireString(reason, "reason");
  let cleanupPaths           = [];
  const payload = withStateLock(statePath, () => {
    const { plan, goal, coverage, state } = loadPlanAndState(
      planPath,
      statePath,
      { allowSourceDrift: true },
    );
    assertGoalMutable(planPath, plan, goal);
    const task = plan.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) fail(`unknown task: ${taskId}`);
    const taskState = state.tasks[taskId];
    if (taskState.status !== "reserved") {
      fail(`task ${taskId} can only be abandoned before bind; running tasks require reclaim`);
    }
    if (taskState.reservation_token !== reservationToken) fail("reservation token mismatch");
    cleanupPaths = taskAttemptCleanupPaths(planPath, task, taskState);
    const ownerState = subjectStateForTask(state, task);
    if (ownerState.current_task_id !== taskId) fail("owner current task mismatch");
    taskState.status = "pending";
    taskState.reservation_token = null;
    taskState.owner_generation = null;
    taskState.executor_id = null;
    taskState.reserved_at = null;
    taskState.result_path = null;
    taskState.result_ref = null;
    taskState.result_digest = null;
    taskState.task_baseline_ref = null;
    taskState.task_baseline_digest = null;
    taskState.accepted_change_seq = null;
    ownerState.status = ownerState.bound_executor_id === null ? "unbound" : "idle";
    ownerState.current_task_id = null;
    if (task.owner_id !== null && task.role !== "review") {
      const owner = subjectForTask(plan, task)                   ;
      const capsule = interruptCapsule(
        owner,
        ownerState,
        state.goal_digest,
        state.source_revision,
        `task ${taskId} abandoned: ${abandonReason}`,
      );
      writeTransaction(statePath, [
        [ownerState.capsule_ref          , capsule],
        [statePath, state],
      ]);
    } else {
      writeJson(statePath, state);
    }
    releaseOwnerLease(goal, task, reservationToken);
    return { task_id: taskId, status: "pending", reason: abandonReason };
  });
  for (const path of cleanupPaths) rmSync(path, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function parseEvidence(value         , index        )           {
  const source = requireRecord(value, `worker result.evidence[${index}]`);
  if (source.outcome !== "passed" && source.outcome !== "failed" && source.outcome !== "not_run") {
    fail(`worker result.evidence[${index}].outcome is invalid`);
  }
  const artifactDigest = requireNullableString(
    source.artifact_digest,
    `worker result.evidence[${index}].artifact_digest`,
  );
  const artifactRef = requireNullableString(
    source.artifact_ref,
    `worker result.evidence[${index}].artifact_ref`,
  );
  if ((artifactRef === null) !== (artifactDigest === null)) {
    fail(`worker result.evidence[${index}] artifact_ref and artifact_digest must be paired`);
  }
  if (artifactDigest !== null && !/^[0-9a-f]{64}$/.test(artifactDigest)) {
    fail(`worker result.evidence[${index}].artifact_digest must be a sha256 hex digest`);
  }
  if (artifactRef !== null) {
    if (!isAbsolute(artifactRef)) {
      fail(`worker result.evidence[${index}].artifact_ref must be absolute`);
    }
    if (!existsSync(artifactRef) || digestFile(artifactRef) !== artifactDigest) {
      fail(`worker result.evidence[${index}] artifact is missing or has a digest mismatch`);
    }
  }
  return {
    verification_id: requireIdentifier(
      source.verification_id,
      `worker result.evidence[${index}].verification_id`,
    ),
    outcome: source.outcome,
    summary: requireString(source.summary, `worker result.evidence[${index}].summary`),
    artifact_ref: artifactRef,
    artifact_digest: artifactDigest,
  };
}

function parseCheckpoint(
  value         ,
  task                ,
  taskState           ,
)                    {
  const source = requireRecord(value, "owner checkpoint");
  if (source.contract !== "OWNER_CHECKPOINT_V1") {
    fail("owner checkpoint contract must equal OWNER_CHECKPOINT_V1");
  }
  const checkpoint                    = {
    contract: "OWNER_CHECKPOINT_V1",
    task_id: requireString(source.task_id, "owner checkpoint.task_id"),
    owner_id: requireString(source.owner_id, "owner checkpoint.owner_id"),
    owner_generation: requirePositiveInteger(
      source.owner_generation,
      "owner checkpoint.owner_generation",
    ),
    reservation_token: requireString(
      source.reservation_token,
      "owner checkpoint.reservation_token",
    ),
    progress: requireString(source.progress, "owner checkpoint.progress"),
    decisions: requireStringArray(source.decisions, "owner checkpoint.decisions"),
    invariants: requireStringArray(source.invariants, "owner checkpoint.invariants"),
    risks: requireStringArray(source.risks, "owner checkpoint.risks"),
    important_symbols: requireStringArray(
      source.important_symbols,
      "owner checkpoint.important_symbols",
    ),
    next_steps: requireStringArray(source.next_steps, "owner checkpoint.next_steps"),
  };
  if (checkpoint.task_id !== task.id) fail("owner checkpoint task_id mismatch");
  if (checkpoint.owner_id !== task.owner_id) fail("owner checkpoint owner_id mismatch");
  if (checkpoint.owner_generation !== taskState.owner_generation) {
    fail("owner checkpoint owner_generation mismatch");
  }
  if (checkpoint.reservation_token !== taskState.reservation_token) {
    fail("owner checkpoint reservation_token mismatch");
  }
  return checkpoint;
}

function checkpointCommand(
  planArgument        ,
  stateArgument        ,
  taskId        ,
  reservationToken        ,
  checkpointArgument        ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const payload = withStateLock(statePath, () => {
    const { plan, goal, state } = loadPlanAndState(
      planPath,
      statePath,
      { allowSourceDrift: true },
    );
    assertGoalMutable(planPath, plan, goal);
    const task = plan.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) fail(`unknown task: ${taskId}`);
    if (task.owner_id === null) fail("runtime actor tasks do not have checkpoints");
    const taskState = state.tasks[taskId];
    if (taskState.status !== "running") fail(`task ${taskId} is not running`);
    if (taskState.reservation_token !== reservationToken) fail("reservation token mismatch");
    if (taskState.source_revision !== state.source_revision) fail("source revision mismatch");
    const ownerState = subjectStateForTask(state, task);
    if (ownerState.status !== "running" || ownerState.current_task_id !== taskId) {
      fail("owner is not running this checkpoint task");
    }
    const checkpointPath = canonicalPath(
      checkpointPathFor(planPath, task.owner_id, taskId),
      checkpointArgument === "-"
        ? checkpointPathFor(planPath, task.owner_id, taskId)
        : checkpointArgument,
      "checkpoint path",
    );
    let checkpointValue         ;
    if (checkpointArgument === "-") {
      const input = readStructuredInput("CHECKPOINT_INPUT_V1");
      requireAllowedKeys(input, [
        "contract",
        "progress",
        "decisions",
        "invariants",
        "risks",
        "symbols",
        "next",
      ], "checkpoint input");
      checkpointValue = {
        contract: "OWNER_CHECKPOINT_V1",
        task_id: task.id,
        owner_id: task.owner_id,
        owner_generation: taskState.owner_generation,
        reservation_token: taskState.reservation_token,
        progress: requireString(input.progress, "checkpoint input.progress"),
        decisions: input.decisions ?? [],
        invariants: input.invariants ?? [],
        risks: input.risks ?? [],
        important_symbols: input.symbols ?? [],
        next_steps: input.next ?? [],
      };
      writeJson(checkpointPath, checkpointValue);
    } else {
      checkpointValue = readJson(checkpointPath);
    }
    const checkpoint = parseCheckpoint(checkpointValue, task, taskState);
    if (task.role === "review") {
      return {
        task_id: taskId,
        owner_id: task.owner_id,
        owner_generation: ownerState.generation,
        checkpoint_ref: checkpointPath,
        capsule_ref: null,
      };
    }
    const owner = subjectForTask(plan, task)                   ;
    const capsule = loadOwnerCapsule(
      owner,
      ownerState,
      state.goal_digest,
      state.source_revision,
    );
    capsule.generation = ownerState.generation;
    capsule.active_task_id = taskId;
    capsule.progress = checkpoint.progress;
    capsule.decisions = uniqueStrings([...(capsule.decisions ?? []), ...checkpoint.decisions]);
    capsule.invariants = uniqueStrings([...(capsule.invariants ?? []), ...checkpoint.invariants]);
    capsule.risks = uniqueStrings([...(capsule.risks ?? []), ...checkpoint.risks]);
    capsule.important_symbols = uniqueStrings(checkpoint.important_symbols);
    capsule.next_steps = uniqueStrings(checkpoint.next_steps);
    capsule.checkpoint_ref = checkpointPath;
    capsule.updated_at = new Date().toISOString();
    writeJson(ownerState.capsule_ref          , capsule);
    return {
      task_id: taskId,
      owner_id: task.owner_id,
      owner_generation: ownerState.generation,
      checkpoint_ref: checkpointPath,
      capsule_ref: ownerState.capsule_ref,
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function parseScopeRequest(value         )               {
  const source = requireRecord(value, "worker result.scope_request");
  return {
    paths: requireStringArray(source.paths, "worker result.scope_request.paths", false)
      .map(normalizePathPattern),
    reason: requireString(source.reason, "worker result.scope_request.reason"),
    required_for_done_when: requireString(
      source.required_for_done_when,
      "worker result.scope_request.required_for_done_when",
    ),
    suggested_owner: requireString(source.suggested_owner, "worker result.scope_request.suggested_owner"),
    split_hints: requireStringArray(source.split_hints, "worker result.scope_request.split_hints"),
    overlap_hints: requireStringArray(source.overlap_hints, "worker result.scope_request.overlap_hints"),
  };
}

function parsePublishedOwnerArtifact(value         , index        )                         {
  const source = requireRecord(value, `worker result.published_artifacts[${index}]`);
  const contract = requireString(
    source.contract,
    `worker result.published_artifacts[${index}].contract`,
  );
  if (
    contract !== "OWNER_INTERFACE_V1" && contract !== "OWNER_HANDOFF_V1" &&
    contract !== "COMMIT_ATTESTATION_V1"
  ) fail(`worker result.published_artifacts[${index}].contract is invalid`);
  const ref = requireString(source.ref, `worker result.published_artifacts[${index}].ref`);
  const digest = requireString(source.digest, `worker result.published_artifacts[${index}].digest`);
  if (!isAbsolute(ref)) fail(`worker result.published_artifacts[${index}].ref must be absolute`);
  if (!/^[0-9a-f]{64}$/u.test(digest)) {
    fail(`worker result.published_artifacts[${index}].digest must be a sha256 digest`);
  }
  if (!existsSync(ref) || digestFile(ref) !== digest) {
    fail(`worker result.published_artifacts[${index}] is missing or changed`);
  }
  const audience = requireStringArray(
    source.audience,
    `worker result.published_artifacts[${index}].audience`,
    false,
  );
  ensureUnique(audience, `worker result.published_artifacts[${index}].audience`);
  return {
    contract: contract                                      ,
    ref,
    digest,
    audience,
  };
}

function parseWorkerResult(
  value         ,
  task                ,
  owner                  ,
  taskState           ,
  allowedPublishedArtifactDirectory         ,
)                 {
  const source = requireRecord(value, "worker result");
  if (source.contract !== "WORKER_RESULT_V5") {
    fail("worker result contract must equal WORKER_RESULT_V5");
  }
  if (!TERMINAL_STATUSES.has(source.status                        )) {
    fail(`worker result.status is invalid: ${String(source.status)}`);
  }
  const status = source.status                        ;
  const result                 = {
    contract: "WORKER_RESULT_V5",
    status,
    task_id: requireString(source.task_id, "worker result.task_id"),
    logical_id: requireString(source.logical_id, "worker result.logical_id"),
    role: requireString(source.role, "worker result.role")            ,
    owner_id: requireNullableString(source.owner_id, "worker result.owner_id"),
    runtime_actor_id: requireNullableString(
      source.runtime_actor_id,
      "worker result.runtime_actor_id",
    )                         ,
    owner_generation: requirePositiveInteger(source.owner_generation, "worker result.owner_generation"),
    executor_id: requireString(source.executor_id, "worker result.executor_id"),
    reservation_token: requireString(source.reservation_token, "worker result.reservation_token"),
    attempt: requirePositiveInteger(source.attempt, "worker result.attempt"),
    source_revision: requirePositiveInteger(
      source.source_revision,
      "worker result.source_revision",
    ),
    changed_files: requireStringArray(source.changed_files, "worker result.changed_files")
      .map(normalizePathPattern),
    evidence: Array.isArray(source.evidence)
      ? source.evidence.map(parseEvidence)
      : fail("worker result.evidence must be an array"),
    diff_self_check: requireString(source.diff_self_check, "worker result.diff_self_check")                                     ,
    blocking_findings: requireStringArray(
      source.blocking_findings,
      "worker result.blocking_findings",
    ),
    non_blocking_findings: requireStringArray(
      source.non_blocking_findings,
      "worker result.non_blocking_findings",
    ),
    follow_up_suggestions: requireStringArray(
      source.follow_up_suggestions,
      "worker result.follow_up_suggestions",
    ),
    reviewed_results: Array.isArray(source.reviewed_results)
      ? source.reviewed_results.map((value, index) => {
        const reviewed = requireRecord(value, `worker result.reviewed_results[${index}]`);
        return {
          task_id: requireIdentifier(
            reviewed.task_id,
            `worker result.reviewed_results[${index}].task_id`,
          ),
          result_ref: requireString(
            reviewed.result_ref,
            `worker result.reviewed_results[${index}].result_ref`,
          ),
          result_digest: requireString(
            reviewed.result_digest,
            `worker result.reviewed_results[${index}].result_digest`,
          ),
        };
      })
      : fail("worker result.reviewed_results must be an array"),
    review_plan_digest: requireNullableString(
      source.review_plan_digest,
      "worker result.review_plan_digest",
    ),
    review_workspace_digest: requireNullableString(
      source.review_workspace_digest,
      "worker result.review_workspace_digest",
    ),
    ...(source.review_upgrade_reason === undefined
      ? {}
      : {
        review_upgrade_reason: requireNullableString(
          source.review_upgrade_reason,
          "worker result.review_upgrade_reason",
        ),
      }),
    scope_request: source.scope_request === null ? null : parseScopeRequest(source.scope_request),
    summary: requireString(source.summary, "worker result.summary"),
    owner_updates: (() => {
      const updates = requireRecord(source.owner_updates, "worker result.owner_updates");
      return {
        decisions: requireStringArray(updates.decisions, "worker result.owner_updates.decisions"),
        invariants: requireStringArray(updates.invariants, "worker result.owner_updates.invariants"),
        risks: requireStringArray(updates.risks, "worker result.owner_updates.risks"),
      };
    })(),
    published_artifacts: Array.isArray(source.published_artifacts)
      ? source.published_artifacts.map(parsePublishedOwnerArtifact)
      : fail("worker result.published_artifacts must be an array"),
  };
  if (
    result.diff_self_check !== "pass" &&
    result.diff_self_check !== "fail" &&
    result.diff_self_check !== "scope_exception"
  ) {
    fail(`worker result.diff_self_check is invalid: ${result.diff_self_check}`);
  }
  if (result.task_id !== task.id) fail("worker result task_id mismatch");
  if (result.logical_id !== task.logical_id) fail("worker result logical_id mismatch");
  if (result.role !== task.role) fail("worker result role mismatch");
  if (result.owner_id !== task.owner_id) fail("worker result owner_id mismatch");
  if (result.runtime_actor_id !== task.runtime_actor_id) {
    fail("worker result runtime_actor_id mismatch");
  }
  if (result.owner_generation !== taskState.owner_generation) fail("worker result owner_generation mismatch");
  if (result.executor_id !== taskState.executor_id) fail("worker result executor_id mismatch");
  if (result.reservation_token !== taskState.reservation_token) fail("worker result reservation_token mismatch");
  if (result.attempt !== taskState.attempt) fail("worker result attempt mismatch");
  if (result.source_revision !== taskState.source_revision) fail("worker result source_revision mismatch");
  ensureUnique(result.changed_files, "worker result changed file");
  ensureUnique(result.reviewed_results.map((item) => item.task_id), "worker reviewed task id");
  ensureUnique(result.published_artifacts.map((item) => item.ref), "published artifact ref");
  for (const artifact of result.published_artifacts) {
    if (allowedPublishedArtifactDirectory !== undefined) {
      const artifactRelative = relative(allowedPublishedArtifactDirectory, artifact.ref);
      if (
        artifactRelative === "" || artifactRelative === ".." ||
        artifactRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
        isAbsolute(artifactRelative)
      ) fail(`published artifact is outside the binding directory: ${artifact.ref}`);
    }
    const body = requireRecord(readJson(artifact.ref), `published artifact ${artifact.ref}`);
    if (body.contract !== artifact.contract) fail(`published artifact contract mismatch: ${artifact.ref}`);
    if (body.owner_id !== task.owner_id) fail(`published artifact owner_id mismatch: ${artifact.ref}`);
    if (body.producer_task_id !== task.id) {
      fail(`published artifact producer_task_id mismatch: ${artifact.ref}`);
    }
    const bodyAudience = requireStringArray(body.audience, `published artifact ${artifact.ref}.audience`);
    if (serializedJson([...bodyAudience].sort(compareStableStrings)) !==
      serializedJson([...artifact.audience].sort(compareStableStrings))) {
      fail(`published artifact audience mismatch: ${artifact.ref}`);
    }
    if (
      artifact.contract !== "COMMIT_ATTESTATION_V1" &&
      ["result_ref", "result_digest", "raw_result", "source_code", "changed_files"]
        .some((key) => Object.hasOwn(body, key))
    ) fail(`cross-owner artifact exposes an internal result field: ${artifact.ref}`);
  }
  ensureUnique(result.evidence.map((item) => item.verification_id), "worker result evidence id");
  const unexpectedEvidence = result.evidence.filter(
    (item) => !task.verification_ids.includes(item.verification_id),
  );
  if (unexpectedEvidence.length > 0) {
    fail(`worker result contains unknown verification ids: ${unexpectedEvidence.map((item) => item.verification_id).join(", ")}`);
  }
  if (status === "completed") {
    if (result.diff_self_check !== "pass") fail("completed requires diff_self_check pass");
    if (result.scope_request !== null) fail("completed requires scope_request null");
    if (result.blocking_findings.length > 0) {
      fail("completed requires blocking_findings empty");
    }
    const passed = new Set(result.evidence.filter((item) => item.outcome === "passed").map((item) => item.verification_id));
    const missing = task.verification_ids.filter((id) => !passed.has(id));
    if (missing.length > 0) fail(`completed result is missing passed evidence: ${missing.join(", ")}`);
    for (const gateId of [
      DIFF_SCOPE_GATE_ID,
      SOURCE_COVERAGE_GATE_ID,
      COMMIT_READINESS_GATE_ID,
    ]) {
      if (!task.verification_ids.includes(gateId)) continue;
      const auditEvidence = result.evidence.find(
        (item) => item.verification_id === gateId && item.outcome === "passed",
      );
      if (
        auditEvidence === undefined || auditEvidence.artifact_ref === null ||
        auditEvidence.artifact_digest === null
      ) fail(`${gateId} passed evidence requires artifact_ref and artifact_digest`);
    }
  } else if (status === "needs_repair") {
    if (result.diff_self_check !== "scope_exception" || result.scope_request === null) {
      fail("needs_repair requires scope_exception and scope_request");
    }
  } else {
    if (result.scope_request !== null) fail(`${status} requires scope_request null`);
    if (result.diff_self_check === "scope_exception") fail(`${status} cannot use scope_exception`);
  }
  if (task.role !== "work" && result.changed_files.length > 0) {
    fail(`${task.role} result must have empty changed_files`);
  }
  for (const changedFile of result.changed_files) {
    if (!effectiveWritablePaths(task, taskState).some((pattern) => pathMatchesPattern(changedFile, pattern))) {
      fail(`worker result changed_files exceed task scope: ${changedFile}`);
    }
    if (!isOwnerDefinition(owner) || !ownerAllowsPath(owner, changedFile)) {
      fail(`worker result changed_files exceed owner scope: ${changedFile}`);
    }
  }
  if (!isOwnerDefinition(owner) && (
    result.owner_updates.decisions.length > 0 || result.owner_updates.invariants.length > 0 ||
    result.owner_updates.risks.length > 0 || result.published_artifacts.length > 0
  )) fail("runtime actor result cannot update or publish persistent Owner state");
  return result;
}

function validateReviewResultBinding(
  plan      ,
  state          ,
  task                ,
  result                ,
)       {
  if (task.role !== "work" && (result.review_upgrade_reason ?? null) !== null) {
    fail(`${task.role} result cannot request a Review upgrade`);
  }
  if (result.status !== "completed" && (result.review_upgrade_reason ?? null) !== null) {
    fail("Review upgrade requires a completed work result");
  }
  if (task.role !== "review") {
    if (
      result.reviewed_results.length > 0 || result.review_plan_digest !== null ||
      result.review_workspace_digest !== null || result.non_blocking_findings.length > 0 ||
      result.follow_up_suggestions.length > 0
    ) fail("non-review result cannot contain review-only fields");
    return;
  }
  const expected = reviewContextForTask(plan, state, task);
  if (expected === null) fail("review context is missing");
  if (result.review_plan_digest !== expected.plan_digest) {
    fail("review result plan digest mismatch");
  }
  if (
    expected.workspace_digest === null ||
    result.review_workspace_digest !== expected.workspace_digest
  ) fail("review result workspace digest mismatch");
  if (serializedJson(result.reviewed_results) !== serializedJson(expected.reviewed_results)) {
    fail("review result subjects changed after binding");
  }
}










































function requireExactKeys(
  source                         ,
  expected          ,
  label        ,
)       {
  const actual = Object.keys(source).sort(compareStableStrings);
  const sortedExpected = [...expected].sort(compareStableStrings);
  if (serializedJson(actual) !== serializedJson(sortedExpected)) {
    fail(`${label} has unexpected or missing fields`);
  }
}

function requireAllowedKeys(
  source                         ,
  allowed          ,
  label        ,
)       {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(source).filter((key) => !allowedSet.has(key));
  if (unexpected.length > 0) {
    fail(`${label} has unexpected fields: ${unexpected.sort(compareStableStrings).join(", ")}`);
  }
}

function changedWorktreePaths(
  baseline                    ,
  current                    ,
)           {
  const baselineByPath = new Map(baseline.entries.map((item) => [item.path, item]));
  const currentByPath = new Map(current.entries.map((item) => [item.path, item]));
  return uniqueStrings([...baselineByPath.keys(), ...currentByPath.keys()])
    .filter((path) =>
      serializedJson(baselineByPath.get(path) ?? null) !==
        serializedJson(currentByPath.get(path) ?? null),
    )
    .sort(compareStableStrings);
}

function worktreeBaselineFor(
  planPath        ,
  plan      ,
  goal              ,
)                                                     {
  const goalState = goalStateForPlan(planPath, plan, goal).state;
  const baseline = parseWorktreeBaseline(
    readJson(goalState.worktree_baseline.ref),
    goal.workspace.root,
  );
  if (digestFile(goalState.worktree_baseline.ref) !== goalState.worktree_baseline.digest) {
    fail("worktree baseline digest mismatch");
  }
  return { state: goalState, baseline };
}

function expectedDiffScopeAudit(
  planPath        ,
  plan      ,
  goal              ,
  state          ,
  auditTask                ,
  taskState           ,
)                         {
  const { state: goalState, baseline } = worktreeBaselineFor(planPath, plan, goal);
  const current = captureWorktreeSnapshot(goal.workspace.root);
  if (current.tree_oid !== baseline.tree_oid) {
    fail(`${DIFF_SCOPE_GATE_ID} requires a refresh after Git tree content changes`);
  }
  const allChangedFiles = changedWorktreePaths(baseline, current);
  const sourceRelative = relative(goal.workspace.root, goal.source.path).replaceAll("\\", "/");
  const sourceIsInsideWorkspace = sourceRelative !== "" && sourceRelative !== ".." &&
    !sourceRelative.startsWith("../") && !isAbsolute(sourceRelative);
  const canonicalSourceRelative = sourceIsInsideWorkspace
    ? normalizePathPattern(sourceRelative)
    : null;
  const inputChanges = canonicalSourceRelative !== null &&
      allChangedFiles.includes(canonicalSourceRelative)
    ? [{ path: canonicalSourceRelative, source_digest: goal.source.digest }]
    : [];
  if (inputChanges.length > 0 && digestFile(goal.source.path) !== goal.source.digest) {
    fail("goal source input changed after the current source revision was frozen");
  }
  const observedChangedFiles = allChangedFiles.filter(
    (path) => path !== canonicalSourceRelative,
  );
  const auditedResults                                            = [];
  const reviewedFiles                                           = [];
  const declarations = new Map




     ();
  const liveWorkTasks = plan.tasks
    .filter((task) => task.role === "work" && state.tasks[task.id].status !== "superseded")
    .sort((left, right) => compareStableStrings(left.id, right.id));
  for (const workTask of liveWorkTasks) {
    const workState = state.tasks[workTask.id];
    if (
      workState.status !== "completed" ||
      workState.validated_source_revision !== state.source_revision ||
      workState.result_ref === null || workState.result_digest === null ||
      !existsSync(workState.result_ref) || digestFile(workState.result_ref) !== (workState.result_digest)
    ) {
      fail(`${DIFF_SCOPE_GATE_ID} requires every live work task to have current accepted evidence: ${workTask.id}`);
    }
    const owner = subjectForTask(plan, workTask)                   ;
    const workResult = parseWorkerResult(readJson(workState.result_ref), workTask, owner, workState);
    if (workResult.status !== "completed") fail(`audit input is not completed: ${workTask.id}`);
    const changedFiles = [...workResult.changed_files].sort(compareStableStrings);
    auditedResults.push({
      task_id: workTask.id,
      result_ref: workState.result_ref,
      result_digest: workState.result_digest,
      declared_changed_files: changedFiles,
    });
    for (const changedFile of changedFiles) {
      const matches = declarations.get(changedFile) ?? [];
      matches.push({
        task: workTask,
        owner,
        resultRef: workState.result_ref,
        resultDigest: workState.result_digest,
      });
      declarations.set(changedFile, matches);
    }
  }
  const undeclaredFiles = observedChangedFiles.filter((path) => !declarations.has(path));
  if (undeclaredFiles.length > 0) {
    fail(`${DIFF_SCOPE_GATE_ID} observed undeclared worktree files: ${undeclaredFiles.join(", ")}`);
  }
  const unobservedDeclarations = [...declarations.keys()]
    .filter((path) => !observedChangedFiles.includes(path))
    .sort(compareStableStrings);
  for (const changedFile of observedChangedFiles) {
    const matches = declarations.get(changedFile)




      ;
    reviewedFiles.push({
      path: changedFile,
      contributors: matches.map((match) => {
        const taskPatterns = effectiveWritablePaths(
          match.task,
          state.tasks[match.task.id],
        ).filter((pattern) =>
          pathMatchesPattern(changedFile, pattern),
        );
        const ownerPatterns = match.owner.writable_paths.filter((pattern) =>
          pathMatchesPattern(changedFile, pattern),
        );
        if (
          taskPatterns.length === 0 || ownerPatterns.length === 0 ||
          !ownerAllowsPath(match.owner, changedFile)
        ) {
          fail(`audit input changed file is outside authorized scope: ${changedFile}`);
        }
        return {
          task_id: match.task.id,
          result_ref: match.resultRef,
          result_digest: match.resultDigest,
          authorized_task_patterns: taskPatterns,
          authorized_owner_patterns: ownerPatterns,
          conclusion: "authorized"         ,
        };
      }),
    });
  }
  return {
    contract: "DIFF_SCOPE_AUDIT_V1",
    audit_task_id: auditTask.id,
    runtime_actor_id: "diff-audit",
    attempt: taskState.attempt,
    reservation_token: taskState.reservation_token          ,
    source_revision: state.source_revision,
    plan_digest: state.plan_digest,
    baseline_ref: goalState.worktree_baseline.ref,
    baseline_digest: goalState.worktree_baseline.digest,
    baseline_head_oid: baseline.head_oid,
    current_head_oid: current.head_oid,
    current_snapshot_digest: digestJson(current),
    input_changes: inputChanges,
    audited_results: auditedResults,
    observed_changed_files: observedChangedFiles,
    reviewed_files: reviewedFiles,
    net_zero_declared_files: unobservedDeclarations,
    scope_conclusion: "passed",
    out_of_scope_files: [],
    undeclared_files: [],
  };
}

function parseDiffScopeAuditArtifact(value         )                         {
  const source = requireRecord(value, "diff scope audit artifact");
  requireExactKeys(source, [
    "contract", "audit_task_id", "runtime_actor_id", "attempt", "reservation_token",
    "source_revision", "plan_digest", "baseline_ref", "baseline_digest",
    "baseline_head_oid", "current_head_oid", "current_snapshot_digest", "input_changes",
    "audited_results", "observed_changed_files", "reviewed_files",
    "net_zero_declared_files", "scope_conclusion", "out_of_scope_files", "undeclared_files",
  ], "diff scope audit artifact");
  if (source.contract !== "DIFF_SCOPE_AUDIT_V1") {
    fail("diff scope audit artifact contract must equal DIFF_SCOPE_AUDIT_V1");
  }
  const baselineRef = requireString(source.baseline_ref, "diff scope audit baseline_ref");
  if (!isAbsolute(baselineRef)) fail("diff scope audit baseline_ref must be absolute");
  const baselineDigest = requireString(source.baseline_digest, "diff scope audit baseline_digest");
  const baselineHeadOid = requireString(source.baseline_head_oid, "diff scope audit baseline_head_oid");
  const currentHeadOid = requireString(source.current_head_oid, "diff scope audit current_head_oid");
  const currentSnapshotDigest = requireString(
    source.current_snapshot_digest,
    "diff scope audit current_snapshot_digest",
  );
  if (!Array.isArray(source.input_changes)) fail("diff scope audit input_changes must be an array");
  const inputChanges = source.input_changes.map((value, index) => {
    const item = requireRecord(value, `diff scope audit input_changes[${index}]`);
    return {
      path: normalizePathPattern(
        requireString(item.path, `diff scope audit input_changes[${index}].path`),
      ),
      source_digest: requireString(
        item.source_digest,
        `diff scope audit input_changes[${index}].source_digest`,
      ),
    };
  });
  for (const [label, digest] of [
    ["baseline_digest", baselineDigest],
    ["current_snapshot_digest", currentSnapshotDigest],
  ]) {
    if (!/^[0-9a-f]{64}$/u.test(digest)) fail(`diff scope audit ${label} is invalid`);
  }
  for (const [label, oid] of [
    ["baseline_head_oid", baselineHeadOid],
    ["current_head_oid", currentHeadOid],
  ]) {
    if (!/^[0-9a-f]{40,64}$/u.test(oid)) fail(`diff scope audit ${label} is invalid`);
  }
  if (!Array.isArray(source.audited_results)) fail("diff scope audit audited_results must be an array");
  const auditedResults = source.audited_results.map((value, index) => {
    const item = requireRecord(value, `diff scope audit audited_results[${index}]`);
    requireExactKeys(
      item,
      ["task_id", "result_ref", "result_digest", "declared_changed_files"],
      `diff scope audit audited_results[${index}]`,
    );
    return {
      task_id: requireIdentifier(item.task_id, `diff scope audit audited_results[${index}].task_id`),
      result_ref: requireString(item.result_ref, `diff scope audit audited_results[${index}].result_ref`),
      result_digest: requireString(item.result_digest, `diff scope audit audited_results[${index}].result_digest`),
      declared_changed_files: requireStringArray(
        item.declared_changed_files,
        `diff scope audit audited_results[${index}].declared_changed_files`,
      ).map(normalizePathPattern),
    };
  });
  if (!Array.isArray(source.reviewed_files)) fail("diff scope audit reviewed_files must be an array");
  const reviewedFiles = source.reviewed_files.map((value, index) => {
    const item = requireRecord(value, `diff scope audit reviewed_files[${index}]`);
    requireExactKeys(item, ["path", "contributors"], `diff scope audit reviewed_files[${index}]`);
    if (!Array.isArray(item.contributors) || item.contributors.length === 0) {
      fail(`diff scope audit reviewed_files[${index}].contributors must be non-empty`);
    }
    return {
      path: normalizePathPattern(requireString(item.path, `diff scope audit reviewed_files[${index}].path`)),
      contributors: item.contributors.map((value, contributorIndex) => {
        const contributor = requireRecord(
          value,
          `diff scope audit reviewed_files[${index}].contributors[${contributorIndex}]`,
        );
        if (contributor.conclusion !== "authorized") {
          fail("diff scope audit contributor conclusion must equal authorized");
        }
        return {
          task_id: requireIdentifier(
            contributor.task_id,
            `diff scope audit reviewed_files[${index}].contributors[${contributorIndex}].task_id`,
          ),
          result_ref: requireString(contributor.result_ref, "diff scope audit contributor result_ref"),
          result_digest: requireString(
            contributor.result_digest,
            "diff scope audit contributor result_digest",
          ),
          authorized_task_patterns: requireStringArray(
            contributor.authorized_task_patterns,
            "diff scope audit contributor authorized_task_patterns",
          ).map(normalizePathPattern),
          authorized_owner_patterns: requireStringArray(
            contributor.authorized_owner_patterns,
            "diff scope audit contributor authorized_owner_patterns",
          ).map(normalizePathPattern),
          conclusion: "authorized"         ,
        };
      }),
    };
  });
  if (source.scope_conclusion !== "passed") fail("diff scope audit scope_conclusion must equal passed");
  const outOfScopeFiles = requireStringArray(
    source.out_of_scope_files,
    "diff scope audit out_of_scope_files",
  ).map(normalizePathPattern);
  if (outOfScopeFiles.length > 0) fail("diff scope audit out_of_scope_files must be empty");
  const undeclaredFiles = requireStringArray(
    source.undeclared_files,
    "diff scope audit undeclared_files",
  ).map(normalizePathPattern);
  if (undeclaredFiles.length > 0) fail("diff scope audit undeclared_files must be empty");
  return {
    contract: "DIFF_SCOPE_AUDIT_V1",
    audit_task_id: requireIdentifier(source.audit_task_id, "diff scope audit audit_task_id"),
    runtime_actor_id: (() => {
      if (source.runtime_actor_id !== "diff-audit") {
        fail("diff scope audit runtime_actor_id must equal diff-audit");
      }
      return "diff-audit"         ;
    })(),
    attempt: requirePositiveInteger(source.attempt, "diff scope audit attempt"),
    reservation_token: requireString(source.reservation_token, "diff scope audit reservation_token"),
    source_revision: requirePositiveInteger(source.source_revision, "diff scope audit source_revision"),
    plan_digest: requireString(source.plan_digest, "diff scope audit plan_digest"),
    baseline_ref: resolve(baselineRef),
    baseline_digest: baselineDigest,
    baseline_head_oid: baselineHeadOid,
    current_head_oid: currentHeadOid,
    current_snapshot_digest: currentSnapshotDigest,
    input_changes: inputChanges,
    audited_results: auditedResults,
    observed_changed_files: requireStringArray(
      source.observed_changed_files,
      "diff scope audit observed_changed_files",
    ).map(normalizePathPattern),
    reviewed_files: reviewedFiles,
    net_zero_declared_files: requireStringArray(
      source.net_zero_declared_files,
      "diff scope audit net_zero_declared_files",
    ).map(normalizePathPattern),
    scope_conclusion: "passed",
    out_of_scope_files: [],
    undeclared_files: [],
  };
}

function bindDiffScopeArtifact(
  planPath        ,
  plan      ,
  goal              ,
  state          ,
  task                ,
  taskState           ,
  result                ,
  accepted         ,
)       {
  if (!task.verification_ids.includes(DIFF_SCOPE_GATE_ID)) return;
  const evidence = result.evidence.find((item) => item.verification_id === DIFF_SCOPE_GATE_ID);
  if (evidence === undefined) fail(`${DIFF_SCOPE_GATE_ID} evidence is missing`);
  if (evidence.outcome !== "passed") {
    if (evidence.artifact_ref !== null || evidence.artifact_digest !== null) {
      fail(`${DIFF_SCOPE_GATE_ID} non-passed evidence must not bind an audit artifact`);
    }
    return;
  }
  if (evidence.artifact_ref === null || evidence.artifact_digest === null) {
    fail(`${DIFF_SCOPE_GATE_ID} artifact binding is missing`);
  }
  const candidatePath = diffScopeArtifactPathFor(
    planPath,
    task.id,
    taskState.attempt,
    taskState.reservation_token          ,
  );
  const expectedPath = accepted ? `${candidatePath}.accepted.json` : candidatePath;
  canonicalPath(expectedPath, evidence.artifact_ref, `${DIFF_SCOPE_GATE_ID} artifact_ref`);
  if (!existsSync(expectedPath)) fail(`${DIFF_SCOPE_GATE_ID} artifact does not exist: ${expectedPath}`);
  if (digestFile(expectedPath) !== evidence.artifact_digest) {
    fail(`${DIFF_SCOPE_GATE_ID} artifact digest mismatch`);
  }
  const actual = parseDiffScopeAuditArtifact(readJson(expectedPath));
  const expected = expectedDiffScopeAudit(planPath, plan, goal, state, task, taskState);
  if (serializedJson(actual) !== serializedJson(expected)) {
    fail(`${DIFF_SCOPE_GATE_ID} artifact content does not match accepted work results and scope`);
  }
  if (!accepted) {
    const acceptedPath = `${candidatePath}.accepted.json`;
    writeImmutableJson(acceptedPath, actual);
    evidence.artifact_ref = acceptedPath;
    evidence.artifact_digest = digestFile(acceptedPath);
  }
}

function diffAuditCommand(
  planArgument        ,
  stateArgument        ,
  taskId        ,
  reservationToken        ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const payload = withStateLock(statePath, () => {
    const { plan, goal, state } = loadPlanAndState(planPath, statePath);
    assertGoalMutable(planPath, plan, goal);
    const task = plan.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) fail(`unknown task: ${taskId}`);
    if (!task.verification_ids.includes(DIFF_SCOPE_GATE_ID)) {
      fail(`task ${taskId} does not own ${DIFF_SCOPE_GATE_ID}`);
    }
    const taskState = state.tasks[taskId];
    if (taskState.status !== "running") fail(`task ${taskId} is not running`);
    if (taskState.reservation_token !== reservationToken) fail("reservation token mismatch");
    if (taskState.source_revision !== state.source_revision) fail("source revision mismatch");
    if (task.runtime_actor_id !== "diff-audit") fail("diff audit requires runtime actor diff-audit");
    const ownerState = subjectStateForTask(state, task);
    if (ownerState.status !== "running" || ownerState.current_task_id !== taskId) {
      fail(`runtime actor diff-audit is not running ${taskId}`);
    }
    const artifact = expectedDiffScopeAudit(planPath, plan, goal, state, task, taskState);
    const artifactPath = diffScopeArtifactPathFor(
      planPath,
      task.id,
      taskState.attempt,
      reservationToken,
    );
    writeJson(artifactPath, artifact);
    return {
      status: "passed",
      verification_id: DIFF_SCOPE_GATE_ID,
      task_id: task.id,
      artifact_ref: artifactPath,
      artifact_digest: digestFile(artifactPath),
      observed_changed_files: artifact.observed_changed_files,
      current_snapshot_digest: artifact.current_snapshot_digest,
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
























function coverageSemanticDigest(coverage              )         {
  return digestJson({
    source_path: coverage.source_path,
    source_digest: coverage.source_digest,
    source_revision: coverage.source_revision,
    required_plan_items: coverage.required_plan_items,
  });
}

function parseSourceCoverageClassifications(value         )                                 {
  const source = Array.isArray(value)
    ? { classifications: value }
    : requireRecord(value, "source coverage classification proposal");
  if (!Array.isArray(source.classifications)) {
    fail("source coverage classifications must be an array");
  }
  const classifications = source.classifications.map((value, index) => {
    const item = requireRecord(value, `source coverage classifications[${index}]`);
    if (item.disposition !== "mapped" && item.disposition !== "non_requirement") {
      fail(`source coverage classifications[${index}].disposition is invalid`);
    }
    const planItemIds = requireStringArray(
      item.plan_item_ids,
      `source coverage classifications[${index}].plan_item_ids`,
    ).map((id, idIndex) =>
      requireIdentifier(id, `source coverage classifications[${index}].plan_item_ids[${idIndex}]`),
    );
    ensureUnique(planItemIds, `source coverage classification ${String(item.block_id)} plan item`);
    return {
      block_id: requireIdentifier(
        item.block_id,
        `source coverage classifications[${index}].block_id`,
      ),
      disposition: item.disposition                                ,
      plan_item_ids: [...planItemIds].sort(compareStableStrings),
      reason: requireNullableString(item.reason, `source coverage classifications[${index}].reason`),
    };
  });
  ensureUnique(classifications.map((item) => item.block_id), "source coverage classified block");
  return classifications;
}

function expectedSourceCoverageAudit(
  planPath        ,
  plan      ,
  goal              ,
  coverage              ,
  state          ,
  task                ,
  taskState           ,
  proposedClassifications                                ,
)                              {
  const goalState = goalStateForPlan(planPath, plan, goal).state;
  const sourceBlocks = parseSourceBlocks(readJson(goalState.source_blocks.ref), goal);
  if (digestFile(goalState.source_blocks.ref) !== goalState.source_blocks.digest) {
    fail("source blocks digest mismatch");
  }
  const proposedByBlock = new Map(proposedClassifications.map((item) => [item.block_id, item]));
  const blockIds = new Set(sourceBlocks.blocks.map((block) => block.id));
  const unknownBlocks = proposedClassifications.filter((item) => !blockIds.has(item.block_id));
  if (unknownBlocks.length > 0) {
    fail(`source coverage classifications contain unknown blocks: ${unknownBlocks.map((item) => item.block_id).join(", ")}`);
  }
  const classifications = sourceBlocks.blocks.map((block) => {
    const proposed = proposedByBlock.get(block.id);
    if (proposed === undefined) fail(`source coverage block is omitted: ${block.id}`);
    const mappedItemIds = coverage.required_plan_items
      .filter((item) => item.source_refs.includes(block.id))
      .map((item) => item.id)
      .sort(compareStableStrings);
    if (mappedItemIds.length > 0) {
      if (
        proposed.disposition !== "mapped" || proposed.reason !== null ||
        serializedJson(proposed.plan_item_ids) !== serializedJson(mappedItemIds)
      ) fail(`source coverage mapped classification mismatch: ${block.id}`);
    } else if (
      proposed.disposition !== "non_requirement" || proposed.plan_item_ids.length > 0 ||
      proposed.reason === null
    ) {
      fail(`source coverage non-requirement classification requires a non-empty reason: ${block.id}`);
    }
    return proposed;
  });
  const coverageSummary = summarizeCoverage(plan, coverage, state);
  const uncoveredEffects = coverageSummary.uncovered_plan_item_effects            ;
  if (uncoveredEffects.length > 0) {
    fail(`source coverage audit found unplanned required effects: ${uncoveredEffects.join(", ")}`);
  }
  return {
    contract: "SOURCE_COVERAGE_AUDIT_V1",
    audit_task_id: task.id,
    runtime_actor_id: "source-audit",
    attempt: taskState.attempt,
    reservation_token: taskState.reservation_token          ,
    source_path: goal.source.path,
    source_digest: goal.source.digest,
    source_revision: goal.source.revision,
    source_blocks_ref: goalState.source_blocks.ref,
    source_blocks_digest: goalState.source_blocks.digest,
    coverage_semantic_digest: coverageSemanticDigest(coverage),
    classifications,
    omissions: [],
  };
}

function parseSourceCoverageAuditArtifact(value         )                              {
  const source = requireRecord(value, "source coverage audit artifact");
  if (source.contract !== "SOURCE_COVERAGE_AUDIT_V1") {
    fail("source coverage audit artifact contract must equal SOURCE_COVERAGE_AUDIT_V1");
  }
  const classifications = parseSourceCoverageClassifications(source.classifications);
  const omissions = requireStringArray(source.omissions, "source coverage audit omissions");
  if (omissions.length > 0) fail("source coverage audit omissions must be empty");
  const artifact                              = {
    contract: "SOURCE_COVERAGE_AUDIT_V1",
    audit_task_id: requireIdentifier(source.audit_task_id, "source coverage audit_task_id"),
    runtime_actor_id: (() => {
      if (source.runtime_actor_id !== "source-audit") {
        fail("source coverage runtime_actor_id must equal source-audit");
      }
      return "source-audit"         ;
    })(),
    attempt: requirePositiveInteger(source.attempt, "source coverage attempt"),
    reservation_token: requireString(source.reservation_token, "source coverage reservation_token"),
    source_path: requireString(source.source_path, "source coverage source_path"),
    source_digest: requireString(source.source_digest, "source coverage source_digest"),
    source_revision: requirePositiveInteger(source.source_revision, "source coverage source_revision"),
    source_blocks_ref: requireString(source.source_blocks_ref, "source coverage source_blocks_ref"),
    source_blocks_digest: requireString(
      source.source_blocks_digest,
      "source coverage source_blocks_digest",
    ),
    coverage_semantic_digest: requireString(
      source.coverage_semantic_digest,
      "source coverage coverage_semantic_digest",
    ),
    classifications,
    omissions: [],
  };
  for (const digest of [
    artifact.source_digest,
    artifact.source_blocks_digest,
    artifact.coverage_semantic_digest,
  ]) if (!/^[0-9a-f]{64}$/u.test(digest)) fail("source coverage audit digest is invalid");
  return artifact;
}

function bindSourceCoverageArtifact(
  planPath        ,
  plan      ,
  goal              ,
  coverage              ,
  state          ,
  task                ,
  taskState           ,
  result                ,
  accepted         ,
)       {
  if (!task.verification_ids.includes(SOURCE_COVERAGE_GATE_ID)) return;
  const evidence = result.evidence.find((item) => item.verification_id === SOURCE_COVERAGE_GATE_ID);
  if (evidence === undefined) fail(`${SOURCE_COVERAGE_GATE_ID} evidence is missing`);
  if (evidence.outcome !== "passed") {
    if (evidence.artifact_ref !== null || evidence.artifact_digest !== null) {
      fail(`${SOURCE_COVERAGE_GATE_ID} non-passed evidence must not bind an audit artifact`);
    }
    return;
  }
  if (evidence.artifact_ref === null || evidence.artifact_digest === null) {
    fail(`${SOURCE_COVERAGE_GATE_ID} artifact binding is missing`);
  }
  const candidatePath = sourceCoverageArtifactPathFor(
    planPath,
    task.id,
    taskState.attempt,
    taskState.reservation_token          ,
  );
  const expectedPath = accepted ? `${candidatePath}.accepted.json` : candidatePath;
  canonicalPath(expectedPath, evidence.artifact_ref, `${SOURCE_COVERAGE_GATE_ID} artifact_ref`);
  if (!existsSync(expectedPath) || digestFile(expectedPath) !== evidence.artifact_digest) {
    fail(`${SOURCE_COVERAGE_GATE_ID} artifact is missing or has a digest mismatch`);
  }
  const actual = parseSourceCoverageAuditArtifact(readJson(expectedPath));
  const expected = expectedSourceCoverageAudit(
    planPath,
    plan,
    goal,
    coverage,
    state,
    task,
    taskState,
    actual.classifications,
  );
  if (serializedJson(actual) !== serializedJson(expected)) {
    fail(`${SOURCE_COVERAGE_GATE_ID} artifact content mismatch`);
  }
  if (!accepted) {
    const acceptedPath = `${candidatePath}.accepted.json`;
    writeImmutableJson(acceptedPath, actual);
    evidence.artifact_ref = acceptedPath;
    evidence.artifact_digest = digestFile(acceptedPath);
  }
}

function sourceAuditCommand(
  planArgument        ,
  stateArgument        ,
  taskId        ,
  reservationToken        ,
  classificationsArgument        ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const payload = withStateLock(statePath, () => {
    const { plan, goal, coverage, state } = loadPlanAndState(planPath, statePath);
    assertGoalMutable(planPath, plan, goal);
    const task = plan.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) fail(`unknown task: ${taskId}`);
    if (!task.verification_ids.includes(SOURCE_COVERAGE_GATE_ID)) {
      fail(`task ${taskId} does not own ${SOURCE_COVERAGE_GATE_ID}`);
    }
    if (task.runtime_actor_id !== "source-audit") {
      fail("source coverage audit requires runtime actor source-audit");
    }
    const taskState = state.tasks[taskId];
    if (taskState.status !== "running") fail(`task ${taskId} is not running`);
    if (taskState.reservation_token !== reservationToken) fail("reservation token mismatch");
    const actorState = subjectStateForTask(state, task);
    if (actorState.status !== "running" || actorState.current_task_id !== taskId) {
      fail(`runtime actor source-audit is not running ${taskId}`);
    }
    const artifactPath = sourceCoverageArtifactPathFor(
      planPath,
      task.id,
      taskState.attempt,
      reservationToken,
    );
    let classifications                                ;
    if (classificationsArgument === "-") {
      const input = readStructuredInput("SOURCE_AUDIT_INPUT_V1");
      requireAllowedKeys(input, ["contract", "non_requirements"], "source audit input");
      const reasons = input.non_requirements === undefined
        ? {}
        : requireRecord(input.non_requirements, "source audit input.non_requirements");
      const goalState = goalStateForPlan(planPath, plan, goal).state;
      const sourceBlocks = parseSourceBlocks(readJson(goalState.source_blocks.ref), goal);
      const blockIds = new Set(sourceBlocks.blocks.map((block) => block.id));
      for (const blockId of Object.keys(reasons)) {
        if (!blockIds.has(blockId)) fail(`source audit input references unknown block: ${blockId}`);
      }
      classifications = sourceBlocks.blocks.map((block) => {
        const planItemIds = coverage.required_plan_items
          .filter((item) => item.source_refs.includes(block.id))
          .map((item) => item.id)
          .sort(compareStableStrings);
        if (planItemIds.length > 0) {
          return {
            block_id: block.id,
            disposition: "mapped"         ,
            plan_item_ids: planItemIds,
            reason: null,
          };
        }
        return {
          block_id: block.id,
          disposition: "non_requirement"         ,
          plan_item_ids: [],
          reason: requireString(reasons[block.id], `source audit input.non_requirements.${block.id}`),
        };
      });
    } else {
      const classificationPath = canonicalPath(
        artifactPath,
        classificationsArgument,
        "source coverage classification path",
      );
      classifications = parseSourceCoverageClassifications(readJson(classificationPath));
    }
    const artifact = expectedSourceCoverageAudit(
      planPath,
      plan,
      goal,
      coverage,
      state,
      task,
      taskState,
      classifications,
    );
    writeJson(artifactPath, artifact);
    return {
      status: "passed",
      verification_id: SOURCE_COVERAGE_GATE_ID,
      task_id: task.id,
      artifact_ref: artifactPath,
      artifact_digest: digestFile(artifactPath),
      classified_blocks: artifact.classifications.length,
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}











































function isSensitiveDeliveryPath(path        )          {
  const basename = path.split("/").at(-1)          ;
  return (
    /^\.env(?:\.|$)/u.test(basename) ||
    /(?:^|[-_.])(secret|credentials?|private[-_.]?key)(?:[-_.]|$)/iu.test(basename) ||
    /\.(?:pem|p12|pfx|key)$/iu.test(basename)
  );
}

function passedDiffScopeEvidence(
  plan      ,
  state          ,
)                                  {
  const task = plan.tasks.find((candidate) =>
    candidate.satisfies_goal_gates.includes(DIFF_SCOPE_GATE_ID) &&
    state.tasks[candidate.id].status !== "superseded",
  );
  if (task === undefined) fail(`live ${DIFF_SCOPE_GATE_ID} task is missing`);
  const taskState = state.tasks[task.id];
  if (
    taskState.status !== "completed" || taskState.result_ref === null ||
    taskState.result_digest === null || taskState.accepted_change_seq !== state.workspace_change_seq
  ) fail(`${DIFF_SCOPE_GATE_ID} evidence is not current for workspace_change_seq`);
  const result = parseWorkerResult(
    readJson(taskState.result_ref),
    task,
    subjectForTask(plan, task),
    taskState,
  );
  const evidence = result.evidence.find((item) =>
    item.verification_id === DIFF_SCOPE_GATE_ID && item.outcome === "passed",
  );
  if (evidence?.artifact_ref === null || evidence?.artifact_ref === undefined ||
    evidence.artifact_digest === null) fail(`${DIFF_SCOPE_GATE_ID} accepted artifact is missing`);
  return { ref: evidence.artifact_ref, digest: evidence.artifact_digest };
}

function ownerAttestationFor(
  plan      ,
  state          ,
  ownerId        ,
  changedFiles          ,
)                                                              {
  const candidates = plan.tasks
    .filter((task) => task.owner_id === ownerId && state.tasks[task.id].status === "completed")
    .reverse();
  let latestOwnerChangeSeq = 0;
  for (const task of candidates) {
    const taskState = state.tasks[task.id];
    if (taskState.result_ref === null || taskState.accepted_change_seq === null) continue;
    const result = parseWorkerResult(
      readJson(taskState.result_ref),
      task,
      subjectForTask(plan, task),
      taskState,
    );
    if (result.changed_files.length > 0) {
      latestOwnerChangeSeq = Math.max(latestOwnerChangeSeq, taskState.accepted_change_seq);
    }
  }
  for (const task of candidates) {
    const taskState = state.tasks[task.id];
    if (taskState.result_ref === null || taskState.result_digest === null) continue;
    const result = parseWorkerResult(
      readJson(taskState.result_ref),
      task,
      subjectForTask(plan, task),
      taskState,
    );
    for (const artifact of result.published_artifacts.filter((item) =>
      item.contract === "COMMIT_ATTESTATION_V1",
    )) {
      const body = requireRecord(readJson(artifact.ref), `commit attestation ${artifact.ref}`);
      const bodyChangedFiles = requireStringArray(
        body.changed_files,
        `commit attestation ${artifact.ref}.changed_files`,
      ).map(normalizePathPattern).sort(compareStableStrings);
      if (
        body.owner_id === ownerId && body.producer_task_id === task.id &&
        typeof body.workspace_change_seq === "number" &&
        Number.isInteger(body.workspace_change_seq) &&
        body.workspace_change_seq >= latestOwnerChangeSeq &&
        body.workspace_change_seq <= state.workspace_change_seq &&
        body.conclusion === "approved" &&
        serializedJson(bodyChangedFiles) === serializedJson(changedFiles)
      ) {
        const commitMessage = requireString(
          body.commit_message,
          `commit attestation ${artifact.ref}.commit_message`,
        );
        if (!/^[a-z]+(?:\([^)]+\))?!?: .+/u.test(commitMessage) || commitMessage.includes("\n")) {
          fail(`commit attestation ${artifact.ref}.commit_message must be one Conventional Commit line`);
        }
        return { artifact, commitMessage };
      }
    }
  }
  fail(
    `owner ${ownerId} has no current COMMIT_ATTESTATION_V1 after owner change sequence ` +
    `${latestOwnerChangeSeq} for files: ${changedFiles.join(", ")}`,
  );
}

function expectedCommitReadiness(
  planPath        ,
  plan      ,
  goal              ,
  state          ,
  task                ,
  taskState           ,
)                                                                  {
  if (task.runtime_actor_id !== "commit-readiness") {
    fail("commit readiness task requires runtime actor commit-readiness");
  }
  const baseline = worktreeBaselineFor(planPath, plan, goal).baseline;
  const current = captureWorktreeSnapshot(goal.workspace.root);
  if (current.tree_oid !== baseline.tree_oid) {
    fail("commit readiness requires a refresh after Git tree content changes");
  }
  const sourceRelativeRaw = relative(goal.workspace.root, goal.source.path).replaceAll("\\", "/");
  const sourceRelative = sourceRelativeRaw !== "" && sourceRelativeRaw !== ".." &&
      !sourceRelativeRaw.startsWith("../") && !isAbsolute(sourceRelativeRaw)
    ? normalizePathPattern(sourceRelativeRaw)
    : null;
  const changedFiles = changedWorktreePaths(baseline, current)
    .filter((path) => path !== sourceRelative);
  const runtimePaths = changedFiles.filter(isRuntimeWorkspacePath);
  if (runtimePaths.length > 0) fail(`runtime paths cannot be delivered: ${runtimePaths.join(", ")}`);
  const sensitiveFiles = changedFiles.filter(isSensitiveDeliveryPath);
  if (sensitiveFiles.length > 0) fail(`sensitive files require explicit removal: ${sensitiveFiles.join(", ")}`);
  const diffCheck = spawnSync("git", ["-C", goal.workspace.root, "diff", "--check"], {
    encoding: "utf8",
    shell: false,
  });
  if (diffCheck.error !== undefined || diffCheck.status !== 0) {
    const detail = diffCheck.error?.message ?? `${diffCheck.stdout}${diffCheck.stderr}`.trim();
    fail(`git diff --check failed: ${detail || `exit ${diffCheck.status}`}`);
  }
  const registry = approvedOwnerRegistry(goal);
  const filesByOwner = new Map                  ();
  const unownedFiles           = [];
  for (const path of changedFiles) {
    const matches = registry.owners.filter((owner) =>
      owner.scope_patterns.some((pattern) => pathMatchesPattern(path, pattern)) &&
      !owner.scope_excludes.some((pattern) => pathMatchesPattern(path, pattern)),
    );
    if (matches.length !== 1) {
      unownedFiles.push(path);
      continue;
    }
    filesByOwner.set(matches[0].id, [...(filesByOwner.get(matches[0].id) ?? []), path]);
  }
  if (unownedFiles.length > 0) {
    fail(`delivery contains unowned or ambiguously owned files: ${unownedFiles.join(", ")}`);
  }
  const ownerDeliveries = [...filesByOwner.entries()]
    .sort(([left], [right]) => compareStableStrings(left, right))
    .map(([ownerId, files]) => {
      const sortedFiles = [...files].sort(compareStableStrings);
      const attestation = ownerAttestationFor(plan, state, ownerId, sortedFiles);
      return {
        owner_id: ownerId,
        changed_files: sortedFiles,
        commit_message: attestation.commitMessage,
        attestation_ref: attestation.artifact.ref,
        attestation_digest: attestation.artifact.digest,
      };
    });
  const diffScope = passedDiffScopeEvidence(plan, state);
  const commitMessages = uniqueStrings(ownerDeliveries.map((item) => item.commit_message));
  if (ownerDeliveries.length > 0 && commitMessages.length !== 1) {
    fail(
      "all owner COMMIT_ATTESTATION_V1 artifacts must approve the same atomic commit_message",
    );
  }
  const delivery                     = {
    contract: "DELIVERY_MANIFEST_V1",
    goal_id: goal.goal_id,
    plan_ref: planPath,
    plan_digest: state.plan_digest,
    state_ref: statePathFor(planPath),
    owner_registry_ref: registry.ref,
    owner_registry_digest: registry.digest,
    workspace_change_seq: state.workspace_change_seq,
    git_head_oid: current.head_oid,
    changed_files: [...changedFiles].sort(compareStableStrings),
    commit_strategy: "single_atomic",
    commit_message: commitMessages[0] ?? null,
    owner_deliveries: ownerDeliveries,
    diff_scope_ref: diffScope.ref,
    diff_scope_digest: diffScope.digest,
    generated_consistency: "owner_attested",
  };
  const deliveryPath = deliveryManifestPathFor(
    planPath,
    task.id,
    taskState.attempt,
    taskState.reservation_token          ,
  );
  const audit                         = {
    contract: "COMMIT_READINESS_AUDIT_V1",
    audit_task_id: task.id,
    runtime_actor_id: "commit-readiness",
    attempt: taskState.attempt,
    reservation_token: taskState.reservation_token          ,
    workspace_change_seq: state.workspace_change_seq,
    plan_digest: state.plan_digest,
    git_diff_check: "passed",
    sensitive_files: [],
    runtime_paths: [],
    unowned_files: [],
    delivery_manifest_ref: deliveryPath,
    delivery_manifest_digest: digestJson(delivery),
    conclusion: "commit_ready",
  };
  return { audit, delivery };
}

function bindCommitReadinessArtifact(
  planPath        ,
  plan      ,
  goal              ,
  state          ,
  task                ,
  taskState           ,
  result                ,
  accepted         ,
)       {
  if (!task.verification_ids.includes(COMMIT_READINESS_GATE_ID)) return;
  const evidence = result.evidence.find((item) =>
    item.verification_id === COMMIT_READINESS_GATE_ID,
  );
  if (evidence === undefined) fail(`${COMMIT_READINESS_GATE_ID} evidence is missing`);
  if (evidence.outcome !== "passed") {
    if (evidence.artifact_ref !== null || evidence.artifact_digest !== null) {
      fail(`${COMMIT_READINESS_GATE_ID} non-passed evidence cannot bind an artifact`);
    }
    return;
  }
  if (evidence.artifact_ref === null || evidence.artifact_digest === null) {
    fail(`${COMMIT_READINESS_GATE_ID} artifact binding is missing`);
  }
  const candidatePath = commitReadinessArtifactPathFor(
    planPath,
    task.id,
    taskState.attempt,
    taskState.reservation_token          ,
  );
  const expectedPath = accepted ? `${candidatePath}.accepted.json` : candidatePath;
  canonicalPath(expectedPath, evidence.artifact_ref, `${COMMIT_READINESS_GATE_ID} artifact_ref`);
  if (!existsSync(expectedPath) || digestFile(expectedPath) !== evidence.artifact_digest) {
    fail(`${COMMIT_READINESS_GATE_ID} artifact is missing or changed`);
  }
  const expected = expectedCommitReadiness(planPath, plan, goal, state, task, taskState);
  const actual = readJson(expectedPath);
  if (serializedJson(actual) !== serializedJson(expected.audit)) {
    fail(`${COMMIT_READINESS_GATE_ID} artifact content mismatch`);
  }
  if (!existsSync(expected.audit.delivery_manifest_ref) ||
    digestFile(expected.audit.delivery_manifest_ref) !== expected.audit.delivery_manifest_digest ||
    serializedJson(readJson(expected.audit.delivery_manifest_ref)) !== serializedJson(expected.delivery)) {
    fail("delivery manifest is missing or changed");
  }
  if (!accepted) {
    const acceptedPath = `${candidatePath}.accepted.json`;
    writeImmutableJson(acceptedPath, expected.audit);
    evidence.artifact_ref = acceptedPath;
    evidence.artifact_digest = digestFile(acceptedPath);
  }
}

function commitReadinessCommand(
  planArgument        ,
  stateArgument        ,
  taskId        ,
  reservationToken        ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const payload = withStateLock(statePath, () => {
    const { plan, goal, state } = loadPlanAndState(planPath, statePath);
    assertGoalMutable(planPath, plan, goal);
    const task = plan.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) fail(`unknown task: ${taskId}`);
    if (!task.verification_ids.includes(COMMIT_READINESS_GATE_ID)) {
      fail(`task ${taskId} does not own ${COMMIT_READINESS_GATE_ID}`);
    }
    if (task.runtime_actor_id !== "commit-readiness") {
      fail("commit readiness requires runtime actor commit-readiness");
    }
    const taskState = state.tasks[task.id];
    if (taskState.status !== "running") fail(`task ${task.id} is not running`);
    if (taskState.reservation_token !== reservationToken) fail("reservation token mismatch");
    const actorState = subjectStateForTask(state, task);
    if (actorState.status !== "running" || actorState.current_task_id !== task.id) {
      fail("runtime actor commit-readiness is not running this task");
    }
    const expected = expectedCommitReadiness(planPath, plan, goal, state, task, taskState);
    writeJson(expected.audit.delivery_manifest_ref, expected.delivery);
    const artifactPath = commitReadinessArtifactPathFor(
      planPath,
      task.id,
      taskState.attempt,
      reservationToken,
    );
    writeJson(artifactPath, expected.audit);
    return {
      status: "passed",
      verification_id: COMMIT_READINESS_GATE_ID,
      task_id: task.id,
      artifact_ref: artifactPath,
      artifact_digest: digestFile(artifactPath),
      delivery_manifest_ref: expected.audit.delivery_manifest_ref,
      delivery_manifest_digest: expected.audit.delivery_manifest_digest,
      workspace_change_seq: state.workspace_change_seq,
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function deliveryValidateCommand(manifestArgument        )       {
  const manifestPath = resolve(manifestArgument);
  const candidate = requireRecord(readJson(manifestPath), "delivery manifest");
  if (candidate.contract !== "DELIVERY_MANIFEST_V1") {
    fail("delivery manifest contract must equal DELIVERY_MANIFEST_V1");
  }
  const planPath = resolve(requireString(candidate.plan_ref, "delivery manifest.plan_ref"));
  const statePath = canonicalPath(
    statePathFor(planPath),
    requireString(candidate.state_ref, "delivery manifest.state_ref"),
    "delivery manifest.state_ref",
  );
  const { plan, goal, state } = loadPlanAndState(planPath, statePath);
  const registry = approvedOwnerRegistry(goal);
  canonicalPath(
    registry.ref,
    requireString(candidate.owner_registry_ref, "delivery manifest.owner_registry_ref"),
    "delivery manifest.owner_registry_ref",
  );
  if (candidate.owner_registry_digest !== registry.digest) {
    fail("delivery manifest owner registry digest is stale");
  }
  const task = plan.tasks.find((item) =>
    item.runtime_actor_id === "commit-readiness" &&
    item.verification_ids.includes(COMMIT_READINESS_GATE_ID) &&
    state.tasks[item.id].status !== "superseded",
  );
  if (task === undefined) fail("live commit-readiness task is missing");
  const taskState = state.tasks[task.id];
  if (taskState.status !== "completed") fail("commit-readiness task is not completed");
  if (taskState.accepted_change_seq !== state.workspace_change_seq) {
    fail("delivery manifest is stale for workspace_change_seq");
  }
  const expected = expectedCommitReadiness(planPath, plan, goal, state, task, taskState).delivery;
  if (serializedJson(candidate) !== serializedJson(expected)) {
    fail("delivery manifest does not match the current worktree, Registry, attestations, or state");
  }
  process.stdout.write(`${JSON.stringify({
    status: "valid",
    delivery_manifest_ref: manifestPath,
    delivery_manifest_digest: digestFile(manifestPath),
    goal_id: expected.goal_id,
    workspace_change_seq: expected.workspace_change_seq,
    owner_deliveries: expected.owner_deliveries,
    changed_files: expected.changed_files,
  })}\n`);
}

function uniqueStrings(values          )           {
  return [...new Set(values)];
}

function interruptCapsule(
  owner                 ,
  ownerState            ,
  goalDigest        ,
  sourceRevision        ,
  risk        ,
)               {
  const capsule = loadOwnerCapsule(owner, ownerState, goalDigest, sourceRevision);
  capsule.generation = ownerState.generation;
  capsule.active_task_id = null;
  capsule.checkpoint_ref = null;
  capsule.risks = uniqueStrings([...(capsule.risks ?? []), risk]);
  capsule.updated_at = new Date().toISOString();
  return capsule;
}

function updateCapsule(
  owner                 ,
  ownerState            ,
  goalDigest        ,
  sourceRevision        ,
  result                ,
  resultRef        ,
)               {
  const capsule = loadOwnerCapsule(owner, ownerState, goalDigest, sourceRevision);
  capsule.generation = ownerState.generation;
  capsule.decisions = uniqueStrings([...(capsule.decisions ?? []), ...result.owner_updates.decisions]);
  capsule.invariants = uniqueStrings([...(capsule.invariants ?? []), ...result.owner_updates.invariants]);
  capsule.risks = uniqueStrings([...(capsule.risks ?? []), ...result.owner_updates.risks]);
  capsule.result_refs = [resultRef];
  capsule.completed_tasks = result.status === "completed" ? [result.task_id] : [];
  capsule.verification = result.evidence.map((item) => ({
    ...item,
    task_id: result.task_id,
    result_ref: resultRef,
  }));
  capsule.active_task_id = null;
  capsule.progress = result.summary;
  capsule.important_symbols = [];
  capsule.next_steps = [];
  capsule.checkpoint_ref = null;
  capsule.updated_at = new Date().toISOString();
  return capsule;
}

function finishCommand(
  planArgument        ,
  stateArgument        ,
  taskId        ,
  reservationToken        ,
  resultArgument        ,
  compact = false,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  let consumedCandidatePath                = null;
  const cleanupAfterFinish           = [];
  const payload = withStateLock(statePath, () => {
    const { plan, goal, coverage, state } = loadPlanAndState(
      planPath,
      statePath,
      { allowSourceDrift: true },
    );
    assertGoalMutable(planPath, plan, goal);
    const task = plan.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) fail(`unknown task: ${taskId}`);
    const owner = subjectForTask(plan, task);
    const taskState = state.tasks[taskId];
    const ownerState = subjectStateForTask(state, task);
    if (taskState.reservation_token !== reservationToken) fail("reservation token mismatch");
    if (taskState.result_path === null) fail("task result_path is missing");
    const resultPath = canonicalPath(taskState.result_path, resultArgument, "result path");
    const acceptedResultPath = `${resultPath}.accepted.json`;
    if (["completed", "blocked", "failed", "needs_repair"].includes(taskState.status)) {
      const acceptedResultExists = existsSync(acceptedResultPath);
      const acceptedDigestMatches = acceptedResultExists && taskState.result_digest !== null
        ? digestFile(acceptedResultPath) === taskState["result_digest"]
        : false;
      if (
        taskState.result_ref !== acceptedResultPath || taskState.result_digest === null ||
        !acceptedResultExists || !acceptedDigestMatches
      ) {
        fail(
          `accepted result mismatch for idempotent finish: ${taskId} ` +
          `(ref=${taskState.result_ref === acceptedResultPath}, ` +
          `digest=${acceptedDigestMatches})`,
        );
      }
      const acceptedResult = parseWorkerResult(
        readJson(acceptedResultPath),
        task,
        owner,
        taskState,
      );
      validateReviewResultBinding(plan, state, task, acceptedResult);
      if (acceptedResult.status !== taskState.status) fail("accepted result status mismatch");
      bindDiffScopeArtifact(
        planPath,
        plan,
        goal,
        state,
        task,
        taskState,
        acceptedResult,
        true,
      );
      bindSourceCoverageArtifact(
        planPath,
        plan,
        goal,
        coverage,
        state,
        task,
        taskState,
        acceptedResult,
        true,
      );
      bindCommitReadinessArtifact(
        planPath,
        plan,
        goal,
        state,
        task,
        taskState,
        acceptedResult,
        true,
      );
      consumedCandidatePath = resultPath;
      return {
        task_id: taskId,
        owner_id: task.owner_id,
        runtime_actor_id: task.runtime_actor_id,
        execution_subject_id: owner.id,
        owner_generation: ownerState.generation,
        executor_id: taskState.executor_id,
        status: taskState.status,
        result_ref: acceptedResultPath,
        user_message: acceptedResultUserMessage(task, acceptedResult),
        owner_reusable: isOwnerDefinition(owner),
        changed_file_count: acceptedResult.changed_files.length,
        idempotent: true,
      };
    }
    if (taskState.status !== "running") fail(`task ${taskId} is not running`);
    if (taskState.source_revision !== state.source_revision) fail("source revision mismatch");
    if (ownerState.current_task_id !== taskId || ownerState.status !== "running") {
      fail("owner is not running this task");
    }
    const result = parseWorkerResult(
      readJson(resultPath),
      task,
      owner,
      taskState,
      isOwnerDefinition(owner)
        ? persistentOwnerInterfaceDirectoryFor(
          goal.workspace.root,
          goal.goal_id,
          task.id,
        )
        : undefined,
    );
    validateReviewResultBinding(plan, state, task, result);
    if (taskState.task_baseline_ref === null || taskState.task_baseline_digest === null) {
      fail(`task ${taskId} baseline is missing`);
    }
    if (digestFile(taskState.task_baseline_ref) !== taskState.task_baseline_digest) {
      fail(`task ${taskId} baseline digest mismatch`);
    }
    const taskBaseline = parseWorktreeBaseline(
      readJson(taskState.task_baseline_ref),
      goal.workspace.root,
    );
    const currentSnapshot = captureWorktreeSnapshot(goal.workspace.root);
    if (currentSnapshot.tree_oid !== taskBaseline.tree_oid) {
      fail(`task ${taskId} observed a Git tree content change`);
    }
    const authorizedPatterns = effectiveWritablePaths(task, taskState);
    const automaticallyAttributedChanges = changedWorktreePaths(taskBaseline, currentSnapshot)
      .filter((path) => authorizedPatterns.some((pattern) => pathMatchesPattern(path, pattern)))
      .sort(compareStableStrings);
    result.changed_files = automaticallyAttributedChanges;
    bindDiffScopeArtifact(planPath, plan, goal, state, task, taskState, result, false);
    bindSourceCoverageArtifact(
      planPath,
      plan,
      goal,
      coverage,
      state,
      task,
      taskState,
      result,
      false,
    );
    bindCommitReadinessArtifact(
      planPath,
      plan,
      goal,
      state,
      task,
      taskState,
      result,
      false,
    );
    writeImmutableJson(acceptedResultPath, result);
    taskState.status = result.status;
    taskState.result_ref = acceptedResultPath;
    taskState.result_digest = digestFile(acceptedResultPath);
    if (taskState.task_baseline_ref !== null) cleanupAfterFinish.push(taskState.task_baseline_ref);
    cleanupAfterFinish.push(taskBindingSnapshotPath(dirname(planPath), task, taskState));
    if (isOwnerDefinition(owner)) cleanupAfterFinish.push(checkpointPathFor(planPath, owner.id, task.id));
    taskState.task_baseline_ref = null;
    taskState.task_baseline_digest = null;
    if (automaticallyAttributedChanges.length > 0) state.workspace_change_seq += 1;
    taskState.accepted_change_seq = state.workspace_change_seq;
    ownerState.status = "idle";
    ownerState.current_task_id = null;
    ownerState.result_refs = [acceptedResultPath];
    if (result.status === "completed") {
      ownerState.completed_task_ids = [taskId];
      if ((result.review_upgrade_reason ?? null) !== null) {
        state.review_pending = uniqueStrings([...state.review_pending, taskId]);
      }
    }
    if (isOwnerDefinition(owner)) {
      const capsule = updateCapsule(
        owner,
        ownerState,
        state.goal_digest,
        state.source_revision,
        result,
        acceptedResultPath,
      );
      updatePersistentOwnerCapsule(
        goal,
        owner,
        result,
        taskState.result_digest          ,
      );
      writeTransaction(statePath, [
        [ownerState.capsule_ref          , capsule],
        [statePath, state],
      ]);
    } else {
      writeJson(statePath, state);
    }
    releaseOwnerLease(goal, task, reservationToken);
    consumedCandidatePath = resultPath;
    return {
      task_id: taskId,
      owner_id: task.owner_id,
      runtime_actor_id: task.runtime_actor_id,
      execution_subject_id: owner.id,
      owner_generation: ownerState.generation,
      executor_id: ownerState.bound_executor_id,
      status: result.status,
      result_ref: acceptedResultPath,
      user_message: acceptedResultUserMessage(task, result),
      owner_reusable: isOwnerDefinition(owner),
      changed_files: automaticallyAttributedChanges,
      changed_file_count: automaticallyAttributedChanges.length,
      workspace_change_seq: state.workspace_change_seq,
      idempotent: false,
    };
  });
  if (consumedCandidatePath !== null) rmSync(consumedCandidatePath, { force: true });
  for (const path of cleanupAfterFinish) rmSync(path, { recursive: true, force: true });
  const receipt = payload                           ;
  process.stdout.write(`${JSON.stringify(compact ? {
    status: receipt.status,
    task_id: receipt.task_id,
    result_ref: receipt.result_ref,
    user_message: receipt.user_message,
    changed_file_count: receipt.changed_file_count,
    idempotent: receipt.idempotent,
  } : payload)}\n`);
}

function rotateOwnerCommand(
  planArgument        ,
  stateArgument        ,
  ownerId        ,
  expectedGenerationArgument        ,
  reason        ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const payload = withStateLock(statePath, () => {
    const { plan, goal, state } = loadPlanAndState(
      planPath,
      statePath,
      { allowSourceDrift: true },
    );
    assertGoalMutable(planPath, plan, goal);
    const owner = plan.owners.find((candidate) => candidate.id === ownerId);
    if (owner === undefined) fail(`unknown owner: ${ownerId}`);
    const ownerState = state.owners[ownerId];
    const expectedGeneration = requirePositiveInteger(
      Number(expectedGenerationArgument),
      "expected_generation",
    );
    if (ownerState.generation !== expectedGeneration) fail("owner generation mismatch");
    if (ownerState.status === "reserved" || ownerState.status === "running") {
      fail(`owner ${ownerId} cannot rotate while ${ownerState.status}`);
    }
    const previousExecutorId = ownerState.bound_executor_id;
    const capsule = loadOwnerCapsule(
      owner,
      ownerState,
      state.goal_digest,
      state.source_revision,
    );
    ownerState.generation += 1;
    ownerState.bound_executor_id = null;
    ownerState.status = "unbound";
    ownerState.current_task_id = null;
    capsule.generation = ownerState.generation;
    capsule.risks = uniqueStrings([
      ...requireStringArray(capsule.risks, "owner capsule.risks"),
      `executor rotated: ${requireString(reason, "reason")}`,
    ]);
    capsule.updated_at = new Date().toISOString();
    writeTransaction(statePath, [
      [ownerState.capsule_ref          , capsule],
      [statePath, state],
    ]);
    return {
      owner_id: ownerId,
      previous_executor_id: previousExecutorId,
      generation: ownerState.generation,
      capsule_ref: ownerState.capsule_ref,
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function ownerChangePauseCommand(
  planArgument        ,
  stateArgument        ,
  requestArgument        ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const requestPath = resolve(requestArgument);
  const payload = withStateLock(statePath, () => {
    const { plan, goal, state } = loadPlanAndState(planPath, statePath, {
      allowSourceDrift: true,
      allowOwnerRegistryDrift: true,
    });
    assertGoalMutable(planPath, plan, goal);
    const request = requireRecord(readJson(requestPath), "owner change request");
    if (request.contract !== "OWNER_CHANGE_REQUEST_V2") {
      fail("owner change request contract must equal OWNER_CHANGE_REQUEST_V2");
    }
    if (request.base_registry_digest !== state.owner_registry.digest) {
      fail("owner change request base Registry digest mismatch");
    }
    const requestDigest = digestFile(requestPath);
    if (state.owner_change !== null) {
      if (
        state.owner_change.request_ref !== requestPath ||
        state.owner_change.request_digest !== requestDigest
      ) fail("a different Owner change is already pending");
      return {
        status: "paused",
        request_ref: requestPath,
        request_digest: requestDigest,
        idempotent: true,
      };
    }
    state.owner_change = { request_ref: requestPath, request_digest: requestDigest };
    writeJson(statePath, state);
    return {
      status: "paused",
      request_ref: requestPath,
      request_digest: requestDigest,
      idempotent: false,
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function parseDelta(value         )



























  {
  const source = requireRecord(value, "delta");
  if (source.contract !== "DAG_DELTA_V1") fail("delta contract must equal DAG_DELTA_V1");
  if (!Array.isArray(source.add_owners)) fail("delta.add_owners must be an array");
  if (!Array.isArray(source.add_tasks)) fail("delta.add_tasks must be an array");
  if (!Array.isArray(source.repairs)) fail("delta.repairs must be an array");
  if (!Array.isArray(source.source_dispositions)) {
    fail("delta.source_dispositions must be an array");
  }
  const rawReviewUpgrades = source.review_upgrades ?? [];
  if (!Array.isArray(rawReviewUpgrades)) fail("delta.review_upgrades must be an array");
  const ownerTransition = source.owner_transition === undefined || source.owner_transition === null
    ? null
    : (() => {
      const transition = requireRecord(source.owner_transition, "delta.owner_transition");
      if (transition.contract !== "OWNER_TRANSITION_V1") {
        fail("delta.owner_transition.contract must equal OWNER_TRANSITION_V1");
      }
      if (!Array.isArray(transition.task_rebindings)) {
        fail("delta.owner_transition.task_rebindings must be an array");
      }
      const taskRebindings = transition.task_rebindings.map((value, index) => {
        const rebinding = requireRecord(
          value,
          `delta.owner_transition.task_rebindings[${index}]`,
        );
        return {
          task_id: requireIdentifier(
            rebinding.task_id,
            `delta.owner_transition.task_rebindings[${index}].task_id`,
          ),
          owner_id: requireIdentifier(
            rebinding.owner_id,
            `delta.owner_transition.task_rebindings[${index}].owner_id`,
          ),
        };
      });
      ensureUnique(taskRebindings.map((item) => item.task_id), "owner transition task id");
      return {
        contract: "OWNER_TRANSITION_V1"         ,
        base_registry_digest: requireString(
          transition.base_registry_digest,
          "delta.owner_transition.base_registry_digest",
        ),
        next_registry_digest: requireString(
          transition.next_registry_digest,
          "delta.owner_transition.next_registry_digest",
        ),
        validation_ref: requireString(
          transition.validation_ref,
          "delta.owner_transition.validation_ref",
        ),
        validation_digest: requireString(
          transition.validation_digest,
          "delta.owner_transition.validation_digest",
        ),
        approval_ref: requireString(
          transition.approval_ref,
          "delta.owner_transition.approval_ref",
        ),
        approval_digest: requireString(
          transition.approval_digest,
          "delta.owner_transition.approval_digest",
        ),
        task_rebindings: taskRebindings,
      };
    })();
  const coverageUpdate = requireRecord(source.coverage_update, "delta.coverage_update");
  if (!Array.isArray(coverageUpdate.required_plan_items) || coverageUpdate.required_plan_items.length === 0) {
    fail("delta.coverage_update.required_plan_items must be a non-empty array");
  }
  const requiredPlanItems = coverageUpdate.required_plan_items.map((value, index) => {
    const item = requireRecord(value, `delta.coverage_update.required_plan_items[${index}]`);
    const sourceRefs = requireStringArray(
      item.source_refs,
      `delta.coverage_update.required_plan_items[${index}].source_refs`,
      false,
    ).map((ref, refIndex) => requireIdentifier(
      ref,
      `delta.coverage_update.required_plan_items[${index}].source_refs[${refIndex}]`,
    ));
    const requiredEffects = requireStringArray(
      item.required_effects,
      `delta.coverage_update.required_plan_items[${index}].required_effects`,
      false,
    );
    for (const effect of requiredEffects) {
      if (effect !== "implementation" && effect !== "verification") {
        fail(`delta.coverage_update.required_plan_items[${index}].required_effects is invalid`);
      }
    }
    ensureUnique(sourceRefs, `delta coverage item ${String(item.id)} source ref`);
    ensureUnique(requiredEffects, `delta coverage item ${String(item.id)} required effect`);
    return {
      id: requireIdentifier(item.id, `delta.coverage_update.required_plan_items[${index}].id`),
      description: requireString(
        item.description,
        `delta.coverage_update.required_plan_items[${index}].description`,
      ),
      source_refs: sourceRefs,
      required_effects: requiredEffects                    ,
    };
  });
  ensureUnique(requiredPlanItems.map((item) => item.id), "delta coverage plan item id");
  const safety = requireRecord(source.safety, "delta.safety");
  if (
    safety.status !== "parallel_safe" &&
    safety.status !== "sequential_only" &&
    safety.status !== "needs_user_review"
  ) {
    fail("delta.safety.status is invalid");
  }
  return {
    base_plan_digest: requireString(source.base_plan_digest, "delta.base_plan_digest"),
    revision: requirePositiveInteger(source.revision, "delta.revision"),
    add_owners: source.add_owners.map(parseOwner),
    add_tasks: source.add_tasks.map(parseTask),
    repairs: source.repairs.map((value, index) => {
      const repair = requireRecord(value, `delta.repairs[${index}]`);
      return {
        task_id: requireIdentifier(repair.task_id, `delta.repairs[${index}].task_id`),
        replacement_task_id: requireIdentifier(
          repair.replacement_task_id,
          `delta.repairs[${index}].replacement_task_id`,
        ),
      };
    }),
    source_dispositions: source.source_dispositions.map((value, index) => {
      const disposition = requireRecord(value, `delta.source_dispositions[${index}]`);
      if (disposition.action !== "carry_forward" && disposition.action !== "invalidate") {
        fail(`delta.source_dispositions[${index}].action is invalid`);
      }
      const replacementTaskId = disposition.replacement_task_id === null
        ? null
        : requireIdentifier(
          disposition.replacement_task_id,
          `delta.source_dispositions[${index}].replacement_task_id`,
        );
      if (disposition.action === "invalidate" && replacementTaskId === null) {
        fail(`delta.source_dispositions[${index}] invalidate requires replacement_task_id`);
      }
      if (disposition.action === "carry_forward" && replacementTaskId !== null) {
        fail(`delta.source_dispositions[${index}] carry_forward requires null replacement_task_id`);
      }
      return {
        task_id: requireIdentifier(
          disposition.task_id,
          `delta.source_dispositions[${index}].task_id`,
        ),
        action: disposition.action,
        replacement_task_id: replacementTaskId,
      };
    }),
    review_upgrades: rawReviewUpgrades.map((value, index) => {
      const upgrade = requireRecord(value, `delta.review_upgrades[${index}]`);
      return {
        task_id: requireIdentifier(upgrade.task_id, `delta.review_upgrades[${index}].task_id`),
        review_task_id: requireIdentifier(
          upgrade.review_task_id,
          `delta.review_upgrades[${index}].review_task_id`,
        ),
        reason: requireString(upgrade.reason, `delta.review_upgrades[${index}].reason`),
      };
    }),
    owner_transition: ownerTransition,
    coverage_update: { required_plan_items: requiredPlanItems },
    safety: {
      status: safety.status                ,
      reasons: requireStringArray(safety.reasons, "delta.safety.reasons"),
    },
  };
}

function expandDeltaInput(
  value                         ,
  plan      ,
  state          ,
  coverage              ,
)                          {
  if (value.contract !== "DAG_DELTA_INPUT_V1") return value;
  requireAllowedKeys(value, [
    "contract",
    "tasks",
    "repairs",
    "source",
    "review",
    "owner",
    "items",
    "safety",
    "safety_reasons",
  ], "delta input");
  const rawTasks = value.tasks ?? [];
  if (!Array.isArray(rawTasks)) fail("delta input.tasks must be an array");
  const addTasks = rawTasks.map((task, index) => expandPlanInputTask(task, index));
  const rawRepairs = value.repairs ?? [];
  if (!Array.isArray(rawRepairs)) fail("delta input.repairs must be an array");
  const repairs = rawRepairs.map((entry, index) => {
    const repair = requireRecord(entry, `delta input.repairs[${index}]`);
    requireAllowedKeys(repair, ["task", "replacement"], `delta input.repairs[${index}]`);
    return {
      task_id: requireIdentifier(repair.task, `delta input.repairs[${index}].task`),
      replacement_task_id: requireIdentifier(
        repair.replacement,
        `delta input.repairs[${index}].replacement`,
      ),
    };
  });
  const rawSource = value.source ?? [];
  if (!Array.isArray(rawSource)) fail("delta input.source must be an array");
  const sourceDispositions = rawSource.map((entry, index) => {
    const disposition = requireRecord(entry, `delta input.source[${index}]`);
    requireAllowedKeys(
      disposition,
      ["task", "action", "replacement"],
      `delta input.source[${index}]`,
    );
    return {
      task_id: requireIdentifier(disposition.task, `delta input.source[${index}].task`),
      action: requireString(disposition.action, `delta input.source[${index}].action`),
      replacement_task_id: disposition.replacement === undefined || disposition.replacement === null
        ? null
        : requireIdentifier(disposition.replacement, `delta input.source[${index}].replacement`),
    };
  });
  const rawReview = value.review ?? [];
  if (!Array.isArray(rawReview)) fail("delta input.review must be an array");
  const reviewUpgrades = rawReview.map((entry, index) => {
    const review = requireRecord(entry, `delta input.review[${index}]`);
    requireAllowedKeys(review, ["task", "review_task", "reason"], `delta input.review[${index}]`);
    return {
      task_id: requireIdentifier(review.task, `delta input.review[${index}].task`),
      review_task_id: requireIdentifier(
        review.review_task,
        `delta input.review[${index}].review_task`,
      ),
      reason: requireString(review.reason, `delta input.review[${index}].reason`),
    };
  });
  let ownerTransition                                 = null;
  if (value.owner !== undefined && value.owner !== null) {
    const owner = requireRecord(value.owner, "delta input.owner");
    requireAllowedKeys(owner, ["rebind"], "delta input.owner");
    const goal = parseGoal(readJson(plan.goal_contract_path), false);
    const currentDirectory = join(
      goal.workspace.root,
      ".ghost-agent-workflow",
      "runtime",
      "owner-change",
      "current",
    );
    const validationPath = join(currentDirectory, "validation.json");
    const approvalPath = join(currentDirectory, "approval.json");
    if (!existsSync(validationPath) || !existsSync(approvalPath)) {
      fail("delta input Owner validation or approval is missing");
    }
    const validation = requireRecord(readJson(validationPath), "delta input Owner validation");
    const rebind = owner.rebind ?? [];
    if (!Array.isArray(rebind)) fail("delta input.owner.rebind must be an array");
    ownerTransition = {
      contract: "OWNER_TRANSITION_V1",
      base_registry_digest: requireString(
        validation.base_registry_digest,
        "delta input Owner validation.base_registry_digest",
      ),
      next_registry_digest: requireString(
        validation.next_registry_digest,
        "delta input Owner validation.next_registry_digest",
      ),
      validation_ref: validationPath,
      validation_digest: digestFile(validationPath),
      approval_ref: approvalPath,
      approval_digest: digestFile(approvalPath),
      task_rebindings: rebind.map((entry, index) => {
        const rebinding = requireRecord(entry, `delta input.owner.rebind[${index}]`);
        requireAllowedKeys(
          rebinding,
          ["task", "owner"],
          `delta input.owner.rebind[${index}]`,
        );
        return {
          task_id: requireIdentifier(rebinding.task, `delta input.owner.rebind[${index}].task`),
          owner_id: requireIdentifier(rebinding.owner, `delta input.owner.rebind[${index}].owner`),
        };
      }),
    };
  }
  const items = value.items === undefined
    ? coverage.required_plan_items
    : Array.isArray(value.items)
      ? value.items.map(parsePlanInputItem)
      : fail("delta input.items must be an array");
  const safetyStatus = (value.safety ?? plan.safety.status)                ;
  if (!new Set              (["parallel_safe", "sequential_only", "needs_user_review"]).has(
    safetyStatus,
  )) fail(`delta input.safety is invalid: ${String(value.safety)}`);
  return {
    contract: "DAG_DELTA_V1",
    base_plan_digest: state.plan_digest,
    revision: plan.revision + 1,
    add_owners: [],
    add_tasks: addTasks,
    repairs,
    source_dispositions: sourceDispositions,
    review_upgrades: reviewUpgrades,
    owner_transition: ownerTransition,
    coverage_update: { required_plan_items: items },
    safety: {
      status: safetyStatus,
      reasons: value.safety_reasons === undefined
        ? plan.safety.reasons
        : requireStringArray(value.safety_reasons, "delta input.safety_reasons"),
    },
  };
}

function verifiedOwnerTransition(
  transition                                                                ,
  goal              ,
  state          ,
)                                           {
  for (const [label, path, digest] of [
    ["validation", transition.validation_ref, transition.validation_digest],
    ["approval", transition.approval_ref, transition.approval_digest],
  ]         ) {
    if (!isAbsolute(path)) fail(`owner transition ${label}_ref must be absolute`);
    if (!/^[0-9a-f]{64}$/u.test(digest)) {
      fail(`owner transition ${label}_digest must be a sha256 digest`);
    }
    if (!existsSync(path) || digestFile(path) !== digest) {
      fail(`owner transition ${label} is missing or changed`);
    }
  }
  if (transition.base_registry_digest !== state.owner_registry.digest) {
    fail("owner transition base registry digest mismatch");
  }
  const registry = approvedOwnerRegistry(goal);
  if (transition.next_registry_digest !== registry.digest) {
    fail("owner transition next registry digest mismatch");
  }
  if (registry.revision <= state.owner_registry.revision) {
    fail("owner transition registry revision must advance");
  }
  const validation = requireRecord(readJson(transition.validation_ref), "owner transition validation");
  if (validation.contract !== "OWNER_CHANGE_VALIDATION_V2" || validation.status !== "passed") {
    fail("owner transition validation is not passed");
  }
  if (
    validation.base_registry_digest !== transition.base_registry_digest ||
    validation.next_registry_digest !== transition.next_registry_digest
  ) fail("owner transition validation registry digest mismatch");
  if (
    state.owner_change !== null &&
    validation.request_digest !== state.owner_change.request_digest
  ) fail("owner transition does not match the paused Owner change request");
  const nextRegistry = requireRecord(validation.next_registry, "owner transition next registry");
  if (digestJson(nextRegistry) !== registry.digest) {
    fail("owner transition validated registry does not match the applied registry");
  }
  const approval = requireRecord(readJson(transition.approval_ref), "owner transition approval");
  if (
    approval.contract !== "OWNER_CHANGE_APPROVAL_V2" ||
    approval.decision !== "approved" || approval.approved_by !== "user"
  ) fail("owner transition requires explicit user approval");
  if (
    approval.validation_digest !== transition.validation_digest ||
    approval.next_registry_digest !== transition.next_registry_digest ||
    approval.request_digest !== validation.request_digest
  ) fail("owner transition approval digest mismatch");
  return registry;
}

function ownerDefinitionFromApproved(owner                       )                  {
  return {
    id: owner.id,
    role: "work",
    responsibility: owner.responsibility,
    writable_paths: owner.scope_patterns,
    excluded_paths: owner.scope_excludes,
    worker_context: owner.worker_context,
    reuse_policy: "owner_affinity",
  };
}

function applyDeltaCommand(
  planArgument        ,
  stateArgument        ,
  deltaArgument        ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const obsoleteResultRefs           = [];
  const payload = withStateLock(statePath, () => {
    const deltaInput = deltaArgument === "-"
      ? readStructuredInput("-")
      : requireRecord(readJson(resolve(deltaArgument)), "delta input");
    const hasOwnerTransition = deltaInput.contract === "DAG_DELTA_INPUT_V1"
      ? deltaInput.owner !== undefined && deltaInput.owner !== null
      : deltaInput.owner_transition !== undefined && deltaInput.owner_transition !== null;
    const { plan, goal, coverage, state } = loadPlanAndState(planPath, statePath, {
      allowOwnerRegistryDrift: hasOwnerTransition,
    });
    const delta = parseDelta(expandDeltaInput(deltaInput, plan, state, coverage));
    assertGoalMutable(planPath, plan, goal);
    if (state.owner_change !== null && delta.owner_transition === null) {
      fail("paused Owner change requires an owner transition delta");
    }
    if (delta.base_plan_digest !== state.plan_digest) fail("delta base_plan_digest mismatch");
    if (delta.revision !== plan.revision + 1) fail("delta revision must increment plan revision by one");
    const transitionRegistry = delta.owner_transition === null
      ? null
      : verifiedOwnerTransition(delta.owner_transition, goal, state);
    if (transitionRegistry !== null && delta.add_owners.length > 0) {
      fail("owner transition derives owners from the approved registry; add_owners must be empty");
    }
    if (!state.goal_refresh_pending) {
      const startedDiffAudits = plan.tasks.filter((task) =>
        task.satisfies_goal_gates.includes(DIFF_SCOPE_GATE_ID) &&
        ["reserved", "running", "completed"].includes(state.tasks[task.id].status),
      );
      if (startedDiffAudits.length > 0) {
        fail(`delta cannot change the plan after ${DIFF_SCOPE_GATE_ID} begins: ${startedDiffAudits.map((task) => task.id).join(", ")}`);
      }
    }
    if (
      !state.goal_refresh_pending &&
      serializedJson(delta.coverage_update.required_plan_items) !==
        serializedJson(coverage.required_plan_items)
    ) {
      fail("non-refresh delta cannot change required_plan_items");
    }
    ensureUnique(delta.add_owners.map((owner) => owner.id), "delta owner id");
    ensureUnique(delta.add_tasks.map((task) => task.id), "delta task id");
    const existingOwnerIds = new Set(plan.owners.map((owner) => owner.id));
    const existingTaskIds = new Set(plan.tasks.map((task) => task.id));
    for (const owner of delta.add_owners) {
      if (existingOwnerIds.has(owner.id)) fail(`delta owner already exists: ${owner.id}`);
    }
    for (const task of delta.add_tasks) {
      if (existingTaskIds.has(task.id)) fail(`delta task already exists: ${task.id}`);
    }
    const transitionOwnerById = new Map(
      (transitionRegistry?.owners ?? []).map((owner) => [owner.id, owner]),
    );
    const rebindingByTaskId = new Map(
      (delta.owner_transition?.task_rebindings ?? []).map((item) => [item.task_id, item.owner_id]),
    );
    for (const [taskId, ownerId] of rebindingByTaskId) {
      const task = plan.tasks.find((candidate) => candidate.id === taskId);
      if (task === undefined) fail(`owner transition rebinds unknown task: ${taskId}`);
      if (task.owner_id === null) {
        fail(`owner transition can only rebind Owner tasks: ${taskId}`);
      }
      if (state.tasks[taskId].status !== "pending") {
        fail(`owner transition can only rebind pending tasks: ${taskId}`);
      }
      const approved = transitionOwnerById.get(ownerId);
      if (approved === undefined) fail(`owner transition target is not active: ${ownerId}`);
      if (task.role === "work") {
        const owner = ownerDefinitionFromApproved(approved);
        for (const path of effectiveWritablePaths(task, state.tasks[taskId])) {
          if (!ownerAllowsPath(owner, path)) {
            fail(`owner transition target ${ownerId} does not cover task ${taskId} path: ${path}`);
          }
        }
      }
    }
    const newTaskIds = new Set(delta.add_tasks.map((task) => task.id));
    ensureUnique(delta.review_upgrades.map((upgrade) => upgrade.task_id), "Review upgrade task id");
    ensureUnique(
      delta.review_upgrades.map((upgrade) => upgrade.review_task_id),
      "Review upgrade Review task id",
    );
    if (state.goal_refresh_pending && delta.review_upgrades.length > 0) {
      fail("Review upgrades must wait until source refresh is reconciled");
    }
    const reviewUpgradeByTaskId = new Map(
      delta.review_upgrades.map((upgrade) => [upgrade.task_id, upgrade]),
    );
    for (const upgrade of delta.review_upgrades) {
      const subject = plan.tasks.find((task) => task.id === upgrade.task_id);
      const reviewTask = delta.add_tasks.find((task) => task.id === upgrade.review_task_id);
      if (subject === undefined || subject.role !== "work") {
        fail(`Review upgrade subject must be an existing work task: ${upgrade.task_id}`);
      }
      if (!state.review_pending.includes(subject.id) || state.tasks[subject.id].status !== "completed") {
        fail(`Review upgrade subject is not awaiting Review: ${subject.id}`);
      }
      if (
        reviewTask === undefined || reviewTask.role !== "review" ||
        reviewTask.owner_id !== subject.owner_id || reviewTask.parent_task_id !== subject.parent_task_id ||
        !reviewTask.depends_on.includes(subject.id) ||
        !reviewTask.reviews_task_ids.includes(subject.id)
      ) fail(`Review upgrade requires a same-boundary Review node: ${upgrade.review_task_id}`);
    }
    ensureUnique(delta.repairs.map((repair) => repair.task_id), "delta repair task id");
    ensureUnique(
      delta.source_dispositions.map((disposition) => disposition.task_id),
      "delta source disposition task id",
    );
    const disposedIds = new Set(delta.source_dispositions.map((item) => item.task_id));
    if (delta.repairs.some((repair) => disposedIds.has(repair.task_id))) {
      fail("delta task cannot appear in both repairs and source_dispositions");
    }
    if (state.goal_refresh_pending) {
      const expected = plan.tasks
        .filter((task) => state.tasks[task.id].status !== "superseded")
        .map((task) => task.id)
        .sort(compareStableStrings);
      const actual = delta.source_dispositions
        .map((item) => item.task_id)
        .sort(compareStableStrings);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        fail("goal refresh delta must explicitly disposition every live task");
      }
    } else if (delta.source_dispositions.length > 0) {
      fail("source_dispositions require goal_refresh_pending");
    }
    for (const repair of delta.repairs) {
      const failedState = state.tasks[repair.task_id];
      if (failedState === undefined) fail(`delta repairs unknown task: ${repair.task_id}`);
      if (!["blocked", "failed", "needs_repair"].includes(failedState.status)) {
        fail(`delta can only repair a terminal failed task: ${repair.task_id}`);
      }
      if (!newTaskIds.has(repair.replacement_task_id)) {
        fail(`delta replacement must be an added task: ${repair.replacement_task_id}`);
      }
    }
    for (const disposition of delta.source_dispositions) {
      const taskState = state.tasks[disposition.task_id];
      if (taskState === undefined || taskState.status === "superseded") {
        fail(`delta source disposition references non-live task: ${disposition.task_id}`);
      }
      if (taskState.status === "reserved" || taskState.status === "running") {
        fail(`delta cannot disposition active task: ${disposition.task_id}`);
      }
      if (
        disposition.action === "invalidate" &&
        !newTaskIds.has(disposition.replacement_task_id          )
      ) {
        fail(`delta invalidation replacement must be an added task: ${disposition.replacement_task_id}`);
      }
      const dispositionTask = plan.tasks.find(
        (candidate) => candidate.id === disposition.task_id,
      )                  ;
      if (
        state.goal_refresh_pending &&
        (
          dispositionTask.satisfies_goal_gates.includes(SOURCE_COVERAGE_GATE_ID) ||
          dispositionTask.satisfies_goal_gates.includes(DIFF_SCOPE_GATE_ID) ||
          dispositionTask.satisfies_goal_gates.includes(COMMIT_READINESS_GATE_ID)
        ) &&
        disposition.action !== "invalidate"
      ) fail("fixed audit evidence must be invalidated on source refresh");
      if (state.goal_refresh_pending && disposition.action === "invalidate") {
        for (const fixedGate of [
          SOURCE_COVERAGE_GATE_ID,
          DIFF_SCOPE_GATE_ID,
          COMMIT_READINESS_GATE_ID,
        ]) {
          if (!dispositionTask.satisfies_goal_gates.includes(fixedGate)) continue;
          const replacement = delta.add_tasks.find(
            (candidate) => candidate.id === disposition.replacement_task_id,
          );
          if (replacement === undefined || !replacement.satisfies_goal_gates.includes(fixedGate)) {
            fail(`fixed audit replacement must satisfy ${fixedGate}`);
          }
        }
      }
    }
    const sourceDispositionByTaskId = new Map(
      delta.source_dispositions.map((item) => [item.task_id, item]),
    );
    for (const review of plan.tasks.filter((task) => task.role === "review")) {
      const reviewedInvalidated = review.reviews_task_ids.some(
        (taskId) => sourceDispositionByTaskId.get(taskId)?.action === "invalidate",
      );
      if (!reviewedInvalidated) continue;
      if (sourceDispositionByTaskId.get(review.id)?.action !== "invalidate") {
        fail(`review task ${review.id} must be invalidated with its reviewed result`);
      }
    }
    const repairReplacementByTaskId = new Map(
      delta.repairs.map((repair) => [repair.task_id, repair.replacement_task_id]),
    );
    const transitionedTasks = plan.tasks.map((task) => {
      const ownerId = rebindingByTaskId.get(task.id);
      let transitioned = ownerId === undefined ? task : { ...task, owner_id: ownerId };
      const reviewUpgrade = reviewUpgradeByTaskId.get(task.id);
      if (reviewUpgrade !== undefined) {
        transitioned = {
          ...transitioned,
          review_policy: "immediate",
          review_batch_key: reviewUpgrade.review_task_id,
          review_blocks_dependents: true,
          review_reasons: uniqueStrings([...transitioned.review_reasons, reviewUpgrade.reason]),
        };
      }
      if (transitioned.depends_on.some((dependencyId) => reviewUpgradeByTaskId.has(dependencyId))) {
        transitioned = {
          ...transitioned,
          depends_on: transitioned.depends_on.map((dependencyId) =>
            reviewUpgradeByTaskId.get(dependencyId)?.review_task_id ?? dependencyId
          ),
        };
      }
      if (transitioned.role === "review") {
        const replacements = transitioned.reviews_task_ids
          .map((reviewedId) => repairReplacementByTaskId.get(reviewedId))
          .filter((replacementId)                          => replacementId !== undefined);
        if (replacements.length > 0) {
          if (state.tasks[transitioned.id].status !== "pending") {
            fail(`review task ${transitioned.id} must be replaced after its reviewed result changes`);
          }
          transitioned = {
            ...transitioned,
            depends_on: uniqueStrings([...transitioned.depends_on, ...replacements]),
            reviews_task_ids: uniqueStrings(transitioned.reviews_task_ids.map(
              (reviewedId) => repairReplacementByTaskId.get(reviewedId) ?? reviewedId,
            )),
          };
        }
      }
      return transitioned;
    });
    const transitionedOwners = transitionRegistry === null
      ? [...plan.owners, ...delta.add_owners]
      : (() => {
        const activeById = new Map(
          transitionRegistry.owners.map((owner) => [owner.id, ownerDefinitionFromApproved(owner)]),
        );
        const owners = plan.owners.map((owner) => activeById.get(owner.id) ?? owner);
        const ownerIds = new Set(owners.map((owner) => owner.id));
        const referencedOwnerIds = new Set([...transitionedTasks, ...delta.add_tasks]
          .map((task) => task.owner_id)
          .filter((value)                  => value !== null));
        for (const ownerId of referencedOwnerIds) {
          if (ownerIds.has(ownerId)) continue;
          const owner = activeById.get(ownerId);
          if (owner === undefined) fail(`task references inactive owner after transition: ${ownerId}`);
          owners.push(owner);
          ownerIds.add(ownerId);
        }
        return owners;
      })();
    const transitionedAddedTasks = delta.add_tasks.map((task) => {
      const isUpgradeReview = delta.review_upgrades.some(
        (upgrade) => upgrade.review_task_id === task.id,
      );
      if (isUpgradeReview) return task;
      return {
        ...task,
        depends_on: task.depends_on.map((dependencyId) =>
          reviewUpgradeByTaskId.get(dependencyId)?.review_task_id ?? dependencyId
        ),
      };
    });
    const nextPlan       = {
      ...plan,
      revision: delta.revision,
      owners: transitionedOwners,
      tasks: [...transitionedTasks, ...transitionedAddedTasks],
      safety: delta.safety,
    };
    const nextCoverage               = {
      ...coverage,
      source_path: goal.source.path,
      source_digest: goal.source.digest,
      source_revision: goal.source.revision,
      plan_revision: nextPlan.revision,
      plan_digest: digestJson(nextPlan),
      required_plan_items: delta.coverage_update.required_plan_items,
    };
    const supersededAfterDelta = new Set(plan.tasks
      .filter((task) => state.tasks[task.id].status === "superseded")
      .map((task) => task.id));
    for (const repair of delta.repairs) supersededAfterDelta.add(repair.task_id);
    for (const disposition of delta.source_dispositions) {
      if (disposition.action === "invalidate") supersededAfterDelta.add(disposition.task_id);
    }
    const nextLiveTaskIds = new Set(nextPlan.tasks
      .filter((task) => !supersededAfterDelta.has(task.id))
      .map((task) => task.id));
    const nextOwnerValidationTaskIds = new Set(nextPlan.tasks
      .filter((task) => {
        if (!nextLiveTaskIds.has(task.id) || task.owner_id === null) return false;
        const taskState = state.tasks[task.id];
        return taskState === undefined || taskState.status !== "completed";
      })
      .map((task) => task.id));
    const ancestors = validateGraph(
      nextPlan,
      goal,
      false,
      nextLiveTaskIds,
      nextOwnerValidationTaskIds,
    );
    const coverageIds = new Set(nextCoverage.required_plan_items.map((item) => item.id));
    const sourceBlocks = parseSourceBlocks(
      readJson(goalStateForPlan(planPath, plan, goal).state.source_blocks.ref),
      goal,
    );
    const sourceBlockIds = new Set(sourceBlocks.blocks.map((block) => block.id));
    for (const item of nextCoverage.required_plan_items) {
      for (const sourceRef of item.source_refs) {
        if (!sourceBlockIds.has(sourceRef)) {
          fail(`coverage item ${item.id} references unknown source block: ${sourceRef}`);
        }
      }
    }
    for (const task of nextPlan.tasks.filter((candidate) => nextLiveTaskIds.has(candidate.id))) {
      for (const itemId of task.plan_item_ids) {
        if (!coverageIds.has(itemId)) fail(`task ${task.id} references unknown plan item: ${itemId}`);
      }
    }
    for (const repair of delta.repairs) {
      if (ancestors.get(repair.replacement_task_id)?.has(repair.task_id)) {
        fail(`delta replacement cannot depend on repaired task: ${repair.replacement_task_id}`);
      }
    }
    for (const disposition of delta.source_dispositions) {
      if (
        disposition.action === "invalidate" &&
        ancestors.get(disposition.replacement_task_id          )?.has(disposition.task_id)
      ) {
        fail(`delta replacement cannot depend on invalidated task: ${disposition.replacement_task_id}`);
      }
    }
    const writes                           = [];
    const capsuleWrites = new Map                      ();
    if (transitionRegistry !== null) {
      const approvedById = new Map(transitionRegistry.owners.map((owner) => [owner.id, owner]));
      const oldOwnerById = new Map(plan.owners.map((owner) => [owner.id, owner]));
      for (const owner of nextPlan.owners) {
        const approved = approvedById.get(owner.id);
        if (approved === undefined) continue;
        const existingState = state.owners[owner.id];
        const capsuleRef = existingState?.capsule_ref ?? capsulePathFor(planPath, owner.id);
        if (existingState === undefined) {
          state.owners[owner.id] = {
            generation: approved.generation,
            bound_executor_id: null,
            status: "unbound",
            current_task_id: null,
            capsule_ref: capsuleRef,
            completed_task_ids: [],
            result_refs: [],
          };
          capsuleWrites.set(
            capsuleRef,
            newCapsule(owner, state.goal_digest, state.source_revision, approved.generation),
          );
          continue;
        }
        if (existingState.current_task_id !== null || existingState.status === "reserved" ||
          existingState.status === "running") {
          fail(`owner transition cannot migrate active owner: ${owner.id}`);
        }
        const oldOwner = oldOwnerById.get(owner.id);
        const oldCapsule = oldOwner === undefined
          ? null
          : loadOwnerCapsule(
            oldOwner,
            existingState,
            state.goal_digest,
            state.source_revision,
          );
        existingState.generation = approved.generation;
        existingState.bound_executor_id = null;
        existingState.status = "unbound";
        existingState.current_task_id = null;
        const nextCapsule = oldCapsule ?? newCapsule(
          owner,
          state.goal_digest,
          state.source_revision,
          approved.generation,
        );
        nextCapsule.generation = approved.generation;
        nextCapsule.scope = owner.writable_paths;
        nextCapsule.scope_excludes = owner.excluded_paths;
        nextCapsule.responsibility = owner.responsibility;
        nextCapsule.worker_context = owner.worker_context;
        nextCapsule.active_task_id = null;
        nextCapsule.updated_at = new Date().toISOString();
        capsuleWrites.set(capsuleRef, nextCapsule);
      }
      state.owner_registry = {
        ref: transitionRegistry.ref,
        digest: transitionRegistry.digest,
        revision: transitionRegistry.revision,
      };
      state.owner_change = null;
    }
    for (const owner of delta.add_owners) {
      const capsuleRef = capsulePathFor(planPath, owner.id);
      capsuleWrites.set(
        capsuleRef,
        newCapsule(owner, plan.goal_digest, state.source_revision),
      );
      state.owners[owner.id] = {
        generation: 1,
        bound_executor_id: null,
        status: "unbound",
        current_task_id: null,
        capsule_ref: capsuleRef,
        completed_task_ids: [],
        result_refs: [],
      };
    }
    for (const task of delta.add_tasks) {
      state.tasks[task.id] = {
        status: "pending",
        attempt: 0,
        reservation_token: null,
        owner_generation: null,
        executor_id: null,
        source_revision: state.source_revision,
        validated_source_revision: state.source_revision,
        reserved_at: null,
        result_path: null,
        result_ref: null,
        result_digest: null,
        replacement_task_id: null,
        last_reclaimed_token: null,
        task_baseline_ref: null,
        task_baseline_digest: null,
        expanded_writable_paths: [],
        accepted_change_seq: null,
      };
      if (task.role === "review") {
        state.reviewers[taskSubjectId(task)] = {
          generation: 1,
          bound_executor_id: null,
          status: "unbound",
          current_task_id: null,
          capsule_ref: null,
          completed_task_ids: [],
          result_refs: [],
        };
      }
    }
    for (const repair of delta.repairs) {
      const repairedTask = plan.tasks.find((task) => task.id === repair.task_id)                  ;
      const repairedState = state.tasks[repair.task_id];
      const previousResultRef = repairedState.result_ref;
      repairedState.status = "superseded";
      repairedState.replacement_task_id = repair.replacement_task_id;
      repairedState.result_ref = null;
      repairedState.result_digest = null;
      const repairedSubjectState = subjectStateForTask(state, repairedTask);
      repairedSubjectState.completed_task_ids = repairedSubjectState.completed_task_ids
        .filter((taskId) => taskId !== repair.task_id);
      if (previousResultRef !== null) {
        obsoleteResultRefs.push(previousResultRef);
        repairedSubjectState.result_refs = repairedSubjectState.result_refs
          .filter((ref) => ref !== previousResultRef);
      }
      const repairedSubject = subjectForTask(plan, repairedTask);
      if (isOwnerDefinition(repairedSubject)) {
        const capsule = capsuleWrites.get(repairedSubjectState.capsule_ref          ) ??
          loadOwnerCapsule(
            repairedSubject,
            repairedSubjectState,
            state.goal_digest,
            state.source_revision,
          );
        capsule.completed_tasks = capsule.completed_tasks
          .filter((taskId) => taskId !== repair.task_id);
        if (previousResultRef !== null) {
          capsule.result_refs = capsule.result_refs.filter((ref) => ref !== previousResultRef);
          capsule.verification = capsule.verification.filter(
            (item) => item.result_ref !== previousResultRef,
          );
        }
        capsule.updated_at = new Date().toISOString();
        capsuleWrites.set(repairedSubjectState.capsule_ref          , capsule);
      }
    }
    for (const disposition of delta.source_dispositions) {
      const taskState = state.tasks[disposition.task_id];
      if (disposition.action === "invalidate") {
        const oldResultRef = taskState.result_ref;
        taskState.status = "superseded";
        taskState.replacement_task_id = disposition.replacement_task_id;
        taskState.result_ref = null;
        taskState.result_digest = null;
        if (oldResultRef !== null) obsoleteResultRefs.push(oldResultRef);
        const task = nextPlan.tasks.find((candidate) => candidate.id === disposition.task_id)                  ;
        const subject = subjectForTask(nextPlan, task);
        const ownerState = subjectStateForTask(state, task);
        ownerState.completed_task_ids = ownerState.completed_task_ids
          .filter((completedTaskId) => completedTaskId !== disposition.task_id);
        if (oldResultRef !== null) {
          ownerState.result_refs = ownerState.result_refs.filter((ref) => ref !== oldResultRef);
        }
        if (!isOwnerDefinition(subject)) continue;
        const capsule = capsuleWrites.get(ownerState.capsule_ref          ) ?? loadOwnerCapsule(
          subject,
          ownerState,
          state.goal_digest,
          state.source_revision,
        );
        capsule.completed_tasks = capsule.completed_tasks
          .filter((completedTaskId) => completedTaskId !== disposition.task_id);
        if (oldResultRef !== null) {
          capsule.result_refs = capsule.result_refs.filter((ref) => ref !== oldResultRef);
        }
        capsule.verification = capsule.verification.filter(
          (evidence) => evidence.task_id !== disposition.task_id,
        );
        if (capsule.active_task_id === disposition.task_id) capsule.active_task_id = null;
        capsule.checkpoint_ref = null;
        capsule.risks = uniqueStrings([
          ...capsule.risks,
          `source revision ${state.source_revision} invalidated task ${disposition.task_id} evidence`,
        ]);
        capsule.updated_at = new Date().toISOString();
        capsuleWrites.set(ownerState.capsule_ref          , capsule);
      } else {
        taskState.validated_source_revision = state.source_revision;
        if (taskState.status === "pending") taskState.source_revision = state.source_revision;
      }
    }
    const canonicalPlanDigest = digestJson(nextPlan);
    nextCoverage.plan_digest = canonicalPlanDigest;
    state.plan_digest = canonicalPlanDigest;
    state.revision = nextPlan.revision;
    state.goal_refresh_pending = false;
    state.review_pending = state.review_pending.filter(
      (taskId) => !reviewUpgradeByTaskId.has(taskId) && state.tasks[taskId]?.status !== "superseded",
    );
    const liveSourceAudits = new Set(nextPlan.tasks
      .filter((task) =>
        state.tasks[task.id].status !== "superseded" &&
        task.satisfies_goal_gates.includes(SOURCE_COVERAGE_GATE_ID),
      )
      .map((task) => task.id));
    const logicalAncestorCache = new Map                     ();
    for (const task of nextPlan.tasks.filter((candidate) =>
      candidate.role === "work" && state.tasks[candidate.id].status !== "superseded" &&
      state.tasks[candidate.id].status !== "completed",
    )) {
      if (![...logicalAncestorsFor(
        task.id,
        nextPlan,
        state,
        logicalAncestorCache,
      )].some((id) => liveSourceAudits.has(id))) {
        fail(`live work task ${task.id} must depend on current ${SOURCE_COVERAGE_GATE_ID}`);
      }
    }
    validateLiveDiffBarriers(nextPlan, state);
    writes.push(
      ...capsuleWrites.entries(),
      [planPath, nextPlan],
      [nextPlan.coverage_path, nextCoverage],
      [statePath, state],
    );
    writeTransaction(statePath, writes);
    if (transitionRegistry !== null) {
      rmSync(currentOwnerChangeDirectory(goal.workspace.root), { recursive: true, force: true });
    }
    return {
      status: "applied",
      revision: nextPlan.revision,
      added_owners: delta.add_owners.map((owner) => owner.id),
      added_tasks: delta.add_tasks.map((task) => task.id),
      repaired_tasks: delta.repairs,
      review_upgrades: delta.review_upgrades,
      source_dispositions: delta.source_dispositions,
      owner_transition: delta.owner_transition === null ? null : {
        registry_revision: state.owner_registry.revision,
        registry_digest: state.owner_registry.digest,
        task_rebindings: delta.owner_transition.task_rebindings,
      },
      unrelated_running_tasks: nextPlan.tasks
        .filter((task) => state.tasks[task.id].status === "running")
        .map((task) => task.id),
    };
  });
  for (const path of uniqueStrings(obsoleteResultRefs)) rmSync(path, { force: true });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function summarizeState(state          )                         {
  const statuses               = [
    "pending", "reserved", "running", "completed", "blocked", "failed", "needs_repair", "superseded",
  ];
  return Object.fromEntries(statuses.map((status) => [
    status,
    Object.values(state.tasks).filter((task) => task.status === status).length,
  ]));
}

function summarizeCoverage(
  plan      ,
  coverage              ,
  state          ,
)                          {
  const requiredIds = coverage.required_plan_items.map((item) => item.id);
  const liveTasks = plan.tasks.filter((task) => state.tasks[task.id].status !== "superseded");
  const requiredPairs = coverage.required_plan_items.flatMap((item) =>
    item.required_effects.map((effect) => `${item.id}:${effect}`),
  );
  const plannedPairs = new Set(liveTasks.flatMap((task) =>
    task.plan_item_ids.map((itemId) => `${itemId}:${task.coverage_effect}`),
  ));
  const completedPairs = new Set(
    liveTasks
      .filter((task) =>
        state.tasks[task.id].status === "completed" &&
        state.tasks[task.id].validated_source_revision === state.source_revision &&
        state.tasks[task.id].result_ref !== null && state.tasks[task.id].result_digest !== null,
      )
      .flatMap((task) =>
        task.plan_item_ids.map((itemId) => `${itemId}:${task.coverage_effect}`),
      ),
  );
  const planned = requiredPairs.filter((pair) => plannedPairs.has(pair));
  const completed = requiredPairs.filter((pair) => completedPairs.has(pair));
  const missingPlanned = requiredPairs.filter((pair) => !plannedPairs.has(pair));
  const missingCompleted = requiredPairs.filter((pair) => !completedPairs.has(pair));
  const missingIds = (pairs          ) => uniqueStrings(pairs.map((pair) => pair.split(":", 1)[0]));
  const percent = (count        ) => Number(((count / requiredPairs.length) * 100).toFixed(2));
  return {
    contract: coverage.contract,
    source_revision: coverage.source_revision,
    required: requiredIds.length,
    required_effects: requiredPairs.length,
    planned: planned.length,
    completed: completed.length,
    percent: percent(planned.length),
    completed_percent: percent(completed.length),
    uncovered_plan_item_effects: missingPlanned,
    incomplete_plan_item_effects: missingCompleted,
    uncovered_plan_item_ids: missingIds(missingPlanned),
    incomplete_plan_item_ids: missingIds(missingCompleted),
  };
}

function inspectCompletion(
  planPath        ,
  plan      ,
  goal              ,
  coverage              ,
  state          ,
)                                                                        {
  const problems           = [];
  const resultRefs           = [];
  const passedGates = new Set        ();
  for (const task of plan.tasks) {
    const taskState = state.tasks[task.id];
    if (taskState.status === "superseded") continue;
    if (taskState.status !== "completed") continue;
    if (taskState.validated_source_revision !== state.source_revision) {
      problems.push(`${task.id}: evidence is not validated for source revision ${state.source_revision}`);
      continue;
    }
    if (taskState.result_ref === null || taskState.result_digest === null) {
      problems.push(`${task.id}: accepted result is missing`);
      continue;
    }
    if (!existsSync(taskState.result_ref) || digestFile(taskState.result_ref) !== taskState.result_digest) {
      problems.push(`${task.id}: result digest mismatch`);
      continue;
    }
    const owner = subjectForTask(plan, task);
    try {
      const result = parseWorkerResult(readJson(taskState.result_ref), task, owner, taskState);
      bindDiffScopeArtifact(planPath, plan, goal, state, task, taskState, result, true);
      bindSourceCoverageArtifact(
        planPath,
        plan,
        goal,
        coverage,
        state,
        task,
        taskState,
        result,
        true,
      );
      bindCommitReadinessArtifact(
        planPath,
        plan,
        goal,
        state,
        task,
        taskState,
        result,
        true,
      );
      if (result.status !== "completed") problems.push(`${task.id}: result status is not completed`);
      if (result.diff_self_check !== "pass") problems.push(`${task.id}: diff self-check failed`);
      for (const finding of result.blocking_findings) {
        problems.push(`${task.id}: blocking finding: ${finding}`);
      }
      resultRefs.push(taskState.result_ref);
      for (const evidence of result.evidence) {
        if (
          evidence.outcome === "passed" &&
          task.satisfies_goal_gates.includes(evidence.verification_id) &&
          (
            evidence.verification_id === SOURCE_COVERAGE_GATE_ID ||
            taskState.accepted_change_seq === state.workspace_change_seq
          )
        ) {
          passedGates.add(evidence.verification_id);
        }
      }
    } catch (error) {
      problems.push(`${task.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const gate of goal.verification_gates) {
    if (gate.required && !passedGates.has(gate.id)) {
      problems.push(`required goal gate is not passed: ${gate.id}`);
    }
  }
  return { problems, result_refs: resultRefs, passed_gates: [...passedGates] };
}

function activeReservationRecords(
  planPath        ,
  plan      ,
  goal              ,
  state          ,
)                            {
  return plan.tasks
    .filter((task) => ["reserved", "running"].includes(state.tasks[task.id].status))
    .map((task) => {
      const taskState = state.tasks[task.id];
      const ownerState = subjectStateForTask(state, task);
      if (task.owner_id === null) {
        return {
          action: "run_script",
          phase: taskState.status === "running" ? "running_script" : "reserved_script",
          task_id: task.id,
          runtime_actor_id: task.runtime_actor_id,
          status: taskState.status,
          reservation_token: taskState.reservation_token,
          result_path: taskState.result_path,
          command: `runtime-execute ${JSON.stringify(planPath)} ${JSON.stringify(statePathFor(planPath))} ${task.id} ${taskState.reservation_token}`,
        };
      }
      const binding = taskBinding(planPath, plan, goal, state, task);
      const action = taskState.status === "running"
        ? "wait_or_redeliver"
        : ownerState.bound_executor_id === null
          ? "create_thread"
          : "reuse_thread";
      return {
        action,
        phase: taskState.status === "running" ? "running_bound" : "reserved_unbound",
        task_id: task.id,
        owner_id: task.owner_id,
        runtime_actor_id: task.runtime_actor_id,
        execution_subject_id: taskSubjectId(task),
        status: taskState.status,
        reservation_token: taskState.reservation_token,
        result_path: taskState.result_path,
        executor_id: taskState.status === "running"
          ? taskState.executor_id
          : ownerState.bound_executor_id,
        attempt: taskState.attempt,
        source_revision: taskState.source_revision,
        reserved_at: taskState.reserved_at,
        thread_key: threadKey(
          planPath,
          plan,
          goal,
          task,
          subjectForTask(plan, task),
          ownerState,
          taskState,
        ),
        thread_title: threadTitle(task, subjectForTask(plan, task)),
        binding,
      };
    });
}

function compactActiveReservationRecords(records                           )                            {
  return records.map((record) => ({
    action: record.action,
    phase: record.phase,
    task_id: record.task_id,
    status: record.status,
    attempt: record.attempt ?? null,
    reservation_token: record.reservation_token,
    executor_id: record.executor_id ?? null,
    ...(record.action === "run_script" ? { command: record.command } : {}),
  }));
}

function nextActionFor(
  planPath        ,
  plan      ,
  goal              ,
  coverage              ,
  state          ,
  goalState           ,
)         {
  if (goalState.status === "completed") {
    return goalState.native_sync.status === "pending" ? "native_completion_pending" : "completed";
  }
  if (state.goal_refresh_pending) return "needs_delta";
  if (state.owner_change !== null) return "awaiting_owner_action";
  if (state.review_pending.length > 0) return "upgrade_review";
  const coverageSummary = summarizeCoverage(plan, coverage, state);
  const coverageFullyPlanned =
    (coverageSummary.uncovered_plan_item_effects            ).length === 0;
  if (!coverageFullyPlanned) return "needs_delta";
  const statuses = plan.tasks
    .filter((task) => task.node_type === "leaf")
    .map((task) => state.tasks[task.id].status);
  if (statuses.some((status) => status === "reserved" || status === "running")) {
    return "execute";
  }
  if (plan.tasks.some((task) => taskReadyForReservation(
    task,
    plan,
    state,
    coverageFullyPlanned,
  ))) return "execute";
  if (statuses.some((status) => status === "blocked" || status === "failed" || status === "needs_repair")) {
    return "repair";
  }
  if (statuses.some((status) => status === "pending")) return "repair";
  const unresolved = plan.tasks.filter((task) => !dependencyResolved(task.id, plan, state));
  if (unresolved.length > 0) return "repair";
  const inspection = inspectCompletion(planPath, plan, goal, coverage, state);
  if (
    inspection.problems.length > 0 ||
    (coverageSummary.incomplete_plan_item_ids            ).length > 0
  ) {
    return "repair";
  }
  return "finalize";
}

function sourceDriftPayload(
  goal              ,
  goalState           ,
  plan      ,
  state          ,
)                          {
  if (goalState.status === "completed") return { source_status: "frozen" };
  if (!existsSync(goal.source.path)) {
    return {
      source_status: "source_missing",
      missing_source_path: goal.source.path,
      source_drift_action: "user_blocked",
    };
  }
  const actualSourceDigest = digestFile(goal.source.path);
  if (actualSourceDigest === goal.source.digest) return { source_status: "current" };
  const active = activeTasks(plan, state);
  return {
    source_status: "source_changed",
    stored_source_digest: goal.source.digest,
    actual_source_digest: actualSourceDigest,
    source_drift_action: active.length > 0
      ? "source_drift_drain"
      : state.stale_executors.length > 0
        ? "confirm_stale_executors"
        : "source_refresh",
  };
}

function coordinatedNextAction(
  planPath        ,
  plan      ,
  goal              ,
  coverage              ,
  state          ,
  goalState           ,
)         {
  const drift = sourceDriftPayload(goal, goalState, plan, state);
  if (drift.source_status === "source_changed" || drift.source_status === "source_missing") {
    return drift.source_drift_action          ;
  }
  return nextActionFor(planPath, plan, goal, coverage, state, goalState);
}

function pendingSubgraphRequests(plan      , state          )




   {
  return plan.tasks.flatMap((task) => {
    const taskState = state.tasks[task.id];
    if (
      (taskState.status !== "reserved" && taskState.status !== "running") ||
      taskState.result_path === null || taskState.reservation_token === null ||
      taskState.result_ref !== null
    ) return [];
    const requestRef = subgraphRequestPathFor(taskState.result_path);
    if (!existsSync(requestRef)) return [];
    return [{
      task_id: task.id,
      reservation_token: taskState.reservation_token,
      request_ref: requestRef,
      request_digest: digestFile(requestRef),
    }];
  });
}

function pendingReviewUpgrades(state          )                                             {
  return state.review_pending.map((taskId) => {
    const resultRef = state.tasks[taskId]?.result_ref;
    if (resultRef === null || resultRef === undefined) {
      fail(`pending Review task is missing a result: ${taskId}`);
    }
    const result = requireRecord(readJson(resultRef), `pending Review result ${taskId}`);
    return {
      task_id: taskId,
      reason: requireString(result.review_upgrade_reason, `pending Review result ${taskId}.review_upgrade_reason`),
    };
  });
}

function reconcileCommand(planArgument        , stateArgument        , compact = false)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const payload = withStateLock(statePath, () => {
    const { plan, goal, coverage, state } = loadPlanAndState(
      planPath,
      statePath,
      { allowSourceDrift: true },
    );
    const goalState = goalStateForPlan(planPath, plan, goal).state;
    const subgraphRequests = pendingSubgraphRequests(plan, state);
    const reviewUpgrades = pendingReviewUpgrades(state);
    return {
      goal_id: goal.goal_id,
      goal_status: goalState.status,
      ...sourceDriftPayload(goal, goalState, plan, state),
      next_action: state.owner_change !== null
        ? "awaiting_owner_action"
        : reviewUpgrades.length > 0
        ? "upgrade_review"
        : subgraphRequests.length > 0
        ? "expand_subgraph"
        : coordinatedNextAction(planPath, plan, goal, coverage, state, goalState),
      owner_change: state.owner_change,
      review_upgrades: reviewUpgrades,
      subgraph_requests: subgraphRequests,
      active_reservations: (() => {
        const records = activeReservationRecords(planPath, plan, goal, state);
        return compact ? compactActiveReservationRecords(records) : records;
      })(),
      stale_executors: state.stale_executors,
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function reclaimCommand(
  planArgument        ,
  stateArgument        ,
  taskId        ,
  reservationToken        ,
  reason        ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const reclaimReason = requireString(reason, "reason");
  let cleanupPaths           = [];
  const payload = withStateLock(statePath, () => {
    const { plan, goal, state } = loadPlanAndState(
      planPath,
      statePath,
      { allowSourceDrift: true },
    );
    assertGoalMutable(planPath, plan, goal);
    const task = plan.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) fail(`unknown task: ${taskId}`);
    const taskState = state.tasks[taskId];
    const ownerState = subjectStateForTask(state, task);
    if (taskState.status === "pending" && taskState.last_reclaimed_token === reservationToken) {
      return { task_id: taskId, status: "pending", reclaimed: false, idempotent: true };
    }
    if (taskState.status === "reserved" && ownerState.bound_executor_id === null) {
      fail(`task ${taskId} is reserved but unbound; use abandon instead of reclaim`);
    }
    if (taskState.status !== "reserved" && taskState.status !== "running") {
      fail(`task ${taskId} cannot be reclaimed from ${taskState.status}`);
    }
    if (taskState.reservation_token !== reservationToken) fail("reservation token mismatch");
    if (ownerState.current_task_id !== taskId) fail("owner current task mismatch");
    cleanupPaths = taskAttemptCleanupPaths(planPath, task, taskState);
    const reclaimedExecutorId = taskState.executor_id ?? ownerState.bound_executor_id;
    const reclaimedAttempt = taskState.attempt;
    const reclaimedSourceRevision = taskState.source_revision;
    taskState.status = "pending";
    taskState.last_reclaimed_token = reservationToken;
    taskState.reservation_token = null;
    taskState.owner_generation = null;
    taskState.executor_id = null;
    taskState.reserved_at = null;
    taskState.result_path = null;
    taskState.result_ref = null;
    taskState.result_digest = null;
    taskState.task_baseline_ref = null;
    taskState.task_baseline_digest = null;
    taskState.accepted_change_seq = null;
    ownerState.bound_executor_id = null;
    ownerState.status = "unbound";
    ownerState.current_task_id = null;
    if (reclaimedExecutorId !== null) {
      state.stale_executors.push({
        executor_id: reclaimedExecutorId,
        owner_id: taskSubjectId(task),
        task_id: task.id,
        attempt: reclaimedAttempt,
        reservation_token: reservationToken,
        source_revision: reclaimedSourceRevision,
        status: "stop_pending",
        reclaimed_at: new Date().toISOString(),
      });
    }
    if (task.owner_id !== null && task.role !== "review") {
      const owner = subjectForTask(plan, task)                   ;
      const capsule = interruptCapsule(
        owner,
        ownerState,
        state.goal_digest,
        state.source_revision,
        `task ${taskId} orphan reservation reclaimed: ${reclaimReason}`,
      );
      writeTransaction(statePath, [
        [ownerState.capsule_ref          , capsule],
        [statePath, state],
      ]);
    } else {
      writeJson(statePath, state);
    }
    return {
      task_id: taskId,
      status: "pending",
      reclaimed: true,
      idempotent: false,
      executor_id: reclaimedExecutorId,
      owner_generation: ownerState.generation,
      reason: reclaimReason,
    };
  });
  for (const path of cleanupPaths) rmSync(path, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function confirmStaleExecutorCommand(
  planArgument        ,
  stateArgument        ,
  executorIdArgument        ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const executorId = requireString(executorIdArgument, "executor_id");
  const payload = withStateLock(statePath, () => {
    const { plan, goal, state } = loadPlanAndState(
      planPath,
      statePath,
      { allowSourceDrift: true },
    );
    assertGoalMutable(planPath, plan, goal);
    const removed = state.stale_executors.filter((item) => item.executor_id === executorId);
    if (removed.length === 0) {
      return { executor_id: executorId, status: "confirmed", idempotent: true };
    }
    state.stale_executors = state.stale_executors.filter(
      (item) => item.executor_id !== executorId,
    );
    writeJson(statePath, state);
    for (const stale of removed) {
      const task = plan.tasks.find((candidate) => candidate.id === stale.task_id);
      if (task !== undefined) releaseOwnerLease(goal, task, stale.reservation_token);
    }
    return {
      executor_id: executorId,
      status: "confirmed",
      reclaimed_reservations: removed,
      idempotent: false,
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function statusCommand(planArgument        , stateArgument        , compact = false)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const payload = withStateLock(statePath, () => {
    const { plan, goal, coverage, state } = loadPlanAndState(
      planPath,
      statePath,
      { allowSourceDrift: true },
    );
    const goalState = goalStateForPlan(planPath, plan, goal).state;
    const owners = Object.fromEntries(plan.owners.map((owner) => [owner.id, {
      generation: state.owners[owner.id].generation,
      status: state.owners[owner.id].status,
      executor_id: state.owners[owner.id].bound_executor_id,
      current_task_id: state.owners[owner.id].current_task_id,
      capsule_ref: state.owners[owner.id].capsule_ref,
      lease: (() => {
        const leasePath = ownerLeasePathFor(goal.workspace.root, owner.id);
        return existsSync(leasePath) ? parseOwnerLease(readJson(leasePath), owner.id) : null;
      })(),
    }]));
    const runtimeActors = Object.fromEntries(plan.runtime_actors.map((actor) => [actor.id, {
      generation: state.runtime_actors[actor.id].generation,
      status: state.runtime_actors[actor.id].status,
      executor_id: state.runtime_actors[actor.id].bound_executor_id,
      current_task_id: state.runtime_actors[actor.id].current_task_id,
    }]));
    const inspection = goalState.status === "completed"
      ? { problems: []             }
      : inspectCompletion(planPath, plan, goal, coverage, state);
    const subgraphRequests = pendingSubgraphRequests(plan, state);
    const reviewUpgrades = pendingReviewUpgrades(state);
    const nextAction = state.owner_change !== null
      ? "awaiting_owner_action"
      : reviewUpgrades.length > 0
      ? "upgrade_review"
      : subgraphRequests.length > 0
      ? "expand_subgraph"
      : coordinatedNextAction(planPath, plan, goal, coverage, state, goalState);
    const activeReservations = activeReservationRecords(planPath, plan, goal, state);
    if (compact) {
      return {
        goal_id: goal.goal_id,
        goal_status: goalState.status,
        revision: plan.revision,
        source_revision: state.source_revision,
        ...sourceDriftPayload(goal, goalState, plan, state),
        next_action: nextAction,
        summary: summarizeState(state),
        active_reservations: compactActiveReservationRecords(activeReservations),
        owner_change_pending: state.owner_change !== null,
        review_upgrade_count: reviewUpgrades.length,
        subgraph_request_count: subgraphRequests.length,
        stale_executor_count: state.stale_executors.length,
      };
    }
    return {
      goal_id: goal.goal_id,
      objective: goal.objective,
      goal_status: goalState.status,
      native_sync: goalState.native_sync,
      ...continuationPayloadFor(plan.goal_contract_path),
      revision: plan.revision,
      source_revision: state.source_revision,
      workspace_change_seq: state.workspace_change_seq,
      ...sourceDriftPayload(goal, goalState, plan, state),
      next_action: nextAction,
      owner_change: state.owner_change,
      review_upgrades: reviewUpgrades,
      subgraph_requests: subgraphRequests,
      summary: summarizeState(state),
      coverage: summarizeCoverage(plan, coverage, state),
      active_reservations: activeReservations,
      stale_executors: state.stale_executors,
      completion_problems: inspection.problems,
      owners,
      runtime_actors: runtimeActors,
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function dashboardSnapshot(planArgument        , stateArgument        )                          {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  let lastError          = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return dashboardSnapshotRead(planPath, statePath);
    } catch (error) {
      lastError = error;
      if (attempt < 7) sleep(25);
    }
  }
  throw lastError;
}

function dashboardSnapshotRead(planPath        , statePath        )                          {
  const { plan, goal, coverage, state } = loadPlanAndState(
    planPath,
    statePath,
    { allowSourceDrift: true },
  );
    const sourceTitle = existsSync(goal.source.path)
      ? /^#\s+(.+)$/mu.exec(readFileSync(goal.source.path, "utf8"))?.[1]?.trim()
      : undefined;
    const goalState = goalStateForPlan(planPath, plan, goal).state;
    const coverageSummary = summarizeCoverage(plan, coverage, state);
    const coverageFullyPlanned =
      (coverageSummary.uncovered_plan_item_effects            ).length === 0;
    const drift = sourceDriftPayload(goal, goalState, plan, state);
    const inspection = goalState.status === "completed"
      ? { problems: []            , passed_gates: goal.verification_gates.map((gate) => gate.id) }
      : inspectCompletion(planPath, plan, goal, coverage, state);
    const passedGates = new Set(inspection.passed_gates);
    const tasks = [...plan.tasks]
      .sort((left, right) => compareStableStrings(left.id, right.id))
      .map((task) => {
        const taskState = state.tasks[task.id];
        const ready = taskReadyForReservation(task, plan, state, coverageFullyPlanned);
        const aggregateStatus = effectiveTaskStatus(task, plan, state);
        const descendantIds = task.node_type === "composite"
          ? [...descendantTaskIds(task.id, plan)]
          : [];
        const phase = task.node_type === "composite"
          ? aggregateStatus === "pending"
            ? (descendantIds.some((childId) => {
                  const child = plan.tasks.find((candidate) => candidate.id === childId);
                  return child !== undefined && taskReadyForReservation(
                    child,
                    plan,
                    state,
                    coverageFullyPlanned,
                  );
                })
              ? "ready"
              : "waiting")
            : aggregateStatus
          : taskState.status === "pending"
            ? (ready ? "ready" : "waiting")
            : taskState.status;
        const blockingDependencies = boundaryDependenciesForTask(task, plan)
          .filter((dependencyId) => !dependencyResolved(dependencyId, plan, state))
          .sort(compareStableStrings);
        return {
          id: task.id,
          logical_id: task.logical_id,
          title: task.title,
          role: task.role,
          node_type: task.node_type,
          parent_task_id: task.parent_task_id,
          depth: taskDepth(task, plan),
          subgraph: task.subgraph === null ? null : {
            contract: task.subgraph.contract,
            task_ids: [...task.subgraph.task_ids].sort(compareStableStrings),
            entry_task_ids: [...task.subgraph.entry_task_ids].sort(compareStableStrings),
            exit_task_ids: [...task.subgraph.exit_task_ids].sort(compareStableStrings),
            completion_policy: task.subgraph.completion_policy,
            expansion_reason: task.subgraph.expansion_reason,
            expanded_from_attempt: task.subgraph.expanded_from_attempt,
          },
          subject: {
            kind: task.role === "review" ? "review" : task.owner_id === null ? "actor" : "owner",
            id: taskSubjectId(task),
          },
          status: aggregateStatus,
          runtime_status: taskState.status,
          phase,
          attempt: taskState.attempt,
          source_revision: taskState.source_revision,
          validated_source_revision: taskState.validated_source_revision,
          depends_on: [...task.depends_on].sort(compareStableStrings),
          boundary_dependencies: boundaryDependenciesForTask(task, plan).sort(compareStableStrings),
          blocking_dependencies: blockingDependencies,
          coverage_effect: task.coverage_effect,
          plan_item_ids: [...task.plan_item_ids].sort(compareStableStrings),
          satisfies_goal_gates: [...task.satisfies_goal_gates].sort(compareStableStrings),
          priority: task.priority,
          estimated_cost: task.estimated_cost,
        };
      });
    const leafStates = plan.tasks
      .filter((task) => task.node_type === "leaf")
      .map((task) => state.tasks[task.id]);
    const leafSummary = Object.fromEntries([
      "pending", "reserved", "running", "completed", "blocked", "failed", "needs_repair", "superseded",
    ].map((status) => [status, leafStates.filter((task) => task.status === status).length]));
    const topLevelTasks = tasks.filter((task) => task.parent_task_id === null && task.status !== "superseded");
    const gateTasks = (gateId        ) => plan.tasks.filter((task) =>
      task.satisfies_goal_gates.includes(gateId) && state.tasks[task.id].status !== "superseded"
    );
    const gates = goal.verification_gates.map((gate) => {
      const candidates = gateTasks(gate.id);
      const candidateStatuses = candidates.map((task) => state.tasks[task.id].status);
      const gateStatus = passedGates.has(gate.id)
        ? "passed"
        : candidateStatuses.some((status) => status === "running" || status === "reserved")
          ? "running"
          : candidateStatuses.some((status) =>
            status === "blocked" || status === "failed" || status === "needs_repair"
          )
            ? "attention"
            : "pending";
      return {
        id: gate.id,
        stage: gate.stage,
        description: gate.description,
        required: gate.required,
        status: gateStatus,
        task_ids: candidates.map((task) => task.id).sort(compareStableStrings),
      };
    });
  return {
      contract: "DAG_DASHBOARD_SNAPSHOT_V1",
      generated_at: new Date().toISOString(),
      goal: {
        id: goal.goal_id,
        title: sourceTitle || goal.goal_id,
        objective: goal.objective,
        status: goalState.status,
        native_sync_status: goalState.native_sync.status,
      },
      plan: {
        revision: plan.revision,
        source_revision: state.source_revision,
        workspace_change_seq: state.workspace_change_seq,
        safety: plan.safety.status,
        execution_platform: plan.execution_platform,
        max_concurrency: goal.execution.max_concurrency,
      },
      progress: {
        next_action: coordinatedNextAction(planPath, plan, goal, coverage, state, goalState),
        source_status: drift.source_status,
        source_drift_action: drift.source_drift_action ?? null,
        summary: leafSummary,
        top_level: {
          total: topLevelTasks.length,
          completed: topLevelTasks.filter((task) => task.status === "completed").length,
          active: topLevelTasks.filter((task) => task.status === "running" || task.status === "reserved").length,
          attention: topLevelTasks.filter((task) =>
            task.status === "blocked" || task.status === "failed" || task.status === "needs_repair"
          ).length,
        },
        coverage: coverageSummary,
        ready: tasks.filter((task) => task.phase === "ready").length,
        attention: tasks.filter((task) =>
          task.phase === "blocked" || task.phase === "failed" || task.phase === "needs_repair"
        ).length,
        completion_problem_count: inspection.problems.length,
      },
      gates,
      tasks,
      edges: [
        ...tasks.flatMap((task) => task.depends_on.map((dependencyId) => ({
          from: dependencyId,
          to: task.id,
          kind: task.parent_task_id === null ? "boundary" : "internal",
        }))),
        ...tasks.filter((task) => task.parent_task_id !== null && task.depends_on.length === 0)
          .map((task) => ({
            from: task.parent_task_id,
            to: task.id,
            kind: "containment",
          })),
      ],
  };
}

































function progressDocumentPathFor(planPath        )         {
  return join(dirname(planPath), "progress.json");
}

function progressEventsPathFor(planPath        )         {
  return join(dirname(planPath), "events.jsonl");
}

function parseProgressEventLine(line        , label        )                          {
  let parsed         ;
  try {
    parsed = JSON.parse(line);
  } catch {
    fail(`${label} is not valid JSON`);
  }
  const event = requireRecord(parsed, label);
  if (event.contract !== "DAG_PROGRESS_EVENT_V1") fail(`${label} has an invalid contract`);
  requireNonNegativeInteger(event.seq, `${label}.seq`);
  requireString(event.event_id, `${label}.event_id`);
  requireString(event.type, `${label}.type`);
  return event;
}

function readProgressEvents(path        )                            {
  if (!existsSync(path)) return [];
  const contents = readFileSync(path, "utf8");
  if (!contents.trim()) return [];
  return contents.split("\n").flatMap((line, index) => {
    if (!line.trim()) return [];
    return [parseProgressEventLine(line, `progress event line ${index + 1}`)];
  });
}

function readProgressEventTail(path        , maxBytes = 256 * 1024)                            {
  if (!existsSync(path)) return [];
  const size = statSync(path).size;
  if (size === 0) return [];
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  const buffer = Buffer.alloc(length);
  const descriptor = openSync(path, "r");
  try {
    readSync(descriptor, buffer, 0, length, start);
  } finally {
    closeSync(descriptor);
  }
  let contents = buffer.toString("utf8");
  if (start > 0) {
    const firstNewline = contents.indexOf("\n");
    contents = firstNewline < 0 ? "" : contents.slice(firstNewline + 1);
  }
  return contents.split("\n").flatMap((line, index) =>
    line.trim()
      ? [parseProgressEventLine(line, `progress event tail line ${index + 1}`)]
      : []
  );
}

function progressEventsPage(
  planPath        ,
  after        ,
  limit        ,
)                          {
  const events = readProgressEvents(progressEventsPathFor(planPath));
  const candidates = events.filter((event) =>
    typeof event.seq === "number" && event.seq > after
  );
  const page = candidates.slice(0, limit);
  const nextAfter = page.length === 0
    ? after
    : requireNonNegativeInteger(page[page.length - 1].seq, "progress event seq");
  return {
    contract: "DAG_PROGRESS_EVENT_PAGE_V1",
    after,
    limit,
    events: page,
    next_after: nextAfter,
    has_more: candidates.length > page.length,
  };
}

function readExistingProgressDocument(path        )                                 {
  if (!existsSync(path)) return null;
  try {
    const document = requireRecord(readJson(path), "progress document");
    return document.contract === "DAG_PROGRESS_DOCUMENT_V1" ? document : null;
  } catch {
    return null;
  }
}

function observeProgressSources(planPath        , statePath        )                      {
  const plan = requireRecord(readJson(planPath), "progress plan");
  const state = requireRecord(readJson(statePath), "progress state");
  const taskDefinitions = new Map                                 ();
  if (!Array.isArray(plan.tasks)) fail("progress plan.tasks must be an array");
  for (const value of plan.tasks) {
    const task = requireRecord(value, "progress plan task");
    taskDefinitions.set(requireString(task.id, "progress plan task.id"), task);
  }
  const taskStates = requireRecord(state.tasks, "progress state.tasks");
  const taskObservations = Object.entries(taskStates)
    .sort(([left], [right]) => compareStableStrings(left, right))
    .map(([taskId, value]) => {
      const taskState = requireRecord(value, `progress state.tasks.${taskId}`);
      const status = requireString(taskState.status, `progress state.tasks.${taskId}.status`);
      const resultPath = typeof taskState.result_path === "string" && taskState.result_path
        ? taskState.result_path
        : null;
      return {
        task_id: taskId,
        status,
        attempt: requireNonNegativeInteger(taskState.attempt, `progress state.tasks.${taskId}.attempt`),
        source_revision: requireNonNegativeInteger(
          taskState.source_revision,
          `progress state.tasks.${taskId}.source_revision`,
        ),
        submitted_result_digest: status === "running" && resultPath !== null && existsSync(resultPath)
          ? digestFile(resultPath)
          : null,
        result_digest: typeof taskState.result_digest === "string" && taskState.result_digest
          ? taskState.result_digest
          : null,
      };
    });
  const taskResults = Object.entries(taskStates)
    .sort(([left], [right]) => compareStableStrings(left, right))
    .flatMap(([taskId, value]) => {
      const taskState = requireRecord(value, `progress state.tasks.${taskId}`);
      if (typeof taskState.result_digest !== "string" || !taskState.result_digest) return [];
      if (typeof taskState.result_ref !== "string" || !taskState.result_ref) return [];
      const task = taskDefinitions.get(taskId);
      return [{
        task_id: taskId,
        title: task === undefined || typeof task.title !== "string" ? taskId : task.title,
        status: requireString(taskState.status, `progress state.tasks.${taskId}.status`),
        attempt: requireNonNegativeInteger(
          taskState.attempt,
          `progress state.tasks.${taskId}.attempt`,
        ),
        source_revision: requireNonNegativeInteger(
          taskState.source_revision,
          `progress state.tasks.${taskId}.source_revision`,
        ),
        result_digest: taskState.result_digest,
        result_ref: taskState.result_ref,
      }];
    });
  const goalStatePath = join(dirname(planPath), "goal-state.json");
  const goalState = existsSync(goalStatePath)
    ? requireRecord(readJson(goalStatePath), "progress goal state")
    : {};
  const visibleTaskResults = goalState.status === "completed" ? [] : taskResults;
  const nativeSync = isRecord(goalState.native_sync) ? goalState.native_sync : {};
  const source = {
    plan_digest: digestFile(planPath),
    plan_revision: plan.revision,
    source_revision: state.source_revision,
    goal_status: goalState.status ?? null,
    native_sync_status: nativeSync.status ?? null,
    task_states: taskObservations,
    task_results: visibleTaskResults.map((result) => ({
      task_id: result.task_id,
      status: result.status,
      attempt: result.attempt,
      source_revision: result.source_revision,
      result_digest: result.result_digest,
    })),
  };
  return {
    fingerprint: digestJson(source),
    source,
    taskStates: taskObservations,
    taskResults: visibleTaskResults,
  };
}

function publicTaskResult(result                           )                          {
  const raw = requireRecord(readJson(result.result_ref), `task result ${result.task_id}`);
  return {
    task_id: result.task_id,
    title: result.title,
    status: result.status,
    attempt: result.attempt,
    source_revision: result.source_revision,
    result_digest: result.result_digest,
    summary: typeof raw.summary === "string" ? raw.summary : "",
    changed_file_count: Array.isArray(raw.changed_files) ? raw.changed_files.length : 0,
    blocking_finding_count: Array.isArray(raw.blocking_findings)
      ? raw.blocking_findings.length
      : 0,
    published_artifact_count: Array.isArray(raw.published_artifacts)
      ? raw.published_artifacts.length
      : 0,
  };
}

function refreshProgressDocument(
  planArgument        ,
  stateArgument        ,
)                          {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const documentPath = progressDocumentPathFor(planPath);
  const eventsPath = progressEventsPathFor(planPath);
  const initialObservation = observeProgressSources(planPath, statePath);
  const initialDocument = readExistingProgressDocument(documentPath);
  if (
    initialDocument?.source_fingerprint === initialObservation.fingerprint &&
    isRecord(initialDocument.event_stream) &&
    existsSync(eventsPath)
  ) {
    return { changed: false, path: documentPath, document: initialDocument };
  }
  return withStateLock(documentPath, () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const observation = observeProgressSources(planPath, statePath);
      const previous = readExistingProgressDocument(documentPath);
      if (
        previous?.source_fingerprint === observation.fingerprint &&
        isRecord(previous.event_stream) &&
        existsSync(eventsPath)
      ) {
        return { changed: false, path: documentPath, document: previous };
      }
      const snapshot = dashboardSnapshot(planPath, statePath);
      const confirmed = observeProgressSources(planPath, statePath);
      if (confirmed.fingerprint !== observation.fingerprint) {
        if (attempt < 7) {
          sleep(25);
          continue;
        }
        fail("progress sources changed repeatedly while building the fixed document");
      }
      const taskResults = confirmed.taskResults.map(publicTaskResult);
      const previousTaskResults = new Map                                 (
        Array.isArray(previous?.task_results)
          ? previous.task_results.flatMap((value) => {
            if (!isRecord(value) || typeof value.task_id !== "string") return [];
            return [[value.task_id, value]                                     ];
          })
          : [],
      );
      const currentTaskResults = new Map(
        taskResults.map((result) => [result.task_id          , result]),
      );
      const previousEventStream = isRecord(previous?.event_stream) ? previous.event_stream : null;
      const previousEventSequence = previousEventStream === null
        ? 0
        : requireNonNegativeInteger(previousEventStream.last_seq, "progress event stream.last_seq");
      const tailEvents = readProgressEventTail(eventsPath);
      const tailSequence = tailEvents.reduce((maximum, event) =>
        typeof event.seq === "number" && Number.isInteger(event.seq)
          ? Math.max(maximum, event.seq)
        : maximum, 0);
      if (tailSequence < previousEventSequence) {
        fail("progress event stream is shorter than the recorded sequence");
      }
      const persistedEvents = tailSequence > previousEventSequence
        ? readProgressEvents(eventsPath)
        : tailEvents;
      let eventSequence = Math.max(previousEventSequence, tailSequence);
      const existingEventIds = new Set(
        persistedEvents.flatMap((event) =>
          typeof event.event_id === "string" ? [event.event_id] : []
        ),
      );
      const pendingEvents                            = [];
      const appendEvent = (event                         ) => {
        const eventId = digestJson({ source_fingerprint: confirmed.fingerprint, ...event });
        if (existingEventIds.has(eventId)) return;
        eventSequence += 1;
        existingEventIds.add(eventId);
        pendingEvents.push({
          contract: "DAG_PROGRESS_EVENT_V1",
          seq: eventSequence,
          event_id: eventId,
          at: new Date().toISOString(),
          ...event,
        });
      };
      if (Array.isArray(previous?.events)) {
        for (const value of previous.events) {
          if (!isRecord(value) || typeof value.type !== "string") continue;
          const { seq: _seq, at: _at, contract: _contract, event_id: _eventId, ...event } = value;
          appendEvent(event);
        }
      }
      const previousSource = isRecord(previous?.source) ? previous.source : null;
      if (previous === null) {
        appendEvent({
          type: "dag_initialized",
          plan_revision: confirmed.source.plan_revision,
          source_revision: confirmed.source.source_revision,
        });
      } else if (
        previousSource?.plan_digest !== confirmed.source.plan_digest ||
        previousSource?.plan_revision !== confirmed.source.plan_revision ||
        previousSource?.source_revision !== confirmed.source.source_revision
      ) {
        appendEvent({
          type: "dag_updated",
          plan_revision: confirmed.source.plan_revision,
          source_revision: confirmed.source.source_revision,
        });
      }
      if (
        previous !== null &&
        (previousSource?.goal_status !== confirmed.source.goal_status ||
          previousSource?.native_sync_status !== confirmed.source.native_sync_status)
      ) {
        appendEvent({
          type: "goal_status_updated",
          goal_status: confirmed.source.goal_status,
          native_sync_status: confirmed.source.native_sync_status,
        });
      }
      if (previous !== null) {
        const previousTaskStates = new Map                                 (
          previousSource !== null && Array.isArray(previousSource.task_states)
            ? previousSource.task_states.flatMap((value) => {
              if (!isRecord(value) || typeof value.task_id !== "string") return [];
              return [[value.task_id, value]                                     ];
            })
            : [],
        );
        for (const taskState of confirmed.taskStates) {
          const prior = previousTaskStates.get(taskState.task_id);
          if (
            taskState.submitted_result_digest !== null &&
            prior?.submitted_result_digest !== taskState.submitted_result_digest
          ) {
            appendEvent({
              type: "task_result_submitted",
              task_id: taskState.task_id,
              attempt: taskState.attempt,
              source_revision: taskState.source_revision,
            });
          }
          if (
            prior === undefined || prior.status !== taskState.status ||
            prior.attempt !== taskState.attempt || prior.source_revision !== taskState.source_revision
          ) {
            appendEvent({
              type: "task_status_updated",
              task_id: taskState.task_id,
              status: taskState.status,
              attempt: taskState.attempt,
              source_revision: taskState.source_revision,
            });
          }
        }
      }
      const previousSnapshotTasks = new Map                                 (
        isRecord(previous?.snapshot) && Array.isArray(previous.snapshot.tasks)
          ? previous.snapshot.tasks.flatMap((value) => {
            if (!isRecord(value) || typeof value.id !== "string") return [];
            return [[value.id, value]                                     ];
          })
          : [],
      );
      const currentSnapshotTasks = isRecord(snapshot) && Array.isArray(snapshot.tasks)
        ? snapshot.tasks.filter(isRecord)
        : [];
      for (const task of currentSnapshotTasks) {
        if (task.node_type !== "composite" || !isRecord(task.subgraph)) continue;
        const prior = previousSnapshotTasks.get(String(task.id));
        if (prior?.node_type === "composite" && isRecord(prior.subgraph)) continue;
        appendEvent({
          type: "subgraph_expanded",
          parent_task_id: task.id,
          child_task_ids: task.subgraph.task_ids,
          entry_task_ids: task.subgraph.entry_task_ids,
          exit_task_ids: task.subgraph.exit_task_ids,
          reason: task.subgraph.expansion_reason,
          plan_revision: confirmed.source.plan_revision,
        });
      }
      for (const [taskId, result] of currentTaskResults) {
        const prior = previousTaskResults.get(taskId);
        if (
          prior === undefined ||
          prior.result_digest !== result.result_digest ||
          prior.status !== result.status
        ) {
          appendEvent({
            type: "task_result_updated",
            task_id: taskId,
            status: result.status,
            attempt: result.attempt,
            source_revision: result.source_revision,
            summary: compactUserSummary(String(result.summary)),
          });
        }
      }
      for (const [taskId, result] of previousTaskResults) {
        if (!currentTaskResults.has(taskId)) {
          appendEvent({
            type: "task_result_removed",
            task_id: taskId,
            previous_status: result.status,
          });
        }
      }
      const priorRevision = typeof previous?.document_revision === "number"
        ? previous.document_revision
        : 0;
      if (pendingEvents.length > 0) {
        appendFileSync(
          eventsPath,
          pendingEvents.map((event) => JSON.stringify(event)).join("\n") + "\n",
          { encoding: "utf8", mode: 0o600 },
        );
      }
      const document                          = {
        contract: "DAG_PROGRESS_DOCUMENT_V1",
        updated_at: new Date().toISOString(),
        document_revision: priorRevision + 1,
        source_fingerprint: confirmed.fingerprint,
        source: confirmed.source,
        snapshot,
        task_results: taskResults,
        event_stream: {
          contract: "DAG_PROGRESS_EVENT_STREAM_V1",
          path: "events.jsonl",
          last_seq: eventSequence,
          page_endpoint: "/api/progress-events",
        },
      };
      writeTextAtomic(documentPath, serializedJson(document));
      return { changed: true, path: documentPath, document };
    }
    fail("unreachable progress document refresh state");
  });
}

function progressDocumentCommand(planArgument        , stateArgument        )       {
  const refreshed = refreshProgressDocument(planArgument, stateArgument);
  process.stdout.write(`${JSON.stringify({
    status: refreshed.changed ? "written" : "current",
    contract: refreshed.document.contract,
    document_path: refreshed.path,
    document_revision: refreshed.document.document_revision,
    updated_at: refreshed.document.updated_at,
    events_path: progressEventsPathFor(resolve(planArgument)),
  })}\n`);
}

function dashboardSnapshotCommand(planArgument        , stateArgument        )       {
  process.stdout.write(`${JSON.stringify(dashboardSnapshot(planArgument, stateArgument))}\n`);
}









function parseDashboardServeOptions(args          )                        {
  if (args.length === 0) fail("dashboard requires <plan.json>");
  const planPath = resolve(args[0]);
  let statePath = statePathFor(planPath);
  let host = "127.0.0.1";
  let port = 7357;
  let allowRemote = false;
  let index = 1;
  if (args[index] !== undefined && !args[index].startsWith("--")) {
    statePath = canonicalPath(statePathFor(planPath), args[index], "state path");
    index += 1;
  }
  while (index < args.length) {
    const option = args[index];
    if (option === "--allow-remote") {
      allowRemote = true;
      index += 1;
      continue;
    }
    if (option !== "--host" && option !== "--port") {
      fail(`unknown dashboard option: ${option}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`${option} requires a value`);
    if (option === "--host") {
      if (!/^[A-Za-z0-9.:[\]-]+$/u.test(value)) fail(`dashboard host is invalid: ${value}`);
      host = value;
    } else {
      const parsedPort = Number(value);
      if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65_535) {
        fail("dashboard port must be an integer from 0 to 65535");
      }
      port = parsedPort;
    }
    index += 2;
  }
  const loopback = host === "localhost" || host === "::1" || host.startsWith("127.");
  if (!loopback && !allowRemote) {
    fail("non-loopback dashboard host requires --allow-remote because Goal metadata becomes network-visible");
  }
  return { planPath, statePath, host, port, allowRemote };
}

function setDashboardHeaders(response                )       {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; " +
      "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
      "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
}

function sendDashboardResponse(
  request                 ,
  response                ,
  status        ,
  contentType        ,
  body        ,
  extraHeaders                         = {},
)       {
  setDashboardHeaders(response);
  response.statusCode = status;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Length", String(Buffer.byteLength(body)));
  for (const [name, value] of Object.entries(extraHeaders)) response.setHeader(name, value);
  response.end(request.method === "HEAD" ? undefined : body);
}

function sendDashboardEvent(
  response                ,
  event        ,
  payload                         ,
)       {
  response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function dashboardCommand(args          )       {
  const options = parseDashboardServeOptions(args);
  dashboardSnapshot(options.planPath, options.statePath);
  const initialProgress = refreshProgressDocument(options.planPath, options.statePath);
  const assetPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "assets",
    "goal-dag-dashboard.html",
  );
  if (!existsSync(assetPath)) fail(`dashboard asset is missing: ${assetPath}`);
  const dashboardHtml = readFileSync(assetPath, "utf8");
  const liveResponses = new Set                ();
  const server = createServer((request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        sendDashboardResponse(request, response, 405, "text/plain; charset=utf-8", "method not allowed\n", {
          Allow: "GET, HEAD",
        });
        return;
      }
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const pathname = requestUrl.pathname;
      if (pathname === "/" || pathname === "/index.html") {
        sendDashboardResponse(request, response, 200, "text/html; charset=utf-8", dashboardHtml);
        return;
      }
      if (pathname === "/api/snapshot") {
        const snapshot = dashboardSnapshot(options.planPath, options.statePath);
        const body = `${JSON.stringify(snapshot)}\n`;
        sendDashboardResponse(request, response, 200, "application/json; charset=utf-8", body);
        return;
      }
      if (pathname === "/api/live") {
        const snapshot = dashboardSnapshot(options.planPath, options.statePath);
        setDashboardHeaders(response);
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        response.setHeader("Connection", "keep-alive");
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        response.flushHeaders();
        liveResponses.add(response);
        sendDashboardEvent(response, "snapshot", snapshot);
        request.once("close", () => liveResponses.delete(response));
        return;
      }
      if (pathname === "/api/progress-document") {
        const progress = refreshProgressDocument(options.planPath, options.statePath);
        sendDashboardResponse(
          request,
          response,
          200,
          "application/json; charset=utf-8",
          serializedJson(progress.document),
        );
        return;
      }
      if (pathname === "/api/progress-events") {
        refreshProgressDocument(options.planPath, options.statePath);
        const rawAfter = requestUrl.searchParams.get("after") ?? "0";
        const rawLimit = requestUrl.searchParams.get("limit") ?? "100";
        const after = Number(rawAfter);
        const requestedLimit = Number(rawLimit);
        if (!Number.isInteger(after) || after < 0) fail("progress events after must be a non-negative integer");
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 500) {
          fail("progress events limit must be an integer from 1 to 500");
        }
        sendDashboardResponse(
          request,
          response,
          200,
          "application/json; charset=utf-8",
          serializedJson(progressEventsPage(options.planPath, after, requestedLimit)),
        );
        return;
      }
      if (pathname === "/healthz") {
        sendDashboardResponse(request, response, 200, "application/json; charset=utf-8", "{\"status\":\"ok\"}\n");
        return;
      }
      if (pathname === "/favicon.ico") {
        sendDashboardResponse(request, response, 204, "image/x-icon", "");
        return;
      }
      sendDashboardResponse(request, response, 404, "text/plain; charset=utf-8", "not found\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendDashboardResponse(
        request,
        response,
        500,
        "application/json; charset=utf-8",
        `${JSON.stringify({ error: message })}\n`,
      );
    }
  });
  server.once("error", (error) => {
    process.stderr.write(`error: dashboard server failed: ${error.message}\n`);
    process.exitCode = 1;
  });
  let pendingRefresh                                       = null;
  const watchedFiles = new Set([
    "goal.json",
    "goal-state.json",
    "plan.json",
    "coverage.json",
    "state.json",
  ]);
  const pushChangedSnapshot = () => {
    pendingRefresh = null;
    try {
      refreshProgressDocument(options.planPath, options.statePath);
      const snapshot = dashboardSnapshot(options.planPath, options.statePath);
      for (const response of liveResponses) {
        sendDashboardEvent(response, "snapshot", snapshot);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`warning: dashboard live refresh failed: ${message}\n`);
      for (const response of liveResponses) {
        sendDashboardEvent(response, "dashboard-error", { message });
      }
    }
  };
  const dashboardWatcher = watch(dirname(options.planPath), (eventType, filename) => {
    const changedName = filename === null ? "" : basename(filename.toString());
    if (
      changedName &&
      ![...watchedFiles].some((name) => changedName === name || changedName.startsWith(`${name}.`))
    ) return;
    if (pendingRefresh !== null) clearTimeout(pendingRefresh);
    pendingRefresh = setTimeout(pushChangedSnapshot, 50);
  });
  dashboardWatcher.on("error", (error) => {
    process.stderr.write(`warning: dashboard file watcher failed: ${error.message}\n`);
  });
  server.listen(options.port, options.host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address !== null ? address.port : options.port;
    const urlHost = options.host.includes(":") ? `[${options.host}]` : options.host;
    process.stdout.write(`${JSON.stringify({
      status: "serving",
      url: `http://${urlHost}:${actualPort}/`,
      host: options.host,
      port: actualPort,
      plan_path: options.planPath,
      state_path: options.statePath,
      read_only: true,
      progress_document_path: initialProgress.path,
      progress_document_url: `http://${urlHost}:${actualPort}/api/progress-document`,
      progress_events_path: progressEventsPathFor(options.planPath),
      progress_events_url: `http://${urlHost}:${actualPort}/api/progress-events`,
      live_updates_url: `http://${urlHost}:${actualPort}/api/live`,
      update_transport: "sse",
      network_visible: options.allowRemote,
    })}\n`);
  });
  const shutdown = () => {
    if (pendingRefresh !== null) clearTimeout(pendingRefresh);
    dashboardWatcher.close();
    for (const response of liveResponses) response.end();
    liveResponses.clear();
    server.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function finalizeCommand(
  goalArgument        ,
  goalStateArgument        ,
  planArgument        ,
  stateArgument        ,
  compact = false,
)       {
  const goalPath = resolve(goalArgument);
  const goalStatePath = canonicalPath(goalStatePathFor(goalPath), goalStateArgument, "goal state path");
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const payload = withStateLock(goalStatePath, () => withStateLock(statePath, () => {
    const goal = parseGoal(readJson(goalPath));
    const goalState = parseGoalState(readJson(goalStatePath), goal);
    const { plan, coverage, state } = loadPlanAndState(planPath, statePath);
    if (goalState.active_plan_path !== planPath) fail("finalize plan is not the active goal plan");
    const nativeAction = () => ({
      action: "update_goal",
      status: "complete",
      completion_token: goalState.native_sync.completion_token,
      objective_digest: goalState.native_sync.objective_digest,
      native_goal: goal.lifecycle.native_goal,
    });
    if (goalState.status === "completed") {
      const resultRef = goalState.result_ref;
      return {
        status: "completed",
        goal_id: goal.goal_id,
        result_ref: resultRef,
        task_count: plan.tasks.filter((task) => task.node_type === "leaf").length,
        native_sync: goalState.native_sync.status,
        ...(goalState.native_sync.status === "pending" ? { native_action: nativeAction() } : {}),
        idempotent: true,
      };
    }
    if (state.goal_refresh_pending) fail("goal refresh requires DAG delta before finalize");
    if (plan.goal_digest !== digestFile(goalPath)) fail("finalize goal digest mismatch");
    if (plan.safety.status === "needs_user_review") fail("plan safety requires user review");
    const coverageSummary = summarizeCoverage(plan, coverage, state);
    const uncovered = coverageSummary.uncovered_plan_item_ids            ;
    if (uncovered.length > 0) {
      fail(`required plan items are not planned: ${uncovered.join(", ")}`);
    }
    const unresolved = plan.tasks.filter((task) => !dependencyResolved(task.id, plan, state));
    if (unresolved.length > 0) {
      fail(`goal has unresolved tasks: ${unresolved.map((task) => `${task.id}:${state.tasks[task.id].status}`).join(", ")}`);
    }
    const incomplete = coverageSummary.incomplete_plan_item_ids            ;
    if (incomplete.length > 0) {
      fail(`required plan items are not completed: ${incomplete.join(", ")}`);
    }
    const inspection = inspectCompletion(planPath, plan, goal, coverage, state);
    if (inspection.problems.length > 0) {
      fail(`completion checks failed: ${inspection.problems.join("; ")}`);
    }
    if (!existsSync(goal.source.path) || digestFile(goal.source.path) !== goal.source.digest) {
      fail("finalize source changed before completion freeze");
    }
    const completedAt = new Date().toISOString();
    const resultRef = goalResultPathFor(goalPath);
    const finalTasks = plan.tasks
      .filter((task) => task.node_type === "leaf" && state.tasks[task.id].status !== "superseded")
      .map((task) => {
        const taskState = state.tasks[task.id];
        const raw = taskState.result_ref === null
          ? null
          : requireRecord(readJson(taskState.result_ref), `final task result ${task.id}`);
        return {
          id: task.id,
          title: task.title,
          role: task.role,
          status: taskState.status,
          summary: raw === null || typeof raw.summary !== "string"
            ? ""
            : compactUserSummary(raw.summary),
          changed_files: raw === null || !Array.isArray(raw.changed_files)
            ? []
            : requireStringArray(raw.changed_files, `final task result ${task.id}.changed_files`),
          blocking_findings: raw === null || !Array.isArray(raw.blocking_findings)
            ? []
            : requireStringArray(
              raw.blocking_findings,
              `final task result ${task.id}.blocking_findings`,
            ),
        };
      });
    const finalResult = {
      contract: "GOAL_RESULT_V1",
      goal_id: goal.goal_id,
      objective: goal.objective,
      status: "completed",
      completed_at: completedAt,
      task_count: finalTasks.length,
      tasks: finalTasks,
    };
    goalState.status = "completed";
    goalState.result_ref = resultRef;
    goalState.completed_at = completedAt;
    if (goalState.controller === "codex_native") {
      goalState.native_sync.status = "pending";
      goalState.native_sync.completion_token = randomUUID();
    }
    writeTransaction(goalStatePath, [[resultRef, finalResult], [goalStatePath, goalState]]);
    return {
      status: "completed",
      goal_id: goal.goal_id,
      result_ref: resultRef,
      task_count: finalTasks.length,
      native_sync: goalState.native_sync.status,
      ...(goalState.native_sync.status === "pending" ? { native_action: nativeAction() } : {}),
      idempotent: false,
    };
  }));
  const receipt = payload                           ;
  if (receipt.status === "completed") {
    cleanupCompletedGoal(goalPath);
  }
  process.stdout.write(`${JSON.stringify(compact ? {
    status: receipt.status,
    goal_id: receipt.goal_id,
    result_ref: receipt.result_ref,
    task_count: receipt.task_count,
    native_sync: receipt.native_sync,
    ...(receipt.native_action === undefined ? {} : { native_action: receipt.native_action }),
    idempotent: receipt.idempotent,
  } : payload)}\n`);
}

function nativeConfirmCommand(
  goalArgument        ,
  goalStateArgument        ,
  completionToken        ,
)       {
  const goalPath = resolve(goalArgument);
  const goalStatePath = canonicalPath(goalStatePathFor(goalPath), goalStateArgument, "goal state path");
  const dagStatePath = join(dirname(goalPath), "state.json");
  const token = requireString(completionToken, "completion_token");
  const payload = withStateLock(goalStatePath, () => withStateLock(dagStatePath, () => {
    const goal = parseGoal(readJson(goalPath), false);
    const goalState = parseGoalState(readJson(goalStatePath), goal, {
      verifyExecutionArtifacts: false,
    });
    if (goalState.goal_digest !== digestFile(goalPath)) fail("goal digest mismatch");
    if (goalState.controller !== "codex_native") fail("native-confirm requires codex_native controller");
    if (goalState.status !== "completed") fail("native-confirm requires completed local goal");
    if (goalState.native_sync.completion_token !== token) fail("completion token mismatch");
    if (goalState.native_sync.status === "confirmed") {
      return { status: "confirmed", goal_id: goal.goal_id, idempotent: true };
    }
    if (goalState.native_sync.status !== "pending") fail("native completion is not pending");
    goalState.native_sync.status = "confirmed";
    goalState.native_sync.confirmed_at = new Date().toISOString();
    writeJson(goalStatePath, goalState);
    return { status: "confirmed", goal_id: goal.goal_id, idempotent: false };
  }));
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function ownerLeaseInspectCommand(workspaceArgument        , ownerIdArgument        )       {
  const workspaceRoot = resolve(workspaceArgument);
  const ownerId = requireIdentifier(ownerIdArgument, "owner_id");
  const leasePath = ownerLeasePathFor(workspaceRoot, ownerId);
  mkdirSync(dirname(leasePath), { recursive: true });
  const payload = withStateLock(leasePath, () => {
    if (!existsSync(leasePath)) {
      return { owner_id: ownerId, status: "free", lease_ref: leasePath };
    }
    const lease = parseOwnerLease(readJson(leasePath), ownerId);
    let taskRuntime          = null;
    if (existsSync(lease.state_path)) {
      try {
        const rawState = requireRecord(readJson(lease.state_path), "leased goal state");
        const tasks = requireRecord(rawState.tasks, "leased goal state.tasks");
        taskRuntime = tasks[lease.task_id] ?? null;
      } catch (error) {
        taskRuntime = {
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return {
      owner_id: ownerId,
      status: "leased",
      lease_ref: leasePath,
      lease,
      state_exists: existsSync(lease.state_path),
      task_runtime: taskRuntime,
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function ownerLeaseHeartbeatCommand(
  workspaceArgument        ,
  ownerIdArgument        ,
  reservationToken        ,
)       {
  const workspaceRoot = resolve(workspaceArgument);
  const ownerId = requireIdentifier(ownerIdArgument, "owner_id");
  const token = requireString(reservationToken, "reservation_token");
  const leasePath = ownerLeasePathFor(workspaceRoot, ownerId);
  mkdirSync(dirname(leasePath), { recursive: true });
  const lease = withStateLock(leasePath, () => {
    if (!existsSync(leasePath)) fail(`owner lease is missing for ${ownerId}`);
    const current = parseOwnerLease(readJson(leasePath), ownerId);
    if (current.reservation_token !== token) fail("owner lease reservation token mismatch");
    current.heartbeat_at = new Date().toISOString();
    writeJson(leasePath, current);
    return current;
  });
  process.stdout.write(`${JSON.stringify({ status: "heartbeat_recorded", lease })}\n`);
}

function ownerLeaseRecoverCommand(
  workspaceArgument        ,
  ownerIdArgument        ,
  reservationToken        ,
  reasonArgument        ,
)       {
  const workspaceRoot = resolve(workspaceArgument);
  const ownerId = requireIdentifier(ownerIdArgument, "owner_id");
  const token = requireString(reservationToken, "reservation_token");
  const reason = requireString(reasonArgument, "reason");
  const leasePath = ownerLeasePathFor(workspaceRoot, ownerId);
  mkdirSync(dirname(leasePath), { recursive: true });
  const payload = withStateLock(leasePath, () => {
    if (!existsSync(leasePath)) {
      return { owner_id: ownerId, status: "free", recovered: false, idempotent: true };
    }
    const lease = parseOwnerLease(readJson(leasePath), ownerId);
    if (lease.reservation_token !== token) fail("owner lease reservation token mismatch");
    void reason;
    unlinkSync(leasePath);
    return {
      owner_id: ownerId,
      status: "free",
      recovered: true,
      idempotent: false,
      previous_goal_id: lease.goal_id,
      previous_task_id: lease.task_id,
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function expandTaskScopeCommand(
  planArgument        ,
  stateArgument        ,
  taskId        ,
  reservationToken        ,
  requestedPaths          ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  if (requestedPaths.length === 0) fail("expand-task-scope requires at least one path");
  let obsoleteResultRef                = null;
  const payload = withStateLock(statePath, () => {
    const { plan, goal, state } = loadPlanAndState(planPath, statePath, {
      allowSourceDrift: true,
    });
    assertGoalMutable(planPath, plan, goal);
    const task = plan.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) fail(`unknown task: ${taskId}`);
    if (task.role !== "work" || task.owner_id === null) fail("only Owner work task scope can expand");
    const taskState = state.tasks[task.id];
    const reopenRepair = taskState.status === "needs_repair";
    if (!reopenRepair && taskState.status !== "reserved" && taskState.status !== "running") {
      fail(`task ${task.id} scope can only expand while active or after needs_repair`);
    }
    if (taskState.reservation_token !== reservationToken) fail("reservation token mismatch");
    const registry = approvedOwnerRegistry(goal);
    const normalizedPaths = requestedPaths.map((path) => {
      const normalized = normalizePathPattern(path);
      if (/[*?\[\]{}]/u.test(normalized)) {
        fail(`expand-task-scope accepts exact repository paths only: ${path}`);
      }
      return normalized;
    });
    ensureUnique(normalizedPaths, "expanded task path");
    if (reopenRepair) {
      if (taskState.result_ref === null || taskState.result_digest === null) {
        fail(`needs_repair task ${task.id} has no accepted result`);
      }
      const accepted = parseWorkerResult(
        readJson(taskState.result_ref),
        task,
        subjectForTask(plan, task),
        taskState,
      );
      if (accepted.scope_request === null) fail("needs_repair result has no scope_request");
      if (accepted.changed_files.length > 0) {
        fail("task scope cannot auto-expand after needs_repair with attributed changes");
      }
      const requested = new Set(accepted.scope_request.paths);
      for (const path of normalizedPaths) {
        if (!requested.has(path)) fail(`expanded path was not requested by the worker: ${path}`);
      }
    }
    const routed = normalizedPaths.map((path) => {
      const matches = registry.owners.filter((owner) =>
        owner.scope_patterns.some((pattern) => pathMatchesPattern(path, pattern)) &&
        !owner.scope_excludes.some((pattern) => pathMatchesPattern(path, pattern)),
      );
      if (matches.length === 0) fail(`expanded path is unowned and requires user routing: ${path}`);
      if (matches.length > 1) fail(`expanded path matches conflicting owners: ${path}`);
      if (matches[0].id !== task.owner_id) {
        fail(`expanded path belongs to owner ${matches[0].id}, not ${task.owner_id}: ${path}`);
      }
      return { path, owner_id: matches[0].id };
    });
    taskState.expanded_writable_paths = uniqueStrings([
      ...taskState.expanded_writable_paths,
      ...normalizedPaths,
    ]).sort(compareStableStrings);
    let reopenedCapsule                      = null;
    if (reopenRepair) {
      const previousResultRef = taskState.result_ref          ;
      obsoleteResultRef = previousResultRef;
      const owner = subjectForTask(plan, task)                   ;
      const ownerState = subjectStateForTask(state, task);
      ownerState.result_refs = ownerState.result_refs.filter((ref) => ref !== previousResultRef);
      reopenedCapsule = loadOwnerCapsule(
        owner,
        ownerState,
        state.goal_digest,
        state.source_revision,
      );
      reopenedCapsule.result_refs = reopenedCapsule.result_refs.filter(
        (ref) => ref !== previousResultRef,
      );
      reopenedCapsule.verification = reopenedCapsule.verification.filter(
        (item) => item.result_ref !== previousResultRef,
      );
      reopenedCapsule.progress = `scope expanded for retry: ${normalizedPaths.join(", ")}`;
      reopenedCapsule.updated_at = new Date().toISOString();
      taskState.status = "pending";
      taskState.reservation_token = null;
      taskState.owner_generation = null;
      taskState.executor_id = null;
      taskState.reserved_at = null;
      taskState.result_path = null;
      taskState.result_ref = null;
      taskState.result_digest = null;
      taskState.task_baseline_ref = null;
      taskState.task_baseline_digest = null;
      taskState.accepted_change_seq = null;
    }
    if (reopenedCapsule === null) writeJson(statePath, state);
    else writeTransaction(statePath, [
      [(subjectStateForTask(state, task).capsule_ref          ), reopenedCapsule],
      [statePath, state],
    ]);
    return {
      status: reopenRepair ? "expanded_and_queued" : "expanded",
      task_id: task.id,
      owner_id: task.owner_id,
      added_paths: normalizedPaths,
      routed,
      writable_paths: effectiveWritablePaths(task, taskState),
      binding: reopenRepair ? null : taskBinding(planPath, plan, goal, state, task),
    };
  });
  if (obsoleteResultRef !== null) rmSync(obsoleteResultRef, { force: true });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

















function validateTaskSubgraphRequest(
  value         ,
  task                ,
  taskState           ,
)                                                                                    {
  const source = requireRecord(value, "task subgraph request");
  if (source.contract !== "TASK_SUBGRAPH_REQUEST_V1") {
    fail("task subgraph request contract must equal TASK_SUBGRAPH_REQUEST_V1");
  }
  if (source.task_id !== task.id) fail("task subgraph request task_id mismatch");
  if (source.reservation_token !== taskState.reservation_token) {
    fail("task subgraph request reservation_token mismatch");
  }
  if (source.attempt !== taskState.attempt) fail("task subgraph request attempt mismatch");
  if (source.source_revision !== taskState.source_revision) {
    fail("task subgraph request source_revision mismatch");
  }
  if (source.owner_generation !== taskState.owner_generation) {
    fail("task subgraph request owner_generation mismatch");
  }
  if (source.executor_id !== taskState.executor_id) {
    fail("task subgraph request executor_id mismatch");
  }
  return {
    reason: requireString(source.reason, "task subgraph request.reason"),
    required_capabilities: requireStringArray(
      source.required_capabilities,
      "task subgraph request.required_capabilities",
    ),
    suggested_subtasks: requireStringArray(
      source.suggested_subtasks,
      "task subgraph request.suggested_subtasks",
    ),
  };
}

function parseTaskSubgraphExpansion(value         )                        {
  const source = requireRecord(value, "task subgraph expansion");
  if (source.contract !== "TASK_SUBGRAPH_EXPANSION_V1") {
    fail("task subgraph expansion contract must equal TASK_SUBGRAPH_EXPANSION_V1");
  }
  if (source.completion_policy !== "all_required") {
    fail("task subgraph expansion completion_policy must equal all_required");
  }
  if (!Array.isArray(source.children) || source.children.length === 0) {
    fail("task subgraph expansion children must be a non-empty array");
  }
  const safety = requireRecord(source.safety, "task subgraph expansion.safety");
  if (
    safety.status !== "parallel_safe" && safety.status !== "sequential_only" &&
    safety.status !== "needs_user_review"
  ) fail("task subgraph expansion safety.status is invalid");
  return {
    contract: "TASK_SUBGRAPH_EXPANSION_V1",
    base_plan_digest: requireString(
      source.base_plan_digest,
      "task subgraph expansion.base_plan_digest",
    ),
    revision: requirePositiveInteger(source.revision, "task subgraph expansion.revision"),
    parent_task_id: requireIdentifier(
      source.parent_task_id,
      "task subgraph expansion.parent_task_id",
    ),
    reservation_token: requireString(
      source.reservation_token,
      "task subgraph expansion.reservation_token",
    ),
    request_ref: requireString(source.request_ref, "task subgraph expansion.request_ref"),
    request_digest: requireString(source.request_digest, "task subgraph expansion.request_digest"),
    reason: requireString(source.reason, "task subgraph expansion.reason"),
    completion_policy: "all_required",
    children: source.children.map(parseTask),
    entry_task_ids: requireStringArray(
      source.entry_task_ids,
      "task subgraph expansion.entry_task_ids",
      false,
    ).map((id, index) => requireIdentifier(
      id,
      `task subgraph expansion.entry_task_ids[${index}]`,
    )),
    exit_task_ids: requireStringArray(
      source.exit_task_ids,
      "task subgraph expansion.exit_task_ids",
      false,
    ).map((id, index) => requireIdentifier(
      id,
      `task subgraph expansion.exit_task_ids[${index}]`,
    )),
    safety: {
      status: safety.status                ,
      reasons: requireStringArray(safety.reasons, "task subgraph expansion.safety.reasons"),
    },
  };
}

function expandTaskSubgraphInput(
  value                         ,
  plan      ,
  state          ,
  parent                ,
  parentState           ,
  requestPath        ,
  request                                                ,
)                          {
  if (value.contract !== "TASK_SUBGRAPH_INPUT_V1") return value;
  requireAllowedKeys(
    value,
    ["contract", "children", "entry", "exit", "safety", "safety_reasons"],
    "task subgraph input",
  );
  if (parent.role !== "work" || parent.owner_id === null) {
    fail("only Owner work task can expand through TASK_SUBGRAPH_INPUT_V1");
  }
  if (!Array.isArray(value.children) || value.children.length === 0) {
    fail("task subgraph input.children must be a non-empty array");
  }
  const children = value.children.map((child, index) => expandPlanInputTask(child, index, {
    parent_task_id: parent.id,
    owner_id: parent.owner_id,
  }));
  const safetyStatus = (value.safety ?? plan.safety.status)                ;
  if (!new Set              (["parallel_safe", "sequential_only", "needs_user_review"]).has(
    safetyStatus,
  )) fail(`task subgraph input.safety is invalid: ${String(value.safety)}`);
  return {
    contract: "TASK_SUBGRAPH_EXPANSION_V1",
    base_plan_digest: state.plan_digest,
    revision: plan.revision + 1,
    parent_task_id: parent.id,
    reservation_token: parentState.reservation_token,
    request_ref: requestPath,
    request_digest: digestFile(requestPath),
    reason: request.reason,
    completion_policy: "all_required",
    children,
    entry_task_ids: requireStringArray(value.entry, "task subgraph input.entry", false),
    exit_task_ids: requireStringArray(value.exit, "task subgraph input.exit", false),
    safety: {
      status: safetyStatus,
      reasons: value.safety_reasons === undefined
        ? plan.safety.reasons
        : requireStringArray(value.safety_reasons, "task subgraph input.safety_reasons"),
    },
  };
}

function pendingTaskState(sourceRevision        )            {
  return {
    status: "pending",
    attempt: 0,
    reservation_token: null,
    owner_generation: null,
    executor_id: null,
    source_revision: sourceRevision,
    validated_source_revision: sourceRevision,
    reserved_at: null,
    result_path: null,
    result_ref: null,
    result_digest: null,
    replacement_task_id: null,
    last_reclaimed_token: null,
    task_baseline_ref: null,
    task_baseline_digest: null,
    expanded_writable_paths: [],
    accepted_change_seq: null,
  };
}

function expandSubgraphCommand(
  planArgument        ,
  stateArgument        ,
  parentTaskId        ,
  reservationToken        ,
  expansionArgument        ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const expansionPath = resolve(expansionArgument);
  const payload = withStateLock(statePath, () => {
    const { plan, goal, coverage, state } = loadPlanAndState(planPath, statePath);
    assertGoalMutable(planPath, plan, goal);
    const parent = plan.tasks.find((task) => task.id === parentTaskId);
    if (parent === undefined) fail(`unknown task: ${parentTaskId}`);
    if (parent.node_type !== "leaf") fail(`task ${parentTaskId} is already composite`);
    if (parent.satisfies_goal_gates.length > 0) {
      fail("a task that directly satisfies a goal gate cannot expand into a subgraph");
    }
    const parentState = state.tasks[parent.id];
    if (parentState.status !== "reserved" && parentState.status !== "running") {
      fail(`task ${parent.id} can only expand while reserved or running`);
    }
    if (parentState.reservation_token !== reservationToken) fail("reservation token mismatch");
    if (parentState.result_ref !== null || parentState.result_digest !== null) {
      fail(`task ${parent.id} already has an accepted result`);
    }
    if (parentState.result_path === null) fail(`task ${parent.id} result_path is missing`);
    const expansionInput = expansionArgument === "-"
      ? readStructuredInput("-")
      : requireRecord(readJson(expansionPath), "task subgraph input");
    const expectedRequestPath = subgraphRequestPathFor(parentState.result_path);
    const requestPath = expansionInput.contract === "TASK_SUBGRAPH_INPUT_V1"
      ? expectedRequestPath
      : canonicalPath(
        expectedRequestPath,
        requireString(expansionInput.request_ref, "task subgraph expansion.request_ref"),
        "task subgraph expansion.request_ref",
      );
    if (!existsSync(requestPath)) fail("task subgraph expansion request is missing");
    const expectedRequestDigest = expansionInput.contract === "TASK_SUBGRAPH_INPUT_V1"
      ? digestFile(requestPath)
      : requireString(expansionInput.request_digest, "task subgraph expansion.request_digest");
    if (digestFile(requestPath) !== expectedRequestDigest) {
      fail("task subgraph expansion request digest mismatch");
    }
    const request = validateTaskSubgraphRequest(readJson(requestPath), parent, parentState);
    const expansion = parseTaskSubgraphExpansion(expandTaskSubgraphInput(
      expansionInput,
      plan,
      state,
      parent,
      parentState,
      requestPath,
      request,
    ));
    if (expansion.base_plan_digest !== state.plan_digest) {
      fail("task subgraph expansion base_plan_digest mismatch");
    }
    if (expansion.revision !== plan.revision + 1) {
      fail("task subgraph expansion revision must increment plan revision by one");
    }
    if (expansion.parent_task_id !== parentTaskId) {
      fail("task subgraph expansion parent_task_id mismatch");
    }
    if (expansion.reservation_token !== reservationToken) {
      fail("task subgraph expansion reservation_token mismatch");
    }
    if (request.reason !== expansion.reason) {
      fail("task subgraph expansion reason must match the worker request");
    }
    const parentSubjectState = subjectStateForTask(state, parent);
    if (parentSubjectState.current_task_id !== parent.id) {
      fail(`execution subject is not assigned to task ${parent.id}`);
    }
    if (parentState.status === "running") {
      if (parentState.task_baseline_ref === null || parentState.task_baseline_digest === null) {
        fail(`task ${parent.id} baseline is missing`);
      }
      if (digestFile(parentState.task_baseline_ref) !== parentState.task_baseline_digest) {
        fail(`task ${parent.id} baseline digest mismatch`);
      }
      const baseline = parseWorktreeBaseline(
        readJson(parentState.task_baseline_ref),
        goal.workspace.root,
      );
      const current = captureWorktreeSnapshot(goal.workspace.root);
      if (current.tree_oid !== baseline.tree_oid) {
        fail(`task ${parent.id} observed a Git tree content change`);
      }
      const attributed = changedWorktreePaths(baseline, current).filter((path) =>
        effectiveWritablePaths(parent, parentState).some((pattern) => pathMatchesPattern(path, pattern))
      );
      if (attributed.length > 0) {
        fail(`task ${parent.id} must expand before making attributable changes: ${attributed.join(", ")}`);
      }
    }
    ensureUnique(expansion.children.map((child) => child.id), "subgraph child task id");
    ensureUnique(expansion.children.map((child) => child.logical_id), "subgraph child logical id");
    ensureUnique(expansion.entry_task_ids, "subgraph entry task id");
    ensureUnique(expansion.exit_task_ids, "subgraph exit task id");
    const existingTaskIds = new Set(plan.tasks.map((task) => task.id));
    const existingLogicalIds = new Set(plan.tasks.map((task) => task.logical_id));
    for (const child of expansion.children) {
      if (existingTaskIds.has(child.id)) fail(`subgraph task already exists: ${child.id}`);
      if (existingLogicalIds.has(child.logical_id)) {
        fail(`subgraph logical task already exists: ${child.logical_id}`);
      }
      if (child.parent_task_id !== parent.id) {
        fail(`subgraph task ${child.id} parent_task_id must equal ${parent.id}`);
      }
      if (child.satisfies_goal_gates.length > 0) {
        fail(`subgraph task ${child.id} cannot directly satisfy goal gates`);
      }
    }
    const coveredPlanItems = new Set(expansion.children
      .filter((child) => child.coverage_effect === parent.coverage_effect)
      .flatMap((child) => child.plan_item_ids));
    for (const itemId of parent.plan_item_ids) {
      if (!coveredPlanItems.has(itemId)) {
        fail(`subgraph does not preserve parent coverage ${itemId}:${parent.coverage_effect}`);
      }
    }
    const coveredVerificationIds = new Set(expansion.children.flatMap((child) => child.verification_ids));
    for (const verificationId of parent.verification_ids) {
      if (!coveredVerificationIds.has(verificationId)) {
        fail(`subgraph does not preserve parent verification: ${verificationId}`);
      }
    }
    const auditPath = join(
      dirname(planPath),
      "expansions",
      parent.id,
      `revision-${expansion.revision}.json`,
    );
    const auditDigest = digestJson(expansion);
    const expandedParent                 = {
      ...parent,
      node_type: "composite",
      subgraph: {
        contract: "TASK_SUBGRAPH_V1",
        parent_task_id: parent.id,
        task_ids: expansion.children.map((child) => child.id),
        entry_task_ids: expansion.entry_task_ids,
        exit_task_ids: expansion.exit_task_ids,
        completion_policy: "all_required",
        expanded_from_attempt: parentState.attempt,
        expansion_reason: expansion.reason,
        expansion_ref: auditPath,
        expansion_digest: auditDigest,
      },
    };
    const nextPlan       = {
      ...plan,
      revision: expansion.revision,
      tasks: plan.tasks.map((task) => task.id === parent.id ? expandedParent : task)
        .concat(expansion.children),
      safety: expansion.safety,
    };
    const liveTaskIds = new Set(nextPlan.tasks
      .filter((task) => state.tasks[task.id]?.status !== "superseded")
      .map((task) => task.id));
    validateGraph(nextPlan, goal, false, liveTaskIds);
    for (const child of expansion.children) {
      state.tasks[child.id] = pendingTaskState(state.source_revision);
      if (child.role === "review") {
        state.reviewers[taskSubjectId(child)] = {
          generation: 1,
          bound_executor_id: null,
          status: "unbound",
          current_task_id: null,
          capsule_ref: null,
          completed_task_ids: [],
          result_refs: [],
        };
      }
    }
    parentState.status = "pending";
    parentState.reservation_token = null;
    parentState.owner_generation = null;
    parentState.executor_id = null;
    parentState.reserved_at = null;
    parentState.result_path = null;
    parentState.result_ref = null;
    parentState.result_digest = null;
    parentState.task_baseline_ref = null;
    parentState.task_baseline_digest = null;
    parentState.accepted_change_seq = null;
    parentSubjectState.status = parentSubjectState.bound_executor_id === null ? "unbound" : "idle";
    parentSubjectState.current_task_id = null;
    const canonicalPlanDigest = digestJson(nextPlan);
    const nextCoverage               = {
      ...coverage,
      plan_revision: nextPlan.revision,
      plan_digest: canonicalPlanDigest,
    };
    state.plan_digest = canonicalPlanDigest;
    state.revision = nextPlan.revision;
    const writes                           = [
      [auditPath, expansion],
      [planPath, nextPlan],
      [plan.coverage_path, nextCoverage],
    ];
    if (parent.owner_id !== null) {
      const owner = subjectForTask(nextPlan, expandedParent)                   ;
      const capsule = loadOwnerCapsule(owner, parentSubjectState, state.goal_digest, state.source_revision);
      capsule.active_task_id = null;
      capsule.progress = `expanded ${parent.id} into ${expansion.children.length} subgraph tasks`;
      capsule.checkpoint_ref = null;
      capsule.next_steps = expansion.entry_task_ids;
      capsule.updated_at = new Date().toISOString();
      writes.push([parentSubjectState.capsule_ref          , capsule]);
    }
    writes.push([statePath, state]);
    writeTransaction(statePath, writes);
    releaseOwnerLease(goal, parent, reservationToken);
    return {
      status: "expanded",
      parent_task_id: parent.id,
      node_type: "composite",
      child_task_ids: expansion.children.map((child) => child.id),
      entry_task_ids: expansion.entry_task_ids,
      exit_task_ids: expansion.exit_task_ids,
      plan_revision: nextPlan.revision,
      plan_digest: canonicalPlanDigest,
      expansion_ref: auditPath,
      expansion_digest: auditDigest,
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function subgraphRequestCommand(
  planArgument        ,
  stateArgument        ,
  taskId        ,
  reservationToken        ,
  reasonArgument        ,
  suggestedSubtasks          ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const reason = requireString(reasonArgument, "reason");
  const payload = withStateLock(statePath, () => {
    const { plan, goal, state } = loadPlanAndState(planPath, statePath, { allowSourceDrift: true });
    assertGoalMutable(planPath, plan, goal);
    const task = plan.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) fail(`unknown task: ${taskId}`);
    const taskState = state.tasks[taskId];
    if (task.node_type !== "leaf") fail(`task ${taskId} is already composite`);
    if (task.role !== "work" || task.owner_id === null) {
      fail(`task ${taskId} is not an Owner work task`);
    }
    if (taskState.status !== "running") fail(`task ${taskId} is not running`);
    if (taskState.reservation_token !== reservationToken) fail("reservation token mismatch");
    if (
      taskState.result_path === null || taskState.owner_generation === null ||
      taskState.executor_id === null
    ) fail(`task ${taskId} binding is incomplete`);
    const requestPath = subgraphRequestPathFor(taskState.result_path);
    const request = {
      contract: "TASK_SUBGRAPH_REQUEST_V1",
      task_id: task.id,
      reservation_token: reservationToken,
      attempt: taskState.attempt,
      source_revision: taskState.source_revision,
      owner_generation: taskState.owner_generation,
      executor_id: taskState.executor_id,
      reason,
      required_capabilities: [],
      suggested_subtasks: suggestedSubtasks.map((value, index) =>
        requireString(value, `suggested_subtasks[${index}]`)
      ),
    };
    validateTaskSubgraphRequest(request, task, taskState);
    const status = writeImmutableJson(requestPath, request);
    return {
      contract: "TASK_SUBGRAPH_REQUEST_RECEIPT_V1",
      status,
      task_id: task.id,
      thread_title: compositePlannerThreadTitle(task),
      request_ref: requestPath,
      request_digest: digestFile(requestPath),
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function readStructuredInput(expectedContract        )                          {
  const raw = readFileSync(0, "utf8");
  if (Buffer.byteLength(raw, "utf8") > 16 * 1024 * 1024) {
    fail("structured input exceeds 16 MiB");
  }
  let value         ;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    fail(`structured input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const body = requireRecord(value, "structured input");
  if (expectedContract !== "-" && body.contract !== expectedContract) {
    fail(`structured input contract must equal ${expectedContract}`);
  }
  return body;
}

function validateThreadEndpoint(value         , label        )       {
  const endpoint = requireRecord(value, label);
  assertExactFields(endpoint, ["thread_id", "host_id"], label);
  requireString(endpoint.thread_id, `${label}.thread_id`);
  requireString(endpoint.host_id, `${label}.host_id`);
}

function assertExactFields(
  source                         ,
  expected          ,
  label        ,
)       {
  requireExactKeys(source, expected, label);
}

function validateThreadRegistry(value                         )       {
  assertExactFields(
    value,
    ["contract", "goal_id", "main", "threads", "watches"],
    "thread registry",
  );
  if (value.contract !== "THREAD_REGISTRY_V1") {
    fail("thread registry contract must equal THREAD_REGISTRY_V1");
  }
  requireIdentifier(value.goal_id, "thread registry.goal_id");
  validateThreadEndpoint(value.main, "thread registry.main");
  const threads = requireRecord(value.threads, "thread registry.threads");
  const threadIds           = [];
  for (const [threadKeyValue, threadValue] of Object.entries(threads)) {
    if (!THREAD_KEY_PATTERN.test(threadKeyValue) || threadKeyValue.length > THREAD_KEY_MAX_LENGTH) {
      fail(`thread registry key is invalid: ${threadKeyValue}`);
    }
    const thread = requireRecord(threadValue, `thread registry.threads.${threadKeyValue}`);
    if (!Object.hasOwn(thread, "cursor")) thread.cursor = null;
    assertExactFields(
      thread,
      ["thread_id", "host_id", "role", "status", "cursor"],
      `thread registry.threads.${threadKeyValue}`,
    );
    threadIds.push(requireString(thread.thread_id, `thread registry.threads.${threadKeyValue}.thread_id`));
    requireString(thread.host_id, `thread registry.threads.${threadKeyValue}.host_id`);
    if (!["owner", "planner", "planner_reviewer", "review", "supervisor"].includes(
      String(thread.role),
    )) fail(`thread registry.threads.${threadKeyValue}.role is invalid`);
    if (![
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
    ].includes(String(thread.status))) {
      fail(`thread registry.threads.${threadKeyValue}.status is invalid`);
    }
    requireNullableString(thread.cursor, `thread registry.threads.${threadKeyValue}.cursor`);
  }
  ensureUnique(threadIds, "thread registry thread id");
  if (!Array.isArray(value.watches)) fail("thread registry.watches must be an array");
  const watchIds           = [];
  value.watches.forEach((watchValue, index) => {
    const watch = requireRecord(watchValue, `thread registry.watches[${index}]`);
    if (!Object.hasOwn(watch, "unchanged_waits")) watch.unchanged_waits = 0;
    const taskId = requireIdentifier(watch.task_id, `thread registry.watches[${index}].task_id`);
    const attempt = requirePositiveInteger(watch.attempt, `thread registry.watches[${index}].attempt`);
    const threadKeyValue = requireString(
      watch.thread_key,
      `thread registry.watches[${index}].thread_key`,
    );
    if (!Object.hasOwn(threads, threadKeyValue)) {
      fail(`thread registry watch references unknown thread: ${threadKeyValue}`);
    }
    if (Object.hasOwn(watch, "cursor")) {
      const legacyCursor = requireNullableString(
        watch.cursor,
        `thread registry.watches[${index}].cursor`,
      );
      const thread = requireRecord(threads[threadKeyValue], `thread registry.threads.${threadKeyValue}`);
      if (thread.cursor === null) thread.cursor = legacyCursor;
      delete watch.cursor;
    }
    assertExactFields(
      watch,
      ["task_id", "attempt", "thread_key", "unchanged_waits"],
      `thread registry.watches[${index}]`,
    );
    watchIds.push(`${taskId}\u0000${attempt}\u0000${threadKeyValue}`);
    requireNonNegativeInteger(
      watch.unchanged_waits,
      `thread registry.watches[${index}].unchanged_waits`,
    );
  });
  ensureUnique(watchIds, "thread registry watch identity");
}

function threadRegistryCommand(action        , args          )       {
  const path = resolve(args[0] ?? fail("thread-registry requires <threads.json>"));
  const receipt = withStateLock(path, () => {
    if (action === "init") {
      if (args.length !== 4) {
        fail("thread-registry init requires <threads.json> <goal_id> <main_thread_id> <main_host_id>");
      }
      const next = {
        contract: "THREAD_REGISTRY_V1",
        goal_id: requireIdentifier(args[1], "goal_id"),
        main: {
          thread_id: requireString(args[2], "main_thread_id"),
          host_id: requireString(args[3], "main_host_id"),
        },
        threads: {},
        watches: [],
      };
      validateThreadRegistry(next);
      if (existsSync(path)) {
        const current = requireRecord(readJson(path), "thread registry");
        validateThreadRegistry(current);
        if (digestJson(current) !== digestJson(next)) {
          fail("thread registry already exists with different main routing");
        }
        return { status: "current", path, digest: digestFile(path) };
      }
      writeJson(path, next);
      return { status: "initialized", path, digest: digestFile(path) };
    }
    if (!existsSync(path)) fail(`thread registry is missing: ${path}`);
    const registry = requireRecord(readJson(path), "thread registry");
    validateThreadRegistry(registry);
    const threads = requireRecord(registry.threads, "thread registry.threads");
    const watches = registry.watches                             ;
    if (action === "put-thread") {
      if (args.length !== 6 && args.length !== 7) {
        fail("thread-registry put-thread requires <threads.json> <thread_key> <thread_id> <host_id> <role> <status> [cursor|-]");
      }
      const threadKeyValue = requireString(args[1], "thread_key");
      const threadId = requireString(args[2], "thread_id");
      const current = Object.hasOwn(threads, threadKeyValue)
        ? requireRecord(threads[threadKeyValue], `thread registry.threads.${threadKeyValue}`)
        : null;
      const cursor = args.length === 7
        ? args[6] === "-" ? null : requireString(args[6], "cursor")
        : current !== null && current.thread_id === threadId
        ? requireNullableString(current.cursor, "thread cursor")
        : null;
      threads[threadKeyValue] = {
        thread_id: threadId,
        host_id: requireString(args[3], "host_id"),
        role: requireString(args[4], "role"),
        status: requireString(args[5], "status"),
        cursor,
      };
      validateThreadRegistry(registry);
      writeJson(path, registry);
      return { status: "thread_saved", thread_key: args[1], digest: digestFile(path) };
    }
    if (action === "set-status") {
      if (args.length !== 3) {
        fail("thread-registry set-status requires <threads.json> <thread_key> <status>");
      }
      const threadKeyValue = requireString(args[1], "thread_key");
      const thread = requireRecord(threads[threadKeyValue], `thread registry.threads.${threadKeyValue}`);
      thread.status = requireString(args[2], "status");
      validateThreadRegistry(registry);
      writeJson(path, registry);
      return { status: "thread_status_saved", thread_key: threadKeyValue, digest: digestFile(path) };
    }
    if (action === "put-watch") {
      if (args.length < 4 || args.length > 5) {
        fail("thread-registry put-watch requires <threads.json> <task_id> <attempt> <thread_key> [cursor|-]");
      }
      const taskId = requireIdentifier(args[1], "task_id");
      const attempt = requirePositiveInteger(Number(args[2]), "attempt");
      const threadKeyValue = requireString(args[3], "thread_key");
      if (!Object.hasOwn(threads, threadKeyValue)) fail(`unknown thread key: ${threadKeyValue}`);
      const cursor = args[4] === undefined || args[4] === "-" ? null : requireString(args[4], "cursor");
      if (args[4] !== undefined) {
        const thread = requireRecord(threads[threadKeyValue], `thread registry.threads.${threadKeyValue}`);
        thread.cursor = cursor;
      }
      const next = {
        task_id: taskId,
        attempt,
        thread_key: threadKeyValue,
        unchanged_waits: 0,
      };
      const index = watches.findIndex((watch) =>
        watch.task_id === taskId && watch.attempt === attempt && watch.thread_key === threadKeyValue
      );
      if (index < 0) watches.push(next);
      else watches[index] = next;
      validateThreadRegistry(registry);
      writeJson(path, registry);
      return { status: "watch_saved", task_id: taskId, attempt, digest: digestFile(path) };
    }
    if (action === "remove-watch") {
      if (args.length !== 4) {
        fail("thread-registry remove-watch requires <threads.json> <task_id> <attempt> <thread_key>");
      }
      const taskId = requireIdentifier(args[1], "task_id");
      const attempt = requirePositiveInteger(Number(args[2]), "attempt");
      const threadKeyValue = requireString(args[3], "thread_key");
      registry.watches = watches.filter((watch) => !(
        watch.task_id === taskId && watch.attempt === attempt && watch.thread_key === threadKeyValue
      ));
      validateThreadRegistry(registry);
      writeJson(path, registry);
      return { status: "watch_removed", task_id: taskId, attempt, digest: digestFile(path) };
    }
    if (action === "show") {
      if (args.length !== 1) fail("thread-registry show requires <threads.json>");
      return { status: "current", path, registry, digest: digestFile(path) };
    }
    fail(`unknown thread-registry action: ${action}`);
  });
  process.stdout.write(`${JSON.stringify({ contract: "THREAD_REGISTRY_RECEIPT_V1", ...receipt })}\n`);
}

const SUPERVISOR_TERMINAL_STATES = new Set([
  "completed",
  "failed",
  "cancelled",
  "archived",
]);

const SUPERVISOR_NOTIFY_STATES = new Set([
  ...SUPERVISOR_TERMINAL_STATES,
  "needs_attention",
]);



function supervisorActionId(kind                      , taskId        , attempt        )         {
  const encoded = Buffer.from(JSON.stringify({ kind, task: taskId, attempt }), "utf8").toString("base64url");
  return `sa.${encoded}.${createHash("sha256").update(encoded).digest("hex").slice(0, 12)}`;
}

function parseSupervisorActionId(value        )



  {
  const match = /^sa\.([A-Za-z0-9_-]+)\.([0-9a-f]{12})$/u.exec(requireString(value, "action_id"));
  if (match === null) fail("supervisor action id is invalid");
  if (createHash("sha256").update(match[1]).digest("hex").slice(0, 12) !== match[2]) {
    fail("supervisor action id checksum mismatch");
  }
  let decoded         ;
  try {
    decoded = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
  } catch {
    fail("supervisor action id payload is invalid");
  }
  const payload = requireRecord(decoded, "supervisor action id payload");
  assertExactFields(payload, ["kind", "task", "attempt"], "supervisor action id payload");
  const kind = requireString(payload.kind, "supervisor action kind")                        ;
  if (!new Set                      (["create", "wait", "stalled", "notify"]).has(kind)) {
    fail("supervisor action kind is invalid");
  }
  return {
    kind,
    task: requireIdentifier(payload.task, "supervisor action task"),
    attempt: requirePositiveInteger(payload.attempt, "supervisor action attempt"),
  };
}

function supervisorPaths(goalDirectoryArgument        )




  {
  const goalDirectory = resolve(goalDirectoryArgument);
  const planPath = join(goalDirectory, "plan.json");
  const statePath = join(goalDirectory, "state.json");
  const threadsPath = join(goalDirectory, "threads.json");
  for (const path of [planPath, statePath, threadsPath]) {
    if (!existsSync(path)) fail(`supervisor runtime file is missing: ${path}`);
  }
  return { goalDirectory, planPath, statePath, threadsPath };
}

function readThreadRegistry(path        , goalId        )                          {
  const registry = requireRecord(readJson(path), "thread registry");
  validateThreadRegistry(registry);
  if (registry.goal_id !== goalId) fail("thread registry goal_id mismatch");
  return registry;
}

function registeredThreadForExecutor(
  threads                         ,
  executorId        ,
)                                                          {
  const matches = Object.entries(threads).filter(([, value]) =>
    requireRecord(value, "thread registry thread").thread_id === executorId
  );
  if (matches.length > 1) fail(`executor ${executorId} has duplicate thread registry entries`);
  return matches.length === 0
    ? null
    : { key: matches[0][0], thread: requireRecord(matches[0][1], "thread registry thread") };
}

function taskBindingSnapshotPath(
  goalDirectory        ,
  task                ,
  taskState           ,
)         {
  return join(goalDirectory, "bindings", `${task.id}-attempt-${taskState.attempt}.json`);
}

function readTaskBindingSnapshot(
  bindingPath        ,
  planPath        ,
  statePath        ,
  task                ,
  taskState           ,
  executorId        ,
)                          {
  if (!existsSync(bindingPath)) fail(`task binding snapshot is missing: ${bindingPath}`);
  const binding = requireRecord(readJson(bindingPath), "task binding snapshot");
  if (binding.contract !== "TASK_BINDING_V6") fail("task binding contract must equal TASK_BINDING_V6");
  const bindingTask = requireRecord(binding.task, "task binding.task");
  if (bindingTask.id !== task.id) fail("task binding task id mismatch");
  const run = requireRecord(binding.run, "task binding.run");
  if (requirePositiveInteger(run.attempt, "task binding.run.attempt") !== taskState.attempt) {
    fail("task binding attempt mismatch");
  }
  if (requireString(run.token, "task binding.run.token") !== taskState.reservation_token) {
    fail("task binding reservation token mismatch");
  }
  if (requirePositiveInteger(run.source_revision, "task binding.run.source_revision") !== taskState.source_revision) {
    fail("task binding source revision mismatch");
  }
  if (requireString(run.executor, "task binding.run.executor") !== executorId) {
    fail("task binding executor mismatch");
  }
  const refs = requireRecord(binding.refs, "task binding.refs");
  canonicalPath(planPath, requireString(refs.plan, "task binding.refs.plan"), "task binding plan ref");
  canonicalPath(statePath, requireString(refs.state, "task binding.refs.state"), "task binding state ref");
  if (taskState.result_path === null) fail("task binding result path is unavailable");
  canonicalPath(
    taskState.result_path,
    requireString(refs.result, "task binding.refs.result"),
    "task binding result ref",
  );
  return binding;
}

function supervisorResultNotice(
  plan      ,
  task                ,
  taskState           ,
)                                                 {
  if (taskState.result_path === null || !existsSync(taskState.result_path)) {
    return { result_ref: null, summary: "线程已结束，但尚未生成有效结果" };
  }
  try {
    const result = parseWorkerResult(
      readJson(taskState.result_path),
      task,
      subjectForTask(plan, task),
      taskState,
    );
    const summary = compactUserSummary(result.summary);
    return summary === ""
      ? { result_ref: null, summary: "线程已结束，但尚未生成有效结果" }
      : { result_ref: taskState.result_path, summary };
  } catch {
    return { result_ref: null, summary: "线程已结束，但尚未生成有效结果" };
  }
}

function supervisorNextCommand(goalDirectoryArgument        , limitArgument         )       {
  const { planPath, statePath, threadsPath } = supervisorPaths(goalDirectoryArgument);
  const limit = limitArgument === undefined
    ? MAX_PARALLEL_THREADS
    : requireParallelCount(Number(limitArgument), "supervisor limit");
  const payload = withStateLock(statePath, () => withStateLock(threadsPath, () => {
    const { plan, goal, state } = loadPlanAndState(planPath, statePath, {
      allowSourceDrift: true,
    });
    const sourceCurrent = existsSync(goal.source.path) &&
      digestFile(goal.source.path) === goal.source.digest;
    const registry = readThreadRegistry(threadsPath, plan.goal_id);
    const threads = requireRecord(registry.threads, "thread registry.threads");
    const watches = registry.watches                             ;
    const create                            = [];

    for (const task of plan.tasks) {
      if (create.length >= limit) break;
      const taskState = state.tasks[task.id];
      if (taskState.status !== "reserved" || task.owner_id === null) continue;
      if (!sourceCurrent) continue;
      const subject = subjectForTask(plan, task);
      const subjectState = subjectStateForTask(state, task);
      const key = threadKey(planPath, plan, goal, task, subject, subjectState, taskState);
      const canonicalThread = Object.hasOwn(threads, key)
        ? requireRecord(threads[key], `thread registry.threads.${key}`)
        : null;
      const reusableThread = subjectState.bound_executor_id === null
        ? null
        : registeredThreadForExecutor(threads, subjectState.bound_executor_id);
      const reusableStatuses = new Set(["idle", "running"]);
      const registered = canonicalThread !== null && reusableStatuses.has(String(canonicalThread.status))
        ? canonicalThread
        : reusableThread !== null && reusableStatuses.has(String(reusableThread.thread.status))
        ? reusableThread.thread
        : null;
      if (subjectState.bound_executor_id !== null && registered === null) {
        fail(`bound executor ${subjectState.bound_executor_id} is missing from thread registry`);
      }
      const profile = runtimeProfileForTask(goal, task);
      create.push({
        action_id: supervisorActionId("create", task.id, taskState.attempt),
        task: task.id,
        attempt: taskState.attempt,
        run: taskRunId(task.id, taskState),
        title: threadTitle(task, subject),
        model: profile.model,
        effort: profile.reasoning_effort,
        thread: registered?.thread_id ?? null,
        host: registered?.host_id ?? null,
      });
    }

    const waitActions                            = [];
    const notifications                            = [];
    const stalledActions                            = [];
    for (const watch of watches) {
      const taskId = requireIdentifier(watch.task_id, "thread registry watch.task_id");
      const attempt = requirePositiveInteger(watch.attempt, "thread registry watch.attempt");
      const taskState = state.tasks[taskId];
      if (taskState === undefined || taskState.attempt !== attempt) continue;
      const threadKeyValue = requireString(watch.thread_key, "thread registry watch.thread_key");
      const thread = requireRecord(threads[threadKeyValue], `thread registry.threads.${threadKeyValue}`);
      const status = requireString(thread.status, `thread registry.threads.${threadKeyValue}.status`);
      const compact = {
        task: taskId,
        attempt,
        thread: requireString(thread.thread_id, "thread id"),
        host: requireString(thread.host_id, "thread host"),
        title: threadTitle(plan.tasks.find((candidate) => candidate.id === taskId) ??
          fail(`unknown watched task: ${taskId}`)),
      };
      const unchangedWaits = requireNonNegativeInteger(
        watch.unchanged_waits,
        "thread registry watch.unchanged_waits",
      );
      if (status === "running" && unchangedWaits >= 3 && stalledActions.length < limit) {
        stalledActions.push({
          action_id: supervisorActionId("stalled", taskId, attempt),
          ...compact,
          unchanged_waits: unchangedWaits,
        });
      } else if (status === "running" && waitActions.length < limit) {
        waitActions.push({
          action_id: supervisorActionId("wait", taskId, attempt),
          ...compact,
          run: taskRunId(taskId, taskState),
          cursor: requireNullableString(thread.cursor, "thread registry thread.cursor"),
        });
      } else if (SUPERVISOR_NOTIFY_STATES.has(status) && notifications.length < limit) {
        const task = plan.tasks.find((candidate) => candidate.id === taskId) ??
          fail(`unknown watched task: ${taskId}`);
        notifications.push({
          action_id: supervisorActionId("notify", taskId, attempt),
          ...compact,
          run: taskRunId(taskId, taskState),
          status,
          ...(status === "needs_attention"
            ? { result_ref: null, summary: "线程需要用户处理" }
            : supervisorResultNotice(plan, task, taskState)),
        });
      }
    }
    const main = requireRecord(registry.main, "thread registry.main");
    return {
      main: {
        thread: requireString(main.thread_id, "thread registry.main.thread_id"),
        host: requireString(main.host_id, "thread registry.main.host_id"),
      },
      create,
      wait: waitActions,
      stalled: stalledActions,
      notify: notifications,
    };
  }));
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function supervisorRecordCommand(
  goalDirectoryArgument        ,
  event        ,
  args          ,
)       {
  const { goalDirectory, planPath, statePath, threadsPath } = supervisorPaths(goalDirectoryArgument);
  if (event === "binding") {
    if (args.length !== 3) fail("supervisor-record binding requires <task> <attempt> <thread_id>");
    const [taskId, attemptArgument, executorId] = args;
    const binding = withStateLock(statePath, () => {
      const { plan, goal, state } = loadPlanAndState(planPath, statePath);
      void goal;
      const task = plan.tasks.find((candidate) => candidate.id === taskId);
      if (task === undefined) fail(`unknown task: ${taskId}`);
      const taskState = state.tasks[taskId];
      if (taskState.status !== "running") fail(`task ${taskId} is not running`);
      if (taskState.attempt !== requirePositiveInteger(Number(attemptArgument), "attempt")) {
        fail("task attempt mismatch");
      }
      if (taskState.executor_id !== requireString(executorId, "thread_id")) {
        fail("task executor mismatch");
      }
      return readTaskBindingSnapshot(
        taskBindingSnapshotPath(goalDirectory, task, taskState),
        planPath,
        statePath,
        task,
        taskState,
        executorId,
      );
    });
    process.stdout.write(`${JSON.stringify(binding)}\n`);
    return;
  }

  const receipt = withStateLock(statePath, () => withStateLock(threadsPath, () => {
    const { plan, goal, state } = loadPlanAndState(planPath, statePath, {
      allowSourceDrift: true,
    });
    const registry = readThreadRegistry(threadsPath, plan.goal_id);
    const threads = requireRecord(registry.threads, "thread registry.threads");
    const watches = registry.watches                             ;
    const main = requireRecord(registry.main, "thread registry.main");
    const mainRoute = {
      thread: requireString(main.thread_id, "thread registry.main.thread_id"),
      host: requireString(main.host_id, "thread registry.main.host_id"),
    };

    if (event === "created") {
      if (args.length !== 4) {
        fail("supervisor-record created requires <task> <attempt> <thread_id> <host_id>");
      }
      const [taskId, attemptArgument, executorId, hostId] = args;
      if (!existsSync(goal.source.path) || digestFile(goal.source.path) !== goal.source.digest) {
        fail("source changed; a reserved task cannot be bound to a new thread");
      }
      const attempt = requirePositiveInteger(Number(attemptArgument), "attempt");
      const task = plan.tasks.find((candidate) => candidate.id === taskId);
      if (task === undefined) fail(`unknown task: ${taskId}`);
      if (task.owner_id === null) fail(`task ${taskId} is script-only`);
      const taskState = state.tasks[taskId];
      if (taskState.attempt !== attempt) fail("task attempt mismatch");
      const subject = subjectForTask(plan, task);
      const subjectState = subjectStateForTask(state, task);
      const key = threadKey(planPath, plan, goal, task, subject, subjectState, taskState);
      const actualExecutorId = requireString(executorId, "thread_id");
      const actualHostId = requireString(hostId, "host_id");
      const existingRegistration = registeredThreadForExecutor(threads, actualExecutorId);
      const previousCursor = existingRegistration === null
        ? null
        : requireNullableString(existingRegistration.thread.cursor, "thread cursor");
      const bindingRef = taskBindingSnapshotPath(goalDirectory, task, taskState);
      let binding                         ;
      if (taskState.status === "reserved") {
        if (existsSync(bindingRef)) fail(`reserved task already has a binding snapshot: ${taskId}`);
        binding = bindTaskState(
          planPath,
          plan,
          goal,
          state,
          task,
          requireString(taskState.reservation_token, "reservation token"),
          actualExecutorId,
        ).binding                           ;
      } else if (taskState.status === "running" && taskState.executor_id === actualExecutorId) {
        binding = readTaskBindingSnapshot(
          bindingRef,
          planPath,
          statePath,
          task,
          taskState,
          actualExecutorId,
        );
      } else {
        fail(`task ${taskId} cannot record created from status ${taskState.status}`);
      }
      threads[key] = {
        thread_id: actualExecutorId,
        host_id: actualHostId,
        role: task.role === "review" ? "review" : "owner",
        status: "running",
        cursor: previousCursor,
      };
      const watch = {
        task_id: taskId,
        attempt,
        thread_key: key,
        unchanged_waits: 0,
      };
      const watchIndex = watches.findIndex((candidate) =>
        candidate.task_id === taskId && candidate.attempt === attempt
      );
      if (watchIndex < 0) watches.push(watch);
      else watches[watchIndex] = watch;
      validateThreadRegistry(registry);
      writeTransaction(statePath, [
        ...(existsSync(bindingRef) ? [] : [[bindingRef, binding]                     ]),
        [statePath, state],
        [threadsPath, registry],
      ]);
      const runId = taskRunId(task.id, taskState);
      const dispatchCommand = [
        "node",
        fileURLToPath(import.meta.url),
        "worker",
        "open",
        goalDirectory,
        runId,
      ].map((value) => JSON.stringify(value)).join(" ");
      return {
        status: "created",
        task: taskId,
        attempt,
        thread: actualExecutorId,
        run: runId,
        main: mainRoute,
        dispatch: `使用 $sub-thread-goal-worker；先运行 ${dispatchCommand} 获取当前 Binding，再执行。`,
        binding_ref: bindingRef,
        binding_digest: digestFile(bindingRef),
      };
    }

    if (event === "observed") {
      if (args.length !== 4) {
        fail("supervisor-record observed requires <task> <attempt> <cursor|-> <status>");
      }
      const [taskId, attemptArgument, cursorArgument, statusArgument] = args;
      const attempt = requirePositiveInteger(Number(attemptArgument), "attempt");
      const status = requireString(statusArgument, "observed status");
      if (status !== "running" && !SUPERVISOR_NOTIFY_STATES.has(status)) {
        fail(`observed status is invalid: ${status}`);
      }
      const watch = watches.find((candidate) =>
        candidate.task_id === taskId && candidate.attempt === attempt
      );
      if (watch === undefined) fail(`supervisor watch is missing for ${taskId} attempt ${attempt}`);
      const threadKeyValue = requireString(watch.thread_key, "thread key");
      const thread = requireRecord(threads[threadKeyValue], `thread registry.threads.${threadKeyValue}`);
      const nextCursor = cursorArgument === "-" ? null : requireString(cursorArgument, "cursor");
      const previousCursor = requireNullableString(thread.cursor, "cursor");
      thread.cursor = nextCursor;
      watch.unchanged_waits = status === "running"
        ? previousCursor === nextCursor
          ? requireNonNegativeInteger(watch.unchanged_waits, "unchanged_waits") + 1
          : 0
        : 0;
      thread.status = status;
      validateThreadRegistry(registry);
      writeJson(threadsPath, registry);
      return {
        status: "observed",
        task: taskId,
        attempt,
        terminal: SUPERVISOR_TERMINAL_STATES.has(status),
        unchanged_waits: watch.unchanged_waits,
        main: mainRoute,
      };
    }

    if (event === "resumed") {
      if (args.length !== 2) fail("supervisor-record resumed requires <task> <attempt>");
      const [taskId, attemptArgument] = args;
      const attempt = requirePositiveInteger(Number(attemptArgument), "attempt");
      const watch = watches.find((candidate) =>
        candidate.task_id === taskId && candidate.attempt === attempt
      );
      if (watch === undefined) fail(`supervisor watch is missing for ${taskId} attempt ${attempt}`);
      const threadKeyValue = requireString(watch.thread_key, "thread key");
      const thread = requireRecord(threads[threadKeyValue], `thread registry.threads.${threadKeyValue}`);
      if (thread.status !== "attention_notified" && thread.status !== "stalled") {
        fail(`thread cannot resume from ${String(thread.status)}`);
      }
      thread.status = "running";
      watch.unchanged_waits = 0;
      validateThreadRegistry(registry);
      writeJson(threadsPath, registry);
      return { status: "resumed", task: taskId, attempt };
    }

    if (event === "stalled-notified") {
      if (args.length !== 2) fail("supervisor-record stalled-notified requires <task> <attempt>");
      const [taskId, attemptArgument] = args;
      const attempt = requirePositiveInteger(Number(attemptArgument), "attempt");
      const watch = watches.find((candidate) =>
        candidate.task_id === taskId && candidate.attempt === attempt
      );
      if (watch === undefined) fail(`supervisor watch is missing for ${taskId} attempt ${attempt}`);
      if (requireNonNegativeInteger(watch.unchanged_waits, "unchanged_waits") < 3) {
        fail("thread has not reached the stalled threshold");
      }
      const threadKeyValue = requireString(watch.thread_key, "thread key");
      const thread = requireRecord(threads[threadKeyValue], `thread registry.threads.${threadKeyValue}`);
      if (thread.status !== "running") fail(`thread cannot become stalled from ${String(thread.status)}`);
      thread.status = "stalled";
      validateThreadRegistry(registry);
      writeJson(threadsPath, registry);
      return { status: "stalled_notified", task: taskId, attempt };
    }

    if (event === "notified") {
      if (args.length !== 2) fail("supervisor-record notified requires <task> <attempt>");
      const [taskId, attemptArgument] = args;
      const attempt = requirePositiveInteger(Number(attemptArgument), "attempt");
      const index = watches.findIndex((candidate) =>
        candidate.task_id === taskId && candidate.attempt === attempt
      );
      if (index < 0) fail(`supervisor watch is missing for ${taskId} attempt ${attempt}`);
      const threadKeyValue = requireString(watches[index].thread_key, "thread key");
      const thread = requireRecord(threads[threadKeyValue], `thread registry.threads.${threadKeyValue}`);
      const terminalStatus = requireString(thread.status, "thread status");
      if (!SUPERVISOR_NOTIFY_STATES.has(terminalStatus)) {
        fail(`thread does not require notification: ${terminalStatus}`);
      }
      if (terminalStatus === "needs_attention") {
        thread.status = "attention_notified";
        validateThreadRegistry(registry);
        writeJson(threadsPath, registry);
        return { status: "attention_notified", task: taskId, attempt };
      }
      const task = plan.tasks.find((candidate) => candidate.id === taskId) ??
        fail(`unknown watched task: ${taskId}`);
      if (supervisorResultNotice(plan, task, state.tasks[taskId]).result_ref === null) {
        thread.status = "attention_notified";
        validateThreadRegistry(registry);
        writeJson(threadsPath, registry);
        return { status: "attention_notified", reason: "missing_result", task: taskId, attempt };
      }
      registry.watches = watches.filter((_, candidateIndex) => candidateIndex !== index);
      thread.status = "idle";
      validateThreadRegistry(registry);
      writeJson(threadsPath, registry);
      return { status: "notified", task: taskId, attempt };
    }

    fail(`unknown supervisor record event: ${event}`);
  }));
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function supervisorAckCommand(
  goalDirectoryArgument        ,
  actionIdArgument        ,
  args          ,
)       {
  const action = parseSupervisorActionId(actionIdArgument);
  let receipt                         ;
  if (action.kind === "create") {
    if (args.length !== 2) fail("create acknowledgement requires <thread_id> <host_id>");
    receipt = runSelfJson([
      "supervisor-record",
      resolve(goalDirectoryArgument),
      "created",
      action.task,
      String(action.attempt),
      args[0],
      args[1],
    ]);
  } else if (action.kind === "wait") {
    if (args.length !== 2) fail("wait acknowledgement requires <cursor|-> <status>");
    receipt = runSelfJson([
      "supervisor-record",
      resolve(goalDirectoryArgument),
      "observed",
      action.task,
      String(action.attempt),
      args[0],
      args[1],
    ]);
  } else if (action.kind === "stalled") {
    if (args.length !== 0) fail("stalled acknowledgement takes no extra arguments");
    receipt = runSelfJson([
      "supervisor-record",
      resolve(goalDirectoryArgument),
      "stalled-notified",
      action.task,
      String(action.attempt),
    ]);
  } else {
    if (args.length !== 0) fail("notify acknowledgement takes no extra arguments");
    receipt = runSelfJson([
      "supervisor-record",
      resolve(goalDirectoryArgument),
      "notified",
      action.task,
      String(action.attempt),
    ]);
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function supervisorRecoverCommand(
  goalDirectoryArgument        ,
  taskIdArgument        ,
  attemptArgument        ,
  reasonArgument        ,
)       {
  const { planPath, statePath, threadsPath } = supervisorPaths(goalDirectoryArgument);
  const taskId = requireIdentifier(taskIdArgument, "task_id");
  const attempt = requirePositiveInteger(Number(attemptArgument), "attempt");
  const reason = requireString(reasonArgument, "reason");
  const snapshot = withStateLock(statePath, () => withStateLock(threadsPath, () => {
    const { plan, state } = loadPlanAndState(planPath, statePath, { allowSourceDrift: true });
    const registry = readThreadRegistry(threadsPath, plan.goal_id);
    const taskState = state.tasks[taskId] ?? fail(`unknown task: ${taskId}`);
    if (taskState.attempt !== attempt) fail("task attempt mismatch");
    const watches = registry.watches                             ;
    const watch = watches.find((candidate) =>
      candidate.task_id === taskId && candidate.attempt === attempt
    );
    const threads = requireRecord(registry.threads, "thread registry.threads");
    const threadKeyValue = watch === undefined
      ? null
      : requireString(watch.thread_key, "thread key");
    const thread = threadKeyValue === null
      ? null
      : requireRecord(threads[threadKeyValue], `thread registry.threads.${threadKeyValue}`);
    const executorId = taskState.executor_id ?? (
      thread === null ? null : requireString(thread.thread_id, "thread id")
    );
    return {
      task_status: taskState.status,
      reservation_token: taskState.reservation_token,
      last_reclaimed_token: taskState.last_reclaimed_token,
      executor_id: executorId,
      thread_key: threadKeyValue,
      thread_status: thread?.status ?? null,
    };
  }));

  const taskStatus = requireString(snapshot.task_status, "task status");
  const reservationToken = requireNullableString(snapshot.reservation_token, "reservation token");
  if (taskStatus === "reserved" || taskStatus === "running") {
    if (snapshot.thread_key === null) fail("active task has no supervisor watch");
    const threadStatus = requireString(snapshot.thread_status, "thread status");
    if (!["stalled", "attention_notified", "needs_attention", "lost"].includes(threadStatus)) {
      fail(`thread must be stalled or awaiting user action before recovery: ${threadStatus}`);
    }
    if (reservationToken === null) fail("active task reservation token is missing");
    runSelfJson(["reclaim", planPath, statePath, taskId, reservationToken, reason]);
  } else if (taskStatus !== "pending") {
    fail(`task ${taskId} cannot be recovered from ${taskStatus}`);
  }

  const executorId = requireNullableString(snapshot.executor_id, "executor id");
  if (executorId !== null) {
    runSelfJson(["confirm-stale-executor", planPath, statePath, executorId]);
  }

  const registryReceipt = withStateLock(threadsPath, () => {
    const plan = parsePlan(readJson(planPath), planPath).plan;
    const registry = readThreadRegistry(threadsPath, plan.goal_id);
    const threads = requireRecord(registry.threads, "thread registry.threads");
    const watches = registry.watches                             ;
    const removed = watches.filter((candidate) =>
      candidate.task_id === taskId && candidate.attempt === attempt
    );
    registry.watches = watches.filter((candidate) => !(
      candidate.task_id === taskId && candidate.attempt === attempt
    ));
    const affectedKeys = new Set(removed.map((watch) => requireString(watch.thread_key, "thread key")));
    const snapshotThreadKey = requireNullableString(snapshot.thread_key, "thread key");
    if (snapshotThreadKey !== null) affectedKeys.add(snapshotThreadKey);
    const remainingWatches = registry.watches                             ;
    let lostThreads = 0;
    for (const key of affectedKeys) {
      if (remainingWatches.some((watch) => watch.thread_key === key)) continue;
      const thread = requireRecord(threads[key], `thread registry.threads.${key}`);
      thread.status = "lost";
      lostThreads += 1;
    }
    validateThreadRegistry(registry);
    if (removed.length > 0 || affectedKeys.size > 0) writeJson(threadsPath, registry);
    return { removed_watches: removed.length, lost_threads: lostThreads };
  });

  process.stdout.write(`${JSON.stringify({
    contract: "SUPERVISOR_RECOVERY_RECEIPT_V1",
    status: "recovered",
    task: taskId,
    attempt,
    executor: executorId,
    ...registryReceipt,
  })}\n`);
}

function expandEvidenceInput(value         , index        )                          {
  const evidence = requireRecord(value, `result input.evidence[${index}]`);
  if (evidence.verification_id !== undefined) return evidence;
  requireAllowedKeys(
    evidence,
    ["id", "outcome", "summary", "artifact"],
    `result input.evidence[${index}]`,
  );
  const id = requireIdentifier(evidence.id, `result input.evidence[${index}].id`);
  const outcome = evidence.outcome === undefined
    ? "passed"
    : requireString(evidence.outcome, `result input.evidence[${index}].outcome`);
  const artifactRef = evidence.artifact === undefined || evidence.artifact === null
    ? null
    : resolve(requireString(evidence.artifact, `result input.evidence[${index}].artifact`));
  if (artifactRef !== null && !existsSync(artifactRef)) {
    fail(`result input.evidence[${index}].artifact is missing: ${artifactRef}`);
  }
  return {
    verification_id: id,
    outcome,
    summary: evidence.summary === undefined
      ? `${id}: ${outcome}`
      : requireString(evidence.summary, `result input.evidence[${index}].summary`),
    artifact_ref: artifactRef,
    artifact_digest: artifactRef === null ? null : digestFile(artifactRef),
  };
}

function expandScopeRequestInput(
  value         ,
  task                ,
)                                 {
  if (value === undefined || value === null) return null;
  const scope = requireRecord(value, "result input.scope");
  if (scope.required_for_done_when !== undefined) return scope;
  requireAllowedKeys(scope, ["paths", "reason", "owner"], "result input.scope");
  return {
    paths: requireStringArray(scope.paths, "result input.scope.paths", false),
    reason: requireString(scope.reason, "result input.scope.reason"),
    required_for_done_when: task.done_when.join("; "),
    suggested_owner: scope.owner === undefined
      ? task.owner_id ?? "runtime"
      : requireString(scope.owner, "result input.scope.owner"),
    split_hints: [],
    overlap_hints: [],
  };
}

function expandPublishedArtifactInput(value         , index        )                          {
  const artifact = requireRecord(value, `result input.publish[${index}]`);
  if (artifact.contract !== undefined) return artifact;
  requireAllowedKeys(
    artifact,
    ["type", "path", "audience"],
    `result input.publish[${index}]`,
  );
  const type = requireString(artifact.type, `result input.publish[${index}].type`);
  const contracts                                                     = {
    interface: "OWNER_INTERFACE_V1",
    handoff: "OWNER_HANDOFF_V1",
    attestation: "COMMIT_ATTESTATION_V1",
  };
  const contract = contracts[type];
  if (contract === undefined) fail(`result input.publish[${index}].type is invalid: ${type}`);
  const ref = resolve(requireString(artifact.path, `result input.publish[${index}].path`));
  if (!existsSync(ref)) fail(`result input.publish[${index}].path is missing: ${ref}`);
  return {
    contract,
    ref,
    digest: digestFile(ref),
    audience: requireStringArray(
      artifact.audience,
      `result input.publish[${index}].audience`,
      false,
    ),
  };
}

function expandWorkerResultInput(
  input                         ,
  task                ,
  taskState           ,
  plan      ,
  state          ,
)                          {
  if (input.contract === "WORKER_RESULT_V5") return input;
  if (input.contract !== "TASK_RESULT_INPUT_V1" && input.contract !== "TASK_RESULT_INPUT_V2") {
    fail("result input contract must equal TASK_RESULT_INPUT_V2");
  }
  const compact = input.contract === "TASK_RESULT_INPUT_V2";
  if (compact) {
    requireAllowedKeys(input, [
      "contract",
      "status",
      "summary",
      "evidence",
      "blocking",
      "notes",
      "follow_ups",
      "scope",
      "owner",
      "publish",
      "review_upgrade",
    ], "result input");
  }
  const status = requireString(input.status, "result input.status")                        ;
  if (!TERMINAL_STATUSES.has(status)) fail(`result input.status is invalid: ${status}`);
  const reviewContext = task.role === "review" ? reviewContextForTask(plan, state, task) : null;
  const ownerValue = compact ? input.owner : input.owner_updates;
  const ownerUpdates = ownerValue === undefined
    ? { decisions: [], invariants: [], risks: [] }
    : requireRecord(ownerValue, "result input.owner");
  requireAllowedKeys(ownerUpdates, ["decisions", "invariants", "risks"], "result input.owner");
  const evidenceInput = input.evidence ?? [];
  if (!Array.isArray(evidenceInput)) fail("result input.evidence must be an array");
  const publishInput = compact ? (input.publish ?? []) : (input.published_artifacts ?? []);
  if (!Array.isArray(publishInput)) fail("result input.publish must be an array");
  return {
    contract: "WORKER_RESULT_V5",
    status,
    task_id: task.id,
    logical_id: task.logical_id,
    role: task.role,
    owner_id: task.owner_id,
    runtime_actor_id: task.runtime_actor_id,
    owner_generation: taskState.owner_generation,
    executor_id: taskState.executor_id,
    reservation_token: taskState.reservation_token,
    attempt: taskState.attempt,
    source_revision: taskState.source_revision,
    changed_files: [],
    evidence: evidenceInput.map(expandEvidenceInput),
    diff_self_check: status === "completed"
      ? "pass"
      : status === "needs_repair"
        ? "scope_exception"
        : "fail",
    blocking_findings: compact ? (input.blocking ?? []) : (input.blocking_findings ?? []),
    non_blocking_findings: compact ? (input.notes ?? []) : (input.non_blocking_findings ?? []),
    follow_up_suggestions: compact ? (input.follow_ups ?? []) : (input.follow_up_suggestions ?? []),
    reviewed_results: reviewContext?.reviewed_results ?? [],
    review_plan_digest: reviewContext?.plan_digest ?? null,
    review_workspace_digest: reviewContext?.workspace_digest ?? null,
    review_upgrade_reason: compact ? (input.review_upgrade ?? null) : (input.review_upgrade_reason ?? null),
    scope_request: expandScopeRequestInput(compact ? input.scope : input.scope_request, task),
    summary: requireString(input.summary, "result input.summary"),
    owner_updates: {
      decisions: ownerUpdates.decisions ?? [],
      invariants: ownerUpdates.invariants ?? [],
      risks: ownerUpdates.risks ?? [],
    },
    published_artifacts: publishInput.map(expandPublishedArtifactInput),
  };
}

function resultSubmitCommand(
  planArgument        ,
  stateArgument        ,
  taskId        ,
  reservationToken        ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const payload = withStateLock(statePath, () => {
    const { plan, goal, state } = loadPlanAndState(planPath, statePath, { allowSourceDrift: true });
    assertGoalMutable(planPath, plan, goal);
    const task = plan.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) fail(`unknown task: ${taskId}`);
    const taskState = state.tasks[taskId];
    if (taskState.status !== "running") fail(`task ${taskId} is not running`);
    if (taskState.reservation_token !== reservationToken) fail("reservation token mismatch");
    if (taskState.result_path === null) fail("task result_path is missing");
    const owner = subjectForTask(plan, task);
    const resultInput = readStructuredInput("-");
    const result = parseWorkerResult(
      expandWorkerResultInput(resultInput, task, taskState, plan, state),
      task,
      owner,
      taskState,
      isOwnerDefinition(owner)
        ? persistentOwnerInterfaceDirectoryFor(
          goal.workspace.root,
          goal.goal_id,
          task.id,
        )
        : undefined,
    );
    validateReviewResultBinding(plan, state, task, result);
    writeImmutableJson(taskState.result_path, result);
    refreshProgressDocument(planPath, statePath);
    return {
      contract: "THREAD_TASK_RECEIPT_V1",
      status: result.status,
      task_id: task.id,
      attempt: taskState.attempt,
      result_ref: taskState.result_path,
      result_digest: digestFile(taskState.result_path),
      blocking_count: result.blocking_findings.length,
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function runSelfJson(args          , input                          )                          {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], {
    encoding: "utf8",
    shell: false,
    env: process.env,
    ...(input === undefined ? {} : { input: JSON.stringify(input) }),
  });
  if (result.error !== undefined || result.status !== 0) {
    const detail = result.error?.message ?? String(result.stderr).trim();
    fail(`runtime script failed (${args[0]}): ${detail || `exit ${result.status}`}`);
  }
  try {
    return requireRecord(JSON.parse(result.stdout), `${args[0]} receipt`);
  } catch (error) {
    fail(`runtime script returned invalid JSON (${args[0]}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

function taskRunId(taskId        , taskState           )         {
  if (taskState.attempt < 1 || taskState.reservation_token === null) {
    fail(`task ${taskId} has no active run identity`);
  }
  return `run-${digestJson({
    task_id: taskId,
    attempt: taskState.attempt,
    token: taskState.reservation_token,
    source_revision: taskState.source_revision,
  }).slice(0, 16)}`;
}

function taskForRun(
  goalDirectoryArgument        ,
  runIdArgument        ,
)








  {
  const { goalDirectory, planPath, statePath } = supervisorPaths(goalDirectoryArgument);
  const { plan, goal, state } = loadPlanAndState(planPath, statePath, { allowSourceDrift: true });
  const runId = requireString(runIdArgument, "run_id");
  const matches = plan.tasks.filter((task) => {
    const taskState = state.tasks[task.id];
    return taskState.attempt > 0 && taskState.reservation_token !== null &&
      taskRunId(task.id, taskState) === runId;
  });
  if (matches.length !== 1) fail(`run id is not current: ${runId}`);
  const task = matches[0];
  return {
    goalDirectory,
    planPath,
    statePath,
    plan,
    goal,
    state,
    task,
    taskState: state.tasks[task.id],
  };
}

function readPlainSemanticInput(label        )         {
  const raw = readFileSync(0, "utf8");
  if (Buffer.byteLength(raw, "utf8") > 16 * 1024) fail(`${label} exceeds 16 KiB`);
  return requireString(raw.trim(), label);
}

function workflowDefinitionPath(goalDirectory        )         {
  return join(goalDirectory, "workflow.json");
}

function workflowStatePath(goalDirectory        )         {
  return join(goalDirectory, "workflow-state.json");
}

function workflowRoutesPath(goalDirectory        )         {
  return join(goalDirectory, "routes.json");
}

function workflowDashboardPath(goalDirectory        )         {
  return join(goalDirectory, "dashboard.json");
}

function quickRuntimePath(goalDirectory        , name        )         {
  return join(goalDirectory, "quick", name);
}

function parseWorkflowRoutes(value         )                   {
  const source = requireRecord(value, "workflow routes");
  requireExactKeys(source, ["contract", "main", "planner", "planner_reviewer"], "workflow routes");
  if (source.contract !== "WORKFLOW_ROUTES_V1") fail("workflow routes contract is invalid");
  const endpoint = (input         , label        )                                          => {
    if (input === null) return null;
    const item = requireRecord(input, label);
    requireExactKeys(item, ["thread", "host"], label);
    return {
      thread: requireString(item.thread, `${label}.thread`),
      host: requireString(item.host, `${label}.host`),
    };
  };
  return {
    contract: "WORKFLOW_ROUTES_V1",
    main: endpoint(source.main, "workflow routes.main"),
    planner: endpoint(source.planner, "workflow routes.planner"),
    planner_reviewer: endpoint(source.planner_reviewer, "workflow routes.planner_reviewer"),
  };
}

function readWorkflowRoutes(goalDirectory        )                   {
  const path = workflowRoutesPath(goalDirectory);
  if (!existsSync(path)) fail(`workflow routes are missing: ${path}`);
  return parseWorkflowRoutes(readJson(path));
}

function workflowRouteReceipt(goalDirectory        , role                    )                                 {
  return readWorkflowRoutes(goalDirectory)[role];
}

function preferredWorkflowThread(
  goalDirectory        ,
  role                    ,
)                                 {
  if (!existsSync(workflowRoutesPath(goalDirectory))) return null;
  const route = workflowRouteReceipt(goalDirectory, role);
  return route === null
    ? null
    : {
      thread_id: requireString(route.thread, `${role} route thread`),
      host_id: requireString(route.host, `${role} route host`),
    };
}

function activeWorkflowDirectories(workspaceRoot        )           {
  const root = join(resolve(workspaceRoot), ".ghost-agent-workflow", "runtime", "goals");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || entry.isSymbolicLink()) return [];
    const directory = join(root, entry.name);
    const workflowState = workflowStatePath(directory);
    const goalState = join(directory, "goal-state.json");
    try {
      if (existsSync(workflowState)) {
        const state = parseWorkflowState(readJson(workflowState));
        return state.status === "active" ? [directory] : [];
      }
      if (existsSync(goalState)) {
        const state = requireRecord(readJson(goalState), `goal state ${goalState}`);
        return state.status === "active" ? [directory] : [];
      }
    } catch (error) {
      fail(`cannot inspect workflow ${directory}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return [];
  }).sort(compareStableStrings);
}

function parseWorkflowDefinition(value         , path        )                       {
  const source = requireRecord(value, "workflow");
  requireExactKeys(
    source,
    ["contract", "id", "mode", "workspace", "objective", "created_at"],
    "workflow",
  );
  if (source.contract !== "WORKFLOW_V1") fail("workflow contract must equal WORKFLOW_V1");
  if (source.mode !== "quick" && source.mode !== "dag") fail("workflow mode is invalid");
  const workspace = resolve(requireString(source.workspace, "workflow.workspace"));
  const runtimeRoot = join(workspace, ".ghost-agent-workflow", "runtime", "goals");
  const directory = dirname(resolve(path));
  if (directory !== runtimeRoot && !directory.startsWith(`${runtimeRoot}/`)) {
    fail("workflow must be stored below .ghost-agent-workflow/runtime/goals");
  }
  return {
    contract: "WORKFLOW_V1",
    id: requireIdentifier(source.id, "workflow.id"),
    mode: source.mode,
    workspace,
    objective: requireChineseText(source.objective, "workflow.objective"),
    created_at: requireString(source.created_at, "workflow.created_at"),
  };
}

function parseQuickRun(value         )             {
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
  if (source.kind === "work" && owner === null) fail("quick work run requires owner");
  if (source.kind === "review" && owner === null) fail("quick review run requires reviewed owner");
  return {
    id: requireString(source.id, "workflow state.run.id"),
    kind: source.kind,
    owner,
    generation: requirePositiveInteger(source.generation, "workflow state.run.generation"),
    work: requireString(source.work, "workflow state.run.work"),
    title: requireChineseText(source.title, "workflow state.run.title"),
    token: requireString(source.token, "workflow state.run.token"),
    executor: requireNullableString(source.executor, "workflow state.run.executor"),
    host: requireNullableString(source.host, "workflow state.run.host"),
    cursor: requireNullableString(source.cursor, "workflow state.run.cursor"),
    status: source.status,
    request_dag: requireBoolean(source.request_dag, "workflow state.run.request_dag"),
  };
}

function parseQuickAccepted(value         )                  {
  const source = requireRecord(value, "workflow state.accepted");
  requireExactKeys(source, ["owner", "executor", "summary", "files", "review"], "workflow state.accepted");
  return {
    owner: requireIdentifier(source.owner, "workflow state.accepted.owner"),
    executor: requireString(source.executor, "workflow state.accepted.executor"),
    summary: requireString(source.summary, "workflow state.accepted.summary"),
    files: requireStringArray(source.files, "workflow state.accepted.files").map(normalizePathPattern),
    review: requireNullableString(source.review, "workflow state.accepted.review"),
  };
}

function parseWorkflowState(value         )                  {
  const source = requireRecord(value, "workflow state");
  requireExactKeys(
    source,
    ["contract", "status", "revision", "next", "registry", "run", "accepted", "attention", "result_ref"],
    "workflow state",
  );
  if (source.contract !== "WORKFLOW_STATE_V1") {
    fail("workflow state contract must equal WORKFLOW_STATE_V1");
  }
  if (source.status !== "active" && source.status !== "completed") fail("workflow state.status is invalid");
  const nextValues = new Set(["owner", "decision", "upgrade", "dag", "blocked", "completed"]);
  if (!nextValues.has(String(source.next))) fail("workflow state.next is invalid");
  const registry = requireRecord(source.registry, "workflow state.registry");
  requireExactKeys(registry, ["revision", "digest"], "workflow state.registry");
  const result                  = {
    contract: "WORKFLOW_STATE_V1",
    status: source.status,
    revision: requirePositiveInteger(source.revision, "workflow state.revision"),
    next: source.next                           ,
    registry: {
      revision: requirePositiveInteger(registry.revision, "workflow state.registry.revision"),
      digest: requireString(registry.digest, "workflow state.registry.digest"),
    },
    run: source.run === null ? null : parseQuickRun(source.run),
    accepted: source.accepted === null ? null : parseQuickAccepted(source.accepted),
    attention: requireNullableString(source.attention, "workflow state.attention"),
    result_ref: requireNullableString(source.result_ref, "workflow state.result_ref"),
  };
  if (result.status === "completed" && (result.next !== "completed" || result.result_ref === null)) {
    fail("completed workflow state requires next=completed and result_ref");
  }
  if (result.status === "active" && result.result_ref !== null) {
    fail("active workflow state cannot contain result_ref");
  }
  if (result.run !== null && result.next === "completed") fail("completed workflow cannot have a run");
  return result;
}

function loadWorkflow(goalDirectoryArgument        )





  {
  const directory = resolve(goalDirectoryArgument);
  const definitionPath = workflowDefinitionPath(directory);
  const statePath = workflowStatePath(directory);
  if (!existsSync(definitionPath) || !existsSync(statePath)) {
    fail(`workflow runtime is missing: ${directory}`);
  }
  return {
    directory,
    definitionPath,
    statePath,
    workflow: parseWorkflowDefinition(readJson(definitionPath), definitionPath),
    state: parseWorkflowState(readJson(statePath)),
  };
}

function syntheticQuickGoal(workflow                      , definitionPath        )               {
  return {
    contract: "GOAL_CONTRACT_V1",
    goal_id: workflow.id,
    execution_platform: EXPECTED_PLATFORM,
    workspace: { root: workflow.workspace },
    source: {
      path: definitionPath,
      digest: existsSync(definitionPath) ? digestFile(definitionPath) : digestJson(workflow),
      revision: 1,
    },
    objective: workflow.objective,
    scope: ["**/*"],
    non_goals: [],
    constraints: [],
    lifecycle: { controller: "standalone_thread", native_goal: null },
    execution: { mode: "thread", max_concurrency: 1, reuse_policy: "owner_affinity" },
    verification_gates: fixedGoalGates(),
    side_effects: { deploy: "forbidden", external_write: "forbidden" },
    completion: {
      all_tasks_completed: true,
      plan_coverage_100: true,
      required_gates_passed: true,
      blocking_findings_zero: true,
      diff_in_scope: true,
    },
  };
}

function currentOwnerThreadPath(workspaceRoot        , ownerId        )         {
  return join(workspaceRoot, ".ghost-agent-workflow", "runtime", "owners", ownerId, "thread.json");
}

function currentOwnerThreadIds(workspaceRoot        )              {
  const root = join(resolve(workspaceRoot), ".ghost-agent-workflow", "runtime", "owners");
  if (!existsSync(root)) return new Set();
  return new Set(readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || entry.isSymbolicLink()) return [];
    const path = join(root, entry.name, "thread.json");
    if (!existsSync(path)) return [];
    try {
      const value = requireRecord(readJson(path), `current Owner thread ${entry.name}`);
      return value.contract === "OWNER_THREAD_V1" && typeof value.thread_id === "string"
        ? [value.thread_id]
        : [];
    } catch {
      return [];
    }
  }));
}

function hasCurrentOwnerChange(workspaceRoot        )          {
  return existsSync(currentOwnerChangePath(workspaceRoot, "request.json"));
}

function currentOwnerChangeDirectory(workspaceRoot        )         {
  return join(
    resolve(workspaceRoot),
    ".ghost-agent-workflow",
    "runtime",
    "owner-change",
    "current",
  );
}

function currentOwnerChangePath(workspaceRoot        , name        )         {
  return join(currentOwnerChangeDirectory(workspaceRoot), name);
}

function currentOwnerChangeApplied(workspaceRoot        )          {
  const validationPath = currentOwnerChangePath(workspaceRoot, "validation.json");
  const registryPath = join(
    resolve(workspaceRoot),
    ".ghost-agent-workflow",
    "owners",
    "registry.json",
  );
  if (!existsSync(validationPath) || !existsSync(registryPath)) return false;
  const validation = requireRecord(readJson(validationPath), "current Owner validation");
  return validation.contract === "OWNER_CHANGE_VALIDATION_V2" &&
    validation.status === "passed" &&
    validation.next_registry_digest === digestFile(registryPath);
}

function preferredOwnerThread(workspaceRoot        , ownerId        , generation        )                                 {
  const path = currentOwnerThreadPath(workspaceRoot, ownerId);
  if (!existsSync(path)) return null;
  try {
    const source = requireRecord(readJson(path), "current owner thread");
    if (
      source.contract !== "OWNER_THREAD_V1" || source.owner !== ownerId ||
      source.generation !== generation
    ) return null;
    return {
      thread_id: requireString(source.thread_id, "current owner thread.thread_id"),
      host_id: requireString(source.host_id, "current owner thread.host_id"),
    };
  } catch {
    return null;
  }
}

function quickOwner(
  workflow                      ,
  definitionPath        ,
  ownerId        ,
)                                                                                                     {
  const goal = syntheticQuickGoal(workflow, definitionPath);
  const registry = approvedOwnerRegistry(goal);
  const approved = registry.owners.find((candidate) => candidate.id === ownerId);
  if (approved === undefined) fail(`unknown active Owner: ${ownerId}`);
  return { goal, owner: ownerDefinitionFromApproved(approved), registry };
}

function quickTask(run            , owner                 )                 {
  const review = run.kind === "review";
  return {
    id: review ? "QUICK-REVIEW" : "QUICK-WORK",
    logical_id: review ? "quick.review" : "quick.work",
    title: run.title,
    role: review ? "review" : "work",
    owner_id: owner.id,
    runtime_actor_id: null,
    task: run.work,
    depends_on: [],
    writable_paths: review ? [] : owner.writable_paths,
    resource_locks: review ? [] : owner.writable_paths,
    done_when: [review ? "明确给出审查结论" : "完成绑定工作并通过脚本机械验收"],
    verification_ids: review ? [] : ["quick-check"],
    satisfies_goal_gates: [],
    plan_item_ids: [],
    coverage_effect: review ? "audit" : "implementation",
    priority: 0,
    estimated_cost: 1,
    risk_level: "medium",
    review_policy: "none",
    review_batch_key: null,
    review_blocks_dependents: false,
    review_reasons: [],
    reviews_task_ids: [],
    node_type: "leaf",
    parent_task_id: null,
    subgraph: null,
  };
}

function quickTaskState(goalDirectory        , state                 , run            )            {
  const baselinePath = quickRuntimePath(goalDirectory, "baseline.json");
  return {
    status: run.status,
    attempt: state.revision,
    reservation_token: run.token,
    owner_generation: run.generation,
    executor_id: run.executor,
    source_revision: 1,
    validated_source_revision: 1,
    reserved_at: null,
    result_path: quickRuntimePath(goalDirectory, "candidate.json"),
    result_ref: null,
    result_digest: null,
    replacement_task_id: null,
    last_reclaimed_token: null,
    task_baseline_ref: run.status === "running" ? baselinePath : null,
    task_baseline_digest: run.status === "running" && existsSync(baselinePath)
      ? digestFile(baselinePath)
      : null,
    expanded_writable_paths: [],
    accepted_change_seq: null,
  };
}

function quickThreadTitle(run            )         {
  return run.kind === "review"
    ? `[GA][任务][实现审查] ${run.title}`
    : `[GA][任务][责任域] ${run.title}`;
}

function quickBinding(
  goalDirectory        ,
  workflow                      ,
  definitionPath        ,
  state                 ,
  run            ,
  owner                 ,
  registry                                          ,
)                          {
  if (run.executor === null) fail("quick run is not attached");
  const config = loadThreadWorkflowConfig(workflow.workspace);
  const review = run.kind === "review";
  const handoffPath = quickRuntimePath(goalDirectory, "handoff.json");
  const dependencies = state.accepted !== null && existsSync(handoffPath)
    ? [{ kind: "script_handoff", ref: handoffPath, digest: digestFile(handoffPath) }]
    : [];
  return {
    contract: "TASK_BINDING_V6",
    task: {
      id: review ? "QUICK-REVIEW" : "QUICK-WORK",
      title: run.title,
      role: review ? "review" : "work",
      work: run.work,
      done: [review ? "输出明确的 blocking 或 pass 结论" : "完成工作并通过脚本机械验收"],
      verify: [],
      items: [],
      risk: "medium",
      dependencies,
    },
    run: {
      attempt: state.revision,
      token: run.token,
      source_revision: 1,
      generation: run.generation,
      executor: run.executor,
      workspace_change_seq: 0,
    },
    thread: {
      key: review ? `${workflow.id}:quick-review` : `owner:${owner.id}`,
      title: quickThreadTitle(run),
      profile: review ? config.profiles.review : config.profiles.owner,
    },
    subject: {
      id: review ? `review-${workflow.id}` : owner.id,
      kind: review ? "review" : "owner",
      responsibility: review ? "独立审查快速模式已验收结果" : owner.responsibility,
      context: review ? "只读取脚本交接和当前工作树，不读取实施线程聊天" : owner.worker_context,
    },
    scope: {
      read: review ? ["**/*"] : owner.writable_paths,
      exclude: review ? [] : owner.excluded_paths,
      write: review ? [] : owner.writable_paths,
    },
    refs: {
      plan: definitionPath,
      state: workflowStatePath(goalDirectory),
      coverage: null,
      source_blocks: null,
      registry: { ref: registry.ref, digest: registry.digest },
      capsule: persistentOwnerCapsulePathFor(workflow.workspace, owner.id),
      persistent_capsule: persistentOwnerCapsulePathFor(workflow.workspace, owner.id),
      artifact_dir: null,
      checkpoint: null,
      result: quickRuntimePath(goalDirectory, "candidate.json"),
      subgraph_request: null,
    },
  };
}

function quickRunReceipt(
  workflow                      ,
  definitionPath        ,
  state                 ,
)                          {
  const run = state.run ?? fail("quick workflow has no current run");
  const ownerId = run.owner ?? fail("quick run owner is missing");
  const { owner } = quickOwner(workflow, definitionPath, ownerId);
  const profile = loadThreadWorkflowConfig(workflow.workspace).profiles[
    run.kind === "review" ? "review" : "owner"
  ];
  return {
    run: run.id,
    kind: run.kind,
    title: quickThreadTitle(run),
    model: profile.model,
    effort: profile.reasoning_effort,
    host: run.host,
    cursor: run.cursor,
    preferred_thread: run.kind === "work"
      ? preferredOwnerThread(workflow.workspace, owner.id, run.generation)
      : null,
  };
}

function workflowDispatchCommand(goalDirectoryArgument        , ownerIdArgument        )       {
  const instruction = requireChineseText(readPlainSemanticInput("quick work"), "quick work");
  const loaded = loadWorkflow(goalDirectoryArgument);
  if (loaded.workflow.mode !== "quick") fail("workflow dispatch is only available in quick mode");
  const payload = withStateLock(loaded.statePath, () => {
    const state = parseWorkflowState(readJson(loaded.statePath));
    if (state.status !== "active" || state.run !== null) fail("quick workflow cannot dispatch now");
    if (hasCurrentOwnerChange(loaded.workflow.workspace)) fail("current Owner change requires user action");
    if (!new Set(["owner", "decision", "blocked"]).has(state.next)) {
      fail(`quick workflow cannot dispatch from ${state.next}`);
    }
    const ownerId = requireIdentifier(ownerIdArgument, "owner id");
    const { owner, registry } = quickOwner(loaded.workflow, loaded.definitionPath, ownerId);
    const token = randomUUID();
    const revision = state.revision + 1;
    state.revision = revision;
    state.registry = { revision: registry.revision, digest: registry.digest };
    state.run = {
      id: `run-${digestJson({ workflow: loaded.workflow.id, revision, token }).slice(0, 16)}`,
      kind: "work",
      owner: owner.id,
      generation: registry.owners.find((candidate) => candidate.id === owner.id)?.generation ?? 1,
      work: instruction,
      title: compactUserSummary(instruction),
      token,
      executor: null,
      host: null,
      cursor: null,
      status: "reserved",
      request_dag: false,
    };
    state.attention = null;
    writeJson(loaded.statePath, state);
    return { contract: "WORKFLOW_DISPATCH_V1", status: "reserved", ...quickRunReceipt(
      loaded.workflow,
      loaded.definitionPath,
      state,
    ) };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function workflowReviewCommand(goalDirectoryArgument        )       {
  const loaded = loadWorkflow(goalDirectoryArgument);
  if (loaded.workflow.mode !== "quick") fail("workflow review is only available in quick mode");
  const payload = withStateLock(loaded.statePath, () => {
    const state = parseWorkflowState(readJson(loaded.statePath));
    if (hasCurrentOwnerChange(loaded.workflow.workspace)) fail("current Owner change requires user action");
    if (state.status !== "active" || state.next !== "decision" || state.run !== null || state.accepted === null) {
      fail("quick workflow is not ready for Review");
    }
    const goal = syntheticQuickGoal(loaded.workflow, loaded.definitionPath);
    const registry = approvedOwnerRegistry(goal);
    const approved = registry.owners.find((candidate) => candidate.id === state.accepted?.owner) ??
      registry.owners[0];
    if (approved === undefined) fail("quick Review requires an active Owner Registry entry");
    const token = randomUUID();
    const revision = state.revision + 1;
    state.revision = revision;
    state.registry = { revision: registry.revision, digest: registry.digest };
    state.run = {
      id: `run-${digestJson({ workflow: loaded.workflow.id, revision, token }).slice(0, 16)}`,
      kind: "review",
      owner: approved.id,
      generation: approved.generation,
      work: `独立审查“${loaded.workflow.objective}”的当前已验收实现，只报告阻塞问题或通过`,
      title: `审查${compactUserSummary(loaded.workflow.objective)}`,
      token,
      executor: null,
      host: null,
      cursor: null,
      status: "reserved",
      request_dag: false,
    };
    writeJson(loaded.statePath, state);
    return { contract: "WORKFLOW_REVIEW_V1", status: "reserved", ...quickRunReceipt(
      loaded.workflow,
      loaded.definitionPath,
      state,
    ) };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function workflowAttachCommand(
  goalDirectoryArgument        ,
  runIdArgument        ,
  executorArgument        ,
  hostArgument        ,
)       {
  const loaded = loadWorkflow(goalDirectoryArgument);
  if (loaded.workflow.mode !== "quick") fail("workflow attach is only available in quick mode");
  const executor = requireString(executorArgument, "executor id");
  const host = requireString(hostArgument, "host id");
  const payload = withStateLock(loaded.statePath, () => {
    const state = parseWorkflowState(readJson(loaded.statePath));
    const run = state.run ?? fail("quick workflow has no current run");
    if (run.id !== requireString(runIdArgument, "run id") || run.status !== "reserved") {
      fail("quick run is not reserved");
    }
    if (run.kind === "review" && (
      state.accepted?.executor === executor ||
      currentOwnerThreadIds(loaded.workflow.workspace).has(executor)
    )) {
      fail("quick Review requires a clean thread distinct from every current Owner thread");
    }
    const ownerId = run.owner ?? fail("quick run owner is missing");
    const { goal, owner, registry } = quickOwner(loaded.workflow, loaded.definitionPath, ownerId);
    const approvedGeneration = registry.owners.find((candidate) => candidate.id === ownerId)?.generation;
    if (
      registry.digest !== state.registry.digest || approvedGeneration !== run.generation
    ) fail("Owner Registry changed after quick dispatch; user action is required");
    const task = quickTask(run, owner);
    if (run.kind === "work") {
      const lease = acquireOwnerLease(goal, loaded.statePath, task, run.token);
      if (!lease.acquired) fail(`Owner ${owner.id} is busy in another workflow`);
    }
    const baselinePath = quickRuntimePath(loaded.directory, "baseline.json");
    const bindingPath = quickRuntimePath(loaded.directory, "binding.json");
    run.executor = executor;
    run.host = host;
    run.cursor = null;
    run.status = "running";
    state.revision += 1;
    const baseline = captureWorktreeSnapshot(loaded.workflow.workspace);
    const binding = quickBinding(
      loaded.directory,
      loaded.workflow,
      loaded.definitionPath,
      state,
      run,
      owner,
      registry,
    );
    try {
      writeTransaction(loaded.statePath, [
        [baselinePath, baseline],
        [bindingPath, binding],
        [loaded.statePath, state],
      ]);
    } catch (error) {
      if (run.kind === "work") releaseOwnerLease(goal, task, run.token);
      throw error;
    }
    if (run.kind === "work") {
      updateOwnerLease(goal, task, run.token, { executor_id: executor, status: "running" });
      writeJson(currentOwnerThreadPath(loaded.workflow.workspace, owner.id), {
        contract: "OWNER_THREAD_V1",
        owner: owner.id,
        generation: run.generation,
        thread_id: executor,
        host_id: host,
        updated_at: new Date().toISOString(),
      });
    }
    return {
      contract: "WORKFLOW_ATTACH_V1",
      status: "running",
      run: run.id,
      title: quickThreadTitle(run),
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function workflowThreadCommand(
  goalDirectoryArgument        ,
  roleArgument        ,
  threadArgument        ,
  hostArgument        ,
)       {
  const loaded = loadWorkflow(goalDirectoryArgument);
  const role = requireString(roleArgument, "workflow thread role")                      ;
  if (!new Set                    (["main", "planner", "planner_reviewer"]).has(role)) {
    fail("workflow thread role must be main, planner, or planner_reviewer");
  }
  const path = workflowRoutesPath(loaded.directory);
  const endpoint = {
    thread: requireString(threadArgument, "thread id"),
    host: requireString(hostArgument, "host id"),
  };
  const routes = withStateLock(path, () => {
    const current = parseWorkflowRoutes(readJson(path));
    current[role] = endpoint;
    writeJson(path, current);
    return current;
  });
  process.stdout.write(`${JSON.stringify({
    contract: "WORKFLOW_THREAD_RECEIPT_V1",
    status: "recorded",
    role,
    route: routes[role],
  })}\n`);
}

function workflowObserveCommand(
  goalDirectoryArgument        ,
  runIdArgument        ,
  cursorArgument        ,
)       {
  const loaded = loadWorkflow(goalDirectoryArgument);
  if (loaded.workflow.mode !== "quick") fail("workflow observe is only available in quick mode");
  const payload = withStateLock(loaded.statePath, () => {
    const state = parseWorkflowState(readJson(loaded.statePath));
    const run = state.run ?? fail("quick workflow has no current run");
    if (run.id !== requireString(runIdArgument, "run id") || run.status !== "running") {
      fail("quick run is not running");
    }
    run.cursor = cursorArgument === "-" ? null : requireString(cursorArgument, "cursor");
    state.revision += 1;
    writeJson(loaded.statePath, state);
    return { contract: "WORKFLOW_OBSERVE_RECEIPT_V1", status: "recorded", run: run.id, cursor: run.cursor };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function workflowDashboardAckCommand(goalDirectoryArgument        , statusArgument        )       {
  const goalDirectory = resolve(goalDirectoryArgument);
  const definitionPath = workflowDefinitionPath(goalDirectory);
  if (existsSync(definitionPath)) {
    const workflow = parseWorkflowDefinition(readJson(definitionPath), definitionPath);
    if (workflow.mode !== "dag") fail("workflow dashboard acknowledgement requires DAG mode");
  } else {
    const planPath = join(goalDirectory, "plan.json");
    const statePath = join(goalDirectory, "state.json");
    if (!existsSync(planPath) || !existsSync(statePath)) {
      fail("workflow dashboard acknowledgement requires an active DAG");
    }
    loadPlanAndState(planPath, statePath, { allowSourceDrift: true });
  }
  const status = requireString(statusArgument, "dashboard status");
  if (status !== "started" && status !== "failed") fail("dashboard status must be started or failed");
  const path = workflowDashboardPath(goalDirectory);
  if (!existsSync(path)) fail("dashboard start has not been requested");
  const current = requireRecord(readJson(path), "workflow dashboard state");
  if (current.contract !== "WORKFLOW_DASHBOARD_V1") {
    fail("workflow dashboard state is invalid");
  }
  if (current.status === status) {
    process.stdout.write(`${JSON.stringify({
      contract: "WORKFLOW_DASHBOARD_RECEIPT_V1",
      status,
      idempotent: true,
    })}\n`);
    return;
  }
  if (current.status !== "pending") {
    fail("workflow dashboard acknowledgement conflicts with the recorded status");
  }
  writeJson(path, {
    contract: "WORKFLOW_DASHBOARD_V1",
    status,
    updated_at: new Date().toISOString(),
  });
  process.stdout.write(`${JSON.stringify({
    contract: "WORKFLOW_DASHBOARD_RECEIPT_V1",
    status,
    idempotent: false,
  })}\n`);
}

function workflowSupervisorInitCommand(goalDirectoryArgument        )       {
  const goalDirectory = resolve(goalDirectoryArgument);
  const main = workflowRouteReceipt(goalDirectory, "main");
  if (main === null) fail("record the Main route before initializing Supervisor");
  supervisorInitCommand(
    goalDirectory,
    requireString(main.thread, "main thread"),
    requireString(main.host, "main host"),
  );
}

function workflowNativeConfirmCommand(goalDirectoryArgument        , tokenArgument        )       {
  const goalDirectory = resolve(goalDirectoryArgument);
  const receipt = runSelfJson([
    "native-confirm",
    join(goalDirectory, "goal.json"),
    join(goalDirectory, "goal-state.json"),
    requireString(tokenArgument, "completion token"),
  ]);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function quickWorkerOpenCommand(goalDirectoryArgument        , runIdArgument        )       {
  const loaded = loadWorkflow(goalDirectoryArgument);
  const run = loaded.state.run ?? fail("quick workflow has no current run");
  if (run.id !== requireString(runIdArgument, "run id") || run.status !== "running") {
    fail("quick run is not running");
  }
  const path = quickRuntimePath(loaded.directory, "binding.json");
  if (!existsSync(path)) fail("quick binding is missing");
  const binding = requireRecord(readJson(path), "quick binding");
  if (binding.contract !== "TASK_BINDING_V6") fail("quick binding contract is invalid");
  const bindingRun = requireRecord(binding.run, "quick binding.run");
  if (bindingRun.token !== run.token || bindingRun.executor !== run.executor) {
    fail("quick binding identity mismatch");
  }
  process.stdout.write(`${JSON.stringify(binding)}\n`);
}

function quickWorkerOutcomeCommand(
  goalDirectoryArgument        ,
  runIdArgument        ,
  status                                    ,
  requestDag = false,
)       {
  const summary = compactUserSummary(
    readPlainSemanticInput(requestDag ? "DAG upgrade summary" : "worker summary"),
  );
  const loaded = loadWorkflow(goalDirectoryArgument);
  const payload = withStateLock(loaded.statePath, () => {
    const state = parseWorkflowState(readJson(loaded.statePath));
    const run = state.run ?? fail("quick workflow has no current run");
    if (run.id !== requireString(runIdArgument, "run id") || run.status !== "running" || run.executor === null) {
      fail("quick run is not running");
    }
    const ownerId = run.owner ?? fail("quick run owner is missing");
    const { owner, registry } = quickOwner(loaded.workflow, loaded.definitionPath, ownerId);
    const approvedGeneration = registry.owners.find((candidate) => candidate.id === ownerId)?.generation;
    if (
      registry.digest !== state.registry.digest || approvedGeneration !== run.generation
    ) fail("Owner Registry changed during quick run; user action is required");
    const task = quickTask(run, owner);
    const taskState = quickTaskState(loaded.directory, state, run);
    const baselinePath = quickRuntimePath(loaded.directory, "baseline.json");
    if (!existsSync(baselinePath)) fail("quick run baseline is missing");
    const baseline = parseWorktreeBaseline(readJson(baselinePath), loaded.workflow.workspace);
    const current = captureWorktreeSnapshot(loaded.workflow.workspace);
    if (current.tree_oid !== baseline.tree_oid) fail("quick run observed a Git tree content change");
    const changed = changedWorktreePaths(baseline, current);
    if (run.kind === "review" && changed.length > 0) {
      fail(`quick Review cannot modify files: ${changed.join(", ")}`);
    }
    if (run.kind === "work") {
      const outside = changed.filter((path) => !ownerAllowsPath(owner, path));
      if (outside.length > 0) fail(`quick run changed files outside Owner scope: ${outside.join(", ")}`);
    }
    if (status !== "completed" && changed.length > 0) {
      fail("blocked or failed quick run must stop without unaccepted file changes");
    }
    const evidence = status === "completed" && run.kind === "work"
      ? [readWorkerVerification(
        workerVerificationPath(loaded.directory, task.id, "quick-check", true),
        run.id,
        "quick-check",
      )]
      : [];
    const subject                   = run.kind === "review"
      ? {
        id: `review-${loaded.workflow.id}`,
        role: "review",
        responsibility: "独立审查快速模式结果",
        worker_context: "只读取脚本交接和当前工作树",
      }
      : owner;
    const result                 = {
      contract: "WORKER_RESULT_V5",
      status,
      task_id: task.id,
      logical_id: task.logical_id,
      role: task.role,
      owner_id: task.owner_id,
      runtime_actor_id: null,
      owner_generation: run.generation,
      executor_id: run.executor,
      reservation_token: run.token,
      attempt: state.revision,
      source_revision: 1,
      changed_files: changed,
      evidence,
      diff_self_check: status === "completed" ? "pass" : "fail",
      blocking_findings: status === "blocked" ? [summary] : [],
      non_blocking_findings: [],
      follow_up_suggestions: [],
      reviewed_results: [],
      review_plan_digest: null,
      review_workspace_digest: null,
      scope_request: null,
      summary,
      owner_updates: { decisions: [], invariants: [], risks: [] },
      published_artifacts: [],
    };
    parseWorkerResult(result, task, subject, taskState);
    run.request_dag = requestDag;
    writeJson(loaded.statePath, state);
    const candidatePath = quickRuntimePath(loaded.directory, "candidate.json");
    writeImmutableJson(candidatePath, result);
    return {
      contract: "THREAD_TASK_RECEIPT_V1",
      status,
      run: run.id,
      blocking_count: result.blocking_findings.length,
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function acceptQuickCandidate(
  loaded                                 ,
  state                 ,
)                                                                 {
  const run = state.run ?? fail("quick workflow has no current run");
  const candidatePath = quickRuntimePath(loaded.directory, "candidate.json");
  if (!existsSync(candidatePath)) fail("quick candidate is missing");
  const ownerId = run.owner ?? fail("quick run owner is missing");
  const { goal, owner, registry } = quickOwner(loaded.workflow, loaded.definitionPath, ownerId);
  const approvedGeneration = registry.owners.find((candidate) => candidate.id === ownerId)?.generation;
  if (
    registry.digest !== state.registry.digest || approvedGeneration !== run.generation
  ) fail("Owner Registry changed before quick acceptance; user action is required");
  const task = quickTask(run, owner);
  const taskState = quickTaskState(loaded.directory, state, run);
  const subject                   = run.kind === "review"
    ? {
      id: `review-${loaded.workflow.id}`,
      role: "review",
      responsibility: "独立审查快速模式结果",
      worker_context: "只读取脚本交接和当前工作树",
    }
    : owner;
  const result = parseWorkerResult(readJson(candidatePath), task, subject, taskState);
  const baseline = parseWorktreeBaseline(
    readJson(quickRuntimePath(loaded.directory, "baseline.json")),
    loaded.workflow.workspace,
  );
  const current = captureWorktreeSnapshot(loaded.workflow.workspace);
  if (serializedJson(result.changed_files) !== serializedJson(changedWorktreePaths(baseline, current))) {
    fail("quick candidate no longer matches the current worktree");
  }
  const completed = {
    title: quickThreadTitle(run),
    status: result.status,
    summary: compactUserSummary(result.summary),
  };
  const writes                           = [];
  let updatePersistentOwner = false;
  if (result.status === "completed" && run.kind === "work") {
    const priorSummary = state.accepted?.summary ?? "";
    const accepted                  = {
      owner: owner.id,
      executor: run.executor          ,
      summary: compactUserSummary(
        priorSummary === "" || priorSummary === result.summary
          ? result.summary
          : `${priorSummary}；${result.summary}`,
      ),
      files: uniqueStrings([...(state.accepted?.files ?? []), ...result.changed_files]).sort(compareStableStrings),
      review: null,
    };
    state.accepted = accepted;
    state.next = run.request_dag ? "upgrade" : "decision";
    state.attention = null;
    writes.push([quickRuntimePath(loaded.directory, "accepted.json"), {
      contract: "QUICK_ACCEPTED_V1",
      objective: loaded.workflow.objective,
      ...accepted,
    }]);
    writes.push([quickRuntimePath(loaded.directory, "handoff.json"), {
      contract: "QUICK_HANDOFF_V1",
      objective: loaded.workflow.objective,
      summary: accepted.summary,
      files: accepted.files,
    }]);
    updatePersistentOwner = true;
  } else if (result.status === "completed") {
    if (state.accepted === null) fail("quick Review has no accepted implementation");
    state.accepted.review = compactUserSummary(result.summary);
    state.next = "decision";
    state.attention = null;
  } else {
    state.next = "blocked";
    state.attention = result.summary;
  }
  state.run = null;
  state.revision += 1;
  writes.push([loaded.statePath, state]);
  writeTransaction(loaded.statePath, writes);
  if (updatePersistentOwner) {
    updatePersistentOwnerCapsule(goal, owner, result, digestJson(result));
  }
  if (run.kind === "work") releaseOwnerLease(goal, task, run.token);
  for (const name of ["candidate.json", "baseline.json", "binding.json"]) {
    rmSync(quickRuntimePath(loaded.directory, name), { force: true });
  }
  rmSync(quickRuntimePath(loaded.directory, "verification"), { recursive: true, force: true });
  return { state, completed };
}

function finalizeQuickWorkflow(loaded                                 , state                 )                          {
  const accepted = state.accepted ?? fail("quick workflow has no accepted result");
  if (accepted.review === null) fail("quick workflow requires explicit Review before completion");
  const resultPath = join(loaded.directory, "result.json");
  const result = {
    contract: "WORKFLOW_RESULT_V1",
    mode: "quick",
    objective: loaded.workflow.objective,
    summary: accepted.summary,
    changed_files: accepted.files,
    review: accepted.review,
    completed_at: new Date().toISOString(),
  };
  writeJson(resultPath, result);
  state.status = "completed";
  state.next = "completed";
  state.run = null;
  state.accepted = null;
  state.attention = null;
  state.result_ref = resultPath;
  state.revision += 1;
  writeJson(loaded.statePath, state);
  rmSync(quickRuntimePath(loaded.directory, "."), { recursive: true, force: true });
  return {
    contract: "WORKFLOW_STEP_V1",
    action: "completed",
    completed_tasks: [],
    result_ref: resultPath,
  };
}

function upgradeQuickWorkflowToDag(loaded                                 , state                 )       {
  const accepted = state.accepted ?? fail("quick workflow upgrade requires accepted work");
  const sourcePath = join(loaded.directory, "source.md");
  writeTextAtomic(
    sourcePath,
    `# 剩余工作\n\n${loaded.workflow.objective}\n\n## 已验收输入\n\n${accepted.summary}\n\n` +
      `已修改文件：${accepted.files.length === 0 ? "无" : accepted.files.join("、")}\n`,
  );
  const goalPath = join(loaded.directory, "goal.json");
  runSelfJson(["goal-create", goalPath, loaded.workflow.workspace], {
    contract: "GOAL_INPUT_V1",
    id: loaded.workflow.id,
    objective: `继续完成：${loaded.workflow.objective}`,
    source: sourcePath,
    scope: ["**/*"],
  });
  runSelfJson(["goal-validate", goalPath]);
  loaded.workflow.mode = "dag";
  state.next = "dag";
  state.attention = null;
  state.revision += 1;
  writeTransaction(loaded.statePath, [
    [loaded.definitionPath, loaded.workflow],
    [loaded.statePath, state],
  ]);
}

function completeWorkflowWrapper(goalDirectory        , resultRef        )       {
  const definitionPath = workflowDefinitionPath(goalDirectory);
  const statePath = workflowStatePath(goalDirectory);
  if (!existsSync(definitionPath) || !existsSync(statePath)) return;
  withStateLock(statePath, () => {
    const state = parseWorkflowState(readJson(statePath));
    if (state.status === "completed") return;
    if (state.accepted !== null && existsSync(resultRef)) {
      const result = requireRecord(readJson(resultRef), "DAG workflow result");
      writeJson(resultRef, {
        ...result,
        accepted_input: {
          summary: state.accepted.summary,
          changed_files: state.accepted.files,
          owner: state.accepted.owner,
        },
      });
    }
    state.status = "completed";
    state.next = "completed";
    state.run = null;
    state.accepted = null;
    state.attention = null;
    state.result_ref = resultRef;
    state.revision += 1;
    writeJson(statePath, state);
    rmSync(quickRuntimePath(goalDirectory, "."), { recursive: true, force: true });
  });
}

function quickWorkflowStepCommand(goalDirectoryArgument        )       {
  const loaded = loadWorkflow(goalDirectoryArgument);
  let completed                                 = null;
  let state = withStateLock(loaded.statePath, () => {
    const current = parseWorkflowState(readJson(loaded.statePath));
    if (current.run !== null && existsSync(quickRuntimePath(loaded.directory, "candidate.json"))) {
      const accepted = acceptQuickCandidate(loaded, current);
      completed = accepted.completed;
      return accepted.state;
    }
    return current;
  });
  if (state.status === "completed") {
    process.stdout.write(`${JSON.stringify({
      contract: "WORKFLOW_STEP_V1",
      action: "completed",
      completed_tasks: [],
      result_ref: state.result_ref,
    })}\n`);
    return;
  }
  if (state.run !== null) {
    process.stdout.write(`${JSON.stringify({
      contract: "WORKFLOW_STEP_V1",
      action: state.run.status === "reserved" ? "attach_required" : "wait_thread",
      completed_tasks: completed === null ? [] : [completed],
      ...quickRunReceipt(loaded.workflow, loaded.definitionPath, state),
      executor: state.run.executor,
    })}\n`);
    return;
  }
  if (hasCurrentOwnerChange(loaded.workflow.workspace)) {
    if (currentOwnerChangeApplied(loaded.workflow.workspace)) {
      const registry = approvedOwnerRegistry(syntheticQuickGoal(
        loaded.workflow,
        loaded.definitionPath,
      ));
      state.registry = { revision: registry.revision, digest: registry.digest };
      state.revision += 1;
      writeJson(loaded.statePath, state);
      rmSync(currentOwnerChangeDirectory(loaded.workflow.workspace), {
        recursive: true,
        force: true,
      });
    } else {
      process.stdout.write(`${JSON.stringify({
        contract: "WORKFLOW_STEP_V1",
        action: "owner_action_required",
        completed_tasks: completed === null ? [] : [completed],
        reason: "Owner 变化等待用户批准并通过脚本应用",
      })}\n`);
      return;
    }
  }
  if (state.next === "upgrade") {
    upgradeQuickWorkflowToDag(loaded, state);
    workflowStepCommand(loaded.directory);
    return;
  }
  if (state.next === "decision" && state.accepted?.review !== null) {
    process.stdout.write(`${JSON.stringify(finalizeQuickWorkflow(loaded, state))}\n`);
    return;
  }
  const goal = syntheticQuickGoal(loaded.workflow, loaded.definitionPath);
  const registry = approvedOwnerRegistry(goal);
  process.stdout.write(`${JSON.stringify({
    contract: "WORKFLOW_STEP_V1",
    action: state.next === "owner"
      ? "owner_required"
      : state.next === "decision"
        ? "next_owner_or_review"
        : "user_blocked",
    completed_tasks: completed === null ? [] : [completed],
    attention: state.attention,
    owners: registry.owners.map((owner) => ({ id: owner.id, responsibility: owner.responsibility })),
  })}\n`);
}

function workerOpenCommand(goalDirectoryArgument        , runIdArgument        )       {
  const definitionPath = workflowDefinitionPath(resolve(goalDirectoryArgument));
  if (existsSync(definitionPath)) {
    const workflow = parseWorkflowDefinition(readJson(definitionPath), definitionPath);
    if (workflow.mode === "quick") return quickWorkerOpenCommand(goalDirectoryArgument, runIdArgument);
  }
  const run = taskForRun(goalDirectoryArgument, runIdArgument);
  if (run.taskState.status !== "running" || run.taskState.executor_id === null) {
    fail(`run ${runIdArgument} is not bound to a running thread`);
  }
  const binding = readTaskBindingSnapshot(
    taskBindingSnapshotPath(run.goalDirectory, run.task, run.taskState),
    run.planPath,
    run.statePath,
    run.task,
    run.taskState,
    run.taskState.executor_id,
  );
  process.stdout.write(`${JSON.stringify(binding)}\n`);
}

function workerVerificationPath(
  goalDirectory        ,
  taskId        ,
  verificationId        ,
  quick         ,
)         {
  return quick
    ? quickRuntimePath(goalDirectory, join("verification", `${verificationId}.json`))
    : join(goalDirectory, "artifacts", "verification", taskId, `${verificationId}.json`);
}

function readWorkerVerification(
  path        ,
  runId        ,
  verificationId        ,
)           {
  if (!existsSync(path)) fail(`verification has not been run: ${verificationId}`);
  const value = requireRecord(readJson(path), `verification ${verificationId}`);
  requireExactKeys(
    value,
    ["contract", "run", "verification_id", "argv", "cwd", "status", "exit_code", "stdout", "stderr", "finished_at"],
    `verification ${verificationId}`,
  );
  if (value.contract !== "WORKER_VERIFICATION_V1") fail("worker verification contract is invalid");
  if (value.run !== runId || value.verification_id !== verificationId) {
    fail(`verification identity mismatch: ${verificationId}`);
  }
  if (value.status !== "passed") fail(`verification did not pass: ${verificationId}`);
  return {
    verification_id: verificationId,
    outcome: "passed",
    summary: `${verificationId} passed by runtime script`,
    artifact_ref: path,
    artifact_digest: digestFile(path),
  };
}

function workerVerifyCommand(
  goalDirectoryArgument        ,
  runIdArgument        ,
  verificationIdArgument        ,
  command          ,
)       {
  if (command.length === 0) fail("worker verify requires a command argv");
  const goalDirectory = resolve(goalDirectoryArgument);
  const runId = requireString(runIdArgument, "run id");
  const verificationId = requireIdentifier(verificationIdArgument, "verification id");
  const definitionPath = workflowDefinitionPath(goalDirectory);
  let workspace        ;
  let taskId        ;
  let quick = false;
  if (existsSync(definitionPath)) {
    const workflow = parseWorkflowDefinition(readJson(definitionPath), definitionPath);
    if (workflow.mode === "quick") {
      const loaded = loadWorkflow(goalDirectory);
      const run = loaded.state.run ?? fail("quick workflow has no current run");
      if (run.id !== runId || run.status !== "running" || run.executor === null || run.kind !== "work") {
        fail("quick verification requires the current running work run");
      }
      if (verificationId !== "quick-check") fail("quick verification id must equal quick-check");
      workspace = workflow.workspace;
      taskId = "QUICK-WORK";
      quick = true;
    } else {
      const run = taskForRun(goalDirectory, runId);
      if (run.taskState.status !== "running" || run.taskState.executor_id === null) {
        fail("DAG verification requires a bound running task");
      }
      if (!run.task.verification_ids.includes(verificationId)) {
        fail(`verification is not bound to task ${run.task.id}: ${verificationId}`);
      }
      workspace = run.goal.workspace.root;
      taskId = run.task.id;
    }
  } else {
    const run = taskForRun(goalDirectory, runId);
    if (run.taskState.status !== "running" || run.taskState.executor_id === null) {
      fail("DAG verification requires a bound running task");
    }
    if (!run.task.verification_ids.includes(verificationId)) {
      fail(`verification is not bound to task ${run.task.id}: ${verificationId}`);
    }
    workspace = run.goal.workspace.root;
    taskId = run.task.id;
  }
  const execution = spawnSync(command[0], command.slice(1), {
    cwd: workspace,
    encoding: "utf8",
    shell: false,
    env: process.env,
    timeout: 10 * 60 * 1000,
    maxBuffer: 1024 * 1024,
  });
  const status = execution.error === undefined && execution.status === 0 ? "passed" : "failed";
  const compactOutput = (value                           )         => {
    const output = value ?? "";
    return [...output].length <= 32_000 ? output : `${[...output].slice(0, 31_999).join("")}…`;
  };
  const path = workerVerificationPath(goalDirectory, taskId, verificationId, quick);
  writeJson(path, {
    contract: "WORKER_VERIFICATION_V1",
    run: runId,
    verification_id: verificationId,
    argv: command,
    cwd: workspace,
    status,
    exit_code: execution.status,
    stdout: compactOutput(execution.stdout),
    stderr: compactOutput(execution.error?.message ?? execution.stderr),
    finished_at: new Date().toISOString(),
  });
  process.stdout.write(`${JSON.stringify({
    contract: "WORKER_VERIFICATION_RECEIPT_V1",
    status,
    verification_id: verificationId,
    log_ref: path,
  })}\n`);
}

function workerOutcomeCommand(
  goalDirectoryArgument        ,
  runIdArgument        ,
  status                                    ,
  reviewUpgradeReason         ,
)       {
  const definitionPath = workflowDefinitionPath(resolve(goalDirectoryArgument));
  if (existsSync(definitionPath)) {
    const workflow = parseWorkflowDefinition(readJson(definitionPath), definitionPath);
    if (workflow.mode === "quick") {
      return quickWorkerOutcomeCommand(goalDirectoryArgument, runIdArgument, status);
    }
  }
  const summary = compactUserSummary(readPlainSemanticInput("worker summary"));
  const run = taskForRun(goalDirectoryArgument, runIdArgument);
  if (run.taskState.status !== "running") fail(`run ${runIdArgument} is not running`);
  const evidence = status === "completed"
    ? run.task.verification_ids.map((id) => readWorkerVerification(
      workerVerificationPath(run.goalDirectory, run.task.id, id, false),
      requireString(runIdArgument, "run id"),
      id,
    ))
    : run.task.verification_ids.map((id) => ({
      verification_id: id,
      outcome: "not_run"         ,
      summary: `${id} not run`,
      artifact_ref: null,
      artifact_digest: null,
    }));
  const receipt = runSelfJson(
    [
      "result-submit",
      run.planPath,
      run.statePath,
      run.task.id,
      requireString(run.taskState.reservation_token, "reservation token"),
    ],
    {
      contract: "TASK_RESULT_INPUT_V2",
      status,
      summary,
      evidence: evidence.map((item) => ({
        id: item.verification_id,
        outcome: item.outcome,
        summary: item.summary,
        artifact: item.artifact_ref,
      })),
      ...(status === "blocked" ? { blocking: [summary] } : {}),
      ...(reviewUpgradeReason === undefined ? {} : { review_upgrade: reviewUpgradeReason }),
    },
  );
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function workerRiskOutcomeCommand(
  goalDirectoryArgument        ,
  runIdArgument        ,
  riskCodeArgument        ,
)       {
  const riskCode = requireString(riskCodeArgument, "risk code");
  const reasons                         = {
    "public-interface": "公共接口变化",
    security: "安全风险",
    concurrency: "并发风险",
    permissions: "权限风险",
    compatibility: "兼容性风险",
    scope: "scope 扩张",
    flaky: "测试不稳定",
    "repeated-failure": "重复失败",
  };
  if (reasons[riskCode] === undefined) fail(`invalid risk code: ${riskCode}`);
  workerOutcomeCommand(goalDirectoryArgument, runIdArgument, "completed", reasons[riskCode]);
}

function workerScopeRequestCommand(
  goalDirectoryArgument        ,
  runIdArgument        ,
  paths          ,
)       {
  if (paths.length === 0) fail("worker-request-scope requires at least one repository path");
  const reason = readPlainSemanticInput("scope request reason");
  const run = taskForRun(goalDirectoryArgument, runIdArgument);
  if (run.taskState.status !== "running") fail(`run ${runIdArgument} is not running`);
  const receipt = runSelfJson(
    [
      "result-submit",
      run.planPath,
      run.statePath,
      run.task.id,
      requireString(run.taskState.reservation_token, "reservation token"),
    ],
    {
      contract: "TASK_RESULT_INPUT_V2",
      status: "needs_repair",
      summary: reason,
      evidence: run.task.verification_ids.map((id) => ({
        id,
        outcome: "not_run",
        summary: `${id} not run`,
      })),
      scope: { paths, reason },
    },
  );
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function workerSubgraphCommand(goalDirectoryArgument        , runIdArgument        )       {
  const reason = readPlainSemanticInput("subgraph reason");
  const run = taskForRun(goalDirectoryArgument, runIdArgument);
  if (run.taskState.status !== "running") fail(`run ${runIdArgument} is not running`);
  const receipt = runSelfJson([
    "subgraph-request",
    run.planPath,
    run.statePath,
    run.task.id,
    requireString(run.taskState.reservation_token, "reservation token"),
    reason,
  ]);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function workerRequestDagCommand(goalDirectoryArgument        , runIdArgument        )       {
  const definitionPath = workflowDefinitionPath(resolve(goalDirectoryArgument));
  if (existsSync(definitionPath)) {
    const workflow = parseWorkflowDefinition(readJson(definitionPath), definitionPath);
    if (workflow.mode === "quick") {
      return quickWorkerOutcomeCommand(goalDirectoryArgument, runIdArgument, "completed", true);
    }
  }
  workerSubgraphCommand(goalDirectoryArgument, runIdArgument);
}

function plannerReviewDecisionCommand(goalDirectoryArgument        , args          )       {
  const goalDirectory = resolve(goalDirectoryArgument);
  const planPath = join(goalDirectory, "plan.json");
  if (!existsSync(planPath)) fail(`plan.json is missing: ${planPath}`);
  const decision = requireString(args[0], "planner review decision");
  if (decision === "pass") {
    if (args.length !== 1) fail("planner-review pass takes no issue codes");
    const receipt = runSelfJson(["planner-review-submit", planPath], {
      parallelism: "pass",
      too_complex: false,
      too_simple: false,
      changes: [],
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    return;
  }
  if (decision !== "revise" || args.length < 2) {
    fail("planner-review requires pass or revise <parallelism|too-complex|too-simple>...");
  }
  const issues = uniqueStrings(args.slice(1));
  const allowed = new Set(["parallelism", "too-complex", "too-simple"]);
  for (const issue of issues) if (!allowed.has(issue)) fail(`invalid planner review issue: ${issue}`);
  const changeText                         = {
    parallelism: "提高无依赖分支的可执行宽度",
    "too-complex": "合并过细节点并使用 Composite 子图",
    "too-simple": "拆分范围过大的任务并明确依赖",
  };
  const receipt = runSelfJson(["planner-review-submit", planPath], {
    parallelism: issues.includes("parallelism") ? "revise" : "pass",
    too_complex: issues.includes("too-complex"),
    too_simple: issues.includes("too-simple"),
    changes: issues.map((issue) => changeText[issue]),
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function plannerOpenCommand(goalDirectoryArgument        , cursorArgument         )       {
  const goalDirectory = resolve(goalDirectoryArgument);
  const goalPath = join(goalDirectory, "goal.json");
  const planPath = join(goalDirectory, "plan.json");
  const statePath = join(goalDirectory, "state.json");
  const goal = parseGoal(readJson(goalPath));
  const registry = approvedOwnerRegistry(goal);
  const cursor = cursorArgument === undefined
    ? 0
    : requireNonNegativeInteger(Number(cursorArgument), "planner cursor");
  let action = "initial_plan";
  let revision                = null;
  let tasks                                 = [];
  let reviewUpgrades                                 = [];
  let subgraphRequests                                 = [];
  let problems                                 = [];
  if (existsSync(planPath)) {
    const rawState = existsSync(statePath)
      ? requireRecord(readJson(statePath), "planner state")
      : null;
    const ownerTransitionPending = rawState?.owner_change !== null &&
      rawState?.owner_change !== undefined;
    const loaded = existsSync(statePath)
      ? loadPlanAndState(planPath, statePath, {
        allowSourceDrift: true,
        allowOwnerRegistryDrift: ownerTransitionPending,
      })
      : null;
    const parsed = loaded?.plan ?? parsePlan(readJson(planPath), planPath).plan;
    revision = parsed.revision;
    const state = loaded?.state ?? null;
    if (state === null) {
      action = "review_draft";
    } else {
      const goalState = goalStateForPlan(planPath, parsed, goal).state;
      reviewUpgrades = pendingReviewUpgrades(state);
      subgraphRequests = pendingSubgraphRequests(parsed, state).map((request) => {
        const task = parsed.tasks.find((candidate) => candidate.id === request.task_id)                  ;
        const taskState = state.tasks[request.task_id];
        const semantic = validateTaskSubgraphRequest(
          readJson(request.request_ref),
          task,
          taskState,
        );
        return {
          task_id: request.task_id,
          run: taskRunId(request.task_id, taskState),
          reason: semantic.reason,
        };
      });
      action = ownerTransitionPending && registry.digest !== state.owner_registry.digest
        ? "owner_transition"
        : reviewUpgrades.length > 0
          ? "upgrade_review"
          : subgraphRequests.length > 0
            ? "expand_subgraph"
            : coordinatedNextAction(
              planPath,
              parsed,
              goal,
              loaded?.coverage                ,
              state,
              goalState,
            );
      problems = parsed.tasks.flatMap((task) => {
        const taskState = state.tasks[task.id];
        if (!new Set(["blocked", "failed", "needs_repair"]).has(taskState.status) ||
          taskState.result_ref === null || !existsSync(taskState.result_ref)) return [];
        const result = parseWorkerResult(
          readJson(taskState.result_ref),
          task,
          subjectForTask(parsed, task),
          taskState,
        );
        return [{
          task_id: task.id,
          status: taskState.status,
          summary: compactUserSummary(result.summary),
          blocking: result.blocking_findings.map(compactUserSummary).slice(0, 8),
        }];
      }).slice(0, 50);
    }
    tasks = parsed.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      owner: task.owner_id ?? task.runtime_actor_id,
      role: task.role,
      status: state === null ? "draft" : state.tasks[task.id].status,
      after: task.depends_on,
      parent: task.parent_task_id,
    }));
  }
  const pageSize = 50;
  const page = tasks.slice(cursor, cursor + pageSize);
  process.stdout.write(`${JSON.stringify({
    contract: "PLANNER_OPEN_V1",
    action,
    goal: {
      id: goal.goal_id,
      objective: goal.objective,
      source: goal.source.path,
    },
    revision,
    owners: registry.owners.map((owner) => ({
      id: owner.id,
      responsibility: owner.responsibility,
      scope: owner.scope_patterns,
    })),
    tasks: page,
    review_upgrades: reviewUpgrades,
    subgraph_requests: subgraphRequests,
    problems,
    next_cursor: cursor + page.length < tasks.length ? cursor + page.length : null,
  })}\n`);
}

function plannerSubmitCommand(goalDirectoryArgument        , modeArgument        , runId         )       {
  const goalDirectory = resolve(goalDirectoryArgument);
  const goalPath = join(goalDirectory, "goal.json");
  const planPath = join(goalDirectory, "plan.json");
  const statePath = join(goalDirectory, "state.json");
  const mode = requireString(modeArgument, "planner submit mode");
  const input = readStructuredInput("-");
  let receipt                         ;
  if (mode === "initial") {
    if (runId !== undefined) fail("planner-submit initial does not accept run id");
    receipt = runSelfJson(["plan-create", goalPath, planPath], input);
  } else if (mode === "revise") {
    if (runId !== undefined) fail("planner-submit revise does not accept run id");
    receipt = runSelfJson(["plan-revise", goalPath, planPath], input);
  } else if (mode === "delta") {
    if (runId !== undefined) fail("planner-submit delta does not accept run id");
    receipt = runSelfJson(["apply-delta", planPath, statePath, "-"], input);
  } else if (mode === "subgraph") {
    if (runId === undefined) fail("planner-submit subgraph requires run id");
    const run = taskForRun(goalDirectory, runId);
    receipt = runSelfJson([
      "expand-subgraph",
      run.planPath,
      run.statePath,
      run.task.id,
      requireString(run.taskState.reservation_token, "reservation token"),
      "-",
    ], input);
  } else {
    fail("planner-submit mode must be initial, revise, delta, or subgraph");
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function workflowCreateCommand(
  workspaceArgument        ,
  goalIdArgument        ,
  sourceArgument        ,
)       {
  const workspaceRoot = resolve(workspaceArgument);
  const goalId = requireIdentifier(goalIdArgument, "goal id");
  const sourcePath = isAbsolute(sourceArgument)
    ? resolve(sourceArgument)
    : resolve(workspaceRoot, sourceArgument);
  const objective = readPlainSemanticInput("goal objective");
  const goalDirectory = join(
    workspaceRoot,
    ".ghost-agent-workflow",
    "runtime",
    "goals",
    goalId,
  );
  mkdirSync(goalDirectory, { recursive: true });
  const goalPath = join(goalDirectory, "goal.json");
  const created = runSelfJson(
    ["goal-create", goalPath, workspaceRoot],
    {
      contract: "GOAL_INPUT_V1",
      id: goalId,
      objective,
      source: sourcePath,
      scope: ["**/*"],
    },
  );
  const validated = runSelfJson(["goal-validate", goalPath]);
  process.stdout.write(`${JSON.stringify({
    contract: "WORKFLOW_CREATE_RECEIPT_V1",
    status: validated.status,
    goal_dir: goalDirectory,
    goal_ref: created.goal_ref,
    thread_titles: validated.thread_titles,
  })}\n`);
}

function workflowStartCommand(workspaceArgument        , modeArgument        )       {
  const workspace = resolve(workspaceArgument);
  if (!existsSync(workspace)) fail(`workspace root does not exist: ${workspace}`);
  const mode = requireString(modeArgument, "workflow mode")                ;
  if (mode !== "quick" && mode !== "dag") fail("workflow mode must equal quick or dag");
  const objective = requireChineseText(readPlainSemanticInput("workflow objective"), "workflow objective");
  loadThreadWorkflowConfig(workspace);
  const active = activeWorkflowDirectories(workspace);
  if (active.length > 0) {
    fail(`workspace already has an active workflow: ${active.join(", ")}`);
  }
  const id = `wf-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const directory = join(workspace, ".ghost-agent-workflow", "runtime", "goals", id);
  const definitionPath = workflowDefinitionPath(directory);
  const statePath = workflowStatePath(directory);
  const workflow                       = {
    contract: "WORKFLOW_V1",
    id,
    mode,
    workspace,
    objective,
    created_at: new Date().toISOString(),
  };
  const registryGoal = syntheticQuickGoal(workflow, definitionPath);
  const registry = approvedOwnerRegistry(registryGoal);
  if (registry.owners.length === 0) fail("workflow requires at least one approved Owner");
  const state                  = {
    contract: "WORKFLOW_STATE_V1",
    status: "active",
    revision: 1,
    next: mode === "quick" ? "owner" : "dag",
    registry: { revision: registry.revision, digest: registry.digest },
    run: null,
    accepted: null,
    attention: null,
    result_ref: null,
  };
  const routes                   = {
    contract: "WORKFLOW_ROUTES_V1",
    main: null,
    planner: null,
    planner_reviewer: null,
  };
  mkdirSync(directory, { recursive: true });
  try {
    if (mode === "quick") {
      writeTransaction(statePath, [
        [definitionPath, workflow],
        [workflowRoutesPath(directory), routes],
        [statePath, state],
      ]);
    } else {
      const sourcePath = join(directory, "source.md");
      writeTextAtomic(sourcePath, `# 工作目标\n\n${objective}\n`);
      runSelfJson(["goal-create", join(directory, "goal.json"), workspace], {
        contract: "GOAL_INPUT_V1",
        id,
        objective,
        source: sourcePath,
        scope: ["**/*"],
      });
      runSelfJson(["goal-validate", join(directory, "goal.json")]);
      writeTransaction(statePath, [
        [definitionPath, workflow],
        [workflowRoutesPath(directory), routes],
        [statePath, state],
      ]);
    }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  process.stdout.write(`${JSON.stringify({
    contract: "WORKFLOW_START_V1",
    status: "created",
    mode,
    workflow_dir: directory,
    thread_title: `[GA][任务][主控] ${compactUserSummary(objective)}`,
    action: mode === "quick" ? "owner_required" : "planner_required",
  })}\n`);
}

function ownerPauseCurrentCommand(goalDirectoryArgument        )       {
  const goalDirectory = resolve(goalDirectoryArgument);
  const goalPath = join(goalDirectory, "goal.json");
  const planPath = join(goalDirectory, "plan.json");
  const statePath = join(goalDirectory, "state.json");
  const goal = parseGoal(readJson(goalPath));
  const requestPath = join(
    goal.workspace.root,
    ".ghost-agent-workflow",
    "runtime",
    "owner-change",
    "current",
    "request.json",
  );
  if (!existsSync(requestPath)) fail("current Owner change request is missing");
  const receipt = runSelfJson(["owner-change-pause", planPath, statePath, requestPath]);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function supervisorResumeCommand(goalDirectoryArgument        , runIdArgument        )       {
  const run = taskForRun(goalDirectoryArgument, runIdArgument);
  const receipt = runSelfJson([
    "supervisor-record",
    resolve(goalDirectoryArgument),
    "resumed",
    run.task.id,
    String(run.taskState.attempt),
  ]);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function supervisorInitCommand(
  goalDirectoryArgument        ,
  mainThreadIdArgument        ,
  mainHostIdArgument        ,
)       {
  const goalDirectory = resolve(goalDirectoryArgument);
  const goal = parseGoal(readJson(join(goalDirectory, "goal.json")));
  const threadsPath = join(goalDirectory, "threads.json");
  const registry = runSelfJson([
    "thread-registry",
    "init",
    threadsPath,
    goal.goal_id,
    requireString(mainThreadIdArgument, "main thread id"),
    requireString(mainHostIdArgument, "main host id"),
  ]);
  const profile = loadThreadWorkflowConfig(goal.workspace.root).profiles.supervisor;
  process.stdout.write(`${JSON.stringify({
    contract: "SUPERVISOR_INIT_V1",
    status: registry.status,
    thread_title: goalThreadTitles(goal).supervisor,
    model: profile.model,
    effort: profile.reasoning_effort,
  })}\n`);
}

function supervisorRecoverRunCommand(goalDirectoryArgument        , runIdArgument        )       {
  const reason = readPlainSemanticInput("recovery reason");
  const run = taskForRun(goalDirectoryArgument, runIdArgument);
  const receipt = runSelfJson([
    "supervisor-recover",
    resolve(goalDirectoryArgument),
    run.task.id,
    String(run.taskState.attempt),
    reason,
  ]);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function workflowStepCommand(goalDirectoryArgument        )       {
  const goalDirectory = resolve(goalDirectoryArgument);
  const definitionPath = workflowDefinitionPath(goalDirectory);
  if (existsSync(definitionPath)) {
    const workflow = parseWorkflowDefinition(readJson(definitionPath), definitionPath);
    if (workflowRouteReceipt(goalDirectory, "main") === null) {
      process.stdout.write(`${JSON.stringify({
        contract: "WORKFLOW_STEP_V1",
        action: "main_route_required",
        thread_title: `[GA][任务][主控] ${compactUserSummary(workflow.objective)}`,
      })}\n`);
      return;
    }
    if (workflow.mode === "quick") return quickWorkflowStepCommand(goalDirectory);
  }
  const goalPath = join(goalDirectory, "goal.json");
  const goalStatePath = join(goalDirectory, "goal-state.json");
  const planPath = join(goalDirectory, "plan.json");
  const statePath = join(goalDirectory, "state.json");
  if (!existsSync(goalPath)) fail(`goal.json is missing: ${goalPath}`);
  if (!existsSync(goalStatePath)) runSelfJson(["goal-validate", goalPath]);
  const goal = parseGoal(readJson(goalPath));
  const currentGoalState = requireRecord(readJson(goalStatePath), "workflow goal state");
  if (currentGoalState.status === "completed") {
    const completedResultRef = requireString(currentGoalState.result_ref, "workflow goal result_ref");
    const nativeSync = requireRecord(currentGoalState.native_sync, "workflow native sync");
    if (nativeSync.status === "pending") {
      process.stdout.write(`${JSON.stringify({
        contract: "WORKFLOW_STEP_V1",
        action: "native_completion_required",
        completed_tasks: [],
        result_ref: completedResultRef,
        native_action: {
          action: "update_goal",
          status: "complete",
          completion_token: requireString(nativeSync.completion_token, "native completion token"),
          objective_digest: requireString(nativeSync.objective_digest, "native objective digest"),
          native_goal: goal.lifecycle.native_goal,
        },
      })}\n`);
      return;
    }
    completeWorkflowWrapper(goalDirectory, completedResultRef);
    process.stdout.write(`${JSON.stringify({
      contract: "WORKFLOW_STEP_V1",
      action: "completed",
      completed_tasks: [],
      result_ref: completedResultRef,
      native_sync: nativeSync.status,
    })}\n`);
    return;
  }

  if (hasCurrentOwnerChange(goal.workspace.root) && !existsSync(statePath)) {
    if (!currentOwnerChangeApplied(goal.workspace.root)) {
      process.stdout.write(`${JSON.stringify({
        contract: "WORKFLOW_STEP_V1",
        action: "owner_action_required",
        completed_tasks: [],
        reason: "Owner 变化等待用户批准并通过脚本应用",
      })}\n`);
      return;
    }
    if (existsSync(planPath)) {
      rmSync(planPath, { force: true });
      rmSync(join(goalDirectory, "coverage.json"), { force: true });
      rmSync(plannerReviewDirectory(planPath), { recursive: true, force: true });
    }
    rmSync(currentOwnerChangeDirectory(goal.workspace.root), { recursive: true, force: true });
  }
  if (!existsSync(planPath)) {
    process.stdout.write(`${JSON.stringify({
      contract: "WORKFLOW_STEP_V1",
      action: "planner_required",
      planner_action: "initial_plan",
      goal_dir: goalDirectory,
      thread_title: goalThreadTitles(goal).planner,
      preferred_thread: preferredWorkflowThread(goalDirectory, "planner"),
      ...threadProfileReceipt(goal.workspace.root, "planner"),
    })}\n`);
    return;
  }
  if (!existsSync(statePath)) {
    const { plan } = parsePlan(readJson(planPath), planPath);
    const contextPath = plannerReviewContextPath(planPath, plan.revision);
    if (!existsSync(contextPath)) runSelfJson(["planner-review-context", planPath, "--compact"]);
    const reviewPath = plannerReviewPath(planPath, plan.revision);
    if (!existsSync(reviewPath)) {
      process.stdout.write(`${JSON.stringify({
        contract: "WORKFLOW_STEP_V1",
        action: "planner_review_required",
        context_ref: contextPath,
        thread_title: goalThreadTitles(parseGoal(readJson(goalPath))).planner_reviewer,
        preferred_thread: preferredWorkflowThread(goalDirectory, "planner_reviewer"),
        ...threadProfileReceipt(goal.workspace.root, "review"),
      })}\n`);
      return;
    }
    const review = parsePlannerReview(readJson(reviewPath), planPath, plan);
    if (review.decision === "revise") {
      process.stdout.write(`${JSON.stringify({
        contract: "WORKFLOW_STEP_V1",
        action: plan.revision >= 2 ? "main_attention_required" : "planner_revision_required",
        reasons: review.changes,
        thread_title: goalThreadTitles(parseGoal(readJson(goalPath))).planner,
        preferred_thread: preferredWorkflowThread(goalDirectory, "planner"),
        ...threadProfileReceipt(goal.workspace.root, "planner"),
      })}\n`);
      return;
    }
    runSelfJson(["activate", planPath]);
  }

  let ownerActionPending = false;
  if (hasCurrentOwnerChange(goal.workspace.root)) {
    let rawState = requireRecord(readJson(statePath), "workflow DAG state");
    if (rawState.owner_change === null) {
      runSelfJson([
        "owner-change-pause",
        planPath,
        statePath,
        currentOwnerChangePath(goal.workspace.root, "request.json"),
      ]);
      rawState = requireRecord(readJson(statePath), "paused workflow DAG state");
    }
    const pausedState = loadPlanAndState(planPath, statePath, {
      allowSourceDrift: true,
      allowOwnerRegistryDrift: true,
    }).state;
    const currentRegistry = approvedOwnerRegistry(goal);
    if (pausedState.owner_registry.digest !== currentRegistry.digest) {
      process.stdout.write(`${JSON.stringify({
        contract: "WORKFLOW_STEP_V1",
        action: "planner_required",
        planner_action: "owner_transition",
        completed_tasks: [],
        thread_title: goalThreadTitles(goal).planner,
        preferred_thread: preferredWorkflowThread(goalDirectory, "planner"),
        ...threadProfileReceipt(goal.workspace.root, "planner"),
      })}\n`);
      return;
    }
    ownerActionPending = true;
  }

  const dashboardPath = workflowDashboardPath(goalDirectory);
  if (!existsSync(dashboardPath)) {
    writeJson(dashboardPath, {
      contract: "WORKFLOW_DASHBOARD_V1",
      status: "pending",
      updated_at: new Date().toISOString(),
    });
  }
  const dashboard = requireRecord(readJson(dashboardPath), "workflow dashboard state");
  if (dashboard.contract !== "WORKFLOW_DASHBOARD_V1" ||
    !new Set(["pending", "started", "failed"]).has(String(dashboard.status))) {
    fail("workflow dashboard state is invalid");
  }
  if (dashboard.status === "pending") {
    process.stdout.write(`${JSON.stringify({
      contract: "WORKFLOW_STEP_V1",
      action: "dashboard_start_required",
      goal_id: goal.goal_id,
      goal_dir: goalDirectory,
    })}\n`);
    return;
  }

  const completedTasks                            = [];
  for (let cycle = 0; cycle < 32; cycle += 1) {
    const loaded = loadPlanAndState(planPath, statePath, {
      allowSourceDrift: true,
      allowOwnerRegistryDrift: ownerActionPending,
    });
    for (const task of loaded.plan.tasks) {
      const taskState = loaded.state.tasks[task.id];
      if (
        taskState.status === "running" && taskState.result_path !== null &&
        existsSync(taskState.result_path)
      ) {
        const receipt = runSelfJson([
          "finish",
          planPath,
          statePath,
          task.id,
          requireString(taskState.reservation_token, "reservation token"),
          taskState.result_path,
          "--compact",
        ]);
        completedTasks.push({
          task_id: receipt.task_id,
          status: receipt.status,
          user_message: receipt.user_message,
        });
      }
    }

    if (ownerActionPending) {
      let current = loadPlanAndState(planPath, statePath, {
        allowSourceDrift: true,
        allowOwnerRegistryDrift: true,
      }).state;
      const reserved = Object.entries(current.tasks)
        .filter(([, task]) => task.status === "reserved");
      for (const [taskId, taskState] of reserved) {
        runSelfJson([
          "abandon",
          planPath,
          statePath,
          taskId,
          requireString(taskState.reservation_token, "reservation token"),
          "Owner change reached before thread bind",
        ]);
      }
      if (reserved.length > 0) {
        current = loadPlanAndState(planPath, statePath, {
          allowSourceDrift: true,
          allowOwnerRegistryDrift: true,
        }).state;
      }
      const active = Object.entries(current.tasks)
        .filter(([, task]) => task.status === "reserved" || task.status === "running")
        .map(([taskId]) => taskId);
      process.stdout.write(`${JSON.stringify({
        contract: "WORKFLOW_STEP_V1",
        action: "owner_action_required",
        completed_tasks: completedTasks,
        reason: active.length === 0
          ? "Owner 变化等待用户批准并通过脚本应用"
          : "Owner 变化已暂停新任务；等待当前任务到达安全边界",
        active_tasks: active,
      })}\n`);
      return;
    }

    const reconciled = runSelfJson(["reconcile", planPath, statePath, "--compact"]);
    const nextAction = requireString(reconciled.next_action, "workflow next action");
    if (nextAction === "execute") {
      const active = Array.isArray(reconciled.active_reservations)
        ? reconciled.active_reservations.map((value, index) =>
          requireRecord(value, `active reservation ${index}`)
        )
        : [];
      let ranScript = false;
      for (const reservation of active.filter((item) => item.action === "run_script")) {
        runSelfJson([
          "runtime-execute",
          planPath,
          statePath,
          requireIdentifier(reservation.task_id, "runtime task id"),
          requireString(reservation.reservation_token, "runtime reservation token"),
        ]);
        ranScript = true;
      }
      if (ranScript) continue;
      const reserved = runSelfJson(["reserve", planPath, statePath, "--compact"]);
      const actions = Array.isArray(reserved.actions)
        ? reserved.actions.map((value, index) => requireRecord(value, `reserve action ${index}`))
        : [];
      for (const action of actions.filter((item) => item.action === "run_script")) {
        runSelfJson([
          "runtime-execute",
          planPath,
          statePath,
          requireIdentifier(action.task_id, "runtime task id"),
          requireString(action.reservation_token, "runtime reservation token"),
        ]);
        ranScript = true;
      }
      if (ranScript) continue;
      const threadsPath = join(goalDirectory, "threads.json");
      process.stdout.write(`${JSON.stringify({
        contract: "WORKFLOW_STEP_V1",
        action: existsSync(threadsPath) ? "supervisor_required" : "supervisor_init_required",
        completed_tasks: completedTasks,
        thread_title: goalThreadTitles(parseGoal(readJson(goalPath))).supervisor,
      })}\n`);
      return;
    }
    if (nextAction === "finalize") {
      const finalized = runSelfJson([
        "finalize",
        goalPath,
        goalStatePath,
        planPath,
        statePath,
        "--compact",
      ]);
      completeWorkflowWrapper(goalDirectory, requireString(finalized.result_ref, "finalized result_ref"));
      process.stdout.write(`${JSON.stringify({
        contract: "WORKFLOW_STEP_V1",
        action: "completed",
        completed_tasks: completedTasks,
        result_ref: finalized.result_ref,
        native_sync: finalized.native_sync,
        ...(finalized.native_action === undefined ? {} : { native_action: finalized.native_action }),
      })}\n`);
      return;
    }
    if (nextAction === "source_refresh") {
      runSelfJson(["goal-refresh", goalPath, goalStatePath, planPath, statePath]);
      continue;
    }
    if (["upgrade_review", "expand_subgraph", "needs_delta", "repair"].includes(nextAction)) {
      const subgraph = nextAction === "expand_subgraph"
        ? pendingSubgraphRequests(loaded.plan, loaded.state)[0]
        : null;
      const subgraphTask = subgraph === null || subgraph === undefined
        ? null
        : loaded.plan.tasks.find((task) => task.id === subgraph.task_id) ?? null;
      process.stdout.write(`${JSON.stringify({
        contract: "WORKFLOW_STEP_V1",
        action: "planner_required",
        planner_action: nextAction,
        completed_tasks: completedTasks,
        thread_title: subgraphTask === null
          ? goalThreadTitles(goal).planner
          : compositePlannerThreadTitle(subgraphTask),
        preferred_thread: preferredWorkflowThread(goalDirectory, "planner"),
        ...threadProfileReceipt(goal.workspace.root, "planner"),
      })}\n`);
      return;
    }
    if (nextAction === "awaiting_owner_action") {
      process.stdout.write(`${JSON.stringify({
        contract: "WORKFLOW_STEP_V1",
        action: "owner_action_required",
        completed_tasks: completedTasks,
        reason: "Owner 变化等待用户处理",
      })}\n`);
      return;
    }
    if (nextAction === "source_drift_drain") {
      const reserved = loaded.plan.tasks.filter((task) =>
        loaded.state.tasks[task.id].status === "reserved"
      );
      if (reserved.length > 0) {
        for (const task of reserved) {
          runSelfJson([
            "abandon",
            planPath,
            statePath,
            task.id,
            requireString(loaded.state.tasks[task.id].reservation_token, "reservation token"),
            "source changed before thread bind",
          ]);
        }
        continue;
      }
      const threadsPath = join(goalDirectory, "threads.json");
      process.stdout.write(`${JSON.stringify({
        contract: "WORKFLOW_STEP_V1",
        action: existsSync(threadsPath) ? "supervisor_required" : "supervisor_init_required",
        completed_tasks: completedTasks,
        reason: "源文件变化；等待当前执行线程结束后由脚本刷新",
        thread_title: goalThreadTitles(goal).supervisor,
      })}\n`);
      return;
    }
    if (["confirm_stale_executors", "user_blocked"].includes(nextAction)) {
      process.stdout.write(`${JSON.stringify({
        contract: "WORKFLOW_STEP_V1",
        action: "user_action_required",
        reason: nextAction,
        completed_tasks: completedTasks,
        stale_runs: nextAction === "confirm_stale_executors"
          ? loaded.state.stale_executors.map((item) => ({
            executor: item.executor_id,
            task: item.task_id,
            attempt: item.attempt,
          }))
          : [],
      })}\n`);
      return;
    }
    if (nextAction === "native_completion_pending" || nextAction === "completed") continue;
    fail(`workflow step cannot route action: ${nextAction}`);
  }
  fail("workflow step exceeded its deterministic transition limit");
}

function runtimeExecuteCommand(
  planArgument        ,
  stateArgument        ,
  taskId        ,
  reservationToken        ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const rawState = readJson(statePath);
  const plan = parsePlan(readJson(planPath), planPath, {
    liveTaskIds: liveTaskIdsFromRawState(rawState),
    ownerValidationTaskIds: ownerValidationTaskIdsFromRawState(rawState),
  }).plan;
  const task = plan.tasks.find((candidate) => candidate.id === taskId);
  if (task === undefined) fail(`unknown task: ${taskId}`);
  if (task.owner_id !== null || task.runtime_actor_id === null) {
    fail(`task ${taskId} is not a script runtime task`);
  }
  let state = parseState(rawState, plan, planPath);
  let taskState = state.tasks[taskId];
  if (taskState.reservation_token !== reservationToken) fail("reservation token mismatch");
  if (taskState.status === "completed") {
    process.stdout.write(`${JSON.stringify({
      contract: "RUNTIME_TASK_RECEIPT_V1",
      status: "completed",
      task_id: taskId,
      result_ref: taskState.result_ref,
      idempotent: true,
    })}\n`);
    return;
  }
  const executorId = `runtime-script-${task.runtime_actor_id}`;
  if (taskState.status === "reserved") {
    runSelfJson(["bind", planPath, statePath, taskId, reservationToken, executorId]);
    state = parseState(readJson(statePath), plan, planPath);
    taskState = state.tasks[taskId];
  }
  if (taskState.status !== "running" || taskState.executor_id !== executorId) {
    fail(`runtime task ${taskId} is not running under ${executorId}`);
  }
  if (taskState.result_path === null) fail(`runtime task ${taskId} result path is missing`);
  let audit                                 = null;
  if (!existsSync(taskState.result_path)) {
    if (task.runtime_actor_id === "source-audit") {
      audit = runSelfJson(
        ["source-audit-auto", planPath, statePath, taskId, reservationToken],
        { contract: "SOURCE_AUDIT_INPUT_V1", non_requirements: {} },
      );
    } else if (task.runtime_actor_id === "diff-audit") {
      audit = runSelfJson(["diff-audit", planPath, statePath, taskId, reservationToken]);
    } else {
      audit = runSelfJson(["commit-readiness", planPath, statePath, taskId, reservationToken]);
    }
    const verificationId = requireIdentifier(audit.verification_id, "runtime audit.verification_id");
    const artifactRef = requireString(audit.artifact_ref, "runtime audit.artifact_ref");
    runSelfJson(
      ["result-submit", planPath, statePath, taskId, reservationToken],
      {
        contract: "TASK_RESULT_INPUT_V2",
        status: "completed",
        summary: `${verificationId} passed by runtime script`,
        evidence: [{
          id: verificationId,
          outcome: "passed",
          summary: `${verificationId} passed`,
          artifact: artifactRef,
        }],
      },
    );
  }
  const finished = runSelfJson([
    "finish",
    planPath,
    statePath,
    taskId,
    reservationToken,
    taskState.result_path,
  ]);
  process.stdout.write(`${JSON.stringify({
    contract: "RUNTIME_TASK_RECEIPT_V1",
    status: finished.status,
    task_id: taskId,
    result_ref: finished.result_ref,
    verification_id: audit?.verification_id ?? task.verification_ids[0] ?? null,
    idempotent: false,
  })}\n`);
}

function main(argv          )       {
  const [command, ...args] = argv;
  if (command === "workflow" && args[0] === "start" && args.length === 3) {
    return workflowStartCommand(args[1], args[2]);
  }
  if (command === "workflow" && args[0] === "step" && args.length === 2) {
    return workflowStepCommand(args[1]);
  }
  if (command === "workflow" && args[0] === "dispatch" && args.length === 3) {
    return workflowDispatchCommand(args[1], args[2]);
  }
  if (command === "workflow" && args[0] === "review" && args.length === 2) {
    return workflowReviewCommand(args[1]);
  }
  if (command === "workflow" && args[0] === "attach" && args.length === 5) {
    return workflowAttachCommand(args[1], args[2], args[3], args[4]);
  }
  if (command === "workflow" && args[0] === "thread" && args.length === 5) {
    return workflowThreadCommand(args[1], args[2], args[3], args[4]);
  }
  if (command === "workflow" && args[0] === "observe" && args.length === 4) {
    return workflowObserveCommand(args[1], args[2], args[3]);
  }
  if (command === "workflow" && args[0] === "dashboard" && args.length === 3) {
    return workflowDashboardAckCommand(args[1], args[2]);
  }
  if (command === "workflow" && args[0] === "supervisor-init" && args.length === 2) {
    return workflowSupervisorInitCommand(args[1]);
  }
  if (command === "workflow" && args[0] === "native-confirm" && args.length === 3) {
    return workflowNativeConfirmCommand(args[1], args[2]);
  }
  if (command === "worker" && args[0] === "open" && args.length === 3) {
    return workerOpenCommand(args[1], args[2]);
  }
  if (command === "worker" && args[0] === "verify" && args.length >= 5) {
    return workerVerifyCommand(args[1], args[2], args[3], args.slice(4));
  }
  if (command === "worker" && args[0] === "complete" && args.length === 3) {
    return workerOutcomeCommand(args[1], args[2], "completed");
  }
  if (command === "worker" && args[0] === "block" && args.length === 3) {
    return workerOutcomeCommand(args[1], args[2], "blocked");
  }
  if (command === "worker" && args[0] === "fail" && args.length === 3) {
    return workerOutcomeCommand(args[1], args[2], "failed");
  }
  if (command === "worker" && args[0] === "request-dag" && args.length === 3) {
    return workerRequestDagCommand(args[1], args[2]);
  }
  if (command === "worker" && args[0] === "complete-risk" && args.length === 4) {
    return workerRiskOutcomeCommand(args[1], args[2], args[3]);
  }
  if (command === "worker" && args[0] === "request-scope" && args.length >= 4) {
    return workerScopeRequestCommand(args[1], args[2], args.slice(3));
  }
  if (command === "workflow-create" && args.length === 3) {
    return workflowCreateCommand(args[0], args[1], args[2]);
  }
  if (command === "goal-create" && args.length === 2) return goalCreateCommand(args[0], args[1]);
  if (command === "goal-validate" && args.length === 1) return goalValidateCommand(args[0]);
  if (command === "goal-refresh" && args.length === 4) {
    return refreshGoalCommand(args[0], args[1], args[2], args[3]);
  }
  if (command === "plan-create" && args.length === 2) return planCreateCommand(args[0], args[1]);
  if (command === "plan-revise" && args.length === 2) return planReviseCommand(args[0], args[1]);
  if (command === "planner-review-context" && (
    args.length === 1 || (args.length === 2 && args[1] === "--compact")
  )) {
    return plannerReviewContextCommand(args[0], args[1] === "--compact");
  }
  if (command === "planner-review-submit" && args.length === 1) {
    return plannerReviewSubmitCommand(args[0]);
  }
  if (command === "planner-review" && args.length >= 2) {
    return plannerReviewDecisionCommand(args[0], args.slice(1));
  }
  if (command === "planner-open" && (args.length === 1 || args.length === 2)) {
    return plannerOpenCommand(args[0], args[1]);
  }
  if (command === "planner-submit" && (args.length === 2 || args.length === 3)) {
    return plannerSubmitCommand(args[0], args[1], args[2]);
  }
  if ((command === "activate" || command === "validate") && args.length === 1) {
    return validateCommand(args[0]);
  }
  if (command === "render" && args.length === 1) return renderCommand(args[0]);
  if (command === "reserve" && args.length >= 2 && args.length <= 4) {
    const compact = args.includes("--compact");
    if (args.filter((value) => value === "--compact").length > 1) fail("duplicate --compact flag");
    const positional = args.filter((value) => value !== "--compact");
    if (positional.length === 2 || positional.length === 3) {
      return reserveCommand(positional[0], positional[1], positional[2], compact);
    }
  }
  if (command === "bind" && args.length === 5) {
    return bindCommand(args[0], args[1], args[2], args[3], args[4]);
  }
  if (command === "diff-audit" && args.length === 4) {
    return diffAuditCommand(args[0], args[1], args[2], args[3]);
  }
  if (command === "source-audit" && args.length === 5) {
    return sourceAuditCommand(args[0], args[1], args[2], args[3], args[4]);
  }
  if (command === "source-audit-auto" && args.length === 4) {
    return sourceAuditCommand(args[0], args[1], args[2], args[3], "-");
  }
  if (command === "commit-readiness" && args.length === 4) {
    return commitReadinessCommand(args[0], args[1], args[2], args[3]);
  }
  if (command === "delivery-validate" && args.length === 1) {
    return deliveryValidateCommand(args[0]);
  }
  if (command === "abandon" && args.length === 5) {
    return abandonCommand(args[0], args[1], args[2], args[3], args[4]);
  }
  if (command === "finish" && (
    args.length === 5 || (args.length === 6 && args[5] === "--compact")
  )) {
    return finishCommand(args[0], args[1], args[2], args[3], args[4], args[5] === "--compact");
  }
  if (command === "checkpoint" && args.length === 5) {
    return checkpointCommand(args[0], args[1], args[2], args[3], args[4]);
  }
  if (command === "checkpoint-save" && args.length === 4) {
    return checkpointCommand(args[0], args[1], args[2], args[3], "-");
  }
  if (command === "rotate-owner" && args.length === 5) {
    return rotateOwnerCommand(args[0], args[1], args[2], args[3], args[4]);
  }
  if (command === "owner-change-pause" && args.length === 3) {
    return ownerChangePauseCommand(args[0], args[1], args[2]);
  }
  if (command === "apply-delta" && args.length === 3) {
    return applyDeltaCommand(args[0], args[1], args[2]);
  }
  if (command === "reconcile" && (
    args.length === 2 || (args.length === 3 && args[2] === "--compact")
  )) {
    return reconcileCommand(args[0], args[1], args[2] === "--compact");
  }
  if (command === "reclaim" && args.length === 5) {
    return reclaimCommand(args[0], args[1], args[2], args[3], args[4]);
  }
  if (command === "confirm-stale-executor" && args.length === 3) {
    return confirmStaleExecutorCommand(args[0], args[1], args[2]);
  }
  if (command === "status" && (
    args.length === 2 || (args.length === 3 && args[2] === "--compact")
  )) return statusCommand(args[0], args[1], args[2] === "--compact");
  if (command === "dashboard-snapshot" && args.length === 2) {
    return dashboardSnapshotCommand(args[0], args[1]);
  }
  if (command === "progress-document" && args.length === 2) {
    return progressDocumentCommand(args[0], args[1]);
  }
  if (command === "dashboard" && args.length >= 1) return dashboardCommand(args);
  if (command === "finalize" && (
    args.length === 4 || (args.length === 5 && args[4] === "--compact")
  )) {
    return finalizeCommand(args[0], args[1], args[2], args[3], args[4] === "--compact");
  }
  if (command === "native-confirm" && args.length === 3) {
    return nativeConfirmCommand(args[0], args[1], args[2]);
  }
  if (command === "owner-lease-inspect" && args.length === 2) {
    return ownerLeaseInspectCommand(args[0], args[1]);
  }
  if (command === "owner-lease-heartbeat" && args.length === 3) {
    return ownerLeaseHeartbeatCommand(args[0], args[1], args[2]);
  }
  if (command === "owner-lease-recover" && args.length === 4) {
    return ownerLeaseRecoverCommand(args[0], args[1], args[2], args[3]);
  }
  if (command === "expand-task-scope" && args.length >= 5) {
    return expandTaskScopeCommand(args[0], args[1], args[2], args[3], args.slice(4));
  }
  if (command === "expand-subgraph" && args.length === 5) {
    return expandSubgraphCommand(args[0], args[1], args[2], args[3], args[4]);
  }
  if (command === "subgraph-request" && args.length >= 5) {
    return subgraphRequestCommand(args[0], args[1], args[2], args[3], args[4], args.slice(5));
  }
  if (command === "thread-registry" && args.length >= 2) {
    return threadRegistryCommand(args[0], args.slice(1));
  }
  if (command === "supervisor-next" && (
    args.length === 1 || (args.length === 3 && args[1] === "--limit")
  )) {
    return supervisorNextCommand(args[0], args[2]);
  }
  if (command === "supervisor-init" && args.length === 3) {
    return supervisorInitCommand(args[0], args[1], args[2]);
  }
  if (command === "supervisor-record" && args.length >= 2) {
    return supervisorRecordCommand(args[0], args[1], args.slice(2));
  }
  if (command === "supervisor-ack" && args.length >= 2) {
    return supervisorAckCommand(args[0], args[1], args.slice(2));
  }
  if (command === "supervisor-resume" && args.length === 2) {
    return supervisorResumeCommand(args[0], args[1]);
  }
  if (command === "supervisor-recover-run" && args.length === 2) {
    return supervisorRecoverRunCommand(args[0], args[1]);
  }
  if (command === "supervisor-recover" && args.length === 4) {
    return supervisorRecoverCommand(args[0], args[1], args[2], args[3]);
  }
  if (command === "result-submit" && args.length === 4) {
    return resultSubmitCommand(args[0], args[1], args[2], args[3]);
  }
  if (command === "worker-open" && args.length === 2) {
    return workerOpenCommand(args[0], args[1]);
  }
  if (command === "worker-complete" && args.length === 2) {
    return workerOutcomeCommand(args[0], args[1], "completed");
  }
  if (command === "worker-complete-risk" && args.length === 3) {
    return workerRiskOutcomeCommand(args[0], args[1], args[2]);
  }
  if (command === "worker-block" && args.length === 2) {
    return workerOutcomeCommand(args[0], args[1], "blocked");
  }
  if (command === "worker-fail" && args.length === 2) {
    return workerOutcomeCommand(args[0], args[1], "failed");
  }
  if (command === "worker-request-subgraph" && args.length === 2) {
    return workerSubgraphCommand(args[0], args[1]);
  }
  if (command === "worker-request-dag" && args.length === 2) {
    return workerRequestDagCommand(args[0], args[1]);
  }
  if (command === "worker-request-scope" && args.length >= 3) {
    return workerScopeRequestCommand(args[0], args[1], args.slice(2));
  }
  if (command === "workflow-step" && args.length === 1) {
    return workflowStepCommand(args[0]);
  }
  if (command === "owner-pause-current" && args.length === 1) {
    return ownerPauseCurrentCommand(args[0]);
  }
  if (command === "runtime-execute" && args.length === 4) {
    return runtimeExecuteCommand(args[0], args[1], args[2], args[3]);
  }
  fail(
    "usage: goal-dag.mjs workflow start|step|dispatch|review|attach|thread|observe|dashboard|supervisor-init|native-confirm ... | worker open|verify|complete|block|fail|request-dag|complete-risk|request-scope ... | planner-open|planner-submit|planner-review ... | supervisor-next|supervisor-ack ... | internal runtime commands",
  );
}

try {
  main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error: ${message}\n`);
  process.exitCode = 1;
}
