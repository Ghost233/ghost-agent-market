#!/usr/bin/env node
// scope-check.mjs —— 两段式 scope 校验（实例化静态 + 合并前动态）
//
// 子命令：
//   scope-check.mjs static <workspace>                 扫所有 owner 定义，两两 scope 不相交检测
//   scope-check.mjs diff <workspace> <owner-id> <base> 校验 owner 分支相对 base 的 diff 全在其 scope 内
//   scope-check.mjs merge <workspace> <base> <owner1> <owner2> ...  合并前：各 owner 分支 scope 校验 + 跨 owner diff 相交检测
//
// 退出码：0 通过，1 越界/相交/错误。stdout 给机器收据，stderr 给人。
// 复用 scope-match.mjs 的纯函数。

import { loadAllOwners, assertNoScopeConflicts, ownerMatches, gitDiffNames, gitOutput, fail } from "./scope-match.mjs";
import { join } from "node:path";

function ownersDir(workspace) {
  return join(workspace, ".ghost-agent-workflow", "owners");
}

function findOwner(owners, id) {
  const owner = owners.find((o) => o.id === id);
  if (!owner) fail(`owner not found: ${id}`);
  return owner;
}

function ownerBranch(id) {
  return `ga/owner/${id}`;
}

// static：扫所有 owner 定义，两两不相交。
function cmdStatic(workspace) {
  const owners = loadAllOwners(ownersDir(workspace));
  assertNoScopeConflicts(owners);
  console.log(JSON.stringify({ status: "ok", command: "static", owner_count: owners.length, owners: owners.map((o) => o.id) }));
}

// diff：校验单个 owner 分支相对 base 的改动全在其 scope 内。
function cmdDiff(workspace, ownerId, base) {
  const owners = loadAllOwners(ownersDir(workspace));
  const owner = findOwner(owners, ownerId);
  const head = ownerBranch(ownerId);
  const changed = gitDiffNames(workspace, base, head);
  const outside = changed.filter((path) => !ownerMatches(owner, path));
  if (outside.length > 0) {
    fail(`owner ${ownerId} 分支有 ${outside.length} 个越界文件:\n  ${outside.join("\n  ")}`);
  }
  console.log(JSON.stringify({ status: "ok", command: "diff", owner: ownerId, base, changed_files: changed.length }));
}

// merge：合并前动态校验。
// 1) 各 owner 分支相对 base 的改动全在各自 scope 内；
// 2) 跨 owner 的实际改动文件集两两不相交（抓运行中漂移相交）。
function cmdMerge(workspace, base, ownerIds) {
  const owners = loadAllOwners(ownersDir(workspace));
  const ownerById = new Map(owners.map((o) => [o.id, o]));
  const changedPerOwner = new Map();
  for (const id of ownerIds) {
    const owner = findOwner(owners, id);
    const changed = gitDiffNames(workspace, base, ownerBranch(id));
    const outside = changed.filter((path) => !ownerMatches(owner, path));
    if (outside.length > 0) {
      fail(`owner ${id} 分支有 ${outside.length} 个越界文件（合并前校验）:\n  ${outside.join("\n  ")}`);
    }
    changedPerOwner.set(id, new Set(changed));
  }
  // 跨 owner 实际改动文件集相交检测
  const ids = [...changedPerOwner.keys()];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = changedPerOwner.get(ids[i]);
      const b = changedPerOwner.get(ids[j]);
      const shared = [...a].filter((p) => b.has(p));
      if (shared.length > 0) {
        fail(`合并前检测到 ${ids[i]} 与 ${ids[j]} 实际改动相交（${shared.length} 个共同文件）:\n  ${shared.join("\n  ")}`);
      }
    }
  }
  console.log(JSON.stringify({ status: "ok", command: "merge", base, owners: ownerIds }));
}

function main() {
  const [, , subcommand, ...rest] = process.argv;
  try {
    if (subcommand === "static") {
      const [workspace] = rest;
      if (!workspace) fail("usage: scope-check.mjs static <workspace>");
      cmdStatic(workspace);
    } else if (subcommand === "diff") {
      const [workspace, ownerId, base] = rest;
      if (!workspace || !ownerId || !base) fail("usage: scope-check.mjs diff <workspace> <owner-id> <base>");
      cmdDiff(workspace, ownerId, base);
    } else if (subcommand === "merge") {
      const [workspace, base, ...ownerIds] = rest;
      if (!workspace || !base || ownerIds.length === 0) fail("usage: scope-check.mjs merge <workspace> <base> <owner1> [owner2 ...]");
      cmdMerge(workspace, base, ownerIds);
    } else {
      fail(`unknown subcommand: ${subcommand ?? "(none)"}; expected static|diff|merge`);
    }
  } catch (error) {
    const message = error.scopeMatch ? error.message : (error.stack || error.message);
    console.error(message);
    process.exit(1);
  }
}

main();
