import { z } from "zod";
import { readArtifact } from "./archive.js";
import { isTerminallyFailedRun, type DriveRecord } from "./driveRecord.js";
import { PRIOR_FAILURE_BOUNDS, priorFailureSchema, type PriorFailure } from "./schema.js";
import { readCanonicalRecord } from "./snapshot.js";
import { readTaskResultState } from "./taskResultStore.js";
import type { ControlStore } from "./store.js";

/**
 * ccloop priorFailures spec 2026-10-21 §3 (kanban spec §6 levels 1-2): what a fresh run of a task is told about the
 * earlier runs of that task that ended terminally failed -- built once, at A2, by code (Rule 5) from what Orca stored,
 * and frozen in the run's envelope. Evidence comes only from the collector's stored verification copy whose fingerprint
 * equals the run's last rejection; anything less certain is null, never a guess.
 */

/** ccloop's head rule (verifier spec §7.2): the first bytes, cut back to a code-point boundary, then the marker. */
export function headBytes(text: string, max: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= max) return text;
  // The marker's own length depends on the count it names; shrink until the whole fits.
  let keep = max;
  for (;;) {
    let end = Math.max(0, keep);
    while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
    const marker = `…[${bytes.length - end} bytes omitted]`;
    if (end + Buffer.byteLength(marker, "utf8") <= max) return bytes.subarray(0, end).toString("utf8") + marker;
    if (end === 0) return marker;
    keep = end - 1;
  }
}

/** A non-empty string cut to `max` UTF-8 bytes, or null when there is nothing to say. */
function bounded(text: string | null | undefined, max: number): string | null {
  return typeof text === "string" && text.length > 0 ? headBytes(text, max) : null;
}

const verificationSchema = z.object({
  approved: z.boolean(), rejectCategory: z.string(), primaryTargetPaths: z.array(z.string()), failingCommand: z.string().nullable(), evidence: z.array(z.string()),
}).passthrough();

/** The fingerprint test ccloop's readRejectionEvidence uses: category, target paths and command, all equal. */
function sameFingerprint(a: { rejectCategory: string; primaryTargetPaths: string[]; failingCommand: string | null }, b: { rejectCategory: string; primaryTargetPaths: string[]; failingCommand: string | null }): boolean {
  return a.rejectCategory === b.rejectCategory && a.failingCommand === b.failingCommand
    && a.primaryTargetPaths.length === b.primaryTargetPaths.length && a.primaryTargetPaths.every((path, index) => path === b.primaryTargetPaths[index]);
}

/**
 * The failed run's rejection evidence, from the collector's own stored copy (taskResultStore). Null unless the collector
 * settled (`available`), the run's last rejection carried its full fingerprint, and a stored, completed, rejected
 * verification has that fingerprint (the latest attempt wins).
 */
async function storedEvidence(store: ControlStore, runId: string, last: NonNullable<DriveRecord["lastFailure"]>): Promise<string[] | null> {
  if (last.primaryTargetPaths === undefined) return null;
  const state = readTaskResultState(store, runId);
  if (state === null || state.status !== "available" || state.identity?.runId !== runId) return null;
  const fingerprint = { rejectCategory: last.rejectCategory, primaryTargetPaths: last.primaryTargetPaths, failingCommand: last.failingCommand };
  const candidates = state.observations
    .filter((observation) => observation.manifest.stage === "verification" && observation.verification === "failed" && observation.manifest.verificationRef !== null)
    .sort((a, b) => b.manifest.attempt - a.manifest.attempt);
  for (const observation of candidates) {
    let parsed: z.infer<typeof verificationSchema>;
    try {
      const value = verificationSchema.safeParse(JSON.parse((await readArtifact(store, observation.manifest.verificationRef!)).toString("utf8")));
      if (!value.success) continue;
      parsed = value.data;
    } catch { continue; }
    if (parsed.approved || !sameFingerprint(parsed, fingerprint)) continue;
    const evidence = parsed.evidence.flatMap((entry) => { const cut = bounded(entry, PRIOR_FAILURE_BOUNDS.evidenceEntry); return cut === null ? [] : [cut]; })
      .slice(0, PRIOR_FAILURE_BOUNDS.evidenceEntries);
    return evidence.length === 0 ? null : evidence;
  }
  return null;
}

/** One earlier failed run, as ccloop's PriorFailureV1 (§2.1), pre-cut to its bounds. */
export async function priorFailureOf(store: ControlStore, run: { runId: string; drive?: DriveRecord }): Promise<PriorFailure> {
  const drive = run.drive;
  const cause = bounded(drive?.failureCause?.cause, PRIOR_FAILURE_BOUNDS.failureCause);
  const last = drive?.lastFailure;
  const entry: PriorFailure = last === undefined
    // A run that failed without a rejection (§3): its cause stands in for the category.
    ? { runId: run.runId, rejectCategory: headBytes(`run-failed:${cause ?? "unknown"}`, PRIOR_FAILURE_BOUNDS.rejectCategory), failingCommand: null, evidence: null }
    : {
      runId: run.runId,
      rejectCategory: bounded(last.rejectCategory, PRIOR_FAILURE_BOUNDS.rejectCategory) ?? "unknown",
      failingCommand: bounded(last.failingCommand, PRIOR_FAILURE_BOUNDS.failingCommand),
      evidence: await storedEvidence(store, run.runId, last),
    };
  if (cause !== null) entry.failureCause = cause;
  return priorFailureSchema.parse(entry);
}

/**
 * A run of the task that ended on a ccloop terminal other than `succeeded`: still blocked at C, or since settled by a
 * retry (`settled-failed`, which keeps the drive record). A saved result never dispatched (`not-started`) is not one.
 */
function endedFailed(run: { state: string; drive?: DriveRecord }): boolean {
  if (isTerminallyFailedRun(run)) return true;
  const drive = run.drive;
  return run.state === "settled-failed" && drive !== undefined && drive.blockedAt === "C" && drive.outcome !== null && drive.outcome !== "succeeded" && drive.outcome !== "not-started";
}

/**
 * §3 "which runs": a fresh run of a task carries the earlier runs of that task in the same group that ended terminally
 * failed (the ladder's level-1 re-dispatch, level 2's rerun, a person's retry alike), the latest PRIOR_FAILURE_BOUNDS
 * .entries of them, oldest first. Undefined when there are none, so the envelope keeps its bytes.
 */
export async function buildPriorFailures(store: ControlStore, groupId: string, taskId: string, runId: string): Promise<PriorFailure[] | undefined> {
  const failed: Array<{ runId: string; drive?: DriveRecord }> = [];
  for (const row of store.db.prepare("SELECT id, body FROM runs WHERE group_id=? ORDER BY rowid").all(groupId)) {
    if (String(row.id) === runId) continue;
    let body: { runId: string; taskId?: unknown; state: string; drive?: DriveRecord };
    try { body = JSON.parse(String(row.body)); } catch { continue; }
    if (body.taskId === taskId && endedFailed(body)) failed.push(body);
  }
  if (failed.length === 0) return undefined;
  const entries: PriorFailure[] = [];
  for (const run of failed.slice(-PRIOR_FAILURE_BOUNDS.entries)) entries.push(await priorFailureOf(store, run));
  return entries;
}

/** §3 freezing: a continuation (handoff or allowance successor) copies its predecessor's frozen entries, byte for byte. */
export function predecessorPriorFailures(store: ControlStore, predecessorRunId: string): PriorFailure[] | undefined {
  const row = store.db.prepare("SELECT body FROM runs WHERE id=?").get(predecessorRunId);
  if (row === undefined) return undefined;
  const envelopeHash = (JSON.parse(String(row.body)) as { drive?: DriveRecord }).drive?.envelopeHash;
  if (typeof envelopeHash !== "string") return undefined;
  const work = (JSON.parse(readCanonicalRecord(store, envelopeHash)) as { work?: { priorFailures?: PriorFailure[] } }).work;
  return work?.priorFailures;
}

/**
 * §3 at A2: what a run being prepared carries. A saved-result recovery carries none (ccloop refuses them with
 * `verify-saved-result`); a continuation (handoff or allowance successor) copies its predecessor's frozen entries; a fresh
 * run builds them from the task's earlier failed runs.
 */
export async function priorFailuresAtPrepare(store: ControlStore, run: { groupId: string; taskId: string; runId: string }, source: { recovery: boolean; predecessorRunId: string | null }): Promise<PriorFailure[] | undefined> {
  if (source.recovery) return undefined;
  if (source.predecessorRunId !== null) return predecessorPriorFailures(store, source.predecessorRunId);
  return buildPriorFailures(store, run.groupId, run.taskId, run.runId);
}
