/**
 * The estimate's terminal settlement and the group/proposal helpers it writes through, moved unchanged out of
 * webService.ts so singleCallPurposes.ts can register the estimate purpose without importing webService.ts, which imports
 * it back (session e236bbe4: the static import cycle registered as m4 in session 3cd8fb02). webService.ts re-exports
 * every name here.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { AdmissionGate } from "./admissionGate.js";
import { budgetBalance } from "./budget.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { zero } from "./commands.js";
import { ControlError } from "./errors.js";
import { problemsFromRefusal, repairEstimateOutput } from "./estimateRepair.js";
import { decideEstimateRetry, estimateRetryId, retryPromptRequired, writeEstimateRetry } from "./estimateRetry.js";
import { classifyEstimateOutput, estimateGrantFor, readEstimateContract, residual, sumAmounts } from "./estimator.js";
import { hasTokenPolicy, saveTokenPolicy } from "./fundedAllowance.js";
import { mirrorWebAuthority, type Body } from "./proposalReopen.js";
import { recordProjectionChange } from "./projectionJournal.js";
import { readArchivedPlan, readBudgetProposal, readEstimateRecord, type BudgetProposalRecord } from "./queries.js";
import { amountSchema, budgetAmountSchema } from "./schema.js";
import { assertCallUsageBooked, closeSingleCall, verifyStoppedSingleCall } from "./singleCallLedger.js";
import { writeCanonicalRecord } from "./snapshot.js";
import { capStatuses } from "./spendCaps.js";
import type { ControlStore } from "./store.js";
import type { BudgetAmount } from "./tokenPolicy.js";
import { groupRepoIdOf } from "./usageLedger.js";
import { budgetEstimateSchema, type BudgetEstimateV1 } from "./webProtocol.js";
const ledgerSchema = z.object({ groupLimit: budgetAmountSchema, used: amountSchema, committedRemaining: amountSchema, explicitUnallocatedReserve: budgetAmountSchema, budgetDeficit: amountSchema, usageUnknown: z.boolean() }).strict();
const groupSchema = z.object({ groupId: z.string(), status: z.enum(["clarifying", "draft", "ready", "running", "review", "done", "blocked"]), stopped: z.boolean(), used: amountSchema, reserved: amountSchema, limit: budgetAmountSchema, ledger: ledgerSchema }).passthrough();
export type Group = z.infer<typeof groupSchema>;
export const same = (a: unknown, b: unknown) => canonicalBytes(a).equals(canonicalBytes(b));
export function identifyRawEstimateOutput(value: unknown): { rawHash: string; rawIdentity: string; canonicalJson: string | null } {
  try {
    const bytes = canonicalBytes(value), canonicalJson = bytes.toString("utf8");
    return { rawHash: createHash("sha256").update(bytes).digest("hex"), rawIdentity: `canonical-json:${canonicalJson}`, canonicalJson };
  } catch (error) {
    if (!(error instanceof ControlError) || error.code !== "control-non-canonical-json") throw error;
  }
  const seen = new Map<object, number>();
  const encode = (item: unknown): unknown => {
    if (item === null) return ["null"];
    if (typeof item === "boolean" || typeof item === "string") return [typeof item, item];
    if (typeof item === "number") return ["number", Object.is(item, -0) ? "-0" : String(item)];
    if (typeof item === "bigint") return ["bigint", item.toString()];
    if (typeof item === "undefined") return ["undefined"];
    if (typeof item === "symbol") return ["symbol", item.description ?? ""];
    if (typeof item === "function") return ["function", item.name];
    const prior = seen.get(item);
    if (prior !== undefined) return ["reference", prior];
    const identity = seen.size; seen.set(item, identity);
    if (Array.isArray(item)) return ["array", identity, item.map(encode)];
    const entries = Reflect.ownKeys(item).map((key, ordinal) => {
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      const encodedKey = typeof key === "string" ? ["string", key] : ["symbol", key.description ?? "", ordinal];
      return [encodedKey, "value" in descriptor ? ["value", encode(descriptor.value)] : ["accessor", Boolean(descriptor.get), Boolean(descriptor.set)]];
    });
    entries.sort((left, right) => JSON.stringify(left[0]).localeCompare(JSON.stringify(right[0])));
    return ["object", identity, entries];
  };
  const rawIdentity = `noncanonical-v1:${JSON.stringify(encode(value))}`;
  return { rawHash: createHash("sha256").update(rawIdentity).digest("hex"), rawIdentity, canonicalJson: null };
}
export function readWebGroup(store: ControlStore, groupId: string): Group {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (!row) throw new ControlError("group-not-found");
  try {
    const group = groupSchema.parse(JSON.parse(String(row.body)));
    if (group.groupId !== groupId || !same(group.used, group.ledger.used) || !same(group.reserved, group.ledger.committedRemaining) || !same(group.limit, group.ledger.groupLimit)) throw new Error("ledger-mismatch");
    return group;
  } catch { throw new ControlError("recovery-blocked"); }
}
export function saveWebAuthority(store: ControlStore, group: Group, proposal: BudgetProposalRecord): void {
  if (!proposal.allocations.some(a => a.ownerKind === "goal-review")) throw new ControlError("recovery-blocked");
  const optionalPolicy=hasTokenPolicy(store,group.groupId);
  mirrorWebAuthority(group as unknown as Body, proposal as unknown as Body);
  saveTokenPolicy(store,group.groupId,"",proposal.groupLimit.tokens,optionalPolicy?"optional-v1":"finite-legacy");
  if(optionalPolicy)for(const a of proposal.allocations)if(a.ownerKind==="task"&&a.bucket==="work")saveTokenPolicy(store,group.groupId,a.ownerId,a.amount.tokens);
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), group.groupId);
  store.db.prepare("UPDATE budget_proposals SET proposal_version=?,body=? WHERE group_id=?").run(proposal.proposalVersion, canonicalBytes(proposal).toString("utf8"), group.groupId);
}
export function setReserve(proposal: BudgetProposalRecord, reserve: BudgetAmount): void {
  proposal.explicitUnallocatedReserve = reserve;
  const row = proposal.allocations.find(a => a.ownerKind === "reserve");
  if (!row) throw new ControlError("recovery-blocked");
  row.amount = reserve;
}

/** Estimate usable-answer spec §4.3: a failed settlement's reason and the problems a retry would carry. */
export interface EstimateFailure { reasonCode: string; problems: string[] }

/**
 * The problems for a failed estimate: repair's own, the classifier's refusal of a repaired answer (never empty), or
 * `no-json-object` for a call ccloop could read no JSON object from. Every other call failure is not retryable: `[]`.
 */
function estimateFailureProblems(reasonCode: string, callFailure: string | null, repairProblems: string[] | null, judged: unknown, notCanonical: boolean): string[] {
  if (repairProblems !== null) return repairProblems;
  if (reasonCode.startsWith("estimate-call-failed")) return callFailure === "single-call-output-invalid" ? ["no-json-object"] : [];
  // A repaired answer the classifier still finds about another plan: its planHash or task ids do not match the request.
  if (reasonCode === "estimate-output-plan-mismatch") return ["plan-mismatch"];
  const parsed = budgetEstimateSchema.safeParse(judged);
  const problems = problemsFromRefusal(parsed.success ? [] : parsed.error.issues, notCanonical);
  return problems.length > 0 ? problems : ["output-not-canonical"];
}

/**
 * The estimate's terminal settlement (formerly WebControlService.completeEstimate's body, moved unchanged so the
 * execution driver can call it -- single-call estimate spec §6.3, drafter finding F13). `commitTerminal` runs first, in
 * the same transaction, and a throw from anything here rolls it back with the rest.
 */
export function completeEstimateInStore(
  deps: { store: ControlStore; admissionGate?: AdmissionGate }, id: string, estimateId: string, rawOutput: unknown, commitTerminal?: () => void,
  // N1 spec §5.1: the estimate purpose's registered classifier (singleCallPurposes.ts); the service method keeps the default.
  classify: typeof classifyEstimateOutput = classifyEstimateOutput,
  // Spec 2026-10-15 ccloop error codes §4.5: ccloop's code for a failed call (driver-normalised); the service method passes none.
  callFailure: string | null = null,
): void {
  const release = deps.admissionGate?.enter();
  try {
    deps.store.transaction(() => completeEstimateInTransaction(deps.store, id, estimateId, rawOutput, commitTerminal, classify, callFailure));
  } finally { release?.(); }
}

/**
 * Spec 2026-10-27 single-call unknown usage §9 R2: the estimate's settlement core, inside the caller's transaction -- the
 * driver's (completeEstimateInStore above) or a usage settlement's (singleCallSettlement.ts).
 */
export function completeEstimateInTransaction(
  store: ControlStore, id: string, estimateId: string, rawOutput: unknown, commitTerminal?: () => void,
  classify: typeof classifyEstimateOutput = classifyEstimateOutput, callFailure: string | null = null,
): void {
  const deps = { store };
  const estimate = readEstimateRecord(deps.store, id, estimateId), receiptId = `estimate-result:${id}:${estimateId}`;
  const { rawHash, rawIdentity, canonicalJson: rawCanonicalJson } = identifyRawEstimateOutput(rawOutput);
  const receipt = deps.store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='estimate-result'").get(receiptId);
  if (receipt) {
    const retained = JSON.parse(String(receipt.body));
    if (retained.rawHash !== rawHash || retained.rawIdentity !== rawIdentity) throw new ControlError("report-identity-conflict");
    return;
  }
  commitTerminal?.();
  if (!["running", "start-unknown"].includes(estimate.state)) throw new ControlError("start-state-conflict");
  const rows = deps.store.db.prepare("SELECT id,active,body FROM runs WHERE group_id=? AND work_item_id=?").all(id, estimateId);
  if (rows.length !== 1) throw new ControlError("recovery-blocked");
  // N1 spec §5.1 (PR-I4): the stop and usage checks are every single call's.
  const run = verifyStoppedSingleCall(deps.store, rows[0], { groupId: id, workItemId: estimateId, workGrant: estimate.grant });
  const group = readWebGroup(deps.store, id), proposal = readBudgetProposal(deps.store, id), plan = readArchivedPlan(deps.store, id);
  assertCallUsageBooked(group, run);
  const currentBalance = budgetBalance(group.limit, group.used, group.reserved);
  if (!same(currentBalance.reserve, proposal.explicitUnallocatedReserve) || !same(currentBalance.deficit, group.ledger.budgetDeficit)) throw new ControlError("recovery-blocked");
  // Single-call estimate spec §6.4: a failed estimate carries its own reason. A schema-valid answer that is not
  // canonical JSON (a lone surrogate, a negative zero) cannot be hashed, so it is an invalid answer too.
  // Estimate usable-answer spec §4.2: repair runs on every non-null answer before the classifier, which then judges
  // the repaired value and stays the single judge. A null answer is a failed call and never reaches repair.
  const taskIds = plan.plan.tasks.map(t => t.taskId), contract = readEstimateContract(deps.store, id, estimateId);
  let repairs: string[] = [], repairProblems: string[] | null = null, judged: unknown = rawOutput;
  if (rawOutput !== null) {
    const repaired = repairEstimateOutput(rawOutput, { planHash: plan.planHash, taskIds, instructionVersion: contract.instructionVersion });
    if (repaired.ok) { repairs = repaired.repairs; judged = repaired.output; } else repairProblems = repaired.problems;
  }
  const classified = repairProblems !== null ? { ok: false as const, reasonCode: "estimate-output-invalid" } : classify(judged, plan.planHash, taskIds);
  let output: BudgetEstimateV1 | null = null, outputHash: string | null = null, notCanonical = false;
  let reasonCode: string | null = classified.ok ? null
    : classified.reasonCode === "estimate-call-failed" && callFailure !== null ? `estimate-call-failed:${callFailure}` : classified.reasonCode;
  if (classified.ok) {
    try { outputHash = sha256Canonical(classified.output); output = classified.output; }
    catch (error) { if (!(error instanceof ControlError)) throw error; reasonCode = "estimate-output-invalid"; notCanonical = true; }
  }
  // Spec §4.3: why the estimate failed and the problems a retry would carry; empty problems = not retryable.
  const failure: EstimateFailure | null = reasonCode === null ? null : { reasonCode, problems: estimateFailureProblems(reasonCode, callFailure, repairProblems, judged, notCanonical) };
  estimate.state = output ? "ready" : "failed"; estimate.output = output; estimate.outputHash = outputHash; estimate.reasonCode = failure?.reasonCode ?? null;
  estimate.repairs = repairs;
  if (rawCanonicalJson !== null) writeCanonicalRecord(deps.store, id, rawHash, rawCanonicalJson);
  if (output) writeCanonicalRecord(deps.store, id, estimate.outputHash!, canonicalBytes(output).toString("utf8"));
  group.ledger.committedRemaining = residual(group.reserved, zero(), run.remaining.work);
  const settledBalance = budgetBalance(group.limit, group.used, group.ledger.committedRemaining);
  group.ledger.budgetDeficit = settledBalance.deficit;
  setReserve(proposal, settledBalance.reserve);
  // Spec §4.3: the one automatic retry, decided on the settled numbers by plain reads only (it never throws).
  const decision = decideEstimateRetry({ estimate, contract, failure, group, proposalVersion: proposal.proposalVersion, proposalConfirmed: proposal.state === "confirmed",
    newestEstimateVersion: Number(deps.store.db.prepare("SELECT MAX(estimate_version) AS n FROM estimates WHERE group_id=?").get(id)?.n ?? 0),
    reserveAfterSettlement: settledBalance.reserve, dispatchBlocked: deps.store.dispatchBlocked });
  if (decision.kind === "skip") estimate.retrySkipped = decision.code;
  if (decision.kind === "retry") estimate.retriedAs = estimateRetryId(id, estimateId);
  deps.store.db.prepare("UPDATE estimates SET state=?,body=? WHERE group_id=? AND id=?").run(estimate.state, canonicalBytes(estimate).toString("utf8"), id, estimateId);
  if (decision.kind === "retry") {
    // Tester round 2 spec §5.2.3: the retry's grant from the reserve after this settlement and the cap headroom read in
    // this transaction, reserved like any queued estimate's (createEstimate).
    const required = retryPromptRequired(contract, estimate.request!, decision.problems)!;
    // The settlement never throws for the retry (spec §4.3): a cap reading that fails leaves the cap term out, and the
    // claim gate then decides with the frozen grant.
    let capHeadroom: number | null;
    try { capHeadroom = capStatuses(deps.store, groupRepoIdOf(group as unknown as Record<string, unknown>), deps.store.now())[0]?.headroom ?? null; } catch { capHeadroom = null; }
    const grant = estimateGrantFor({ limitTokens: group.limit.tokens, remainingTokens: settledBalance.reserve.tokens, capHeadroom, requiredRequestTokens: Number(required) });
    writeEstimateRetry(deps.store, id, estimate, contract, decision.problems, grant);
    group.ledger.committedRemaining = sumAmounts([group.ledger.committedRemaining, grant]);
    setReserve(proposal, residual(group.limit, group.used, group.ledger.committedRemaining));
  }
  closeSingleCall(deps.store, run.runId, { id: receiptId, kind: "estimate-result", body: { groupId: id, estimateId, runId: run.runId, rawHash, rawIdentity } });
  saveWebAuthority(deps.store, group, proposal); recordProjectionChange(deps.store, [id]);
}
