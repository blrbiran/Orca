import type { DriveRecord } from "./driveRecord.js";
import { readStoredRejection } from "./priorFailures.js";
import type { ControlStore } from "./store.js";

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
