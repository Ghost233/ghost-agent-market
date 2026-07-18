// Generated from tooling/thread-plan/thread-plan.ts. Do not edit directly.
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
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

const THREAD_ROLES = new Set            (["work", "review", "verify"]);

const TERMINAL_STATUSES = new Set                    ([
  "completed",
  "blocked",
  "failed",
  "needs_main_review",
]);

const ROLE_TITLE_LABELS                             = {
  work: "实施",
  review: "审查",
  verify: "验证",
};

const STATUS_TITLE_LABELS                             = {
  pending: "待命",
  running: "执行",
  completed: "完成",
  blocked: "阻塞",
  failed: "失败",
  needs_main_review: "复核",
  dependency_blocked: "阻塞",
};

function fail(message        )        {
  throw new Error(message);
}

function assertPlanExecutable(
  plan      ,
  operation                            ,
)       {
  if (plan.safety.status === "needs_user_review") {
    fail(`plan safety requires user review; ${operation} is not executable`);
  }
}

function assertPlanActive(state          )       {
  if (state.continued_by !== null) {
    fail(`plan already continued by ${state.continued_by}`);
  }
}

function assertExecutorModeSelected(state          )       {
  if (state.executor_mode === null) {
    fail("executor mode is not selected");
  }
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
  const logicalId = requireString(
    task.logical_id,
    `tasks[${index}].logical_id`,
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,95}$/.test(logicalId)) {
    fail(`tasks[${index}].logical_id is invalid: ${logicalId}`);
  }
  const taskText = requireString(task.task, `tasks[${index}].task`);
  const rawTitle = requireString(task.title, `tasks[${index}].title`);
  const title = rawTitle.trim();
  if (title.length > 80) {
    fail(`tasks[${index}].title must be at most 80 characters`);
  }
  if (
    /^(等待(完整)?绑定包|等待分派|T\d+[A-Za-z0-9._-]*)$/i.test(title)
  ) {
    fail(`tasks[${index}].title is a generic placeholder: ${title}`);
  }
  const writablePaths = requireStringArray(
    task.writable_paths,
    `tasks[${index}].writable_paths`,
  );
  const threadRole = requireString(
    task.thread_role,
    `tasks[${index}].thread_role`,
  );
  if (!THREAD_ROLES.has(threadRole              )) {
    fail(`tasks[${index}].thread_role is invalid: ${threadRole}`);
  }
  if (
    (threadRole === "review" || threadRole === "verify") &&
    writablePaths.length > 0
  ) {
    fail(`tasks[${index}] ${threadRole} thread must have empty writable_paths`);
  }
  if (threadRole === "work" && writablePaths.length === 0) {
    fail(`tasks[${index}] work thread must have non-empty writable_paths`);
  }
  return {
    id,
    logical_id: logicalId,
    title,
    thread_role: threadRole              ,
    module_id: requireString(task.module_id, `tasks[${index}].module_id`),
    task: taskText,
    depends_on: requireStringArray(
      task.depends_on,
      `tasks[${index}].depends_on`,
    ),
    writable_paths: writablePaths,
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
  for (const field of ["reuse", "reviewed_task_ids", "replacements"]) {
    if (source[field] !== undefined) {
      fail(`continuation.${field} is not part of the current plan contract`);
    }
  }
  return {
    previous_plan_path: requireString(
      source.previous_plan_path,
      "continuation.previous_plan_path",
    ),
  };
}

function parsePlan(value         )       {
  const source = requireRecord(value, "plan");
  if (source.dispatch !== undefined) {
    fail("dispatch routes are not part of the plan; thread ownership is resolved at dispatch time");
  }
  const expectedExecutionPlatform = "claude_code";
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
    revision: requirePositiveInteger(source.revision, "revision"),
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

function expectedTitle(task                , status            )         {
  return `[GA][${ROLE_TITLE_LABELS[task.thread_role]}][${STATUS_TITLE_LABELS[status]}] ${task.title}`;
}

function parseScopeRequest(value         , label        )               {
  const source = requireRecord(value, label);
  return {
    paths: requireStringArray(source.paths, `${label}.paths`, false),
    reason: requireString(source.reason, `${label}.reason`),
    required_for_done_when: requireString(
      source.required_for_done_when,
      `${label}.required_for_done_when`,
    ),
    suggested_owner: requireString(
      source.suggested_owner,
      `${label}.suggested_owner`,
    ),
    split_hints: requireStringArray(
      source.split_hints,
      `${label}.split_hints`,
    ),
    overlap_hints: requireStringArray(
      source.overlap_hints,
      `${label}.overlap_hints`,
    ),
  };
}

function parseWorkerResult(
  value         ,
  task                ,
  taskState           ,
  expectedStatus                    ,
)                 {
  const source = requireRecord(value, "worker result");
  if (source.contract !== "WORKER_RESULT_V3") {
    fail("worker result contract must equal WORKER_RESULT_V3");
  }
  const status = requireString(source.status, "worker result.status");
  if (!TERMINAL_STATUSES.has(status                      )) {
    fail(`worker result.status is invalid: ${status}`);
  }
  if (status !== expectedStatus) {
    fail(`worker result status mismatch: expected ${expectedStatus}, got ${status}`);
  }

  const taskId = requireString(source.task_id, "worker result.task_id");
  const logicalId = requireString(
    source.logical_id,
    "worker result.logical_id",
  );
  const threadRole = requireString(
    source.thread_role,
    "worker result.thread_role",
  );
  const moduleId = requireString(source.module_id, "worker result.module_id");
  const threadId = requireString(source.thread_id, "worker result.thread_id");
  if (taskId !== task.id) fail(`worker result task_id mismatch: ${taskId}`);
  if (logicalId !== task.logical_id) {
    fail(`worker result logical_id mismatch: ${logicalId}`);
  }
  if (threadRole !== task.thread_role) {
    fail(`worker result thread_role mismatch: ${threadRole}`);
  }
  if (moduleId !== task.module_id) {
    fail(`worker result module_id mismatch: ${moduleId}`);
  }
  if (threadId !== taskState.thread_id) {
    fail(`worker result thread_id mismatch: ${threadId}`);
  }

  const changedFiles = requireStringArray(
    source.changed_files,
    "worker result.changed_files",
  );
  ensureUnique(changedFiles, "worker result changed file");
  const verification = requireStringArray(
    source.verification,
    "worker result.verification",
    false,
  );
  const diffSelfCheck = requireString(
    source.diff_self_check,
    "worker result.diff_self_check",
  );
  if (
    diffSelfCheck !== "pass" &&
    diffSelfCheck !== "fail" &&
    diffSelfCheck !== "scope_exception"
  ) {
    fail(`worker result.diff_self_check is invalid: ${diffSelfCheck}`);
  }

  let scopeRequest                      = null;
  if (status === "needs_main_review") {
    if (diffSelfCheck !== "scope_exception") {
      fail("needs_main_review requires diff_self_check scope_exception");
    }
    scopeRequest = parseScopeRequest(
      source.scope_request,
      "worker result.scope_request",
    );
  } else {
    if (source.scope_request !== null) {
      fail(`${status} requires scope_request null`);
    }
    if (diffSelfCheck === "scope_exception") {
      fail(`${status} cannot use diff_self_check scope_exception`);
    }
    if (status === "completed" && diffSelfCheck !== "pass") {
      fail("completed requires diff_self_check pass");
    }
  }

  const outOfScopeFiles = changedFiles.filter(
    (changedFile) =>
      !task.writable_paths.some((writablePath) =>
        pathsOverlap(changedFile, writablePath),
      ),
  );
  if (task.thread_role !== "work" && changedFiles.length > 0) {
    fail(`${task.thread_role} result must have empty changed_files`);
  }
  if (status !== "needs_main_review" && outOfScopeFiles.length > 0) {
    fail(
      `worker result changed_files exceed writable_paths: ${outOfScopeFiles.join(", ")}`,
    );
  }
  if (
    status === "needs_main_review" &&
    outOfScopeFiles.some(
      (changedFile) =>
        !scopeRequest?.paths.some((requestedPath) =>
          pathsOverlap(changedFile, requestedPath),
        ),
    )
  ) {
    fail("worker result out-of-scope changed_files must be covered by scope_request.paths");
  }

  return {
    contract: "WORKER_RESULT_V3",
    status: status                      ,
    task_id: taskId,
    logical_id: logicalId,
    thread_role: threadRole              ,
    module_id: moduleId,
    thread_id: threadId,
    profile_evidence: requireString(
      source.profile_evidence,
      "worker result.profile_evidence",
    ),
    changed_files: changedFiles,
    verification,
    diff_self_check: diffSelfCheck                                     ,
    scope_request: scopeRequest,
    summary: requireString(source.summary, "worker result.summary"),
  };
}

function threadOwnerKey(plan      , task                )         {
  return JSON.stringify([plan.parent_goal, task.module_id, task.thread_role]);
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
      if (
        threadOwnerKey(plan, left) === threadOwnerKey(plan, right) &&
        !comparable
      ) {
        fail(
          `tasks with the same module_id and thread_role must be DAG-comparable: ${left.id} and ${right.id}`,
        );
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

function previousPlanPathFor(planPath        , plan      )                {
  const continuation = plan.continuation;
  if (continuation === undefined) {
    if (plan.revision !== 1) {
      fail("a plan without continuation must have revision 1");
    }
    return null;
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
  return previousPlanPath;
}

function validateContinuationAgainst(
  plan      ,
  previousPlan      ,
  previousState          ,
)       {
  if (previousPlan.parent_goal !== plan.parent_goal) {
    fail("continuation parent_goal does not match the previous plan");
  }
  if (plan.revision !== previousPlan.revision + 1) {
    fail("continuation revision must increment the previous revision by one");
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
  const currentModules = new Map(plan.modules.map((module) => [module.id, module]));
  for (const previousModule of previousPlan.modules) {
    const currentModule = currentModules.get(previousModule.id);
    if (currentModule === undefined) {
      fail(`continuation must retain module definition: ${previousModule.id}`);
    }
    if (
      JSON.stringify(previousModule.worker_profile) !==
        JSON.stringify(currentModule.worker_profile) ||
      previousModule.worker_context !== currentModule.worker_context
    ) {
      fail(`module definition cannot change within parent_goal: ${previousModule.id}`);
    }
  }
}

function statePathFor(planPath        )         {
  return join(dirname(planPath), "state.json");
}

function resultPathFor(planPath        , taskId        )         {
  return join(dirname(planPath), "results", `${taskId}.json`);
}

function canonicalResultPath(
  planPath        ,
  taskId        ,
  resultArgument        ,
)         {
  const expected = resolve(resultPathFor(planPath, taskId));
  const actual = resolve(resultArgument);
  if (actual !== expected) {
    fail(`result path must equal the canonical path: ${expected}`);
  }
  return expected;
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
    const parsedTask            = {
      status: taskState.status              ,
      thread_id: taskState.thread_id                 ,
      result: null,
    };
    if (taskState.result !== undefined && taskState.result !== null) {
      if (!TERMINAL_STATUSES.has(parsedTask.status                      )) {
        fail(`state.tasks.${task.id}.result requires a terminal status`);
      }
      parsedTask.result = parseWorkerResult(
        taskState.result,
        task,
        parsedTask,
        parsedTask.status                      ,
      );
    }
    parsedTasks[task.id] = parsedTask;
  }

  ensureUnique(Object.keys(tasks), "state task id");
  if (Object.keys(tasks).length !== plan.tasks.length) {
    fail("state task set does not match plan tasks");
  }
  const continuedBy =
    source.continued_by === null
      ? null
      : requireString(source.continued_by, "state.continued_by");
  const executorMode = source.executor_mode;
  if (
    executorMode !== null &&
    executorMode !== "thread" &&
    executorMode !== "subagent"
  ) {
    fail("state.executor_mode must equal thread, subagent, or null");
  }
  return {
    plan_digest: requireString(source.plan_digest, "state.plan_digest"),
    continued_by: continuedBy,
    executor_mode: executorMode                       ,
    tasks: parsedTasks,
  };
}

function loadPlanAndState(
  planPath        ,
  statePath        ,
)                                  {
  const plan = parsePlan(readJson(planPath));
  validateGraph(plan);
  const state = parseState(readJson(statePath), plan);
  if (state.plan_digest !== digestFile(planPath)) {
    fail("plan digest mismatch");
  }
  return { plan, state };
}

function collectThreadBindings(
  planPath        ,
  plan      ,
  state          ,
)                 {
  const bindings                 = {
    owner_threads: new Map(),
    thread_owners: new Map(),
    running_threads: new Map(),
  };
  const visited = new Set        ();
  let currentPlanPath = planPath;
  let currentPlan = plan;
  let currentState = state;

  while (true) {
    if (visited.has(currentPlanPath)) {
      fail(`continuation cycle detected at ${currentPlanPath}`);
    }
    visited.add(currentPlanPath);

    for (const task of currentPlan.tasks) {
      const taskState = currentState.tasks[task.id];
      const threadId = taskState.thread_id;
      if (threadId === null) continue;
      const owner = threadOwnerKey(currentPlan, task);
      const ownerThreadId = bindings.owner_threads.get(owner);
      if (ownerThreadId !== undefined && ownerThreadId !== threadId) {
        fail(`multiple executors are bound to task owner: ${task.id}`);
      }
      const threadOwner = bindings.thread_owners.get(threadId);
      if (threadOwner !== undefined && threadOwner !== owner) {
        fail(`executor ${threadId} is bound to multiple task owners`);
      }
      bindings.owner_threads.set(owner, threadId);
      bindings.thread_owners.set(threadId, owner);

      if (taskState.status === "running") {
        const runningTask = bindings.running_threads.get(threadId);
        if (runningTask !== undefined && runningTask !== task.id) {
          fail(`executor ${threadId} is running multiple tasks`);
        }
        bindings.running_threads.set(threadId, task.id);
      }
    }

    const previousPlanPath = previousPlanPathFor(
      currentPlanPath,
      currentPlan,
    );
    if (previousPlanPath === null) break;
    const previous = loadPlanAndState(
      previousPlanPath,
      statePathFor(previousPlanPath),
    );
    if (previous.plan.parent_goal !== plan.parent_goal) {
      fail("continuation chain crosses parent_goal");
    }
    if (previous.plan.revision !== currentPlan.revision - 1) {
      fail("continuation chain revision is not contiguous");
    }
    if (previous.state.continued_by !== currentPlanPath) {
      fail(`continuation chain is not committed at ${previousPlanPath}`);
    }
    if (
      previous.state.executor_mode !== null &&
      previous.state.executor_mode !== state.executor_mode
    ) {
      fail("continuation chain executor mode changed");
    }
    currentPlanPath = previousPlanPath;
    currentPlan = previous.plan;
    currentState = previous.state;
  }

  return bindings;
}

function initializePlanState(
  planPath        ,
  plan      ,
  statePath        ,
  inheritedExecutorMode                     ,
)       {
  const planDigest = digestJson(plan);
  let state                  = null;
  if (existsSync(statePath)) {
    state = parseState(readJson(statePath), plan);
    if (state.plan_digest !== planDigest) fail("plan digest mismatch");
    if (
      inheritedExecutorMode !== null &&
      state.executor_mode !== inheritedExecutorMode
    ) {
      fail(`successor executor mode must remain ${inheritedExecutorMode}`);
    }
  }

  mkdirSync(join(dirname(planPath), "results"), { recursive: true });
  writeJson(planPath, plan);
  if (state === null) {
    state = {
      plan_digest: planDigest,
      continued_by: null,
      executor_mode: inheritedExecutorMode,
      tasks: Object.fromEntries(
        plan.tasks.map((task) => [
          task.id,
          { status: "pending", thread_id: null, result: null },
        ]),
      ),
    };
    writeJson(statePath, state);
  }
}

function validateCommand(planArgument        )       {
  const planPath = resolve(planArgument);
  const plan = parsePlan(readJson(planPath));
  validateGraph(plan);
  const previousPlanPath = previousPlanPathFor(planPath, plan);
  const statePath = statePathFor(planPath);
  if (previousPlanPath === null) {
    withStateLock(statePath, () =>
      initializePlanState(planPath, plan, statePath, null),
    );
  } else {
    const previousStatePath = statePathFor(previousPlanPath);
    withStateLock(previousStatePath, () => {
      const { plan: previousPlan, state: previousState } = loadPlanAndState(
        previousPlanPath,
        previousStatePath,
      );
      validateContinuationAgainst(plan, previousPlan, previousState);
      if (
        previousState.continued_by !== null &&
        previousState.continued_by !== planPath
      ) {
        fail(`previous plan already continued by ${previousState.continued_by}`);
      }

      withStateLock(statePath, () => {
        initializePlanState(
          planPath,
          plan,
          statePath,
          previousState.executor_mode,
        );
        if (previousState.continued_by === null) {
          previousState.continued_by = planPath;
          writeJson(previousStatePath, previousState);
        }
      });
    });
  }

  process.stdout.write(
    `${JSON.stringify({
      status: "valid",
      plan_path: planPath,
      state_path: statePath,
      safety: plan.safety.status,
      revision: plan.revision,
      profile_validation: "syntax_only",
    })}\n`,
  );
}

function compareStableStrings(left        , right        )         {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function escapeMermaidLabel(value        )         {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("`", "&#96;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\n", "&#10;");
}

function renderCommand(planArgument        )       {
  const planPath = resolve(planArgument);
  const planSource = readJson(planPath);
  const plan = parsePlan(planSource);
  validateGraph(plan);
  const planDigest = digestJson(planSource);

  const tasks = [...plan.tasks].sort((left, right) =>
    compareStableStrings(left.id, right.id),
  );
  const aliases = new Map(
    tasks.map((task, index) => [task.id, `N${index}`]),
  );
  const lines = [
    `%% thread-plan plan_digest=${planDigest} revision=${plan.revision} safety.status=${plan.safety.status}`,
    "flowchart LR",
  ];
  for (const task of tasks) {
    const label = escapeMermaidLabel(
      `${task.id} · [${ROLE_TITLE_LABELS[task.thread_role]}] ${task.title} · ${task.module_id}`,
    );
    lines.push(`  ${aliases.get(task.id)}["${label}"]`);
  }
  for (const task of tasks) {
    for (const dependencyId of [...task.depends_on].sort(compareStableStrings)) {
      lines.push(`  ${aliases.get(dependencyId)} --> ${aliases.get(task.id)}`);
    }
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

function modeCommand(
  planArgument        ,
  stateArgument        ,
  modeArgument        ,
)       {
  if (modeArgument !== "thread" && modeArgument !== "subagent") {
    fail("executor mode must equal thread or subagent");
  }
  const requestedMode = modeArgument                ;
  const planPath = resolve(planArgument);
  const statePath = canonicalStatePath(planPath, stateArgument);
  const payload = withStateLock(statePath, () => {
    const { plan, state } = loadPlanAndState(planPath, statePath);
    assertPlanExecutable(plan, "mode");
    assertPlanActive(state);
    if (
      state.executor_mode !== null &&
      state.executor_mode !== requestedMode
    ) {
      fail(
        `executor mode is already ${state.executor_mode}; cannot switch to ${requestedMode}`,
      );
    }
    if (state.executor_mode === null) {
      state.executor_mode = requestedMode;
      writeJson(statePath, state);
    }
    return { executor_mode: state.executor_mode };
  });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function nextCommand(planArgument        , stateArgument        )       {
  const planPath = resolve(planArgument);
  const statePath = canonicalStatePath(planPath, stateArgument);
  const payload = withStateLock(statePath, () => {
    const { plan, state } = loadPlanAndState(planPath, statePath);
    assertPlanExecutable(plan, "next");
    assertPlanActive(state);
    assertExecutorModeSelected(state);
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
    const bindings = collectThreadBindings(planPath, plan, state);

    const actions = plan.tasks.flatMap((task) => {
      const taskState = state.tasks[task.id];
      const ready =
        taskState.status === "pending" &&
        task.depends_on.every(
          (dependencyId) => state.tasks[dependencyId].status === "completed",
        );
      if (!ready) return [];
      return [{
        action: "dispatch_task",
        task_id: task.id,
        logical_id: task.logical_id,
        title: task.title,
        thread_role: task.thread_role,
        module_id: task.module_id,
        result_path: resultPathFor(planPath, task.id),
        expected_title: expectedTitle(task, "pending"),
        thread_id:
          bindings.owner_threads.get(threadOwnerKey(plan, task)) ?? null,
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
  bindingArgument         ,
)       {
  const planPath = resolve(planArgument);
  const statePath = canonicalStatePath(planPath, stateArgument);
  const payload = withStateLock(statePath, () => {
    const { plan, state } = loadPlanAndState(planPath, statePath);
    assertPlanExecutable(plan, "update");
    assertPlanActive(state);
    assertExecutorModeSelected(state);
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
      const incompleteDependencies = task.depends_on.filter(
        (dependencyId) => state.tasks[dependencyId].status !== "completed",
      );
      if (incompleteDependencies.length > 0) {
        fail(
          `task ${taskId} is not ready; incomplete dependencies: ${incompleteDependencies.join(", ")}`,
        );
      }
      const actualThreadId = requireString(bindingArgument, "thread_id");
      const bindings = collectThreadBindings(planPath, plan, state);
      const owner = threadOwnerKey(plan, task);
      const ownerThreadId = bindings.owner_threads.get(owner);
      if (ownerThreadId !== undefined && ownerThreadId !== actualThreadId) {
        fail(`task ${taskId} must reuse owner executor ${ownerThreadId}`);
      }
      const existingOwner = bindings.thread_owners.get(actualThreadId);
      if (existingOwner !== undefined && existingOwner !== owner) {
        fail(`executor ${actualThreadId} is already bound to another task owner`);
      }
      const activeTaskId = bindings.running_threads.get(actualThreadId);
      if (activeTaskId !== undefined && activeTaskId !== taskId) {
        fail(`executor ${actualThreadId} is still running task ${activeTaskId}`);
      }
      current.thread_id = actualThreadId;
      current.result = null;
    } else {
      const resultArgument = requireString(bindingArgument, "result_path");
      const resultPath = canonicalResultPath(
        planPath,
        taskId,
        resultArgument,
      );
      current.result = parseWorkerResult(
        readJson(resultPath),
        task,
        current,
        nextStatus                      ,
      );
    }
    current.status = nextStatus              ;
    writeJson(statePath, state);
    return {
      task_id: taskId,
      status: current.status,
      thread_id: current.thread_id,
      result_path: resultPathFor(planPath, taskId),
      expected_title: expectedTitle(task, current.status),
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
  if (command === "render" && args.length === 1) {
    renderCommand(args[0]);
    return;
  }
  if (command === "mode" && args.length === 3) {
    modeCommand(args[0], args[1], args[2]);
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
    "usage: thread-plan.mjs validate <plan.json> | render <plan.json> | mode <plan.json> <state.json> thread|subagent | next <plan.json> <state.json> | update <plan.json> <state.json> <task_id> running <thread_id> | update <plan.json> <state.json> <task_id> <terminal_status> <result_path>",
  );
}

try {
  main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error: ${message}\n`);
  process.exitCode = 1;
}
