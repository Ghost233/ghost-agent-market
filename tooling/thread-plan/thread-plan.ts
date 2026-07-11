import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type WorkerProfile = {
  model: string;
  reasoning_effort: string;
};

type ModuleDefinition = {
  id: string;
  worker_profile: WorkerProfile;
  worker_context: string;
};

type TaskDefinition = {
  id: string;
  module_id: string;
  task: string;
  depends_on: string[];
  writable_paths: string[];
  done_when: string[];
  verification: string[];
};

type Route =
  | { action: "create" }
  | { action: "reuse"; from_task: string };

type Plan = {
  planner: "parallel-task-planner";
  plan_format_version: 3;
  execution_platform: "codex" | "claude_code";
  parent_goal: string;
  modules: ModuleDefinition[];
  tasks: TaskDefinition[];
  dispatch?: {
    strategy: "dependency_ready";
    routes: Record<string, Route>;
  };
  project_verification: string[];
  safety: {
    status: "parallel_safe" | "sequential_only" | "needs_user_review";
    reasons: string[];
  };
};

type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "needs_main_review"
  | "dependency_blocked";

type TaskState = {
  status: TaskStatus;
  thread_id: string | null;
};

type RunState = {
  plan_digest: string;
  tasks: Record<string, TaskState>;
};

const FAILURE_STATUSES = new Set<TaskStatus>([
  "blocked",
  "failed",
  "needs_main_review",
  "dependency_blocked",
]);

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) fail(`${label} must be an object`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(
  value: unknown,
  label: string,
  allowEmpty = true,
): string[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const result = value.map((item, index) =>
    requireString(item, `${label}[${index}]`),
  );
  if (!allowEmpty && result.length === 0) fail(`${label} must not be empty`);
  return result;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`cannot read JSON ${path}: ${message}`);
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function digestFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function ensureUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) fail(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function parseModule(value: unknown, index: number): ModuleDefinition {
  const module = requireRecord(value, `modules[${index}]`);
  const profile = requireRecord(
    module.worker_profile,
    `modules[${index}].worker_profile`,
  );
  return {
    id: requireString(module.id, `modules[${index}].id`),
    worker_profile: {
      model: requireString(
        profile.model,
        `modules[${index}].worker_profile.model`,
      ),
      reasoning_effort: requireString(
        profile.reasoning_effort,
        `modules[${index}].worker_profile.reasoning_effort`,
      ),
    },
    worker_context: requireString(
      module.worker_context,
      `modules[${index}].worker_context`,
    ),
  };
}

function parseTask(value: unknown, index: number): TaskDefinition {
  const task = requireRecord(value, `tasks[${index}]`);
  return {
    id: requireString(task.id, `tasks[${index}].id`),
    module_id: requireString(task.module_id, `tasks[${index}].module_id`),
    task: requireString(task.task, `tasks[${index}].task`),
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

function parsePlan(value: unknown): Plan {
  const source = requireRecord(value, "plan");
  const expectedExecutionPlatform = "__EXECUTION_PLATFORM__";
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
    execution_platform: source.execution_platform,
    parent_goal: requireString(source.parent_goal, "parent_goal"),
    modules: source.modules.map(parseModule),
    tasks: source.tasks.map(parseTask),
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

function buildAncestors(tasks: TaskDefinition[]): Map<string, Set<string>> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const complete = new Set<string>();
  const ancestors = new Map<string, Set<string>>();

  function visit(taskId: string): Set<string> {
    if (complete.has(taskId)) return ancestors.get(taskId) as Set<string>;
    if (visiting.has(taskId)) fail(`task dependency cycle detected at ${taskId}`);
    visiting.add(taskId);
    const task = byId.get(taskId) as TaskDefinition;
    const result = new Set<string>();
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

function pathPrefix(pattern: string): string {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
  const wildcard = normalized.search(/[?*[{]/);
  const prefix = wildcard === -1 ? normalized : normalized.slice(0, wildcard);
  return prefix.replace(/\/+$/, "");
}

function pathsOverlap(left: string, right: string): boolean {
  const a = pathPrefix(left);
  const b = pathPrefix(right);
  if (a === "" || b === "") return true;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function validateGraph(plan: Plan): Map<string, Set<string>> {
  ensureUnique(plan.modules.map((module) => module.id), "module id");
  ensureUnique(plan.tasks.map((task) => task.id), "task id");
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
  plan: Plan,
  ancestors: Map<string, Set<string>>,
): Record<string, Route> {
  const matchedTargetToSource = new Map<string, string>();
  const taskById = new Map(plan.tasks.map((task) => [task.id, task]));

  function augment(source: TaskDefinition, seen: Set<string>): boolean {
    for (const target of plan.tasks) {
      const candidate =
        source.id !== target.id &&
        source.module_id === target.module_id &&
        ancestors.get(target.id)?.has(source.id) === true;
      if (!candidate || seen.has(target.id)) continue;
      seen.add(target.id);
      const previousSourceId = matchedTargetToSource.get(target.id);
      if (
        previousSourceId === undefined ||
        augment(taskById.get(previousSourceId) as TaskDefinition, seen)
      ) {
        matchedTargetToSource.set(target.id, source.id);
        return true;
      }
    }
    return false;
  }

  for (const source of plan.tasks) augment(source, new Set<string>());

  return Object.fromEntries(
    plan.tasks.map((task) => {
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

function statePathFor(planPath: string): string {
  return join(dirname(planPath), "state.json");
}

function parseState(value: unknown, plan: Plan): RunState {
  const source = requireRecord(value, "state");
  const tasks = requireRecord(source.tasks, "state.tasks");
  const parsedTasks: Record<string, TaskState> = {};
  const allowedStatuses = new Set<TaskStatus>([
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
    if (!allowedStatuses.has(taskState.status as TaskStatus)) {
      fail(`state.tasks.${task.id}.status is invalid`);
    }
    if (taskState.thread_id !== null && typeof taskState.thread_id !== "string") {
      fail(`state.tasks.${task.id}.thread_id is invalid`);
    }
    parsedTasks[task.id] = {
      status: taskState.status as TaskStatus,
      thread_id: taskState.thread_id as string | null,
    };
  }

  ensureUnique(Object.keys(tasks), "state task id");
  if (Object.keys(tasks).length !== plan.tasks.length) {
    fail("state task set does not match plan tasks");
  }
  return {
    plan_digest: requireString(source.plan_digest, "state.plan_digest"),
    tasks: parsedTasks,
  };
}

function loadPlanAndState(
  planPath: string,
  statePath: string,
): { plan: Plan; state: RunState } {
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
    routes: dispatch.routes as Record<string, Route>,
  };
  const state = parseState(readJson(statePath), plan);
  if (state.plan_digest !== digestFile(planPath)) {
    fail("plan digest mismatch");
  }
  return { plan, state };
}

function validateCommand(planArgument: string): void {
  const planPath = resolve(planArgument);
  const plan = parsePlan(readJson(planPath));
  const ancestors = validateGraph(plan);
  plan.dispatch = {
    strategy: "dependency_ready",
    routes: buildRoutes(plan, ancestors),
  };
  writeJson(planPath, plan);

  const statePath = statePathFor(planPath);
  const planDigest = digestFile(planPath);
  if (existsSync(statePath)) {
    const state = parseState(readJson(statePath), plan);
    if (state.plan_digest !== planDigest) fail("plan digest mismatch");
  } else {
    const state: RunState = {
      plan_digest: planDigest,
      tasks: Object.fromEntries(
        plan.tasks.map((task) => [
          task.id,
          { status: "pending", thread_id: null },
        ]),
      ),
    };
    writeJson(statePath, state);
  }

  process.stdout.write(
    `${JSON.stringify({
      status: "valid",
      plan_path: planPath,
      state_path: statePath,
      safety: plan.safety.status,
    })}\n`,
  );
}

function nextCommand(planArgument: string, stateArgument: string): void {
  const planPath = resolve(planArgument);
  const statePath = resolve(stateArgument);
  const { plan, state } = loadPlanAndState(planPath, statePath);
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
    if (route?.action === "reuse") {
      const sourceState = state.tasks[route.from_task];
      if (
        sourceState?.status !== "completed" ||
        typeof sourceState.thread_id !== "string"
      ) {
        fail(`reuse source thread is unavailable for task ${task.id}`);
      }
      return [{
        task_id: task.id,
        module_id: task.module_id,
        action: "reuse_thread",
        from_task: route.from_task,
        thread_id: sourceState.thread_id,
      }];
    }
    return [{
      task_id: task.id,
      module_id: task.module_id,
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
  process.stdout.write(`${JSON.stringify({ actions, summary })}\n`);
}

function updateCommand(
  planArgument: string,
  stateArgument: string,
  taskId: string,
  nextStatus: string,
  threadId?: string,
): void {
  const planPath = resolve(planArgument);
  const statePath = resolve(stateArgument);
  const { plan, state } = loadPlanAndState(planPath, statePath);
  const task = plan.tasks.find((candidate) => candidate.id === taskId);
  if (task === undefined) fail(`unknown task: ${taskId}`);
  const current = state.tasks[taskId];
  const allowed: Record<TaskStatus, TaskStatus[]> = {
    pending: ["running", "blocked"],
    running: ["completed", "blocked", "failed", "needs_main_review"],
    completed: [],
    blocked: [],
    failed: [],
    needs_main_review: [],
    dependency_blocked: [],
  };
  if (!allowed[current.status].includes(nextStatus as TaskStatus)) {
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
    current.thread_id = actualThreadId;
  }
  current.status = nextStatus as TaskStatus;
  writeJson(statePath, state);
  process.stdout.write(
    `${JSON.stringify({
      task_id: taskId,
      status: current.status,
      thread_id: current.thread_id,
    })}\n`,
  );
}

function main(argv: string[]): void {
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
