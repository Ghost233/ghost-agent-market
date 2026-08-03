#!/usr/bin/env node

import { timingSafeEqual } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync as stopRealpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath as stopFileURLToPath } from "node:url";
import {
  cleanupDashboardOwnedEntries,
  dashboardDescriptorPath,
  dashboardRuntimeDirectory,
  parseDashboardDescriptorV2,
  processIdentityMatches,
  processObservationInspector,
} from "./dashboard-lifecycle.mjs";

const CONTRACT = "ZCODE_DASHBOARD_STOP_RECEIPT_V1";
const MAX_DESCRIPTOR_BYTES = 1024 * 1024;
const STOP_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

class StopError extends Error {}

function canonicalStopPath(path) {
  const resolved = resolve(path);
  try {
    return stopRealpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function parseArgs(argv) {
  const options = {
    workspace: null,
    goalId: null,
    descriptorToken: null,
    host: "127.0.0.1",
    port: 57357,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (
      value === "--goal"
      || value === "--descriptor-token"
      || value === "--host"
      || value === "--port"
    ) {
      if (seen.has(value)) throw new StopError(`duplicate option: ${value}`);
      const argument = argv[index + 1];
      if (argument === undefined || argument.startsWith("--")) {
        throw new StopError(`${value} requires a value`);
      }
      if (value === "--goal") options.goalId = argument;
      if (value === "--descriptor-token") options.descriptorToken = argument;
      if (value === "--host") options.host = argument;
      if (value === "--port") options.port = Number(argument);
      seen.add(value);
      index += 1;
      continue;
    }
    if (value.startsWith("--")) throw new StopError(`unknown option: ${value}`);
    if (options.workspace !== null) {
      throw new StopError("expected exactly one workspace directory");
    }
    options.workspace = value;
  }
  if (
    options.workspace === null
    || options.goalId === null
    || options.descriptorToken === null
  ) {
    throw new StopError(
      "usage: stop-dashboard.mjs <workspace> --goal <goal-id> --descriptor-token <uuid> [--host <host>] [--port <port>]",
    );
  }
  if (options.goalId.length === 0) throw new StopError("--goal must be non-empty");
  if (!STOP_TOKEN_PATTERN.test(options.descriptorToken)) {
    throw new StopError("--descriptor-token must be a lowercase UUID v4");
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new StopError("--port must be an integer from 1 to 65535");
  }
  if (!/^[A-Za-z0-9.:[\]-]+$/u.test(options.host)) {
    throw new StopError(`--host is invalid: ${options.host}`);
  }
  options.workspace = canonicalStopPath(options.workspace);
  return options;
}

function isWithin(root, candidate) {
  const offset = relative(root, candidate);
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

function inspectPath(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

function validateSafeAncestors(path, trustedRoot, { allowMissingRoot = false } = {}) {
  const canonicalTrustedRoot = resolve(trustedRoot);
  if (!isWithin(canonicalTrustedRoot, path)) {
    throw new StopError(`dashboard cleanup target escapes runtime directory: ${path}`);
  }
  const filesystemRoot = parse(canonicalTrustedRoot).root;
  const ancestorOffset = canonicalTrustedRoot.slice(filesystemRoot.length);
  let current = filesystemRoot;
  for (const segment of ancestorOffset.split(sep)) {
    if (segment === "") continue;
    current = join(current, segment);
    const metadata = inspectPath(current);
    if (metadata === null) {
      if (allowMissingRoot && current === canonicalTrustedRoot) return false;
      throw new StopError(`unsafe dashboard runtime ancestor: ${current}`);
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new StopError(`unsafe dashboard runtime ancestor: ${current}`);
    }
  }
  const parent = dirname(path);
  const offset = relative(canonicalTrustedRoot, parent);
  for (const segment of offset.split(sep)) {
    if (segment === "") continue;
    current = join(current, segment);
    const metadata = inspectPath(current);
    if (metadata === null || metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new StopError(`unsafe dashboard runtime ancestor: ${current}`);
    }
  }
  return true;
}

function safeRegularFile(path, trustedRoot, label, {
  allowMissing = false,
  read = false,
  maxBytes = MAX_DESCRIPTOR_BYTES,
} = {}) {
  const ancestorsExist = validateSafeAncestors(path, trustedRoot, {
    allowMissingRoot: allowMissing,
  });
  if (!ancestorsExist) return null;
  const metadata = inspectPath(path);
  if (metadata === null) {
    if (allowMissing) return null;
    throw new StopError(`${label} is missing: ${path}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new StopError(`${label} must be a regular non-symlink file: ${path}`);
  }
  let descriptor;
  try {
    descriptor = openSync(
      path,
      fsConstants.O_RDONLY
        | (fsConstants.O_NOFOLLOW ?? 0)
        | (fsConstants.O_CLOEXEC ?? 0)
        | (fsConstants.O_NONBLOCK ?? 0),
    );
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || (maxBytes !== null && opened.size > maxBytes)) {
      throw new StopError(`${label} must be a bounded regular file: ${path}`);
    }
    return read ? readFileSync(descriptor) : opened;
  } catch (error) {
    if (error instanceof StopError) throw error;
    throw new StopError(`cannot safely open ${label} ${path}: ${error.message}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function driverPath() {
  const local = join(dirname(stopFileURLToPath(import.meta.url)), "goal-dag.mjs");
  const published = resolve(
    dirname(stopFileURLToPath(import.meta.url)),
    "../../zcode-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs",
  );
  return inspectPath(local)?.isFile() ? local : published;
}

function tokenMatches(expected, actual) {
  if (typeof expected !== "string" || typeof actual !== "string") return false;
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");
  return expectedBytes.length === actualBytes.length
    && timingSafeEqual(expectedBytes, actualBytes);
}

function goalMatchesDescriptor(descriptor) {
  const goalBytes = safeRegularFile(
    descriptor.goal_path,
    descriptor.workflow_root,
    "dashboard Goal contract",
    { read: true },
  );
  const goalStateBytes = safeRegularFile(
    join(dirname(descriptor.goal_path), "goal-state.json"),
    descriptor.workflow_root,
    "dashboard Goal state",
    { read: true },
  );
  try {
    const goal = JSON.parse(goalBytes.toString("utf8"));
    const goalState = JSON.parse(goalStateBytes.toString("utf8"));
    return goal !== null
      && typeof goal === "object"
      && !Array.isArray(goal)
      && goal.contract === "GOAL_CONTRACT_V1"
      && goal.goal_id === descriptor.goal_id
      && goal.workspace !== null
      && typeof goal.workspace === "object"
      && !Array.isArray(goal.workspace)
      && typeof goal.workspace.root === "string"
      && canonicalStopPath(goal.workspace.root) === descriptor.workspace_root
      && goalState !== null
      && typeof goalState === "object"
      && !Array.isArray(goalState)
      && goalState.contract === "GOAL_STATE_V1"
      && typeof goalState.active_plan_path === "string"
      && canonicalStopPath(goalState.active_plan_path) === descriptor.plan_path;
  } catch {
    return false;
  }
}

function commonReceipt(options, status, extra = {}) {
  return {
    contract: CONTRACT,
    status,
    workspace_root: options.workspace,
    goal_id: options.goalId,
    host: options.host,
    port: options.port,
    ...extra,
  };
}

function descriptorReceipt(descriptorPath, descriptor) {
  return {
    descriptor_path: descriptorPath,
    descriptor_token: descriptor.descriptor_token,
    runtime_id: descriptor.runtime_id,
    source_id: descriptor.source_id,
    pid: descriptor.pid,
    log_path: descriptor.log_path,
  };
}

function cleanupDescriptorAndLog(descriptorPath, descriptor, runtimeRoot, dependencies = {}) {
  safeRegularFile(descriptorPath, runtimeRoot, "dashboard descriptor");
  safeRegularFile(descriptor.log_path, runtimeRoot, "dashboard log", { maxBytes: null });
  cleanupDashboardOwnedEntries({
    descriptorPath,
    descriptorToken: descriptor.descriptor_token,
    logPath: descriptor.log_path,
    beforeQuarantine: dependencies.beforeCleanupQuarantine ?? null,
  });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function stopDashboard(options, dependencies = {}) {
  const killProcess = dependencies.killProcess ?? ((pid, signal) => process.kill(pid, signal));
  const descriptorPath = dashboardDescriptorPath(
    options.workspace,
    options.goalId,
    options.host,
    options.port,
  );
  const runtimeRoot = dirname(descriptorPath);
  const descriptorBytes = safeRegularFile(
    descriptorPath,
    runtimeRoot,
    "dashboard descriptor",
    { allowMissing: true, read: true },
  );
  if (descriptorBytes === null) return commonReceipt(options, "not_found");

  let descriptor;
  try {
    descriptor = parseDashboardDescriptorV2(JSON.parse(descriptorBytes.toString("utf8")), {
      workspaceRoot: options.workspace,
      goalId: options.goalId,
      host: options.host,
      port: options.port,
      driverPath: driverPath(),
    });
  } catch (error) {
    throw new StopError(`dashboard descriptor validation failed: ${error.message}`);
  }
  if (!tokenMatches(descriptor.descriptor_token, options.descriptorToken)) {
    throw new StopError("dashboard descriptor token does not match");
  }
  if (descriptorPath !== dashboardDescriptorPath(
    descriptor.workspace_root,
    descriptor.goal_id,
    descriptor.host,
    descriptor.port,
  )) {
    throw new StopError("dashboard descriptor path does not match its exact binding");
  }
  const runtimeDirectory = resolve(dashboardRuntimeDirectory());
  if (runtimeRoot !== runtimeDirectory || dirname(descriptor.log_path) !== runtimeDirectory) {
    throw new StopError("dashboard cleanup paths are not owned by the runtime binding");
  }
  safeRegularFile(descriptor.log_path, runtimeRoot, "dashboard log", { maxBytes: null });
  if (!goalMatchesDescriptor(descriptor)) {
    throw new StopError("dashboard descriptor no longer matches the active Goal");
  }

  const receipt = descriptorReceipt(descriptorPath, descriptor);
  const observationInspector = processObservationInspector(dependencies);
  const initial = observationInspector(descriptor.pid);
  if (initial.status === "absent") {
    cleanupDescriptorAndLog(descriptorPath, descriptor, runtimeRoot, dependencies);
    return commonReceipt(options, "already_stopped", receipt);
  }
  if (initial.status === "present") {
    if (!processIdentityMatches(descriptor.process_identity, initial.identity)) {
      throw new StopError("dashboard process identity does not match the descriptor");
    }
    try {
      killProcess(descriptor.pid, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") {
        throw new StopError(`cannot signal the exact dashboard process: ${error.message}`);
      }
    }
  }
  const waitTimeoutMs = dependencies.waitTimeoutMs ?? 5_000;
  const pollIntervalMs = dependencies.pollIntervalMs ?? 25;
  const deadline = Date.now() + waitTimeoutMs;
  let afterSignal = observationInspector(descriptor.pid);
  while (Date.now() < deadline) {
    if (afterSignal.status === "absent") {
      cleanupDescriptorAndLog(descriptorPath, descriptor, runtimeRoot, dependencies);
      return commonReceipt(options, "stopped", receipt);
    }
    if (
      afterSignal.status === "present"
      && !processIdentityMatches(descriptor.process_identity, afterSignal.identity)
    ) {
      cleanupDescriptorAndLog(descriptorPath, descriptor, runtimeRoot, dependencies);
      return commonReceipt(options, "stopped", receipt);
    }
    await delay(pollIntervalMs);
    afterSignal = observationInspector(descriptor.pid);
  }
  return commonReceipt(options, "timeout", receipt);
}

async function main() {
  try {
    process.stdout.write(`${JSON.stringify(await stopDashboard(parseArgs(process.argv.slice(2))))}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
  }
}

const currentPath = stopFileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && resolve(process.argv[1]) === currentPath) {
  await main();
}

export { StopError, parseArgs, stopDashboard };
