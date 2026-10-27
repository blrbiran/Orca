import { ControlError } from "./errors.js";

/**
 * N1 spec §5.1 (human ruling H6, B′): one ccloop single call, told apart by what it is for. Pure: no store, no I/O, so
 * the driver, dispatch, stop and recovery code can all ask it without import cycles.
 *
 * Drafter ruling DR1: an estimate run's stored encoding is unchanged -- `phase: "estimate"` on its run row, in its
 * hashed dispatch envelope, in attempt evidence and in proof artifacts -- and is read here as purpose `estimate`. Any
 * other purpose is stored as `phase: "single-call"` with `purpose`. No stored row is ever rewritten.
 */
// Flow engine spec §6.2: a flow run's calls on its parent group (a flow `clarify` step's call is `clarify`, told apart by its run row).
export const SINGLE_CALL_PURPOSES = ["estimate", "clarify", "split", "flow-draft", "flow-review", "flow-ask", "rerun-proposal", "feedback-triage"] as const;
export type SingleCallPurpose = (typeof SINGLE_CALL_PURPOSES)[number];

export function isSingleCallPurpose(value: unknown): value is SingleCallPurpose {
  return typeof value === "string" && (SINGLE_CALL_PURPOSES as readonly string[]).includes(value);
}

/** The purpose a run's single call serves; null for a run that is not a single call (work, handoff). */
export function singleCallPurposeOf(run: { phase?: unknown; purpose?: unknown }): SingleCallPurpose | null {
  if (run.phase === "estimate") return "estimate";
  if (run.phase !== "single-call") return null;
  // DR3: an estimate is never stored as phase "single-call", so that pairing is as unknown as a purpose with no handler.
  if (run.purpose === "estimate" || !isSingleCallPurpose(run.purpose)) {
    throw new ControlError("recovery-blocked", `single-call-purpose-unknown:${String(run.purpose)}`);
  }
  return run.purpose;
}

/**
 * The outbox row a single call's claim writes and the driver reads back (DR4). An estimate's row is keyed by its work
 * item (unchanged, DR1). A clarify or split call's row is keyed by its run (as a Web work run's `work:<group>:<run>`
 * is): a round or draft is attempted more than once under one work item (H7 retries, DR15 recovery-retry), and a row
 * per work item let the next attempt overwrite it, so the earlier attempt's run stopped reading as a single call and a
 * restart's recovery blocked dispatch for every group (final review finding 1).
 */
export function singleCallClaimRowOf(phase: "estimate", groupId: string, workItemId: string, runId?: string): { id: string; kind: string };
export function singleCallClaimRowOf(phase: "estimate" | "single-call", groupId: string, workItemId: string, runId: string): { id: string; kind: string };
export function singleCallClaimRowOf(phase: "estimate" | "single-call", groupId: string, workItemId: string, runId?: string): { id: string; kind: string } {
  return phase === "estimate"
    ? { id: `estimate:${groupId}:${workItemId}`, kind: "estimate-claim" }
    : { id: `single-call:${groupId}:${workItemId}:${runId}`, kind: "single-call-claim" };
}

/**
 * Spec 2026-10-27 single-call unknown usage (tester #62) §9 R1: the purposes a person can settle and the block reason each
 * one's driver step writes (its handler's usageUnknownReason, singleCallPurposes.ts -- a criterion keeps the two equal).
 * Flow calls are out of scope. Kept here, free of the purposes' modules, so the read model and recovery-retry can ask.
 */
export const SETTLEABLE_USAGE_UNKNOWN_REASONS: Readonly<Partial<Record<SingleCallPurpose, string>>> = Object.freeze({
  estimate: "estimate-usage-unknown", clarify: "requirement-usage-unknown", split: "requirement-usage-unknown",
});
export const SINGLE_CALL_SETTLE_ACKNOWLEDGE = "charge-remaining-grant";

/**
 * The block a person can settle: a requirement or estimate single call (never a flow call, whose run names `flowCall`)
 * blocked at C with a reason that is its purpose's usage-unknown reason, alone or followed by `:` and ccloop's failure
 * code. `failure` is that code; a reason without one (the call completed but its usage is unknown) is recorded as
 * `usage-unknown` (review S2).
 * Code review S1 (2026-10-28): `closed` -- a stop reached the blocked call first. terminaliseRun closed it (a `settled-*`
 * state, its block reason left on the drive record), interrupted its round, draft or estimate and released its grant, but
 * its usage stays unknown, so the group's flag stays set; it is settled by the same acknowledged retry, without `complete`.
 */
export function settleableSingleCallBlock(run: { phase?: unknown; purpose?: unknown; state?: unknown; flowCall?: unknown; unknown?: { work?: boolean; handoff?: boolean }; drive?: { blockedAt?: string | null; blockedReason?: string | null } }): { purpose: SingleCallPurpose; failure: string; closed: boolean } | null {
  const purpose = singleCallPurposeOf(run);
  if (purpose === null || run.drive?.blockedAt !== "C") return null;
  const closed = run.state !== "blocked";
  if (closed && !(typeof run.state === "string" && run.state.startsWith("settled-") && (run.unknown?.work === true || run.unknown?.handoff === true))) return null;
  const prefix = SETTLEABLE_USAGE_UNKNOWN_REASONS[purpose];
  if (prefix === undefined || run.flowCall !== undefined) return null;
  const reason = run.drive.blockedReason ?? "";
  if (reason !== prefix && !reason.startsWith(`${prefix}:`)) return null;
  return { purpose, failure: reason === prefix ? "usage-unknown" : reason.slice(prefix.length + 1), closed };
}
