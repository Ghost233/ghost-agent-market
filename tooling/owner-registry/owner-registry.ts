import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

type OwnerLineage = {
  parent_owner_ids: string[];
  created_by_request_digest: string;
};

type OwnerDefinition = {
  id: string;
  generation: number;
  status: "active";
  responsibility: string;
  scope_patterns: string[];
  scope_excludes: string[];
  worker_context: string;
  lineage: OwnerLineage;
};

type OwnerRegistry = {
  contract: "OWNER_REGISTRY_V2";
  workspace_root: string;
  revision: number;
  matcher: "owner-path-expression-v2";
  managed_roots: string[];
  owners: OwnerDefinition[];
  retired_owner_ids: string[];
  updated_at: string;
};

type RequestedOwner = Omit<OwnerDefinition, "generation" | "status" | "lineage">;

type OwnerChangeRequest = {
  contract: "OWNER_CHANGE_REQUEST_V2";
  request_id: string;
  operation: "create" | "split" | "expand" | "shrink" | "transfer" | "merge";
  base_registry_digest: string;
  created_at: string;
  reason: string;
  source_owner_ids: string[];
  new_owners: RequestedOwner[];
  capsule_strategy: "empty" | "inherit_sources";
};

type OwnerChangeValidation = {
  contract: "OWNER_CHANGE_VALIDATION_V2";
  status: "passed";
  request_digest: string;
  base_registry_digest: string;
  next_registry_digest: string;
  checks: string[];
  next_registry: OwnerRegistry;
};

type OwnerChangeApproval = {
  contract: "OWNER_CHANGE_APPROVAL_V2";
  decision: "approved";
  approved_by: "user";
  approved_at: string;
  request_digest: string;
  validation_digest: string;
  next_registry_digest: string;
};

type PersistentOwnerCapsule = {
  contract: "OWNER_CAPSULE_V2";
  owner_id: string;
  generation: number;
  registry_revision: number;
  scope_patterns: string[];
  scope_excludes: string[];
  responsibility: string;
  worker_context: string;
  inherited_from: string[];
  decisions: string[];
  invariants: string[];
  risks: string[];
  important_symbols: string[];
  next_steps: string[];
  history: Array<{
    event: "created" | "changed" | "split_from" | "merged_from";
    request_digest: string;
    at: string;
  }>;
  updated_at: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${label} must be an object`);
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
  return value;
}

function identifier(value: unknown, label: string): string {
  const result = stringValue(value, label);
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/u.test(result)) {
    fail(`${label} must use lowercase letters, digits, and hyphens`);
  }
  return result;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) fail(`${label} must be a positive integer`);
  return Number(value);
}

function stringArray(value: unknown, label: string, allowEmpty = true): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  return value.map((item, index) => stringValue(item, `${label}[${index}]`));
}

function unique(values: string[], label: string): string[] {
  if (new Set(values).size !== values.length) fail(`${label} must not contain duplicates`);
  return values;
}

function serialized(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function digestBytes(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function digestJson(value: unknown): string {
  return digestBytes(serialized(value));
}

function digestFile(path: string): string {
  return digestBytes(readFileSync(path));
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`cannot read JSON ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, serialized(value), { encoding: "utf8", flag: "wx" });
  renameSync(temporary, path);
}

function normalizeRepositoryPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  if (isAbsolute(normalized) || /^[A-Za-z]:\//u.test(normalized)) {
    fail(`owner scope must be repository-relative: ${value}`);
  }
  const segments = normalized.split("/");
  if (segments.includes("..")) fail(`owner scope must not contain ..: ${value}`);
  const cleaned = segments.filter((segment, index) => segment !== "" && !(segment === "." && index === 0));
  if (cleaned.includes(".")) fail(`owner scope must be normalized: ${value}`);
  const result = cleaned.join("/");
  if (!result) fail(`owner scope must be non-empty: ${value}`);
  return result;
}

function normalizePattern(value: string): string {
  const result = normalizeRepositoryPath(value);
  if (result === ".ghost-agent-workflow" || result.startsWith(".ghost-agent-workflow/")) {
    fail(`owner scope cannot claim workflow metadata: ${value}`);
  }
  return result;
}

function regexEscape(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
}

function globSegmentRegex(segment: string): RegExp {
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
      if (alternatives.length < 2 || alternatives.some((item) => item === "" || /[{}\/]/u.test(item))) {
        fail(`invalid glob alternation: ${segment}`);
      }
      expression += `(?:${alternatives.map(regexEscape).join("|")})`;
      index = end;
    } else expression += regexEscape(character);
  }
  return new RegExp(`^${expression}$`, "u");
}

function globRegex(pattern: string): RegExp {
  const segments = normalizePattern(pattern).split("/");
  let expression = "^";
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === "**") {
      expression += index === segments.length - 1 ? "(?:[^/]+(?:/|$))*" : "(?:[^/]+/)*";
    } else {
      expression += globSegmentRegex(segment).source.slice(1, -1);
      if (index < segments.length - 1) expression += "/";
    }
  }
  return new RegExp(`${expression}$`, "u");
}

function segmentMayOverlap(left: string, right: string): boolean {
  const leftGlob = /[?*[{]/u.test(left);
  const rightGlob = /[?*[{]/u.test(right);
  if (!leftGlob && !rightGlob) return left === right;
  if (!leftGlob) return globSegmentRegex(right).test(left);
  if (!rightGlob) return globSegmentRegex(left).test(right);
  return true;
}

function patternsOverlap(left: string, right: string): boolean {
  const a = normalizePattern(left).split("/");
  const b = normalizePattern(right).split("/");
  const memo = new Map<string, boolean>();
  function visit(ai: number, bi: number): boolean {
    const key = `${ai}:${bi}`;
    if (memo.has(key)) return memo.get(key) as boolean;
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

function patternCovers(parent: string, child: string): boolean {
  const normalizedParent = normalizePattern(parent);
  const normalizedChild = normalizePattern(child);
  if (normalizedParent === normalizedChild) return true;
  if (!/[?*[{]/u.test(normalizedChild)) return globRegex(normalizedParent).test(normalizedChild);
  const parentSegments = normalizedParent.split("/");
  const childSegments = normalizedChild.split("/");
  for (let index = 0; index < parentSegments.length; index += 1) {
    const parentSegment = parentSegments[index];
    const childSegment = childSegments[index];
    if (parentSegment === "**") return index === parentSegments.length - 1;
    if (childSegment === undefined) return false;
    if (parentSegment === childSegment) continue;
    if (/[?*[{]/u.test(childSegment)) return false;
    if (!globSegmentRegex(parentSegment).test(childSegment)) return false;
  }
  return parentSegments.length === childSegments.length;
}

function ownerMatches(owner: Pick<OwnerDefinition, "scope_patterns" | "scope_excludes">, path: string): boolean {
  return owner.scope_patterns.some((pattern) => globRegex(pattern).test(path)) &&
    !owner.scope_excludes.some((pattern) => globRegex(pattern).test(path));
}

function sorted(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function parseRequestedOwner(value: unknown, index: number): RequestedOwner {
  const source = record(value, `new_owners[${index}]`);
  const scopePatterns = unique(
    stringArray(source.scope_patterns, `new_owners[${index}].scope_patterns`, false).map(normalizePattern),
    `new_owners[${index}].scope_patterns`,
  );
  const scopeExcludes = unique(
    (source.scope_excludes === undefined
      ? []
      : stringArray(source.scope_excludes, `new_owners[${index}].scope_excludes`)
    ).map(normalizePattern),
    `new_owners[${index}].scope_excludes`,
  );
  for (const exclude of scopeExcludes) {
    if (!scopePatterns.some((include) => patternsOverlap(include, exclude))) {
      fail(`new_owners[${index}].scope_excludes is outside its includes: ${exclude}`);
    }
  }
  return {
    id: identifier(source.id, `new_owners[${index}].id`),
    responsibility: stringValue(source.responsibility, `new_owners[${index}].responsibility`),
    scope_patterns: scopePatterns,
    scope_excludes: scopeExcludes,
    worker_context: stringValue(source.worker_context, `new_owners[${index}].worker_context`),
  };
}

function parseOwner(value: unknown, index: number): OwnerDefinition {
  const source = record(value, `owners[${index}]`);
  if (source.status !== "active") fail(`owners[${index}].status must equal active`);
  const lineage = record(source.lineage, `owners[${index}].lineage`);
  const parents = lineage.parent_owner_ids === undefined
    ? (lineage.parent_owner_id === null || lineage.parent_owner_id === undefined
      ? []
      : [lineage.parent_owner_id])
    : stringArray(lineage.parent_owner_ids, `owners[${index}].lineage.parent_owner_ids`);
  return {
    ...parseRequestedOwner(source, index),
    generation: positiveInteger(source.generation, `owners[${index}].generation`),
    status: "active",
    lineage: {
      parent_owner_ids: unique(parents.map((parent, parentIndex) =>
        identifier(parent, `owners[${index}].lineage.parent_owner_ids[${parentIndex}]`),
      ), `owners[${index}].lineage.parent_owner_ids`),
      created_by_request_digest: stringValue(
        lineage.created_by_request_digest,
        `owners[${index}].lineage.created_by_request_digest`,
      ),
    },
  };
}

function assertNoScopeConflicts(owners: OwnerDefinition[]): void {
  for (let leftIndex = 0; leftIndex < owners.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < owners.length; rightIndex += 1) {
      for (const left of owners[leftIndex].scope_patterns) {
        for (const right of owners[rightIndex].scope_patterns) {
          if (!patternsOverlap(left, right)) continue;
          const leftRemovesRight = owners[leftIndex].scope_excludes.some((exclude) =>
            patternCovers(exclude, right),
          );
          const rightRemovesLeft = owners[rightIndex].scope_excludes.some((exclude) =>
            patternCovers(exclude, left),
          );
          if (!leftRemovesRight && !rightRemovesLeft) {
            fail(`owner scope conflict: ${owners[leftIndex].id}:${left} overlaps ${owners[rightIndex].id}:${right}`);
          }
        }
      }
    }
  }
}

function gitFiles(workspaceRoot: string): string[] {
  const result = spawnSync(
    "git",
    ["-C", workspaceRoot, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) fail(`git file inventory failed: ${result.stderr.trim()}`);
  return unique(
    result.stdout.split("\0").filter(Boolean).map(normalizeRepositoryPath),
    "git file inventory",
  );
}

function auditExistingFiles(registry: OwnerRegistry): void {
  const files = gitFiles(registry.workspace_root).filter(
    (path) => !path.startsWith(".ghost-agent-workflow/"),
  );
  for (const path of files) {
    if (!registry.managed_roots.some((pattern) => globRegex(pattern).test(path))) continue;
    const matches = registry.owners.filter((owner) => ownerMatches(owner, path));
    if (matches.length !== 1) {
      fail(`managed path must resolve to exactly one owner: ${path} (${matches.map((item) => item.id).join(", ") || "unowned"})`);
    }
  }
}

function parseRegistry(value: unknown, path: string, auditManagedPaths = true): OwnerRegistry {
  const source = record(value, "owner registry");
  const legacy = source.contract === "OWNER_REGISTRY_V1" && source.matcher === "owner-path-glob-v1";
  if (!legacy && source.contract !== "OWNER_REGISTRY_V2") {
    fail("owner registry contract must equal OWNER_REGISTRY_V2");
  }
  if (!legacy && source.matcher !== "owner-path-expression-v2") {
    fail("owner registry matcher must equal owner-path-expression-v2");
  }
  const workspaceRoot = resolve(stringValue(source.workspace_root, "owner registry.workspace_root"));
  const expectedRegistry = join(workspaceRoot, ".ghost-agent-workflow", "owners", "registry.json");
  if (resolve(path) !== expectedRegistry) fail(`owner registry path must equal ${expectedRegistry}`);
  if (!Array.isArray(source.owners)) fail("owner registry.owners must be an array");
  const owners = source.owners.map(parseOwner);
  unique(owners.map((owner) => owner.id), "owner ids");
  const retired = unique(
    stringArray(source.retired_owner_ids, "owner registry.retired_owner_ids").map((item, index) =>
      identifier(item, `owner registry.retired_owner_ids[${index}]`),
    ),
    "retired owner ids",
  );
  if (owners.some((owner) => retired.includes(owner.id))) fail("active and retired owner ids must be disjoint");
  const registry: OwnerRegistry = {
    contract: "OWNER_REGISTRY_V2",
    workspace_root: workspaceRoot,
    revision: positiveInteger(source.revision, "owner registry.revision"),
    matcher: "owner-path-expression-v2",
    managed_roots: unique(
      stringArray(source.managed_roots, "owner registry.managed_roots", false).map(normalizePattern),
      "owner registry.managed_roots",
    ),
    owners,
    retired_owner_ids: retired,
    updated_at: stringValue(source.updated_at, "owner registry.updated_at"),
  };
  assertNoScopeConflicts(registry.owners);
  if (auditManagedPaths && registry.owners.length === 0) fail("approved owner registry must contain at least one active owner");
  if (auditManagedPaths) auditExistingFiles(registry);
  return registry;
}

function parseRequest(value: unknown): OwnerChangeRequest {
  const source = record(value, "owner change request");
  if (source.contract !== "OWNER_CHANGE_REQUEST_V2") {
    fail("owner change request contract must equal OWNER_CHANGE_REQUEST_V2");
  }
  const operations = new Set(["create", "split", "expand", "shrink", "transfer", "merge"]);
  if (!operations.has(String(source.operation))) {
    fail("owner change request operation is invalid");
  }
  if (source.capsule_strategy !== "empty" && source.capsule_strategy !== "inherit_sources") {
    fail("owner change request capsule_strategy is invalid");
  }
  const sourceOwnerIds = unique(
    stringArray(source.source_owner_ids, "owner change request.source_owner_ids")
      .map((item, index) => identifier(item, `owner change request.source_owner_ids[${index}]`)),
    "owner change request.source_owner_ids",
  );
  const request: OwnerChangeRequest = {
    contract: "OWNER_CHANGE_REQUEST_V2",
    request_id: identifier(source.request_id, "owner change request.request_id"),
    operation: source.operation as OwnerChangeRequest["operation"],
    base_registry_digest: stringValue(source.base_registry_digest, "owner change request.base_registry_digest"),
    created_at: stringValue(source.created_at, "owner change request.created_at"),
    reason: stringValue(source.reason, "owner change request.reason"),
    source_owner_ids: sourceOwnerIds,
    new_owners: Array.isArray(source.new_owners)
      ? source.new_owners.map(parseRequestedOwner)
      : fail("owner change request.new_owners must be an array"),
    capsule_strategy: source.capsule_strategy,
  };
  if (request.new_owners.length === 0) fail("owner change request.new_owners must be non-empty");
  unique(request.new_owners.map((owner) => owner.id), "requested owner ids");
  if (request.operation === "create") {
    if (request.source_owner_ids.length !== 0) fail("create request source_owner_ids must be empty");
    if (request.capsule_strategy !== "empty") fail("create request capsule_strategy must equal empty");
  } else if (request.operation === "split") {
    if (request.source_owner_ids.length !== 1) fail("split request requires one source owner");
    if (request.new_owners.length < 2) fail("split request requires at least two new owners");
    if (request.capsule_strategy !== "inherit_sources") {
      fail("split request capsule_strategy must equal inherit_sources");
    }
  } else if (request.operation === "expand" || request.operation === "shrink") {
    if (request.source_owner_ids.length !== 1 || request.new_owners.length !== 1) {
      fail(`${request.operation} request requires one source and one replacement owner`);
    }
    if (request.source_owner_ids[0] !== request.new_owners[0].id) {
      fail(`${request.operation} replacement must retain the owner id`);
    }
    if (request.capsule_strategy !== "inherit_sources") fail(`${request.operation} must inherit sources`);
  } else if (request.operation === "transfer") {
    if (request.source_owner_ids.length !== 2 || request.new_owners.length !== 2) {
      fail("transfer request requires two source and two replacement owners");
    }
    if (serialized(sorted(request.source_owner_ids)) !== serialized(sorted(request.new_owners.map((owner) => owner.id)))) {
      fail("transfer replacements must retain both source owner ids");
    }
    if (request.capsule_strategy !== "inherit_sources") fail("transfer must inherit sources");
  } else {
    if (request.source_owner_ids.length < 2 || request.new_owners.length !== 1) {
      fail("merge request requires at least two sources and one merged owner");
    }
    if (request.capsule_strategy !== "inherit_sources") fail("merge must inherit sources");
  }
  return request;
}

function assertExpressionSubset(
  child: Pick<OwnerDefinition, "scope_patterns" | "scope_excludes">,
  parent: Pick<OwnerDefinition, "scope_patterns" | "scope_excludes">,
  label: string,
): void {
  for (const include of child.scope_patterns) {
    if (!parent.scope_patterns.some((candidate) => patternCovers(candidate, include))) {
      fail(`${label} include is outside source expression: ${include}`);
    }
    for (const parentExclude of parent.scope_excludes.filter((exclude) =>
      patternsOverlap(exclude, include),
    )) {
      if (!child.scope_excludes.some((exclude) => patternCovers(exclude, parentExclude))) {
        fail(`${label} reclaims a source exclusion: ${parentExclude}`);
      }
    }
  }
}

function assertExactRedistribution(
  sources: OwnerDefinition[],
  replacements: RequestedOwner[],
  label: string,
): void {
  for (const replacement of replacements) {
    assertExpressionSubset(
      replacement as OwnerDefinition,
      {
        scope_patterns: sources.flatMap((owner) => owner.scope_patterns),
        scope_excludes: sources.flatMap((owner) => owner.scope_excludes),
      },
      label,
    );
  }
  for (const source of sources) {
    for (const include of source.scope_patterns) {
      if (!replacements.some((owner) => owner.scope_patterns.includes(include))) {
        fail(`${label} must retain a remainder include for exact coverage: ${include}`);
      }
    }
  }
  const inheritedExcludes = sources.flatMap((owner) => owner.scope_excludes);
  for (const replacement of replacements) {
    for (const exclude of replacement.scope_excludes) {
      if (inheritedExcludes.some((candidate) => patternCovers(candidate, exclude))) continue;
      if (!replacements.some((other) =>
        other.id !== replacement.id && other.scope_patterns.some((include) => include === exclude)
      )) fail(`${label} exclusion is not claimed by another replacement: ${exclude}`);
    }
  }
}

function nextRegistry(
  registry: OwnerRegistry,
  request: OwnerChangeRequest,
  currentRegistryDigest: string,
): OwnerRegistry {
  const requestDigest = digestJson(request);
  if (request.base_registry_digest !== currentRegistryDigest) {
    fail("owner change request base_registry_digest does not match current registry");
  }
  const activeById = new Map(registry.owners.map((owner) => [owner.id, owner]));
  const sources = request.source_owner_ids.map((ownerId) => {
    const owner = activeById.get(ownerId);
    if (owner === undefined) fail(`source owner is not active: ${ownerId}`);
    return owner;
  });
  const replacementKeepsIds = request.operation === "expand" || request.operation === "shrink" ||
    request.operation === "transfer";
  const forbiddenIds = new Set([...activeById.keys(), ...registry.retired_owner_ids]);
  for (const owner of request.new_owners) {
    if (replacementKeepsIds && request.source_owner_ids.includes(owner.id)) continue;
    if (forbiddenIds.has(owner.id)) fail(`owner id is already active or retired: ${owner.id}`);
  }
  if (request.operation === "split" || request.operation === "transfer" || request.operation === "merge") {
    assertExactRedistribution(sources, request.new_owners, request.operation);
  } else if (request.operation === "expand") {
    assertExpressionSubset(sources[0], request.new_owners[0] as OwnerDefinition, "expand");
  } else if (request.operation === "shrink") {
    assertExpressionSubset(request.new_owners[0] as OwnerDefinition, sources[0], "shrink");
  }
  const retained = registry.owners.filter((owner) => !request.source_owner_ids.includes(owner.id));
  const retired = [...registry.retired_owner_ids];
  if (request.operation === "split" || request.operation === "merge") {
    retired.push(...request.source_owner_ids);
  }
  const additions: OwnerDefinition[] = request.new_owners.map((owner) => ({
    ...owner,
    generation: activeById.has(owner.id) ? (activeById.get(owner.id) as OwnerDefinition).generation + 1 : 1,
    status: "active",
    lineage: {
      parent_owner_ids: request.source_owner_ids,
      created_by_request_digest: requestDigest,
    },
  }));
  const result: OwnerRegistry = {
    ...registry,
    revision: registry.revision + 1,
    owners: [...retained, ...additions].sort((left, right) => left.id.localeCompare(right.id)),
    retired_owner_ids: unique(sorted(retired), "retired owner ids"),
    updated_at: request.created_at,
  };
  assertNoScopeConflicts(result.owners);
  auditExistingFiles(result);
  return result;
}

function capsulePath(registryPath: string, ownerId: string): string {
  return join(dirname(registryPath), ownerId, "capsule.json");
}

function newCapsule(
  owner: OwnerDefinition,
  registryRevision: number,
  request: OwnerChangeRequest,
  requestDigest: string,
  inherited: PersistentOwnerCapsule[],
): PersistentOwnerCapsule {
  const combined = <T>(select: (capsule: PersistentOwnerCapsule) => T[]): T[] =>
    [...new Set(inherited.flatMap(select))];
  const event = inherited.length === 0
    ? "created"
    : request.operation === "split"
      ? "split_from"
      : request.operation === "merge"
        ? "merged_from"
        : "changed";
  return {
    contract: "OWNER_CAPSULE_V2",
    owner_id: owner.id,
    generation: owner.generation,
    registry_revision: registryRevision,
    scope_patterns: owner.scope_patterns,
    scope_excludes: owner.scope_excludes,
    responsibility: owner.responsibility,
    worker_context: owner.worker_context,
    inherited_from: inherited.map((capsule) => capsule.owner_id),
    decisions: combined((capsule) => capsule.decisions),
    invariants: combined((capsule) => capsule.invariants),
    risks: combined((capsule) => capsule.risks),
    important_symbols: combined((capsule) => capsule.important_symbols),
    next_steps: combined((capsule) => capsule.next_steps),
    history: [
      ...combined((capsule) => capsule.history),
      {
        event,
        request_digest: requestDigest,
        at: request.created_at,
      },
    ],
    updated_at: request.created_at,
  };
}

function parsePersistentCapsule(value: unknown, ownerId: string): PersistentOwnerCapsule {
  const source = record(value, `owner capsule ${ownerId}`);
  if (source.contract !== "OWNER_CAPSULE_V2" || source.owner_id !== ownerId) {
    fail(`invalid persistent capsule for owner ${ownerId}`);
  }
  return {
    ...(source as unknown as PersistentOwnerCapsule),
    scope_excludes: source.scope_excludes === undefined
      ? []
      : stringArray(source.scope_excludes, `owner capsule ${ownerId}.scope_excludes`).map(normalizePattern),
    inherited_from: source.inherited_from === null
      ? []
      : Array.isArray(source.inherited_from)
        ? stringArray(source.inherited_from, `owner capsule ${ownerId}.inherited_from`)
        : [stringValue(source.inherited_from, `owner capsule ${ownerId}.inherited_from`)],
  };
}

function capsuleContainsChange(
  capsule: PersistentOwnerCapsule,
  registryRevision: number,
  requestDigest: string,
): boolean {
  return capsule.registry_revision === registryRevision &&
    capsule.history.some((entry) => entry.request_digest === requestDigest);
}

function activeGoalCount(workspaceRoot: string): number {
  const workflowRoot = join(workspaceRoot, ".ghost-agent-workflow");
  if (!existsSync(workflowRoot)) return 0;
  let count = 0;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && entry.name === "goal-state.json") {
        try {
          const goalState = record(readJson(path), `goal state ${path}`);
          if (goalState.status === "active") count += 1;
        } catch {
          fail(`cannot inspect active Goal state: ${path}`);
        }
      }
    }
  };
  visit(workflowRoot);
  return count;
}

function validateCommand(registryArgument: string): void {
  const registryPath = resolve(registryArgument);
  const registry = parseRegistry(readJson(registryPath), registryPath);
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    registry_digest: digestFile(registryPath),
    revision: registry.revision,
    active_owner_count: registry.owners.length,
    retired_owner_count: registry.retired_owner_ids.length,
  })}\n`);
}

function initCommand(workspaceArgument: string): void {
  const workspaceRoot = resolve(workspaceArgument);
  gitFiles(workspaceRoot);
  const registryPath = join(workspaceRoot, ".ghost-agent-workflow", "owners", "registry.json");
  if (existsSync(registryPath)) {
    const current = parseRegistry(readJson(registryPath), registryPath, false);
    process.stdout.write(`${JSON.stringify({
      status: current.owners.length === 0 ? "pending_owner_approval" : "current",
      registry_ref: registryPath,
      registry_digest: digestFile(registryPath),
      revision: current.revision,
    })}\n`);
    return;
  }
  const registry: OwnerRegistry = {
    contract: "OWNER_REGISTRY_V2",
    workspace_root: workspaceRoot,
    revision: 1,
    matcher: "owner-path-expression-v2",
    managed_roots: ["**"],
    owners: [],
    retired_owner_ids: [],
    updated_at: new Date().toISOString(),
  };
  writeJsonAtomic(registryPath, registry);
  process.stdout.write(`${JSON.stringify({
    status: "pending_owner_approval",
    registry_ref: registryPath,
    registry_digest: digestFile(registryPath),
    next_action: "submit a create request covering every managed path, validate it, and obtain explicit user approval",
  })}\n`);
}

function routeCommand(registryArgument: string, pathArgument: string): void {
  const registryPath = resolve(registryArgument);
  const registry = parseRegistry(readJson(registryPath), registryPath);
  const path = normalizePattern(pathArgument);
  const matches = registry.owners.filter((owner) => ownerMatches(owner, path));
  if (matches.length !== 1) {
    fail(`path must resolve to exactly one owner: ${path} (${matches.map((item) => item.id).join(", ") || "unowned"})`);
  }
  process.stdout.write(`${JSON.stringify({ path, owner_id: matches[0].id, registry_digest: digestFile(registryPath) })}\n`);
}

function requestChangeCommand(args: string[]): void {
  if (args.length < 5) {
    fail("request-change requires <registry.json> <request.json> <operation> <reason> and at least one --owner");
  }
  const registryPath = resolve(args[0]);
  const requestPath = resolve(args[1]);
  const operation = args[2] as OwnerChangeRequest["operation"];
  if (!["create", "split", "expand", "shrink", "transfer", "merge"].includes(operation)) {
    fail(`invalid owner change operation: ${operation}`);
  }
  const reason = stringValue(args[3], "reason");
  const registry = parseRegistry(readJson(registryPath), registryPath, false);
  const sourceOwnerIds: string[] = [];
  const owners = new Map<string, RequestedOwner>();
  for (let index = 4; index < args.length;) {
    const flag = args[index];
    if (flag === "--source") {
      sourceOwnerIds.push(identifier(args[index + 1], "source owner id"));
      index += 2;
      continue;
    }
    if (flag === "--owner") {
      const id = identifier(args[index + 1], "new owner id");
      if (owners.has(id)) fail(`duplicate --owner: ${id}`);
      owners.set(id, {
        id,
        responsibility: stringValue(args[index + 2], `owner ${id} responsibility`),
        worker_context: stringValue(args[index + 3], `owner ${id} worker_context`),
        scope_patterns: [],
        scope_excludes: [],
      });
      index += 4;
      continue;
    }
    if (flag === "--scope" || flag === "--exclude") {
      const id = identifier(args[index + 1], `${flag} owner id`);
      const owner = owners.get(id);
      if (owner === undefined) fail(`${flag} requires an earlier --owner ${id}`);
      const pattern = normalizePattern(args[index + 2]);
      if (flag === "--scope") owner.scope_patterns.push(pattern);
      else owner.scope_excludes.push(pattern);
      index += 3;
      continue;
    }
    fail(`unknown request-change argument: ${String(flag)}`);
  }
  const newOwners = [...owners.values()];
  if (newOwners.length === 0) fail("request-change requires at least one --owner");
  for (const owner of newOwners) {
    if (owner.scope_patterns.length === 0) fail(`owner ${owner.id} requires at least one --scope`);
  }
  unique(sourceOwnerIds, "source owner id");
  const semantic = {
    operation,
    base_registry_digest: digestFile(registryPath),
    reason,
    source_owner_ids: sourceOwnerIds,
    new_owners: newOwners,
    capsule_strategy: operation === "create" ? "empty" : "inherit_sources",
  };
  const request: OwnerChangeRequest = {
    contract: "OWNER_CHANGE_REQUEST_V2",
    request_id: `owner-change-${digestJson(semantic).slice(0, 12)}`,
    created_at: new Date().toISOString(),
    ...semantic,
  };
  parseRequest(request);
  if (existsSync(requestPath)) fail(`owner change request already exists: ${requestPath}`);
  writeJsonAtomic(requestPath, request);
  process.stdout.write(`${JSON.stringify({
    status: "created",
    request_ref: requestPath,
    request_digest: digestFile(requestPath),
    registry_revision: registry.revision,
  })}\n`);
}

function validateChangeCommand(
  registryArgument: string,
  requestArgument: string,
  outputArgument: string,
): void {
  const registryPath = resolve(registryArgument);
  const requestPath = resolve(requestArgument);
  const outputPath = resolve(outputArgument);
  const registry = parseRegistry(readJson(registryPath), registryPath, false);
  const request = parseRequest(readJson(requestPath));
  const registryDigest = digestFile(registryPath);
  const result = nextRegistry(registry, request, registryDigest);
  const validation: OwnerChangeValidation = {
    contract: "OWNER_CHANGE_VALIDATION_V2",
    status: "passed",
    request_digest: digestJson(request),
    base_registry_digest: registryDigest,
    next_registry_digest: digestJson(result),
    checks: [
      "request-schema",
      "base-registry-digest",
      "active-and-retired-id-uniqueness",
      "future-scope-language-disjointness",
      "current-managed-file-single-owner",
      ["split", "transfer", "merge"].includes(request.operation)
        ? "include-exclude-exact-redistribution"
        : `${request.operation}-scope-relation`,
    ],
    next_registry: result,
  };
  writeJsonAtomic(outputPath, validation);
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    validation_ref: outputPath,
    validation_digest: digestFile(outputPath),
    request_digest: validation.request_digest,
    next_registry_digest: validation.next_registry_digest,
    requires_user_approval: true,
  })}\n`);
}

function parseApproval(value: unknown): OwnerChangeApproval {
  const source = record(value, "owner change approval");
  if (source.contract !== "OWNER_CHANGE_APPROVAL_V2") {
    fail("owner change approval contract must equal OWNER_CHANGE_APPROVAL_V2");
  }
  if (source.decision !== "approved" || source.approved_by !== "user") {
    fail("owner change approval must be an explicit user approval");
  }
  return {
    contract: "OWNER_CHANGE_APPROVAL_V2",
    decision: "approved",
    approved_by: "user",
    approved_at: stringValue(source.approved_at, "owner change approval.approved_at"),
    request_digest: stringValue(source.request_digest, "owner change approval.request_digest"),
    validation_digest: stringValue(source.validation_digest, "owner change approval.validation_digest"),
    next_registry_digest: stringValue(source.next_registry_digest, "owner change approval.next_registry_digest"),
  };
}

function approveChangeCommand(
  requestArgument: string,
  validationArgument: string,
  approvalArgument: string,
): void {
  const requestPath = resolve(requestArgument);
  const validationPath = resolve(validationArgument);
  const approvalPath = resolve(approvalArgument);
  const request = parseRequest(readJson(requestPath));
  const validation = record(readJson(validationPath), "owner change validation");
  if (validation.contract !== "OWNER_CHANGE_VALIDATION_V2" || validation.status !== "passed") {
    fail("owner change validation is not passed");
  }
  const requestDigest = digestJson(request);
  const validationDigest = digestFile(validationPath);
  const nextRegistryDigest = stringValue(
    validation.next_registry_digest,
    "owner change validation.next_registry_digest",
  );
  if (validation.request_digest !== requestDigest) fail("owner change request digest mismatch");
  if (existsSync(approvalPath)) {
    const current = parseApproval(readJson(approvalPath));
    if (
      current.request_digest !== requestDigest ||
      current.validation_digest !== validationDigest ||
      current.next_registry_digest !== nextRegistryDigest
    ) fail("existing owner change approval is for different inputs");
    process.stdout.write(`${JSON.stringify({
      status: "current",
      approval_ref: approvalPath,
      approval_digest: digestFile(approvalPath),
    })}\n`);
    return;
  }
  const approval: OwnerChangeApproval = {
    contract: "OWNER_CHANGE_APPROVAL_V2",
    decision: "approved",
    approved_by: "user",
    approved_at: new Date().toISOString(),
    request_digest: requestDigest,
    validation_digest: validationDigest,
    next_registry_digest: nextRegistryDigest,
  };
  writeJsonAtomic(approvalPath, approval);
  process.stdout.write(`${JSON.stringify({
    status: "approved",
    approval_ref: approvalPath,
    approval_digest: digestFile(approvalPath),
  })}\n`);
}

function applyChangeCommand(
  registryArgument: string,
  requestArgument: string,
  validationArgument: string,
  approvalArgument: string,
): void {
  const registryPath = resolve(registryArgument);
  const requestPath = resolve(requestArgument);
  const validationPath = resolve(validationArgument);
  const approvalPath = resolve(approvalArgument);
  const registry = parseRegistry(readJson(registryPath), registryPath, false);
  const request = parseRequest(readJson(requestPath));
  const validation = record(readJson(validationPath), "owner change validation") as unknown as OwnerChangeValidation;
  const approval = parseApproval(readJson(approvalPath));
  if (validation.contract !== "OWNER_CHANGE_VALIDATION_V2" || validation.status !== "passed") {
    fail("owner change validation is not passed");
  }
  const requestDigest = digestJson(request);
  if (requestDigest !== validation.request_digest || requestDigest !== approval.request_digest) {
    fail("owner change request digest mismatch");
  }
  if (digestFile(validationPath) !== approval.validation_digest) {
    fail("owner change validation digest mismatch");
  }
  const approvedRegistry = parseRegistry(validation.next_registry, registryPath, false);
  const nextDigest = digestJson(approvedRegistry);
  if (
    nextDigest !== validation.next_registry_digest ||
    nextDigest !== approval.next_registry_digest
  ) fail("approved next owner registry digest mismatch");
  const currentRegistryDigest = digestFile(registryPath);
  if (currentRegistryDigest === nextDigest) {
    for (const requested of request.new_owners) {
      const path = capsulePath(registryPath, requested.id);
      if (!existsSync(path)) fail(`applied owner capsule is missing: ${path}`);
      const capsule = parsePersistentCapsule(readJson(path), requested.id);
      if (!capsuleContainsChange(capsule, approvedRegistry.revision, requestDigest)) {
        fail(`owner capsule does not contain the approved change: ${path}`);
      }
    }
    process.stdout.write(`${JSON.stringify({
      status: "current",
      operation: request.operation,
      revision: approvedRegistry.revision,
      registry_digest: nextDigest,
    })}\n`);
    return;
  }
  if (currentRegistryDigest !== validation.base_registry_digest) {
    fail("owner registry changed after validation");
  }
  if (activeGoalCount(registry.workspace_root) > 1) {
    fail("owner change requires only one active Goal; complete the other active Goals first");
  }
  const recomputed = nextRegistry(registry, request, currentRegistryDigest);
  if (digestJson(recomputed) !== nextDigest) fail("approved owner registry no longer reproduces");
  const inheritedById = new Map<string, PersistentOwnerCapsule>();
  for (const sourceOwnerId of request.source_owner_ids) {
    const path = capsulePath(registryPath, sourceOwnerId);
    if (!existsSync(path)) fail(`source owner capsule is missing: ${path}`);
    inheritedById.set(sourceOwnerId, parsePersistentCapsule(readJson(path), sourceOwnerId));
  }
  const alreadyApplied = new Set<string>();
  for (const requested of request.new_owners) {
    const path = capsulePath(registryPath, requested.id);
    if (!existsSync(path)) continue;
    const capsule = parsePersistentCapsule(readJson(path), requested.id);
    if (capsuleContainsChange(capsule, recomputed.revision, requestDigest)) {
      alreadyApplied.add(requested.id);
    } else if (!request.source_owner_ids.includes(requested.id)) {
      fail(`new owner capsule path already exists: ${path}`);
    }
  }
  for (const requested of request.new_owners) {
    if (alreadyApplied.has(requested.id)) continue;
    const owner = recomputed.owners.find((candidate) => candidate.id === requested.id) as OwnerDefinition;
    const inherited = request.operation === "transfer" || request.operation === "expand" ||
        request.operation === "shrink"
      ? [inheritedById.get(requested.id) as PersistentOwnerCapsule]
      : [...inheritedById.values()];
    writeJsonAtomic(
      capsulePath(registryPath, owner.id),
      newCapsule(owner, recomputed.revision, request, requestDigest, inherited),
    );
  }
  writeJsonAtomic(registryPath, recomputed);
  process.stdout.write(`${JSON.stringify({
    status: "applied",
    operation: request.operation,
    revision: recomputed.revision,
    registry_digest: nextDigest,
    added_owner_ids: request.new_owners.map((owner) => owner.id),
    source_owner_ids: request.source_owner_ids,
    retired_owner_ids: ["split", "merge"].includes(request.operation)
      ? request.source_owner_ids
      : [],
  })}\n`);
}

function main(argv: string[]): void {
  const [command, ...args] = argv;
  if (command === "init" && args.length === 1) return initCommand(args[0]);
  if (command === "validate" && args.length === 1) return validateCommand(args[0]);
  if (command === "route" && args.length === 2) return routeCommand(args[0], args[1]);
  if (command === "request-change" && args.length >= 5) return requestChangeCommand(args);
  if (command === "validate-change" && args.length === 3) {
    return validateChangeCommand(args[0], args[1], args[2]);
  }
  if (command === "approve-change" && args.length === 3) {
    return approveChangeCommand(args[0], args[1], args[2]);
  }
  if (command === "apply-change" && args.length === 4) {
    return applyChangeCommand(args[0], args[1], args[2], args[3]);
  }
  fail(
    "usage: owner-registry.mjs init <workspace> | validate <registry.json> | route <registry.json> <path> | request-change <registry.json> <request.json> <operation> <reason> [--source <id>] [--owner <id> <responsibility> <worker_context> --scope <id> <pattern> [--exclude <id> <pattern>]] | validate-change <registry.json> <request.json> <validation.json> | approve-change <request.json> <validation.json> <approval.json> | apply-change <registry.json> <request.json> <validation.json> <approval.json>",
  );
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
