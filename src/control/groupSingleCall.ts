import { randomUUID } from "node:crypto";
import { add, subtract, syncWebBudget } from "./budget.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { dimensions } from "./commands.js";
import { ControlError } from "./errors.js";
import { readGroup, saveGroup } from "./queries.js";
import { singleCallClaimRowOf } from "./singleCall.js";
import { assertCallUsageBooked, closeSingleCall, insertSingleCallRun, verifyStoppedSingleCall, type StoppedSingleCallRun } from "./singleCallLedger.js";
import type { SingleCallRunRow } from "./singleCallPurposes.js";
import { claimCapBlocking } from "./spendCaps.js";
import { readCanonicalRecord, writeCanonicalRecord } from "./snapshot.js";
import type { FrozenSlot } from "./agentSelection.js";
import type { ControlStore } from "./store.js";
import type { Amount } from "./types.js";

/**
 * Tester follow-up G (spec §10.1 goal judge, §3 requirement review): a group's own single call -- one call on a work item
 * of its own, funded by the group it judges, claimed, settled and interrupted the way the quota probe is
 * (quotaProbeCall.ts). Kept free of the control import cycle (no driver, dispatch, stop or service module).
 */
export const GROUP_CALL_PURPOSES = ["no-change-judge", "requirement-review"] as const;
export type GroupCallPurpose = (typeof GROUP_CALL_PURPOSES)[number];

export function isGroupCallPurpose(purpose: unknown): purpose is GroupCallPurpose {
  return typeof purpose === "string" && (GROUP_CALL_PURPOSES as readonly string[]).includes(purpose);
}

type GroupLedger = { used: Amount; reserved: Amount; limit: Record<string, number | null> };

/**
 * The grant a group can give its own call: tokens bounded by a finite group's remainder (limit - used - reserved), an
 * unlimited group's ask unchanged; `unfunded` names the first dimension that does not fit, `"tokens"` when the bounded
 * tokens fall below `floorTokens`, or `"spend-cap"` when a spend cap blocks the claim.
 */
export function boundedGroupGrant(store: ControlStore, groupId: string, grant: Amount, floorTokens: number, at: number): { grant: Amount } | { unfunded: string } {
  const group = readGroup(store, groupId) as unknown as GroupLedger;
  const tokenLimit = group.limit.tokens ?? null;
  const tokens = tokenLimit === null ? grant.tokens : Math.min(grant.tokens, tokenLimit - group.used.tokens - group.reserved.tokens);
  if (tokens < floorTokens) return { unfunded: "tokens" };
  const bounded: Amount = { ...grant, tokens };
  const dimension = dimensions.find((d) => d !== "tokens" && group.limit[d] != null && group.used[d] + group.reserved[d] + bounded[d] > group.limit[d]!);
  if (dimension !== undefined) return { unfunded: dimension };
  if (claimCapBlocking(store, groupId, bounded.tokens, at) !== null) return { unfunded: "spend-cap" };
  return { grant: bounded };
}

/**
 * The claim, in the caller's transaction: the purpose's contract as a canonical record and its
 * `single-call-contract:<group>:<workItem>` row (what the stop path reads back), the run (insertSingleCallRun), the claim
 * row, and the grant reserved on the group.
 */
export function claimGroupSingleCallInTransaction(store: ControlStore, input: {
  groupId: string; workItemId: string; purpose: GroupCallPurpose; identity: Record<string, unknown>; slot: FrozenSlot;
  profile: { profileId: string; profileHash: string }; grant: Amount; contract: Record<string, unknown>;
}): { runId: string } {
  const { groupId, workItemId } = input;
  if (store.db.prepare("SELECT 1 FROM runs WHERE work_item_id=? AND group_id=? AND active=1").get(workItemId, groupId) !== undefined) throw new ControlError("recovery-blocked", `group-call-active:${workItemId}`);
  const attempt = Number(store.db.prepare("SELECT count(*) AS n FROM runs WHERE work_item_id=? AND group_id=?").get(workItemId, groupId)!.n) + 1;
  const contract = { ...input.contract, groupId, workItemId, purpose: input.purpose, attempt, grant: { work: { ...input.grant } } };
  const contractHash = sha256Canonical(contract);
  writeCanonicalRecord(store, groupId, contractHash, canonicalBytes(contract).toString("utf8"));
  store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,?,?,1) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(`single-call-contract:${groupId}:${workItemId}`, "single-call-contract",
    canonicalBytes({ groupId, workItemId, contractHash }).toString("utf8"));
  const group = readGroup(store, groupId);
  const runId = `run-${randomUUID()}`;
  const { envelopeHash } = insertSingleCallRun(store, {
    // Tester #282: every run names its estimate (null for a group call), as the run read schema requires; without it the
    // group view answered 423 run-invalid for good once a requirement review or a goal judge had run.
    groupId, workItemId, runId, ownerToken: randomUUID(), purpose: input.purpose, identity: { estimateId: null, ...input.identity },
    graphVersion: group.graphVersion, targetVersion: attempt, commandId: workItemId, slot: input.slot, agentCapabilities: input.slot.capabilities,
    workGrant: { ...input.grant }, profile: input.profile, claimIdentity: `single-call:${groupId}:${workItemId}:${attempt}`, derivedContractHash: contractHash,
  });
  const claimRow = singleCallClaimRowOf("single-call", groupId, workItemId, runId);
  store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,?,?,1)").run(claimRow.id, claimRow.kind, canonicalBytes({ groupId, workItemId, runId, envelopeHash }).toString("utf8"));
  group.reserved = add(group.reserved, input.grant);
  syncWebBudget(store, group, null);
  saveGroup(store, group);
  return { runId };
}

/** The work item a group's own call runs on is named by its purpose: `<purpose>-<key>` (the view checks the prefix). */
export function isGroupCallWorkItem(purpose: GroupCallPurpose, workItemId: string): boolean {
  return workItemId.startsWith(`${purpose}-`);
}

/** The call's frozen contract (canonical record named by its `single-call-contract` row), or null when it cannot be read. */
export function readGroupCallContract(store: ControlStore, groupId: string, workItemId: string): Record<string, unknown> | null {
  const row = store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='single-call-contract'").get(`single-call-contract:${groupId}:${workItemId}`);
  if (row === undefined) return null;
  try { return JSON.parse(readCanonicalRecord(store, String((JSON.parse(String(row.body)) as { contractHash: string }).contractHash))); } catch { return null; }
}

/** The unused grant back to the call's group (usage booking already took what the call spent out of `reserved`). */
export function interruptGroupSingleCall(store: ControlStore, run: StoppedSingleCallRun): void {
  const group = readGroup(store, run.groupId);
  group.reserved = subtract(group.reserved, run.remaining.work);
  syncWebBudget(store, group, null);
  saveGroup(store, group);
}

/**
 * The settlement's shared half, in the caller's transaction: null when the `single-call-result:<group>:<run>` receipt
 * already exists (a replay); else the terminal is committed, the stopped run verified against the grant it was claimed
 * with, its usage asserted booked, the unused grant released and the run closed. The purpose writes its outcome after.
 */
export function completeGroupSingleCallInTransaction(store: ControlStore, runRow: SingleCallRunRow, grant: Amount, commitTerminal: () => void, usageUnknownReason: string): StoppedSingleCallRun | null {
  const receiptId = `single-call-result:${runRow.groupId}:${runRow.runId}`;
  if (store.db.prepare("SELECT id FROM outbox WHERE id=? AND kind='single-call-result'").get(receiptId)) return null;
  commitTerminal();
  const row = store.db.prepare("SELECT id,active,body FROM runs WHERE id=?").get(runRow.runId);
  if (!row) throw new ControlError("run-not-found");
  const run = verifyStoppedSingleCall(store, row, { groupId: runRow.groupId, workItemId: runRow.workItemId, workGrant: grant }, `${String(runRow.purpose)}-ledger`);
  assertCallUsageBooked(readGroup(store, run.groupId) as unknown as Parameters<typeof assertCallUsageBooked>[0], run, usageUnknownReason);
  interruptGroupSingleCall(store, run);
  closeSingleCall(store, run.runId, { id: receiptId, kind: "single-call-result", body: { groupId: run.groupId, runId: run.runId } });
  return run;
}
