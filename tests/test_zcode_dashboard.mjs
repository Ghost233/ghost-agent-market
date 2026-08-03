import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  dashboardDescriptorPath,
  dashboardRuntimeDirectory,
  descriptorMatchesDashboardCommand,
  expectedDashboardArgv,
  inspectProcessIdentity,
  inspectProcessObservation,
  parseDarwinProcessIdentity,
  parseDashboardDescriptorV2,
  parseLinuxProcessIdentity,
  parseWindowsProcessIdentity,
  processIdentityMatches,
  writeDashboardDescriptorAtomic,
} from "../tooling/zcode-workflow/dashboard-lifecycle.mjs";
import { startDashboard } from "../tooling/zcode-workflow/start-dashboard.mjs";
import { safeRegularFileBytes, statusDashboard } from "../tooling/zcode-workflow/dashboard-status.mjs";
import { stopDashboard } from "../tooling/zcode-workflow/stop-dashboard.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const DASHBOARD_STATUS = join(ROOT, "tooling/zcode-workflow/dashboard-status.mjs");
const START_DASHBOARD = join(ROOT, "tooling/zcode-workflow/start-dashboard.mjs");
const STOP_DASHBOARD = join(ROOT, "tooling/zcode-workflow/stop-dashboard.mjs");
const DRIVER = join(ROOT, "zcode-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs");
const FIXTURES = join(ROOT, "tests/fixtures/goal-dag");
const TEST_RUNTIME_PARENT = await mkdtemp(join(await realpath(tmpdir()), "zcode-dashboard-suite-"));
const DEFAULT_RUNTIME_DIRECTORY = join(TEST_RUNTIME_PARENT, "runtime");
process.env.ZCODE_DASHBOARD_RUNTIME_DIRECTORY_TEST = DEFAULT_RUNTIME_DIRECTORY;
const LIVE_CHILDREN = new Set();
const LIVE_PIDS = new Set();
const LIVE_SERVERS = new Set();
const TEMPORARY_PATHS = new Set();

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalPath(path) {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    try {
      return join(realpathSync.native(dirname(absolute)), basename(absolute));
    } catch {
      return absolute;
    }
  }
}

function sourceId(workspace, goalId) {
  return createHash("sha256").update(`${canonicalPath(workspace)}\n${goalId}`).digest("hex").slice(0, 20);
}

function runtimeId(workspace, goalId, host, port) {
  return createHash("sha256")
    .update([canonicalPath(workspace), goalId, host, port].join("\n"))
    .digest("hex")
    .slice(0, 20);
}

function displayUrl(host, port) {
  const renderedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${renderedHost}:${port}/`;
}

async function waitFor(predicate, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  throw new Error(`${label} did not become ready${lastError ? `: ${lastError.message}` : ""}`);
}

function runNode(script, args, environment = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...environment },
    encoding: "utf8",
    timeout: 20_000,
  });
}

async function runNodeAsync(script, args, environment = {}) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const status = await new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectExit(new Error(`${basename(script)} timed out`));
    }, 20_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectExit(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });
  return {
    status,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  };
}

async function snapshotPath(root) {
  const result = {};
  async function visit(path, relativePath) {
    let metadata;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return;
      throw error;
    }
    const common = {
      mode: metadata.mode,
      mtimeMs: metadata.mtimeMs,
      size: metadata.size,
    };
    if (metadata.isSymbolicLink()) {
      result[relativePath || "."] = { ...common, type: "symlink", target: await readFile(path, "utf8").catch(() => null) };
      return;
    }
    if (metadata.isFile()) {
      result[relativePath || "."] = {
        ...common,
        type: "file",
        bytes: (await readFile(path)).toString("base64"),
      };
      return;
    }
    if (metadata.isDirectory()) {
      result[relativePath || "."] = { ...common, type: "directory" };
      for (const name of (await readdir(path)).sort()) {
        await visit(join(path, name), relativePath ? `${relativePath}/${name}` : name);
      }
      return;
    }
    result[relativePath || "."] = { ...common, type: "other" };
  }
  await visit(root, "");
  return result;
}

async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function createDashboardWorkspace(goalId = `goal-${randomUUID()}`) {
  const workspace = await mkdtemp(join(await realpath(tmpdir()), "zcode-dashboard-"));
  TEMPORARY_PATHS.add(workspace);
  const goalDirectory = join(workspace, ".ghost-agent-workflow", goalId);
  await mkdir(goalDirectory, { recursive: true });
  await writeFile(join(workspace, "README.md"), "fixture repository\n", "utf8");
  assert.equal(spawnSync("git", ["init", "-q", workspace]).status, 0);
  assert.equal(spawnSync("git", ["-C", workspace, "add", "README.md"]).status, 0);
  assert.equal(spawnSync("git", [
    "-C", workspace,
    "-c", "user.name=Dashboard Fixture",
    "-c", "user.email=dashboard@example.invalid",
    "commit", "-q", "-m", "fixture baseline",
  ]).status, 0);
  const documentPath = join(workspace, "development.md");
  await writeFile(documentPath, "# Dashboard fixture\n\nTrack one local Goal.\n", "utf8");

  const goal = JSON.parse(await readFile(join(FIXTURES, "goal.json"), "utf8"));
  goal.execution_platform = "zcode";
  goal.goal_id = goalId;
  const canonicalWorkspace = await realpath(workspace);
  goal.workspace = { root: workspace };
  goal.lifecycle.controller = "standalone_thread";
  goal.lifecycle.native_goal = null;
  goal.source = {
    path: documentPath,
    digest: createHash("sha256").update(await readFile(documentPath)).digest("hex"),
    revision: 1,
  };
  const goalPath = join(goalDirectory, "goal.json");
  await writeJson(goalPath, goal);

  const plan = JSON.parse(await readFile(join(FIXTURES, "plan.json"), "utf8"));
  plan.execution_platform = "zcode";
  plan.goal_id = goalId;
  plan.goal_contract_path = goalPath;
  plan.goal_digest = createHash("sha256").update(await readFile(goalPath)).digest("hex");
  plan.plan_source = structuredClone(goal.source);
  plan.coverage_path = join(goalDirectory, "coverage.json");
  const planPath = join(goalDirectory, "plan.json");
  await writeJson(planPath, plan);

  const coverage = JSON.parse(await readFile(join(FIXTURES, "coverage.json"), "utf8"));
  coverage.source_path = documentPath;
  coverage.source_digest = goal.source.digest;
  coverage.source_revision = goal.source.revision;
  coverage.plan_path = planPath;
  coverage.plan_digest = createHash("sha256").update(await readFile(planPath)).digest("hex");
  coverage.plan_revision = plan.revision;
  const nonemptyLines = (await readFile(documentPath, "utf8"))
    .split("\n")
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => line.trim().length > 0);
  for (const [index, item] of coverage.required_plan_items.entries()) {
    const sourceLine = nonemptyLines[Math.min(index, nonemptyLines.length - 1)];
    item.source_refs = [
      `L${sourceLine.index}-${createHash("sha256").update(sourceLine.line).digest("hex").slice(0, 12)}`,
    ];
  }
  await writeJson(plan.coverage_path, coverage);

  const ownerRoot = join(workspace, ".ghost-agent-workflow", "owners");
  const persistentOwners = [];
  for (const owner of plan.owners) {
    if (!Array.isArray(owner.writable_paths) || owner.writable_paths.length === 0) continue;
    persistentOwners.push({
      id: owner.id,
      generation: 1,
      status: "active",
      responsibility: owner.responsibility,
      scope_patterns: owner.writable_paths,
      scope_excludes: owner.excluded_paths,
      worker_context: owner.worker_context,
      lineage: {
        parent_owner_ids: [],
        created_by_request_digest: "bootstrap",
      },
    });
    await writeJson(join(ownerRoot, owner.id, "capsule.json"), {
      contract: "OWNER_CAPSULE_V2",
      owner_id: owner.id,
      generation: 1,
      registry_revision: 1,
      scope_patterns: owner.writable_paths,
      scope_excludes: owner.excluded_paths,
      responsibility: owner.responsibility,
      worker_context: owner.worker_context,
      inherited_from: [],
      decisions: [],
      invariants: [],
      risks: [],
      important_symbols: [],
      next_steps: [],
      history: [],
      updated_at: "2026-08-02T00:00:00.000Z",
    });
  }
  await writeJson(join(ownerRoot, "registry.json"), {
    contract: "OWNER_REGISTRY_V2",
    workspace_root: workspace,
    revision: 1,
    matcher: "owner-path-expression-v2",
    managed_roots: ["src/**", "tests/**"],
    owners: persistentOwners,
    retired_owner_ids: [],
    updated_at: "2026-08-02T00:00:00.000Z",
  });

  const goalValidated = runNode(DRIVER, ["goal-validate", goalPath]);
  assert.equal(goalValidated.status, 0, goalValidated.stderr);
  const canonicalGoalState = JSON.parse(goalValidated.stdout);
  const reviewContext = runNode(DRIVER, ["planner-review-context", planPath]);
  assert.equal(reviewContext.status, 0, reviewContext.stderr);
  const reviewSubmitted = spawnSync(process.execPath, [DRIVER, "planner-review-submit", planPath], {
    cwd: ROOT,
    env: process.env,
    input: JSON.stringify({
      parallelism: "pass",
      too_complex: false,
      too_simple: false,
      changes: [],
    }),
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(reviewSubmitted.status, 0, reviewSubmitted.stderr);
  const initialized = runNode(DRIVER, ["validate", planPath]);
  assert.equal(initialized.status, 0, initialized.stderr);
  const statePath = JSON.parse(initialized.stdout).state_path;
  const goalStatePath = canonicalGoalState.goal_state_path;
  return {
    workspace: canonicalWorkspace,
    goalId,
    goalDirectory: join(canonicalWorkspace, ".ghost-agent-workflow", goalId),
    goalPath: canonicalPath(goalPath),
    goalStatePath: canonicalPath(goalStatePath),
    planPath: canonicalPath(planPath),
    statePath: canonicalPath(statePath),
    lifecyclePath: canonicalPath(join(goalDirectory, "dashboard.json")),
  };
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  const port = address.port;
  await closeServer(server);
  return port;
}

async function startSleepProcess(marker = "dashboard-fixture") {
  const directory = await mkdtemp(join(tmpdir(), "zcode-dashboard-process-"));
  TEMPORARY_PATHS.add(directory);
  const script = join(directory, "sleep.mjs");
  await writeFile(script, "setInterval(() => {}, 1000);\n", "utf8");
  const child = spawn(process.execPath, [script, marker], {
    cwd: directory,
    stdio: "ignore",
  });
  LIVE_CHILDREN.add(child);
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once("spawn", resolveSpawn);
    child.once("error", rejectSpawn);
  });
  const identity = await waitFor(
    () => inspectProcessIdentity(child.pid),
    `process identity for ${child.pid}`,
  );
  return { child, script, identity };
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    LIVE_CHILDREN.delete(child);
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  LIVE_CHILDREN.delete(child);
}

async function stopPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try { process.kill(pid, "SIGTERM"); } catch {}
  await waitFor(() => inspectProcessIdentity(pid) === null, `process ${pid} exit`, 2_000).catch(() => null);
  if (inspectProcessIdentity(pid) !== null) {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
  LIVE_PIDS.delete(pid);
}

function synchronizeDescriptorCommand(descriptor, driverPath = DRIVER) {
  descriptor.expected_argv = [
    canonicalPath(process.execPath),
    canonicalPath(driverPath),
    ...expectedDashboardArgv({
      planPath: canonicalPath(descriptor.plan_path),
      statePath: canonicalPath(descriptor.state_path),
      lifecyclePath: canonicalPath(descriptor.lifecycle_path),
    }, {
      host: descriptor.host,
      port: descriptor.port,
      allowRemote: descriptor.expected_argv?.includes("--allow-remote") ?? false,
    }, descriptor.runtime_id),
  ];
  descriptor.process_identity.argv = [...descriptor.expected_argv];
  descriptor.process_identity.command = descriptor.expected_argv.join("\0");
  descriptor.process_identity.command_digest = sha256(descriptor.expected_argv.join("\0"));
  return descriptor;
}

function descriptorFor({ data, host, port, pid, identity, driverPath = DRIVER }) {
  const canonicalWorkspace = canonicalPath(data.workspace);
  const canonicalGoalPath = canonicalPath(data.goalPath);
  const canonicalDriverPath = canonicalPath(driverPath);
  const id = runtimeId(canonicalWorkspace, data.goalId, host, port);
  const expectedArgv = [
    canonicalPath(process.execPath),
    canonicalDriverPath,
    ...expectedDashboardArgv({
      planPath: canonicalPath(data.planPath),
      statePath: canonicalPath(data.statePath),
      lifecyclePath: canonicalPath(data.lifecyclePath),
    }, { host, port, allowRemote: false }, id),
  ];
  return {
    contract: "ZCODE_DASHBOARD_DESCRIPTOR_V2",
    descriptor_token: randomUUID(),
    runtime_id: id,
    source_id: sourceId(canonicalWorkspace, data.goalId),
    expected_argv: expectedArgv,
    workspace_root: canonicalWorkspace,
    workflow_root: join(canonicalWorkspace, ".ghost-agent-workflow"),
    goal_id: data.goalId,
    goal_path: canonicalGoalPath,
    plan_path: canonicalPath(data.planPath),
    state_path: canonicalPath(data.statePath),
    lifecycle_path: canonicalPath(data.lifecyclePath),
    pid,
    process_identity: identity,
    url: displayUrl(host, port),
    host,
    port,
    log_path: join(DEFAULT_RUNTIME_DIRECTORY, `${id}.log`),
    created_at: "2026-08-02T00:00:00.000Z",
  };
}

async function writeDescriptorFixture(overrides = {}, options = {}) {
  const data = options.data ?? await createDashboardWorkspace();
  const processFixture = options.processFixture ?? await startSleepProcess();
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? await reservePort();
  const descriptorPath = dashboardDescriptorPath(data.workspace, data.goalId, host, port);
  await mkdir(dirname(descriptorPath), { recursive: true, mode: 0o700 });
  const descriptor = descriptorFor({
    data,
    host,
    port,
    pid: processFixture.child.pid,
    identity: processFixture.identity,
  });
  const expectedIdentity = {
    ...processFixture.identity,
    argv: [...descriptor.expected_argv],
    command: descriptor.expected_argv.join(" "),
    command_digest: sha256(descriptor.expected_argv.join("\0")),
  };
  const merged = {
    ...descriptor,
    ...overrides,
    process_identity: {
      ...expectedIdentity,
      ...(overrides.process_identity ?? {}),
    },
  };
  await writeJson(descriptorPath, merged);
  await writeFile(merged.log_path, "dashboard fixture log\n", "utf8");
  return { ...data, ...processFixture, host, port, descriptorPath, descriptor: merged };
}

async function closeServer(server) {
  if (server === undefined || server === null) return;
  LIVE_SERVERS.delete(server);
  if (!server.listening) return;
  await Promise.race([
    new Promise((resolveClose) => server.close(resolveClose)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
  ]);
  if (server.listening) server.closeAllConnections?.();
}

async function startHealthServer({
  runtime,
  healthRuntime = runtime,
  catalogRuntime = runtime,
  source,
  workspace = undefined,
  goalId = undefined,
  healthStatus = "ok",
  includeSource = true,
  sourceCount = includeSource ? 1 : 0,
  host = "127.0.0.1",
  port = 0,
}) {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/healthz") {
      response.end(JSON.stringify({
        contract: "DAG_DASHBOARD_HEALTH_V2",
        status: healthStatus,
        leader_runtime_id: healthRuntime,
        source_count: sourceCount,
      }));
      return;
    }
    if (request.url === "/api/catalog") {
      response.end(JSON.stringify({
        contract: "DAG_DASHBOARD_CATALOG_V1",
        leader_runtime_id: catalogRuntime,
        sources: includeSource
          ? Array.from({ length: sourceCount }, () => ({
            id: source,
            ...(workspace === undefined ? {} : { workspace }),
            ...(goalId === undefined ? {} : { goal_id: goalId }),
            project: "fixture",
            title: "fixture",
            status: "active",
          }))
          : [],
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, resolveListen);
  });
  LIVE_SERVERS.add(server);
  return server;
}

async function descriptorAndRuntimeSnapshot(fixture) {
  return {
    workspace: await snapshotPath(fixture.workspace),
    runtime: await snapshotPath(dirname(fixture.descriptorPath)),
  };
}

async function runStatus(fixture, inspectIdentity = inspectProcessIdentity) {
  return statusDashboard({
    workspace: canonicalPath(fixture.workspace),
    goalId: fixture.goalId,
    host: fixture.host,
    port: fixture.port,
  }, { inspectProcessIdentity: inspectIdentity });
}

function stopOptions(fixture, overrides = {}) {
  return {
    workspace: canonicalPath(fixture.workspace),
    goalId: fixture.goalId,
    descriptorToken: fixture.descriptor.descriptor_token,
    host: fixture.host,
    port: fixture.port,
    ...overrides,
  };
}

function assertExactKeys(value, keys) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}

async function startRegisteredDashboard(goalId = `goal-registered-${randomUUID()}`) {
  const data = await createDashboardWorkspace(goalId);
  const host = "127.0.0.1";
  const port = await reservePort();
  const id = runtimeId(data.workspace, data.goalId, host, port);
  const args = expectedDashboardArgv({
    planPath: data.planPath,
    statePath: data.statePath,
    lifecyclePath: data.lifecyclePath,
  }, { host, port, allowRemote: false }, id);
  const child = spawn(process.execPath, [DRIVER, ...args], {
    cwd: data.workspace,
    stdio: "ignore",
  });
  LIVE_CHILDREN.add(child);
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once("spawn", resolveSpawn);
    child.once("error", rejectSpawn);
  });
  const identity = await waitFor(
    () => inspectProcessIdentity(child.pid),
    `registered dashboard identity for ${child.pid}`,
  );
  const descriptorPath = dashboardDescriptorPath(data.workspace, data.goalId, host, port);
  const descriptor = descriptorFor({ data, host, port, pid: child.pid, identity });
  await mkdir(dirname(descriptorPath), { recursive: true, mode: 0o700 });
  await writeFile(descriptor.log_path, "registered dashboard log\n", "utf8");
  await writeJson(descriptorPath, descriptor);
  await waitFor(async () => {
    try {
      const response = await fetch(new URL("healthz", descriptor.url));
      return response.ok;
    } catch {
      return false;
    }
  }, `registered dashboard ${descriptor.url}`);
  return { ...data, child, identity, host, port, descriptorPath, descriptor };
}

test.afterEach(async () => {
  for (const server of [...LIVE_SERVERS]) await closeServer(server);
  for (const child of [...LIVE_CHILDREN]) await stopChild(child);
  for (const pid of [...LIVE_PIDS]) await stopPid(pid);
  for (const path of [...TEMPORARY_PATHS]) {
    await rm(path, { recursive: true, force: true });
    TEMPORARY_PATHS.delete(path);
  }
  await rm(DEFAULT_RUNTIME_DIRECTORY, { recursive: true, force: true });
});

test.after(async () => {
  for (const server of [...LIVE_SERVERS]) await closeServer(server);
  for (const child of [...LIVE_CHILDREN]) await stopChild(child);
  for (const pid of [...LIVE_PIDS]) await stopPid(pid);
  for (const path of [...TEMPORARY_PATHS]) await rm(path, { recursive: true, force: true });
  await rm(TEST_RUNTIME_PARENT, { recursive: true, force: true });
  delete process.env.ZCODE_DASHBOARD_RUNTIME_DIRECTORY_TEST;
});

test("default dashboard runtime directory resolves the OS temp alias to real ancestors", () => {
  const override = process.env.ZCODE_DASHBOARD_RUNTIME_DIRECTORY_TEST;
  delete process.env.ZCODE_DASHBOARD_RUNTIME_DIRECTORY_TEST;
  try {
    const runtimeDirectory = dashboardRuntimeDirectory();
    assert.equal(dirname(runtimeDirectory), realpathSync.native(tmpdir()));
  } finally {
    process.env.ZCODE_DASHBOARD_RUNTIME_DIRECTORY_TEST = override;
  }
});

test("safe descriptor reads reject every symlinked lexical ancestor before parsing bytes", async () => {
  const base = await mkdtemp(join(await realpath(tmpdir()), "zcode-dashboard-root-check-"));
  TEMPORARY_PATHS.add(base);
  const outside = join(base, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "descriptor.json"), "valid-looking-sentinel\n", "utf8");

  const runtimeRoot = join(base, "runtime");
  await symlink(outside, runtimeRoot);
  assert.deepEqual(
    safeRegularFileBytes(join(runtimeRoot, "descriptor.json"), runtimeRoot),
    { status: "invalid", error: `unsafe ancestor: ${runtimeRoot}` },
  );

  const ancestor = join(base, "ancestor");
  const nestedRuntimeRoot = join(ancestor, "runtime");
  await mkdir(join(outside, "runtime"));
  await writeFile(join(outside, "runtime", "descriptor.json"), "valid-looking-sentinel\n", "utf8");
  await symlink(outside, ancestor);
  assert.deepEqual(
    safeRegularFileBytes(join(nestedRuntimeRoot, "descriptor.json"), nestedRuntimeRoot),
    { status: "invalid", error: `unsafe ancestor: ${ancestor}` },
  );
});

test("descriptor publication rejects symlink and nonregular final targets without outside writes", async () => {
  const base = await mkdtemp(join(await realpath(tmpdir()), "zcode-dashboard-publish-"));
  TEMPORARY_PATHS.add(base);
  const runtimeRoot = join(base, "runtime");
  const outside = join(base, "outside.txt");
  const target = join(runtimeRoot, "dashboard.json");
  await mkdir(runtimeRoot);
  await writeFile(outside, "outside-sentinel\n", "utf8");
  await symlink(outside, target);
  assert.throws(() => writeDashboardDescriptorAtomic(target, "replacement\n"));
  assert.equal(await readFile(outside, "utf8"), "outside-sentinel\n");
  await rm(target);
  await mkdir(target);
  assert.throws(() => writeDashboardDescriptorAtomic(target, "replacement\n"));
  assert.equal((await stat(target)).isDirectory(), true);
});

test("descriptor publication creates unpredictable exclusive temp files and rejects collisions", async () => {
  for (const mode of ["symlink", "directory"]) {
    const base = await mkdtemp(join(await realpath(tmpdir()), `zcode-dashboard-temp-${mode}-`));
    TEMPORARY_PATHS.add(base);
    const target = join(base, "dashboard.json");
    const outside = join(base, "outside.txt");
    const collision = join(base, `.dashboard.json.${process.pid}.fixed.tmp`);
    await writeFile(outside, "outside-sentinel\n", "utf8");
    if (mode === "symlink") await symlink(outside, collision);
    else await mkdir(collision);
    assert.throws(() => writeDashboardDescriptorAtomic(target, "replacement\n", {
      randomUUID: () => "fixed",
    }));
    assert.equal(await readFile(outside, "utf8"), "outside-sentinel\n");
    const collisionMetadata = await lstat(collision);
    assert.equal(
      mode === "symlink" ? collisionMetadata.isSymbolicLink() : collisionMetadata.isDirectory(),
      true,
      mode,
    );
  }
});

test("descriptor publication cannot overwrite a final target introduced before publish", async () => {
  const base = await mkdtemp(join(await realpath(tmpdir()), "zcode-dashboard-publish-race-"));
  TEMPORARY_PATHS.add(base);
  const target = join(base, "dashboard.json");
  const outside = join(base, "outside.txt");
  await writeFile(outside, "outside-sentinel\n", "utf8");
  assert.throws(() => writeDashboardDescriptorAtomic(target, "replacement\n", {
    beforePublish: () => symlinkSync(outside, target),
  }));
  assert.equal(await readFile(outside, "utf8"), "outside-sentinel\n");
  assert.equal((await lstat(target)).isSymbolicLink(), true);
});

test("status on a missing descriptor performs zero writes", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "zcode-dashboard-"));
  TEMPORARY_PATHS.add(workspace);
  const canonicalWorkspace = await realpath(workspace);
  const beforeWorkspace = await snapshotPath(workspace);
  const beforeRuntime = await snapshotPath(DEFAULT_RUNTIME_DIRECTORY);
  const result = runNode(DASHBOARD_STATUS, [workspace, "--goal", "g1"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    contract: "ZCODE_DASHBOARD_STATUS_RECEIPT_V1",
    status: "not_found",
    workspace_root: canonicalWorkspace,
    goal_id: "g1",
    host: "127.0.0.1",
    port: 57357,
  });
  assert.deepEqual(await snapshotPath(workspace), beforeWorkspace);
  assert.deepEqual(await snapshotPath(DEFAULT_RUNTIME_DIRECTORY), beforeRuntime);
});

test("current platform process identity is stable and strict when supported", async (context) => {
  if (!new Set(["darwin", "linux", "win32"]).has(process.platform)) {
    context.skip(`unsupported process identity platform: ${process.platform}`);
    return;
  }
  const fixture = await startSleepProcess("current-platform");
  assert.equal(fixture.identity.pid, fixture.child.pid);
  assert.ok(fixture.identity.start_marker);
  assert.ok(fixture.identity.executable);
  assert.ok(Array.isArray(fixture.identity.argv));
  assert.equal(fixture.identity.argv[0], process.execPath);
  assert.equal(fixture.identity.argv[1], fixture.script);
  assert.match(fixture.identity.command_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(processIdentityMatches(fixture.identity, structuredClone(fixture.identity)), true);
  for (const field of ["pid", "platform", "start_marker", "executable", "argv", "command", "command_digest"]) {
    const changed = structuredClone(fixture.identity);
    if (field === "pid") changed[field] += 1;
    else if (field === "argv") changed[field] = [...changed[field], "wrong"];
    else changed[field] = `${changed[field]}-wrong`;
    assert.equal(processIdentityMatches(fixture.identity, changed), false, field);
    const missing = structuredClone(fixture.identity);
    delete missing[field];
    assert.equal(processIdentityMatches(fixture.identity, missing), false, `${field} missing`);
  }
});

test("Darwin real process inspection preserves spaces apostrophes and empty argv boundaries", async (context) => {
  if (process.platform !== "darwin") context.skip("Darwin-only KERN_PROCARGS2 integration");
  const directory = await mkdtemp(join(await realpath(tmpdir()), "zcode argv 'space-"));
  TEMPORARY_PATHS.add(directory);
  const script = join(directory, "sleep 'quoted script.mjs");
  await writeFile(script, "setInterval(() => {}, 1000);\n", "utf8");
  const argumentsList = [script, "", "space value", "apostrophe'value", "", "interior", ""];
  const child = spawn(process.execPath, argumentsList, { cwd: directory, stdio: "ignore" });
  LIVE_CHILDREN.add(child);
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once("spawn", resolveSpawn);
    child.once("error", rejectSpawn);
  });
  const identity = await waitFor(
    () => inspectProcessIdentity(child.pid),
    `exact Darwin process identity for ${child.pid}`,
  );
  assert.deepEqual(identity.argv, [process.execPath, ...argumentsList]);
});

test("Darwin procargs parser preserves exact argv boundaries and rejects malformed fixtures", () => {
  const parsed = parseDarwinProcessIdentity(712, {
    start: "Sun Aug  2 12:34:56 2026\n",
    executable_base64: Buffer.from("/opt/homebrew/bin/node").toString("base64"),
    argv_base64: [
      "/opt/homebrew/bin/node",
      "",
      "/tmp/start dashboard's.mjs",
      "",
      "--goal",
      "g1",
      "",
    ].map((value) => Buffer.from(value).toString("base64")),
  });
  assert.deepEqual(parsed, {
    pid: 712,
    platform: "darwin",
    start_marker: "Sun Aug 2 12:34:56 2026",
    executable: "/opt/homebrew/bin/node",
    argv: [
      "/opt/homebrew/bin/node",
      "",
      "/tmp/start dashboard's.mjs",
      "",
      "--goal",
      "g1",
      "",
    ],
    command: "/opt/homebrew/bin/node\u0000\u0000/tmp/start dashboard's.mjs\u0000\u0000--goal\u0000g1\u0000",
    command_digest: sha256("/opt/homebrew/bin/node\u0000\u0000/tmp/start dashboard's.mjs\u0000\u0000--goal\u0000g1\u0000"),
  });
  assert.equal(parseDarwinProcessIdentity(712, { start: "", executable_base64: "", argv_base64: [] }), null);
  assert.equal(parseDarwinProcessIdentity(712, { start: "date", executable_base64: "***", argv_base64: [] }), null);
});

test("Linux proc parser binds start token executable command and argv", () => {
  const statLine = "932 (node worker) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 424242 20";
  const cmdline = Buffer.from("/usr/bin/node\0/opt/start-dashboard.mjs\0/tmp/workspace\0\0--goal\0g1\0");
  const parsed = parseLinuxProcessIdentity(932, {
    stat: statLine,
    cmdline,
    executable: "/usr/bin/node",
  });
  assert.deepEqual(parsed, {
    pid: 932,
    platform: "linux",
    start_marker: "proc-stat:424242",
    executable: "/usr/bin/node",
    argv: ["/usr/bin/node", "/opt/start-dashboard.mjs", "/tmp/workspace", "", "--goal", "g1"],
    command: "/usr/bin/node\u0000/opt/start-dashboard.mjs\u0000/tmp/workspace\u0000\u0000--goal\u0000g1",
    command_digest: sha256("/usr/bin/node\u0000/opt/start-dashboard.mjs\u0000/tmp/workspace\u0000\u0000--goal\u0000g1"),
  });
  assert.equal(parseLinuxProcessIdentity(932, { stat: "bad", cmdline, executable: "/usr/bin/node" }), null);
  assert.equal(parseLinuxProcessIdentity(932, { stat: statLine, cmdline: Buffer.alloc(0), executable: "/usr/bin/node" }), null);
});

test("Windows CIM parser preserves quoted and empty argv and fails closed on malformed input", () => {
  const parsed = parseWindowsProcessIdentity(44, {
    ProcessId: 44,
    CreationDate: "20260802123456.000000+000",
    ExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
    CommandLine: '"C:\\Program Files\\nodejs\\node.exe" "" "C:\\work space\\dash.js" "" "apostrophe\'value" "quoted\\\"value" ""',
  });
  assert.deepEqual(parsed?.argv, [
    "C:\\Program Files\\nodejs\\node.exe",
    "",
    "C:\\work space\\dash.js",
    "",
    "apostrophe'value",
    'quoted"value',
    "",
  ]);
  assert.equal(parsed?.start_marker, "20260802123456.000000+000");
  assert.equal(parsed?.executable, "C:\\Program Files\\nodejs\\node.exe");
  assert.equal(parsed?.command_digest, sha256(parsed.argv.join("\0")));
  assert.equal(parseWindowsProcessIdentity(44, {
    ProcessId: 45,
    CreationDate: "date",
    ExecutablePath: "C:\\node.exe",
    CommandLine: "C:\\node.exe script.js",
  }), null);
  assert.equal(parseWindowsProcessIdentity(44, {
    ProcessId: 44,
    CreationDate: "date",
    ExecutablePath: "C:\\node.exe",
    CommandLine: '"C:\\node.exe script.js',
  }), null);
});

test("vanished and invalid process identities fail closed", async () => {
  assert.equal(inspectProcessIdentity(-1), null);
  assert.equal(inspectProcessIdentity(2_147_483_647), null);
  assert.equal(processIdentityMatches(null, null), false);
  assert.equal(processIdentityMatches({ pid: 1 }, { pid: 1 }), false);
  const fixture = await startSleepProcess("vanish");
  await stopChild(fixture.child);
  assert.equal(inspectProcessIdentity(fixture.child.pid), null);
});

test("process observation distinguishes present absent and unknown", async () => {
  const fixture = await startSleepProcess("process-observation");
  assert.deepEqual(inspectProcessObservation(fixture.child.pid), {
    status: "present",
    identity: fixture.identity,
  });
  await stopChild(fixture.child);
  assert.deepEqual(inspectProcessObservation(fixture.child.pid), { status: "absent" });
  assert.deepEqual(inspectProcessObservation(-1), { status: "unknown" });
});

test("expected argv and command descriptor bind exact canonical dashboard launch", async () => {
  const data = await createDashboardWorkspace("goal-command");
  const port = 58432;
  const id = runtimeId(data.workspace, data.goalId, "127.0.0.1", port);
  const dashboardArgs = expectedDashboardArgv(data, {
    host: "127.0.0.1",
    port,
    allowRemote: false,
  }, id);
  assert.deepEqual(dashboardArgs, [
    "dashboard",
    await realpath(data.planPath),
    await realpath(data.statePath),
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--runtime-id",
    id,
  ]);
  const identity = {
    pid: 100,
    platform: process.platform,
    start_marker: "marker",
    executable: process.execPath,
    argv: [process.execPath, DRIVER, ...dashboardArgs],
    command: [process.execPath, DRIVER, ...dashboardArgs].join(" "),
    command_digest: sha256([process.execPath, DRIVER, ...dashboardArgs].join("\0")),
  };
  const descriptor = descriptorFor({
    data,
    host: "127.0.0.1",
    port,
    pid: 100,
    identity,
  });
  assert.equal(descriptorMatchesDashboardCommand(descriptor, DRIVER), true);
  for (const [label, mutation] of [
    ["wrong script", (value) => { value.expected_argv[1] = join(dirname(DRIVER), "wrong.mjs"); }],
    ["wrong workspace", (value) => { value.workspace_root = `${value.workspace_root}-wrong`; }],
    ["wrong goal", (value) => { value.goal_id = `${value.goal_id}-wrong`; }],
    ["wrong plan", (value) => { value.expected_argv[3] = `${value.expected_argv[3]}-wrong`; }],
    ["wrong host", (value) => { value.expected_argv[7] = "localhost"; }],
    ["wrong port", (value) => { value.expected_argv[9] = "1"; }],
    ["wrong runtime", (value) => { value.expected_argv[11] = "0".repeat(20); }],
    ["extra argv", (value) => { value.expected_argv.push("--extra"); }],
  ]) {
    const changed = structuredClone(descriptor);
    mutation(changed);
    assert.equal(descriptorMatchesDashboardCommand(changed, DRIVER), false, label);
  }
});

test("descriptor parser enforces exact V2 keys types token paths and command binding", async () => {
  const fixture = await writeDescriptorFixture();
  const descriptor = JSON.parse(await readFile(fixture.descriptorPath, "utf8"));
  const canonicalWorkspace = await realpath(fixture.workspace);
  assert.deepEqual(parseDashboardDescriptorV2(descriptor, {
    workspaceRoot: canonicalWorkspace,
    goalId: fixture.goalId,
    host: fixture.host,
    port: fixture.port,
    driverPath: DRIVER,
  }), descriptor);
  const runtimeGoalDirectory = join(
    descriptor.workflow_root,
    "runtime",
    "goals",
    descriptor.goal_id,
  );
  const runtimeGoalDescriptor = structuredClone(descriptor);
  runtimeGoalDescriptor.goal_path = join(runtimeGoalDirectory, "goal.json");
  runtimeGoalDescriptor.plan_path = join(runtimeGoalDirectory, "plan.json");
  runtimeGoalDescriptor.state_path = join(runtimeGoalDirectory, "state.json");
  runtimeGoalDescriptor.lifecycle_path = join(runtimeGoalDirectory, "dashboard.json");
  synchronizeDescriptorCommand(runtimeGoalDescriptor);
  assert.deepEqual(parseDashboardDescriptorV2(runtimeGoalDescriptor, {
    workspaceRoot: canonicalWorkspace,
    goalId: fixture.goalId,
    host: fixture.host,
    port: fixture.port,
    driverPath: DRIVER,
  }), runtimeGoalDescriptor);
  const invalidCases = [
    ["unknown field", (value) => { value.extra = true; }],
    ["bad token", (value) => { value.descriptor_token = "not-a-uuid"; }],
    ["relative workspace", (value) => { value.workspace_root = "relative"; }],
    ["wrong workspace", (value) => { value.workspace_root = `${value.workspace_root}-wrong`; }],
    ["wrong goal", (value) => { value.goal_id = "wrong-goal"; }],
    ["escaped goal", (value) => {
      const escaped = join(value.workspace_root, "escaped", "goal.json");
      value.goal_path = escaped;
      value.plan_path = join(dirname(escaped), "plan.json");
      value.state_path = join(dirname(escaped), "state.json");
      value.lifecycle_path = join(dirname(escaped), "dashboard.json");
      synchronizeDescriptorCommand(value);
    }],
    ["nested plan", (value) => {
      value.plan_path = join(dirname(value.goal_path), "nested", "plan.json");
      synchronizeDescriptorCommand(value);
    }],
    ["nested state", (value) => {
      value.state_path = join(dirname(value.goal_path), "nested", "state.json");
      synchronizeDescriptorCommand(value);
    }],
    ["nested lifecycle", (value) => {
      value.lifecycle_path = join(dirname(value.goal_path), "nested", "dashboard.json");
      synchronizeDescriptorCommand(value);
    }],
    ["bad URL", (value) => { value.url = `http://127.0.0.1:${value.port}/other`; }],
    ["bad port", (value) => { value.port = 0; }],
    ["bad pid", (value) => { value.pid = 0; }],
    ["bad timestamp", (value) => { value.created_at = "today"; }],
    ["wrong log path", (value) => { value.log_path = join(dirname(value.log_path), "wrong.log"); }],
    ["partial identity", (value) => { delete value.process_identity.start_marker; }],
    ["wrong command", (value) => { value.expected_argv[1] = join(dirname(DRIVER), "wrong.mjs"); }],
  ];
  for (const [label, mutation] of invalidCases) {
    const changed = structuredClone(descriptor);
    mutation(changed);
    assert.throws(() => parseDashboardDescriptorV2(changed, {
      workspaceRoot: canonicalWorkspace,
      goalId: fixture.goalId,
      host: fixture.host,
      port: fixture.port,
      driverPath: DRIVER,
    }), undefined, label);
  }
});

test("starter rejects runtime-root and final log/descriptor unsafe targets without outside writes", async () => {
  for (const mode of ["runtime-root", "runtime-file", "log-symlink", "log-directory", "descriptor-symlink", "descriptor-directory"]) {
    const fixture = await createDashboardWorkspace(`goal-safe-${mode}`);
    const port = await reservePort();
    const base = await mkdtemp(join(await realpath(tmpdir()), `zcode-dashboard-${mode}-`));
    TEMPORARY_PATHS.add(base);
    const runtimeRoot = join(base, "runtime");
    const outside = join(base, "outside.txt");
    await writeFile(outside, "outside-sentinel\n", "utf8");
    process.env.ZCODE_DASHBOARD_RUNTIME_DIRECTORY_TEST = runtimeRoot;
    const id = runtimeId(fixture.workspace, fixture.goalId, "127.0.0.1", port);
    if (mode === "runtime-root") {
      await symlink(dirname(outside), runtimeRoot);
    } else if (mode === "runtime-file") {
      await writeFile(runtimeRoot, "runtime-sentinel\n", "utf8");
    } else {
      await mkdir(runtimeRoot);
      const extension = mode.startsWith("log-") ? "log" : "json";
      const target = join(runtimeRoot, `${id}.${extension}`);
      if (mode.endsWith("-symlink")) await symlink(outside, target);
      else await mkdir(target);
    }
    try {
      const before = await snapshotPath(base);
      await assert.rejects(() => startDashboard({
        workspace: fixture.workspace,
        goalId: fixture.goalId,
        host: "127.0.0.1",
        port,
        allowRemote: false,
      }));
      assert.equal(await readFile(outside, "utf8"), "outside-sentinel\n", mode);
      assert.deepEqual(await snapshotPath(base), before, mode);
    } finally {
      process.env.ZCODE_DASHBOARD_RUNTIME_DIRECTORY_TEST = DEFAULT_RUNTIME_DIRECTORY;
    }
  }
});

test("starter fails closed on an existing symlink descriptor without spawning or outside writes", async () => {
  const fixture = await createDashboardWorkspace("goal-existing-descriptor-symlink");
  const port = await reservePort();
  const descriptorPath = dashboardDescriptorPath(fixture.workspace, fixture.goalId, "127.0.0.1", port);
  const runtimeRoot = dirname(descriptorPath);
  const outside = join(TEST_RUNTIME_PARENT, "existing-descriptor-outside.txt");
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  await writeFile(outside, "outside-sentinel\n", "utf8");
  await symlink(outside, descriptorPath);
  const before = await snapshotPath(TEST_RUNTIME_PARENT);
  await assert.rejects(() => startDashboard({
    workspace: fixture.workspace,
    goalId: fixture.goalId,
    host: "127.0.0.1",
    port,
    allowRemote: false,
  }));
  assert.deepEqual(await snapshotPath(TEST_RUNTIME_PARENT), before);
  assert.equal(await readFile(outside, "utf8"), "outside-sentinel\n");
});

test("starter writes Descriptor V2 with token identity and full launch binding", async () => {
  const fixture = await createDashboardWorkspace("goal-start");
  const port = await reservePort();
  const result = runNode(START_DASHBOARD, [
    fixture.workspace,
    "--goal",
    fixture.goalId,
    "--port",
    String(port),
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const started = JSON.parse(result.stdout);
  assertExactKeys(started, [
    "contract",
    "status",
    "url",
    "pid",
    "log_path",
    "descriptor_path",
    "descriptor_token",
    "runtime_id",
    "role",
    "source_id",
    "workspace_root",
    "workflow_root",
    "goal_id",
    "host",
    "port",
    "plan_path",
    "state_path",
    "progress_document_path",
    "progress_document_url",
    "progress_events_path",
    "progress_events_url",
    "live_updates_url",
    "read_only",
  ]);
  assert.equal(started.contract, "ZCODE_DASHBOARD_START_RECEIPT_V2");
  assert.equal(started.status, "started");
  const descriptor = JSON.parse(await readFile(started.descriptor_path, "utf8"));
  assert.equal(started.descriptor_token, descriptor.descriptor_token);
  assert.equal(started.runtime_id, descriptor.runtime_id);
  try {
    assert.equal(descriptor.contract, "ZCODE_DASHBOARD_DESCRIPTOR_V2");
    assert.match(descriptor.descriptor_token, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    assert.ok(descriptor.process_identity.start_marker);
    assert.match(descriptor.process_identity.command_digest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(descriptor.expected_argv[0], process.execPath);
    assert.equal(descriptor.expected_argv[1], await realpath(DRIVER));
    assert.equal(descriptorMatchesDashboardCommand(descriptor, DRIVER), true);
    parseDashboardDescriptorV2(descriptor, {
      workspaceRoot: await realpath(fixture.workspace),
      goalId: fixture.goalId,
      host: "127.0.0.1",
      port,
      driverPath: DRIVER,
    });
  } finally {
    try { process.kill(started.pid, "SIGTERM"); } catch {}
    await waitFor(() => inspectProcessIdentity(started.pid) === null, "started dashboard exit").catch(() => null);
    await rm(started.descriptor_path, { force: true });
    await rm(started.log_path, { force: true });
  }
});

test("starter reuses only an exact healthy Descriptor V2 binding", async () => {
  for (const mode of ["valid", "invalid-contract", "identity-mismatch", "catalog-runtime-mismatch", "catalog-workspace-missing", "catalog-goal-missing", "active-plan-mismatch"]) {
    const data = await createDashboardWorkspace(`goal-reuse-${mode}`);
    const processFixture = await startSleepProcess(`reuse-${mode}`);
    const port = await reservePort();
    const runtime = runtimeId(data.workspace, data.goalId, "127.0.0.1", port);
    const source = sourceId(data.workspace, data.goalId);
    const server = await startHealthServer({
      runtime,
      catalogRuntime: mode === "catalog-runtime-mismatch" ? "f".repeat(20) : runtime,
      source,
      workspace: mode === "catalog-workspace-missing" ? undefined : canonicalPath(data.workspace),
      goalId: mode === "catalog-goal-missing" ? undefined : data.goalId,
      port,
    });
    const fixture = await writeDescriptorFixture({}, { data, processFixture, port });
    if (mode === "invalid-contract") {
      const descriptor = structuredClone(fixture.descriptor);
      descriptor.contract = "ZCODE_DASHBOARD_DESCRIPTOR_V1";
      await writeJson(fixture.descriptorPath, descriptor);
    } else if (mode === "identity-mismatch") {
      const descriptor = structuredClone(fixture.descriptor);
      descriptor.process_identity.start_marker = "wrong-marker";
      await writeJson(fixture.descriptorPath, descriptor);
    } else if (mode === "active-plan-mismatch") {
      const goalState = JSON.parse(await readFile(data.goalStatePath, "utf8"));
      goalState.active_plan_path = join(data.goalDirectory, "other-plan.json");
      await writeJson(data.goalStatePath, goalState);
    }
    try {
      const before = await descriptorAndRuntimeSnapshot(fixture);
      const operation = () => startDashboard({
        workspace: data.workspace,
        goalId: data.goalId,
        host: "127.0.0.1",
        port,
        allowRemote: false,
      }, {
        inspectProcessIdentity: () => mode === "identity-mismatch"
          ? processFixture.identity
          : fixture.descriptor.process_identity,
      });
      if (mode === "valid") {
        const payload = await operation();
        assert.equal(payload.contract, "ZCODE_DASHBOARD_START_RECEIPT_V2");
        assert.equal(payload.status, "already_running");
        assert.equal(payload.pid, processFixture.child.pid);
        assert.equal(payload.descriptor_path, fixture.descriptorPath);
        assert.equal(payload.descriptor_token, fixture.descriptor.descriptor_token);
        assert.equal(payload.runtime_id, fixture.descriptor.runtime_id);
        assert.equal(payload.host, fixture.host);
        assert.equal(payload.port, fixture.port);
      } else {
        await assert.rejects(operation, undefined, mode);
      }
      assert.equal(inspectProcessIdentity(processFixture.child.pid)?.pid, processFixture.child.pid, mode);
      assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before, mode);
    } finally {
      await closeServer(server);
    }
  }
});

test("starter startup failure SIGTERMs only its exact captured child and cleans confirmed dead state", async () => {
  const fixture = await createDashboardWorkspace("goal-start-failure-cleanup");
  const other = await startSleepProcess("start-failure-other");
  const port = await reservePort();
  let spawnedPid = null;
  await assert.rejects(() => startDashboard({
    workspace: fixture.workspace,
    goalId: fixture.goalId,
    host: "127.0.0.1",
    port,
    allowRemote: false,
  }, {
    inspectProcessIdentity(pid) {
      if (pid !== other.child.pid) spawnedPid = pid;
      return inspectProcessIdentity(pid);
    },
    probeDashboard: async () => false,
    startupAttempts: 1,
    startupDelayMs: 1,
    shutdownTimeoutMs: 2_000,
  }));
  assert.ok(Number.isInteger(spawnedPid));
  assert.equal(inspectProcessIdentity(spawnedPid), null);
  assert.equal(inspectProcessIdentity(other.child.pid)?.pid, other.child.pid);
  const descriptorPath = dashboardDescriptorPath(fixture.workspace, fixture.goalId, "127.0.0.1", port);
  await assert.rejects(readFile(descriptorPath, "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(join(dirname(descriptorPath), `${runtimeId(fixture.workspace, fixture.goalId, "127.0.0.1", port)}.log`), "utf8"), { code: "ENOENT" });
});

test("starter startup failure never signals its child after captured identity drift", { concurrency: false }, async () => {
  const fixture = await createDashboardWorkspace("goal-start-failure-drift");
  const port = await reservePort();
  let spawnedPid = null;
  let capturedIdentity = null;
  let inspections = 0;
  await assert.rejects(() => startDashboard({
    workspace: fixture.workspace,
    goalId: fixture.goalId,
    host: "127.0.0.1",
    port,
    allowRemote: false,
  }, {
    inspectProcessIdentity(pid) {
      spawnedPid = pid;
      const observed = inspectProcessIdentity(pid);
      if (observed === null) return null;
      inspections += 1;
      if (capturedIdentity === null) {
        capturedIdentity = observed;
        return observed;
      }
      return { ...observed, start_marker: `${observed.start_marker}-drift` };
    },
    probeDashboard: async () => false,
    startupAttempts: 1,
    startupDelayMs: 1,
    shutdownTimeoutMs: 50,
  }));
  assert.ok(inspections >= 2);
  assert.ok(Number.isInteger(spawnedPid));
  LIVE_PIDS.add(spawnedPid);
  assert.equal(inspectProcessIdentity(spawnedPid)?.pid, spawnedPid);
  const descriptorPath = dashboardDescriptorPath(fixture.workspace, fixture.goalId, "127.0.0.1", port);
  assert.equal((await stat(descriptorPath)).isFile(), true);
});

test("starter fails closed when the port is occupied without a descriptor", async () => {
  const fixture = await createDashboardWorkspace("goal-untracked-port");
  const server = createServer((request, response) => {
    response.statusCode = 503;
    response.end("occupied\n");
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  const before = await snapshotPath(TEST_RUNTIME_PARENT);
  try {
    await assert.rejects(() => startDashboard({
      workspace: fixture.workspace,
      goalId: fixture.goalId,
      host: "127.0.0.1",
      port: address.port,
      allowRemote: false,
    }));
    assert.deepEqual(await snapshotPath(TEST_RUNTIME_PARENT), before);
  } finally {
    await closeServer(server);
  }
});

test("starter refuses an occupied dashboard port without deleting or signaling tracked state", async () => {
  const fixture = await createDashboardWorkspace("goal-occupied");
  const port = await reservePort();
  const descriptorPath = dashboardDescriptorPath(fixture.workspace, fixture.goalId, "127.0.0.1", port);
  const runtimeRoot = dirname(descriptorPath);
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  const sentinelDescriptor = join(runtimeRoot, "occupied-sentinel.json");
  const sentinelLog = join(runtimeRoot, "occupied-sentinel.log");
  const occupiedProcess = await startSleepProcess("occupied-sentinel");
  await writeJson(sentinelDescriptor, {
    host: "127.0.0.1",
    port,
    pid: occupiedProcess.child.pid,
    plan_path: join(fixture.goalDirectory, "missing-plan.json"),
    state_path: join(fixture.goalDirectory, "missing-state.json"),
    log_path: sentinelLog,
  });
  await writeFile(sentinelLog, "sentinel\n", "utf8");
  const before = await snapshotPath(runtimeRoot);
  const result = runNode(START_DASHBOARD, [
    fixture.workspace,
    "--goal",
    fixture.goalId,
    "--port",
    String(port),
  ]);
  assert.notEqual(result.status, 0);
  assert.equal(inspectProcessIdentity(occupiedProcess.child.pid)?.pid, occupiedProcess.child.pid);
  assert.deepEqual(await snapshotPath(runtimeRoot), before);
});

test("stop requires the descriptor token and explicit target identity", async () => {
  const fixture = await writeDescriptorFixture();
  const before = await descriptorAndRuntimeSnapshot(fixture);
  for (const [label, args] of [
    ["missing token", [fixture.workspace, "--goal", fixture.goalId, "--host", fixture.host, "--port", String(fixture.port)]],
    ["missing goal", [fixture.workspace, "--descriptor-token", fixture.descriptor.descriptor_token, "--host", fixture.host, "--port", String(fixture.port)]],
    ["malformed token", [fixture.workspace, "--goal", fixture.goalId, "--descriptor-token", "not-the-token", "--host", fixture.host, "--port", String(fixture.port)]],
  ]) {
    const result = runNode(STOP_DASHBOARD, args);
    assert.notEqual(result.status, 0, label);
    assert.equal(result.stdout, "", label);
    assert.equal(inspectProcessIdentity(fixture.child.pid)?.pid, fixture.child.pid, label);
    assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before, label);
  }
});

test("stop token mismatch refuses with zero writes", async () => {
  const fixture = await writeDescriptorFixture();
  const before = await descriptorAndRuntimeSnapshot(fixture);
  await assert.rejects(() => stopDashboard(stopOptions(fixture, {
    descriptorToken: randomUUID(),
  })));
  assert.equal(inspectProcessIdentity(fixture.child.pid)?.pid, fixture.child.pid);
  assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before);
});


test("starter returns conflict without terminating a live conflicting process", async () => {
  const fixture = await writeDescriptorFixture({ process_identity: { start_marker: "wrong-marker" } });
  const before = await descriptorAndRuntimeSnapshot(fixture);
  const result = runNode(START_DASHBOARD, [
    fixture.workspace,
    "--goal",
    fixture.goalId,
    "--host",
    fixture.host,
    "--port",
    String(fixture.port),
  ]);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    contract: "ZCODE_DASHBOARD_START_RECEIPT_V2",
    status: "conflict",
    workspace_root: fixture.workspace,
    goal_id: fixture.goalId,
    host: fixture.host,
    port: fixture.port,
    descriptor_path: fixture.descriptorPath,
  });
  assert.equal(result.stderr, "");
  assert.equal(inspectProcessIdentity(fixture.child.pid)?.pid, fixture.child.pid);
  assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before);
});

test("starter returns conflict for an exact live but unhealthy descriptor", async () => {
  const fixture = await writeDescriptorFixture();
  const before = await descriptorAndRuntimeSnapshot(fixture);
  const result = runNode(START_DASHBOARD, [
    fixture.workspace,
    "--goal",
    fixture.goalId,
    "--host",
    fixture.host,
    "--port",
    String(fixture.port),
  ]);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "conflict");
  assert.equal(inspectProcessIdentity(fixture.child.pid)?.pid, fixture.child.pid);
  assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before);
});

test("starter conflicts on a malformed tracked live claimant with a different filename", async () => {
  const fixture = await createDashboardWorkspace("goal-malformed-live-claimant");
  const port = await reservePort();
  const runtimeRoot = dirname(dashboardDescriptorPath(
    fixture.workspace,
    fixture.goalId,
    "127.0.0.1",
    port,
  ));
  const claimant = await startSleepProcess("malformed-live-claimant");
  const claimantPath = join(runtimeRoot, "malformed-live-claimant.json");
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
  await writeJson(claimantPath, {
    host: "127.0.0.1",
    port,
    pid: claimant.child.pid,
  });
  const before = await snapshotPath(runtimeRoot);
  const result = runNode(START_DASHBOARD, [
    fixture.workspace,
    "--goal",
    fixture.goalId,
    "--port",
    String(port),
  ]);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "conflict");
  assert.equal(inspectProcessIdentity(claimant.child.pid)?.pid, claimant.child.pid);
  assert.deepEqual(await snapshotPath(runtimeRoot), before);
});

test("starter does not delete a live conflicting descriptor", async () => {
  const fixture = await writeDescriptorFixture({ goal_id: "different-goal" });
  const before = await descriptorAndRuntimeSnapshot(fixture);
  const result = runNode(START_DASHBOARD, [
    fixture.workspace,
    "--goal",
    fixture.goalId,
    "--host",
    fixture.host,
    "--port",
    String(fixture.port),
  ]);
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "conflict");
  assert.equal(inspectProcessIdentity(fixture.child.pid)?.pid, fixture.child.pid);
  assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before);
});

test("starter may clean only a dead descriptor", async () => {
  const fixture = await writeDescriptorFixture();
  const deadDescriptor = structuredClone(fixture.descriptor);
  await stopChild(fixture.child);
  const sentinelDescriptor = join(dirname(fixture.descriptorPath), "sentinel.json");
  const sentinelLog = join(dirname(fixture.descriptorPath), "sentinel.log");
  await writeJson(sentinelDescriptor, { sentinel: true });
  await writeFile(sentinelLog, "sentinel\n", "utf8");
  const result = runNode(START_DASHBOARD, [
    fixture.workspace,
    "--goal",
    fixture.goalId,
    "--host",
    fixture.host,
    "--port",
    String(fixture.port),
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.contract, "ZCODE_DASHBOARD_START_RECEIPT_V2");
  assert.equal(payload.status, "started");
  LIVE_PIDS.add(payload.pid);
  assert.notEqual(payload.pid, deadDescriptor.pid);
  assert.notEqual(payload.descriptor_token, deadDescriptor.descriptor_token);
  assert.notEqual(payload.log_path, "");
  assert.equal(await readFile(sentinelLog, "utf8"), "sentinel\n");
  assert.deepEqual(JSON.parse(await readFile(sentinelDescriptor, "utf8")), { sentinel: true });
});

test("starter preserves a live descriptor when process observation is unknown", async () => {
  const fixture = await writeDescriptorFixture();
  const before = await descriptorAndRuntimeSnapshot(fixture);
  await assert.rejects(() => startDashboard({
    workspace: fixture.workspace,
    goalId: fixture.goalId,
    host: fixture.host,
    port: fixture.port,
    allowRemote: false,
  }, {
    inspectProcessObservation: () => ({ status: "unknown" }),
  }));
  assert.equal(inspectProcessIdentity(fixture.child.pid)?.pid, fixture.child.pid);
  assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before);
});

test("starter refuses malformed unsafe or unowned dead tracked state without cleanup", async () => {
  for (const mode of ["malformed", "wrong-log", "log-symlink"]) {
    const fixture = await writeDescriptorFixture();
    await stopChild(fixture.child);
    const outside = join(TEST_RUNTIME_PARENT, `start-dead-outside-${mode}-${randomUUID()}.txt`);
    if (mode === "malformed") await writeFile(fixture.descriptorPath, "{bad", "utf8");
    if (mode === "wrong-log") {
      const descriptor = structuredClone(fixture.descriptor);
      descriptor.log_path = join(dirname(descriptor.log_path), "unowned.log");
      await writeJson(fixture.descriptorPath, descriptor);
    }
    if (mode === "log-symlink") {
      await writeFile(outside, "outside-sentinel\n", "utf8");
      await rm(fixture.descriptor.log_path);
      await symlink(outside, fixture.descriptor.log_path);
    }
    const before = await snapshotPath(TEST_RUNTIME_PARENT);
    const result = runNode(START_DASHBOARD, [
      fixture.workspace,
      "--goal",
      fixture.goalId,
      "--host",
      fixture.host,
      "--port",
      String(fixture.port),
    ]);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "conflict");
    assert.deepEqual(await snapshotPath(TEST_RUNTIME_PARENT), before, mode);
    if (mode === "log-symlink") {
      assert.equal(await readFile(outside, "utf8"), "outside-sentinel\n");
    }
  }
});

test("stop rejects pid process workspace goal host port path runtime source executable and argv mismatches", async () => {
  for (const [label, mutate, optionOverrides = {}] of [
    ["pid", (descriptor) => { descriptor.pid += 1; }],
    ["start marker", (descriptor) => { descriptor.process_identity.start_marker = "wrong-marker"; }],
    ["executable", (descriptor) => {
      descriptor.process_identity.executable = dirname(descriptor.process_identity.executable);
      descriptor.process_identity.argv[0] = descriptor.process_identity.executable;
      descriptor.process_identity.command_digest = sha256(descriptor.process_identity.argv.join("\0"));
    }],
    ["argv", (descriptor) => {
      descriptor.process_identity.argv = [...descriptor.process_identity.argv, "--wrong"];
      descriptor.process_identity.command = descriptor.process_identity.argv.join("\0");
      descriptor.process_identity.command_digest = sha256(descriptor.process_identity.argv.join("\0"));
    }],
    ["workspace", (descriptor) => { descriptor.workspace_root = `${descriptor.workspace_root}-wrong`; }],
    ["goal", (descriptor) => { descriptor.goal_id = `${descriptor.goal_id}-wrong`; }],
    ["workflow path", (descriptor) => { descriptor.workflow_root = `${descriptor.workflow_root}-wrong`; }],
    ["goal path", (descriptor) => { descriptor.goal_path = `${descriptor.goal_path}-wrong`; }],
    ["plan path", (descriptor) => { descriptor.plan_path = `${descriptor.plan_path}-wrong`; }],
    ["state path", (descriptor) => { descriptor.state_path = `${descriptor.state_path}-wrong`; }],
    ["lifecycle path", (descriptor) => { descriptor.lifecycle_path = `${descriptor.lifecycle_path}-wrong`; }],
    ["runtime", (descriptor) => { descriptor.runtime_id = "f".repeat(20); }],
    ["source", (descriptor) => { descriptor.source_id = "e".repeat(20); }],
  ]) {
    const fixture = await writeDescriptorFixture();
    const descriptor = structuredClone(fixture.descriptor);
    mutate(descriptor);
    await writeJson(fixture.descriptorPath, descriptor);
    const before = await descriptorAndRuntimeSnapshot(fixture);
    await assert.rejects(
      () => stopDashboard(stopOptions(fixture, optionOverrides)),
      undefined,
      label,
    );
    assert.equal(inspectProcessIdentity(fixture.child.pid)?.pid, fixture.child.pid, label);
    assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before, label);
  }
});

test("stop host and port requests cannot target a descriptor registered under different coordinates", async () => {
  const fixture = await writeDescriptorFixture();
  const before = await descriptorAndRuntimeSnapshot(fixture);
  for (const overrides of [{ host: "localhost" }, { port: 1 }]) {
    const payload = await stopDashboard(stopOptions(fixture, overrides));
    assert.equal(payload.status, "not_found");
    assert.equal(inspectProcessIdentity(fixture.child.pid)?.pid, fixture.child.pid);
    assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before);
  }
});

test("stop refuses when the Goal active plan no longer matches the descriptor", async () => {
  const fixture = await writeDescriptorFixture();
  const goalState = JSON.parse(await readFile(fixture.goalStatePath, "utf8"));
  goalState.active_plan_path = join(fixture.goalDirectory, "other-plan.json");
  await writeJson(fixture.goalStatePath, goalState);
  const before = await descriptorAndRuntimeSnapshot(fixture);
  await assert.rejects(() => stopDashboard(stopOptions(fixture)));
  assert.equal(inspectProcessIdentity(fixture.child.pid)?.pid, fixture.child.pid);
  assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before);
});

test("stop never kills an unrelated process sharing the port", async () => {
  const data = await createDashboardWorkspace("goal-unrelated-port");
  const server = await startHealthServer({
    runtime: "f".repeat(20),
    source: "e".repeat(20),
  });
  const address = server.address();
  assert.equal(typeof address, "object");
  const fixture = await writeDescriptorFixture({}, { data, port: address.port });
  const before = await descriptorAndRuntimeSnapshot(fixture);
  let inspection = 0;
  const payload = await stopDashboard(stopOptions(fixture), {
    inspectProcessIdentity(pid) {
      inspection += 1;
      return inspection === 1
        ? fixture.descriptor.process_identity
        : inspectProcessIdentity(pid);
    },
  });
  assert.equal(payload.status, "stopped");
  assert.equal(server.listening, true);
  assert.equal(inspectProcessIdentity(fixture.child.pid), null);
  assert.notDeepEqual(await descriptorAndRuntimeSnapshot(fixture), before);
  await closeServer(server);
});

test("stop terminates only the exact registered dashboard", async () => {
  const fixture = await startRegisteredDashboard("goal-stop-exact");
  const other = await startSleepProcess("stop-other");
  const payload = await stopDashboard(stopOptions(fixture));
  assert.deepEqual(payload, {
    contract: "ZCODE_DASHBOARD_STOP_RECEIPT_V1",
    status: "stopped",
    workspace_root: fixture.workspace,
    goal_id: fixture.goalId,
    host: fixture.host,
    port: fixture.port,
    descriptor_path: fixture.descriptorPath,
    descriptor_token: fixture.descriptor.descriptor_token,
    runtime_id: fixture.descriptor.runtime_id,
    source_id: fixture.descriptor.source_id,
    pid: fixture.child.pid,
    log_path: fixture.descriptor.log_path,
  });
  assert.equal(inspectProcessIdentity(fixture.child.pid), null);
  assert.equal(inspectProcessIdentity(other.child.pid)?.pid, other.child.pid);
});

test("stop treats post-SIGTERM identity replacement as confirmed exact-process exit", async () => {
  const fixture = await startRegisteredDashboard("goal-stop-identity-replaced");
  const replacement = await startSleepProcess("replacement-identity");
  let inspection = 0;
  const payload = await stopDashboard(stopOptions(fixture), {
    inspectProcessIdentity(pid) {
      inspection += 1;
      return inspection === 1
        ? fixture.descriptor.process_identity
        : { ...replacement.identity, pid };
    },
  });
  assert.equal(payload.status, "stopped");
  assert.equal(inspectProcessIdentity(replacement.child.pid)?.pid, replacement.child.pid);
  await assert.rejects(readFile(fixture.descriptorPath, "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(fixture.descriptor.log_path, "utf8"), { code: "ENOENT" });
});

test("stop removes only its own descriptor and log", async () => {
  const fixture = await startRegisteredDashboard("goal-stop-cleanup");
  const sentinelDescriptor = join(dirname(fixture.descriptorPath), "other.json");
  const sentinelLog = join(dirname(fixture.descriptorPath), "other.log");
  await writeJson(sentinelDescriptor, { sentinel: true });
  await writeFile(sentinelLog, "sentinel\n", "utf8");
  const payload = await stopDashboard(stopOptions(fixture));
  assert.equal(payload.status, "stopped");
  await assert.rejects(readFile(fixture.descriptorPath, "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(fixture.descriptor.log_path, "utf8"), { code: "ENOENT" });
  assert.deepEqual(JSON.parse(await readFile(sentinelDescriptor, "utf8")), { sentinel: true });
  assert.equal(await readFile(sentinelLog, "utf8"), "sentinel\n");
});

test("stop times out without SIGKILL or cleanup when the exact child ignores SIGTERM", async () => {
  const fixture = await startRegisteredDashboard("goal-stop-timeout");
  const before = await snapshotPath(dirname(fixture.descriptorPath));
  const payload = await stopDashboard(stopOptions(fixture), {
    waitTimeoutMs: 150,
    killProcess(pid, signal) {
      assert.equal(pid, fixture.child.pid);
      assert.equal(signal, "SIGTERM");
    },
  });
  const { descriptor } = fixture;
  const descriptorPath = fixture.descriptorPath;
  const child = fixture.child;
  assert.deepEqual(payload, {
    contract: "ZCODE_DASHBOARD_STOP_RECEIPT_V1",
    status: "timeout",
    workspace_root: fixture.workspace,
    goal_id: fixture.goalId,
    host: descriptor.host,
    port: descriptor.port,
    descriptor_path: descriptorPath,
    descriptor_token: descriptor.descriptor_token,
    runtime_id: descriptor.runtime_id,
    source_id: descriptor.source_id,
    pid: child.pid,
    log_path: descriptor.log_path,
  });
  assert.equal(inspectProcessIdentity(child.pid)?.pid, child.pid);
  assert.deepEqual(await snapshotPath(dirname(descriptorPath)), before);
});

test("stop treats unknown observation as timeout and preserves state", async () => {
  const fixture = await writeDescriptorFixture();
  const before = await descriptorAndRuntimeSnapshot(fixture);
  const payload = await stopDashboard(stopOptions(fixture), {
    inspectProcessObservation: () => ({ status: "unknown" }),
    waitTimeoutMs: 30,
    pollIntervalMs: 1,
  });
  assert.equal(payload.status, "timeout");
  assert.equal(inspectProcessIdentity(fixture.child.pid)?.pid, fixture.child.pid);
  assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before);
});

test("stop continues polling after transient unknown observation", async () => {
  const fixture = await writeDescriptorFixture();
  let observation = 0;
  const payload = await stopDashboard(stopOptions(fixture), {
    inspectProcessObservation() {
      observation += 1;
      if (observation === 1) {
        return { status: "present", identity: fixture.descriptor.process_identity };
      }
      if (observation === 2) return { status: "unknown" };
      return { status: "absent" };
    },
    killProcess(pid, signal) {
      assert.equal(pid, fixture.child.pid);
      assert.equal(signal, "SIGTERM");
    },
    waitTimeoutMs: 100,
    pollIntervalMs: 1,
  });
  assert.equal(payload.status, "stopped");
  assert.ok(observation >= 3);
  await assert.rejects(readFile(fixture.descriptorPath, "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(fixture.descriptor.log_path, "utf8"), { code: "ENOENT" });
});

test("stop cleans a valid bound dead descriptor as already_stopped", async () => {
  const fixture = await writeDescriptorFixture();
  await stopChild(fixture.child);
  const payload = await stopDashboard(stopOptions(fixture));
  assert.deepEqual(payload, {
    contract: "ZCODE_DASHBOARD_STOP_RECEIPT_V1",
    status: "already_stopped",
    workspace_root: fixture.workspace,
    goal_id: fixture.goalId,
    host: fixture.host,
    port: fixture.port,
    descriptor_path: fixture.descriptorPath,
    descriptor_token: fixture.descriptor.descriptor_token,
    runtime_id: fixture.descriptor.runtime_id,
    source_id: fixture.descriptor.source_id,
    pid: fixture.descriptor.pid,
    log_path: fixture.descriptor.log_path,
  });
  await assert.rejects(readFile(fixture.descriptorPath, "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(fixture.descriptor.log_path, "utf8"), { code: "ENOENT" });
});

test("stop accepts and cleans an exact registered log larger than one MiB", async () => {
  const fixture = await writeDescriptorFixture();
  await writeFile(fixture.descriptor.log_path, Buffer.alloc(1024 * 1024 + 1, 0x61));
  await stopChild(fixture.child);
  const payload = await stopDashboard(stopOptions(fixture));
  assert.equal(payload.status, "already_stopped");
  await assert.rejects(readFile(fixture.descriptorPath, "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(fixture.descriptor.log_path), { code: "ENOENT" });
});

test("stop refuses unsafe descriptor and log symlinks with zero writes", async () => {
  const fixture = await writeDescriptorFixture();
  const outside = join(TEST_RUNTIME_PARENT, `outside-${randomUUID()}.txt`);
  await writeFile(outside, "outside-sentinel\n", "utf8");
  await rm(fixture.descriptor.log_path);
  await symlink(outside, fixture.descriptor.log_path);
  const before = await snapshotPath(TEST_RUNTIME_PARENT);
  await assert.rejects(() => stopDashboard(stopOptions(fixture)));
  assert.equal(inspectProcessIdentity(fixture.child.pid)?.pid, fixture.child.pid);
  assert.deepEqual(await snapshotPath(TEST_RUNTIME_PARENT), before);
  assert.equal(await readFile(outside, "utf8"), "outside-sentinel\n");

  await rm(fixture.descriptor.log_path);
  await rm(fixture.descriptorPath);
  await symlink(outside, fixture.descriptorPath);
  const descriptorBefore = await snapshotPath(TEST_RUNTIME_PARENT);
  await assert.rejects(() => stopDashboard(stopOptions(fixture)));
  assert.equal(inspectProcessIdentity(fixture.child.pid)?.pid, fixture.child.pid);
  assert.deepEqual(await snapshotPath(TEST_RUNTIME_PARENT), descriptorBefore);
  assert.equal(await readFile(outside, "utf8"), "outside-sentinel\n");
});

test("stop refuses a log target swapped after process exit confirmation", async () => {
  const fixture = await startRegisteredDashboard("goal-stop-cleanup-race");
  const outside = join(TEST_RUNTIME_PARENT, `stop-cleanup-race-${randomUUID()}.txt`);
  await writeFile(outside, "outside-sentinel\n", "utf8");
  let inspection = 0;
  await assert.rejects(() => stopDashboard(stopOptions(fixture), {
    inspectProcessObservation(pid) {
      inspection += 1;
      if (inspection === 1) {
        return { status: "present", identity: fixture.descriptor.process_identity };
      }
      if (inspection === 2) {
        rmSync(fixture.descriptor.log_path);
        symlinkSync(outside, fixture.descriptor.log_path);
        return { status: "absent" };
      }
      return inspectProcessObservation(pid);
    },
  }));
  assert.equal(await readFile(outside, "utf8"), "outside-sentinel\n");
  assert.equal((await lstat(fixture.descriptor.log_path)).isSymbolicLink(), true);
  assert.equal((await stat(fixture.descriptorPath)).isFile(), true);
});

test("stop restores state when a regular cleanup target is replaced before quarantine", async () => {
  for (const target of ["descriptor", "log"]) {
    const fixture = await writeDescriptorFixture();
    await stopChild(fixture.child);
    const descriptorBytes = await readFile(fixture.descriptorPath);
    const logBytes = await readFile(fixture.descriptor.log_path);
    const targetPath = target === "descriptor" ? fixture.descriptorPath : fixture.descriptor.log_path;
    const replacementBytes = Buffer.from(`${target}-replacement-${randomUUID()}\n`);
    await assert.rejects(() => stopDashboard(stopOptions(fixture), {
      beforeCleanupQuarantine() {
        writeFileSync(targetPath, replacementBytes);
      },
    }), undefined, target);
    assert.deepEqual(await readFile(targetPath), replacementBytes, target);
    const otherPath = target === "descriptor" ? fixture.descriptor.log_path : fixture.descriptorPath;
    assert.deepEqual(
      await readFile(otherPath),
      target === "descriptor" ? logBytes : descriptorBytes,
      `${target} counterpart`,
    );
  }
});

test("starter refuses and restores regular or symlink replacement before dead-state quarantine", async () => {
  for (const mode of ["descriptor-regular", "log-regular", "descriptor-symlink", "log-symlink"]) {
    const fixture = await writeDescriptorFixture();
    await stopChild(fixture.child);
    const descriptorBytes = await readFile(fixture.descriptorPath);
    const logBytes = await readFile(fixture.descriptor.log_path);
    const targetPath = mode.startsWith("descriptor")
      ? fixture.descriptorPath
      : fixture.descriptor.log_path;
    const outside = join(TEST_RUNTIME_PARENT, `start-quarantine-${mode}-${randomUUID()}.txt`);
    await writeFile(outside, "outside-sentinel\n", "utf8");
    await assert.rejects(() => startDashboard({
      workspace: fixture.workspace,
      goalId: fixture.goalId,
      host: fixture.host,
      port: fixture.port,
      allowRemote: false,
    }, {
      inspectProcessObservation: () => ({ status: "absent" }),
      beforeCleanupQuarantine() {
        rmSync(targetPath);
        if (mode.endsWith("symlink")) symlinkSync(outside, targetPath);
        else writeFileSync(targetPath, `${mode}-replacement\n`);
      },
    }), undefined, mode);
    if (mode.endsWith("symlink")) {
      assert.equal((await lstat(targetPath)).isSymbolicLink(), true, mode);
      assert.equal(await readFile(outside, "utf8"), "outside-sentinel\n", mode);
    } else {
      assert.equal(await readFile(targetPath, "utf8"), `${mode}-replacement\n`, mode);
    }
    const counterpart = mode.startsWith("descriptor")
      ? fixture.descriptor.log_path
      : fixture.descriptorPath;
    assert.deepEqual(
      await readFile(counterpart),
      mode.startsWith("descriptor") ? logBytes : descriptorBytes,
      `${mode} counterpart`,
    );
  }
});

test("stop refuses nonregular or unowned cleanup targets and preserves them", async () => {
  for (const mode of ["descriptor-directory", "log-directory", "unowned-log"]) {
    const fixture = await writeDescriptorFixture();
    if (mode === "descriptor-directory") {
      await rm(fixture.descriptorPath);
      await mkdir(fixture.descriptorPath);
    }
    if (mode === "log-directory") {
      await rm(fixture.descriptor.log_path);
      await mkdir(fixture.descriptor.log_path);
    }
    if (mode === "unowned-log") {
      const descriptor = structuredClone(fixture.descriptor);
      descriptor.log_path = join(dirname(descriptor.log_path), "other.log");
      await writeJson(fixture.descriptorPath, descriptor);
    }
    const before = await descriptorAndRuntimeSnapshot(fixture);
    await assert.rejects(() => stopDashboard(stopOptions(fixture)), undefined, mode);
    assert.equal(inspectProcessIdentity(fixture.child.pid)?.pid, fixture.child.pid, mode);
    assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before, mode);
  }
});

test("stop CLI returns deterministic not_found receipt for an exact absent target", async () => {
  const workspace = await mkdtemp(join(await realpath(tmpdir()), "zcode-dashboard-stop-missing-"));
  TEMPORARY_PATHS.add(workspace);
  const beforeWorkspace = await snapshotPath(workspace);
  const beforeRuntime = await snapshotPath(DEFAULT_RUNTIME_DIRECTORY);
  const token = randomUUID();
  const result = runNode(STOP_DASHBOARD, [
    workspace,
    "--goal",
    "g1",
    "--descriptor-token",
    token,
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    contract: "ZCODE_DASHBOARD_STOP_RECEIPT_V1",
    status: "not_found",
    workspace_root: await realpath(workspace),
    goal_id: "g1",
    host: "127.0.0.1",
    port: 57357,
  });
  assert.deepEqual(await snapshotPath(workspace), beforeWorkspace);
  assert.deepEqual(await snapshotPath(DEFAULT_RUNTIME_DIRECTORY), beforeRuntime);
});

test("status rejects identity and PID-reuse mismatch without cleanup", async () => {
  const fixture = await writeDescriptorFixture({ process_identity: { start_marker: "wrong-marker" } });
  const before = await descriptorAndRuntimeSnapshot(fixture);
  const payload = await runStatus(fixture, () => ({
    ...fixture.descriptor.process_identity,
    start_marker: fixture.identity.start_marker,
  }));
  assert.equal(payload.status, "identity_mismatch");
  assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before);
});

test("status reports stopped for a vanished process without cleanup", async () => {
  const fixture = await writeDescriptorFixture();
  await stopChild(fixture.child);
  const before = await descriptorAndRuntimeSnapshot(fixture);
  const payload = await runStatus(fixture);
  assert.equal(payload.status, "stopped");
  assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before);
});

test("status reports running only when identity health runtime URL and Goal source bind", async () => {
  const data = await createDashboardWorkspace("goal-running");
  const processFixture = await startSleepProcess("running");
  const port = await reservePort();
  const server = await startHealthServer({
    runtime: runtimeId(data.workspace, data.goalId, "127.0.0.1", port),
    source: sourceId(data.workspace, data.goalId),
    workspace: canonicalPath(data.workspace),
    goalId: data.goalId,
    port,
  });
  const fixture = await writeDescriptorFixture({}, { data, processFixture, port });
  try {
    const before = await descriptorAndRuntimeSnapshot(fixture);
    const payload = await runStatus(fixture, () => fixture.descriptor.process_identity);
    assert.equal(payload.status, "running");
    assert.equal(payload.descriptor_token, fixture.descriptor.descriptor_token);
    assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before);
  } finally {
    await closeServer(server);
  }
});

test("status requires exact catalog workspace and goal fields without cleanup", async () => {
  for (const mode of ["workspace-missing", "workspace-wrong", "goal-missing", "goal-wrong"]) {
    const data = await createDashboardWorkspace(`goal-catalog-${mode}`);
    const processFixture = await startSleepProcess(`catalog-${mode}`);
    const port = await reservePort();
    const server = await startHealthServer({
      runtime: runtimeId(data.workspace, data.goalId, "127.0.0.1", port),
      source: sourceId(data.workspace, data.goalId),
      workspace: mode === "workspace-missing"
        ? undefined
        : mode === "workspace-wrong" ? `${canonicalPath(data.workspace)}-wrong` : canonicalPath(data.workspace),
      goalId: mode === "goal-missing"
        ? undefined
        : mode === "goal-wrong" ? `${data.goalId}-wrong` : data.goalId,
      port,
    });
    const fixture = await writeDescriptorFixture({}, { data, processFixture, port });
    try {
      const before = await descriptorAndRuntimeSnapshot(fixture);
      const payload = await runStatus(fixture, () => fixture.descriptor.process_identity);
      assert.equal(payload.status, "identity_mismatch", mode);
      assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before, mode);
    } finally {
      await closeServer(server);
    }
  }
});

test("status rejects a descriptor whose plan is no longer the Goal active plan", async () => {
  const data = await createDashboardWorkspace("goal-active-plan");
  const processFixture = await startSleepProcess("active-plan");
  const port = await reservePort();
  const server = await startHealthServer({
    runtime: runtimeId(data.workspace, data.goalId, "127.0.0.1", port),
    source: sourceId(data.workspace, data.goalId),
    workspace: canonicalPath(data.workspace),
    goalId: data.goalId,
    port,
  });
  const fixture = await writeDescriptorFixture({}, { data, processFixture, port });
  const goalState = JSON.parse(await readFile(data.goalStatePath, "utf8"));
  goalState.active_plan_path = join(data.goalDirectory, "other-plan.json");
  await writeJson(data.goalStatePath, goalState);
  try {
    const before = await descriptorAndRuntimeSnapshot(fixture);
    const payload = await runStatus(fixture, () => fixture.descriptor.process_identity);
    assert.equal(payload.status, "identity_mismatch");
    assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before);
  } finally {
    await closeServer(server);
  }
});

test("status reports ambiguous for duplicate matching catalog sources without cleanup", async () => {
  const data = await createDashboardWorkspace("goal-ambiguous");
  const processFixture = await startSleepProcess("ambiguous");
  const port = await reservePort();
  const server = await startHealthServer({
    runtime: runtimeId(data.workspace, data.goalId, "127.0.0.1", port),
    source: sourceId(data.workspace, data.goalId),
    workspace: canonicalPath(data.workspace),
    goalId: data.goalId,
    sourceCount: 2,
    port,
  });
  const fixture = await writeDescriptorFixture({}, { data, processFixture, port });
  try {
    const before = await descriptorAndRuntimeSnapshot(fixture);
    const payload = await runStatus(fixture, () => fixture.descriptor.process_identity);
    assert.equal(payload.status, "ambiguous");
    assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before);
  } finally {
    await closeServer(server);
  }
});

test("status reports unhealthy for health failure without cleanup", async () => {
  const data = await createDashboardWorkspace("goal-unhealthy");
  const processFixture = await startSleepProcess("unhealthy");
  const server = await startHealthServer({ runtime: "0".repeat(20), source: sourceId(data.workspace, data.goalId), healthStatus: "failed" });
  const address = server.address();
  assert.equal(typeof address, "object");
  const fixture = await writeDescriptorFixture({}, { data, processFixture, port: address.port });
  try {
    const before = await descriptorAndRuntimeSnapshot(fixture);
    const payload = await runStatus(fixture, () => fixture.descriptor.process_identity);
    assert.equal(payload.status, "unhealthy");
    assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before);
  } finally {
    await closeServer(server);
  }
});

test("status reports identity mismatch for wrong health runtime or Goal source", async () => {
  for (const mode of ["runtime", "source"]) {
    const data = await createDashboardWorkspace(`goal-${mode}`);
    const processFixture = await startSleepProcess(mode);
    const expectedSource = sourceId(data.workspace, data.goalId);
    const server = await startHealthServer({
      runtime: mode === "runtime" ? "f".repeat(20) : "placeholder",
      source: expectedSource,
      includeSource: mode !== "source",
    });
    const address = server.address();
    assert.equal(typeof address, "object");
    const fixture = await writeDescriptorFixture({}, { data, processFixture, port: address.port });
    try {
      const before = await descriptorAndRuntimeSnapshot(fixture);
      const payload = await runStatus(fixture, () => fixture.descriptor.process_identity);
      assert.equal(payload.status, "identity_mismatch", mode);
      assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before);
    } finally {
      await closeServer(server);
    }
  }
});

test("status rejects malformed JSON unknown fields symlinks nonregular files and unsafe ancestors without writes", async () => {
  const base = await createDashboardWorkspace("goal-invalid");
  const host = "127.0.0.1";
  const cases = [
    {
      name: "malformed JSON",
      setup: async (path) => writeFile(path, "{bad", "utf8"),
    },
    {
      name: "unknown descriptor field",
      setup: async (path) => {
        const processFixture = await startSleepProcess("unknown-field");
        await writeJson(path, { ...descriptorFor({ data: base, host, port: 49101, pid: processFixture.child.pid, identity: processFixture.identity }), extra: true });
      },
    },
    {
      name: "descriptor symlink",
      setup: async (path) => {
        const target = `${path}.target`;
        await writeFile(target, "{}\n", "utf8");
        await symlink(target, path);
      },
    },
    {
      name: "descriptor directory",
      setup: async (path) => mkdir(path),
    },
    {
      name: "unsafe ancestor symlink",
      setupRuntime: async (runtimeRoot) => {
        const outside = await mkdtemp(join(tmpdir(), "zcode-dashboard-outside-"));
        TEMPORARY_PATHS.add(outside);
        await writeFile(join(outside, "outside-sentinel.txt"), "outside-sentinel\n", "utf8");
        await rm(runtimeRoot, { recursive: true, force: true });
        await symlink(outside, runtimeRoot);
      },
    },
  ];
  for (let index = 0; index < cases.length; index += 1) {
    const testCase = cases[index];
    const port = 49100 + index;
    const descriptorPath = dashboardDescriptorPath(base.workspace, base.goalId, host, port);
    const runtimeRoot = dirname(descriptorPath);
    await rm(runtimeRoot, { recursive: true, force: true });
    await mkdir(runtimeRoot, { recursive: true, mode: 0o700 });
    if (testCase.setupRuntime) await testCase.setupRuntime(runtimeRoot, descriptorPath);
    else await testCase.setup(descriptorPath);
    const fixture = { ...base, host, port, descriptorPath };
    const before = await descriptorAndRuntimeSnapshot(fixture);
    const payload = await runStatus(fixture);
    assert.equal(payload.status, "invalid_descriptor", testCase.name);
    assert.deepEqual(await descriptorAndRuntimeSnapshot(fixture), before, testCase.name);
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});
