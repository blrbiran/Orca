import type { DriveRecord } from "./driveRecord.js";
import { readStoredRejection } from "./priorFailures.js";
import type { ControlStore } from "./store.js";
import { readTaskResultState, type TaskResultState } from "./taskResultStore.js";

/**
 * Task setup and check retry spec 2026-11-04 §4.7: the ladder (systemDebugPass, both levels) leaves out a run another try
 * cannot fix, and records why once. Decided by code (Rule 5), never by a model.
 */
export type LadderSkip = "setup-failed" | "could-not-run";

/**
 * A ladder candidate's run, as ladderCandidates hands it on: `exempt` says its cause is in LADDER_EXEMPT_CAUSES (only
 * `setup-failed` among those reaches the pass, so the pass can record why).
 */
export type LadderRun = { run: { runId: string; drive?: DriveRecord }; exempt: boolean };

const SEPARATOR = " | ";
const NOT_RUNNABLE_EXIT = new Set(["exit=127", "exit=126"]);
const NOT_RUNNABLE_STDERR = ["command not found", "Missing script:"];

/**
 * Whether the failing required check could not run at all, read from the raw stored rejection's evidence. Only the one
 * entry ccloop wrote for that command counts (buildRequiredCheckEvidence: "command output", "required check failed:
 * <cmd>", optional "stdout=…", optional "stderr=…", then "exit=<n>" | "signal=<s>" | "error=<msg>", joined by " | "):
 * its last segment is exit 127 or 126, or its stderr says the command or the npm script is missing. Output text may
 * itself hold " | ", so the command is matched as a prefix, the exit token is the last segment, and stderr runs from the
 * last segment that starts "stderr=" up to the exit token.
 */
export function couldNotRun(failingCommand: string | null, evidence: readonly string[]): boolean {
  if (failingCommand === null) return false;
  const head = `required check failed: ${failingCommand}`;
  for (const entry of evidence) {
    const start = entry.indexOf(SEPARATOR);
    if (start < 0) continue;
    const rest = entry.slice(start + SEPARATOR.length);
    if (rest === head) return false; // no exit token: not a failed check's entry as ccloop writes it
    if (!rest.startsWith(head + SEPARATOR)) continue;
    const segments = rest.slice(head.length + SEPARATOR.length).split(SEPARATOR);
    const last = segments[segments.length - 1]!.trim();
    if (NOT_RUNNABLE_EXIT.has(last)) return true;
    let from = -1;
    for (let index = segments.length - 2; index >= 0; index--) if (segments[index]!.startsWith("stderr=")) { from = index; break; }
    if (from < 0) return false;
    const stderr = segments.slice(from, segments.length - 1).join(SEPARATOR);
    return NOT_RUNNABLE_STDERR.some((text) => stderr.includes(text));
  }
  return false;
}

/**
 * Why the ladder leaves this run out, or null to keep today's ladder. `setup-failed`: its cause is exempt (§4.7, first
 * bullet). `could-not-run`: its last rejection is `required-check-failed` and the stored copy shows the failing command
 * never ran. A stored copy that cannot be read keeps the ladder (fail open). ccloop's repeated-failure stop is not a reason
 * (§4.7: it would skip ordinary failures).
 */
export async function ladderSkipOf(store: ControlStore, candidate: LadderRun): Promise<LadderSkip | null> {
  if (candidate.exempt) return "setup-failed";
  const last = candidate.run.drive?.lastFailure;
  if (last === undefined || last.rejectCategory !== "required-check-failed" || last.failingCommand === null) return null;
  let stored: Awaited<ReturnType<typeof readStoredRejection>>;
  try { stored = await readStoredRejection(store, candidate.run.runId, last); } catch { return null; }
  return stored !== null && couldNotRun(stored.failingCommand, stored.evidence) ? "could-not-run" : null;
}

/** Fix round 1 (controller ruling, session af2ceee1): how long the pass waits for the collector before it fails open. */
export const COLLECTOR_HOLD_MS = 10 * 60_000;

/**
 * Whether the task-result collector has finished with this run: it gave up (`stale`, `unavailable`, `unsupported`), or
 * its last admitted page was the final one (revision == sourceRevision) and no newer page is under way (the current-attempt
 * fact does not run ahead of the admitted pages). No state yet means the collection has not started.
 */
function collectorSettled(state: TaskResultState | null): boolean {
  if (state === null) return false;
  if (state.status === "stale" || state.status === "unavailable" || state.status === "unsupported") return true;
  if (state.revision !== state.sourceRevision) return false;
  return !(typeof state.currentAttemptFact?.revision === "number" && state.currentAttemptFact.revision > state.sourceRevision);
}

/**
 * Fix round 1 (controller ruling, session af2ceee1): the collector is only scheduled when the run's report is read
 * (executionDriver.ts), so the ladder pass can see a `required-check-failed` run before its final verification is stored
 * and would fail open on exactly the could-not-run run §4.7 targets. Such a run is held -- no level, no row -- until the
 * collector settles, then decided as usual; after COLLECTOR_HOLD_MS from its `run-blocked` row it fails open.
 */
export function ladderHeld(store: ControlStore, candidate: LadderRun, now: number): boolean {
  if (candidate.exempt) return false;
  const drive = candidate.run.drive;
  if (drive?.failureCause?.cause !== "required-check-failed" && drive?.lastFailure?.rejectCategory !== "required-check-failed") return false;
  let state: TaskResultState | null;
  try { state = readTaskResultState(store, candidate.run.runId); } catch { return false; } // unreadable: fail open
  if (collectorSettled(state)) return false;
  const blocked = store.db.prepare("SELECT MAX(at) AS at FROM activity WHERE run_id=? AND kind='run-blocked'").get(candidate.run.runId)?.at;
  return typeof blocked === "number" && now - blocked < COLLECTOR_HOLD_MS;
}
