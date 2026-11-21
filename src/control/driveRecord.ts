import { z } from "zod";
import { artifactSchema, idSchema, runFailureCauseSchema, safeInteger } from "./schema.js";
import { lockSkillSchema } from "../skills/syncskill.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { pendingEntrySchema } from "./runLedger.js";
import { toolRulesReportSchema } from "./toolRules.js";
import type { ControlStore } from "./store.js";
import { pathPolicyMissesSchema } from "./pathPolicyMisses.js";
import { historySourceObservationSchema } from "./historyExpectation.js";

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
  // Tester follow-up H: the token budget this reconciliation waits to be funded with while running ceilings hold the
  // group's remainder (driverLanding.ts reconcileFunding); claims leave it aside. Absent when it is not waiting.
  fundingWait: safeInteger.positive().optional(),
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

/**
 * Tester follow-up E §4 (#245): one command a check Orca ran itself (checkCommand.ts): its exit as runCheckRecorded names
 * it ("0" on a pass, a number, or `timeout <n> ms`) and its wall-clock time. A setup command is named `setup: <cmd>`.
 */
export const checkRunCommandSchema = z.object({ command: z.string().min(1), exit: z.string().min(1), ms: safeInteger }).strict();
export type CheckRunCommand = z.infer<typeof checkRunCommandSchema>;
export const POST_MERGE_NOT_NEEDED = ["fast-forward", "tree-equal", "no-required-checks", "no-task"] as const;
export const postMergeCheckRecordSchema = z.object({
  // `skipped` (why `stopped`): the driver stopped while the check ran; the run stays `collected` and the next driver merges
  // and checks again, whose record replaces this one (#245).
  result: z.enum(["passed", "failed", "not-needed", "skipped"]),
  why: z.enum([...POST_MERGE_NOT_NEEDED, "stopped"]).optional(),
  attemptSha: commitSchema, mergedSha: commitSchema, oldTip: commitSchema,
  commands: z.array(checkRunCommandSchema),
  // The failing command's output tail, bounded as the block reason bounds it; on a failure only.
  tail: z.string().max(2048).optional(),
}).strict();
export type PostMergeCheckRecord = z.infer<typeof postMergeCheckRecordSchema>;

/** Everything the driver writes into a run body, in one closed record (spec §7.4). */
export const driveRecordSchema = z.object({
  workspaceMode: z.enum(["worktree", "clone"]),
  sourceDir: z.string().min(1),
  // Single-call estimate spec §6.2 (review I3): null for an estimate run, which has no workspace to make or clean.
  workspacePath: z.string().min(1).nullable(),
  targetRepo: z.string().min(1).nullable(),
  prepared: z.boolean(),
  base: commitSchema.nullable(),
  // Multi-directory projects spec §7.1/§7.3: each written directory's target, base and workspace, in registered order
  // (the primary first); its attempt sha is recorded at C. Absent for every single-repository run.
  dirs: z.array(z.object({
    key: z.string().min(1), targetRepo: z.string().min(1), base: commitSchema, workspacePath: z.string().min(1),
    attemptSha: commitSchema.nullable().optional(),
    // Change-sized runs spec 2026-11-19 §5.7 (P2): the extra's attempt pinned at refs/orca/runs/<runId> in its own target.
    runRef: z.object({ ref: z.string().min(1), sha: commitSchema }).strict().nullable().optional(),
  }).strict()).min(1).optional(),
  // Multi-directory projects spec §8.1: the journal of a multi run's landing -- every directory's produced commit, written
  // in one transaction before the first compare-and-swap, so a death after one swap still names the rest. Null (or absent)
  // for every single-repository run; defaulted so an older record still parses.
  landingPlan: z.array(z.object({ key: z.string().min(1), old: commitSchema, next: commitSchema }).strict()).nullable().default(null),
  // §8.1 step 6: what each directory landed at, beside the primary's `landedCommit`. Defaulted for the same reason.
  landedDirs: z.record(z.string().min(1), commitSchema).nullable().default(null),
  envelopeHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  inspectUnknown: safeInteger,
  // Tester follow-up J (#308): accepts re-issued at B' for an execution ccloop reports never claimed by a worker
  // (executionDriver.ts LAUNCH_RELAUNCH_LIMIT). Optional: absent on every run that never needed one; recovery-retry drops it.
  relaunches: safeInteger.optional(),
  outcome: z.string().min(1).nullable(),
  attemptSha: commitSchema.nullable(),
  // Change-sized runs spec 2026-11-19 §5.3, §6.2 (P2). All optional, so a record written before P2 parses as it is.
  // snapshotVersion: 2 iff A2 found a ccloop that reads snapshot v2 (features.attemptRef "v1"); the run then archives v2,
  //   and `attemptDelivery` says whether its envelope carried the key. A run without it archives v1, exactly as before.
  // runRef: the attempt pinned at refs/orca/runs/<runId> in the target (step C, or the archive on a path that never ran C).
  // attemptHead / attemptSource: snapshot v2's `head` and `source` for that attempt (§7.1).
  snapshotVersion: z.literal(2).optional(),
  attemptDelivery: z.literal("ref-v1").optional(),
  runRef: z.object({ ref: z.string().min(1), sha: commitSchema }).strict().nullable().optional(),
  attemptHead: commitSchema.optional(),
  attemptSource: z.enum(["ccloop-published", "ccloop-live", "orca-commit", "base"]).optional(),
  /** Git ref observation pinned before a named-source landing; absent from ordinary runs. */
  historySource: historySourceObservationSchema.optional(),
  /** Group tip after a no-change run's own ledger was committed, usable by its later judge or person decision. */
  historyNoChangeTip: commitSchema.optional(),
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
  pathPolicyMisses: pathPolicyMissesSchema.optional(),
  // Memory in runs spec 2026-11-20 §3: the bundle frozen at A2 (its ids are the run evidence), or the named reason
  // there is none. Absent when ccmem is not configured at all; `memoryReport` is ccloop's echo, i.e. the dispatch proof.
  memory: z.union([
    z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), ids: z.array(safeInteger.positive()).min(1).max(64), tokens: safeInteger.positive() }).strict(),
    z.object({ error: z.string().min(1).max(200) }).strict(),
  ]).optional(),
  memoryReport: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), ids: z.array(safeInteger.positive()).min(1).max(64), tokens: safeInteger.positive() }).strict().optional(),
  // Run-outcome writeback spec 2026-11-21 §3.1: the outbox row. `payload` is frozen on first sight so a retry resends
  // the same bytes; `state` moves pending → sent/refused/failed/skipped (unsupported is a per-binary probe answer).
  memoryFeedback: z.object({
    state: z.enum(["pending", "sent", "refused", "failed", "unsupported", "skipped"]),
    payload: z.object({ version: z.literal(1), runId: idSchema, taskId: idSchema.nullable(), attempt: safeInteger.positive().nullable(), outcome: z.string().min(1), abandoned: z.boolean(), memoryIds: z.array(safeInteger.positive()).min(1).max(64), observedAt: safeInteger }).strict().optional(),
    detail: z.string().min(1).max(300).optional(),
    at: safeInteger,
    attempts: safeInteger,
  }).strict().optional(),
  // Off-plan writes W4 (#346, Task 5 fix round 1): the parallel sibling's claim the run was stopped on, classified once
  // when the block was recorded (parallelClaims.ts parallelClaimOf), so a later change to the task's frozen siblings does
  // not rewrite why this run stopped. Absent when the stop is on no sibling's claim and in every older drive record.
  parallelClaim: z.object({ path: z.string().min(1), repoKey: z.string().min(1).nullable(), siblingIds: z.array(idSchema).min(1) }).strict().optional(),
  // Failure-cause spec 2026-10-21 §3 and ccloop priorFailures spec §3: ccloop's run-level cause and the terminal's last
  // recorded rejection, stored with `stopReason` when the run blocks on a terminal other than `succeeded`. Optional: absent
  // when ccloop stated none (an older ccloop, or a run with no rejection) and in every drive record written before them.
  failureCause: runFailureCauseSchema.optional(),
  lastFailure: lastFailureSchema.optional(),
  // Tester #321 C1 review 3 (I-B): ccloop's terminal `currentAttempt` -- the attempt the run ended on -- stored with them, so
  // the final rejection is read from the collector's stored copy of that attempt, not from the collector page's own
  // `currentAttempt`, which lags when a collect is missed. Optional: absent from an older ccloop and every older drive record.
  finalAttempt: safeInteger.positive().optional(),
  // Issue #209: a run that failed as rate-limited whose frozen model the agent's read catalog does not list, in the words
  // the selection preview warned with (estimatorCompatibility.ts catalogMissReason). Optional: absent for every other run
  // and in every older drive record.
  catalogMiss: z.string().min(1).optional(),
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
  // No-change completion (2026-11-08): the Git proof that an opted-in task's attempt tree equals its base tree, written at
  // C so E can accept the result only with the check evidence the contract declared decisive. Null/absent for every run
  // that changed the tree and for every record written before this field; defaulted so older records still parse.
  noChange: z.object({
    base: commitSchema, attempt: commitSchema, baseTree: commitSchema, attemptTree: commitSchema,
    contractHash: z.string().regex(/^[a-f0-9]{64}$/), requiredChecks: z.array(z.string().min(1)).min(1),
  }).strict().nullable().default(null),
  // Tester follow-up G spec §1 (multi-repo): every directory's tree proof of a multi run whose directories are all
  // unchanged; `noChange` keeps the primary's. Absent for every other run (optional, so no other record gains a byte).
  // Tester follow-up G spec §10.1: the goal judge of a command-verified no-change run -- its run, what it answered, and
  // the finding. Absent for every other run (optional, so no other record gains a byte).
  noChangeJudge: z.object({ runId: z.string().nullable(), state: z.enum(["pending", "met", "not-met", "cannot-judge", "failed", "unfunded"]), finding: z.string().optional() }).strict().optional(),
  noChangeDirs: z.array(z.object({ key: z.string().min(1), base: commitSchema, attempt: commitSchema, baseTree: commitSchema, attemptTree: commitSchema }).strict()).optional(),
  // Debug task plan Task 8 (design §12.8): the reproduce-first check of a debug run. `checking` is written before the check
  // touches the workspace and holds what a restart needs to restore it (fix round 1, R1): the attempt, the symbolic ref and
  // the untracked paths that were there, and whether the attempt was empty. `skipped` keeps the agent's reason for a
  // reproduction it declared not expressible, so the panel shows 未复现. Null for every other run; defaulted so a drive
  // record from before this field still parses.
  debugRepro: z.discriminatedUnion("state", [
    z.object({
      state: z.literal("checking"), startedAt: z.string().min(1), attemptSha: commitSchema, headRef: z.string().min(1).nullable(),
      untrackedBefore: z.array(z.string().min(1)), empty: z.boolean(),
      // Task setup spec 2026-11-04 §4.6 (final-review fix wave, I2): the ignored paths that were there, kept only for a
      // task with setup commands so the restore removes what Orca's setup installed; absent otherwise (bytes unchanged).
      ignoredBefore: z.array(z.string().min(1)).optional(),
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
  // Tester follow-up E §4 (#245): what the clean-merge landing's post-merge check (ruling R2) did. Optional, not defaulted:
  // a drive record written before this field, and every run that did not land through stepD's clean merge, stays byte
  // for byte what it was.
  postMergeCheck: postMergeCheckRecordSchema.optional(),
}).strict();
export type DriveRecord = z.infer<typeof driveRecordSchema>;

/**
 * Whether a run's work is on a work branch: its `landedCommit`, or -- for a multi run (multi-dir spec §8.1 step 6) --
 * any directory in `landedDirs`. A multi run that wrote only non-primary directories and reported no decisions has no
 * primary commit (there is no ledger to write), yet it landed; judged by `landedCommit` alone it settled as an empty
 * result and left its task blocked.
 */
export function landedAnywhere(drive: { landedCommit?: unknown; landedDirs?: unknown } | undefined): boolean {
  if (drive === undefined) return false;
  if ((drive.landedCommit ?? null) !== null) return true;
  const dirs = drive.landedDirs;
  return typeof dirs === "object" && dirs !== null && Object.keys(dirs).length > 0;
}

/** Where a run blocked at each step resumes (spec §2.3); `running` is persisted as `accepted`. */
export const RESUME_STATE: Record<DriveStep, string> = {
  A1: "starting", A2: "start-pending", B: "start-pending", "B'": "unknown", C: "accepted", D: "collected", R: "reconciling", E: "landed",
};

/**
 * Terminal run closure (#169): the immutable binding under which a proved terminal failure's unused reservation was
 * released. A run that carries it is inactive and never retried in place; `validTerminalClosure` reopens the report and
 * stop proof before retry, archive or a saved-result source may rely on it.
 */
export const terminalClosureSchema = z.object({
  runId: idSchema, generation: safeInteger.positive(), executionId: z.string().min(1), highWater: safeInteger,
  outcome: z.string().min(1), commandId: idSchema, closeCommandId: idSchema, ownerToken: idSchema,
  report: artifactSchema, stopProof: artifactSchema, at: safeInteger,
}).strict();
export type TerminalClosure = z.infer<typeof terminalClosureSchema>;

/**
 * Issue fixes spec §4.2(3): a run the driver blocked at C because its ccloop run ended with an outcome other than
 * `succeeded`. Sending it back to C would only collect the same terminal again, so recovery-retry refuses it; retry-task
 * (retryTask.ts, which names each failed condition in its refusal) is its way out.
 */
export function isTerminallyFailedRun(run: { state: string; drive?: DriveRecord; terminalClosure?: unknown }): boolean {
  const live = run.state === "blocked" && run.drive !== undefined && run.drive.blockedAt === "C" && run.drive.outcome !== null && run.drive.outcome !== "succeeded";
  // Terminal-closure spec 2026-11-07: an explicitly closed failure keeps its identity for ladder/quota routing.
  const closed = run.state === "settled-failed" && run.drive !== undefined && run.drive.blockedAt === "C"
    && run.drive.outcome !== null && run.drive.outcome !== "succeeded" && terminalClosureSchema.safeParse(run.terminalClosure).success;
  return live || closed;
}

/** Orca's own harvest bound's block reason at C (executionDriver.ts), `out-of-bounds:<paths>`. */
export const OUT_OF_BOUNDS_BLOCK = "out-of-bounds:";

/**
 * Salvage narrow fix (plan 2026-11-18 batch D, D5; human ruling: a close/retry exit and a recovery-list row): a run whose
 * ccloop attempt succeeded but whose result Orca's own harvest bound refused -- blocked at C, outcome `succeeded`,
 * `out-of-bounds:<paths>` -- still blocked, or since closed by close-run. Collecting it again only blocks it again, so like
 * a terminally failed run it is closed or retried; unlike one, it is never retried by Orca on its own (the ladder and
 * quota routing read isTerminallyFailedRun, which stays as it was).
 */
export function isBoundStoppedRun(run: { state: string; drive?: DriveRecord; terminalClosure?: unknown }): boolean {
  const drive = run.drive;
  if (drive === undefined || drive.blockedAt !== "C" || drive.outcome !== "succeeded" || drive.blockedReason?.startsWith(OUT_OF_BOUNDS_BLOCK) !== true) return false;
  return run.state === "blocked" || (run.state === "settled-failed" && terminalClosureSchema.safeParse(run.terminalClosure).success);
}

/** Worker-lost recovery spec 2026-11-12 §4.2/§5.4: ccloop's failure cause for a run whose worker died (settle-lost-worker). */
export const WORKER_LOST_CAUSE = "worker-lost";
/** Tester follow-up J (#299): ccloop 9c83b38's cause for a provider that does not serve the run's model (a 404); not retryable. */
export const MODEL_UNAVAILABLE_CAUSE = "model-unavailable";
/**
 * Tester #347: ccloop's cause for an execute call that ended its turn after a message that is not an answer while no tool,
 * command or file change was observed (the agent said what it would do and stopped). Retried like any failure; the next
 * run is told so (priorFailures.ts).
 */
export const NARRATION_ONLY_CAUSE = "narration-only";
/**
 * #299: what a person does about it -- Orca never switches an agent a person or plan chose (failover ruling D2). Tester
 * #368 (b): the retry names the model (on the task's installation, or on another one with --agent).
 */
export function modelUnavailableCommand(groupId: string, taskId: string): string {
  return `orca task retry ${groupId} ${taskId} --model <model> [--agent <installation>]`;
}

/**
 * Tester #229 (plan 2026-11-10 follow-up B, T1): the command that resumes a run blocked at a step other than C in place
 * (`resumeBlockedDriverRun` below), named where task retry refuses it and in the group brief's failure.
 */
export function recoveryRetryCommand(runId: string): string {
  return `orca recovery retry --run ${runId}`;
}

/** Tester #265: the command that retries a task allowing only the paths its blocked run reported (run show prints the same). */
export function allowObservedPathsCommand(groupId: string, taskId: string): string {
  return `orca task retry ${groupId} ${taskId} --allow-observed-paths`;
}

/** Off-plan writes W4 (#346): a run stopped on a parallel sibling's claim is retried after that sibling. */
export function retryAfterCommand(groupId: string, taskId: string, siblingId: string): string {
  return `orca task retry ${groupId} ${taskId} --after ${siblingId}`;
}

/**
 * exportResumeBundle's precondition on a stopped run (resumeBundle.ts): a settled run with a complete checkpoint. A run
 * that fails it is not continued from; its task starts afresh (executionDriver.ts stepA2, tester follow-up I).
 */
export function continuableRun(run: { state?: unknown; recoverable?: unknown; checkpointId?: unknown }): boolean {
  return (run.state === "settled" || run.state === "settled-recoverable") && run.recoverable === true && typeof run.checkpointId === "string";
}

/** Tester #295 residue (follow-up K): what "continue" means for a task paused on a run that is not continuable. */
export const USAGE_PAUSE_FRESH_START = "continue restarts the task from scratch: the stopped run left no complete checkpoint, so its partial work is discarded";
/** Whether "continue" on this paused task starts it afresh: the run it would continue from is there and not continuable. */
export function continueRestartsFresh(store: ControlStore, work: { allowancePredecessorRunId?: unknown; usagePause?: { runId?: unknown } }): boolean {
  const runId = work.allowancePredecessorRunId ?? work.usagePause?.runId;
  if (typeof runId !== "string") return false;
  const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId);
  return row !== undefined && !continuableRun(JSON.parse(String(row.body)) as Record<string, unknown>);
}

/**
 * Tester #267: a driver run that recovery retry --run puts back at the step it was blocked at -- blocked anywhere but at C
 * by a ccloop failure (isTerminallyFailedRun). Blocked at C with no outcome is one of these: its collect failed before
 * ccloop stated a terminal (a machine that slept through it), so collecting again is the way on.
 */
export function resumableBlockedRun(run: { state?: unknown; drive?: { blockedAt?: unknown; outcome?: unknown } | null }): boolean {
  return run.state === "blocked" && typeof run.drive?.blockedAt === "string" && (run.drive.blockedAt !== "C" || run.drive.outcome === null);
}

/** #310: a late C error overwrote a ceiling-settled run's body; its inactive committed checkpoint is repaired by recovery retry. */
export function repairableCeilingBlock(run: { runId?: unknown; state?: unknown; checkpointId?: unknown; liveCeilingStop?: unknown;
  drive?: { blockedAt?: unknown; blockedReason?: unknown; outcome?: unknown } | null }, active: number): boolean {
  return active === 0 && typeof run.runId === "string" && run.state === "blocked" && run.drive?.blockedAt === "C" &&
    run.drive.blockedReason === "checkpoint-id-conflict" && run.drive.outcome === "exhausted" &&
    run.checkpointId === `ceiling-${run.runId}` && run.liveCeilingStop !== undefined;
}

/**
 * Plan 2026-11-10 follow-up B, T10: the command that re-selects a requirement's agent, named on a requirement call blocked
 * on it (estimatorCompatibility.ts blockedOnRequirementAgent); the agent and model are the person's to choose.
 */
export function requirementSetAgentCommand(groupId: string): string {
  return `orca requirement set-agent ${groupId} --agent <agent> --model <model>`;
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
    ...run.drive, blockedAt: null, blockedReason: null, inspectUnknown: 0, relaunches: undefined,
    prepared: step === "A2" ? false : run.drive.prepared,
    reconcile: step === "R" && run.drive.reconcile !== null ? { ...run.drive.reconcile, spawning: false, pid: null, attemptSha: null } : run.drive.reconcile,
  };
  store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), runId);
  recordProjectionChange(store, [run.groupId]);
  return true;
}
