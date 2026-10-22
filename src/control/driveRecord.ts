import { z } from "zod";
import { idSchema, runFailureCauseSchema, safeInteger } from "./schema.js";
import { lockSkillSchema } from "../skills/syncskill.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { pendingEntrySchema } from "./runLedger.js";
import { toolRulesReportSchema } from "./toolRules.js";
import type { ControlStore } from "./store.js";

/**
 * Execution driver spec §2.2. The five run states only the driver writes. Its `running` is the
 * existing `accepted` (displayed "running"), so the read model's "accepted with no provider attempt"
 * guard keeps applying. None of the five is terminal: each still owns its work item (`active=1`).
 */
export const DRIVER_RUN_STATES = ["start-pending", "collected", "landed", "reconciling", "blocked"] as const;

/** The step a blocked run was at, so a retry can send it back there (spec §2.3). */
export const driveStepSchema = z.enum(["A1", "A2", "B", "B'", "C", "D", "R", "E"]);
export type DriveStep = z.infer<typeof driveStepSchema>;

/**
 * Issue fixes spec §4.2(1): the most of ccloop's terminal `stopReason` Orca keeps, in UTF-16 code units. ccloop states
 * the reason first and the evidence path after it, so the cut keeps what the panel explains.
 */
export const STOP_REASON_MAX = 500;
export function boundStopReason(reason: string): string {
  return reason.length > STOP_REASON_MAX ? reason.slice(0, STOP_REASON_MAX) : reason;
}

/**
 * Failure-cause spec 2026-10-21 §3 (ccloop failure-causes spec §5): ccloop's run-level cause, which collect answers at its
 * top level for a terminal run. `cause` is read as a bounded string, not a closed enum, so a cause a newer ccloop adds
 * reads as itself and the panel words it as unknown (adding a cause is then no wire break). `detail` is ccloop's head of
 * the matched provider text (≤ 512 UTF-8 bytes there); Orca keeps at most FAILURE_DETAIL_MAX units of it.
 */
export const FAILURE_DETAIL_MAX = 512;
export { runFailureCauseSchema };
export type RunFailureCause = z.infer<typeof runFailureCauseSchema>;
export function boundFailureCause(cause: RunFailureCause): RunFailureCause {
  return { ...cause, detail: cause.detail === null ? null : cause.detail.slice(0, FAILURE_DETAIL_MAX) };
}

/**
 * ccloop priorFailures spec 2026-10-21 §3: the terminal's last recorded rejection (`recentFailures.at(-1)`), kept at
 * collect so a later re-dispatch (escalation ladder level 1) can say why the run failed. Bounded like stopReason.
 */
export const lastFailureSchema = z.object({
  rejectCategory: z.string().max(STOP_REASON_MAX),
  failingCommand: z.string().max(STOP_REASON_MAX).nullable(),
  // Ladder level 1 (priorFailures spec §3): the rest of ccloop's failure fingerprint, so the run's stored verification
  // copy can be matched to it (priorFailures.ts). Optional: a record from before this field still parses (its evidence
  // is then null). Kept only while it fits LAST_FAILURE_PATHS_MAX paths of STOP_REASON_MAX units each, else dropped.
  primaryTargetPaths: z.array(z.string().max(STOP_REASON_MAX)).max(64).optional(),
}).strict();
export const LAST_FAILURE_PATHS_MAX = 64;
export type LastFailure = z.infer<typeof lastFailureSchema>;
export function boundLastFailure(failure: { rejectCategory: string; failingCommand: string | null; primaryTargetPaths?: string[] }): LastFailure {
  // A fingerprint that does not fit is dropped whole, never cut: a cut one would match nothing, or the wrong copy.
  const paths = failure.primaryTargetPaths;
  const keep = paths !== undefined && paths.length <= LAST_FAILURE_PATHS_MAX && paths.every((path) => path.length <= STOP_REASON_MAX);
  return {
    rejectCategory: boundStopReason(failure.rejectCategory), failingCommand: failure.failingCommand === null ? null : boundStopReason(failure.failingCommand),
    ...(keep ? { primaryTargetPaths: paths } : {}),
  };
}

const commitSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);

/** spec §5.3: one conflict's reconciliation, recorded before and while it runs so a restart can find it. */
export const reconcileRecordSchema = z.object({
  copyPath: z.string().min(1),
  old: commitSchema,
  conflictCommit: commitSchema,
  conflictedPaths: z.array(z.string().min(1)),
  otherTaskId: idSchema,
  // Handoff delivery spec §5.2 N1 (controller decision, 2026-09-25): every landed task the conflict touches,
  // sorted by task id; `otherTaskId` is its first. Optional so a record from before this field still parses;
  // readers use `otherTaskIds ?? [otherTaskId]`.
  otherTaskIds: z.array(idSchema).min(1).optional(),
  reconcileRunId: z.string().min(1),
  runsDir: z.string().min(1),
  contractPath: z.string().min(1),
  tokenBudget: safeInteger.positive(),
  spawning: z.boolean(),
  pid: safeInteger.positive().nullable(),
  outcome: z.string().min(1).nullable(),
  attemptSha: commitSchema.nullable(),
  // Final review I4 (controller ruling, 2026-09-25): which spawn this is, 1 for the first, persisted before
  // each spawn. The spend is booked under it (never under a pid, which a retry clears). Defaulted so a
  // record from before this field existed still parses.
  spawnSeq: safeInteger.default(0),
  // Control run decisions plan Task 6: where the conflict's blocks are, for the reconcile decision's text. Optional: a
  // record from before this field still parses, and its reconciliation lands without that decision (stderr says so).
  conflictBlocks: z.array(z.object({ path: z.string().min(1), startLine: safeInteger, endLine: safeInteger }).strict()).optional(),
}).strict();
export type ReconcileRecord = z.infer<typeof reconcileRecordSchema>;

/**
 * Debug task plan Task 9: what a debug run's landing did about its correction (debugChecks.ts's ClosingRecord). Kept here,
 * not beside the mark, so this module's schema needs no import from the debug modules (a cycle through queries.ts).
 */
export const closingSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("written"), relPath: z.string().min(1), fixRunId: z.string().min(1) }).strict(),
  z.object({ state: z.literal("refused"), reason: z.string().min(1) }).strict(),
  z.object({ state: z.literal("chose-instead-missing") }).strict(),
  z.object({ state: z.literal("closed-by-human-first"), commit: z.string().min(1) }).strict(),
]);

/** Everything the driver writes into a run body, in one closed record (spec §7.4). */
export const driveRecordSchema = z.object({
  workspaceMode: z.enum(["worktree", "clone"]),
  sourceDir: z.string().min(1),
  // Single-call estimate spec §6.2 (review I3): null for an estimate run, which has no workspace to make or clean.
  workspacePath: z.string().min(1).nullable(),
  targetRepo: z.string().min(1).nullable(),
  prepared: z.boolean(),
  base: commitSchema.nullable(),
  envelopeHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  inspectUnknown: safeInteger,
  outcome: z.string().min(1).nullable(),
  attemptSha: commitSchema.nullable(),
  landedCommit: commitSchema.nullable(),
  reconcile: reconcileRecordSchema.nullable(),
  blockedAt: driveStepSchema.nullable(),
  blockedReason: z.string().min(1).nullable(),
  cleanedUp: z.boolean(),
  // Controller ruling P7 (2026-09-25): a cleanup failure on an already-settled run is recorded here,
  // never as a block -- the run stays `settled`, `cleanedUp:false`, and is retried next round.
  // Defaulted so a drive record from before this field existed (fixtures included) still parses.
  cleanupError: z.string().min(1).nullable().default(null),
  // Fix round 1 (2026-09-25, review Important 1/2): a projection-publish failure after settle is its
  // own field, never conflated with `cleanupError` -- a successful cleanup never clears it, and it is
  // cleared only once publishing itself succeeds. Defaulted for the same reason as `cleanupError`.
  publishError: z.string().min(1).nullable().default(null),
  // Syncskill integration spec §10.6: the run's injected skill snapshot -- where it is, the profile the task froze (null
  // for declared names) and syncskill's lock entries. Written once, with `prepared`; null for a run without skills.
  // Defaulted so a drive record from before this field existed still parses.
  skills: z.object({ dir: z.string().min(1), profile: z.string().min(1).nullable(), lock: z.array(lockSkillSchema) }).strict().nullable().default(null),
  // Issue fixes spec §4.2(1): ccloop's own reason for the terminal it reported (the port keeps the first STOP_REASON_MAX
  // units), stored when the run blocks on a terminal other than `succeeded`. Optional: absent when ccloop stated none and
  // in every drive record written before it existed; the v9 store keeps an older Orca from reading one.
  stopReason: z.string().min(1).optional(),
  // Failure-cause spec 2026-10-21 §3 and ccloop priorFailures spec §3: ccloop's run-level cause and the terminal's last
  // recorded rejection, stored with `stopReason` when the run blocks on a terminal other than `succeeded`. Optional: absent
  // when ccloop stated none (an older ccloop, or a run with no rejection) and in every drive record written before them.
  failureCause: runFailureCauseSchema.optional(),
  lastFailure: lastFailureSchema.optional(),
  // Checks spec 2026-10-22 §6.1: ccloop's terminal budgetSnapshot, stored with them, so a review that ran out of tokens,
  // attempts or time is told from one that failed (the outcome `exhausted` alone does not say which).
  budgetSnapshot: z.object({ attemptsRemaining: safeInteger, timeRemainingMs: safeInteger, tokenBudgetRemaining: safeInteger.nullable() }).strict().optional(),
  // ccloop per-contract tool rules spec 2026-10-22 §5: the run's tool-rule report, stored with `failureCause` (a violation
  // is the cause `tool-rule-violated`). Optional: absent for a contract without rules and in every older drive record.
  toolRules: toolRulesReportSchema.optional(),
  // Control run decisions: the run's refused decisions, staged by D before its compare-and-swap and inserted into
  // pending_decisions by markLanded (then cleared). Defaulted so a drive record from before this field still parses.
  stagedPending: z.array(pendingEntrySchema).default([]),
  // Control run decisions: the `orca: decisions <runId>` commit that carried this run's ledger lines when the run landed
  // nothing (`landedCommit` null); a later step writes it. Defaulted for the same reason.
  ledgerCommit: commitSchema.nullable().default(null),
  // Debug task plan Task 8 (design §12.8): the reproduce-first check of a debug run. `checking` is written before the check
  // touches the workspace and holds what a restart needs to restore it (fix round 1, R1): the attempt, the symbolic ref and
  // the untracked paths that were there, and whether the attempt was empty. `skipped` keeps the agent's reason for a
  // reproduction it declared not expressible, so the panel shows 未复现. Null for every other run; defaulted so a drive
  // record from before this field still parses.
  debugRepro: z.discriminatedUnion("state", [
    z.object({
      state: z.literal("checking"), startedAt: z.string().min(1), attemptSha: commitSchema, headRef: z.string().min(1).nullable(),
      untrackedBefore: z.array(z.string().min(1)), empty: z.boolean(),
      // Protect-acceptance-criteria spec §7a.1: the same off-round check, marker and restore run the base-version re-run of
      // a run whose attempt modified its check-defining files; absent for the reproduce-first check.
      check: z.literal("criteria-base").optional(),
    }).strict(),
    z.object({ state: z.literal("skipped"), reason: z.string().min(1) }).strict(),
  ]).nullable().default(null),
  // Debug task plan Task 9 (design §12.6): what a debug run's landing did about its correction, staged before the swap
  // beside `stagedPending` and copied into the group's `debug.closing` by the landing's write (then cleared). Null for
  // every other run; defaulted so a drive record from before this field still parses.
  stagedDebugClosing: closingSchema.nullable().default(null),
  // Protect-acceptance-criteria spec 2026-10-21 §4.3: the flag on this run's `criteria` decision, staged beside
  // `stagedPending` before the swap and written by the landing's write (then cleared). Null when nothing is flagged.
  stagedCriteriaFlag: z.object({ decisionId: z.string().min(1), reason: z.string().min(1), evidence: z.array(z.string()) }).strict().nullable().default(null),
  // Flow engine spec §6.2: a `dir` flow group's normalised decisions, staged before the swap and written to `flow_decisions`
  // by the landing's write (then cleared). Absent for every other run, so their drive records are unchanged.
  stagedFlowDecisions: z.array(z.unknown()).optional(),
  // Protect-acceptance-criteria spec §4.2: the required checks run with the base versions of the changed check-defining
  // files over the attempt -- `passed` (the code meets the old criteria too), or `failed` with the first command that did
  // not exit 0 (failed and could-not-run are not told apart, §7a.4). Null when no re-run happened.
  criteriaBase: z.discriminatedUnion("result", [
    z.object({ result: z.literal("passed") }).strict(),
    z.object({ result: z.literal("failed"), command: z.string().min(1) }).strict(),
  ]).nullable().default(null),
}).strict();
export type DriveRecord = z.infer<typeof driveRecordSchema>;

/** Where a run blocked at each step resumes (spec §2.3); `running` is persisted as `accepted`. */
export const RESUME_STATE: Record<DriveStep, string> = {
  A1: "starting", A2: "start-pending", B: "start-pending", "B'": "unknown", C: "accepted", D: "collected", R: "reconciling", E: "landed",
};

/**
 * Issue fixes spec §4.2(3): a run the driver blocked at C because its ccloop run ended with an outcome other than
 * `succeeded`. Sending it back to C would only collect the same terminal again, so recovery-retry refuses it; retry-task
 * (retryTask.ts, which names each failed condition in its refusal) is its way out.
 */
export function isTerminallyFailedRun(run: { state: string; drive?: DriveRecord }): boolean {
  return run.state === "blocked" && run.drive !== undefined && run.drive.blockedAt === "C" && run.drive.outcome !== null && run.drive.outcome !== "succeeded";
}

/**
 * `recovery-retry` on a blocked driver run: back to the step it was blocked at, reason cleared.
 * Blocked at A2 means the workspace was never recorded as prepared, so A2 runs again; blocked at R
 * forgets the dead reconciliation process so the next round decides afresh. Answers whether it
 * changed anything, which is what `recovery-observed.resolved` reports.
 *
 * Final review I4: at R the collected `outcome` and the `spawnSeq` are kept. A reconciliation already
 * collected and refused (an outcome is recorded) is then spawned again rather than collected again,
 * and its earlier spawn is never booked a second time.
 */
export function resumeBlockedDriverRun(store: ControlStore, runId: string): boolean {
  const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId);
  if (!row) return false;
  const run = JSON.parse(String(row.body)) as { groupId: string; state: string; drive?: DriveRecord };
  if (run.state !== "blocked" || run.drive === undefined || run.drive.blockedAt === null) return false;
  const step = run.drive.blockedAt;
  run.state = RESUME_STATE[step];
  run.drive = {
    ...run.drive, blockedAt: null, blockedReason: null, inspectUnknown: 0,
    prepared: step === "A2" ? false : run.drive.prepared,
    reconcile: step === "R" && run.drive.reconcile !== null ? { ...run.drive.reconcile, spawning: false, pid: null, attemptSha: null } : run.drive.reconcile,
  };
  store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), runId);
  recordProjectionChange(store, [run.groupId]);
  return true;
}
