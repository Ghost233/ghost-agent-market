// Generated from tooling/thread-plan/thread-plan.ts. Do not edit directly.
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";




























































































const FAILURE_STATUSES = new Set            ([
  "blocked",
  "failed",
  "needs_main_review",
  "dependency_blocked",
]);

const REASONING_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

function fail(message        )        {
  throw new Error(message);
}

function isRecord(value         )                                   {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value         , label        )                          {
  if (!isRecord(value)) fail(`${label} must be an object`);
  return value;
}

function requireString(value         , label        )         {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function requirePositiveInteger(value         , label        )         {
  if (!Number.isInteger(value) || (value          ) < 1) {
    fail(`${label} must be a positive integer`);
  }
  return value          ;
}

function requireStringArray(
  value         ,
  label        ,
  allowEmpty = true,
)           {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const result = value.map((item, index) =>
    requireString(item, `${label}[${index}]`),
  );
  if (!allowEmpty && result.length === 0) fail(`${label} must not be empty`);
  return result;
}

function readJson(path        )          {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot read JSON ${path}: ${message}`);
  }
}

function serializedJson(value         )         {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJson(path        , value         )       {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, serializedJson(value), {
    encoding: "utf8",
    flag: "wx",
  });
  try {
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function digestFile(path        )         {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function digestJson(value         )         {
  return createHash("sha256").update(serializedJson(value)).digest("hex");
}

function sleep(milliseconds        )       {
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
    0,
    0,
    milliseconds,
  );
}

function processIsAlive(pid         )          {
  if (!Number.isInteger(pid)) return true;
  try {
    process.kill(pid          , 0);
    return true;
  } catch (error) {
    return !isRecord(error) || error.code !== "ESRCH";
  }
}

function removeStaleLock(lockPath        )          {
  const reaperRoot = `${lockPath}.reaper`;
  const reaperToken = randomUUID();
  const temporaryPath = `${reaperRoot}.${process.pid}.${reaperToken}.tmp`;
  let ownedReaperPath = "";
  try {
    const observed = requireRecord(readJson(lockPath), "state lock");
    if (processIsAlive(observed.pid)) return false;
    if (typeof observed.token !== "string" || !observed.token) return false;
    const lockToken = observed.token;
    const lockTokenDigest = createHash("sha256")
      .update(lockToken)
      .digest("hex")
      .slice(0, 16);
    writeFileSync(
      temporaryPath,
      `${JSON.stringify({
        pid: process.pid,
        token: reaperToken,
        lock_token: lockToken,
      })}\n`,
      { encoding: "utf8", flag: "wx" },
    );

    // A crashed reaper leaves its generation as evidence. The next live
    // waiter advances to a lock-token-specific generation instead of deleting
    // or reusing a coordination path that another process may still own.
    for (let generation = 0; generation < 1_024; generation += 1) {
      const reaperPath =
        generation === 0
          ? reaperRoot
          : `${reaperRoot}.${lockTokenDigest}.${generation}`;
      try {
        linkSync(temporaryPath, reaperPath);
        ownedReaperPath = reaperPath;
        break;
      } catch (error) {
        if (!isRecord(error) || error.code !== "EEXIST") throw error;
        const incumbent = requireRecord(
          readJson(reaperPath),
          "state lock reaper",
        );
        if (processIsAlive(incumbent.pid)) return false;
        if (generation > 0 && incumbent.lock_token !== lockToken) return false;
      }
    }
    if (!ownedReaperPath) return false;

    const current = requireRecord(readJson(lockPath), "state lock");
    if (current.token !== lockToken || processIsAlive(current.pid)) {
      return false;
    }
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  } finally {
    if (ownedReaperPath) {
      try {
        const reaper = requireRecord(
          readJson(ownedReaperPath),
          "state lock reaper",
        );
        if (reaper.token === reaperToken) unlinkSync(ownedReaperPath);
      } catch {
        // Never remove a reaper that can no longer be proven to be ours.
      }
    }
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function withStateLock   (statePath        , operation         )    {
  const lockPath = `${statePath}.lock`;
  const token = randomUUID();
  const temporaryPath = `${lockPath}.${process.pid}.${token}.tmp`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify({
      pid: process.pid,
      created_at: Date.now(),
      token,
    })}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  const deadline = Date.now() + 5_000;
  let acquired = false;
  try {
    while (!acquired) {
      try {
        linkSync(temporaryPath, lockPath);
        acquired = true;
      } catch (error) {
        if (!isRecord(error) || error.code !== "EEXIST") throw error;
        if (removeStaleLock(lockPath)) continue;
        if (Date.now() >= deadline) fail(`state is busy: ${statePath}`);
        sleep(10);
      }
    }
    return operation();
  } finally {
    if (acquired) {
      try {
        const lock = requireRecord(readJson(lockPath), "state lock");
        if (lock.token === token) unlinkSync(lockPath);
      } catch {
        // Never remove a lock that can no longer be proven to be ours.
      }
    }
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function ensureUnique(values          , label        )       {
  const seen = new Set        ();
  for (const value of values) {
    if (seen.has(value)) fail(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function parseModule(value         , index        )                   {
  const module = requireRecord(value, `modules[${index}]`);
  const profile = requireRecord(
    module.worker_profile,
    `modules[${index}].worker_profile`,
  );
  const reasoningEffort = requireString(
    profile.reasoning_effort,
    `modules[${index}].worker_profile.reasoning_effort`,
  );
  if (!REASONING_EFFORTS.has(reasoningEffort)) {
    fail(
      `modules[${index}].worker_profile.reasoning_effort is invalid: ${reasoningEffort}`,
    );
  }
  return {
    id: requireString(module.id, `modules[${index}].id`),
    worker_profile: {
      model: requireString(
        profile.model,
        `modules[${index}].worker_profile.model`,
      ),
      reasoning_effort: reasoningEffort,
    },
    worker_context: requireString(
      module.worker_context,
      `modules[${index}].worker_context`,
    ),
  };
}

function parseTask(value         , index        )                 {
  const task = requireRecord(value, `tasks[${index}]`);
  const id = requireString(task.id, `tasks[${index}].id`);
  const logicalId =
    task.logical_id === undefined
      ? id
      : requireString(task.logical_id, `tasks[${index}].logical_id`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,95}$/.test(logicalId)) {
    fail(`tasks[${index}].logical_id is invalid: ${logicalId}`);
  }
  const taskText = requireString(task.task, `tasks[${index}].task`);
  const rawTitle =
    task.title === undefined
      ? taskText.slice(0, 80)
      : requireString(task.title, `tasks[${index}].title`);
  const title = rawTitle.trim();
  if (title.length > 80) {
    fail(`tasks[${index}].title must be at most 80 characters`);
  }
  if (
    /^(等待(完整)?绑定包|等待分派|T\d+[A-Za-z0-9._-]*)$/i.test(title)
  ) {
    fail(`tasks[${index}].title is a generic placeholder: ${title}`);
  }
  return {
    id,
    logical_id: logicalId,
    title,
    module_id: requireString(task.module_id, `tasks[${index}].module_id`),
    task: taskText,
    depends_on: requireStringArray(
      task.depends_on,
      `tasks[${index}].depends_on`,
    ),
    writable_paths: requireStringArray(
      task.writable_paths,
      `tasks[${index}].writable_paths`,
    ),
    done_when: requireStringArray(
      task.done_when,
      `tasks[${index}].done_when`,
      false,
    ),
    verification: requireStringArray(
      task.verification,
      `tasks[${index}].verification`,
      false,
    ),
  };
}

function parseContinuation(value         )                           {
  if (value === undefined) return undefined;
  const source = requireRecord(value, "continuation");
  const reuse = requireRecord(source.reuse, "continuation.reuse");
  const replacements = requireRecord(
    source.replacements,
    "continuation.replacements",
  );
  return {
    previous_plan_path: requireString(
      source.previous_plan_path,
      "continuation.previous_plan_path",
    ),
    reviewed_task_ids: requireStringArray(
      source.reviewed_task_ids,
      "continuation.reviewed_task_ids",
    ),
    replacements: Object.fromEntries(
      Object.entries(replacements).map(([sourceTaskId, targetTaskIds]) => [
        sourceTaskId,
        requireStringArray(
          targetTaskIds,
          `continuation.replacements.${sourceTaskId}`,
          false,
        ),
      ]),
    ),
    reuse: Object.fromEntries(
      Object.entries(reuse).map(([targetTaskId, rawBinding]) => {
        const binding = requireRecord(
          rawBinding,
          `continuation.reuse.${targetTaskId}`,
        );
        const mode = requireString(
          binding.mode,
          `continuation.reuse.${targetTaskId}.mode`,
        );
        if (mode !== "continue" && mode !== "handoff") {
          fail(`continuation.reuse.${targetTaskId}.mode is invalid: ${mode}`);
        }
        return [
          targetTaskId,
          {
            from_task: requireString(
              binding.from_task,
              `continuation.reuse.${targetTaskId}.from_task`,
            ),
            mode,
          },
        ];
      }),
    ),
  };
}

function parsePlan(value         )       {
  const source = requireRecord(value, "plan");
  const expectedExecutionPlatform = "codex";
  if (source.planner !== "parallel-task-planner") {
    fail("planner must equal parallel-task-planner");
  }
  if (source.plan_format_version !== 3) {
    fail("plan_format_version must equal 3");
  }
  if (source.execution_platform !== expectedExecutionPlatform) {
    fail(`execution_platform must equal ${expectedExecutionPlatform}`);
  }
  if (!Array.isArray(source.modules) || source.modules.length === 0) {
    fail("modules must be a non-empty array");
  }
  if (!Array.isArray(source.tasks) || source.tasks.length === 0) {
    fail("tasks must be a non-empty array");
  }
  const safety = requireRecord(source.safety, "safety");
  if (
    safety.status !== "parallel_safe" &&
    safety.status !== "sequential_only" &&
    safety.status !== "needs_user_review"
  ) {
    fail("safety.status is invalid");
  }

  return {
    planner: "parallel-task-planner",
    plan_format_version: 3,
    revision:
      source.revision === undefined
        ? 1
        : requirePositiveInteger(source.revision, "revision"),
    execution_platform: source.execution_platform,
    parent_goal: requireString(source.parent_goal, "parent_goal"),
    modules: source.modules.map(parseModule),
    tasks: source.tasks.map(parseTask),
    continuation: parseContinuation(source.continuation),
    project_verification: requireStringArray(
      source.project_verification,
      "project_verification",
      false,
    ),
    safety: {
      status: safety.status,
      reasons: requireStringArray(safety.reasons, "safety.reasons"),
    },
  };
}

function buildAncestors(tasks                  )                           {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set        ();
  const complete = new Set        ();
  const ancestors = new Map                     ();

  function visit(taskId        )              {
    if (complete.has(taskId)) return ancestors.get(taskId)               ;
    if (visiting.has(taskId)) fail(`task dependency cycle detected at ${taskId}`);
    visiting.add(taskId);
    const task = byId.get(taskId)                  ;
    const result = new Set        ();
    for (const dependencyId of task.depends_on) {
      result.add(dependencyId);
      for (const ancestorId of visit(dependencyId)) result.add(ancestorId);
    }
    visiting.delete(taskId);
    complete.add(taskId);
    ancestors.set(taskId, result);
    return result;
  }

  for (const task of tasks) visit(task.id);
  return ancestors;
}

function pathPrefix(pattern        )         {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
  const wildcard = normalized.search(/[?*[{]/);
  const prefix = wildcard === -1 ? normalized : normalized.slice(0, wildcard);
  return prefix.replace(/\/+$/, "");
}

function pathsOverlap(left        , right        )          {
  const a = pathPrefix(left);
  const b = pathPrefix(right);
  if (a === "" || b === "") return true;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function validateGraph(plan      )                           {
  ensureUnique(plan.modules.map((module) => module.id), "module id");
  ensureUnique(plan.tasks.map((task) => task.id), "task id");
  ensureUnique(plan.tasks.map((task) => task.logical_id), "logical task id");
  const moduleIds = new Set(plan.modules.map((module) => module.id));
  const taskIds = new Set(plan.tasks.map((task) => task.id));

  for (const task of plan.tasks) {
    if (!moduleIds.has(task.module_id)) {
      fail(`task ${task.id} references unknown module_id: ${task.module_id}`);
    }
    ensureUnique(task.depends_on, `dependency in task ${task.id}`);
    for (const dependencyId of task.depends_on) {
      if (!taskIds.has(dependencyId)) {
        fail(`task ${task.id} references unknown task: ${dependencyId}`);
      }
      if (dependencyId === task.id) {
        fail(`task dependency cycle detected at ${task.id}`);
      }
    }
  }

  const ancestors = buildAncestors(plan.tasks);
  for (let leftIndex = 0; leftIndex < plan.tasks.length; leftIndex += 1) {
    const left = plan.tasks[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < plan.tasks.length;
      rightIndex += 1
    ) {
      const right = plan.tasks[rightIndex];
      const comparable =
        ancestors.get(left.id)?.has(right.id) === true ||
        ancestors.get(right.id)?.has(left.id) === true;
      const conflict = left.writable_paths.some((leftPath) =>
        right.writable_paths.some((rightPath) =>
          pathsOverlap(leftPath, rightPath),
        ),
      );
      if (conflict && !comparable) {
        fail(`writable_paths conflict between ${left.id} and ${right.id}`);
      }
    }
  }

  const hasParallelPair = plan.tasks.some((left, leftIndex) =>
    plan.tasks.slice(leftIndex + 1).some((right) =>
      !ancestors.get(left.id)?.has(right.id) &&
      !ancestors.get(right.id)?.has(left.id),
    ),
  );
  if (plan.safety.status === "parallel_safe" && !hasParallelPair) {
    fail("safety.status parallel_safe requires at least two incomparable tasks");
  }
  if (plan.safety.status === "sequential_only" && hasParallelPair) {
    fail("safety.status sequential_only contradicts the task DAG");
  }

  return ancestors;
}

function buildRoutes(
  plan      ,
  ancestors                          ,
  resumeRoutes                    ,
)                        {
  const matchedTargetToSource = new Map                ();
  const taskById = new Map(plan.tasks.map((task) => [task.id, task]));
  const resumedTargets = new Set(resumeRoutes.keys());

  function augment(source                , seen             )          {
    for (const target of plan.tasks) {
      const candidate =
        !resumedTargets.has(target.id) &&
        source.id !== target.id &&
        source.module_id === target.module_id &&
        ancestors.get(target.id)?.has(source.id) === true;
      if (!candidate || seen.has(target.id)) continue;
      seen.add(target.id);
      const previousSourceId = matchedTargetToSource.get(target.id);
      if (
        previousSourceId === undefined ||
        augment(taskById.get(previousSourceId)                  , seen)
      ) {
        matchedTargetToSource.set(target.id, source.id);
        return true;
      }
    }
    return false;
  }

  for (const source of plan.tasks) augment(source, new Set        ());

  return Object.fromEntries(
    plan.tasks.map((task) => {
      const resumeRoute = resumeRoutes.get(task.id);
      if (resumeRoute !== undefined) return [task.id, resumeRoute];
      const sourceId = matchedTargetToSource.get(task.id);
      return [
        task.id,
        sourceId === undefined
          ? { action: "create" }
          : { action: "reuse", from_task: sourceId },
      ];
    }),
  );
}

function resolveContinuationRoutes(
  planPath        ,
  plan      ,
)                         {
  const routes = new Map               ();
  const continuation = plan.continuation;
  if (continuation === undefined) {
    if (plan.revision !== 1) {
      fail("a plan without continuation must have revision 1");
    }
    return {
      routes,
      previous_state_path: null,
    };
  }
  if (!isAbsolute(continuation.previous_plan_path)) {
    fail("continuation.previous_plan_path must be absolute");
  }
  const previousPlanPath = resolve(continuation.previous_plan_path);
  if (previousPlanPath === planPath) {
    fail("continuation.previous_plan_path must reference an older plan");
  }
  if (statePathFor(previousPlanPath) === statePathFor(planPath)) {
    fail("continuation plans must use separate plan directories");
  }
  const { plan: previousPlan, state: previousState } = loadPlanAndState(
    previousPlanPath,
    statePathFor(previousPlanPath),
  );
  if (previousPlan.parent_goal !== plan.parent_goal) {
    fail("continuation parent_goal does not match the previous plan");
  }
  if (plan.revision !== previousPlan.revision + 1) {
    fail("continuation revision must increment the previous revision by one");
  }
  if (
    previousState.continued_by !== null &&
    previousState.continued_by !== planPath
  ) {
    fail(`previous plan already continued by ${previousState.continued_by}`);
  }

  const runningPreviousTasks = previousPlan.tasks.filter(
    (task) => previousState.tasks[task.id].status === "running",
  );
  if (runningPreviousTasks.length > 0) {
    fail(
      `continuation previous plan still has running tasks: ${runningPreviousTasks
        .map((task) => task.id)
        .join(", ")}`,
    );
  }
  ensureUnique(
    continuation.reviewed_task_ids,
    "continuation reviewed task id",
  );
  const unfinishedTaskIds = previousPlan.tasks
    .filter((task) => previousState.tasks[task.id].status !== "completed")
    .map((task) => task.id)
    .sort();
  const reviewedTaskIds = [...continuation.reviewed_task_ids].sort();
  if (JSON.stringify(unfinishedTaskIds) !== JSON.stringify(reviewedTaskIds)) {
    fail("continuation.reviewed_task_ids must cover every unfinished previous task");
  }
  const replacementSourceIds = Object.keys(continuation.replacements).sort();
  if (JSON.stringify(replacementSourceIds) !== JSON.stringify(reviewedTaskIds)) {
    fail("continuation.replacements must cover every reviewed previous task");
  }

  const currentById = new Map(plan.tasks.map((task) => [task.id, task]));
  const previousById = new Map(
    previousPlan.tasks.map((task) => [task.id, task]),
  );
  const currentModuleById = new Map(
    plan.modules.map((module) => [module.id, module]),
  );
  const previousModuleById = new Map(
    previousPlan.modules.map((module) => [module.id, module]),
  );
  const reusedThreadIds = new Set        ();
  for (const [sourceTaskId, targetTaskIds] of Object.entries(
    continuation.replacements,
  )) {
    for (const targetTaskId of targetTaskIds) {
      if (!currentById.has(targetTaskId)) {
        fail(
          `continuation replacement references unknown target task: ${targetTaskId}`,
        );
      }
    }
    if (!previousById.has(sourceTaskId)) {
      fail(
        `continuation replacement references unknown previous task: ${sourceTaskId}`,
      );
    }
  }
  for (const [targetTaskId, binding] of Object.entries(
    continuation.reuse,
  )) {
    const sourceTaskId = binding.from_task;
    const targetTask = currentById.get(targetTaskId);
    if (targetTask === undefined) {
      fail(`continuation references unknown target task: ${targetTaskId}`);
    }
    const sourceTask = previousById.get(sourceTaskId);
    if (sourceTask === undefined) {
      fail(`continuation references unknown previous task: ${sourceTaskId}`);
    }
    if (targetTask.module_id !== sourceTask.module_id) {
      fail(
        `continuation module mismatch: ${targetTaskId} cannot reuse ${sourceTaskId}`,
      );
    }
    const currentModule = currentModuleById.get(targetTask.module_id);
    const previousModule = previousModuleById.get(sourceTask.module_id);
    if (
      JSON.stringify(currentModule) !== JSON.stringify(previousModule)
    ) {
      fail(
        `continuation module definition changed: ${targetTask.module_id}`,
      );
    }
    const sourceState = previousState.tasks[sourceTaskId];
    if (
      sourceState.status !== "completed" &&
      sourceState.status !== "needs_main_review"
    ) {
      fail(`continuation source task is not reusable: ${sourceTaskId}`);
    }
    if (
      binding.mode === "continue" &&
      targetTask.logical_id !== sourceTask.logical_id
    ) {
      fail(
        `continuation logical_id changed for continued task: ${sourceTaskId}`,
      );
    }
    if (binding.mode === "handoff" && sourceState.status !== "completed") {
      fail(`continuation handoff source must be completed: ${sourceTaskId}`);
    }
    if (
      binding.mode === "handoff" &&
      targetTask.logical_id === sourceTask.logical_id
    ) {
      fail(`continuation handoff must change logical_id: ${sourceTaskId}`);
    }
    if (
      sourceState.status !== "completed" &&
      !continuation.replacements[sourceTaskId]?.includes(targetTaskId)
    ) {
      fail(
        `continuation reuse target must replace unfinished task: ${sourceTaskId}`,
      );
    }
    if (typeof sourceState.thread_id !== "string") {
      fail(`continuation source thread is unavailable: ${sourceTaskId}`);
    }
    if (reusedThreadIds.has(sourceState.thread_id)) {
      fail(`continuation reuses thread more than once: ${sourceState.thread_id}`);
    }
    reusedThreadIds.add(sourceState.thread_id);
    routes.set(targetTaskId, {
      action: "resume",
      from_plan: previousPlanPath,
      from_task: sourceTaskId,
      thread_id: sourceState.thread_id,
      mode: binding.mode,
    });
  }
  return {
    routes,
    previous_state_path: statePathFor(previousPlanPath),
  };
}

function commitContinuationClaim(
  previousStatePath        ,
  planPath        ,
)                {
  return withStateLock(previousStatePath, () => {
    const claimedPlanPath = readContinuationClaimPlan(previousStatePath);
    if (claimedPlanPath !== null) {
      if (claimedPlanPath !== planPath) {
        fail(`previous plan already continued by ${claimedPlanPath}`);
      }
      return null;
    }

    const previousPlanPath = join(dirname(previousStatePath), "plan.json");
    const { state } = loadPlanAndState(previousPlanPath, previousStatePath);
    if (state.continued_by !== null && state.continued_by !== planPath) {
      fail(`previous plan already continued by ${state.continued_by}`);
    }
    const runningTaskIds = Object.entries(state.tasks)
      .filter(([, taskState]) => taskState.status === "running")
      .map(([taskId]) => taskId);
    if (runningTaskIds.length > 0) {
      fail(
        `continuation previous plan still has running tasks: ${runningTaskIds.join(", ")}`,
      );
    }

    const claimPath = `${previousStatePath}.continued-by.claim`;
    const token = randomUUID();
    const temporaryPath = `${claimPath}.${process.pid}.${token}.tmp`;
    writeFileSync(
      temporaryPath,
      `${JSON.stringify({
        pid: process.pid,
        created_at: Date.now(),
        plan_path: planPath,
        token,
      })}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    try {
      linkSync(temporaryPath, claimPath);
    } finally {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    }
    return token;
  });
}

function releaseContinuationClaim(
  previousStatePath        ,
  planPath        ,
  token        ,
)       {
  withStateLock(previousStatePath, () => {
    const claimPath = `${previousStatePath}.continued-by.claim`;
    if (!existsSync(claimPath)) return;
    const claim = requireRecord(readJson(claimPath), "continuation claim");
    if (claim.plan_path === planPath && claim.token === token) {
      unlinkSync(claimPath);
    }
  });
}

function readContinuationClaimPlan(statePath        )                {
  const claimPath = `${statePath}.continued-by.claim`;
  if (!existsSync(claimPath)) return null;
  const claim = requireRecord(
    JSON.parse(readFileSync(claimPath, "utf8")),
    "continuation claim",
  );
  return requireString(claim.plan_path, "continuation claim plan_path");
}

function statePathFor(planPath        )         {
  return join(dirname(planPath), "state.json");
}

function canonicalStatePath(planPath        , stateArgument        )         {
  const expected = resolve(statePathFor(planPath));
  const actual = resolve(stateArgument);
  if (actual !== expected) {
    fail(`state path must equal the canonical path: ${expected}`);
  }
  return expected;
}

function parseState(value         , plan      )           {
  const source = requireRecord(value, "state");
  const tasks = requireRecord(source.tasks, "state.tasks");
  const parsedTasks                            = {};
  const allowedStatuses = new Set            ([
    "pending",
    "running",
    "completed",
    "blocked",
    "failed",
    "needs_main_review",
    "dependency_blocked",
  ]);

  for (const task of plan.tasks) {
    const taskState = requireRecord(tasks[task.id], `state.tasks.${task.id}`);
    if (!allowedStatuses.has(taskState.status              )) {
      fail(`state.tasks.${task.id}.status is invalid`);
    }
    if (taskState.thread_id !== null && typeof taskState.thread_id !== "string") {
      fail(`state.tasks.${task.id}.thread_id is invalid`);
    }
    parsedTasks[task.id] = {
      status: taskState.status              ,
      thread_id: taskState.thread_id                 ,
    };
  }

  ensureUnique(Object.keys(tasks), "state task id");
  if (Object.keys(tasks).length !== plan.tasks.length) {
    fail("state task set does not match plan tasks");
  }
  return {
    plan_digest: requireString(source.plan_digest, "state.plan_digest"),
    continued_by:
      source.continued_by === undefined || source.continued_by === null
        ? null
        : requireString(source.continued_by, "state.continued_by"),
    tasks: parsedTasks,
  };
}

function loadPlanAndState(
  planPath        ,
  statePath        ,
)                                  {
  const plan = parsePlan(readJson(planPath));
  validateGraph(plan);
  const dispatch = requireRecord(
    requireRecord(readJson(planPath), "plan").dispatch,
    "dispatch",
  );
  if (dispatch.strategy !== "dependency_ready" || !isRecord(dispatch.routes)) {
    fail("plan dispatch routes are missing; run validate first");
  }
  plan.dispatch = {
    strategy: "dependency_ready",
    routes: dispatch.routes                         ,
  };
  const state = parseState(readJson(statePath), plan);
  if (state.plan_digest !== digestFile(planPath)) {
    fail("plan digest mismatch");
  }
  return { plan, state };
}

function assertPlanIsActive(
  planPath        ,
  statePath        ,
  plan      ,
  state          ,
)       {
  const continuedBy = readContinuationClaimPlan(statePath) ?? state.continued_by;
  if (continuedBy !== null) {
    fail(`plan already continued by ${continuedBy}`);
  }
  if (plan.continuation === undefined) return;

  const previousPlanPath = resolve(plan.continuation.previous_plan_path);
  const owner = readContinuationClaimPlan(statePathFor(previousPlanPath));
  if (owner !== planPath) {
    fail(
      owner === null
        ? "continuation claim is missing"
        : `continuation claim belongs to ${owner}`,
    );
  }
}

function validateCommand(planArgument        )       {
  const planPath = resolve(planArgument);
  const plan = parsePlan(readJson(planPath));
  const ancestors = validateGraph(plan);
  const continuation = resolveContinuationRoutes(planPath, plan);
  plan.dispatch = {
    strategy: "dependency_ready",
    routes: buildRoutes(plan, ancestors, continuation.routes),
  };
  const statePath = statePathFor(planPath);
  const planDigest = digestJson(plan);
  withStateLock(statePath, () => {
    let state                  = null;
    if (existsSync(statePath)) {
      state = parseState(readJson(statePath), plan);
      if (state.plan_digest !== planDigest) fail("plan digest mismatch");
    }

    let claimToken                = null;
    try {
      if (continuation.previous_state_path !== null) {
        claimToken = commitContinuationClaim(
          continuation.previous_state_path,
          planPath,
        );
      }
      writeJson(planPath, plan);
      if (state === null) {
        state = {
          plan_digest: planDigest,
          continued_by: null,
          tasks: Object.fromEntries(
            plan.tasks.map((task) => [
              task.id,
              { status: "pending", thread_id: null },
            ]),
          ),
        };
        writeJson(statePath, state);
      }
    } catch (error) {
      if (claimToken !== null && continuation.previous_state_path !== null) {
        releaseContinuationClaim(
          continuation.previous_state_path,
          planPath,
          claimToken,
        );
      }
      throw error;
    }
  });

  process.stdout.write(
    `${JSON.stringify({
      status: "valid",
      plan_path: planPath,
      state_path: statePath,
      safety: plan.safety.status,
      revision: plan.revision,
      continuation_reuse_count: continuation.routes.size,
      profile_validation: "syntax_only",
    })}\n`,
  );
}

function nextCommand(planArgument        , stateArgument        )       {
  const planPath = resolve(planArgument);
  const statePath = canonicalStatePath(planPath, stateArgument);
  const payload = withStateLock(statePath, () => {
    const { plan, state } = loadPlanAndState(planPath, statePath);
    assertPlanIsActive(planPath, statePath, plan, state);
    let changed = true;
    let stateChanged = false;
    while (changed) {
      changed = false;
      for (const task of plan.tasks) {
        const taskState = state.tasks[task.id];
        if (taskState.status !== "pending") continue;
        if (
          task.depends_on.some((dependencyId) =>
            FAILURE_STATUSES.has(state.tasks[dependencyId].status),
          )
        ) {
          taskState.status = "dependency_blocked";
          changed = true;
          stateChanged = true;
        }
      }
    }
    if (stateChanged) writeJson(statePath, state);

    const actions = plan.tasks.flatMap((task) => {
      const taskState = state.tasks[task.id];
      const ready =
        taskState.status === "pending" &&
        task.depends_on.every(
          (dependencyId) => state.tasks[dependencyId].status === "completed",
        );
      if (!ready) return [];
      const route = plan.dispatch?.routes[task.id];
      const identity = {
        task_id: task.id,
        logical_id: task.logical_id,
        title: task.title,
        module_id: task.module_id,
      };
      if (route?.action === "resume") {
        return [{
          ...identity,
          action: "reuse_existing_thread",
          from_plan: route.from_plan,
          from_task: route.from_task,
          thread_id: route.thread_id,
          reuse_mode: route.mode,
        }];
      }
      if (route?.action === "reuse") {
        const sourceState = state.tasks[route.from_task];
        if (
          sourceState?.status !== "completed" ||
          typeof sourceState.thread_id !== "string"
        ) {
          fail(`reuse source thread is unavailable for task ${task.id}`);
        }
        return [{
          ...identity,
          action: "reuse_thread",
          from_task: route.from_task,
          thread_id: sourceState.thread_id,
        }];
      }
      return [{
        ...identity,
        action: "create_thread",
      }];
    });

    const summary = Object.fromEntries(
      [
        "pending",
        "running",
        "completed",
        "blocked",
        "failed",
        "needs_main_review",
        "dependency_blocked",
      ].map((status) => [
        status,
        Object.values(state.tasks).filter((task) => task.status === status).length,
      ]),
    );
    return { actions, summary };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function updateCommand(
  planArgument        ,
  stateArgument        ,
  taskId        ,
  nextStatus        ,
  threadId         ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalStatePath(planPath, stateArgument);
  const payload = withStateLock(statePath, () => {
    const { plan, state } = loadPlanAndState(planPath, statePath);
    assertPlanIsActive(planPath, statePath, plan, state);
    const task = plan.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) fail(`unknown task: ${taskId}`);
    const current = state.tasks[taskId];
    const allowed                                   = {
      pending: ["running"],
      running: ["completed", "blocked", "failed", "needs_main_review"],
      completed: [],
      blocked: [],
      failed: [],
      needs_main_review: [],
      dependency_blocked: [],
    };
    if (!allowed[current.status].includes(nextStatus              )) {
      fail(`illegal status transition: ${current.status} -> ${nextStatus}`);
    }

    if (nextStatus === "running") {
      const actualThreadId = requireString(threadId, "thread_id");
      const route = plan.dispatch?.routes[taskId];
      if (route?.action === "reuse") {
        const expectedThreadId = state.tasks[route.from_task]?.thread_id;
        if (actualThreadId !== expectedThreadId) {
          fail(`task ${taskId} must reuse thread ${expectedThreadId}`);
        }
      }
      if (route?.action === "resume" && actualThreadId !== route.thread_id) {
        fail(`task ${taskId} must resume thread ${route.thread_id}`);
      }
      if (route?.action === "create") {
        const currentOwner = Object.entries(state.tasks).find(
          ([candidateId, candidateState]) =>
            candidateId !== taskId && candidateState.thread_id === actualThreadId,
        );
        const reservedByContinuation = Object.values(
          plan.dispatch?.routes ?? {},
        ).some(
          (candidateRoute) =>
            candidateRoute.action === "resume" &&
            candidateRoute.thread_id === actualThreadId,
        );
        if (currentOwner !== undefined || reservedByContinuation) {
          fail(`task ${taskId} create route must use a new thread`);
        }
      }
      current.thread_id = actualThreadId;
    }
    current.status = nextStatus              ;
    writeJson(statePath, state);
    return {
      task_id: taskId,
      status: current.status,
      thread_id: current.thread_id,
    };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function main(argv          )       {
  const [command, ...args] = argv;
  if (command === "validate" && args.length === 1) {
    validateCommand(args[0]);
    return;
  }
  if (command === "next" && args.length === 2) {
    nextCommand(args[0], args[1]);
    return;
  }
  if (command === "update" && (args.length === 4 || args.length === 5)) {
    updateCommand(args[0], args[1], args[2], args[3], args[4]);
    return;
  }
  fail(
    "usage: thread-plan.mjs validate <plan.json> | next <plan.json> <state.json> | update <plan.json> <state.json> <task_id> <status> [thread_id]",
  );
}

try {
  main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error: ${message}\n`);
  process.exitCode = 1;
}
