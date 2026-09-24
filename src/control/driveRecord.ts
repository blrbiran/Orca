import { z } from "zod";
import { idSchema, safeInteger } from "./schema.js";
import { recordProjectionChange } from "./projectionJournal.js";
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

const commitSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);

/** spec §5.3: one conflict's reconciliation, recorded before and while it runs so a restart can find it. */
export const reconcileRecordSchema = z.object({
  copyPath: z.string().min(1),
  old: commitSchema,
  conflictCommit: commitSchema,
  conflictedPaths: z.array(z.string().min(1)),
  otherTaskId: idSchema,
  reconcileRunId: z.string().min(1),
  runsDir: z.string().min(1),
  contractPath: z.string().min(1),
  tokenBudget: safeInteger.positive(),
  spawning: z.boolean(),
  pid: safeInteger.positive().nullable(),
  outcome: z.string().min(1).nullable(),
  attemptSha: commitSchema.nullable(),
}).strict();
export type ReconcileRecord = z.infer<typeof reconcileRecordSchema>;

/** Everything the driver writes into a run body, in one closed record (spec §7.4). */
export const driveRecordSchema = z.object({
  workspaceMode: z.enum(["worktree", "clone"]),
  sourceDir: z.string().min(1),
  workspacePath: z.string().min(1),
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
}).strict();
export type DriveRecord = z.infer<typeof driveRecordSchema>;

/** Where a run blocked at each step resumes (spec §2.3); `running` is persisted as `accepted`. */
export const RESUME_STATE: Record<DriveStep, string> = {
  A1: "starting", A2: "start-pending", B: "start-pending", "B'": "unknown", C: "accepted", D: "collected", R: "reconciling", E: "landed",
};

/**
 * `recovery-retry` on a blocked driver run: back to the step it was blocked at, reason cleared.
 * Blocked at A2 means the workspace was never recorded as prepared, so A2 runs again; blocked at R
 * forgets the dead reconciliation process so the next round decides afresh. Answers whether it
 * changed anything, which is what `recovery-observed.resolved` reports.
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
    reconcile: step === "R" && run.drive.reconcile !== null ? { ...run.drive.reconcile, spawning: false, pid: null, outcome: null, attemptSha: null } : run.drive.reconcile,
  };
  store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), runId);
  recordProjectionChange(store, [run.groupId]);
  return true;
}
