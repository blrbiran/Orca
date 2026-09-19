import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { z } from "zod";
import { RUN_ID } from "../ledger/writer.js";
import { canonicalBytes, sha256Canonical } from "../control/canonicalJson.js";
import { ControlError } from "../control/errors.js";
import { detectCycle } from "./graph.js";

export interface PlanTask {
  taskId: string;
  contract: string;
  dependsOn: string[];
  targetVersion?: string;
  configHash?: string;
}

export interface PlanFile {
  targetRepo: string;
  ccloopBin: string;
  runsDir: string;
  workBranch: string;
  policy: "local-merge";
  ledgerMode: "in-repo" | "out-of-repo";
  goal?: string;
  successConditions?: string[];
  tasks: PlanTask[];
}

export interface SchedulerControlPlanSource {
  goal: string;
  successConditions: string[];
  tasks: Array<{
    taskId: string;
    dependencyTaskIds: string[];
    targetVersion: string;
    configHash: string;
    originalContract: unknown;
    originalContractCanonicalJson: string;
    originalContractHash: string;
  }>;
}

export type PlanRejection = { code: string; message: string };

/**
 * The plan-level up-front rejection codes (spec §2.3's six, plus the
 * task-id-shape check §2.3's own "mechanically decidable from the plan file
 * alone" test admits as a seventh), in the order `orca plan` prints them.
 *
 * 🔴 This list is the ONE source of these strings, and `loadPlan` below emits
 * them by destructuring it rather than by retyping the literals. Before the
 * final-review fix wave there was a second, hand-typed copy in
 * `planReport.ts`, which imported nothing from here: `checkLine` resolves a
 * code it cannot find in the rejections to `[pass] <code>`, so renaming a
 * code on one side produced a FALSE GREEN line in the report a human approves
 * a round from, and adding one produced a check that ran but was never shown.
 * Same reason `RUNTIME_CHECK` is destructured by `preflight.ts` instead of
 * being written out twice there.
 *
 * ⚠️ Keyed, not positional. The final review parked a finding that these
 * codes used to be pulled out of a flat array by POSITION, which made the
 * array's ORDER load-bearing for something order should have nothing to do
 * with — reordering it to change the report's print order would have rebound
 * every name to a different message. Measured afterwards (2026-09-05): four
 * existing criteria in `planFile.test.ts` do redden on a transposition,
 * because each asserts a literal code name against a plan violating exactly
 * that check, so the finding's "silently" was too strong. The order is
 * decoupled here anyway: a display-order change should not be able to reach
 * the bindings at all, and a record says which name means which code without
 * anyone counting entries.
 */
const PLAN_LEVEL_CHECK = {
  RELATIVE_PATH: "relative-path",
  DUPLICATE_TASK_ID: "duplicate-task-id",
  CYCLE: "cycle",
  CONTRACT_INSIDE_TARGET_REPO: "contract-inside-target-repo",
  WORK_BRANCH_IS_DEFAULT: "work-branch-is-default",
  UNSUPPORTED_POLICY: "unsupported-policy",
  UNUSABLE_TASK_ID: "unusable-task-id",
} as const;

/** The same codes as a list, in the order `orca plan` prints them. */
export const PLAN_LEVEL_CHECKS = Object.values(PLAN_LEVEL_CHECK);

const {
  RELATIVE_PATH,
  DUPLICATE_TASK_ID,
  CYCLE,
  CONTRACT_INSIDE_TARGET_REPO,
  WORK_BRANCH_IS_DEFAULT,
  UNSUPPORTED_POLICY,
  UNUSABLE_TASK_ID,
} = PLAN_LEVEL_CHECK;

const planTaskSchema = z
  .object({
    taskId: z.string().min(1),
    contract: z.string().min(1),
    dependsOn: z.array(z.string()),
    targetVersion: z.string().min(1).optional(),
    configHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .strict();

// Shape-only: policy and workBranch are checked for the well-formed literal
// values a valid plan could have, but the *content* checks (unsupported
// policy, workBranch == default) are spec-level rejections below, not schema
// failures — a caller should see "unsupported-policy", not a zod message.
const planFileSchema = z
  .object({
    targetRepo: z.string().min(1),
    ccloopBin: z.string().min(1),
    runsDir: z.string().min(1),
    workBranch: z.string().min(1),
    policy: z.string().min(1),
    ledgerMode: z.enum(["in-repo", "out-of-repo"]),
    goal: z.string().min(1).optional(),
    successConditions: z.array(z.string().min(1)).optional(),
    tasks: z.array(planTaskSchema),
  })
  .strict();

const terminalStates = ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] as const;
const terminalStatesSchema = z.array(z.enum(terminalStates)).refine(states =>
  states.length === terminalStates.length
  && new Set(states).size === terminalStates.length
  && terminalStates.every(state => states.includes(state)),
);

/** Closed ccloop V1 contract shape, mirrored from the foundation validator. */
export const taskContractSchema = z.object({
  objective: z.object({
    taskId: z.string().min(1), goal: z.string().min(1), successCondition: z.string().min(1),
    nonGoals: z.array(z.string()).default([]),
  }).strict(),
  context: z.object({
    repoPath: z.string().min(1), targetPaths: z.array(z.string()).min(1),
    relevantDocs: z.array(z.string()).default([]), buildTestCommands: z.array(z.string()).min(1),
    constraints: z.array(z.string()).default([]),
  }).strict(),
  executionPolicy: z.object({
    autonomyLevel: z.literal("L2"), maxAttempts: z.number().int().positive(),
    perAttemptTimeoutMs: z.number().int().positive(), totalRuntimeBudgetMs: z.number().int().positive(),
    tokenBudget: z.number().int().positive(), worktreeRequired: z.literal(true),
    partialOutcomeRecoveryWindowMs: z.number().int().nonnegative(),
  }).strict(),
  safetyPolicy: z.object({
    allowlistPaths: z.array(z.string()).default([]), denylistPaths: z.array(z.string()).default([]),
    maxFilesTouched: z.number().int().positive(), humanGateConditions: z.array(z.string()).default([]),
  }).strict(),
  verification: z.object({
    verifierType: z.enum(["command", "agent"]), requiredChecks: z.array(z.string()).min(1),
    rejectOn: z.array(z.string()).min(1), evidenceRequired: z.array(z.string()).default([]),
  }).strict(),
  escalationAndExit: z.object({
    escalationTargets: z.array(z.string()).default([]), pauseOn: z.array(z.string()).default([]),
    stopOn: z.array(z.string()).default([]), terminalStates: terminalStatesSchema.default(() => [...terminalStates]),
  }).strict(),
}).strict();

function readRegularUtf8(path: string): string {
  let fd: number | undefined;
  try {
    const before = lstatSync(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || realpathSync(path) !== path) {
      throw new ControlError("control-plan-rejected", "unsafe-source-file");
    }
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(fd, { bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw new ControlError("control-plan-rejected", "source-file-changed");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd, { bigint: true });
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || after.mtimeNs !== opened.mtimeNs) {
      throw new ControlError("control-plan-rejected", "source-file-changed");
    }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new ControlError("control-plan-rejected", "invalid-utf8"); }
  } catch (error) {
    if (error instanceof ControlError) throw error;
    throw new ControlError("control-plan-rejected", `unreadable-source:${path}`);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function sourceRejected(detail: string): never {
  throw new ControlError("control-plan-rejected", detail);
}

function parseContract(path: string, taskId: string): { value: unknown; canonicalJson: string; hash: string } {
  let raw: unknown;
  try { raw = JSON.parse(readRegularUtf8(path)); }
  catch (error) {
    if (error instanceof ControlError) throw error;
    return sourceRejected(`contract-json:${taskId}`);
  }
  const parsed = taskContractSchema.safeParse(raw);
  if (!parsed.success || parsed.data.objective.taskId !== taskId) {
    return sourceRejected(`contract-shape:${taskId}`);
  }
  let bytes: Buffer;
  try { bytes = canonicalBytes(parsed.data); }
  catch { return sourceRejected(`contract-canonical:${taskId}`); }
  return { value: parsed.data, canonicalJson: bytes.toString("utf8"), hash: sha256Canonical(parsed.data) };
}

/**
 * Adapts the allowlisted scheduler format into the data needed by Web import.
 * The paths are consumed only here; callers archive the returned bytes and do
 * not retain a path as execution authority.
 */
export function readSchedulerControlPlanSource(planPath: string, repositoryPath: string): SchedulerControlPlanSource {
  let raw: unknown;
  try { raw = JSON.parse(readRegularUtf8(planPath)); }
  catch (error) {
    if (error instanceof ControlError) throw error;
    return sourceRejected("plan-json");
  }
  const loaded = loadPlan(raw, "");
  if ("rejections" in loaded) return sourceRejected(loaded.rejections.map(item => item.code).join(","));
  const plan = loaded.plan;
  if (plan.targetRepo !== repositoryPath || plan.goal === undefined || plan.successConditions === undefined || plan.successConditions.length === 0) {
    return sourceRejected("control-metadata");
  }
  if (new Set(plan.successConditions).size !== plan.successConditions.length) return sourceRejected("duplicate-success-condition");
  const taskIds = new Set(plan.tasks.map(task => task.taskId));
  for (const task of plan.tasks) {
    if (new Set(task.dependsOn).size !== task.dependsOn.length) return sourceRejected(`duplicate-dependency:${task.taskId}`);
    if (task.dependsOn.some(dependency => !taskIds.has(dependency))) return sourceRejected(`dangling-dependency:${task.taskId}`);
    if (task.targetVersion === undefined || task.configHash === undefined) return sourceRejected(`task-control-metadata:${task.taskId}`);
  }
  return {
    goal: plan.goal,
    successConditions: [...plan.successConditions],
    tasks: plan.tasks.map(task => {
      const original = parseContract(task.contract, task.taskId);
      return {
        taskId: task.taskId,
        dependencyTaskIds: [...task.dependsOn],
        targetVersion: task.targetVersion!,
        configHash: task.configHash!,
        originalContract: original.value,
        originalContractCanonicalJson: original.canonicalJson,
        originalContractHash: original.hash,
      };
    }),
  };
}

/**
 * A path counts as "inside" targetRepo only when it does not escape via
 * "..". node:path.relative is used rather than startsWith, which would
 * wrongly match a sibling directory that merely shares targetRepo as a
 * string prefix (e.g. targetRepo "/abs/repo" and contract "/abs/repo-2/x").
 *
 * `rel === ""` — contract and targetRepo are the same path — counts as INSIDE
 * (final-review fix wave, deferred minor 11). It used to count as outside,
 * because `relative(x, x)` is the empty string and the old test read
 * `rel !== "" && …`. That is the one input where the answer matters most:
 * §2.4.1 leans its entire "the write set can be computed once, at graph
 * construction time" argument on no contract being rewritable by an upstream
 * task, and a contract path that IS the repository is as inside as a path can
 * get.
 *
 * ⚠️ Symlinks are deliberately NOT resolved here, and that is a departure
 * from the review's suggestion, surfaced rather than silently skipped: this
 * module is the zero-I/O layer (`loadPlan` is called before a single file is
 * opened), and `realpath` on a contract path that does not exist yet THROWS —
 * which would put an unhandled exception back on the exact input-error path
 * this fix wave exists to turn into a clean exit 1. Registered as a follow-up
 * for the I/O layer, where a not-yet-existing path can be handled honestly.
 */
function isInsideRepo(targetRepo: string, contract: string): boolean {
  const rel = relative(targetRepo, contract);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * The up-front rejections named by `PLAN_LEVEL_CHECKS` — spec §2.3's six plus
 * the task-id-shape check below — all reported at once rather than
 * short-circuiting on the first: a caller who fixes one problem and re-runs
 * seven times is a caller this function is wasting. This layer is pure: no
 * filesystem, no git. baseBranch is passed in because discovering it belongs
 * to the CLI, against the target repo, not to this module.
 */
export function loadPlan(raw: unknown, baseBranch: string): { plan: PlanFile } | { rejections: PlanRejection[] } {
  const parsed = planFileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      rejections: parsed.error.issues.map((issue) => ({
        code: "malformed",
        message: `${issue.path.join(".") || "<root>"}: ${issue.message}`,
      })),
    };
  }
  const data = parsed.data;
  const rejections: PlanRejection[] = [];

  // 1. relative-path — every path field must be absolute. A relative path
  // resolves against whatever CWD the orchestrator happens to be in.
  const pathFields: Array<[string, string]> = [
    ["targetRepo", data.targetRepo],
    ["ccloopBin", data.ccloopBin],
    ["runsDir", data.runsDir],
  ];
  for (const task of data.tasks) {
    pathFields.push([`tasks[${task.taskId}].contract`, task.contract]);
  }
  for (const [field, value] of pathFields) {
    if (!isAbsolute(value)) {
      rejections.push({ code: RELATIVE_PATH, message: `${field} must be an absolute path, got ${JSON.stringify(value)}` });
    }
  }

  // 2. duplicate-task-id — taskId is the join key everywhere downstream;
  // a duplicate would make dependsOn ambiguous.
  const seen = new Set<string>();
  for (const task of data.tasks) {
    if (seen.has(task.taskId)) {
      rejections.push({ code: DUPLICATE_TASK_ID, message: `duplicate taskId: ${task.taskId}` });
    }
    seen.add(task.taskId);
  }

  // 3. cycle — a task graph with a cycle has no valid execution order.
  // detectCycle is shared with the graph layer (ruling R2, Task 4 SDD
  // ledger): it used to be a private DFS duplicated here, which this project's
  // review rubric treats as a defect once a real shared home exists.
  if (detectCycle(data.tasks)) {
    rejections.push({ code: CYCLE, message: "the task graph has a cycle" });
  }

  // 4. contract-inside-target-repo — the premise that lets the write set be
  // computed once, at graph construction time: a contract inside the repo
  // could be rewritten by an upstream task (spec §2.4.1).
  for (const task of data.tasks) {
    if (isInsideRepo(data.targetRepo, task.contract)) {
      rejections.push({
        code: CONTRACT_INSIDE_TARGET_REPO,
        message: `contract for ${task.taskId} lives inside targetRepo: ${task.contract}`,
      });
    }
  }

  // 5. work-branch-is-default — merging into the branch the round is cut
  // from is tier 0, mechanically forbidden rather than a matter of policy.
  // The code keeps its spec name; what it compares against is the base branch
  // (run.ts's `resolveBaseBranch`: the target repo's currently checked-out
  // branch), which is not necessarily the repository's true default.
  if (data.workBranch === baseBranch) {
    rejections.push({ code: WORK_BRANCH_IS_DEFAULT, message: `workBranch must not equal the base branch (${baseBranch})` });
  }

  // 6. unsupported-policy — rebase / pull-request are configuration this
  // version recognises and does not implement. Silently downgrading to a
  // local merge is the failure mode this rejects instead of hiding.
  if (data.policy !== "local-merge") {
    rejections.push({ code: UNSUPPORTED_POLICY, message: `unsupported policy: ${JSON.stringify(data.policy)}` });
  }

  // 7. unusable-task-id — a taskId that cannot become a legal run id
  // (spec §2.1's `orca-<taskId>-<hash8>`, validated by the ledger writer's own
  // RUN_ID). Mechanically decidable from the plan file alone, which by §2.3's
  // own logic is what makes something an up-front rejection rather than a
  // runtime failure.
  //
  // 🔴 It used to be neither: `deriveRunId` threw, and its first call sits
  // deep inside the layer loop, so a taskId like "team/alpha" cost a branch
  // creation, a checkout of a real person's worktree and a ledger commit
  // before dying with a raw node stack and exit 3. The same `RUN_ID` is
  // imported here that runId.ts imports, so this can never disagree with the
  // throw it front-runs.
  for (const task of data.tasks) {
    if (!RUN_ID.test(task.taskId)) {
      rejections.push({
        code: UNUSABLE_TASK_ID,
        message:
          `taskId ${JSON.stringify(task.taskId)} cannot become a run id ` +
          `(it must match ${RUN_ID}); spec §2.1 derives every run id as orca-<taskId>-<hash8>`,
      });
    }
  }

  if (rejections.length > 0) {
    return { rejections };
  }

  return { plan: { ...data, policy: "local-merge" } };
}
