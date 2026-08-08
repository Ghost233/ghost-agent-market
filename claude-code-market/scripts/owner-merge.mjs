#!/usr/bin/env node
// owner-merge.mjs —— 合并各 owner 分支回主分支
//
// 用法：
//   owner-merge.mjs <workspace> <base> <owner1> [owner2 ...]
//
// 流程：
//   1. 调 scope-check merge 子命令做合并前校验（各 owner 分支 diff 全在 scope 内 + 跨 owner 不相交）。
//   2. 逐个 ff-only merge `ga/owner/<id>` 到当前分支（应在 base 上）。
//   3. 报告结果。失败则保留现场，不强行合并。
//
// 前提：各 owner 改动已在 `ga/owner/<id>` 分支上（由 owner-worker 提交，或 main 从 CC worktree 分支整理过来）。
// 退出码：0 成功，1 失败。

import { spawnSync } from "node:child_process";
import { gitOutput, fail } from "./scope-match.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const GIT_CAPTURE_MAX_BUFFER = 64 * 1024 * 1024;
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCOPE_CHECK = join(__dirname, "scope-check.mjs");

function gitAttempt(workspace, args) {
  const result = spawnSync("git", ["-C", workspace, ...args], { encoding: "utf8", maxBuffer: GIT_CAPTURE_MAX_BUFFER });
  return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr };
}

function runScopeCheckMerge(workspace, base, ownerIds) {
  const result = spawnSync(
    "node",
    [SCOPE_CHECK, "merge", workspace, base, ...ownerIds],
    { encoding: "utf8", maxBuffer: GIT_CAPTURE_MAX_BUFFER },
  );
  if (result.status !== 0) {
    fail(`合并前 scope 校验失败:\n${result.stderr || result.stdout}`);
  }
}

function ownerBranch(id) {
  return `ga/owner/${id}`;
}

function cmdMerge(workspace, base, ownerIds) {
  // 1. 合并前校验
  runScopeCheckMerge(workspace, base, ownerIds);

  // 2. 当前分支必须是 base（或 base 的后继），否则停下
  const currentBranch = gitOutput(workspace, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const baseSha = gitOutput(workspace, ["rev-parse", base]);
  const currentSha = gitOutput(workspace, ["rev-parse", "HEAD"]);
  const isMerged = gitAttempt(workspace, ["merge-base", "--is-ancestor", baseSha, currentSha]).ok;
  if (!isMerged) {
    fail(`当前 HEAD (${currentSha.slice(0,8)}) 未包含 base (${base})，请先切到 ${base} 的后继再合并`);
  }

  // 3. 逐个 no-ff merge（scope 不相交时改动不重叠，可安全合并）
  // 多 owner 顺序合并时，main 在第一个之后前进，后续分支与 main 分叉（非线性），
  // ff-only 会失败。用 --no-ff 生成合并提交，清晰标明每个 owner 的批次。
  const merged = [];
  for (const id of ownerIds) {
    const branch = ownerBranch(id);
    const noff = gitAttempt(workspace, ["merge", "--no-ff", "--no-edit", "-m", `merge: owner ${id}`, branch]);
    if (!noff.ok) {
      fail(`合并 ${branch} 失败:\n${noff.stderr}\nscope 不相交却冲突 → 说明 scope 漂移，停下排查。已合并: ${merged.join(", ") || "(无)"}`);
    }
    merged.push(id);
  }

  const finalHead = gitOutput(workspace, ["rev-parse", "HEAD"]);
  console.log(JSON.stringify({
    status: "ok",
    command: "merge",
    base,
    merged_owners: merged,
    head: finalHead.slice(0, 8),
  }));
}

function main() {
  const [, , workspace, base, ...ownerIds] = process.argv;
  if (!workspace || !base || ownerIds.length === 0) {
    console.error("usage: owner-merge.mjs <workspace> <base> <owner1> [owner2 ...]");
    process.exit(1);
  }
  try {
    cmdMerge(workspace, base, ownerIds);
  } catch (error) {
    console.error(error.scopeMatch ? error.message : (error.stack || error.message));
    process.exit(1);
  }
}

main();
