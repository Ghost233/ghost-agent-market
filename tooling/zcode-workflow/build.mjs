#!/usr/bin/env node

import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadAgentRegistry,
  registryDigest,
  renderAgentRegistryModule,
} from "./agent-registry.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_ROOT = resolve(REPOSITORY_ROOT, "tooling/zcode-workflow");
const PUBLISHED_DIRECTORY = "zcode-market/plugins/ghost-agent-workflow/scripts";
const REGISTRY_PATH = resolve(REPOSITORY_ROOT, "zcode-market/agent-registry.json");
const LIFECYCLE_SOURCE_PATH = resolve(SOURCE_ROOT, "dashboard-lifecycle.mjs");
const LIFECYCLE_IMPORT_PATTERN = /^import (?:\{ [A-Za-z][A-Za-z0-9]* \}|\{\n(?:  [A-Za-z][A-Za-z0-9]*,?\n)+\}) from "\.\/dashboard-lifecycle\.mjs";\n/mu;
const LIFECYCLE_IMPORT_SPECIFIER = "./dashboard-lifecycle.mjs";

const TARGETS = [
  {
    relativePath: `${PUBLISHED_DIRECTORY}/agent-registry.mjs`,
    mode: 0o644,
    render() {
      const { raw, registry } = loadAgentRegistry(REGISTRY_PATH);
      return generatedSource(
        [
          "tooling/zcode-workflow/agent-registry.mjs",
          "zcode-market/agent-registry.json",
        ],
        renderAgentRegistryModule(registry, registryDigest(raw)),
      );
    },
  },
  {
    relativePath: `${PUBLISHED_DIRECTORY}/workflow-config.mjs`,
    mode: 0o755,
    render() {
      return generatedSource(
        ["tooling/zcode-workflow/workflow-config.mjs"],
        readSource("workflow-config.mjs"),
      );
    },
  },
  {
    relativePath: `${PUBLISHED_DIRECTORY}/start-dashboard.mjs`,
    mode: 0o755,
    render() {
      return bundledDashboardCli("start-dashboard.mjs");
    },
  },
  {
    relativePath: `${PUBLISHED_DIRECTORY}/dashboard-status.mjs`,
    mode: 0o755,
    render() {
      return bundledDashboardCli("dashboard-status.mjs");
    },
  },
  {
    relativePath: `${PUBLISHED_DIRECTORY}/stop-dashboard.mjs`,
    mode: 0o755,
    render() {
      return bundledDashboardCli("stop-dashboard.mjs");
    },
  },
  {
    relativePath: `${PUBLISHED_DIRECTORY}/goal-dag.mjs`,
    mode: 0o644,
    render() {
      const source = readSource("goal-dag.ts");
      return generatedSource(
        ["tooling/zcode-workflow/goal-dag.ts"],
        stripTypeScriptTypes(source, { mode: "strip" }).replace(/[ \t]+$/gmu, ""),
      );
    },
  },
];

class UsageError extends Error {}

function usage() {
  return "usage: node tooling/zcode-workflow/build.mjs [--check] [--output-root PATH]";
}

function parseArgs(argv) {
  let check = false;
  let outputRoot = REPOSITORY_ROOT;
  let sawOutputRoot = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--check") {
      if (check) throw new UsageError("duplicate argument: --check");
      check = true;
      continue;
    }
    if (value === "--output-root") {
      if (sawOutputRoot) throw new UsageError("duplicate argument: --output-root");
      const argument = argv[index + 1];
      if (argument === undefined || argument.startsWith("--")) {
        throw new UsageError("--output-root requires a path");
      }
      outputRoot = resolve(argument);
      sawOutputRoot = true;
      index += 1;
      continue;
    }
    throw new UsageError(`unknown argument: ${value}`);
  }
  return { check, outputRoot };
}

function readSource(name) {
  return readFileSync(resolve(SOURCE_ROOT, name), "utf8");
}

function generatedHeader(sources) {
  return `// Generated from ${sources.join(" and ")}. Do not edit directly.`;
}

function generatedSource(sources, source) {
  return `${generatedHeader(sources)}\n${source}`;
}

function withoutShebang(source) {
  return source.replace(/^#![^\n]*\n/u, "");
}

function bundledDashboardCli(name) {
  const lifecycle = readFileSync(LIFECYCLE_SOURCE_PATH, "utf8");
  const source = withoutShebang(readSource(name));
  const importMatches = [...source.matchAll(new RegExp(LIFECYCLE_IMPORT_PATTERN.source, "gmu"))];
  const importCount = importMatches.length;
  if (importCount !== 1) {
    throw new Error(`${name}: expected exactly one lifecycle import, found ${importCount}`);
  }
  const cliSource = source.replace(LIFECYCLE_IMPORT_PATTERN, "");
  if (cliSource.includes(LIFECYCLE_IMPORT_SPECIFIER)) {
    throw new Error(`${name}: generated source retains ${LIFECYCLE_IMPORT_SPECIFIER}`);
  }
  const sources = [
    "tooling/zcode-workflow/dashboard-lifecycle.mjs",
    `tooling/zcode-workflow/${name}`,
  ];
  const output = [
    "#!/usr/bin/env node",
    generatedHeader(sources),
    lifecycle,
    cliSource,
  ].join("\n");
  if (output.includes(LIFECYCLE_IMPORT_SPECIFIER)) {
    throw new Error(`${name}: generated artifact retains ${LIFECYCLE_IMPORT_SPECIFIER}`);
  }
  return output;
}

function isWithin(root, candidate) {
  const offset = relative(root, candidate);
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

function targetPath(outputRoot, relativePath) {
  const target = resolve(outputRoot, relativePath);
  if (!isWithin(outputRoot, target)) {
    throw new Error(`build target escapes output root: ${relativePath}`);
  }
  return target;
}

function ensureSafeDirectory(outputRoot, relativeDirectory) {
  let current = outputRoot;
  for (const segment of relativeDirectory.split("/")) {
    if (segment === "") continue;
    current = join(current, segment);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o755 });
    const metadata = lstatSync(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`build directory is not a real directory: ${current}`);
    }
    if (!isWithin(outputRoot, realpathSync(current))) {
      throw new Error(`build directory escapes output root: ${current}`);
    }
  }
}

function writeTargets(requestedOutputRoot, renderedTargets) {
  mkdirSync(requestedOutputRoot, { recursive: true });
  const outputRoot = realpathSync(requestedOutputRoot);
  for (const target of renderedTargets) {
    const path = targetPath(outputRoot, target.relativePath);
    ensureSafeDirectory(outputRoot, dirname(target.relativePath));
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
      throw new Error(`refusing to overwrite symbolic link: ${path}`);
    }
    writeFileSync(path, target.bytes);
    chmodSync(path, target.mode);
    process.stdout.write(`${path}\n`);
  }
}

function checkDirectoryComponents(outputRoot, relativePath) {
  let current = outputRoot;
  for (const segment of dirname(relativePath).split("/")) {
    if (segment === "") continue;
    current = join(current, segment);
    let metadata;
    try {
      metadata = lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
      return false;
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) return false;
  }
  return true;
}

function readRegularFileForCheck(path) {
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    return null;
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) return null;
  let descriptor;
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    const closeOnExec = fsConstants.O_CLOEXEC ?? 0;
    const nonBlocking = fsConstants.O_NONBLOCK ?? 0;
    descriptor = openSync(
      path,
      fsConstants.O_RDONLY | noFollow | closeOnExec | nonBlocking,
    );
    const openedMetadata = fstatSync(descriptor);
    if (!openedMetadata.isFile()) return null;
    return {
      bytes: readFileSync(descriptor),
      mode: openedMetadata.mode & 0o7777,
    };
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function checkTargets(outputRoot, renderedTargets) {
  const drift = [];
  for (const target of renderedTargets) {
    if (!checkDirectoryComponents(outputRoot, target.relativePath)) {
      drift.push(target.relativePath);
      continue;
    }
    const path = targetPath(outputRoot, target.relativePath);
    const actual = readRegularFileForCheck(path);
    if (
      actual === null
      || !actual.bytes.equals(target.bytes)
      || actual.mode !== target.mode
    ) {
      drift.push(target.relativePath);
    }
  }
  if (drift.length > 0) {
    for (const path of drift) process.stderr.write(`drift: ${path}\n`);
    process.exitCode = 1;
    return;
  }
  for (const target of renderedTargets) process.stdout.write(`${target.relativePath}\n`);
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  const renderedTargets = TARGETS.map((target) => ({
    relativePath: target.relativePath,
    mode: target.mode,
    bytes: Buffer.from(target.render(), "utf8"),
  }));
  if (options.check) checkTargets(options.outputRoot, renderedTargets);
  else writeTargets(options.outputRoot, renderedTargets);
}

main();
