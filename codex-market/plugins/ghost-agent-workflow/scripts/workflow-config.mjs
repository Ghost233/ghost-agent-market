import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RECEIPT_CONTRACT = "THREAD_WORKFLOW_CONFIG_RECEIPT_V1";
const ROLES = ["planner", "owner", "review", "supervisor"];
const EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
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

const DEFAULT_CONFIG = {
  parallel: 8,
  profiles: {
    planner: { model: "gpt-5.6-sol", effort: "high" },
    owner: { model: "gpt-5.6-sol", effort: "high" },
    review: { model: "gpt-5.6-sol", effort: "high" },
    supervisor: { model: "gpt-5.6-luna", effort: "medium" },
  },
};

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${label} keys must equal: ${wanted.join(", ")}`);
  }
}

function parseParallel(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    fail("parallel must be an integer from 1 to 8");
  }
  return parsed;
}

function parseProfile(value, label) {
  if (!isRecord(value)) fail(`${label} must be an object`);
  requireExactKeys(value, ["model", "effort"], label);
  if (typeof value.model !== "string" || value.model.trim() === "") {
    fail(`${label}.model must be a non-empty string`);
  }
  if (typeof value.effort !== "string" || !EFFORTS.has(value.effort)) {
    fail(`${label}.effort is invalid`);
  }
  return { model: value.model, effort: value.effort };
}

function parseConfig(value) {
  if (!isRecord(value)) fail("config must be an object");
  requireExactKeys(value, ["parallel", "profiles"], "config");
  if (!isRecord(value.profiles)) fail("config.profiles must be an object");
  requireExactKeys(value.profiles, ROLES, "config.profiles");
  return {
    parallel: parseParallel(value.parallel),
    profiles: Object.fromEntries(
      ROLES.map((role) => [role, parseProfile(value.profiles[role], `config.profiles.${role}`)]),
    ),
  };
}

function parseStoredConfig(value) {
  if (!isRecord(value)) fail("config must be an object");
  requireExactKeys(value, ["parallel", "profiles"], "config");
  if (!isRecord(value.profiles)) fail("config.profiles must be an object");
  const roles = Object.keys(value.profiles).sort();
  const legacyRoles = ["owner", "planner", "review"];
  if (JSON.stringify(roles) !== JSON.stringify(legacyRoles)) {
    return { config: parseConfig(value), migrated: false };
  }
  const profiles = Object.fromEntries(
    legacyRoles.map((role) => [
      role,
      parseProfile(value.profiles[role], `config.profiles.${role}`),
    ]),
  );
  profiles.supervisor = { ...DEFAULT_CONFIG.profiles.supervisor };
  return {
    config: parseConfig({ parallel: value.parallel, profiles }),
    migrated: true,
  };
}

function configPath(workspaceRoot) {
  return join(resolve(workspaceRoot), ".ghost-agent-workflow", "config.json");
}

function ensureWorkflowGitignore(workspaceRoot) {
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

function readConfig(path) {
  try {
    return parseStoredConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot read workflow config ${path}: ${message}`);
  }
}

function writeAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function receipt(status, path, config) {
  process.stdout.write(`${JSON.stringify({
    contract: RECEIPT_CONTRACT,
    status,
    path,
    parallel: config.parallel,
    profiles: config.profiles,
  })}\n`);
}

function loadOrCreate(path) {
  if (existsSync(path)) {
    const { config, migrated } = readConfig(path);
    if (migrated) writeAtomic(path, config);
    return { status: migrated ? "migrated" : "existing", config };
  }
  const config = parseConfig(DEFAULT_CONFIG);
  writeAtomic(path, config);
  return { status: "created", config };
}

function main() {
  const [command, workspaceRoot, ...args] = process.argv.slice(2);
  if (!command || !workspaceRoot) {
    fail("usage: workflow-config.mjs <ensure|init|show|validate|set-parallel|set-profile> <workspace> [args]");
  }
  ensureWorkflowGitignore(workspaceRoot);
  const path = configPath(workspaceRoot);

  if (command === "init" || command === "ensure") {
    if (args.length !== 0) fail(`${command} takes no extra arguments`);
    const { status, config } = loadOrCreate(path);
    receipt(command === "ensure" ? "ensured" : status, path, config);
    return;
  }

  if (command === "show" || command === "validate") {
    if (args.length !== 0) fail(`${command} takes no extra arguments`);
    const { config } = loadOrCreate(path);
    receipt(command === "show" ? "shown" : "valid", path, config);
    return;
  }

  const { config } = loadOrCreate(path);
  if (command === "set-parallel") {
    if (args.length !== 1) fail("set-parallel requires <1-8>");
    config.parallel = parseParallel(args[0]);
  } else if (command === "set-profile") {
    if (args.length !== 3) fail("set-profile requires <role> <model> <effort>");
    const [role, model, effort] = args;
    if (!ROLES.includes(role)) fail(`role must be one of: ${ROLES.join(", ")}`);
    config.profiles[role] = parseProfile({ model, effort }, `config.profiles.${role}`);
  } else {
    fail(`unknown command: ${command}`);
  }
  const parsed = parseConfig(config);
  writeAtomic(path, parsed);
  receipt("updated", path, parsed);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
