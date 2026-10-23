import { budgetBalance } from "./budget.js";
import type { BudgetAmount } from "./tokenPolicy.js";
import type { Amount } from "./types.js";

/**
 * Tester round 2 spec §4.3.1: the body transformation of `reopenProposal` (webService.ts), as a pure function over the
 * group, proposal and work-item bodies, so the schema 18 → 19 repair and the command path share one source. It never
 * throws on a deficit: the reserve comes from `budgetBalance` (round 2 N1), never `residual`. Mutates its arguments.
 *
 * Shapes are the stored JSON bodies; the caller has read them (and, on the command path, validated them).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Body = Record<string, any>;

export function reopenProposalBodies(group: Body, proposal: Body, works: Body[], commitments: Amount): void {
  const version = BigInt(proposal.proposalVersion) + 1n;
  if (version > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("numeric-overflow");
  proposal.proposalVersion = Number(version);
  proposal.state = "editable"; proposal.budgetMode = null; proposal.profiles = null; proposal.executionSnapshotHash = null;
  proposal.contextPolicy = { handoffAtContextTokens: null };
  for (const allocation of proposal.allocations as Body[]) allocation.state = "draft-encumbered";
  const { reserve, deficit } = budgetBalance(proposal.groupLimit as BudgetAmount, group.used as Amount, commitments);
  proposal.explicitUnallocatedReserve = reserve;
  const reserveRow = (proposal.allocations as Body[]).find(a => a.ownerKind === "reserve");
  if (!reserveRow) throw new Error("reserve-allocation-missing");
  reserveRow.amount = reserve;
  group.status = "draft";
  group.ledger = { ...group.ledger, committedRemaining: commitments, budgetDeficit: deficit };
  for (const work of works) {
    if (work.kind !== "task") continue;
    work.status = "draft"; work.derivedContractHash = null;
    // Agent selection spec §6.4: a reopened proposal has no frozen selection; the next confirmation freezes one.
    work.configHash = null;
    for (const key of ["agent", "agentProvenance", "timeoutMs", "killGraceMs", "agentCapabilities"]) delete work[key];
    const allocationOf = (bucket: string) => (proposal.allocations as Body[]).find(a => a.ownerId === work.workItemId && a.bucket === bucket);
    const workAmount = allocationOf("work"), handoffAmount = allocationOf("handoff");
    if (!workAmount || !handoffAmount) throw new Error("task-allocation-missing");
    work.grant = { work: workAmount.amount, handoff: handoffAmount.amount };
  }
  group.reconcileSlot = null;
  // Integration spec §3.2: the approval was the confirmation; the next one approves the scheme again.
  if (Object.hasOwn(group, "integration") && typeof group.integration === "object" && group.integration !== null) group.integration = { ...group.integration, frozen: false };
}

/**
 * The group-body half of `saveWebAuthority` (webService.ts): the goal-review mirror, the proposal mirror, the limit, the
 * reservation and the ledger mirror, from the proposal. Pure; the caller writes the rows (and the token policies).
 */
export function mirrorWebAuthority(group: Body, proposal: Body): void {
  const review = (proposal.allocations as Body[]).find(a => a.ownerKind === "goal-review");
  if (!review) throw new Error("goal-review-allocation-missing");
  group.reviewReserve = review.amount;
  if (["draft", "ready"].includes(group.status)) group.reviewRemaining = review.amount;
  group.proposal = { state: proposal.state, proposalVersion: proposal.proposalVersion, planHash: proposal.planHash, budgetMode: proposal.budgetMode, contextPolicy: proposal.contextPolicy, profiles: proposal.profiles, executionSnapshotHash: proposal.executionSnapshotHash };
  group.limit = proposal.groupLimit;
  group.reserved = group.ledger.committedRemaining;
  group.ledger = { ...group.ledger, groupLimit: proposal.groupLimit, used: group.used, explicitUnallocatedReserve: proposal.explicitUnallocatedReserve };
}
