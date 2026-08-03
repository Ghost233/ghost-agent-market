#!/usr/bin/env node

import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { get } from "node:http";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath as statusFileURLToPath } from "node:url";
import {
  dashboardDescriptorPath,
  inspectProcessIdentity,
  parseDashboardDescriptorV2,
  processIdentityMatches,
} from "./dashboard-lifecycle.mjs";

const CONTRACT = "ZCODE_DASHBOARD_STATUS_RECEIPT_V1";
const MAX_DESCRIPTOR_BYTES = 1024 * 1024;

class StatusError extends Error {}

function canonicalStatusPath(path) {
  const resolved = resolve(path);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function parseArgs(argv) {
  const options = {
    workspace: null,
    goalId: null,
    host: "127.0.0.1",
    port: 57357,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--goal" || value === "--host" || value === "--port") {
      if (seen.has(value)) throw new StatusError(`duplicate option: ${value}`);
      const argument = argv[index + 1];
      if (argument === undefined || argument.startsWith("--")) {
        throw new StatusError(`${value} requires a value`);
      }
      if (value === "--goal") options.goalId = argument;
      if (value === "--host") options.host = argument;
      if (value === "--port") options.port = Number(argument);
      seen.add(value);
      index += 1;
      continue;
    }
    if (value.startsWith("--")) throw new StatusError(`unknown option: ${value}`);
    if (options.workspace !== null) {
      throw new StatusError("expected exactly one workspace directory");
    }
    options.workspace = value;
  }
  if (options.workspace === null || options.goalId === null) {
    throw new StatusError(
      "usage: dashboard-status.mjs <workspace> --goal <goal-id> [--host <host>] [--port <port>]",
    );
  }
  if (options.goalId.length === 0) throw new StatusError("--goal must be non-empty");
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new StatusError("--port must be an integer from 1 to 65535");
  }
  if (!/^[A-Za-z0-9.:[\]-]+$/u.test(options.host)) {
    throw new StatusError(`--host is invalid: ${options.host}`);
  }
  options.workspace = canonicalStatusPath(options.workspace);
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

function safeRegularFileBytes(path, trustedRoot) {
  const canonicalTrustedRoot = resolve(trustedRoot);
  const parent = dirname(path);
  if (!isWithin(canonicalTrustedRoot, path)) {
    return { status: "invalid", error: "path escapes its trusted root" };
  }
  const filesystemRoot = parse(canonicalTrustedRoot).root;
  const ancestorOffset = canonicalTrustedRoot.slice(filesystemRoot.length);
  let current = filesystemRoot;
  for (const segment of ancestorOffset.split(sep)) {
    if (segment === "") continue;
    current = join(current, segment);
    const metadata = inspectPath(current);
    if (metadata === null) return { status: "not_found" };
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      return { status: "invalid", error: `unsafe ancestor: ${current}` };
    }
  }
  const offset = relative(canonicalTrustedRoot, parent);
  for (const segment of offset.split(sep)) {
    if (segment === "") continue;
    current = join(current, segment);
    const metadata = inspectPath(current);
    if (metadata === null) return { status: "not_found" };
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      return { status: "invalid", error: `unsafe ancestor: ${current}` };
    }
  }
  const metadata = inspectPath(path);
  if (metadata === null) return { status: "not_found" };
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    return { status: "invalid", error: "target is not a regular file" };
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
    if (!opened.isFile() || opened.size > MAX_DESCRIPTOR_BYTES) {
      return { status: "invalid", error: "target is not a bounded regular file" };
    }
    return { status: "ok", bytes: readFileSync(descriptor) };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return { status: "not_found" };
    return { status: "invalid", error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function driverPath() {
  const local = join(dirname(statusFileURLToPath(import.meta.url)), "goal-dag.mjs");
  const published = resolve(
    dirname(statusFileURLToPath(import.meta.url)),
    "../../zcode-market/plugins/ghost-agent-workflow/scripts/goal-dag.mjs",
  );
  return inspectPath(local)?.isFile() ? local : published;
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

function requestJson(url, timeoutMs) {
  return new Promise((resolveRequest) => {
    const request = get(url, { headers: { Accept: "application/json" } }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size <= MAX_DESCRIPTOR_BYTES) chunks.push(chunk);
      });
      response.on("end", () => {
        if ((response.statusCode ?? 500) >= 400 || size > MAX_DESCRIPTOR_BYTES) {
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

function goalMatchesDescriptor(descriptor) {
  const goalRead = safeRegularFileBytes(descriptor.goal_path, descriptor.workflow_root);
  const goalStateRead = safeRegularFileBytes(
    join(dirname(descriptor.goal_path), "goal-state.json"),
    descriptor.workflow_root,
  );
  if (goalRead.status !== "ok" || goalStateRead.status !== "ok") return false;
  try {
    const goal = JSON.parse(goalRead.bytes.toString("utf8"));
    const goalState = JSON.parse(goalStateRead.bytes.toString("utf8"));
    if (goal === null || typeof goal !== "object" || Array.isArray(goal)) return false;
    if (goalState === null || typeof goalState !== "object" || Array.isArray(goalState)) return false;
    if (goal.contract !== "GOAL_CONTRACT_V1" || goal.goal_id !== descriptor.goal_id) return false;
    if (goalState.contract !== "GOAL_STATE_V1") return false;
    if (
      goal.workspace === null
      || typeof goal.workspace !== "object"
      || Array.isArray(goal.workspace)
      || typeof goal.workspace.root !== "string"
      || typeof goalState.active_plan_path !== "string"
    ) {
      return false;
    }
    return canonicalStatusPath(goal.workspace.root) === descriptor.workspace_root
      && canonicalStatusPath(goalState.active_plan_path) === descriptor.plan_path;
  } catch {
    return false;
  }
}

async function inspectHealth(descriptor) {
  const [health, catalog] = await Promise.all([
    requestJson(new URL("healthz", descriptor.url), 700),
    requestJson(new URL("api/catalog", descriptor.url), 900),
  ]);
  if (
    health?.contract !== "DAG_DASHBOARD_HEALTH_V2"
    || health?.status !== "ok"
    || catalog?.contract !== "DAG_DASHBOARD_CATALOG_V1"
    || !Array.isArray(catalog.sources)
  ) {
    return "unhealthy";
  }
  if (
    health.leader_runtime_id !== descriptor.runtime_id
    || catalog.leader_runtime_id !== descriptor.runtime_id
  ) {
    return "identity_mismatch";
  }
  const matches = catalog.sources.filter((source) => source?.id === descriptor.source_id);
  if (matches.length > 1) return "ambiguous";
  if (matches.length !== 1) return "identity_mismatch";
  const source = matches[0];
  if (
    typeof source.workspace !== "string"
    || canonicalStatusPath(source.workspace) !== descriptor.workspace_root
    || source.goal_id !== descriptor.goal_id
  ) {
    return "identity_mismatch";
  }
  return "running";
}

async function statusDashboard(options, dependencies = {}) {
  const inspectIdentity = dependencies.inspectProcessIdentity ?? inspectProcessIdentity;
  const descriptorPath = dashboardDescriptorPath(
    options.workspace,
    options.goalId,
    options.host,
    options.port,
  );
  const runtimeRoot = dirname(descriptorPath);
  const descriptorRead = safeRegularFileBytes(descriptorPath, runtimeRoot);
  if (descriptorRead.status === "not_found") return commonReceipt(options, "not_found");
  if (descriptorRead.status !== "ok") {
    return commonReceipt(options, "invalid_descriptor", { descriptor_path: descriptorPath });
  }
  let descriptor;
  try {
    descriptor = parseDashboardDescriptorV2(
      JSON.parse(descriptorRead.bytes.toString("utf8")),
      {
        workspaceRoot: options.workspace,
        goalId: options.goalId,
        host: options.host,
        port: options.port,
        driverPath: driverPath(),
      },
    );
  } catch {
    return commonReceipt(options, "invalid_descriptor", { descriptor_path: descriptorPath });
  }
  const descriptorReceipt = {
    descriptor_path: descriptorPath,
    descriptor_token: descriptor.descriptor_token,
    runtime_id: descriptor.runtime_id,
    source_id: descriptor.source_id,
    pid: descriptor.pid,
    url: descriptor.url,
    log_path: descriptor.log_path,
  };
  const observedIdentity = inspectIdentity(descriptor.pid);
  if (observedIdentity === null) {
    return commonReceipt(options, "stopped", descriptorReceipt);
  }
  if (!processIdentityMatches(descriptor.process_identity, observedIdentity)) {
    return commonReceipt(options, "identity_mismatch", descriptorReceipt);
  }
  if (!goalMatchesDescriptor(descriptor)) {
    return commonReceipt(options, "identity_mismatch", descriptorReceipt);
  }
  const healthStatus = await inspectHealth(descriptor);
  return commonReceipt(options, healthStatus, descriptorReceipt);
}

async function main() {
  try {
    process.stdout.write(`${JSON.stringify(await statusDashboard(parseArgs(process.argv.slice(2))))}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

const currentPath = statusFileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && resolve(process.argv[1]) === currentPath) {
  await main();
}

export { StatusError, parseArgs, safeRegularFileBytes, statusDashboard };
