import { z } from "zod";
import { taskContractSchema, type SchedulerControlPlanSource } from "../scheduler/planFile.js";
import type { PartialSelection } from "./agentSelection.js";
import { isGroupArchived } from "./archivedMark.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { applyWebCommand } from "./commandLedger.js";
import { DEBUG_DEFAULT_EXECUTION_POLICY, DEBUG_DEFAULT_MAX_FILES_TOUCHED, DEBUG_REJECT_ON, DEBUG_TASK_ID, DEBUG_VERIFIER_TYPE, debugPlanId } from "./debugPlan.js";
import { isTerminallyFailedRun, type DriveRecord } from "./driveRecord.js";
import { ControlError } from "./errors.js";
import { normalizeControlPlan, writeImportedPlan } from "./planImport.js";
import { readArchivedPlan } from "./queries.js";
import { writeCanonicalRecord } from "./snapshot.js";
import type { ControlStore } from "./store.js";
import type { WebCommandResult, WebServiceDeps } from "./webService.js";
import { systemDebugSourceSchema, type CommandSuccessV1, type RawAuthorityCommandV1 } from "./webProtocol.js";

/**
 * System debug task spec 2026-10-21 §2: a debug group Orca opens itself -- the escalation ladder's level 2 (kanban spec
 * §6, §9a.4), a red integration check (§7), a flagged test change judged unjustified (protect spec §7a.3). Never a
 * correction row. Its mark is `body.systemDebug`, apart from a correction's `body.debug`, so none of the correction's
 * landing paths (closing row, reproduce-first check, correction-closed) apply to it. Every trigger, id and transition
 * here is code (Rule 5); the model only works inside the debug run.
 */
export type SystemDebugOpenCommand = Extract<RawAuthorityCommandV1, { verb: "system-debug-open" }>;
export type SystemDebugSource = z.infer<typeof systemDebugSourceSchema>;

export const SYSTEM_DEBUG_INPUT_SCHEMA = "orca-system-debug-input-v1";
/** §2: the debug task's write set, the whole repository (the original's denylist still applies). */
export const SYSTEM_DEBUG_TARGET_PATH = "**";
const settledSchema = z.object({ state: z.string().min(1), at: z.number().int(), detail: z.string().nullable() }).strict();
const systemDebugMarkSchema = z.object({
  source: systemDebugSourceSchema, stackOn: z.string().min(1).nullable(), inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  settled: settledSchema.nullable(),
}).strict();
export type SystemDebugMark = z.infer<typeof systemDebugMarkSchema>;

/** A group body's system debug mark; null on any other group. A mark that does not parse blocks by name. */
export function readSystemDebugMark(group: unknown): SystemDebugMark | null {
  if (typeof group !== "object" || group === null || !Object.hasOwn(group, "systemDebug")) return null;
  const parsed = systemDebugMarkSchema.safeParse((group as { systemDebug: unknown }).systemDebug);
  if (!parsed.success) throw new ControlError("recovery-blocked", "system-debug-mark-invalid");
  return parsed.data;
}

/**
 * §2: the group id is derived from the source, so a second open is a lookup. A ladder's key leaves the run out: one
 * ladder debug group per (group, task) is the ladder's cap (kanban §6: at most 2 extra runs per task).
 */
export function systemDebugGroupId(source: SystemDebugSource): string {
  const key = source.kind === "ladder" ? { kind: source.kind, groupId: source.groupId, taskId: source.taskId } : source;
  return `sysdebug-${source.kind}-${sha256Canonical(key).slice(0, 16)}`;
}

function groupBody(store: ControlStore, groupId: string): Record<string, unknown> | null {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  return row === undefined ? null : JSON.parse(String(row.body)) as Record<string, unknown>;
}

type TaskContract = z.infer<typeof taskContractSchema>;

/** The source task's contract as the archived plan froze it; null when there is no task or it cannot be read. */
function sourceContract(store: ControlStore, source: SystemDebugSource): TaskContract | null {
  if (source.taskId === null) return null;
  try {
    const task = readArchivedPlan(store, source.groupId).plan.tasks.find((entry) => entry.taskId === source.taskId);
    return task === undefined ? null : taskContractSchema.parse(JSON.parse(task.originalContractCanonicalJson));
  } catch { return null; }
}

/** The source task's frozen agent and model (the plan layer of the debug group), so it runs where the original ran. */
function sourceAgent(store: ControlStore, source: SystemDebugSource): PartialSelection | undefined {
  if (source.taskId === null) return undefined;
  const row = store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get(source.groupId, source.taskId);
  const agent = row === undefined ? undefined : (JSON.parse(String(row.body)) as { agent?: { agent?: unknown; model?: unknown } }).agent;
  return typeof agent?.agent === "string" && typeof agent.model === "string" ? { agent: agent.agent, model: agent.model } : undefined;
}

const INSTRUCTION: Record<SystemDebugSource["kind"], string> = {
  "ladder": "The task below could not be completed: its run ended without success. Find why, and make it pass. Rule out first: a wrong or ambiguous check or task, the base already failing the check, the environment.",
  "integration-check": "Groups that each passed their own checks were combined on the target, and the checks below fail there. Find what the combination broke and fix it.",
  // Protect-acceptance-criteria spec §5 as built (§9): the judge and the fix are one run; an empty attempt is "justified".
  "criteria-review": "A landed task changed the tests or checks that define its acceptance, and Orca flagged it. Judge whether the task's goal required that change. If it did, change nothing. If it did not, restore the stronger criteria and fix the code so they pass.",
};

/** §2: the goal, from the input alone (no model, no I/O): the same input gives the same bytes. */
export function systemDebugGoalText(input: SystemDebugInputV1, contract: TaskContract | null): string {
  const where = [`group ${input.source.groupId}`, ...(input.source.taskId === null ? [] : [`task ${input.source.taskId}`]), ...(input.source.runId === null ? [] : [`run ${input.source.runId}`])].join(", ");
  const lines = [
    `System debug task (${input.source.kind}) opened by Orca for ${where}.`,
    INSTRUCTION[input.source.kind],
    "If a check or the task itself is wrong or ambiguous, change it, and report that as a major decision with the reason; Orca flags it for the person.",
    "",
    "What Orca observed:",
    ...input.facts.map((fact) => `- ${fact}`),
    "",
    `The checks this task is held to: ${input.checks.join("; ")}`,
  ];
  if (contract !== null) lines.push(`The original task's goal: ${contract.objective.goal}`);
  return lines.join("\n") + "\n";
}

export interface SystemDebugInputV1 {
  schema: typeof SYSTEM_DEBUG_INPUT_SCHEMA; source: SystemDebugSource; stackOn: string | null; repoId: string; facts: string[]; checks: string[];
}

const unique = (values: readonly string[]): string[] => [...new Set(values)];

/** §2: the one-task plan. The original's paths, policies and budgets when there is one; the checks are the input's. */
export function buildSystemDebugPlanSource(input: SystemDebugInputV1, contract: TaskContract | null, repoPath: string, agent: PartialSelection | undefined): SchedulerControlPlanSource {
  const goal = systemDebugGoalText(input, contract);
  const checks = unique(input.checks);
  const debug = taskContractSchema.parse({
    objective: { taskId: DEBUG_TASK_ID, goal, successCondition: `the checks pass: ${checks.join("; ")}`, nonGoals: [] },
    context: {
      // The cause may sit outside the original's write set (a check, a test, a shared module): the whole repository,
      // under the original's denylist (spec §2).
      // "**", not ".": writeSet.ts normalizes "**" to the whole repository, while "." is a directory literally named "."
      // to its segment comparison.
      repoPath, targetPaths: [SYSTEM_DEBUG_TARGET_PATH], relevantDocs: [...(contract?.context.relevantDocs ?? [])],
      buildTestCommands: checks, constraints: [],
    },
    executionPolicy: { ...(contract?.executionPolicy ?? DEBUG_DEFAULT_EXECUTION_POLICY) },
    safetyPolicy: {
      // The debug task may have to change a check (§2), so the original's allowlist is not inherited; its denylist is.
      allowlistPaths: [], denylistPaths: [...(contract?.safetyPolicy.denylistPaths ?? [])],
      maxFilesTouched: DEBUG_DEFAULT_MAX_FILES_TOUCHED,
      humanGateConditions: [...(contract?.safetyPolicy.humanGateConditions ?? [])],
    },
    verification: { verifierType: DEBUG_VERIFIER_TYPE, requiredChecks: checks, rejectOn: [...DEBUG_REJECT_ON], evidenceRequired: [] },
    escalationAndExit: {},
  });
  return {
    goal: goal.split("\n", 1)[0]!,
    successConditions: [debug.objective.successCondition],
    ...(agent ? { agent } : {}),
    tasks: [{
      taskId: DEBUG_TASK_ID, dependencyTaskIds: [], targetVersion: 1,
      originalContract: debug, originalContractCanonicalJson: canonicalBytes(debug).toString("utf8"), originalContractHash: sha256Canonical(debug),
    }],
  };
}

export interface SystemDebugOpenDeps extends WebServiceDeps { repositoryPath: (repoId: string) => string }

function success(context: Parameters<Parameters<typeof applyWebCommand>[1]["apply"]>[0], groupId: string, created: boolean): { status: number; body: CommandSuccessV1 } {
  return { status: created ? 201 : 200, body: {
    schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
    verb: context.rawCommand.verb, target: context.rawCommand.target,
    commandRevision: created ? context.nextCommandRevision : context.currentCommandRevision,
    projectionSeq: created ? context.nextProjectionSeq : context.currentProjectionSeq,
    effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
    result: { kind: "system-debug-opened", groupId, created },
  } };
}

/**
 * §2: open (or find) the system debug group the source names. Imported with no estimate (as a correction's debug group:
 * its grant is the contract's own budget); a ladder group's work is folded back into its original group, so it carries
 * no integration scheme of its own (keep).
 */
export function applySystemDebugOpen(deps: SystemDebugOpenDeps, command: SystemDebugOpenCommand): WebCommandResult {
  const { source, stackOn, repoId, facts, checks } = command.payload;
  let repoPath: string | null = null, refusal: unknown = null;
  try { repoPath = deps.repositoryPath(repoId); } catch (error) { refusal = error instanceof ControlError ? error : new ControlError("correction-repository-unknown", repoId); }
  return applyWebCommand<WebCommandResult>(deps.store, {
    rawCommand: command,
    expand: () => { if (refusal !== null) throw refusal; return { ...command, schema: "orca-authority-command-v1" }; },
    authorityChanged: (outcome) => "result" in outcome.body && outcome.body.result.kind === "system-debug-opened" && outcome.body.result.created,
    apply: (context) => {
      const groupId = command.target.groupId;
      if (systemDebugGroupId(source) !== groupId) throw new ControlError("plan-version-conflict", "system-debug-target-mismatch");
      const existing = groupBody(deps.store, groupId);
      if (existing !== null) {
        if (readSystemDebugMark(existing) === null) throw new ControlError("group-already-exists");
        return success(context, groupId, false);
      }
      const input: SystemDebugInputV1 = { schema: SYSTEM_DEBUG_INPUT_SCHEMA, source, stackOn, repoId, facts: [...facts], checks: [...checks] };
      const inputJson = canonicalBytes(input).toString("utf8"), inputHash = sha256Canonical(input);
      const planId = debugPlanId(groupId);
      const plan = normalizeControlPlan({ ...buildSystemDebugPlanSource(input, sourceContract(deps.store, source), repoPath!, sourceAgent(deps.store, source)), repoId, planId });
      const defaults = deps.defaults();
      writeImportedPlan({
        ...deps, estimatorSlot: { kind: "rejected", partial: null, code: "control-estimator-unconfigured" },
        estimatorObservation: () => { throw new ControlError("control-estimator-unconfigured"); },
      }, {
        groupId, repoId, planId, plan, actorId: context.rawCommand.actorId, commandId: context.rawCommand.commandId,
        estimatorProfileId: defaults?.estimatorProfileId ?? null, estimatorProfileHash: defaults?.estimatorProfileHash ?? null, estimateMode: defaults?.estimateMode ?? "strict",
      }, null, { estimate: "deferred" });
      writeCanonicalRecord(deps.store, groupId, inputHash, inputJson);
      const body = groupBody(deps.store, groupId)!;
      if (stackOn !== null) delete body.integration;
      const mark: SystemDebugMark = { source, stackOn, inputHash, settled: null };
      deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body, systemDebug: mark }), groupId);
      deps.beforeCommit?.();
      return success(context, groupId, true);
    },
  }).body;
}

/** Records how a system debug group ended for its source (§3.4); written once, in its own transaction. */
export function settleSystemDebug(store: ControlStore, groupId: string, state: string, detail: string | null): void {
  store.transaction(() => {
    const body = groupBody(store, groupId);
    const mark = body === null ? null : readSystemDebugMark(body);
    if (body === null || mark === null || mark.settled !== null) return;
    store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body, systemDebug: { ...mark, settled: { state, at: store.now(), detail: detail === null ? null : detail.slice(0, 500) } } }), groupId);
  });
}

/** The system debug groups, with their marks, in creation order. */
export function systemDebugGroups(store: ControlStore): Array<{ groupId: string; status: string; mark: SystemDebugMark }> {
  return store.db.prepare("SELECT id, body FROM groups WHERE substr(id,1,9)='sysdebug-' ORDER BY rowid").all().flatMap((row) => {
    const body = JSON.parse(String(row.body)) as Record<string, unknown>;
    const mark = readSystemDebugMark(body);
    return mark === null ? [] : [{ groupId: String(row.id), status: String(body.status), mark }];
  });
}

type Work = { kind?: unknown; status?: unknown; currentRunId?: unknown; taskId?: unknown };
function tasksOf(store: ControlStore, groupId: string): Array<{ id: string; work: Work }> {
  return store.db.prepare("SELECT id, body FROM work_items WHERE group_id=? ORDER BY rowid").all(groupId)
    .map((row) => ({ id: String(row.id), work: JSON.parse(String(row.body)) as Work })).filter((entry) => entry.work.kind === "task");
}

function runBody(store: ControlStore, runId: unknown): { runId: string; state: string; drive?: DriveRecord; failureCode?: unknown } | null {
  if (typeof runId !== "string") return null;
  const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId);
  return row === undefined ? null : JSON.parse(String(row.body)) as { runId: string; state: string; drive?: DriveRecord };
}

/** The task's current run, when it ended terminally failed (blocked at C with a non-succeeded outcome). */
export function terminallyFailedRun(store: ControlStore, groupId: string, taskId: string): { runId: string; state: string; drive?: DriveRecord; failureCode?: unknown } | null {
  const task = tasksOf(store, groupId).find((entry) => entry.id === taskId);
  const run = task === undefined ? null : runBody(store, task.work.currentRunId);
  return run !== null && isTerminallyFailedRun(run) ? run : null;
}

export function allTasksDone(store: ControlStore, groupId: string): boolean {
  const tasks = tasksOf(store, groupId);
  return tasks.length > 0 && tasks.every((entry) => entry.work.status === "done" || entry.work.status === "completed");
}

/** Whether any task of the group ended terminally failed (its own run is not escalated: no recursion, §2). */
export function anyTaskFailed(store: ControlStore, groupId: string): boolean {
  return tasksOf(store, groupId).some((entry) => { const run = runBody(store, entry.work.currentRunId); return run !== null && isTerminallyFailedRun(run); });
}

/**
 * §3.1: a ladder candidate -- a group Orca orchestrates (an orchestration record in mode `run`: a "Confirm only" group is
 * the person's to drive, so Orca adds no run to it), not itself a debug group, with a failed task and no ladder yet.
 */
export function ladderCandidates(store: ControlStore): Array<{ groupId: string; taskId: string; run: NonNullable<ReturnType<typeof terminallyFailedRun>>; repoId: string }> {
  const out: Array<{ groupId: string; taskId: string; run: NonNullable<ReturnType<typeof terminallyFailedRun>>; repoId: string }> = [];
  for (const row of store.db.prepare("SELECT g.id AS id, g.body AS body, o.body AS orchestration FROM groups g JOIN group_orchestration o ON o.group_id=g.id ORDER BY g.rowid").all()) {
    const groupId = String(row.id);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(String(row.body)) as Record<string, unknown>;
      if ((JSON.parse(String(row.orchestration)) as { mode?: unknown }).mode !== "run") continue;
    } catch { continue; }
    if (Object.hasOwn(body, "debug") || Object.hasOwn(body, "systemDebug") || isGroupArchived(store, groupId)) continue;
    const repoId = (body.plan as { repoId?: unknown } | undefined)?.repoId;
    if (typeof repoId !== "string") continue;
    for (const { id: taskId } of tasksOf(store, groupId)) {
      const run = terminallyFailedRun(store, groupId, taskId);
      if (run === null) continue;
      if (groupBody(store, systemDebugGroupId({ kind: "ladder", groupId, taskId, runId: null })) !== null) continue;
      out.push({ groupId, taskId, run, repoId });
    }
  }
  return out;
}

/** §3.1: the facts a ladder debug task is given -- what Orca recorded about the failed run, nothing interpreted. */
export function ladderFacts(run: { runId: string; drive?: DriveRecord; failureCode?: unknown }): string[] {
  const drive = run.drive;
  const facts = [`run ${run.runId} ended with outcome ${drive?.outcome ?? "unknown"}`];
  if (typeof drive?.stopReason === "string") facts.push(`ccloop's stop reason: ${drive.stopReason}`);
  if (typeof drive?.blockedReason === "string") facts.push(`Orca blocked it: ${drive.blockedReason}`);
  if (typeof run.failureCode === "string") facts.push(`failure code: ${run.failureCode}`);
  if (typeof drive?.attemptSha === "string") facts.push(`the failed attempt's commit (not on the branch; read it with git show): ${drive.attemptSha}`);
  return facts.map((fact) => fact.slice(0, 4096));
}

export type EscalationState = "debugging" | "rerunning" | "exhausted";

/**
 * §3.5: each ladder escalation of the group's tasks, by code from the debug group's mark and the tasks' runs.
 * `exhausted` (level 3, needs you): the debug group failed, refused or could not fold, or the rerun failed again.
 */
export function escalationsOf(store: ControlStore, groupId: string): Array<{ taskId: string; debugGroupId: string; state: EscalationState; reason: string | null }> {
  // One read of the ladder groups first: a group with none (nearly every group) costs no work item or run read, so a
  // summary's reads stay independent of its task count (controlPollPerformance's bound).
  const ladders = store.db.prepare("SELECT id, body FROM groups WHERE substr(id,1,16)='sysdebug-ladder-' ORDER BY rowid").all().flatMap((row) => {
    let mark: SystemDebugMark | null;
    try { mark = readSystemDebugMark(JSON.parse(String(row.body))); } catch { return []; }
    return mark !== null && mark.source.groupId === groupId && mark.source.taskId !== null ? [{ debugGroupId: String(row.id), mark }] : [];
  });
  if (ladders.length === 0) return [];
  const out: Array<{ taskId: string; debugGroupId: string; state: EscalationState; reason: string | null }> = [];
  for (const { debugGroupId, mark } of ladders) {
    const taskId = mark.source.taskId!;
    const failed = terminallyFailedRun(store, groupId, taskId);
    // Done since: the rerun succeeded (or a person finished it); nothing is escalated any more.
    if (allTasksDone(store, groupId) || tasksOf(store, groupId).find((entry) => entry.id === taskId)?.work.status === "done") continue;
    if (mark.settled?.state === "superseded") continue;
    if (mark.settled === null) {
      out.push(anyTaskFailed(store, debugGroupId) ? { taskId, debugGroupId, state: "exhausted", reason: "debug-task-failed" } : { taskId, debugGroupId, state: "debugging", reason: null });
    } else if (mark.settled.state === "folded") {
      // The rerun is the task's next run; the same failed run still current means the retry has not been claimed yet.
      out.push(failed !== null && failed.runId !== mark.source.runId ? { taskId, debugGroupId, state: "exhausted", reason: "rerun-failed" } : { taskId, debugGroupId, state: "rerunning", reason: null });
    } else {
      out.push({ taskId, debugGroupId, state: "exhausted", reason: mark.settled.state });
    }
  }
  return out;
}
