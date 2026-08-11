// scope-match.mjs —— scope 纯函数模块（所有校验/hook 的基石）
//
// 从 expert-registry.mjs:260-480 提取的 scope 匹配/相交检测纯函数，无副作用、无外部依赖（仅 node:path 的 isAbsolute）。
// 供 scope-check.mjs（静态/动态校验）和 enforce-scope.sh（经 node 调用）复用。
//
// owner 定义格式（.ghost-agent-workflow/owners/<id>..md frontmatter）：
//   id: payment-owner
//   scope: [payment/, config/payment.yaml]
//   scope_excludes: []  (可选)
// 本模块用 normalizeOwner 把它转成 {id, scope_patterns, scope_excludes} 内部表示，复用提取的函数。

import { isAbsolute } from "node:path";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// ---------- 错误 ----------

export function fail(message) {
  const error = new Error(message);
  error.scopeMatch = true;
  throw error;
}

// ---------- 路径/pattern 规范化 ----------

export function normalizeRepositoryPath(value) {
  const normalized = value.replaceAll("\\", "/");
  if (isAbsolute(normalized) || /^[A-Za-z]:\//u.test(normalized)) {
    fail(`owner scope must be repository-relative: ${value}`);
  }
  const trailingSlash = normalized.endsWith("/");
  const segments = normalized.split("/");
  if (segments.includes("..")) fail(`owner scope must not contain ..: ${value}`);
  const cleaned = segments.filter((segment, index) => segment !== "" && !(segment === "." && index === 0));
  if (cleaned.includes(".")) fail(`owner scope must be normalized: ${value}`);
  const result = cleaned.join("/");
  if (!result) fail(`owner scope must be non-empty: ${value}`);
  // 保留尾斜杠语义：foo/ 表示"foo 目录下所有"，foo 表示"名为 foo 的单文件"。
  // globRegex / patternsOverlap 依赖尾斜杠区分两者。
  return trailingSlash ? `${result}/` : result;
}

export function normalizePattern(value) {
  const result = normalizeRepositoryPath(value);
  if (result === ".ghost-agent-workflow" || result.startsWith(".ghost-agent-workflow/")) {
    fail(`owner scope cannot claim workflow metadata: ${value}`);
  }
  return result;
}

// ---------- glob 编译 ----------

export function regexEscape(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
}

export function globSegmentRegex(segment) {
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

export function globRegex(pattern) {
  const normalized = normalizePattern(pattern);
  // 尾斜杠 pattern（foo/）= foo 目录下所有内容，等价于 foo/**
  if (normalized.endsWith("/")) {
    const head = normalized.slice(0, -1);
    const segments = head.split("/");
    let expression = "^";
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (segment === "**") {
        expression += index === segments.length - 1 ? "(?:[^/]+(?:/|$))*" : "(?:[^/]+/)*";
      } else {
        expression += globSegmentRegex(segment).source.slice(1, -1);
        expression += "/";
      }
    }
    expression += "(?:[^/]+(?:/|$))*";
    return new RegExp(`${expression}$`, "u");
  }
  const segments = normalized.split("/");
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

// ---------- 相交/覆盖判断 ----------

export function segmentMayOverlap(left, right) {
  const leftGlob = /[?*[{]/u.test(left);
  const rightGlob = /[?*[{]/u.test(right);
  if (!leftGlob && !rightGlob) return left === right;
  if (!leftGlob) return globSegmentRegex(right).test(left);
  if (!rightGlob) return globSegmentRegex(left).test(right);
  return true;
}

export function patternsOverlap(left, right) {
  // 尾斜杠 pattern（foo/）= foo/**，统一转成 foo/** 形式参与 segment 比较。
  const toSegments = (p) => {
    const n = normalizePattern(p);
    return n.endsWith("/") ? [...n.slice(0, -1).split("/"), "**"] : n.split("/");
  };
  const a = toSegments(left);
  const b = toSegments(right);
  const memo = new Map();
  function visit(ai, bi) {
    const key = `${ai}:${bi}`;
    if (memo.has(key)) return memo.get(key);
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

export function patternCovers(parent, child) {
  const normalizedParent = normalizePattern(parent);
  const normalizedChild = normalizePattern(child);
  if (normalizedParent === normalizedChild) return true;
  // 尾斜杠 parent（foo/）= foo/**，用 globRegex 直接测 child。
  if (normalizedParent.endsWith("/")) return globRegex(normalizedParent).test(normalizePattern(child).replace(/\/$/, ""));
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

// ---------- owner 匹配 ----------

// owner 内部表示：{id, scope_patterns:[], scope_excludes:[]}
export function ownerMatches(owner, path) {
  return owner.scope_patterns.some((pattern) => globRegex(pattern).test(path)) &&
    !owner.scope_excludes.some((pattern) => globRegex(pattern).test(path));
}

// 两两不相交检测；相交（且无 exclude 消除）即 fail。
export function assertNoScopeConflicts(owners) {
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
            fail(`scope conflict: ${owners[leftIndex].id}:${left} overlaps ${owners[rightIndex].id}:${right}`);
          }
        }
      }
    }
  }
}

// ---------- owner 定义解析（适配本项目的 .md frontmatter 格式）----------

const IDENTIFIER_RE = /^[a-z0-9][a-z0-9-]{0,62}$/u;

// 极简 YAML frontmatter 解析：只取 scope / scope_excludes / id / responsibility。
// owner 定义是受控文件，格式简单，不必引入完整 YAML 依赖。
function parseOwnerFrontmatter(text, source) {
  if (!text.startsWith("---")) fail(`owner definition must start with frontmatter: ${source}`);
  const parts = text.split("---", 3);
  if (parts.length < 3) fail(`owner definition has malformed frontmatter: ${source}`);
  const fm = parts[1];
  const body = parts[2];

  const idMatch = fm.match(/^id:\s*(.+)$/mu);
  if (!idMatch) fail(`owner definition missing id: ${source}`);
  const id = idMatch[1].trim();
  if (!IDENTIFIER_RE.test(id)) fail(`owner id must match ${IDENTIFIER_RE}: ${id}`);

  const responsibilityMatch = fm.match(/^responsibility:\s*(.+)$/mu);
  const responsibility = responsibilityMatch ? responsibilityMatch[1].trim() : "";

  // scope: 列表项
  const scopePatterns = parseYamlList(fm, "scope").map(normalizePattern);
  if (scopePatterns.length === 0) fail(`owner ${id} must have non-empty scope`);
  const scopeExcludes = parseYamlList(fm, "scope_excludes").map(normalizePattern);

  return { id, responsibility, scope_patterns: scopePatterns, scope_excludes: scopeExcludes, body };
}

function parseYamlList(fm, key) {
  const lines = fm.split("\n");
  const items = [];
  let inList = false;
  const headerRe = new RegExp(`^${key}:\\s*(.*)$`, "u");
  const itemRe = /^\s*-\s+(.+)$/u;
  for (const line of lines) {
    if (headerRe.test(line)) {
      inList = true;
      const inline = line.replace(headerRe, "$1").trim();
      if (inline === "[]" || inline === "") continue;
      if (inline.startsWith("[") && inline.endsWith("]")) {
        inline.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean).forEach((s) => items.push(s));
      } else {
        items.push(inline);
      }
      continue;
    }
    if (inList) {
      const item = itemRe.exec(line);
      if (item) {
        items.push(item[1].trim());
      } else if (line.trim() === "") {
        continue;
      } else {
        inList = false;
      }
    }
  }
  return items;
}

// 读单个 owner 定义文件，返回内部表示。
export function parseOwnerFile(path, source) {
  const text = readFileSync(path, "utf8");
  return parseOwnerFrontmatter(text, source);
}

// 扫描 owners 目录，解析全部 owner 定义。
import { readdirSync } from "node:fs";
import { join } from "node:path";

export function loadAllOwners(ownersDir) {
  const entries = readdirSync(ownersDir, { withFileTypes: true });
  const owners = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const fullPath = join(ownersDir, entry.name);
    owners.push(parseOwnerFile(fullPath, fullPath));
  }
  return owners;
}

// ---------- git 工具 ----------

const GIT_CAPTURE_MAX_BUFFER = 64 * 1024 * 1024;

export function gitFiles(workspaceRoot) {
  const result = spawnSync(
    "git",
    ["-C", workspaceRoot, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8", maxBuffer: GIT_CAPTURE_MAX_BUFFER },
  );
  if (result.status !== 0) fail(`git file inventory failed: ${result.stderr.trim()}`);
  return result.stdout.split("\0").filter(Boolean).map(normalizeRepositoryPath);
}

export function gitDiffNames(workspaceRoot, base, head) {
  const result = spawnSync(
    "git",
    ["-C", workspaceRoot, "diff", "--name-only", "-z", `${base}..${head}`],
    { encoding: "utf8", maxBuffer: GIT_CAPTURE_MAX_BUFFER },
  );
  if (result.status !== 0) fail(`git diff failed: ${result.stderr.trim()}`);
  return result.stdout.split("\0").filter(Boolean).map(normalizeRepositoryPath);
}

export function gitOutput(workspaceRoot, args) {
  const result = spawnSync("git", ["-C", workspaceRoot, ...args], { encoding: "utf8", maxBuffer: GIT_CAPTURE_MAX_BUFFER });
  if (result.status !== 0) fail(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.replace(/\n$/, "");
}
