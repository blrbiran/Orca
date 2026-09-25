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
  // Fix round 1 (2026-09-25, review Important 1/2): a projection-publish failure after settle is its
  // own field, never conflated with `cleanupError` -- a successful cleanup never clears it, and it is
  // cleared only once publishing itself succeeds. Defaulted for the same reason as `cleanupError`.
  publishError: z.string().min(1).nullable().default(null),
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
