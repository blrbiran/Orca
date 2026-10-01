import { ControlError } from "./errors.js";

/**
 * N1 spec §5.1 (human ruling H6, B′): one ccloop single call, told apart by what it is for. Pure: no store, no I/O, so
 * the driver, dispatch, stop and recovery code can all ask it without import cycles.
 *
 * Drafter ruling DR1: an estimate run's stored encoding is unchanged -- `phase: "estimate"` on its run row, in its
 * hashed dispatch envelope, in attempt evidence and in proof artifacts -- and is read here as purpose `estimate`. Any
 * other purpose is stored as `phase: "single-call"` with `purpose`. No stored row is ever rewritten.
 */
export const SINGLE_CALL_PURPOSES = ["estimate", "clarify", "split"] as const;
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

/** The outbox row a single call's claim writes and the driver reads back (DR4). */
export function singleCallClaimRowOf(phase: "estimate" | "single-call", groupId: string, workItemId: string): { id: string; kind: string } {
  return phase === "estimate"
    ? { id: `estimate:${groupId}:${workItemId}`, kind: "estimate-claim" }
    : { id: `single-call:${groupId}:${workItemId}`, kind: "single-call-claim" };
}
