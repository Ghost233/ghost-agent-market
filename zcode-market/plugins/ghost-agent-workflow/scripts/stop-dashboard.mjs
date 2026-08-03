#!/usr/bin/env node
// Generated from tooling/zcode-workflow/dashboard-lifecycle.mjs and tooling/zcode-workflow/stop-dashboard.mjs. Do not edit directly.
import * as dashboardChildProcess from "node:child_process";
import * as dashboardCrypto from "node:crypto";
import * as dashboardFs from "node:fs";
import * as dashboardOs from "node:os";
import * as dashboardPath from "node:path";

export const ZCODE_DASHBOARD_DESCRIPTOR_V2 = "ZCODE_DASHBOARD_DESCRIPTOR_V2";

const DASHBOARD_RUNTIME_DIRECTORY = "ghost-agent-workflow-dashboard";
const PROCESS_IDENTITY_KEYS = [
  "pid",
  "platform",
  "start_marker",
  "executable",
  "argv",
  "command",
  "command_digest",
];
const DESCRIPTOR_KEYS = [
  "contract",
  "descriptor_token",
  "runtime_id",
  "source_id",
  "expected_argv",
  "workspace_root",
  "workflow_root",
  "goal_id",
  "goal_path",
  "plan_path",
  "state_path",
  "lifecycle_path",
  "pid",
  "process_identity",
  "url",
  "host",
  "port",
  "log_path",
  "created_at",
];
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HEX_ID_PATTERN = /^[0-9a-f]{20}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const HOST_PATTERN = /^[A-Za-z0-9.:[\]-]+$/u;
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const WINDOWS_DRIVE_ABSOLUTE_PATTERN = /^[A-Za-z]:[\\/]/u;

function requireRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireExactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly: ${expected.join(", ")}`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireAbsolutePath(value, label, platform = process.platform) {
  const path = requireString(value, label);
  const absolute = platform === "win32"
    ? dashboardPath.win32.isAbsolute(path) || WINDOWS_DRIVE_ABSOLUTE_PATTERN.test(path)
    : dashboardPath.posix.isAbsolute(path);
  if (!absolute) throw new Error(`${label} must be absolute`);
  if (dashboardPath.resolve(path) !== path && platform !== "win32") {
    throw new Error(`${label} must be canonical`);
  }
  return path;
}

function pathIsWithin(root, candidate) {
  const offset = dashboardPath.relative(root, candidate);
  return offset === "" || (!offset.startsWith("..") && !dashboardPath.isAbsolute(offset));
}

function canonicalPath(value, platform = process.platform) {
  const pathApi = platform === "win32" ? dashboardPath.win32 : dashboardPath;
  const resolved = pathApi.resolve(value);
  if (platform === process.platform) {
    try {
      return dashboardFs.realpathSync.native(resolved);
    } catch {
      const parent = pathApi.dirname(resolved);
      if (parent !== resolved) {
        try {
          return pathApi.join(dashboardFs.realpathSync.native(parent), pathApi.basename(resolved));
        } catch {}
      }
    }
  }
  return resolved;
}

function normalizedExecutable(value, platform = process.platform) {
  const candidate = canonicalPath(value, platform);
  if (platform === "win32") return candidate.toLowerCase();
  return candidate;
}

function commandDigest(argv) {
  return `sha256:${dashboardCrypto.createHash("sha256").update(argv.join("\0")).digest("hex")}`;
}

function commandLineToArgv(command) {
  const result = [];
  let index = 0;
  while (index < command.length) {
    while (index < command.length && /\s/u.test(command[index])) index += 1;
    if (index >= command.length) break;
    let current = "";
    let quoted = false;
    while (index < command.length) {
      let backslashes = 0;
      while (command[index] === "\\") {
        backslashes += 1;
        index += 1;
      }
      if (command[index] === '"') {
        current += "\\".repeat(Math.floor(backslashes / 2));
        if (backslashes % 2 === 0) {
          if (quoted && command[index + 1] === '"') {
            current += '"';
            index += 2;
            continue;
          }
          quoted = !quoted;
        } else {
          current += '"';
        }
        index += 1;
        continue;
      }
      current += "\\".repeat(backslashes);
      if (index >= command.length || (!quoted && /\s/u.test(command[index]))) break;
      current += command[index];
      index += 1;
    }
    if (quoted) return null;
    result.push(current);
    while (index < command.length && /\s/u.test(command[index])) index += 1;
  }
  return result.length > 0 ? result : null;
}

function isAbsoluteExecutable(value, platform) {
  const pathApi = platform === "win32" ? dashboardPath.win32 : dashboardPath;
  return pathApi.isAbsolute(value) || (platform === "win32" && WINDOWS_DRIVE_ABSOLUTE_PATTERN.test(value));
}

function normalizeArgvExecutable(argv, executable, platform) {
  if (!Array.isArray(argv) || argv.length === 0) return null;
  if (argv.some((value) => typeof value !== "string" || value.includes("\0"))) return null;
  if (!isAbsoluteExecutable(argv[0], platform)) return null;
  if (normalizedExecutable(argv[0], platform) !== normalizedExecutable(executable, platform)) return null;
  return [...argv];
}

function normalizedStartMarker(value) {
  return value.trim().replace(/\s+/gu, " ");
}

function processIdentityFromParts(pid, platform, startMarker, executable, argv, command = null) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const marker = normalizedStartMarker(startMarker);
  if (marker.length === 0) return null;
  if (typeof executable !== "string" || executable.length === 0) return null;
  const normalizedArgv = normalizeArgvExecutable(argv, executable, platform);
  if (normalizedArgv === null) return null;
  const renderedCommand = command === null ? normalizedArgv.join("\0") : command;
  if (
    typeof renderedCommand !== "string"
    || renderedCommand.length === 0
    || renderedCommand.trim() !== renderedCommand
  ) return null;
  return {
    pid,
    platform,
    start_marker: marker,
    executable: canonicalPath(executable, platform),
    argv: normalizedArgv,
    command: renderedCommand,
    command_digest: commandDigest(normalizedArgv),
  };
}

function spawnText(command, args) {
  const result = dashboardChildProcess.spawnSync(command, args, {
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
    encoding: "utf8",
    windowsHide: true,
    timeout: 2_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") return null;
  return result.stdout;
}

const DARWIN_PROCARGS_PYTHON = String.raw`
import base64, ctypes, ctypes.util, json, sys
pid = int(sys.argv[1])
libc_name = ctypes.util.find_library("c")
if libc_name is None:
    raise RuntimeError("libc is unavailable")
libc = ctypes.CDLL(libc_name, use_errno=True)
mib = (ctypes.c_int * 3)(1, 49, pid)
size = ctypes.c_size_t(0)
if libc.sysctl(mib, 3, None, ctypes.byref(size), None, 0) != 0:
    raise OSError(ctypes.get_errno(), "KERN_PROCARGS2 size")
if size.value < 5 or size.value > 1048576:
    raise ValueError("invalid KERN_PROCARGS2 size")
buffer = ctypes.create_string_buffer(size.value)
if libc.sysctl(mib, 3, buffer, ctypes.byref(size), None, 0) != 0:
    raise OSError(ctypes.get_errno(), "KERN_PROCARGS2 data")
raw = buffer.raw[:size.value]
argc = int.from_bytes(raw[:4], sys.byteorder, signed=True)
if argc < 1 or argc > 65536:
    raise ValueError("invalid argc")
offset = 4
end = raw.find(b"\0", offset)
if end < 0:
    raise ValueError("missing executable terminator")
executable = raw[offset:end]
offset = end + 1
while offset < len(raw) and raw[offset] == 0:
    offset += 1
argv = []
for _ in range(argc):
    end = raw.find(b"\0", offset)
    if end < 0:
        raise ValueError("unterminated argv")
    argv.append(raw[offset:end])
    offset = end + 1
print(json.dumps({
    "executable_base64": base64.b64encode(executable).decode("ascii"),
    "argv_base64": [base64.b64encode(value).decode("ascii") for value in argv],
}, separators=(",", ":")))
`;

function darwinIdentity(pid) {
  const start = spawnText("/bin/ps", ["-ww", "-p", String(pid), "-o", "lstart="]);
  if (start === null) return null;
  const procargs = dashboardChildProcess.spawnSync(
    "/usr/bin/python3",
    ["-c", DARWIN_PROCARGS_PYTHON, String(pid)],
    {
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
      encoding: "utf8",
      windowsHide: true,
      timeout: 4_000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  if (procargs.error || procargs.status !== 0 || typeof procargs.stdout !== "string") return null;
  try {
    return parseDarwinProcessIdentity(pid, { start, ...JSON.parse(procargs.stdout) });
  } catch {
    return null;
  }
}

function linuxIdentity(pid) {
  const directory = `/proc/${pid}`;
  try {
    return parseLinuxProcessIdentity(pid, {
      stat: dashboardFs.readFileSync(`${directory}/stat`, "utf8"),
      cmdline: dashboardFs.readFileSync(`${directory}/cmdline`),
      executable: dashboardFs.readlinkSync(`${directory}/exe`),
    });
  } catch {
    return null;
  }
}

function windowsIdentity(pid) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$requested = [int]$args[0]",
    "$p = Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = ' + $requested)",
    "if ($null -eq $p) { exit 3 }",
    "$obj = [ordered]@{",
    "  ProcessId = [int]$p.ProcessId",
    "  CreationDate = [string]$p.CreationDate",
    "  ExecutablePath = [string]$p.ExecutablePath",
    "  CommandLine = [string]$p.CommandLine",
    "}",
    "$obj | ConvertTo-Json -Compress",
  ].join("; ");
  const result = dashboardChildProcess.spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
      String(pid),
    ],
    {
      env: { ...process.env },
      encoding: "utf8",
      windowsHide: true,
      timeout: 4_000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") return null;
  try {
    return parseWindowsProcessIdentity(pid, JSON.parse(result.stdout));
  } catch {
    return null;
  }
}

export function parseWindowsProcessIdentity(pid, value) {
  try {
    if (value?.ProcessId !== pid) return null;
    const command = requireString(value.CommandLine, "Windows process CommandLine");
    const argv = commandLineToArgv(command);
    if (argv === null) return null;
    return processIdentityFromParts(
      pid,
      "win32",
      requireString(value.CreationDate, "Windows process CreationDate"),
      requireString(value.ExecutablePath, "Windows process ExecutablePath"),
      argv,
      command,
    );
  } catch {
    return null;
  }
}

function dashboardRuntimeId(workspaceRoot, goalId, host, port) {
  return dashboardCrypto.createHash("sha256")
    .update([canonicalPath(workspaceRoot), goalId, host, port].join("\n"))
    .digest("hex")
    .slice(0, 20);
}

export function dashboardRuntimeDirectory() {
  const override = process.env.ZCODE_DASHBOARD_RUNTIME_DIRECTORY_TEST;
  if (override !== undefined) return override;
  return dashboardPath.join(
    dashboardFs.realpathSync.native(dashboardOs.tmpdir()),
    DASHBOARD_RUNTIME_DIRECTORY,
  );
}

export function dashboardDescriptorPath(workspaceRoot, goalId, host, port) {
  const runtimeId = dashboardRuntimeId(workspaceRoot, goalId, host, port);
  return dashboardPath.join(dashboardRuntimeDirectory(), `${runtimeId}.json`);
}

export function dashboardSourceId(workspaceRoot, goalId) {
  return dashboardCrypto.createHash("sha256")
    .update(`${canonicalPath(workspaceRoot)}\n${goalId}`)
    .digest("hex")
    .slice(0, 20);
}

export function dashboardRuntimeIdFor(workspaceRoot, goalId, host, port) {
  return dashboardRuntimeId(workspaceRoot, goalId, host, port);
}

export function dashboardDisplayUrl(host, port) {
  const renderedHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${renderedHost}:${port}/`;
}

function lexicalComponents(path) {
  const absolute = dashboardPath.resolve(path);
  const root = dashboardPath.parse(absolute).root;
  const suffix = absolute.slice(root.length);
  const components = suffix === "" ? [] : suffix.split(dashboardPath.sep).filter(Boolean);
  let current = root;
  return [
    root,
    ...components.map((component) => {
      current = dashboardPath.join(current, component);
      return current;
    }),
  ];
}

function pathMetadata(path) {
  try {
    return dashboardFs.lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

export function validateDashboardRuntimeDirectory(path, { create = false, allowMissing = false } = {}) {
  const absolute = dashboardPath.resolve(path);
  const components = lexicalComponents(absolute);
  let missing = false;
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    const metadata = pathMetadata(component);
    if (metadata === null) {
      if (allowMissing && index === components.length - 1 && !missing) return null;
      if (!create || index !== components.length - 1 || missing) {
        throw new Error(`dashboard runtime path component is missing: ${component}`);
      }
      dashboardFs.mkdirSync(component, { mode: 0o700 });
      const created = pathMetadata(component);
      if (created === null || created.isSymbolicLink() || !created.isDirectory()) {
        throw new Error(`dashboard runtime path component is unsafe: ${component}`);
      }
      continue;
    }
    if (missing || metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`dashboard runtime path component is unsafe: ${component}`);
    }
  }
  return absolute;
}

function requireSafeRegularTarget(path, label, { allowMissing }) {
  const metadata = pathMetadata(path);
  if (metadata === null) {
    if (allowMissing) return null;
    throw new Error(`${label} is missing: ${path}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file: ${path}`);
  }
  return metadata;
}

function fsyncDirectory(path) {
  const descriptor = dashboardFs.openSync(
    path,
    dashboardFs.constants.O_RDONLY
      | (dashboardFs.constants.O_DIRECTORY ?? 0)
      | (dashboardFs.constants.O_NOFOLLOW ?? 0)
      | (dashboardFs.constants.O_CLOEXEC ?? 0),
  );
  try {
    if (!dashboardFs.fstatSync(descriptor).isDirectory()) {
      throw new Error(`dashboard runtime directory is not a directory: ${path}`);
    }
    dashboardFs.fsyncSync(descriptor);
  } finally {
    dashboardFs.closeSync(descriptor);
  }
}

export function writeDashboardDescriptorAtomic(path, payload, dependencies = {}) {
  const directory = validateDashboardRuntimeDirectory(dashboardPath.dirname(path));
  const target = dashboardPath.resolve(path);
  if (dashboardPath.dirname(target) !== directory) {
    throw new Error(`dashboard descriptor target escapes runtime directory: ${target}`);
  }
  requireSafeRegularTarget(target, "dashboard descriptor", { allowMissing: true });
  const randomId = (dependencies.randomUUID ?? dashboardCrypto.randomUUID)();
  const temporaryPath = dashboardPath.join(
    directory,
    `.${dashboardPath.basename(target)}.${process.pid}.${randomId}.tmp`,
  );
  let descriptor;
  let temporaryExists = false;
  try {
    descriptor = dashboardFs.openSync(
      temporaryPath,
      dashboardFs.constants.O_WRONLY
        | dashboardFs.constants.O_CREAT
        | dashboardFs.constants.O_EXCL
        | (dashboardFs.constants.O_NOFOLLOW ?? 0)
        | (dashboardFs.constants.O_CLOEXEC ?? 0),
      0o600,
    );
    temporaryExists = true;
    if (!dashboardFs.fstatSync(descriptor).isFile()) {
      throw new Error(`dashboard descriptor temporary target is not regular: ${temporaryPath}`);
    }
    dashboardFs.writeFileSync(descriptor, payload, "utf8");
    dashboardFs.fsyncSync(descriptor);
    dashboardFs.closeSync(descriptor);
    descriptor = undefined;
    dependencies.beforePublish?.();
    if (pathMetadata(target) !== null) {
      throw new Error(`dashboard descriptor already exists: ${target}`);
    }
    dashboardFs.linkSync(temporaryPath, target);
    dashboardFs.unlinkSync(temporaryPath);
    temporaryExists = false;
    fsyncDirectory(directory);
  } finally {
    if (descriptor !== undefined) dashboardFs.closeSync(descriptor);
    if (temporaryExists) {
      const metadata = pathMetadata(temporaryPath);
      if (metadata?.isFile()) dashboardFs.unlinkSync(temporaryPath);
    }
  }
}

const DASHBOARD_DESCRIPTOR_MAX_BYTES = 1024 * 1024;

function openRegularNoFollowSnapshot(path, label, { read = false } = {}) {
  let descriptor;
  try {
    descriptor = dashboardFs.openSync(
      path,
      dashboardFs.constants.O_RDONLY
        | (dashboardFs.constants.O_NOFOLLOW ?? 0)
        | (dashboardFs.constants.O_CLOEXEC ?? 0)
        | (dashboardFs.constants.O_NONBLOCK ?? 0),
    );
    const metadata = dashboardFs.fstatSync(descriptor);
    if (!metadata.isFile()) {
      throw new Error(`${label} must be a regular non-symlink file: ${path}`);
    }
    const snapshot = {
      dev: metadata.dev,
      ino: metadata.ino,
      mode: metadata.mode & 0o7777,
      uid: metadata.uid,
      size: metadata.size,
    };
    if (!read) return { snapshot, bytes: null };
    if (metadata.size > DASHBOARD_DESCRIPTOR_MAX_BYTES) {
      throw new Error(`${label} must be a bounded regular file: ${path}`);
    }
    return { snapshot, bytes: dashboardFs.readFileSync(descriptor) };
  } finally {
    if (descriptor !== undefined) dashboardFs.closeSync(descriptor);
  }
}

function descriptorBytesToken(bytes, label) {
  try {
    const parsed = JSON.parse(bytes.toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return typeof parsed.descriptor_token === "string" ? parsed.descriptor_token : null;
  } catch {
    return null;
  }
}

export function cleanupDashboardOwnedEntries({
  descriptorPath,
  descriptorToken,
  logPath,
  beforeQuarantine = null,
  randomUUID = dashboardCrypto.randomUUID,
} = {}) {
  const directory = dashboardPath.dirname(descriptorPath);
  validateDashboardRuntimeDirectory(directory);
  const descriptorRead = openRegularNoFollowSnapshot(descriptorPath, "dashboard descriptor", { read: true });
  if (descriptorBytesToken(descriptorRead.bytes, "dashboard descriptor") !== descriptorToken) {
    throw new Error(`dashboard descriptor ownership token does not match: ${descriptorPath}`);
  }
  const descriptorSnapshot = {
    ...descriptorRead.snapshot,
    token: descriptorToken,
    digest: dashboardCrypto.createHash("sha256").update(descriptorRead.bytes).digest("hex"),
  };
  const logSnapshot = openRegularNoFollowSnapshot(logPath, "dashboard log", { read: false }).snapshot;

  if (beforeQuarantine !== null) beforeQuarantine();

  const quarantined = [];
  const removeQuarantines = () => {
    for (const entry of quarantined) {
      try {
        if (pathMetadata(entry.quarantinePath) !== null) dashboardFs.unlinkSync(entry.quarantinePath);
      } catch {}
    }
  };
  try {
    for (const [path, label] of [
      [descriptorPath, "dashboard descriptor"],
      [logPath, "dashboard log"],
    ]) {
      const quarantinePath = dashboardPath.join(
        directory,
        `.${dashboardPath.basename(path)}.${process.pid}.${randomUUID()}.quarantine`,
      );
      dashboardFs.linkSync(path, quarantinePath);
      quarantined.push({ path, quarantinePath, label });
    }
    const descriptorQuarantine = openRegularNoFollowSnapshot(
      quarantined[0].quarantinePath,
      "dashboard descriptor",
      { read: true },
    );
    const logQuarantine = openRegularNoFollowSnapshot(
      quarantined[1].quarantinePath,
      "dashboard log",
      { read: false },
    ).snapshot;
    const descriptorMatches = descriptorQuarantine.snapshot.dev === descriptorSnapshot.dev
      && descriptorQuarantine.snapshot.ino === descriptorSnapshot.ino
      && descriptorQuarantine.bytes.equals(descriptorRead.bytes);
    const logMatches = logQuarantine.dev === logSnapshot.dev
      && logQuarantine.ino === logSnapshot.ino
      && logQuarantine.mode === logSnapshot.mode
      && logQuarantine.uid === logSnapshot.uid
      && logQuarantine.size === logSnapshot.size;
    const originalDescriptor = openRegularNoFollowSnapshot(descriptorPath, "dashboard descriptor", { read: false }).snapshot;
    const originalLog = openRegularNoFollowSnapshot(logPath, "dashboard log", { read: false }).snapshot;
    if (
      !descriptorMatches
      || !logMatches
      || originalDescriptor.dev !== descriptorSnapshot.dev
      || originalDescriptor.ino !== descriptorSnapshot.ino
      || originalLog.dev !== logSnapshot.dev
      || originalLog.ino !== logSnapshot.ino
    ) {
      removeQuarantines();
      throw new Error("dashboard cleanup targets changed between snapshot and quarantine");
    }
    for (const entry of quarantined) dashboardFs.unlinkSync(entry.path);
    for (const entry of quarantined) dashboardFs.unlinkSync(entry.quarantinePath);
    fsyncDirectory(directory);
  } catch (error) {
    removeQuarantines();
    throw error;
  }
}

function decodeBase64Utf8(value, label, allowEmpty = false) {
  if (allowEmpty && value === "") return "";
  const encoded = requireString(value, label);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
    throw new Error(`${label} must be canonical base64`);
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) throw new Error(`${label} must be canonical base64`);
  const decoded = bytes.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(bytes) || decoded.includes("\0")) {
    throw new Error(`${label} must encode NUL-free UTF-8`);
  }
  return decoded;
}

export function parseDarwinProcessIdentity(pid, fixture) {
  try {
    const start = requireString(fixture?.start, "Darwin process start");
    const executable = decodeBase64Utf8(
      fixture?.executable_base64,
      "Darwin process executable_base64",
    );
    if (!Array.isArray(fixture?.argv_base64) || fixture.argv_base64.length === 0) return null;
    const argv = fixture.argv_base64.map((value, index) =>
      decodeBase64Utf8(value, `Darwin process argv_base64[${index}]`, index > 0));
    return processIdentityFromParts(pid, "darwin", start, executable, argv);
  } catch {
    return null;
  }
}

export function parseLinuxProcessIdentity(pid, fixture) {
  try {
    const statLine = requireString(fixture?.stat, "Linux process stat").trim();
    const close = statLine.lastIndexOf(")");
    if (close < 2 || statLine[0] < "0" || statLine[0] > "9") return null;
    const parsedPid = Number(statLine.slice(0, statLine.indexOf(" ")));
    if (parsedPid !== pid) return null;
    const fields = statLine.slice(close + 2).trim().split(/\s+/u);
    const startTime = fields[19];
    if (!/^[0-9]+$/u.test(startTime ?? "")) return null;
    const cmdline = fixture?.cmdline;
    if (!Buffer.isBuffer(cmdline) || cmdline.length === 0 || cmdline[cmdline.length - 1] !== 0) return null;
    const argv = cmdline.toString("utf8").split("\0");
    argv.pop();
    return processIdentityFromParts(
      pid,
      "linux",
      `proc-stat:${startTime}`,
      requireString(fixture?.executable, "Linux process executable"),
      argv,
    );
  } catch {
    return null;
  }
}

export function inspectProcessIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === "darwin") return darwinIdentity(pid);
  if (process.platform === "linux") return linuxIdentity(pid);
  if (process.platform === "win32") return windowsIdentity(pid);
  return null;
}

export function inspectProcessObservation(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { status: "unknown" };
  if (process.platform !== "darwin" && process.platform !== "linux" && process.platform !== "win32") {
    return { status: "unknown" };
  }
  let identity;
  try {
    identity = inspectProcessIdentity(pid);
  } catch {
    identity = null;
  }
  if (identity !== null) return { status: "present", identity };
  try {
    process.kill(pid, 0);
    return { status: "unknown" };
  } catch (error) {
    return error?.code === "ESRCH" ? { status: "absent" } : { status: "unknown" };
  }
}

export function processObservationInspector(dependencies = {}) {
  if (typeof dependencies.inspectProcessObservation === "function") {
    return dependencies.inspectProcessObservation;
  }
  if (typeof dependencies.inspectProcessIdentity === "function") {
    const compatible = dependencies.inspectProcessIdentity;
    return (pid) => {
      let identity;
      try {
        identity = compatible(pid);
      } catch {
        identity = null;
      }
      if (identity !== null) return { status: "present", identity };
      if (!Number.isInteger(pid) || pid <= 0) return { status: "unknown" };
      try {
        process.kill(pid, 0);
        return { status: "unknown" };
      } catch (error) {
        return error?.code === "ESRCH" ? { status: "absent" } : { status: "unknown" };
      }
    };
  }
  return inspectProcessObservation;
}

export function parseProcessIdentity(value, label = "process identity") {
  const identity = requireRecord(value, label);
  requireExactKeys(identity, PROCESS_IDENTITY_KEYS, label);
  if (!Number.isInteger(identity.pid) || identity.pid <= 0) {
    throw new Error(`${label}.pid must be a positive integer`);
  }
  if (!new Set(["darwin", "linux", "win32"]).has(identity.platform)) {
    throw new Error(`${label}.platform is invalid`);
  }
  if (identity.platform !== process.platform) {
    throw new Error(`${label}.platform does not match the current OS`);
  }
  requireString(identity.start_marker, `${label}.start_marker`);
  if (normalizedStartMarker(identity.start_marker) !== identity.start_marker) {
    throw new Error(`${label}.start_marker must be normalized`);
  }
  const executable = requireAbsolutePath(identity.executable, `${label}.executable`, identity.platform);
  if (canonicalPath(executable, identity.platform) !== executable) {
    throw new Error(`${label}.executable must be canonical`);
  }
  if (!Array.isArray(identity.argv) || identity.argv.length === 0) {
    throw new Error(`${label}.argv must be a non-empty array`);
  }
  for (const [index, argument] of identity.argv.entries()) {
    if (typeof argument !== "string") throw new Error(`${label}.argv[${index}] must be a string`);
    if (index === 0 && argument.length === 0) throw new Error(`${label}.argv[0] must be non-empty`);
    if (argument.includes("\0")) throw new Error(`${label}.argv[${index}] contains NUL`);
  }
  requireString(identity.command, `${label}.command`);
  if (identity.command.trim() !== identity.command) {
    throw new Error(`${label}.command must not have surrounding whitespace`);
  }
  if (!SHA256_PATTERN.test(identity.command_digest)) {
    throw new Error(`${label}.command_digest must be a sha256 digest`);
  }
  if (identity.command_digest !== commandDigest(identity.argv)) {
    throw new Error(`${label}.command_digest does not match argv`);
  }
  if (
    normalizedExecutable(identity.argv[0], identity.platform)
    !== normalizedExecutable(identity.executable, identity.platform)
  ) {
    throw new Error(`${label}.argv[0] does not match executable`);
  }
  return identity;
}

export function processIdentityMatches(expected, observed) {
  try {
    const left = parseProcessIdentity(expected, "expected process identity");
    const right = parseProcessIdentity(observed, "observed process identity");
    if (left.pid !== right.pid || left.platform !== right.platform) return false;
    if (left.start_marker !== right.start_marker) return false;
    if (normalizedExecutable(left.executable, left.platform) !== normalizedExecutable(right.executable, right.platform)) {
      return false;
    }
    if (left.command !== right.command || left.command_digest !== right.command_digest) return false;
    return left.argv.length === right.argv.length
      && left.argv.every((argument, index) => argument === right.argv[index]);
  } catch {
    return false;
  }
}

export function expectedDashboardArgv(data, options, runtimeId) {
  const planPath = canonicalPath(data.planPath);
  const statePath = canonicalPath(data.statePath);
  const argv = [
    "dashboard",
    planPath,
    statePath,
    "--host",
    options.host,
    "--port",
    String(options.port),
    "--runtime-id",
    runtimeId,
  ];
  const lifecyclePath = data.lifecyclePath === null || data.lifecyclePath === undefined
    ? null
    : canonicalPath(data.lifecyclePath);
  if (lifecyclePath !== null && dashboardFs.existsSync(lifecyclePath)) {
    argv.push("--lifecycle", lifecyclePath);
  }
  if (options.allowRemote) argv.push("--allow-remote");
  return argv;
}

function expectedDescriptorCommand(descriptor, driverPath) {
  const expected = [
    normalizedExecutable(process.execPath),
    normalizedExecutable(driverPath),
    ...expectedDashboardArgv({
      planPath: descriptor.plan_path,
      statePath: descriptor.state_path,
      lifecyclePath: descriptor.lifecycle_path,
    }, {
      host: descriptor.host,
      port: descriptor.port,
      allowRemote: descriptor.expected_argv.includes("--allow-remote"),
    }, descriptor.runtime_id),
  ];
  return expected;
}

export function descriptorMatchesDashboardCommand(descriptor, driverPath) {
  try {
    if (!Array.isArray(descriptor?.expected_argv) || descriptor.expected_argv.length < 2) {
      return false;
    }
    const workspaceRoot = requireAbsolutePath(descriptor.workspace_root, "dashboard descriptor.workspace_root");
    const workflowRoot = requireAbsolutePath(descriptor.workflow_root, "dashboard descriptor.workflow_root");
    const goalPath = requireAbsolutePath(descriptor.goal_path, "dashboard descriptor.goal_path");
    const goalDirectory = dashboardPath.dirname(goalPath);
    if (
      workspaceRoot !== canonicalPath(workspaceRoot)
      || workflowRoot !== canonicalPath(dashboardPath.join(workspaceRoot, ".ghost-agent-workflow"))
      || !pathIsWithin(workflowRoot, goalPath)
      || goalPath !== canonicalPath(dashboardPath.join(goalDirectory, "goal.json"))
      || descriptor.plan_path !== canonicalPath(dashboardPath.join(goalDirectory, "plan.json"))
      || descriptor.state_path !== canonicalPath(dashboardPath.join(goalDirectory, "state.json"))
      || descriptor.lifecycle_path !== canonicalPath(dashboardPath.join(goalDirectory, "dashboard.json"))
      || descriptor.runtime_id !== dashboardRuntimeId(workspaceRoot, descriptor.goal_id, descriptor.host, descriptor.port)
      || descriptor.source_id !== dashboardSourceId(workspaceRoot, descriptor.goal_id)
      || descriptor.url !== dashboardDisplayUrl(descriptor.host, descriptor.port)
    ) {
      return false;
    }
    if (descriptor.expected_argv.some((value) => typeof value !== "string" || value.length === 0)) {
      return false;
    }
      const actual = [...descriptor.expected_argv];
    actual[0] = normalizedExecutable(actual[0]);
    actual[1] = normalizedExecutable(actual[1]);
    const expected = expectedDescriptorCommand(descriptor, driverPath);
    return actual.length === expected.length
      && actual.every((argument, index) => argument === expected[index]);
  } catch {
    return false;
  }
}

export function parseDashboardDescriptorV2(value, expected = {}) {
  const descriptor = requireRecord(value, "dashboard descriptor");
  requireExactKeys(descriptor, DESCRIPTOR_KEYS, "dashboard descriptor");
  if (descriptor.contract !== ZCODE_DASHBOARD_DESCRIPTOR_V2) {
    throw new Error(`dashboard descriptor contract must equal ${ZCODE_DASHBOARD_DESCRIPTOR_V2}`);
  }
  if (!UUID_V4_PATTERN.test(descriptor.descriptor_token)) {
    throw new Error("dashboard descriptor.descriptor_token must be a lowercase UUID v4");
  }
  if (!HEX_ID_PATTERN.test(descriptor.runtime_id)) {
    throw new Error("dashboard descriptor.runtime_id is invalid");
  }
  if (!HEX_ID_PATTERN.test(descriptor.source_id)) {
    throw new Error("dashboard descriptor.source_id is invalid");
  }
  if (!Array.isArray(descriptor.expected_argv) || descriptor.expected_argv.length === 0) {
    throw new Error("dashboard descriptor.expected_argv must be a non-empty array");
  }
  for (const [index, argument] of descriptor.expected_argv.entries()) {
    requireString(argument, `dashboard descriptor.expected_argv[${index}]`);
  }
  const workspaceRoot = requireAbsolutePath(descriptor.workspace_root, "dashboard descriptor.workspace_root");
  const canonicalWorkspaceRoot = canonicalPath(workspaceRoot);
  if (workspaceRoot !== canonicalWorkspaceRoot) {
    throw new Error("dashboard descriptor.workspace_root must be canonical");
  }
  const workflowRoot = requireAbsolutePath(descriptor.workflow_root, "dashboard descriptor.workflow_root");
  if (workflowRoot !== canonicalPath(workflowRoot)) {
    throw new Error("dashboard descriptor.workflow_root must be canonical");
  }
  const goalPath = requireAbsolutePath(descriptor.goal_path, "dashboard descriptor.goal_path");
  if (goalPath !== canonicalPath(goalPath)) {
    throw new Error("dashboard descriptor.goal_path must be canonical");
  }
  const planPath = requireAbsolutePath(descriptor.plan_path, "dashboard descriptor.plan_path");
  if (planPath !== canonicalPath(planPath)) {
    throw new Error("dashboard descriptor.plan_path must be canonical");
  }
  const statePath = requireAbsolutePath(descriptor.state_path, "dashboard descriptor.state_path");
  if (statePath !== canonicalPath(statePath)) {
    throw new Error("dashboard descriptor.state_path must be canonical");
  }
  const lifecyclePath = requireAbsolutePath(descriptor.lifecycle_path, "dashboard descriptor.lifecycle_path");
  if (lifecyclePath !== canonicalPath(lifecyclePath)) {
    throw new Error("dashboard descriptor.lifecycle_path must be canonical");
  }
  const logPath = requireAbsolutePath(descriptor.log_path, "dashboard descriptor.log_path");
  const expectedLogPath = dashboardPath.join(
    dashboardPath.resolve(dashboardRuntimeDirectory()),
    `${descriptor.runtime_id}.log`,
  );
  if (logPath !== expectedLogPath) {
    throw new Error("dashboard descriptor.log_path does not match the runtime binding");
  }
  requireString(descriptor.goal_id, "dashboard descriptor.goal_id");
  if (descriptor.goal_id === "." || descriptor.goal_id === ".." || /[\\/\0]/u.test(descriptor.goal_id)) {
    throw new Error("dashboard descriptor.goal_id is invalid");
  }
  requireString(descriptor.host, "dashboard descriptor.host");
  if (!HOST_PATTERN.test(descriptor.host)) throw new Error("dashboard descriptor.host is invalid");
  if (!Number.isInteger(descriptor.port) || descriptor.port < 1 || descriptor.port > 65_535) {
    throw new Error("dashboard descriptor.port must be an integer from 1 to 65535");
  }
  if (!Number.isInteger(descriptor.pid) || descriptor.pid <= 0) {
    throw new Error("dashboard descriptor.pid must be a positive integer");
  }
  const identity = parseProcessIdentity(descriptor.process_identity);
  if (identity.pid !== descriptor.pid) throw new Error("dashboard descriptor PID does not match process identity");
  requireString(descriptor.url, "dashboard descriptor.url");
  if (descriptor.url !== dashboardDisplayUrl(descriptor.host, descriptor.port)) {
    throw new Error("dashboard descriptor.url does not match host and port");
  }
  if (!ISO_UTC_PATTERN.test(descriptor.created_at) || Number.isNaN(Date.parse(descriptor.created_at))) {
    throw new Error("dashboard descriptor.created_at must be an ISO UTC timestamp");
  }
  const expectedWorkflowRoot = canonicalPath(dashboardPath.join(workspaceRoot, ".ghost-agent-workflow"));
  if (workflowRoot !== expectedWorkflowRoot) {
    throw new Error("dashboard descriptor.workflow_root does not match workspace");
  }
  const goalDirectory = dashboardPath.dirname(goalPath);
  if (
    !pathIsWithin(workflowRoot, goalPath)
    || goalPath !== canonicalPath(dashboardPath.join(goalDirectory, "goal.json"))
    || planPath !== canonicalPath(dashboardPath.join(goalDirectory, "plan.json"))
    || statePath !== canonicalPath(dashboardPath.join(goalDirectory, "state.json"))
    || lifecyclePath !== canonicalPath(dashboardPath.join(goalDirectory, "dashboard.json"))
  ) {
    throw new Error("dashboard descriptor Goal paths must be the canonical adjacent files");
  }
  const computedRuntimeId = dashboardRuntimeId(workspaceRoot, descriptor.goal_id, descriptor.host, descriptor.port);
  if (descriptor.runtime_id !== computedRuntimeId) {
    throw new Error("dashboard descriptor.runtime_id does not match its binding");
  }
  if (descriptor.source_id !== dashboardSourceId(workspaceRoot, descriptor.goal_id)) {
    throw new Error("dashboard descriptor.source_id does not match its binding");
  }
  if (expected.workspaceRoot !== undefined && canonicalWorkspaceRoot !== canonicalPath(expected.workspaceRoot)) {
    throw new Error("dashboard descriptor workspace does not match the request");
  }
  if (expected.goalId !== undefined && descriptor.goal_id !== expected.goalId) {
    throw new Error("dashboard descriptor Goal does not match the request");
  }
  if (expected.host !== undefined && descriptor.host !== expected.host) {
    throw new Error("dashboard descriptor host does not match the request");
  }
  if (expected.port !== undefined && descriptor.port !== expected.port) {
    throw new Error("dashboard descriptor port does not match the request");
  }
  if (expected.driverPath !== undefined && !descriptorMatchesDashboardCommand(descriptor, expected.driverPath)) {
    throw new Error("dashboard descriptor command binding is invalid");
  }
  if (
    identity.argv.length !== descriptor.expected_argv.length
    || !identity.argv.every((argument, index) => argument === descriptor.expected_argv[index])
  ) {
    throw new Error("dashboard descriptor expected argv does not match process identity");
  }
  return descriptor;
}

export function createDashboardDescriptorV2({
  data,
  options,
  runtimeId,
  sourceId,
  driverPath,
  pid,
  processIdentity,
  url,
  logPath,
  createdAt = new Date().toISOString(),
  descriptorToken = dashboardCrypto.randomUUID(),
}) {
  const canonicalWorkspaceRoot = canonicalPath(data.workspaceRoot);
  const canonicalWorkflowRoot = canonicalPath(data.runtimeRoot);
  const canonicalGoalPath = canonicalPath(data.goalPath);
  const canonicalPlanPath = canonicalPath(data.planPath);
  const canonicalStatePath = canonicalPath(data.statePath);
  const canonicalLifecyclePath = canonicalPath(data.lifecyclePath);
  const descriptor = {
    contract: ZCODE_DASHBOARD_DESCRIPTOR_V2,
    descriptor_token: descriptorToken,
    runtime_id: runtimeId,
    source_id: sourceId,
    expected_argv: [
      canonicalPath(process.execPath),
      canonicalPath(driverPath),
      ...expectedDashboardArgv({
        planPath: canonicalPlanPath,
        statePath: canonicalStatePath,
        lifecyclePath: canonicalLifecyclePath,
      }, options, runtimeId),
    ],
    workspace_root: canonicalWorkspaceRoot,
    workflow_root: canonicalWorkflowRoot,
    goal_id: data.goalId,
    goal_path: canonicalGoalPath,
    plan_path: canonicalPlanPath,
    state_path: canonicalStatePath,
    lifecycle_path: canonicalLifecyclePath,
    pid,
    process_identity: processIdentity,
    url,
    host: options.host,
    port: options.port,
    log_path: dashboardPath.resolve(logPath),
    created_at: createdAt,
  };
  return parseDashboardDescriptorV2(descriptor, {
    workspaceRoot: canonicalWorkspaceRoot,
    goalId: data.goalId,
    host: options.host,
    port: options.port,
    driverPath,
  });
}


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
