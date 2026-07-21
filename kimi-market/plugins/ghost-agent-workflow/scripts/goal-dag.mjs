// Generated from tooling/goal-dag/goal-dag.ts. Do not edit directly.
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";











































































































































































































































































































































const COMPILED_PLATFORM = "kimi";
const EXPECTED_PLATFORM = (
  COMPILED_PLATFORM.startsWith("__")
    ? process.env.GOAL_DAG_EXECUTION_PLATFORM
    : COMPILED_PLATFORM
)                     ;
if (EXPECTED_PLATFORM !== "codex" && EXPECTED_PLATFORM !== "claude_code" && EXPECTED_PLATFORM !== "kimi") {
  fail("GOAL_DAG_EXECUTION_PLATFORM must equal codex, claude_code or kimi for an unbuilt runtime");
}
const DIFF_SCOPE_GATE_ID = "diff-scope-audit";
const SOURCE_COVERAGE_GATE_ID = "source-coverage-audit";
const ROLES = new Set          (["work", "review", "verify"]);
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
  unlinkSync(journalPath);
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
  const status = gitStatusMap(workspaceRoot);
  const index = gitIndexMap(workspaceRoot);
  const paths = gitOutput(
    workspaceRoot,
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    "git worktree file listing",
  )
    .split("\0")
    .filter(Boolean)
    .map(normalizePathPattern)
    .filter((path) => !isRuntimeWorkspacePath(path));
  for (const path of status.keys()) paths.push(path);
  for (const path of index.keys()) paths.push(path);
  const uniquePaths = uniqueStrings(paths).sort(compareStableStrings);
  return {
    contract: "WORKTREE_BASELINE_V1",
    workspace_root: workspaceRoot,
    head_oid: headOid,
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
  if (source.contract !== "WORKTREE_BASELINE_V1") {
    fail("worktree baseline contract must equal WORKTREE_BASELINE_V1");
  }
  const root = canonicalPath(
    expectedWorkspaceRoot,
    requireString(source.workspace_root, "worktree baseline.workspace_root"),
    "worktree baseline.workspace_root",
  );
  const headOid = requireString(source.head_oid, "worktree baseline.head_oid");
  if (!/^[0-9a-f]{40,64}$/u.test(headOid)) fail("worktree baseline.head_oid is invalid");
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
  return { contract: "WORKTREE_BASELINE_V1", workspace_root: root, head_oid: headOid, entries };
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
        ? reaperRoot
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
  if (lifecycle.controller !== "codex_native" && lifecycle.controller !== "local_fallback") {
    fail("goal lifecycle.controller is invalid");
  }
  const expectedController                 = EXPECTED_PLATFORM === "codex"
    ? "codex_native"
    : "local_fallback";
  if (lifecycle.controller !== expectedController) {
    fail(`${EXPECTED_PLATFORM} execution platform requires ${expectedController} controller`);
  }
  let nativeGoal                                           = null;
  if (EXPECTED_PLATFORM === "codex") {
    const nativeGoalSource = requireRecord(lifecycle.native_goal, "goal lifecycle.native_goal");
    nativeGoal = {
      thread_id: requireString(nativeGoalSource.thread_id, "goal lifecycle.native_goal.thread_id"),
      created_at: requirePositiveInteger(
        nativeGoalSource.created_at,
        "goal lifecycle.native_goal.created_at",
      ),
    };
  } else if (lifecycle.native_goal !== null) {
    fail(`${EXPECTED_PLATFORM} goal lifecycle.native_goal must be null`);
  }

  const execution = requireRecord(source.execution, "goal execution");
  if (execution.mode !== "subagent") {
    fail("goal execution.mode must equal subagent");
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
    objective: requireString(source.objective, "goal objective"),
    scope: requireStringArray(source.scope, "goal scope", false),
    non_goals: requireStringArray(source.non_goals, "goal non_goals"),
    constraints: requireStringArray(source.constraints, "goal constraints"),
    lifecycle: { controller: lifecycle.controller                  , native_goal: nativeGoal },
    execution: {
      mode: execution.mode                ,
      max_concurrency: requirePositiveInteger(
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

function parseRuntimeProfile(value         , label        )                       {
  if (EXPECTED_PLATFORM !== "codex") {
    if (value !== null) fail(`${label} must be null on ${EXPECTED_PLATFORM}`);
    return null;
  }
  const source = requireRecord(value, label);
  const model = requireString(source.model, `${label}.model`);
  const reasoningEffort = requireString(source.reasoning_effort, `${label}.reasoning_effort`);
  if (!REASONING_EFFORTS.has(reasoningEffort)) {
    fail(`${label}.reasoning_effort is invalid: ${reasoningEffort}`);
  }
  if (model !== "gpt-5.6-sol" || reasoningEffort !== "medium") {
    fail(`${label} must equal gpt-5.6-sol/medium on codex`);
  }
  return { model, reasoning_effort: reasoningEffort };
}

function parseOwner(value         , index        )                  {
  const source = requireRecord(value, `owners[${index}]`);
  const role = requireString(source.role, `owners[${index}].role`);
  if (!ROLES.has(role            )) fail(`owners[${index}].role is invalid: ${role}`);
  const writablePaths = requireStringArray(
    source.writable_paths,
    `owners[${index}].writable_paths`,
  ).map(normalizePathPattern);
  ensureUnique(writablePaths, `owner writable path in owners[${index}]`);
  if (role === "work" && writablePaths.length === 0) {
    fail(`owners[${index}] work owner must have non-empty writable_paths`);
  }
  if (role !== "work" && writablePaths.length > 0) {
    fail(`owners[${index}] ${role} owner must have empty writable_paths`);
  }
  if (source.reuse_policy !== "owner_affinity") {
    fail(`owners[${index}].reuse_policy must equal owner_affinity`);
  }
  return {
    id: requireIdentifier(source.id, `owners[${index}].id`),
    role: role            ,
    responsibility: requireString(source.responsibility, `owners[${index}].responsibility`),
    writable_paths: writablePaths,
    worker_context: requireString(source.worker_context, `owners[${index}].worker_context`),
    runtime_profile: parseRuntimeProfile(source.runtime_profile, `owners[${index}].runtime_profile`),
    reuse_policy: "owner_affinity",
  };
}

function parseTask(value         , index        )                 {
  const source = requireRecord(value, `tasks[${index}]`);
  const role = requireString(source.role, `tasks[${index}].role`);
  if (!ROLES.has(role            )) fail(`tasks[${index}].role is invalid: ${role}`);
  const title = requireString(source.title, `tasks[${index}].title`).trim();
  if (title.length > 80) fail(`tasks[${index}].title must be at most 80 characters`);
  if (!/[\u3400-\u9fff]/u.test(title)) {
    fail(`tasks[${index}].title must contain a Chinese character`);
  }
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
  return {
    id: requireIdentifier(source.id, `tasks[${index}].id`),
    logical_id: requireIdentifier(source.logical_id, `tasks[${index}].logical_id`),
    title,
    role: role            ,
    owner_id: requireIdentifier(source.owner_id, `tasks[${index}].owner_id`),
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
  };
}














function liveTaskIdsFromRawState(value         )              {
  const state = requireRecord(value, "state");
  const tasks = requireRecord(state.tasks, "state.tasks");
  return new Set(Object.entries(tasks)
    .filter(([, taskValue]) => requireRecord(taskValue, "state task").status !== "superseded")
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
  if (source.contract !== "DAG_PLAN_V4") fail("plan contract must equal DAG_PLAN_V4");
  if (source.planner !== "parallel-task-planner") {
    fail("planner must equal parallel-task-planner");
  }
  if (source.plan_format_version !== 4) fail("plan_format_version must equal 4");
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
    contract: "DAG_PLAN_V4",
    planner: "parallel-task-planner",
    plan_format_version: 4,
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

function tasksConflict(left                , right                )          {
  if (left.owner_id === right.owner_id) return true;
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
)                           {
  ensureUnique(plan.owners.map((owner) => owner.id), "owner id");
  ensureUnique(plan.tasks.map((task) => task.id), "task id");
  ensureUnique(plan.tasks.map((task) => task.logical_id), "logical task id");
  const ownerById = new Map(plan.owners.map((owner) => [owner.id, owner]));
  const taskIds = new Set(plan.tasks.map((task) => task.id));
  const goalGateIds = new Set(goal.verification_gates.map((gate) => gate.id));
  const sourceRelativeRaw = relative(goal.workspace.root, goal.source.path).replaceAll("\\", "/");
  const sourceRelative = sourceRelativeRaw !== "" && sourceRelativeRaw !== ".." &&
      !sourceRelativeRaw.startsWith("../") && !isAbsolute(sourceRelativeRaw)
    ? normalizePathPattern(sourceRelativeRaw)
    : null;
  for (const task of plan.tasks) {
    const owner = ownerById.get(task.owner_id);
    if (owner === undefined) fail(`task ${task.id} references unknown owner_id: ${task.owner_id}`);
    if (owner.role !== task.role) fail(`task ${task.id} role must match owner role`);
    ensureUnique(task.depends_on, `dependency in task ${task.id}`);
    ensureUnique(task.resource_locks, `resource lock in task ${task.id}`);
    ensureUnique(task.verification_ids, `verification id in task ${task.id}`);
    ensureUnique(task.satisfies_goal_gates, `goal gate in task ${task.id}`);
    if (
      task.verification_ids.includes(DIFF_SCOPE_GATE_ID) &&
      task.verification_ids.includes(SOURCE_COVERAGE_GATE_ID)
    ) fail(`task ${task.id} cannot own both fixed audit gates`);
    for (const dependencyId of task.depends_on) {
      if (!taskIds.has(dependencyId)) fail(`task ${task.id} references unknown task: ${dependencyId}`);
      if (dependencyId === task.id) fail(`task dependency cycle detected at ${task.id}`);
    }
    for (const writablePath of task.writable_paths) {
      if (!owner.writable_paths.some((scope) => patternCovers(scope, writablePath))) {
        fail(`task ${task.id} writable_paths exceed owner scope: ${writablePath}`);
      }
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
  const ancestors = buildAncestors(plan.tasks);
  const sourceAuditTaskIds = new Set(
    plan.tasks
      .filter((task) => task.satisfies_goal_gates.includes(SOURCE_COVERAGE_GATE_ID))
      .map((task) => task.id),
  );
  for (const task of plan.tasks.filter((candidate) => candidate.role === "work")) {
    if (![...(ancestors.get(task.id) ?? [])].some((taskId) => sourceAuditTaskIds.has(taskId))) {
      fail(`work task ${task.id} must depend on ${SOURCE_COVERAGE_GATE_ID}`);
    }
  }
  const safetyTasks = liveTaskIds === undefined
    ? plan.tasks
    : plan.tasks.filter((task) => liveTaskIds.has(task.id));
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

function continuationPayloadFor(goalPath        )                         {
  if (EXPECTED_PLATFORM === "codex") return {};
  if (EXPECTED_PLATFORM === "kimi") {
    return {
      continuation_prompt:
        `/skill:subagent-coordination 继续 \`${resolve(goalPath)}\`。`,
    };
  }
  return {
    continuation_prompt:
      `/ghost-agent-workflow:subagent-coordination 继续 \`${resolve(goalPath)}\`。`,
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

function capsulePathFor(planPath        , ownerId        )         {
  return join(dirname(planPath), "owners", ownerId, "capsule.json");
}

function checkpointPathFor(planPath        , ownerId        , taskId        )         {
  return join(dirname(planPath), "owners", ownerId, "checkpoints", `${taskId}.json`);
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
  if (controller !== "codex_native" && controller !== "local_fallback") {
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
  if (options.verifyExecutionArtifacts ?? true) {
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
  if (options.verifyExecutionArtifacts ?? true) {
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
  if (controller === "local_fallback") {
    if (
      nativeSync.status !== "not_required" || nativeSync.completion_token !== null ||
      nativeSync.confirmed_at !== null
    ) fail("local_fallback goal must use empty native_sync not_required");
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
  return {
    contract: "GOAL_STATE_V1",
    goal_digest: requireString(source.goal_digest, "goal state.goal_digest"),
    status: source.status,
    controller: controller                  ,
    native_goal: stateNativeGoal,
    worktree_baseline: { ref: resolve(baselineRef), digest: baselineDigest },
    source_blocks: { ref: resolve(sourceBlocksRef), digest: sourceBlocksDigest },
    active_plan_path: requireNullableString(source.active_plan_path, "goal state.active_plan_path"),
    completion_evidence: requireStringArray(
      source.completion_evidence,
      "goal state.completion_evidence",
    ),
    completed_at: completedAt,
    native_sync: nativeSync,
  };
}

function parseTaskState(value         , task                , planPath        )            {
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
  };
  const active = result.status === "reserved" || result.status === "running";
  const workerTerminal = ["completed", "blocked", "failed", "needs_repair"].includes(result.status);
  if (result.status === "pending") {
    if (
      result.reservation_token !== null || result.owner_generation !== null ||
      result.executor_id !== null || result.reserved_at !== null || result.result_path !== null ||
      result.result_ref !== null || result.result_digest !== null ||
      result.replacement_task_id !== null
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

function parseOwnerState(value         , owner                 , planPath        )             {
  const source = requireRecord(value, `state.owners.${owner.id}`);
  const statuses = new Set                    (["unbound", "idle", "reserved", "running"]);
  if (!statuses.has(source.status                      )) {
    fail(`state.owners.${owner.id}.status is invalid`);
  }
  const result             = {
    generation: requirePositiveInteger(source.generation, `state.owners.${owner.id}.generation`),
    bound_executor_id: requireNullableString(
      source.bound_executor_id,
      `state.owners.${owner.id}.bound_executor_id`,
    ),
    status: source.status                      ,
    current_task_id: requireNullableString(
      source.current_task_id,
      `state.owners.${owner.id}.current_task_id`,
    ),
    capsule_ref: canonicalPath(
      capsulePathFor(planPath, owner.id),
      requireString(source.capsule_ref, `state.owners.${owner.id}.capsule_ref`),
      `state.owners.${owner.id}.capsule_ref`,
    ),
    completed_task_ids: requireStringArray(
      source.completed_task_ids,
      `state.owners.${owner.id}.completed_task_ids`,
    ),
    result_refs: requireStringArray(source.result_refs, `state.owners.${owner.id}.result_refs`),
  };
  if (result.status === "unbound" && (result.bound_executor_id !== null || result.current_task_id !== null)) {
    fail(`state.owners.${owner.id} unbound state is inconsistent`);
  }
  if (result.status === "idle" && (result.bound_executor_id === null || result.current_task_id !== null)) {
    fail(`state.owners.${owner.id} idle state is inconsistent`);
  }
  if ((result.status === "reserved" || result.status === "running") && result.current_task_id === null) {
    fail(`state.owners.${owner.id} active state requires current_task_id`);
  }
  if (result.status === "running" && result.bound_executor_id === null) {
    fail(`state.owners.${owner.id} running state requires bound_executor_id`);
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

function parseState(value         , plan      , planPath        )           {
  const source = requireRecord(value, "state");
  if (source.contract !== "DAG_RUN_STATE_V4") {
    fail("state contract must equal DAG_RUN_STATE_V4");
  }
  const rawTasks = requireRecord(source.tasks, "state.tasks");
  const rawOwners = requireRecord(source.owners, "state.owners");
  const tasks = Object.fromEntries(
    plan.tasks.map((task) => [task.id, parseTaskState(rawTasks[task.id], task, planPath)]),
  );
  const owners = Object.fromEntries(
    plan.owners.map((owner) => [owner.id, parseOwnerState(rawOwners[owner.id], owner, planPath)]),
  );
  if (!Array.isArray(source.stale_executors)) fail("state.stale_executors must be an array");
  const staleExecutors = source.stale_executors.map(parseStaleExecutor);
  ensureUnique(
    staleExecutors.map((item) => `${item.executor_id}\u0000${item.reservation_token}`),
    "state stale executor identity",
  );
  if (Object.keys(rawTasks).length !== plan.tasks.length) fail("state task set does not match plan tasks");
  if (Object.keys(rawOwners).length !== plan.owners.length) fail("state owner set does not match plan owners");
  const result           = {
    contract: "DAG_RUN_STATE_V4",
    plan_digest: requireString(source.plan_digest, "state.plan_digest"),
    goal_digest: requireString(source.goal_digest, "state.goal_digest"),
    goal_refresh_pending: requireBoolean(
      source.goal_refresh_pending,
      "state.goal_refresh_pending",
    ),
    source_revision: requirePositiveInteger(source.source_revision, "state.source_revision"),
    revision: requirePositiveInteger(source.revision, "state.revision"),
    tasks,
    owners,
    stale_executors: staleExecutors,
  };
  const taskById = new Map(plan.tasks.map((task) => [task.id, task]));
  for (const task of plan.tasks) {
    const taskState = result.tasks[task.id];
    if (taskState.source_revision > result.source_revision || taskState.validated_source_revision > result.source_revision) {
      fail(`state.tasks.${task.id} revision exceeds state source_revision`);
    }
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
  for (const stale of result.stale_executors) {
    const task = taskById.get(stale.task_id);
    if (task === undefined || task.owner_id !== stale.owner_id) {
      fail(`state stale executor references an invalid owner/task pair: ${stale.executor_id}`);
    }
    if (stale.source_revision > result.source_revision) {
      fail(`state stale executor cannot be from a future source revision: ${stale.executor_id}`);
    }
  }
  return result;
}

function newCapsule(
  owner                 ,
  goalDigest        ,
  sourceRevision        ,
)               {
  return {
    contract: "OWNER_CAPSULE_V1",
    owner_id: owner.id,
    generation: 1,
    goal_digest: goalDigest,
    source_revision: sourceRevision,
    scope: owner.writable_paths,
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

function initializeState(planPath        , plan      )           {
  mkdirSync(join(dirname(planPath), "results"), { recursive: true });
  const owners                             = {};
  for (const owner of plan.owners) {
    const capsuleRef = capsulePathFor(planPath, owner.id);
    if (!existsSync(capsuleRef)) {
      writeJson(
        capsuleRef,
        newCapsule(owner, plan.goal_digest, plan.plan_source.revision),
      );
    }
    owners[owner.id] = {
      generation: 1,
      bound_executor_id: null,
      status: "unbound",
      current_task_id: null,
      capsule_ref: capsuleRef,
      completed_task_ids: [],
      result_refs: [],
    };
  }
  return {
    contract: "DAG_RUN_STATE_V4",
    plan_digest: digestFile(planPath),
    goal_digest: plan.goal_digest,
    goal_refresh_pending: false,
    source_revision: plan.plan_source.revision,
    revision: plan.revision,
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
    }])),
    owners,
    stale_executors: [],
  };
}

function loadPlanAndState(
  planPath        ,
  statePath        ,
  options                                 = {},
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
    },
  );
  const state = parseState(rawState, plan, planPath);
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
    const baselinePath = join(dirname(goalPath), "worktree-baseline.json");
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
      completion_evidence: [],
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
        : { liveTaskIds: liveTaskIdsFromRawState(existingStateValue) }),
    });
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
  process.stdout.write(`${JSON.stringify({ status: "valid", plan_path: planPath, state_path: statePath, coverage_path: plan.coverage_path, goal_id: plan.goal_id, revision: plan.revision, safety: plan.safety.status, owner_count: plan.owners.length, task_count: plan.tasks.length, required_plan_item_count: coverage.required_plan_items.length, state_contract: state.contract })}\n`);
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
      digestFile(parsedCandidateGoal.source.path) !== parsedCandidateGoal.source.digest
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
    const label = escapeMermaidLabel(`${task.id} · [${ROLE_LABELS[task.role]}] ${task.title} · owner:${task.owner_id}`);
    lines.push(`  ${aliases.get(task.id)}["${label}"]`);
  }
  for (const task of tasks) {
    for (const dependencyId of [...task.depends_on].sort(compareStableStrings)) {
      lines.push(`  ${aliases.get(dependencyId)} --> ${aliases.get(task.id)}`);
    }
  }
    return `${lines.join("\n")}\n`;
  });
  process.stdout.write(rendered);
}

function dependencyResolved(taskId        , state          , visited = new Set        ())          {
  if (visited.has(taskId)) fail(`replacement cycle detected at ${taskId}`);
  visited.add(taskId);
  const taskState = state.tasks[taskId];
  if (taskState.status === "completed") return true;
  if (taskState.status === "superseded" && taskState.replacement_task_id !== null) {
    return dependencyResolved(taskState.replacement_task_id, state, visited);
  }
  return false;
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
  if (state.tasks[task.id].status !== "pending") return false;
  if (!task.depends_on.every((dependencyId) => dependencyResolved(dependencyId, state))) {
    return false;
  }
  if (!task.verification_ids.includes(DIFF_SCOPE_GATE_ID)) return true;
  if (!coverageFullyPlanned) return false;
  return plan.tasks.every((other) =>
    other.id === task.id || state.tasks[other.id].status === "superseded" ||
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
  const cache = new Map                     ();
  const descendants = liveTasks.filter((task) =>
    task.id !== diffTask.id && logicalAncestorsFor(task.id, plan, state, cache).has(diffTask.id),
  );
  if (descendants.length > 0) {
    fail(`${DIFF_SCOPE_GATE_ID} task ${diffTask.id} must be a logical sink before: ${descendants.map((task) => task.id).join(", ")}`);
  }
}

const EXECUTOR_SPAWN_NAME_MAX_LENGTH = 64;

function executorSpawnName(
  planPath        ,
  plan      ,
  goal              ,
  owner                 ,
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
      owner_id: owner.id,
    }))
    .digest("hex")
    .slice(0, 12);
  const incarnation = `_g${ownerState.generation}_a${taskState.attempt}_${identityDigest}`;
  const normalized = `${goal.goal_id}_${owner.id}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "executor";
  const prefixLength = EXECUTOR_SPAWN_NAME_MAX_LENGTH - incarnation.length;
  if (prefixLength < 1) fail("executor spawn incarnation exceeds name length limit");
  return `${normalized.slice(0, prefixLength).replace(/_+$/g, "") || "e"}${incarnation}`;
}

function taskBinding(
  planPath        ,
  plan      ,
  goal              ,
  state          ,
  task                ,
)                          {
  const taskState = state.tasks[task.id];
  const owner = plan.owners.find((candidate) => candidate.id === task.owner_id)                   ;
  const ownerState = state.owners[owner.id];
  const spawnName = executorSpawnName(planPath, plan, goal, owner, ownerState, taskState);
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
  return {
    contract: "TASK_BINDING_V4",
    goal_id: goal.goal_id,
    goal_objective: goal.objective,
    plan_path: planPath,
    state_path: statePathFor(planPath),
    executor_mode: goal.execution.mode,
    executor_spawn_name: spawnName,
    worktree_baseline: goalState.worktree_baseline,
    source_blocks: goalState.source_blocks,
    coverage: {
      ref: plan.coverage_path,
      digest: coverageDigest,
      semantic_digest: semanticDigest,
    },
    task_id: task.id,
    logical_id: task.logical_id,
    title: task.title,
    display_name: `[GA][${ROLE_LABELS[task.role]}][执行] ${task.title}`,
    role: task.role,
    owner_id: owner.id,
    owner_generation: ownerState.generation,
    owner_responsibility: owner.responsibility,
    owner_context: owner.worker_context,
    owner_capsule_ref: ownerState.capsule_ref,
    checkpoint_path: checkpointPathFor(planPath, owner.id, task.id),
    reservation_token: taskState.reservation_token,
    attempt: taskState.attempt,
    source_revision: taskState.source_revision,
    task: task.task,
    writable_paths: task.writable_paths,
    resource_locks: task.resource_locks,
    done_when: task.done_when,
    verification_ids: task.verification_ids,
    satisfies_goal_gates: task.satisfies_goal_gates,
    plan_item_ids: task.plan_item_ids,
    coverage_effect: task.coverage_effect,
    goal_constraints: {
      scope: goal.scope,
      non_goals: goal.non_goals,
      constraints: goal.constraints,
    },
    side_effect_policy: goal.side_effects,
    verification_requirements: {
      done_when: task.done_when,
      verification_ids: task.verification_ids,
      goal_gates: goal.verification_gates.filter((gate) =>
        task.verification_ids.includes(gate.id),
      ),
      completion: goal.completion,
    },
    dependency_result_refs: task.depends_on.flatMap((dependencyId) =>
      resultRefsForDependency(dependencyId, state),
    ),
    result_path: taskState.result_path,
    result_contract: "WORKER_RESULT_V4",
    evidence_artifact_paths: {
      [DIFF_SCOPE_GATE_ID]: diffArtifactPath,
      [SOURCE_COVERAGE_GATE_ID]: sourceCoverageArtifactPath,
    },
    evidence_artifact_contracts: {
      [DIFF_SCOPE_GATE_ID]: task.verification_ids.includes(DIFF_SCOPE_GATE_ID)
        ? "DIFF_SCOPE_AUDIT_V1"
        : null,
      [SOURCE_COVERAGE_GATE_ID]: task.verification_ids.includes(SOURCE_COVERAGE_GATE_ID)
        ? "SOURCE_COVERAGE_AUDIT_V1"
        : null,
    },
    runtime_profile: owner.runtime_profile,
  };
}

function reserveCommand(
  planArgument        ,
  stateArgument        ,
  capacityArgument         ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const payload = withStateLock(statePath, () => {
    const { plan, goal, coverage, state } = loadPlanAndState(planPath, statePath);
    assertGoalMutable(planPath, plan, goal);
    if (plan.safety.status === "needs_user_review") fail("plan safety requires user review");
    if (state.goal_refresh_pending) fail("goal refresh requires DAG delta before reserve");
    if (state.stale_executors.length > 0) {
      fail("stale executors are stop-pending; confirm them before reserve");
    }
    const requestedCapacity = capacityArgument === undefined
      ? goal.execution.max_concurrency
      : requirePositiveInteger(Number(capacityArgument), "capacity");
    const capacity = Math.min(requestedCapacity, goal.execution.max_concurrency);
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
    for (const task of ready) {
      if (slots === 0) break;
      const ownerState = state.owners[task.owner_id];
      if (ownerState.status === "reserved" || ownerState.status === "running") continue;
      if (selected.some((active) => tasksConflict(task, active))) continue;
      const taskState = state.tasks[task.id];
      taskState.status = "reserved";
      taskState.attempt += 1;
      taskState.reservation_token = randomUUID();
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
      ownerState.status = "reserved";
      ownerState.current_task_id = task.id;
      const action = ownerState.bound_executor_id === null ? "spawn_executor" : "reuse_executor";
      const spawnName = executorSpawnName(
        planPath,
        plan,
        goal,
        plan.owners.find((owner) => owner.id === task.owner_id)                   ,
        ownerState,
        taskState,
      );
      actions.push({
        action,
        task_id: task.id,
        owner_id: task.owner_id,
        owner_generation: ownerState.generation,
        executor_id: ownerState.bound_executor_id,
        executor_spawn_name: spawnName,
        reservation_token: taskState.reservation_token,
        critical_score: scores.get(task.id),
        binding: taskBinding(planPath, plan, goal, state, task),
      });
      selected.push(task);
      slots -= 1;
    }
    if (actions.length > 0) writeJson(statePath, state);
    const repairRequired = plan.tasks
      .filter((task) => ["blocked", "failed", "needs_repair"].includes(state.tasks[task.id].status))
      .map((task) => ({ task_id: task.id, status: state.tasks[task.id].status, result_ref: state.tasks[task.id].result_ref }));
    return {
      actions,
      repair_required: repairRequired,
      summary: summarizeState(state),
      coverage: coverageSummary,
      ...(coverageFullyPlanned ? {} : { required_next_action: "needs_delta" }),
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
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
    const taskState = state.tasks[taskId];
    const ownerState = state.owners[task.owner_id];
    if (taskState.status !== "reserved") fail(`task ${taskId} is not reserved`);
    if (ownerState.status !== "reserved" || ownerState.current_task_id !== taskId) {
      fail(`owner ${task.owner_id} is not reserved for task ${taskId}`);
    }
    if (taskState.reservation_token !== reservationToken) fail("reservation token mismatch");
    if (taskState.source_revision !== state.source_revision) fail("source revision mismatch");
    if (taskState.owner_generation !== ownerState.generation) fail("owner generation mismatch");
    const actualExecutorId = requireString(executorId, "executor_id");
    if (ownerState.bound_executor_id !== null && ownerState.bound_executor_id !== actualExecutorId) {
      fail(`owner ${task.owner_id} must reuse executor ${ownerState.bound_executor_id}`);
    }
    for (const [ownerId, other] of Object.entries(state.owners)) {
      if (ownerId !== task.owner_id && other.bound_executor_id === actualExecutorId) {
        fail(`executor ${actualExecutorId} is already bound to owner ${ownerId}`);
      }
    }
    ownerState.bound_executor_id = actualExecutorId;
    ownerState.status = "running";
    taskState.status = "running";
    taskState.executor_id = actualExecutorId;
    writeJson(statePath, state);
    return {
      task_id: taskId,
      owner_id: task.owner_id,
      owner_generation: ownerState.generation,
      executor_id: actualExecutorId,
      status: "running",
    };
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
    const ownerState = state.owners[task.owner_id];
    if (ownerState.current_task_id !== taskId) fail("owner current task mismatch");
    taskState.status = "pending";
    taskState.reservation_token = null;
    taskState.owner_generation = null;
    taskState.executor_id = null;
    taskState.reserved_at = null;
    taskState.result_path = null;
    taskState.result_ref = null;
    taskState.result_digest = null;
    ownerState.status = ownerState.bound_executor_id === null ? "unbound" : "idle";
    ownerState.current_task_id = null;
    const owner = plan.owners.find((candidate) => candidate.id === task.owner_id)                   ;
    const capsule = interruptCapsule(
      owner,
      ownerState,
      state.goal_digest,
      state.source_revision,
      `task ${taskId} abandoned: ${abandonReason}`,
    );
    writeTransaction(statePath, [
      [ownerState.capsule_ref, capsule],
      [statePath, state],
    ]);
    return { task_id: taskId, status: "pending", reason: abandonReason };
  });
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
    const taskState = state.tasks[taskId];
    if (taskState.status !== "running") fail(`task ${taskId} is not running`);
    if (taskState.reservation_token !== reservationToken) fail("reservation token mismatch");
    if (taskState.source_revision !== state.source_revision) fail("source revision mismatch");
    const ownerState = state.owners[task.owner_id];
    if (ownerState.status !== "running" || ownerState.current_task_id !== taskId) {
      fail("owner is not running this checkpoint task");
    }
    const checkpointPath = canonicalPath(
      checkpointPathFor(planPath, task.owner_id, taskId),
      checkpointArgument,
      "checkpoint path",
    );
    const checkpoint = parseCheckpoint(readJson(checkpointPath), task, taskState);
    const owner = plan.owners.find((candidate) => candidate.id === task.owner_id)                   ;
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
    writeJson(ownerState.capsule_ref, capsule);
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

function parseWorkerResult(
  value         ,
  task                ,
  owner                 ,
  taskState           ,
)                 {
  const source = requireRecord(value, "worker result");
  if (source.contract !== "WORKER_RESULT_V4") {
    fail("worker result contract must equal WORKER_RESULT_V4");
  }
  if (!TERMINAL_STATUSES.has(source.status                        )) {
    fail(`worker result.status is invalid: ${String(source.status)}`);
  }
  const status = source.status                        ;
  const result                 = {
    contract: "WORKER_RESULT_V4",
    status,
    task_id: requireString(source.task_id, "worker result.task_id"),
    logical_id: requireString(source.logical_id, "worker result.logical_id"),
    role: requireString(source.role, "worker result.role")            ,
    owner_id: requireString(source.owner_id, "worker result.owner_id"),
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
  if (result.owner_generation !== taskState.owner_generation) fail("worker result owner_generation mismatch");
  if (result.executor_id !== taskState.executor_id) fail("worker result executor_id mismatch");
  if (result.reservation_token !== taskState.reservation_token) fail("worker result reservation_token mismatch");
  if (result.attempt !== taskState.attempt) fail("worker result attempt mismatch");
  if (result.source_revision !== taskState.source_revision) fail("worker result source_revision mismatch");
  ensureUnique(result.changed_files, "worker result changed file");
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
    for (const gateId of [DIFF_SCOPE_GATE_ID, SOURCE_COVERAGE_GATE_ID]) {
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
    if (!task.writable_paths.some((pattern) => pathMatchesPattern(changedFile, pattern))) {
      fail(`worker result changed_files exceed task scope: ${changedFile}`);
    }
    if (!owner.writable_paths.some((pattern) => pathMatchesPattern(changedFile, pattern))) {
      fail(`worker result changed_files exceed owner scope: ${changedFile}`);
    }
  }
  return result;
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
  if (current.head_oid !== baseline.head_oid) {
    fail(`${DIFF_SCOPE_GATE_ID} forbids Git HEAD changes during the goal`);
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
      !existsSync(workState.result_ref) || digestFile(workState.result_ref) !== workState.result_digest
    ) {
      fail(`${DIFF_SCOPE_GATE_ID} requires every live work task to have current accepted evidence: ${workTask.id}`);
    }
    const owner = plan.owners.find((candidate) => candidate.id === workTask.owner_id)                   ;
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
        const taskPatterns = match.task.writable_paths.filter((pattern) =>
          pathMatchesPattern(changedFile, pattern),
        );
        const ownerPatterns = match.owner.writable_paths.filter((pattern) =>
          pathMatchesPattern(changedFile, pattern),
        );
        if (taskPatterns.length === 0 || ownerPatterns.length === 0) {
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
    owner_id: auditTask.owner_id,
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
    "contract", "audit_task_id", "owner_id", "attempt", "reservation_token",
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
    owner_id: requireIdentifier(source.owner_id, "diff scope audit owner_id"),
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
    const ownerState = state.owners[task.owner_id];
    if (ownerState.status !== "running" || ownerState.current_task_id !== taskId) {
      fail(`owner ${task.owner_id} is not running ${taskId}`);
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
    owner_id: task.owner_id,
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
    owner_id: requireIdentifier(source.owner_id, "source coverage owner_id"),
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
    const taskState = state.tasks[taskId];
    if (taskState.status !== "running") fail(`task ${taskId} is not running`);
    if (taskState.reservation_token !== reservationToken) fail("reservation token mismatch");
    const artifactPath = sourceCoverageArtifactPathFor(
      planPath,
      task.id,
      taskState.attempt,
      reservationToken,
    );
    const classificationPath = canonicalPath(
      artifactPath,
      classificationsArgument,
      "source coverage classification path",
    );
    const classifications = parseSourceCoverageClassifications(readJson(classificationPath));
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
  capsule.result_refs = uniqueStrings([...(capsule.result_refs ?? []), resultRef]);
  if (result.status === "completed") {
    capsule.completed_tasks = uniqueStrings([...(capsule.completed_tasks ?? []), result.task_id]);
  }
  const combinedVerification = [
    ...(capsule.verification ?? []),
    ...result.evidence.map((item) => ({ ...item, task_id: result.task_id, result_ref: resultRef })),
  ];
  capsule.verification = combinedVerification.filter((item, index) =>
    combinedVerification.findIndex((candidate) =>
      candidate.task_id === item.task_id &&
      candidate.verification_id === item.verification_id &&
      candidate.result_ref === item.result_ref,
    ) === index,
  );
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
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const payload = withStateLock(statePath, () => {
    const { plan, goal, coverage, state } = loadPlanAndState(
      planPath,
      statePath,
      { allowSourceDrift: true },
    );
    assertGoalMutable(planPath, plan, goal);
    const task = plan.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) fail(`unknown task: ${taskId}`);
    const owner = plan.owners.find((candidate) => candidate.id === task.owner_id)                   ;
    const taskState = state.tasks[taskId];
    const ownerState = state.owners[owner.id];
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
      return {
        task_id: taskId,
        owner_id: owner.id,
        owner_generation: ownerState.generation,
        executor_id: taskState.executor_id,
        status: taskState.status,
        result_ref: acceptedResultPath,
        owner_reusable: true,
        idempotent: true,
      };
    }
    if (taskState.status !== "running") fail(`task ${taskId} is not running`);
    if (taskState.source_revision !== state.source_revision) fail("source revision mismatch");
    if (ownerState.current_task_id !== taskId || ownerState.status !== "running") {
      fail("owner is not running this task");
    }
    const result = parseWorkerResult(readJson(resultPath), task, owner, taskState);
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
    writeImmutableJson(acceptedResultPath, result);
    taskState.status = result.status;
    taskState.result_ref = acceptedResultPath;
    taskState.result_digest = digestFile(acceptedResultPath);
    ownerState.status = "idle";
    ownerState.current_task_id = null;
    ownerState.result_refs = uniqueStrings([...ownerState.result_refs, acceptedResultPath]);
    if (result.status === "completed") {
      ownerState.completed_task_ids = uniqueStrings([...ownerState.completed_task_ids, taskId]);
    }
    const capsule = updateCapsule(
      owner,
      ownerState,
      state.goal_digest,
      state.source_revision,
      result,
      acceptedResultPath,
    );
    writeTransaction(statePath, [
      [ownerState.capsule_ref, capsule],
      [statePath, state],
    ]);
    return {
      task_id: taskId,
      owner_id: owner.id,
      owner_generation: ownerState.generation,
      executor_id: ownerState.bound_executor_id,
      status: result.status,
      result_ref: acceptedResultPath,
      owner_reusable: true,
      idempotent: false,
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
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
      [ownerState.capsule_ref, capsule],
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
    coverage_update: { required_plan_items: requiredPlanItems },
    safety: {
      status: safety.status                ,
      reasons: requireStringArray(safety.reasons, "delta.safety.reasons"),
    },
  };
}

function applyDeltaCommand(
  planArgument        ,
  stateArgument        ,
  deltaArgument        ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const deltaPath = resolve(deltaArgument);
  const payload = withStateLock(statePath, () => {
    const { plan, goal, coverage, state } = loadPlanAndState(planPath, statePath);
    assertGoalMutable(planPath, plan, goal);
    const delta = parseDelta(readJson(deltaPath));
    if (delta.base_plan_digest !== state.plan_digest) fail("delta base_plan_digest mismatch");
    if (delta.revision !== plan.revision + 1) fail("delta revision must increment plan revision by one");
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
    const newTaskIds = new Set(delta.add_tasks.map((task) => task.id));
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
          dispositionTask.satisfies_goal_gates.includes(DIFF_SCOPE_GATE_ID)
        ) &&
        disposition.action !== "invalidate"
      ) fail("fixed audit evidence must be invalidated on source refresh");
      if (state.goal_refresh_pending && disposition.action === "invalidate") {
        for (const fixedGate of [SOURCE_COVERAGE_GATE_ID, DIFF_SCOPE_GATE_ID]) {
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
    const nextPlan       = {
      ...plan,
      revision: delta.revision,
      owners: [...plan.owners, ...delta.add_owners],
      tasks: [...plan.tasks, ...delta.add_tasks],
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
    const ancestors = validateGraph(nextPlan, goal, false, nextLiveTaskIds);
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
      };
    }
    for (const repair of delta.repairs) {
      state.tasks[repair.task_id].status = "superseded";
      state.tasks[repair.task_id].replacement_task_id = repair.replacement_task_id;
    }
    for (const disposition of delta.source_dispositions) {
      const taskState = state.tasks[disposition.task_id];
      if (disposition.action === "invalidate") {
        const oldResultRef = taskState.result_ref;
        taskState.status = "superseded";
        taskState.replacement_task_id = disposition.replacement_task_id;
        const task = nextPlan.tasks.find((candidate) => candidate.id === disposition.task_id)                  ;
        const owner = nextPlan.owners.find((candidate) => candidate.id === task.owner_id)                   ;
        const ownerState = state.owners[task.owner_id];
        ownerState.completed_task_ids = ownerState.completed_task_ids
          .filter((completedTaskId) => completedTaskId !== disposition.task_id);
        if (oldResultRef !== null) {
          ownerState.result_refs = ownerState.result_refs.filter((ref) => ref !== oldResultRef);
        }
        const capsule = capsuleWrites.get(ownerState.capsule_ref) ?? loadOwnerCapsule(
          owner,
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
        capsuleWrites.set(ownerState.capsule_ref, capsule);
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
    return {
      status: "applied",
      revision: nextPlan.revision,
      added_owners: delta.add_owners.map((owner) => owner.id),
      added_tasks: delta.add_tasks.map((task) => task.id),
      repaired_tasks: delta.repairs,
      source_dispositions: delta.source_dispositions,
      unrelated_running_tasks: nextPlan.tasks
        .filter((task) => state.tasks[task.id].status === "running")
        .map((task) => task.id),
    };
  });
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
    const owner = plan.owners.find((candidate) => candidate.id === task.owner_id)                   ;
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
      if (result.status !== "completed") problems.push(`${task.id}: result status is not completed`);
      if (result.diff_self_check !== "pass") problems.push(`${task.id}: diff self-check failed`);
      for (const finding of result.blocking_findings) {
        problems.push(`${task.id}: blocking finding: ${finding}`);
      }
      resultRefs.push(taskState.result_ref);
      for (const evidence of result.evidence) {
        if (
          evidence.outcome === "passed" &&
          task.satisfies_goal_gates.includes(evidence.verification_id)
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
      const ownerState = state.owners[task.owner_id];
      const binding = taskBinding(planPath, plan, goal, state, task);
      const action = taskState.status === "running"
        ? "wait_or_redeliver"
        : ownerState.bound_executor_id === null
          ? "spawn_executor"
          : "reuse_executor";
      return {
        action,
        phase: taskState.status === "running" ? "running_bound" : "reserved_unbound",
        task_id: task.id,
        owner_id: task.owner_id,
        status: taskState.status,
        reservation_token: taskState.reservation_token,
        result_path: taskState.result_path,
        executor_id: taskState.status === "running"
          ? taskState.executor_id
          : ownerState.bound_executor_id,
        attempt: taskState.attempt,
        source_revision: taskState.source_revision,
        reserved_at: taskState.reserved_at,
        executor_spawn_name: binding.executor_spawn_name,
        binding,
      };
    });
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
  const coverageSummary = summarizeCoverage(plan, coverage, state);
  const coverageFullyPlanned =
    (coverageSummary.uncovered_plan_item_effects            ).length === 0;
  if (!coverageFullyPlanned) return "needs_delta";
  const statuses = Object.values(state.tasks).map((task) => task.status);
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
  const unresolved = plan.tasks.filter((task) => !dependencyResolved(task.id, state));
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

function reconcileCommand(planArgument        , stateArgument        )       {
  const planPath = resolve(planArgument);
  const statePath = canonicalPath(statePathFor(planPath), stateArgument, "state path");
  const payload = withStateLock(statePath, () => {
    const { plan, goal, coverage, state } = loadPlanAndState(
      planPath,
      statePath,
      { allowSourceDrift: true },
    );
    const goalState = goalStateForPlan(planPath, plan, goal).state;
    return {
      goal_id: goal.goal_id,
      goal_status: goalState.status,
      ...sourceDriftPayload(goal, goalState, plan, state),
      next_action: coordinatedNextAction(planPath, plan, goal, coverage, state, goalState),
      active_reservations: activeReservationRecords(planPath, plan, goal, state),
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
    const ownerState = state.owners[task.owner_id];
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
    ownerState.bound_executor_id = null;
    ownerState.status = "unbound";
    ownerState.current_task_id = null;
    if (reclaimedExecutorId !== null) {
      state.stale_executors.push({
        executor_id: reclaimedExecutorId,
        owner_id: task.owner_id,
        task_id: task.id,
        attempt: reclaimedAttempt,
        reservation_token: reservationToken,
        source_revision: reclaimedSourceRevision,
        status: "stop_pending",
        reclaimed_at: new Date().toISOString(),
      });
    }
    const owner = plan.owners.find((candidate) => candidate.id === task.owner_id)                   ;
    const capsule = interruptCapsule(
      owner,
      ownerState,
      state.goal_digest,
      state.source_revision,
      `task ${taskId} orphan reservation reclaimed: ${reclaimReason}`,
    );
    writeTransaction(statePath, [
      [ownerState.capsule_ref, capsule],
      [statePath, state],
    ]);
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
    return {
      executor_id: executorId,
      status: "confirmed",
      reclaimed_reservations: removed,
      idempotent: false,
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function statusCommand(planArgument        , stateArgument        )       {
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
    }]));
    const inspection = goalState.status === "completed"
      ? { problems: []             }
      : inspectCompletion(planPath, plan, goal, coverage, state);
    return {
      goal_id: goal.goal_id,
      objective: goal.objective,
      goal_status: goalState.status,
      native_sync: goalState.native_sync,
      ...continuationPayloadFor(plan.goal_contract_path),
      revision: plan.revision,
      source_revision: state.source_revision,
      ...sourceDriftPayload(goal, goalState, plan, state),
      next_action: coordinatedNextAction(planPath, plan, goal, coverage, state, goalState),
      summary: summarizeState(state),
      coverage: summarizeCoverage(plan, coverage, state),
      active_reservations: activeReservationRecords(planPath, plan, goal, state),
      stale_executors: state.stale_executors,
      completion_problems: inspection.problems,
      owners,
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function finalizeCommand(
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
      return {
        status: "completed",
        goal_id: goal.goal_id,
        evidence_refs: goalState.completion_evidence,
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
    const unresolved = plan.tasks.filter((task) => !dependencyResolved(task.id, state));
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
    goalState.status = "completed";
    goalState.completion_evidence = uniqueStrings(inspection.result_refs);
    goalState.completed_at = new Date().toISOString();
    if (goalState.controller === "codex_native") {
      goalState.native_sync.status = "pending";
      goalState.native_sync.completion_token = randomUUID();
    }
    writeJson(goalStatePath, goalState);
    return {
      status: "completed",
      goal_id: goal.goal_id,
      evidence_refs: goalState.completion_evidence,
      native_sync: goalState.native_sync.status,
      ...(goalState.native_sync.status === "pending" ? { native_action: nativeAction() } : {}),
      idempotent: false,
    };
  }));
  process.stdout.write(`${JSON.stringify(payload)}\n`);
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

function main(argv          )       {
  const [command, ...args] = argv;
  if (command === "goal-validate" && args.length === 1) return goalValidateCommand(args[0]);
  if (command === "goal-refresh" && args.length === 4) {
    return refreshGoalCommand(args[0], args[1], args[2], args[3]);
  }
  if (command === "validate" && args.length === 1) return validateCommand(args[0]);
  if (command === "render" && args.length === 1) return renderCommand(args[0]);
  if (command === "reserve" && (args.length === 2 || args.length === 3)) {
    return reserveCommand(args[0], args[1], args[2]);
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
  if (command === "abandon" && args.length === 5) {
    return abandonCommand(args[0], args[1], args[2], args[3], args[4]);
  }
  if (command === "finish" && args.length === 5) {
    return finishCommand(args[0], args[1], args[2], args[3], args[4]);
  }
  if (command === "checkpoint" && args.length === 5) {
    return checkpointCommand(args[0], args[1], args[2], args[3], args[4]);
  }
  if (command === "rotate-owner" && args.length === 5) {
    return rotateOwnerCommand(args[0], args[1], args[2], args[3], args[4]);
  }
  if (command === "apply-delta" && args.length === 3) {
    return applyDeltaCommand(args[0], args[1], args[2]);
  }
  if (command === "reconcile" && args.length === 2) {
    return reconcileCommand(args[0], args[1]);
  }
  if (command === "reclaim" && args.length === 5) {
    return reclaimCommand(args[0], args[1], args[2], args[3], args[4]);
  }
  if (command === "confirm-stale-executor" && args.length === 3) {
    return confirmStaleExecutorCommand(args[0], args[1], args[2]);
  }
  if (command === "status" && args.length === 2) return statusCommand(args[0], args[1]);
  if (command === "finalize" && args.length === 4) {
    return finalizeCommand(args[0], args[1], args[2], args[3]);
  }
  if (command === "native-confirm" && args.length === 3) {
    return nativeConfirmCommand(args[0], args[1], args[2]);
  }
  fail(
    "usage: goal-dag.mjs goal-validate <goal.json> | goal-refresh <goal.json> <goal-state.json> <plan.json> <state.json> | validate <plan.json> | render <plan.json> | reserve <plan.json> <state.json> [capacity] | bind <plan.json> <state.json> <task_id> <reservation_token> <executor_id> | diff-audit <plan.json> <state.json> <task_id> <reservation_token> | source-audit <plan.json> <state.json> <task_id> <reservation_token> <classification_path> | abandon <plan.json> <state.json> <task_id> <reservation_token> <reason> | checkpoint <plan.json> <state.json> <task_id> <reservation_token> <checkpoint_path> | finish <plan.json> <state.json> <task_id> <reservation_token> <result_path> | rotate-owner <plan.json> <state.json> <owner_id> <expected_generation> <reason> | apply-delta <plan.json> <state.json> <delta.json> | reconcile <plan.json> <state.json> | reclaim <plan.json> <state.json> <task_id> <reservation_token> <reason> | confirm-stale-executor <plan.json> <state.json> <executor_id> | status <plan.json> <state.json> | finalize <goal.json> <goal-state.json> <plan.json> <state.json> | native-confirm <goal.json> <goal-state.json> <completion_token>",
  );
}

try {
  main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error: ${message}\n`);
  process.exitCode = 1;
}
