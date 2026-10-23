import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { dimensions } from "./commands.js";
import { buildEstimatePrompt, estimateTaskIds } from "./estimatePrompt.js";
import { ESTIMATE_GRANT, persistEstimateArtifacts } from "./estimator.js";
import type { EstimateRecord } from "./queries.js";
import type { ControlStore } from "./store.js";
import type { BudgetAmount } from "./tokenPolicy.js";
import type { Amount } from "./types.js";
import { estimateExecutionContractSchema, type BudgetEstimateRequestV1, type EstimateExecutionContractV1 } from "./webProtocol.js";

/**
 * Estimate usable-answer spec §4.3: one automatic retry of an estimate that failed because of its answer, with feedback
 * saying what was wrong. The decision is code (CLAUDE.md Rule 5) and runs inside the failed estimate's settlement
 * transaction, after its settlement numbers are computed, so it reads plain values only and never throws: a throw would
 * roll the settlement back and leave the estimate `running`, re-driven every round.
 */
export type RetrySkipCode =
  | "group-not-prestart" | "proposal-confirmed" | "budget-deficit" | "usage-unknown" | "dispatch-blocked" | "reserve-insufficient"
  | "proposal-changed" | "proposal-unknown" | "superseded" | "tokenizer-unavailable" | "input-too-large";
export type RetryDecision = { kind: "retry"; problems: string[] } | { kind: "skip"; code: RetrySkipCode } | { kind: "none" };

/** Spec §4.3 Trigger: the reasons an answer, not the transport, failed. Every other `estimate-call-failed:*` is not retried. */
const RETRYABLE: ReadonlySet<string> = new Set(["estimate-output-invalid", "estimate-output-plan-mismatch", "estimate-call-failed:single-call-output-invalid"]);

/** What the decision reads of the group as the settlement leaves it (webService.ts's group body). */
export interface RetryGroupFacts {
  status: string; stopped: boolean; ledger: { budgetDeficit: Amount; usageUnknown: boolean };
  /** Issue-fixes spec §6.3: an archived group's body carries `archived` (archivedMark.ts); its presence is enough here. */
  [key: string]: unknown;
}

export interface RetryInput {
  estimate: EstimateRecord; contract: EstimateExecutionContractV1;
  failure: { reasonCode: string; problems: string[] } | null;
  group: RetryGroupFacts;
  /** The budget proposal's current version, and whether it is confirmed (its advice can no longer be applied). */
  proposalVersion: number; proposalConfirmed: boolean;
  /** The highest estimate version the group holds. */
  newestEstimateVersion: number;
  /** The group's unallocated reserve after this settlement (a null dimension is unlimited). */
  reserveAfterSettlement: BudgetAmount;
  dispatchBlocked: boolean;
}

export function decideEstimateRetry(input: RetryInput): RetryDecision {
  const { estimate, contract, failure, group } = input;
  // A2: never a retry of a retry.
  if (failure === null || estimate.origin !== undefined || !RETRYABLE.has(failure.reasonCode) || failure.problems.length === 0) return { kind: "none" };
  const skip = (code: RetrySkipCode): RetryDecision => ({ kind: "skip", code });
  if (group.stopped || Object.hasOwn(group, "archived") || (group.status !== "draft" && group.status !== "ready")) return skip("group-not-prestart");
  // Controller ruling (Task 5 fix round 1): a confirmed proposal takes no advice (the panel advises an editable one only).
  if (input.proposalConfirmed) return skip("proposal-confirmed");
  if (dimensions.some(d => group.ledger.budgetDeficit[d] !== 0)) return skip("budget-deficit");
  if (group.ledger.usageUnknown) return skip("usage-unknown");
  if (input.dispatchBlocked) return skip("dispatch-blocked");
  // Tester round 2 spec §5.2.3: the retry's grant follows the reserve in tokens (estimateGrantFor), so only a finite
  // non-token dimension below the cap's, or a limited group's token reserve of 0, rules it out.
  if (dimensions.some(d => { const left = input.reserveAfterSettlement[d]; return left !== null && (d === "tokens" ? left <= 0 : left < ESTIMATE_GRANT[d]); })) return skip("reserve-insufficient");
  if (estimate.proposalVersion === undefined) return skip("proposal-unknown");
  if (estimate.proposalVersion !== input.proposalVersion) return skip("proposal-changed");
  if (input.newestEstimateVersion > estimate.estimateVersion) return skip("superseded");
  // The settlement transaction holds no token counter: only the utf8 upper bound can size the retry's prompt here.
  if (contract.tokenizer.kind !== "utf8-upper-bound") return skip("tokenizer-unavailable");
  // Unreachable: a settling estimate has a request (claimEstimate refuses one without). Guarded so this stays total.
  if (estimate.request === null) return skip("input-too-large");
  if (!retryPromptFits(contract, estimate.request, failure.problems)) return skip("input-too-large");
  return { kind: "retry", problems: [...failure.problems] };
}

/**
 * Spec §4.3 size re-check: the retry prompt exactly as `prepare` builds it (singleCallPurposes.ts), through the frozen
 * tokenizer ratio and framing overhead, plus the frozen output bound, against the frozen window and the grant -- the
 * same arithmetic as buildBudgetEstimateRequest's queue-time check.
 */
export function retryPromptFits(contract: EstimateExecutionContractV1, request: BudgetEstimateRequestV1, problems: readonly string[]): boolean {
  const required = retryPromptRequired(contract, request, problems);
  // Tester round 2 spec §5.2.1: the window bounds the input; the grant does not.
  return required !== null && required <= BigInt(contract.estimatorCapabilities.contextWindowTokens);
}

/** The retry request's input + output bound in tokens (the `required` of the size re-check), or null when it cannot be sized. */
export function retryPromptRequired(contract: EstimateExecutionContractV1, request: BudgetEstimateRequestV1, problems: readonly string[]): bigint | null {
  if (contract.tokenizer.kind !== "utf8-upper-bound") return null;
  // Final-review M4: estimateTaskIds parses the request's plan snapshot; a snapshot it cannot read must not throw inside
  // the settlement's decision, so it counts as a prompt that does not fit (`input-too-large`).
  let taskIds: string[];
  try { taskIds = estimateTaskIds(request); } catch { return null; }
  const prompt = buildEstimatePrompt(contract.instructionVersion, canonicalBytes(request).toString("utf8"), { taskIds, retryProblems: problems });
  const { numerator, denominator } = contract.tokenizer;
  const serialized = (BigInt(Buffer.byteLength(prompt, "utf8")) * BigInt(numerator) + BigInt(denominator) - 1n) / BigInt(denominator);
  return serialized + BigInt(contract.framingTokenOverhead) + BigInt(contract.maxOutputTokens);
}

/** Spec §4.3: the retry's id is derived from the failed estimate, so a replayed settlement names the same row. */
export function estimateRetryId(groupId: string, failedEstimateId: string): string {
  return `estimate-${sha256Canonical({ groupId, retryOf: failedEstimateId }).slice(0, 24)}`;
}

/**
 * Spec §4.3 "What the retry is": a new queued estimate row that reuses the failed one's frozen slot, profile, mode and
 * request unchanged, its contract (the old one plus `retryProblems`) through persistEstimateArtifacts's writers, and a
 * `budget-estimate` wake. Called only after decideEstimateRetry said `retry`, inside the settlement transaction; the
 * caller reserves the grant. Not a command-ledger entry: the settlement's `estimate-result` receipt keeps it to one.
 */
export function writeEstimateRetry(store: ControlStore, groupId: string, failed: EstimateRecord, contract: EstimateExecutionContractV1, problems: string[], grant: Amount): string {
  const estimateId = estimateRetryId(groupId, failed.estimateId);
  const max = Number(store.db.prepare("SELECT MAX(estimate_version) AS n FROM estimates WHERE group_id=?").get(groupId)?.n ?? 0);
  const estimateVersion = max + 1;
  const retryContract = estimateExecutionContractSchema.parse({ ...contract, grant, retryProblems: problems });
  const estimate: EstimateRecord = {
    estimateId, estimateVersion, state: "queued", profile: failed.profile, mode: failed.mode,
    requestHash: failed.requestHash, request: failed.request, outputHash: null, output: null, reasonCode: null,
    grant: { ...grant }, estimatorSlot: failed.estimatorSlot,
    ...(failed.proposalVersion === undefined ? {} : { proposalVersion: failed.proposalVersion }),
    origin: { kind: "auto-retry", of: failed.estimateId, problems: [...problems] },
  };
  store.db.prepare("INSERT INTO estimates(group_id,id,estimate_version,state,body) VALUES (?,?,?,?,?)")
    .run(groupId, estimateId, estimateVersion, estimate.state, canonicalBytes(estimate).toString("utf8"));
  persistEstimateArtifacts(store, groupId, estimateId, { state: "queued", reasonCode: null, requestHash: failed.requestHash, request: failed.request,
    contract: retryContract, contractHash: sha256Canonical(retryContract), inputTokens: null, requiredRequestTokens: null });
  const planHash = failed.request!.planHash;
  store.db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,?,'budget-estimate',?,0)")
    .run(`scheduler-wake:${groupId}:estimate:${estimateId}`, groupId, JSON.stringify({ groupId, estimateId, planHash }));
  return estimateId;
}
