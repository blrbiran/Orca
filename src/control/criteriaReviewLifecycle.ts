import { recordActivity } from "./activity.js";
import { terminalKindOf } from "./archivedMark.js";
import { updateRevision } from "./commandLedger.js";
import { criteriaDecisionIdOf, criteriaReviewVerdict } from "./criteriaReview.js";
import { ControlError } from "./errors.js";
import { ratifyFlag } from "./flaggedDecisions.js";
import { ORCHESTRATION_ACTOR } from "./orchestration.js";
import { inProjectionTransaction } from "./projectionJournal.js";
import { anyTaskFailed, readSystemDebugMark } from "./systemDebug.js";
import { readStopIntent, saveStopIntent } from "./stopIntent.js";
import type { ControlStore } from "./store.js";

/**
 * Issue #419 (lifecycle half): a criteria-review judge is a one-shot group derived from a parent group. Once the parent
 * reaches its terminal state the judge can no longer change the parent's outcome, yet it stayed `running`/`blocked` (and
 * `criteriaReviews` stayed `debugging`) for the rest of the store's life. A driver pass (executionDriver.ts) and the
 * one-shot cleanup (`orca group archive --derived-of <parent>`) both call this module, so a judge converges by the same
 * rule whoever asks.
 *
 * A parent is terminal when its status is `done` or its body carries the terminal mark (`archived`, `closed`). Group
 * statuses in this codebase are clarifying/draft/ready/running/review/done/blocked -- there is no `failed` status -- and
 * `blocked` is the group's brake, not a terminal state, so a blocked parent converges nothing.
 *
 * A non-terminal derived judge is archived in place (records and artifacts stay: archive is never a delete). Two things
 * are left for a later pass instead: a judge whose verdict (or failure) the settle pass has not recorded yet, and a judge
 * whose only run is claimed but not accepted (a pause would hold it at `groupHeld` before it could start). A judge with an
 * accepted, still-running attempt is paused -- the same pause intent `pause-dispatch` writes: no new work is claimed, the
 * accepted run settles on its own -- and archived once that run is inactive. Archives are marked `archived: { at, actor }`
 * and named by a `derivedArchive` note beside it (the strict archived-mark schema has no room for a reason); the reason
 * is what `criteriaReviewsOf` reports in the parent.
 */
export const DERIVED_PARENT_TERMINAL = "parent-terminal";

export interface DerivedConvergence {
  /** Judges archived in this pass. */
  archived: string[];
  /** Judges paused in this pass because an active run must settle first. */
  paused: string[];
}

export interface DerivedConvergenceOptions {
  actor: string;
  /** The archive mark's time; the store's clock when absent. */
  at?: number;
}

interface GroupRow { id: string; revision: number; body: Record<string, unknown> }

function parseBody(text: unknown): Record<string, unknown> | null {
  try {
    const body = JSON.parse(String(text)) as unknown;
    return typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch { return null; }
}

function groupRow(store: ControlStore, groupId: string): GroupRow | null {
  const row = store.db.prepare("SELECT revision, body FROM groups WHERE id=?").get(groupId);
  if (row === undefined) return null;
  const body = parseBody(row.body);
  return body === null ? null : { id: groupId, revision: Number(row.revision), body };
}

/** Whether the group has reached the state after which its derived judges cannot affect it. */
export function parentGroupTerminal(store: ControlStore, parentGroupId: string): boolean {
  const row = groupRow(store, parentGroupId);
  return row !== null && (row.body.status === "done" || terminalKindOf(row.body) !== null);
}

/** Every criteria-review judge whose mark names `parentGroupId`, in creation order. */
function derivedJudges(store: ControlStore, parentGroupId: string | undefined): Array<GroupRow & { parentId: string; sourceRunId: string | null; settled: boolean }> {
  return store.db.prepare("SELECT id, revision, body FROM groups WHERE id LIKE 'sysdebug-criteria-review-%' ORDER BY rowid").all()
    .flatMap((row) => {
      const body = parseBody(row.body);
      if (body === null) return [];
      let mark: ReturnType<typeof readSystemDebugMark>;
      try { mark = readSystemDebugMark(body); } catch { return []; }
      if (mark === null || mark.source.kind !== "criteria-review" || typeof mark.source.groupId !== "string") return [];
      if (parentGroupId !== undefined && mark.source.groupId !== parentGroupId) return [];
      return [{ id: String(row.id), revision: Number(row.revision), body, parentId: mark.source.groupId, sourceRunId: mark.source.runId, settled: mark.settled !== null }];
    });
}

/**
 * Tester #419/#485: the judge could not conclude, so the flag it was opened for would stay `flagged` on the parent after
 * the parent ended and count in `card.pendingDecisions` forever. Ratify it as Orca's own convergence, with the note that
 * records why; a flag a verdict already cleared (or a person ratified) is left as it is.
 */
function convergeFlag(store: ControlStore, row: GroupRow & { parentId: string; sourceRunId: string | null }, options: DerivedConvergenceOptions): string | null {
  if (row.sourceRunId === null) return null;
  const decisionId = criteriaDecisionIdOf({ kind: "criteria-review", groupId: row.parentId, taskId: null, runId: row.sourceRunId });
  try {
    ratifyFlag(store, row.parentId, decisionId, {
      actorId: ORCHESTRATION_ACTOR, via: "criteria-review", commandId: `orca-auto-criteria-review-converge-${row.id}`,
      at: new Date(options.at ?? store.now()).toISOString(),
      note: "the criteria-review judge was archived when its parent group ended, so its verdict cannot change the parent",
    });
    return decisionId;
  } catch (error) {
    if (error instanceof ControlError) return null; // already ratified, or no such flag: nothing to converge.
    throw error;
  }
}

/** The archive/terminal mark of one judge: the record stays, the body only says it is archived. */
function archiveJudge(store: ControlStore, row: GroupRow & { parentId: string; sourceRunId: string | null }, options: DerivedConvergenceOptions): void {
  const at = options.at ?? store.now();
  // Tester #419/#485: the flag the judge was opened for cannot be concluded by it now; converge it with the archive.
  const decisionId = convergeFlag(store, row, options);
  const body: Record<string, unknown> = {
    ...row.body,
    archived: { at, actor: options.actor },
    // The archive mark is strict; the reason the parent shows lives beside it, in the passthrough body.
    derivedArchive: { parentGroupId: row.parentId, reason: DERIVED_PARENT_TERMINAL },
  };
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(body), row.id);
  // Issue-fixes spec §6.3 / tester #370: as applyArchiveGroup does, retired start-family wakes stay for audit but are
  // delivered, so `recovery list` reports no deferred start for a group archived here.
  store.db.prepare("UPDATE scheduler_wakes SET delivered=1 WHERE group_id=? AND delivered=0 AND kind IN ('start','no-start','resume','continuation')").run(row.id);
  recordActivity(store, { groupId: row.id, kind: "archived", body: { reason: DERIVED_PARENT_TERMINAL, parentGroupId: row.parentId,
    ...(decisionId === null ? {} : { decisionId }) } });
  updateRevision(store, row.id, row.revision + 1);
}

/** The judge's active runs (one task, so usually one). */
function activeRuns(store: ControlStore, groupId: string): Array<Record<string, unknown>> {
  return store.db.prepare("SELECT body FROM runs WHERE group_id=? AND active=1 ORDER BY rowid").all(groupId)
    .flatMap((row) => { const body = parseBody(row.body); return body === null ? [] : [body]; });
}

/** Whether one of the active runs is already accepted by its provider (its `executionId` is set). A claimed-but-not-
 * started run (`executionId` still null) is left alone: a pause holds it at `groupHeld` before it can start, so it is
 * NOT the "let the current run settle" case -- a later pass sees it accepted and pauses then. */
function hasAcceptedRun(runs: Array<Record<string, unknown>>): boolean {
  return runs.some((run) => typeof run.executionId === "string" && run.executionId.length > 0);
}

/** No new dispatch while the accepted run finishes; identical to what pause-dispatch writes. */
function pauseJudge(store: ControlStore, row: GroupRow & { parentId: string }): boolean {
  if (readStopIntent(store, row.id) !== null) return false;
  saveStopIntent(store, row.id, "pause", row.revision, { mode: "pause", state: "paused", frozenRunIds: [], acceptedAt: null, deadlineAt: null });
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...row.body, stopped: true }), row.id);
  recordActivity(store, { groupId: row.id, kind: "stop", body: { mode: "pause", reason: DERIVED_PARENT_TERMINAL, parentGroupId: row.parentId } });
  updateRevision(store, row.id, row.revision + 1);
  return true;
}

/**
 * Converge the criteria-review judges of one terminal parent (`parentGroupId`) or of every terminal parent (undefined).
 * Idempotent: a judge already archived, closed or done is not archived again (its flag is still converged, #419/#485),
 * and one already paused is not paused again. Runs in its own transaction when the caller has none.
 */
export function convergeDerivedCriteriaReviewGroups(
  store: ControlStore, parentGroupId: string | undefined, options: DerivedConvergenceOptions,
): DerivedConvergence {
  const run = (): DerivedConvergence => {
    const out: DerivedConvergence = { archived: [], paused: [] };
    for (const row of derivedJudges(store, parentGroupId)) {
      if (!parentGroupTerminal(store, row.parentId)) continue;
      if (terminalKindOf(row.body) !== null || row.body.status === "done") {
        // Tester #419/#485: a judge archived before this rule (or by a person) still ends the flag it could not conclude;
        // the pass is idempotent -- a flag a verdict cleared, or a person ratified, is left alone -- so an old store
        // converges on its next pass instead of keeping `card.pendingDecisions` at 1 forever.
        convergeFlag(store, row, options);
        continue;
      }
      // A judge whose verdict (or failure) the settle pass has not recorded yet is the settle pass's: archiving it first
      // would hide it (`systemDebugPass` skips archived groups) and lose the verdict the flagged decision needs.
      if (!row.settled && (criteriaReviewVerdict(store, row.id) !== null || anyTaskFailed(store, row.id))) continue;
      const runs = activeRuns(store, row.id);
      if (runs.length > 0) {
        // Only an accepted attempt is paused (it keeps running); a claimed one must start first.
        if (hasAcceptedRun(runs) && pauseJudge(store, row)) out.paused.push(row.id);
        continue;
      }
      archiveJudge(store, row, options);
      out.archived.push(row.id);
    }
    return out;
  };
  return inProjectionTransaction(store) ? run() : store.transaction(run);
}