#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONTRACT = "DAG_DASHBOARD_START_V1";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

class StartError extends Error {}

function parseArgs(argv) {
  const options = {
    workspace: null,
    goalId: null,
    host: "127.0.0.1",
    port: 57357,
    allowRemote: false,
    expertId: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--allow-remote") {
      options.allowRemote = true;
      continue;
    }
    if (value === "--expert-id") {
      const argument = argv[index + 1];
      if (argument === undefined || argument.startsWith("--")) {
        throw new StartError("--expert-id requires a value");
      }
      options.expertId = argument;
      index += 1;
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
  if (workspaceRootFromGoal(goal, goalPath) !== workspaceRoot) {
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
  if (planPath !== expectedPlanPath || !isWithin(runtimeRoot, planPath)) {
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
    || resolve(plan.goal_contract_path) !== goalPath
  ) {
    throw new StartError(`plan goal_contract_path does not match ${goalPath}`);
  }
  if (state.plan_digest !== sha256File(planPath)) {
    throw new StartError(`state does not match plan: ${statePath}`);
  }
  return {
    goalId: goal.goal_id,
    goalStatus: goalState.status,
    goalPath,
    goalStatePath,
    planPath,
    statePath,
    lifecyclePath: join(goalDirectory, "dashboard.json"),
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

async function probeDashboard(baseUrl, sourceId) {
  const [health, catalog] = await Promise.all([
    requestJson(new URL("healthz", baseUrl), 500),
    requestJson(new URL("api/catalog", baseUrl), 800),
  ]);
  return health?.contract === "DAG_DASHBOARD_HEALTH_V2"
    && health?.status === "ok"
    && catalog?.contract === "DAG_DASHBOARD_CATALOG_V1"
    && Array.isArray(catalog.sources)
    && catalog.sources.some((source) => source?.id === sourceId);
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

function writeDescriptor(path, payload) {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}

function logTail(path, limit = 20) {
  try {
    return readFileSync(path, "utf8").split("\n").slice(-limit).join("\n").trim();
  } catch {
    return "";
  }
}

function removeTrackedFiles(runtimeDirectory, descriptorPath, descriptor) {
  rmSync(descriptorPath, { force: true });
  if (
    typeof descriptor?.log_path === "string"
    && dirname(resolve(descriptor.log_path)) === runtimeDirectory
  ) {
    rmSync(descriptor.log_path, { force: true });
  }
}

async function stopTrackedDashboard(runtimeDirectory, descriptorPath, descriptor) {
  const pid = descriptor?.pid;
  if (pidIsAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    for (let attempt = 0; attempt < 40 && pidIsAlive(pid); attempt += 1) {
      await delay(50);
    }
  }
  removeTrackedFiles(runtimeDirectory, descriptorPath, descriptor);
}

function trackedDashboardDescriptors(runtimeDirectory) {
  return readdirSync(runtimeDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => join(runtimeDirectory, entry.name))
    .sort();
}

function trackedParticipantIsValid(descriptor) {
  return typeof descriptor?.plan_path === "string"
    && typeof descriptor?.state_path === "string"
    && existsSync(resolve(descriptor.plan_path))
    && existsSync(resolve(descriptor.state_path));
}

function responsePayload(status, data, sourceId, url, pid, logPath, descriptorPath, role, expertId = null) {
  const sourceQuery = `source=${encodeURIComponent(sourceId)}`;
  return {
    contract: CONTRACT,
    status,
    url,
    pid,
    log_path: logPath,
    descriptor_path: descriptorPath,
    role,
    source_id: sourceId,
    expert_id: expertId,
    workspace_root: data.workspaceRoot,
    workflow_root: data.runtimeRoot,
    goal_id: data.goalId,
    plan_path: data.planPath,
    state_path: data.statePath,
    progress_document_path: join(dirname(data.planPath), "progress.json"),
    progress_document_url: `${url}api/progress-document?${sourceQuery}`,
    progress_events_path: join(dirname(data.planPath), "events.jsonl"),
    progress_events_url: `${url}api/progress-events?${sourceQuery}`,
    live_updates_url: `${url}api/live?${sourceQuery}`,
    read_only: true,
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

async function startDashboard(options) {
  const data = discoverDashboardData(options.workspace, options.goalId);
  const driverPath = join(dirname(fileURLToPath(import.meta.url)), "goal-dag.mjs");
  if (!existsSync(driverPath)) throw new StartError(`Goal DAG driver is missing: ${driverPath}`);

  // §4.5 治理锚定：若显式传入 --expert-id，则该后台进程必须归属一个已注册的
  // Dashboard 子类型专家（持有后台进程、不持有 writable scope）。注册表是权威源。
  if (options.expertId !== null) {
    const registryPath = join(data.runtimeRoot, "owners", "registry.json");
    if (!existsSync(registryPath)) {
      throw new StartError(`--expert-id ${options.expertId} given but no registry at ${registryPath}`);
    }
    const registry = readJson(registryPath);
    if (registry?.contract !== "EXPERT_REGISTRY_V2" || !Array.isArray(registry.owners)) {
      throw new StartError(`registry at ${registryPath} is not EXPERT_REGISTRY_V2`);
    }
    const expert = registry.owners.find((owner) => owner?.id === options.expertId);
    if (expert === undefined) {
      throw new StartError(`--expert-id ${options.expertId} is not a registered expert`);
    }
    if (expert.subtype !== "dashboard") {
      throw new StartError(`--expert-id ${options.expertId} is subtype ${expert.subtype}, not dashboard`);
    }
  }

  const publicUrl = displayUrl(options.host, options.port);
  const healthUrl = probeUrl(options.host, options.port);
  const sourceId = createHash("sha256")
    .update(`${data.workspaceRoot}\n${data.goalId}`)
    .digest("hex")
    .slice(0, 20);
  const identity = [data.workspaceRoot, data.goalId, options.host, options.port].join("\n");
  const runtimeId = createHash("sha256").update(identity).digest("hex").slice(0, 20);
  const runtimeDirectory = join(tmpdir(), "ghost-agent-workflow-dashboard");
  mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  const descriptorPath = join(runtimeDirectory, `${runtimeId}.json`);
  const logPath = join(runtimeDirectory, `${runtimeId}.log`);

  for (const trackedPath of trackedDashboardDescriptors(runtimeDirectory)) {
    let tracked = null;
    try {
      tracked = readJson(trackedPath);
    } catch {
      rmSync(trackedPath, { force: true });
      continue;
    }
    if (tracked.host !== options.host || tracked.port !== options.port) continue;
    if (!pidIsAlive(tracked.pid)) {
      removeTrackedFiles(runtimeDirectory, trackedPath, tracked);
      continue;
    }
    if (!trackedParticipantIsValid(tracked)) {
      await stopTrackedDashboard(runtimeDirectory, trackedPath, tracked);
      continue;
    }
    if (tracked.workspace_root === data.workspaceRoot && tracked.goal_id === data.goalId) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (await probeDashboard(healthUrl, sourceId)) {
          const health = await requestJson(new URL("healthz", healthUrl), 500);
          return responsePayload(
            "already_running",
            data,
            sourceId,
            publicUrl,
            tracked.pid,
            tracked.log_path,
            trackedPath,
            health?.leader_runtime_id === runtimeId ? "leader" : "participant",
            options.expertId,
          );
        }
        await delay(100);
      }
      await stopTrackedDashboard(runtimeDirectory, trackedPath, tracked);
    }
  }

  if (await probeDashboard(healthUrl, sourceId)) {
    const health = await requestJson(new URL("healthz", healthUrl), 500);
    return responsePayload(
      "already_running", data, sourceId, publicUrl, null, null, null,
      health?.leader_runtime_id === runtimeId ? "leader" : "participant",
      options.expertId,
    );
  }

  const command = [
    driverPath,
    "dashboard",
    data.planPath,
    data.statePath,
    "--host",
    options.host,
    "--port",
    String(options.port),
    "--runtime-id",
    runtimeId,
  ];
  if (existsSync(data.lifecyclePath)) {
    command.push("--lifecycle", data.lifecyclePath);
  }
  if (options.allowRemote) command.push("--allow-remote");
  const environment = { ...process.env };
  delete environment.GOAL_DAG_EXECUTION_PLATFORM;
  const logFile = openSync(logPath, "a", 0o600);
  let child;
  try {
    child = await spawnDetached(process.execPath, command, {
      cwd: data.workspaceRoot,
      detached: true,
      env: environment,
      stdio: ["ignore", logFile, logFile],
    });
  } catch (error) {
    throw new StartError(`cannot start dashboard: ${error.message}`);
  } finally {
    closeSync(logFile);
  }
  const descriptorPayload = {
    contract: CONTRACT,
    pid: child.pid,
    url: publicUrl,
    expert_id: options.expertId,
    workspace_root: data.workspaceRoot,
    workflow_root: data.runtimeRoot,
    goal_id: data.goalId,
    source_id: sourceId,
    plan_path: data.planPath,
    state_path: data.statePath,
    host: options.host,
    port: options.port,
    log_path: logPath,
    started_at: new Date().toISOString(),
  };
  writeDescriptor(descriptorPath, descriptorPayload);

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await probeDashboard(healthUrl, sourceId)) {
      const health = await requestJson(new URL("healthz", healthUrl), 500);
      return responsePayload(
        "started",
        data,
        sourceId,
        publicUrl,
        child.pid,
        logPath,
        descriptorPath,
        health?.leader_runtime_id === runtimeId ? "leader" : "participant",
        options.expertId,
      );
    }
    if (!pidIsAlive(child.pid)) {
      rmSync(descriptorPath, { force: true });
      const details = logTail(logPath);
      throw new StartError(
        `dashboard exited during startup${details ? `\n${details}` : ""}`,
      );
    }
    await delay(100);
  }
  try {
    process.kill(child.pid, "SIGTERM");
  } catch {}
  rmSync(descriptorPath, { force: true });
  const details = logTail(logPath);
  throw new StartError(
    `dashboard did not become healthy; see ${logPath}${details ? `\n${details}` : ""}`,
  );
}

async function main() {
  try {
    const payload = await startDashboard(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`${JSON.stringify({ contract: CONTRACT, status: "error", error: message })}\n`);
    process.exitCode = 1;
  }
}

const currentPath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && resolve(process.argv[1]) === currentPath) {
  await main();
}

export { StartError, discoverDashboardData, parseArgs, startDashboard };
