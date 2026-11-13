import { createHash } from "node:crypto";
import { constants, openSync, closeSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { amountSchema, artifactSchema, candidateSchema, idSchema, safeInteger } from "./schema.js";
import { canonicalBytes } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import type { ControlStore } from "./store.js";
import type { Amount, ArtifactRef, Candidate, Grant } from "./types.js";

const pair = z.object({ work: amountSchema, handoff: amountSchema }).strict();
/** Spec 2026-10-13-unmetered-usage-settlement-design.md §A.3: only the unlimited work token dimension is unmetered. */
export const unmeteredChargeSchema = z.object({ work: amountSchema.extend({ tokens: z.null() }).strict(), handoff: amountSchema }).strict();
const personFields = { commandId: idSchema, principal: z.string().regex(/^user:.+/) };
// Tester follow-up E §8: charging the remaining grant and a proved known-zero may be a socket agent's (`agent:<client>`,
// commandClient.ts settlingPrincipalFor); an unmetered release stays a person's (personFields).
const settlerFields = { commandId: idSchema, principal: z.string().regex(/^(user|agent):.+/) };
const markerFields = {
  at: safeInteger,
  groupId: idSchema, taskId: idSchema, workItemId: idSchema, runId: idSchema, generation: safeInteger.positive(), highWater: safeInteger,
  // "recovered": spec 2026-10-14-handoff-stop-unknown-usage-design.md §3.2, a handoff-stopped run settled back to recoverable.
  reservationDisposition: z.enum(["committed", "released", "recovered"]), report: artifactSchema,
  stopProof: z.object({ executionId: z.string().min(1), generation: safeInteger.positive(), isolated: z.literal(true), source: artifactSchema }).strict(),
  handoffResolution: z.object({ requestId: idSchema, previousState: z.literal("settled-unrecoverable"), previousFailureCode: z.literal("usage-unsettled"), checkpointId: idSchema, checkpointHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
};
export const usageSettlementSchema = z.union([
  z.object({ method: z.literal("remaining-grant"), charged: pair, ...settlerFields, ...markerFields }).strict(),
  z.object({ method: z.literal("owner-acknowledged-unmetered"), charged: unmeteredChargeSchema, ...personFields, ...markerFields }).strict(),
  // Spec 2026-11-06 soft-mode loop run settlement §3.2 (option (d), human's answer Q3): Orca's booking of a loop run's
  // observed floor in a group with no token limit, backed by its own `settle-approximate-usage` row under orca-auto.
  z.object({ method: z.literal("approximate-floor"), commandId: idSchema, principal: z.literal("orca-auto"), charged: pair,
    floorTokens: safeInteger.nullable(), reason: z.string().min(1), ...markerFields }).strict(),
  // Issue #215 (human ruling 2026-11-09: option A): a failed run whose terminal carries ccloop's positive proof that
  // nothing was spent. It books zero and releases the reservation; only that proof admits this method.
  z.object({ method: z.literal("known-zero"), charged: pair, ...settlerFields, ...markerFields }).strict(),
  // Tester follow-up F §2 (#116, ledger C3): a person's or socket agent's explicit booking of a finite remainder at ccloop's
  // observed floor -- the approximate-floor shape (floorTokens, reason; the run's `usageApproximate` matches it), backed by
  // the settler's own `settle-unknown-usage` row. Only a known floor admits it, so floorTokens is never null.
  // Tester follow-up I (seat K): 0 for a worker-lost run whose dead worker left no floor (workerLostFloor; checked in
  // hasValidUsageSettlement): its booked usage is what was observed.
  z.object({ method: z.literal("observed-floor"), charged: pair, floorTokens: safeInteger, reason: z.string().min(1), ...settlerFields, ...markerFields }).strict(),
]).superRefine((v, ctx) => {
  if ((v.reservationDisposition !== "committed") !== (v.handoffResolution !== undefined)) ctx.addIssue({ code: "custom", message: "settlement-disposition-resolution" });
});
export type UsageSettlement = z.infer<typeof usageSettlementSchema>;
/**
 * Spec 2026-10-27 single-call unknown usage §5 O1, §9 R4: ccloop's lower bound on a failed single call's usage (record key
 * `usageLowerBound`), kept on the blocked run as `singleCallUsageLowerBound`. Shown to the person, never charged (D3).
 * (In a group with no token limit a floor is booked: spec 2026-11-03 soft mode, and for loop runs spec 2026-11-06.)
 */
export const singleCallUsageLowerBoundSchema = z.object({ tokens: safeInteger.positive() }).strict();
/**
 * Same spec §9 R1, R4: the marker a single call's settlement leaves on its run (`singleCallSettlement`), the remaining-grant
 * method of spec 2026-10-13 §A without the task-shaped fields. `disposition`: the call was completed as failed by its
 * purpose, interrupted because its round, draft or estimate had moved (R2), or `stopped`: a stop had already closed it
 * (code review S1).
 */
// Tester follow-up F §2 (#116, ledger C3): `observed-floor` -- the call's observed floor (usageLowerBound, never null then)
// was charged instead of its remaining grant, as the soft path books it (approximateUsage.ts bookCallFloor).
export const singleCallSettlementSchema = z.object({
  method: z.enum(["remaining-grant", "observed-floor"]), ...settlerFields, at: safeInteger,
  groupId: idSchema, runId: idSchema, highWater: safeInteger, charged: amountSchema,
  usageLowerBound: singleCallUsageLowerBoundSchema.nullable(), blockedReason: z.string().min(1), disposition: z.enum(["completed", "interrupted", "stopped"]),
}).strict().refine(v => v.method !== "observed-floor" || v.usageLowerBound !== null, "observed-floor-unknown");
export type SingleCallSettlement = z.infer<typeof singleCallSettlementSchema>;
export interface SettlementRun {
  runId: string; groupId: string; taskId: string | null; workItemId: string; generation: number; highWater: number;
  graphVersion: number; targetVersion: number; executionId: string | null; grant: Grant; remaining: Grant; cumulative: {work:Amount;handoff:Amount};
  unknown: { work: boolean; handoff: boolean }; usageSettlement?: unknown; checkpointId?: string | null;
  drive?: { outcome: string | null; sourceDir: string; blockedAt?: string | null; failureCause?: { usageKnownZero?: true } }; [key: string]: unknown;
}
const ds = ["tokens", "activeMs", "attempts", "sessions"] as const;
export const settlementSame = (a: unknown, b: unknown) => canonicalBytes(a).equals(canonicalBytes(b));

/** Content-addressed immutable evidence, also used by synchronous readers (never a cached UI assertion). */
export function settlementArtifact(store: ControlStore, ref: ArtifactRef): Buffer {
  artifactSchema.parse(ref);
  const row = store.db.prepare("SELECT hash FROM artifacts WHERE id=?").get(ref.artifactId);
  if (row?.hash !== ref.hash) throw new Error("artifact-identity");
  const root = join(store.stateDir, "artifacts"), dir = join(root, ref.artifactId), path = join(dir, "data");
  for (const p of [root, dir]) if (!lstatSync(p).isDirectory() || lstatSync(p).isSymbolicLink()) throw new Error("artifact-path");
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error("artifact-path");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes: Buffer; try { bytes = readFileSync(fd); } finally { closeSync(fd); }
  if (createHash("sha256").update(bytes).digest("hex") !== ref.hash) throw new Error("artifact-hash");
  return bytes;
}
function candidateIdentity(c: Candidate, run: SettlementRun): void {
  if (c.runId !== run.runId || c.groupId !== run.groupId || c.taskId !== run.taskId || c.workItemId !== run.workItemId
    || c.generation !== run.generation || c.graphVersion !== run.graphVersion || c.targetVersion !== run.targetVersion
    || c.usageHighWater !== run.highWater) throw new Error("candidate-identity");
}
export function settlementProof(store: ControlStore, run: SettlementRun): { report: ArtifactRef; stopProof: UsageSettlement["stopProof"] } {
  try {
    if (run.drive?.outcome === null) {
      // Spec 2026-10-14-handoff-stop-unknown-usage-design.md §3.2: a run the handoff stopped while working has no terminal
      // report; its handoff checkpoint carries the stop proof, and its handoff packet stands in as the marker's report.
      const c = storedCheckpoint(store, run).c;
      if (c.result !== "partial" || !c.stopProof) throw new Error("checkpoint-not-partial");
      validateStopProof(store, run, c);
      return { report: c.handoff, stopProof: c.stopProof };
    }
    const row = store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='report'").get(`report:${run.runId}`);
    if (!row) throw new Error("report-missing");
    const source = artifactSchema.parse(JSON.parse(String(row.body)).source);
    const report = JSON.parse(settlementArtifact(store, source).toString());
    const c = candidateSchema.parse(report.candidate);
    candidateIdentity(c, run);
    if (!report.terminal || report.terminal.outcome === "succeeded" || report.terminal.outcome !== run.drive?.outcome
      || report.terminal.sourceDir !== run.drive?.sourceDir || c.terminalOutcome !== report.terminal.outcome || !c.stopProof) throw new Error("report-terminal");
    validateStopProof(store, run, c);
    return { report: source, stopProof: c.stopProof };
  } catch { throw new ControlError("run-stop-proof-required"); }
}
function validateStopProof(store: ControlStore, run: SettlementRun, c: Candidate): void {
  if (!c.stopProof || c.stopProof.isolated !== true || c.stopProof.executionId !== run.executionId || c.stopProof.generation !== run.generation) throw new Error("stop-proof-identity");
  const proof = JSON.parse(settlementArtifact(store, c.stopProof.source).toString());
  if (proof.isolated !== true || proof.executionId !== run.executionId || proof.generation !== run.generation) throw new Error("stop-proof-content");
}
function storedCheckpoint(store: ControlStore, run: SettlementRun): { c: Candidate; hash: string } {
  if (!run.checkpointId) throw new Error("checkpoint-missing");
  const row = store.db.prepare("SELECT hash,body FROM checkpoints WHERE id=? AND run_id=?").get(run.checkpointId, run.runId);
  if (!row) throw new Error("checkpoint-missing");
  const path = join(store.stateDir, "checkpoints", run.runId, `${run.checkpointId}.json`);
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error("checkpoint-path");
  const bytes = readFileSync(path), c = candidateSchema.parse(JSON.parse(bytes.toString()));
  if (createHash("sha256").update(bytes).digest("hex") !== row.hash || !bytes.equals(Buffer.from(String(row.body)))) throw new Error("checkpoint-hash");
  candidateIdentity(c, run);
  if (c.checkpointId !== run.checkpointId) throw new Error("checkpoint-identity");
  return { c, hash: String(row.hash) };
}

/** Recompute every non-usage handoff condition, rather than trusting the failureCode string. */
export function releasedSettlementCheckpoint(store: ControlStore, run: SettlementRun): { checkpointId: string; checkpointHash: string } {
  try {
    const { c, hash } = storedCheckpoint(store, run);
    // A failed run's checkpoint names its failure; a run stopped while working (no outcome) has a partial one (2026-10-14 §3.1).
    if (c.terminalOutcome === "succeeded" || (run.drive?.outcome === null ? c.result !== "partial" : c.terminalOutcome !== run.drive?.outcome)
      || c.missing.length || c.unresolvedRequestIds.length || c.snapshot === null) throw new Error("checkpoint-incomplete");
    validateStopProof(store, run, c);
    for (const ref of [...c.artifacts, c.handoff, c.snapshot]) settlementArtifact(store, ref);
    for (const event of store.db.prepare("SELECT body FROM usage_events WHERE run_id=? AND seq<=?").all(run.runId, run.highWater)) settlementArtifact(store, JSON.parse(String(event.body)).source);
    return { checkpointId: c.checkpointId, checkpointHash: hash };
  } catch { throw new ControlError("run-stop-proof-required", "handoff-checkpoint"); }
}

/**
 * A run's work usage as the task's authored budget sees it (human ruling 2026-10-13, session 7f37d261): the group books the
 * conservative charge of an unmetered release, but the task lineage inherits only what the provider observed, so a released
 * task stays retryable. Every lineage sum uses this one function; a remaining-grant settlement keeps its charge in the lineage.
 */
export function lineageWorkUsage(run: { cumulative: { work: Amount }; usageSettlement?: unknown }): Amount {
  const m = run.usageSettlement as UsageSettlement | undefined, work = run.cumulative.work;
  // A run settled back to recoverable (spec 2026-10-14-handoff-stop-unknown-usage-design.md §3.2) is continued, so the same
  // ruling holds for its remaining-grant charge: otherwise the charge exhausts the authored budget the continuation needs.
  // Spec 2026-11-06 §3.2: an approximate floor is provider-observed usage, so it stays in the lineage, recovered or not.
  // Tester follow-up F §2: so does an observed floor a person or agent booked explicitly.
  if (m === undefined || m.method === "approximate-floor" || m.method === "observed-floor" || (m.method !== "owner-acknowledged-unmetered" && m.reservationDisposition !== "recovered")) return work;
  const c = m.charged.work;
  return { tokens: c.tokens === null ? work.tokens : work.tokens - c.tokens, activeMs: work.activeMs - c.activeMs, attempts: work.attempts - c.attempts, sessions: work.sessions - c.sessions };
}

/**
 * Spec 2026-11-06 §3.2 (finding 1): ccloop's floor counts only the calls that ended without a report and the baseline only
 * the reported ones, so the floor itself is booked: `charged.work.tokens = floorTokens ?? 0`, every other charge 0, and
 * the run's work token remainder is `max(grant - cumulative, 0)` (null when unlimited). The marker matches the run's
 * `usageApproximate`. Whether the group's limit is still null is never asked: a later set-limit leaves the marker valid.
 */
function approximateFloorBooked(run: SettlementRun, m: Extract<UsageSettlement, { method: "approximate-floor" | "observed-floor" }>, baseline: {work:Amount;handoff:Amount}): boolean {
  const floor = m.floorTokens ?? 0;
  if (!settlementSame(run.usageApproximate, { floorTokens: m.floorTokens, reason: m.reason, at: m.at })) return false;
  for (const b of ["work", "handoff"] as const) for (const d of ds) {
    const charge = b === "work" && d === "tokens" ? floor : 0;
    if (m.charged[b][d] !== charge || run.cumulative[b][d] !== baseline[b][d] + charge) return false;
  }
  const grant = run.grant.work.tokens;
  return run.remaining.work.tokens === (grant === null ? null : Math.max(grant - run.cumulative.work.tokens, 0));
}

/**
 * Worker-lost recovery spec 2026-11-12 §5 (driveRecord.ts WORKER_LOST_CAUSE, written here to keep this module's imports
 * light): a run ccloop settled because its worker died. Its usage before the death was observed; the killed call's is unknown.
 */
export const workerLostRun = (run: { drive?: unknown }): boolean =>
  (run.drive as { failureCause?: { cause?: unknown } } | undefined)?.failureCause?.cause === "worker-lost";

/** Issue #215 (human ruling 2026-11-09, option A): a terminal whose failure cause proves nothing was spent. */
export const knownZeroProved = (run: Pick<SettlementRun, "drive" | "cumulative">): boolean =>
  (run.drive?.failureCause as { usageKnownZero?: unknown } | undefined)?.usageKnownZero === true
  && run.cumulative.work.tokens === 0 && run.cumulative.handoff.tokens === 0;

/** A persisted marker must be backed by the authority receipt, unchanged provider highWater and immutable proof. */
export function hasValidUsageSettlement(store: ControlStore, subject: unknown): boolean {
  try {
    const run = subject as SettlementRun;
    const m = usageSettlementSchema.parse(run.usageSettlement);
    if (m.runId !== run.runId || m.groupId !== run.groupId || m.taskId !== run.taskId || m.workItemId !== run.workItemId
      || m.generation !== run.generation || m.highWater !== run.highWater || run.unknown.work || run.unknown.handoff
      || store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(run.runId, run.highWater)) return false;
    const baseline: {work:Amount;handoff:Amount} = { work: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 }, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } };
    let unknown = false;
    for (const row of store.db.prepare("SELECT body FROM usage_events WHERE run_id=? AND seq<=? ORDER BY seq").all(run.runId, run.highWater)) {
      const e = JSON.parse(String(row.body)); if (e.cumulative === null) unknown = true; else baseline[e.bucket as keyof Grant] = e.cumulative;
    }
    if (!unknown) return false;
    // Tester follow-up F §2: an observed floor is booked by the same arithmetic as Orca's approximate floor.
    if (m.method === "approximate-floor" || m.method === "observed-floor") {
      // Tester follow-up I (seat K): an observed floor of 0 is only a worker-lost run's that observed some usage (workerLostFloor).
      if (m.method === "observed-floor" && m.floorTokens === 0 && (!workerLostRun(run) || baseline.work.tokens === 0)) return false;
      if (!approximateFloorBooked(run, m, baseline)) return false;
    } else if (m.method === "known-zero") {
      if (!knownZeroProved(run)) return false;
      for (const b of ["work", "handoff"] as const) for (const d of ds) {
        if (m.charged[b][d] !== 0 || run.cumulative[b][d] !== baseline[b][d]) return false;
      }
      // Tester follow-up I (seat K): a run with no work token grant keeps no work token remainder (null; 0 as stored before).
      if ((run.remaining.work.tokens !== 0 && !(run.remaining.work.tokens === null && run.grant.work.tokens === null)) || run.remaining.handoff.tokens !== 0 || run.remaining.work.activeMs !== 0
        || run.remaining.work.attempts !== 0 || run.remaining.work.sessions !== 0) return false;
    } else for (const b of ["work", "handoff"] as const) for (const d of ds) {
      if (m.method === "owner-acknowledged-unmetered" && b === "work" && d === "tokens") {
        // m.charged.work.tokens is null by unmeteredChargeSchema (parsed above), so it is not checked again here.
        if (run.grant.work.tokens !== null || run.remaining.work.tokens !== null || run.cumulative.work.tokens !== baseline.work.tokens) return false;
        continue;
      }
      // Tester follow-up I (seat K): an expectation-model run has no work token grant; its remaining-grant charge is the unused
      // part of its live ceiling (G spec §14.1), so the booking is checked against the ceiling -- which only ever rises -- and
      // its remainder stays null (0 as the writer before this fix stored it: same booking, so read the same).
      const ceiling = (run as { liveCeiling?: { tokens?: unknown } }).liveCeiling?.tokens;
      if (b === "work" && d === "tokens" && run.grant.work.tokens === null && typeof ceiling === "number") {
        if ((run.remaining.work.tokens !== null && run.remaining.work.tokens !== 0) || (m.charged.work.tokens ?? 0) > Math.max(ceiling - baseline.work.tokens, 0)
          || run.cumulative.work.tokens !== baseline.work.tokens + (m.charged.work.tokens ?? 0)) return false;
        continue;
      }
      // Tester follow-up I (seat K): a worker-lost run is charged what it observed in every dimension but tokens -- its
      // remainder there was never spent (workerLostCharge) -- so it keeps that remainder.
      if (d !== "tokens" && workerLostRun(run) && m.charged[b][d] === 0) {
        if (run.grant[b][d] === null || run.cumulative[b][d] !== baseline[b][d] || run.remaining[b][d] !== Math.max(run.grant[b][d]! - baseline[b][d], 0)) return false;
        continue;
      }
      if (run.grant[b][d]===null || run.remaining[b][d] !== 0 || m.charged[b][d] !== Math.max(run.grant[b][d]! - baseline[b][d], 0)
        || run.cumulative[b][d] !== baseline[b][d] + m.charged[b][d]) return false;
    }
    const proof = settlementProof(store, run);
    if (!settlementSame(proof.report, m.report) || !settlementSame(proof.stopProof, m.stopProof)) return false;
    const row = store.db.prepare("SELECT principal,client,person_principal,verb,body_json FROM commands WHERE group_id=? AND id=?").get(run.groupId, m.commandId);
    if (!row) return false;
    // Spec 2026-11-06 §2 (d): Orca's row backs only Orca's method, and a person's row only a person's, so neither verb can
    // stand in for the other.
    if (m.method === "approximate-floor") { if (row.verb !== "settle-approximate-usage" || row.principal !== "orca-auto") return false; }
    // A Web owner's row names the account as its principal; a socket row (spec 2026-10-29 §2) names it as person_principal.
    // Tester follow-up E §8: an agent's settlement is backed by a socket row whose principal is that agent and which
    // names no person.
    else if (row.verb !== "settle-unknown-usage" || (row.client === "web" ? row.principal !== m.principal
      : m.principal.startsWith("agent:") ? row.person_principal !== null || row.principal !== m.principal
      : row.person_principal !== m.principal)) return false;
    const receipt = JSON.parse(String(row.body_json)).result;
    if (receipt?.kind !== "usage-settled" || receipt.runId !== run.runId || receipt.taskId !== run.taskId || receipt.generation !== run.generation
      || receipt.method !== m.method || receipt.at !== m.at || !settlementSame(receipt.charged, m.charged)) return false;
    if (m.handoffResolution) {
      const h = m.handoffResolution, c = releasedSettlementCheckpoint(store, run);
      if (c.checkpointId !== h.checkpointId || c.checkpointHash !== h.checkpointHash) return false;
      const r = store.db.prepare("SELECT state,body FROM handoff_requests WHERE group_id=? AND id=? AND run_id=?").get(run.groupId, h.requestId, run.runId);
      // A recovered run's request settled recoverable with no failure (spec 2026-10-14-handoff-stop-unknown-usage-design.md §3.2).
      const recovered = m.reservationDisposition === "recovered", state = recovered ? "settled-recoverable" : "settled-failed";
      if (!r || r.state !== state) return false;
      const body = JSON.parse(String(r.body));
      if (body.requestId !== h.requestId || body.runId !== run.runId || body.state !== state || body.failureCode !== (recovered ? null : h.previousFailureCode)) return false;
    }
    return true;
  } catch { return false; }
}
