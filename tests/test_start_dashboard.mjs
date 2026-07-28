import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  StartError,
  discoverDashboardData,
  parseArgs,
} from "../tooling/goal-dag/start-dashboard.mjs";

function writeJson(path, payload) {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createDashboardGoal(workspace, goalId, status = "active") {
  const directory = join(workspace, ".ghost-agent-workflow", goalId);
  mkdirSync(directory, { recursive: true });
  const goalPath = join(directory, "goal.json");
  const goalStatePath = join(directory, "goal-state.json");
  const planPath = join(directory, "plan.json");
  const statePath = join(directory, "state.json");
  writeJson(goalPath, {
    contract: "GOAL_CONTRACT_V1",
    goal_id: goalId,
    workspace: { root: workspace },
  });
  writeJson(planPath, {
    contract: "DAG_PLAN_V5",
    goal_id: goalId,
    goal_contract_path: goalPath,
  });
  writeJson(statePath, {
    contract: "DAG_RUN_STATE_V5",
    plan_digest: createHash("sha256").update(
      Buffer.from(`${JSON.stringify({
        contract: "DAG_PLAN_V5",
        goal_id: goalId,
        goal_contract_path: goalPath,
      }, null, 2)}\n`),
    ).digest("hex"),
  });
  writeJson(goalStatePath, {
    contract: "GOAL_STATE_V1",
    status,
    active_plan_path: planPath,
  });
  return { directory, goalPath, planPath, statePath };
}

function withWorkspace(callback) {
  const workspace = mkdtempSync(join(tmpdir(), "goal-dashboard-test-"));
  try {
    return callback(workspace);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

test("launcher accepts one workspace positional argument", () => {
  assert.deepEqual(parseArgs(["/workspace", "--goal", "goal-a", "--port", "7444"]), {
    workspace: "/workspace",
    goalId: "goal-a",
    host: "127.0.0.1",
    port: 7444,
    allowRemote: false,
  });
});

test("discovers the active Goal below .ghost-agent-workflow", () => {
  withWorkspace((workspace) => {
    const expected = createDashboardGoal(workspace, "goal-a");
    const discovered = discoverDashboardData(workspace);
    assert.equal(discovered.workspaceRoot, workspace);
    assert.equal(discovered.goalId, "goal-a");
    assert.equal(discovered.planPath, expected.planPath);
    assert.equal(discovered.statePath, expected.statePath);
  });
});

test("requires --goal when multiple active Goals are dashboard-ready", () => {
  withWorkspace((workspace) => {
    createDashboardGoal(workspace, "goal-a");
    const expected = createDashboardGoal(workspace, "goal-b");
    assert.throws(
      () => discoverDashboardData(workspace),
      (error) => error instanceof StartError && /pass --goal/u.test(error.message),
    );
    assert.equal(
      discoverDashboardData(workspace, "goal-b").planPath,
      expected.planPath,
    );
  });
});
