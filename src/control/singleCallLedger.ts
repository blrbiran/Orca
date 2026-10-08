import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { dimensions, zero } from "./commands.js";
import { ControlError } from "./errors.js";
import { amountSchema } from "./schema.js";
import { writeCanonicalRecord } from "./snapshot.js";
import { dispatchEnvelopeSchema, type ProfileBindingV1 } from "./webProtocol.js";
import type { FrozenSlot } from "./agentSelection.js";
import type { ControlStore } from "./store.js";
import type { Amount } from "./types.js";

/**
 * N1 spec §5.1 ("claim plumbing ... written once", controller ruling PR-I4): the run row, the frozen dispatch envelope
 * and the settlement checks every single-call purpose shares. What a purpose owns -- its claim row, its contract, what it
 * records once the call is settled -- stays with the purpose (webService.ts for the estimate, requirementCalls.ts for
 * clarify and split).
 */

const same = (a: unknown, b: unknown) => canonicalBytes(a).equals(canonicalBytes(b));

export interface SingleCallClaimInput {
  groupId: string; workItemId: string; runId: string; ownerToken: string;
  /** DR1: an estimate is stored as phase "estimate" with no purpose; every other purpose as phase "single-call" with it. */
  purpose: "estimate" | "clarify" | "split";
  /** The purpose's own run fields, placed right after `taskId` (the estimate's `estimateId`). */
  identity: Record<string, unknown>;
  graphVersion: number; targetVersion: number; commandId: string;
  slot: FrozenSlot; agentCapabilities: unknown; workGrant: Amount; profile: ProfileBindingV1;
  claimIdentity: string; derivedContractHash: string;
}

/**
 * The claim's shared half: a `starting` run on the frozen slot with a work-only grant, and its dispatch envelope frozen
 * as a canonical record. The caller writes its own claim row naming `envelopeHash`.
 */
export function insertSingleCallRun(store: ControlStore, input: SingleCallClaimInput): { run: Record<string, unknown>; envelopeHash: string } {
  const { groupId, workItemId, runId, ownerToken, slot } = input;
  const phase = input.purpose === "estimate" ? "estimate" : "single-call";
  const named = input.purpose === "estimate" ? {} : { purpose: input.purpose };
  const grant = { work: { ...input.workGrant }, handoff: zero() };
  const run = {
    runId, groupId, workItemId, taskId: null, ...input.identity, ...named, generation: 1, graphVersion: input.graphVersion, targetVersion: input.targetVersion,
    commandId: input.commandId, configHash: slot.configHash, agent: slot.selection, agentProvenance: slot.provenance, timeoutMs: slot.timeoutMs, killGraceMs: slot.killGraceMs,
    agentCapabilities: input.agentCapabilities,
    grant, ownerToken, executionProfile: { workKind: "budget-estimate", ...input.profile }, handoffProfile: null,
    executionId: null, state: "starting", checkpointId: null, recoverable: false, remaining: structuredClone(grant), cumulative: { work: zero(), handoff: zero() }, unknown: { work: false, handoff: false },
    highWater: 0, breaches: [], handoffWorkItemId: null, phase, claimOrdinal: null, providerAttemptOrdinal: 0, failureCode: null,
  };
  const envelope = dispatchEnvelopeSchema.parse({ schema: "orca-dispatch-envelope-v1", phase, ...named, groupId, workItemId, runId, generation: 1,
    claimIdentity: input.claimIdentity, ownerTokenHash: createHash("sha256").update(ownerToken).digest("hex"), continuationIntentId: null, claimOrdinal: null,
    derivedContractHash: input.derivedContractHash, grants: grant, profiles: { estimator: input.profile, worker: null, handoff: null } });
  const envelopeHash = sha256Canonical(envelope);
  writeCanonicalRecord(store, groupId, envelopeHash, canonicalBytes(envelope).toString("utf8"));
  store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,1,1,?)").run(runId, groupId, workItemId, JSON.stringify(run));
  return { run, envelopeHash };
}

/** A single-call run as settlement reads it. */
export interface StoppedSingleCallRun {
  runId: string; groupId: string; workItemId: string; state: string; highWater: number;
  grant: { work: Amount; handoff: Amount }; remaining: { work: Amount; handoff: Amount }; cumulative: { work: Amount; handoff: Amount };
  unknown: { work: boolean; handoff: boolean }; [key: string]: unknown;
}

const STOPPED_STATES = ["failed-before-provider", "settled-recoverable", "settled-restartable", "settled-unrecoverable", "settled-failed"];

/**
 * The settlement's shared check (single-call estimate spec §6.3, N1 spec §5.1 Ce): the run row is still active, its
 * stop is confirmed with known usage, it is this group's and work item's, its grant is the work-only grant it was
 * claimed with, `remaining == max(grant - cumulative, 0)`, and no usage event is waiting above its high-water mark.
 * Unconfirmed usage is run-stop-unconfirmed (the driver blocks the run by its purpose's reason); a ledger that does not
 * add up is recovery-blocked.
 */
export function verifyStoppedSingleCall(
  store: ControlStore, row: Record<string, unknown>, expected: { groupId: string; workItemId: string; workGrant: Amount }, detail?: string,
): StoppedSingleCallRun {
  const run = JSON.parse(String(row.body)) as StoppedSingleCallRun;
  if (!STOPPED_STATES.includes(run.state) || run.groupId !== expected.groupId || run.workItemId !== expected.workItemId || run.unknown.work || run.unknown.handoff) {
    throw new ControlError("run-stop-unconfirmed");
  }
  amountSchema.parse(run.remaining.work); amountSchema.parse(run.cumulative.work);
  const grants = z.object({ work: amountSchema, handoff: amountSchema }).strict().safeParse(run.grant);
  if (Number(row.active) !== 1 || run.runId !== String(row.id) || !grants.success || !same(grants.data.work, expected.workGrant)
    || !same(grants.data.handoff, zero()) || !same(run.remaining.handoff, zero()) || !same(run.cumulative.handoff, zero())
    || dimensions.some(d => run.remaining.work[d] !== Math.max(expected.workGrant[d] - run.cumulative.work[d], 0))
    || store.db.prepare("SELECT seq FROM usage_events WHERE run_id=? AND seq>?").get(run.runId, Number(run.highWater))) throw new ControlError("recovery-blocked", detail);
  return run;
}

/** The group has booked the call's usage: none of its usage is unknown, and what it used covers the call's spend. */
export function assertCallUsageBooked(group: { used: Amount; ledger: { usageUnknown: boolean } }, run: StoppedSingleCallRun, detail?: string): void {
  if (group.ledger.usageUnknown || dimensions.some(d => group.used[d] < run.cumulative.work[d])) throw new ControlError("recovery-blocked", detail);
}

/** The settlement's last writes: the run leaves the active set and the purpose's receipt makes a replay a no-op. */
export function closeSingleCall(store: ControlStore, runId: string, receipt: { id: string; kind: string; body: unknown }): void {
  store.db.prepare("UPDATE runs SET active=0 WHERE id=?").run(runId);
  store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,?,?,1)").run(receipt.id, receipt.kind, canonicalBytes(receipt.body).toString("utf8"));
}
