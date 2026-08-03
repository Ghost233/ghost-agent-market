#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { get } from "node:http";
import { connect } from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupDashboardOwnedEntries,
  createDashboardDescriptorV2,
  dashboardRuntimeDirectory,
  dashboardRuntimeIdFor,
  dashboardSourceId,
  expectedDashboardArgv,
  inspectProcessIdentity,
  parseDashboardDescriptorV2,
  processIdentityMatches,
  processObservationInspector,
  validateDashboardRuntimeDirectory,
  writeDashboardDescriptorAtomic,
} from "./dashboard-lifecycle.mjs";

const CONTRACT = "ZCODE_DASHBOARD_START_RECEIPT_V2";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

class StartError extends Error {}
class StartConflict extends StartError {
  constructor(payload, message = "dashboard start conflicts with tracked state") {
    super(message);
    this.payload = payload;
  }
}

function parseArgs(argv) {
  const options = {
    workspace: null,
    goalId: null,
    host: "127.0.0.1",
    port: 57357,
    allowRemote: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--allow-remote") {
      options.allowRemote = true;
      continue;
    }
    if (value === "--goal" || value === "--host" || value === "--port") {
      const argument = argv[index + 1];
      if (argument === undefined || argument.startsWith("--")) {
        throw new StartError(`${value} requires a value`);
      }
      if (value === "--goal") options.goalId = argument;
      if (value === "--host") options.host = argument;
      if (value === "--port") options.port = Number(argument);
      index += 1;
      continue;
    }
    if (value.startsWith("--")) throw new StartError(`unknown option: ${value}`);
    if (options.workspace !== null) {
      throw new StartError("expected exactly one workspace directory");
    }
    options.workspace = value;
  }
  if (options.workspace === null) {
    throw new StartError(
      "usage: start-dashboard.mjs <workspace> [--goal <goal-id>] [--host <host>] [--port <port>] [--allow-remote]",
    );
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new StartError("--port must be an integer from 1 to 65535");
  }
  if (!/^[A-Za-z0-9.:[\]-]+$/u.test(options.host)) {
    throw new StartError(`--host is invalid: ${options.host}`);
  }
  const loopback = LOOPBACK_HOSTS.has(options.host) || options.host.startsWith("127.");
  if (!loopback && !options.allowRemote) {
    throw new StartError("non-loopback --host requires explicit --allow-remote");
  }
  return options;
}

function readJson(path, label = path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new StartError(`cannot read JSON from ${label}: ${error.message}`);
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new StartError(`expected a JSON object in ${label}`);
  }
  return parsed;
}

function isWithin(root, candidate) {
  const offset = relative(root, candidate);
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function findGoalFiles(runtimeRoot) {
  const found = [];
  const queue = [runtimeRoot];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(current, entry.name);
      if (entry.isFile() && entry.name === "goal.json") {
        found.push(path);
      } else if (entry.isDirectory() && entry.name !== "owners") {
        queue.push(path);
      }
    }
  }
  return found.sort();
}

function normalizeWorkspaceAlias(path) {
  const absolute = resolve(path);
  return process.platform === "darwin" && absolute.startsWith("/var/")
    ? `/private${absolute}`
    : absolute;
}

function workspaceRootFromGoal(goal, goalPath) {
  const configured = goal.workspace;
  if (configured === null || Array.isArray(configured) || typeof configured !== "object") {
    throw new StartError(`goal workspace is invalid: ${goalPath}`);
  }
  if (typeof configured.root !== "string" || configured.root.length === 0) {
    throw new StartError(`goal workspace.root is invalid: ${goalPath}`);
  }
  return resolve(configured.root);
}

function dashboardCandidate(goalPath, workspaceRoot, runtimeRoot) {
  const goal = readJson(goalPath);
  if (goal.contract !== "GOAL_CONTRACT_V1") {
    throw new StartError(`unexpected goal contract: ${goalPath}`);
  }
  if (typeof goal.goal_id !== "string" || goal.goal_id.length === 0) {
    throw new StartError(`goal is missing goal_id: ${goalPath}`);
  }
  const goalWorkspaceRoot = workspaceRootFromGoal(goal, goalPath);
  if (normalizeWorkspaceAlias(goalWorkspaceRoot) !== normalizeWorkspaceAlias(workspaceRoot)) {
    throw new StartError(`goal belongs to a different workspace: ${goalPath}`);
  }
  const goalDirectory = dirname(goalPath);
  if (!isWithin(runtimeRoot, goalDirectory)) {
    throw new StartError(`goal directory escapes .ghost-agent-workflow: ${goalPath}`);
  }
  const goalStatePath = join(goalDirectory, "goal-state.json");
  if (!existsSync(goalStatePath)) {
    throw new StartError(`goal is not activated; missing ${goalStatePath}`);
  }
  const goalState = readJson(goalStatePath);
  if (goalState.contract !== "GOAL_STATE_V1") {
    throw new StartError(`unexpected goal state contract: ${goalStatePath}`);
  }
  if (goalState.status !== "active" && goalState.status !== "completed") {
    throw new StartError(`goal state status is invalid: ${goalStatePath}`);
  }
  if (typeof goalState.active_plan_path !== "string" || goalState.active_plan_path.length === 0) {
    throw new StartError(`goal has no active plan: ${goalStatePath}`);
  }
  const configuredPlanPath = resolve(goalState.active_plan_path);
  const expectedPlanPath = join(goalDirectory, "plan.json");
  if (!existsSync(configuredPlanPath)) {
    throw new StartError(`plan file does not exist: ${configuredPlanPath}`);
  }
  const planPath = configuredPlanPath;
  if (
    normalizeWorkspaceAlias(planPath) !== normalizeWorkspaceAlias(expectedPlanPath)
    || !isWithin(normalizeWorkspaceAlias(runtimeRoot), normalizeWorkspaceAlias(planPath))
  ) {
    throw new StartError(`active plan must equal ${expectedPlanPath}`);
  }
  const configuredStatePath = join(goalDirectory, "state.json");
  if (!existsSync(configuredStatePath)) {
    throw new StartError(`state file does not exist: ${configuredStatePath}`);
  }
  const statePath = configuredStatePath;
  const plan = readJson(planPath);
  const state = readJson(statePath);
  if (plan.contract !== "DAG_PLAN_V5") {
    throw new StartError(`unexpected plan contract: ${planPath}`);
  }
  if (state.contract !== "DAG_RUN_STATE_V5") {
    throw new StartError(`unexpected state contract: ${statePath}`);
  }
  if (plan.goal_id !== goal.goal_id) {
    throw new StartError(`plan goal_id does not match ${goalPath}`);
  }
  if (
    typeof plan.goal_contract_path !== "string"
    || !existsSync(plan.goal_contract_path)
    || normalizeWorkspaceAlias(plan.goal_contract_path) !== normalizeWorkspaceAlias(goalPath)
  ) {
    throw new StartError(`plan goal_contract_path does not match ${goalPath}`);
  }
  if (state.plan_digest !== sha256File(planPath)) {
    throw new StartError(`state does not match plan: ${statePath}`);
  }
  return {
    goalId: goal.goal_id,
    goalStatus: goalState.status,
    goalPath: normalizeWorkspaceAlias(goalPath),
    goalStatePath: normalizeWorkspaceAlias(goalStatePath),
    planPath: normalizeWorkspaceAlias(planPath),
    statePath: normalizeWorkspaceAlias(statePath),
    lifecyclePath: normalizeWorkspaceAlias(join(goalDirectory, "dashboard.json")),
  };
}

function discoverDashboardData(workspaceArgument, requestedGoalId = null) {
  const workspacePath = resolve(workspaceArgument);
  if (!existsSync(workspacePath)) {
    throw new StartError(`workspace does not exist: ${workspacePath}`);
  }
  const workspaceRoot = workspacePath;
  const runtimePath = join(workspaceRoot, ".ghost-agent-workflow");
  if (!existsSync(runtimePath)) {
    throw new StartError(`workflow directory does not exist: ${runtimePath}`);
  }
  const runtimeRoot = runtimePath;
  const goalFiles = findGoalFiles(runtimeRoot);
  if (goalFiles.length === 0) {
    throw new StartError(`no goal.json found under ${runtimeRoot}`);
  }
  const candidates = [];
  const problems = [];
  for (const goalPath of goalFiles) {
    let goalId = null;
    try {
      const raw = readJson(goalPath);
      goalId = typeof raw.goal_id === "string" ? raw.goal_id : null;
      candidates.push(dashboardCandidate(goalPath, workspaceRoot, runtimeRoot));
    } catch (error) {
      problems.push({ goalId, message: error.message });
    }
  }
  if (requestedGoalId !== null) {
    const matches = candidates.filter((candidate) => candidate.goalId === requestedGoalId);
    if (matches.length === 1) return { workspaceRoot, runtimeRoot, ...matches[0] };
    if (matches.length > 1) {
      throw new StartError(`multiple dashboard-ready goals use id ${requestedGoalId}`);
    }
    const matchingProblem = problems.find((problem) => problem.goalId === requestedGoalId);
    if (matchingProblem) throw new StartError(matchingProblem.message);
    throw new StartError(`goal ${requestedGoalId} was not found under ${runtimeRoot}`);
  }
  const active = candidates.filter((candidate) => candidate.goalStatus === "active");
  if (active.length === 1) return { workspaceRoot, runtimeRoot, ...active[0] };
  const selectable = active.length > 0 ? active : candidates;
  if (selectable.length === 1) return { workspaceRoot, runtimeRoot, ...selectable[0] };
  if (selectable.length > 1) {
    throw new StartError(
      `multiple dashboard-ready goals found (${selectable.map(({ goalId }) => goalId).join(", ")}); pass --goal <goal-id>`,
    );
  }
  const detail = problems.length > 0 ? `: ${problems[0].message}` : "";
  throw new StartError(`no dashboard-ready goal found under ${runtimeRoot}${detail}`);
}

function displayUrl(host, port) {
  const renderedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${renderedHost}:${port}/`;
}

function probeUrl(host, port) {
  if (host === "0.0.0.0") return displayUrl("127.0.0.1", port);
  if (host === "::") return displayUrl("::1", port);
  return displayUrl(host, port);
}

function requestJson(url, timeoutMs) {
  return new Promise((resolveRequest) => {
    const request = get(url, { headers: { Accept: "application/json" } }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size <= 1_048_576) chunks.push(chunk);
      });
      response.on("end", () => {
        if ((response.statusCode ?? 500) >= 400 || size > 1_048_576) {
          resolveRequest(null);
          return;
        }
        try {
          resolveRequest(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          resolveRequest(null);
        }
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("request timed out")));
    request.on("error", () => resolveRequest(null));
  });
}

async function probeDashboard(baseUrl, descriptor) {
  const [health, catalog] = await Promise.all([
    requestJson(new URL("healthz", baseUrl), 500),
    requestJson(new URL("api/catalog", baseUrl), 800),
  ]);
  if (
    health?.contract !== "DAG_DASHBOARD_HEALTH_V2"
    || health?.status !== "ok"
    || health.leader_runtime_id !== descriptor.runtime_id
    || catalog?.contract !== "DAG_DASHBOARD_CATALOG_V1"
    || catalog.leader_runtime_id !== descriptor.runtime_id
    || !Array.isArray(catalog.sources)
  ) {
    return false;
  }
  const matches = catalog.sources.filter((source) => source?.id === descriptor.source_id);
  if (matches.length !== 1) return false;
  const source = matches[0];
  return typeof source.workspace === "string"
    && normalizeWorkspaceAlias(source.workspace) === normalizeWorkspaceAlias(descriptor.workspace_root)
    && source.goal_id === descriptor.goal_id;
}

function portIsOccupied(host, port, timeoutMs = 500) {
  const connectHost = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  return new Promise((resolveOccupied) => {
    const socket = connect({ host: connectHost, port });
    let settled = false;
    const finish = (occupied) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveOccupied(occupied);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function safeTargetMetadata(path, label) {
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new StartError(`${label} must be a regular non-symlink file: ${path}`);
  }
  return metadata;
}

function fsyncRuntimeDirectory(path) {
  const descriptor = openSync(
    path,
    fsConstants.O_RDONLY
      | (fsConstants.O_DIRECTORY ?? 0)
      | (fsConstants.O_NOFOLLOW ?? 0)
      | (fsConstants.O_CLOEXEC ?? 0),
  );
  try {
    if (!fstatSync(descriptor).isDirectory()) {
      throw new StartError(`dashboard runtime directory is not a directory: ${path}`);
    }
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function removeOwnedFilesIfPresent(paths, runtimeDirectory) {
  const existing = paths.filter(([path, label]) => safeTargetMetadata(path, label) !== null);
  if (existing.length === 0) return;
  for (const [path] of existing) unlinkSync(path);
  fsyncRuntimeDirectory(runtimeDirectory);
}

function createDashboardLog(path) {
  safeTargetMetadata(path, "dashboard log");
  const descriptor = openSync(
    path,
    fsConstants.O_WRONLY
      | fsConstants.O_CREAT
      | fsConstants.O_EXCL
      | (fsConstants.O_NOFOLLOW ?? 0)
      | (fsConstants.O_CLOEXEC ?? 0),
    0o600,
  );
  if (!fstatSync(descriptor).isFile()) {
    closeSync(descriptor);
    throw new StartError(`dashboard log target is not a regular file: ${path}`);
  }
  return descriptor;
}

function trackedDashboardDescriptors(runtimeDirectory) {
  return readdirSync(runtimeDirectory, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith(".json"))
    .map((entry) => ({
      path: join(runtimeDirectory, entry.name),
      regular: entry.isFile() && !entry.isSymbolicLink(),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function readTrackedDescriptor(path) {
  safeTargetMetadata(path, "dashboard descriptor");
  let descriptor;
  try {
    descriptor = openSync(
      path,
      fsConstants.O_RDONLY
        | (fsConstants.O_NOFOLLOW ?? 0)
        | (fsConstants.O_CLOEXEC ?? 0)
        | (fsConstants.O_NONBLOCK ?? 0),
    );
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size > 1024 * 1024) {
      throw new StartError(`dashboard descriptor must be a bounded regular file: ${path}`);
    }
    const parsed = JSON.parse(readFileSync(descriptor, "utf8"));
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new StartError(`expected a JSON object in dashboard descriptor: ${path}`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof StartError) throw error;
    throw new StartError(`cannot safely read dashboard descriptor ${path}: ${error.message}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function descriptorMatchesDiscoveredData(descriptor, data) {
  return descriptor.workspace_root === data.workspaceRoot
    && descriptor.workflow_root === data.runtimeRoot
    && descriptor.goal_id === data.goalId
    && descriptor.goal_path === data.goalPath
    && descriptor.plan_path === data.planPath
    && descriptor.state_path === data.statePath
    && descriptor.lifecycle_path === data.lifecyclePath;
}

function responsePayload(status, data, descriptor, descriptorPath, role = "leader") {
  const sourceQuery = `source=${encodeURIComponent(descriptor.source_id)}`;
  return {
    contract: CONTRACT,
    status,
    url: descriptor.url,
    pid: descriptor.pid,
    log_path: descriptor.log_path,
    descriptor_path: descriptorPath,
    descriptor_token: descriptor.descriptor_token,
    runtime_id: descriptor.runtime_id,
    role,
    source_id: descriptor.source_id,
    workspace_root: data.workspaceRoot,
    workflow_root: data.runtimeRoot,
    goal_id: data.goalId,
    host: descriptor.host,
    port: descriptor.port,
    plan_path: data.planPath,
    state_path: data.statePath,
    progress_document_path: join(dirname(data.planPath), "progress.json"),
    progress_document_url: `${descriptor.url}api/progress-document?${sourceQuery}`,
    progress_events_path: join(dirname(data.planPath), "events.jsonl"),
    progress_events_url: `${descriptor.url}api/progress-events?${sourceQuery}`,
    live_updates_url: `${descriptor.url}api/live?${sourceQuery}`,
    read_only: true,
  };
}

function conflictPayload(data, options, descriptorPath) {
  return {
    contract: CONTRACT,
    status: "conflict",
    workspace_root: data.workspaceRoot,
    goal_id: data.goalId,
    host: options.host,
    port: options.port,
    descriptor_path: descriptorPath,
  };
}

async function spawnDetached(command, args, options) {
  const child = spawn(command, args, options);
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once("spawn", resolveSpawn);
    child.once("error", rejectSpawn);
  });
  child.unref();
  return child;
}

async function startDashboard(options, dependencies = {}) {
  const inspectIdentity = dependencies.inspectProcessIdentity ?? inspectProcessIdentity;
  const observationInspector = processObservationInspector(dependencies);
  const data = discoverDashboardData(options.workspace, options.goalId);
  const localDriverPath = join(dirname(fileURLToPath(import.meta.url)), "goal-dag.mjs");
  const publishedDriverPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../zcode-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs",
  );
  const driverPath = existsSync(localDriverPath) ? localDriverPath : publishedDriverPath;
  if (!existsSync(driverPath)) throw new StartError(`Goal DAG driver is missing: ${driverPath}`);

  const publicUrl = displayUrl(options.host, options.port);
  const healthUrl = probeUrl(options.host, options.port);
  const sourceId = dashboardSourceId(workspaceRootFromGoal(readJson(data.goalPath), data.goalPath), data.goalId);
  const runtimeId = dashboardRuntimeIdFor(
    data.workspaceRoot,
    data.goalId,
    options.host,
    options.port,
  );
  const requestedRuntimeDirectory = dashboardRuntimeDirectory();
  let runtimeDirectory = validateDashboardRuntimeDirectory(
    requestedRuntimeDirectory,
    { allowMissing: true },
  );
  const descriptorPath = join(requestedRuntimeDirectory, `${runtimeId}.json`);
  const logPath = join(requestedRuntimeDirectory, `${runtimeId}.log`);
  const probe = dependencies.probeDashboard ?? probeDashboard;
  const occupied = dependencies.portIsOccupied ?? portIsOccupied;

  for (const trackedEntry of runtimeDirectory === null ? [] : trackedDashboardDescriptors(runtimeDirectory)) {
    const trackedPath = trackedEntry.path;
    let tracked;
    try {
      if (!trackedEntry.regular) throw new Error("descriptor directory entry is not regular");
      tracked = parseDashboardDescriptorV2(readTrackedDescriptor(trackedPath), {
        driverPath,
      });
    } catch {
      if (trackedPath !== descriptorPath) {
        try {
          const raw = readTrackedDescriptor(trackedPath);
          const claimsRequestedTarget = raw.host === options.host
            && raw.port === options.port
            && Number.isInteger(raw.pid)
            && raw.pid > 0;
          if (!claimsRequestedTarget) continue;
          const claimantObservation = observationInspector(raw.pid);
          if (claimantObservation.status === "absent") continue;
        } catch {
          continue;
        }
      }
      throw new StartConflict(
        conflictPayload(data, options, trackedPath),
        `dashboard runtime contains an invalid descriptor ${trackedPath}`,
      );
    }
    if (tracked.host !== options.host || tracked.port !== options.port) continue;
    if (trackedPath !== descriptorPath || !descriptorMatchesDiscoveredData(tracked, data)) {
      throw new StartConflict(
        conflictPayload(data, options, trackedPath),
        `dashboard port ${options.host}:${options.port} is tracked by a different Goal`,
      );
    }
    const observed = observationInspector(tracked.pid);
    if (observed.status === "absent") {
      try {
        cleanupDashboardOwnedEntries({
          descriptorPath: trackedPath,
          descriptorToken: tracked.descriptor_token,
          logPath: tracked.log_path,
          beforeQuarantine: dependencies.beforeCleanupQuarantine ?? null,
        });
      } catch (error) {
        throw new StartConflict(
          conflictPayload(data, options, trackedPath),
          error instanceof Error ? error.message : String(error),
        );
      }
      continue;
    }
    if (observed.status === "unknown") {
      throw new StartConflict(
        conflictPayload(data, options, trackedPath),
        `dashboard ${trackedPath} process observation is ambiguous`,
      );
    }
    if (!processIdentityMatches(tracked.process_identity, observed.identity)) {
      throw new StartConflict(
        conflictPayload(data, options, trackedPath),
        `dashboard ${trackedPath} process identity does not match`,
      );
    }
    if (!await probe(healthUrl, tracked)) {
      throw new StartConflict(
        conflictPayload(data, options, trackedPath),
        `tracked dashboard ${trackedPath} is not healthy`,
      );
    }
    return responsePayload("already_running", data, tracked, trackedPath);
  }

  if (await occupied(options.host, options.port)) {
    throw new StartConflict(
      conflictPayload(data, options, descriptorPath),
      `dashboard port ${options.host}:${options.port} is occupied without an exact descriptor`,
    );
  }

  runtimeDirectory = validateDashboardRuntimeDirectory(
    requestedRuntimeDirectory,
    { create: true },
  );
  const command = [
    driverPath,
    ...expectedDashboardArgv(data, options, runtimeId),
  ];
  const environment = { ...process.env };
  delete environment.GOAL_DAG_EXECUTION_PLATFORM;
  const logFile = createDashboardLog(logPath);
  let child;
  try {
    child = await spawnDetached(process.execPath, command, {
      cwd: data.workspaceRoot,
      detached: true,
      env: environment,
      stdio: ["ignore", logFile, logFile],
    });
  } catch (error) {
    try {
      removeOwnedFilesIfPresent([[logPath, "dashboard log"]], runtimeDirectory);
    } catch {}
    throw new StartError(`cannot start dashboard: ${error.message}`);
  } finally {
    closeSync(logFile);
  }
  let processIdentity = null;
  const identityAttempts = dependencies.identityAttempts ?? 40;
  const identityDelayMs = dependencies.identityDelayMs ?? 25;
  for (let attempt = 0; attempt < identityAttempts && processIdentity === null; attempt += 1) {
    processIdentity = inspectIdentity(child.pid);
    if (processIdentity === null) await delay(identityDelayMs);
  }
  if (processIdentity === null) {
    throw new StartError("cannot inspect the spawned dashboard process identity");
  }
  const descriptorPayload = createDashboardDescriptorV2({
    data,
    options,
    runtimeId,
    sourceId,
    driverPath,
    pid: child.pid,
    processIdentity,
    url: publicUrl,
    logPath,
  });
  writeDashboardDescriptorAtomic(
    descriptorPath,
    `${JSON.stringify(descriptorPayload, null, 2)}\n`,
  );

  const startupAttempts = dependencies.startupAttempts ?? 80;
  const startupDelayMs = dependencies.startupDelayMs ?? 100;
  for (let attempt = 0; attempt < startupAttempts; attempt += 1) {
    if (await probe(healthUrl, descriptorPayload)) {
      return responsePayload("started", data, descriptorPayload, descriptorPath);
    }
    if (!pidIsAlive(child.pid)) {
      try {
        cleanupDashboardOwnedEntries({
          descriptorPath,
          descriptorToken: descriptorPayload.descriptor_token,
          logPath,
          beforeQuarantine: dependencies.beforeCleanupQuarantine ?? null,
        });
      } catch {}
      throw new StartError("dashboard exited during startup");
    }
    await delay(startupDelayMs);
  }
  const observedBeforeSignal = observationInspector(child.pid);
  if (
    observedBeforeSignal.status === "present"
    && processIdentityMatches(processIdentity, observedBeforeSignal.identity)
  ) {
    try { process.kill(child.pid, "SIGTERM"); } catch {}
    const shutdownTimeoutMs = dependencies.shutdownTimeoutMs ?? 2_000;
    const deadline = Date.now() + shutdownTimeoutMs;
    let observedAfterSignal = observationInspector(child.pid);
    while (
      Date.now() < deadline
      && (
        (observedAfterSignal.status === "present"
          && processIdentityMatches(processIdentity, observedAfterSignal.identity))
        || observedAfterSignal.status === "unknown"
      )
    ) {
      await delay(25);
      observedAfterSignal = observationInspector(child.pid);
    }
    if (
      observedAfterSignal.status === "absent"
      || (observedAfterSignal.status === "present"
        && !processIdentityMatches(processIdentity, observedAfterSignal.identity))
    ) {
      try {
        cleanupDashboardOwnedEntries({
          descriptorPath,
          descriptorToken: descriptorPayload.descriptor_token,
          logPath,
          beforeQuarantine: dependencies.beforeCleanupQuarantine ?? null,
        });
      } catch {}
    }
  }
  throw new StartError(`dashboard did not become healthy; see ${logPath}`);
}

async function main() {
  try {
    const payload = await startDashboard(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } catch (error) {
    if (error instanceof StartConflict) {
      process.stdout.write(`${JSON.stringify(error.payload)}\n`);
      process.exitCode = 2;
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({ contract: CONTRACT, status: "error", error: message })}\n`);
    process.exitCode = 1;
  }
}

const currentPath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && resolve(process.argv[1]) === currentPath) {
  await main();
}

export { StartConflict, StartError, discoverDashboardData, parseArgs, startDashboard };
