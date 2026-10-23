import { canonicalBytes } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { readBudgetProposal } from "./queries.js";
import type { ControlStore } from "./store.js";
import type { Amount } from "./types.js";

/** Tester round 2 spec §4.2.5 (D11): the dimensions an estimate overrun grows the group's limit in. Tokens are never grown. */
export const NON_TOKEN_DIMENSIONS = ["activeMs", "attempts", "sessions"] as const;
export type NonTokenDimension = (typeof NON_TOKEN_DIMENSIONS)[number];
/** One growth step, append-only on the group body (`estimateOverrunGrowth`). */
export interface EstimateOverrunGrowth { runId: string; eventSeq: number; dimension: NonTokenDimension; amount: number; at: number }

/**
 * Spec §4.2.5 (controller, round 2 N3): an estimate run's non-token cumulative past its grant grows the group's limit by
 * the excess not grown before, in the transaction that books it -- `group.limit`, the ledger mirror and the proposal's
 * `groupLimit` kept identical (stopIntent.ts and queries.ts refuse a mismatch). So an estimate overrun never becomes a
 * non-token deficit. Every path that books an estimate run's cumulative calls this; any other run is left alone.
 * Mutates `group` (the caller saves it) and writes the proposal row.
 */
export function growForEstimateOverrun(store: ControlStore, group: { groupId: string; limit: Record<string, number | null> } & Record<string, unknown>,
  run: { runId: string; phase?: unknown; grant: { work: Pick<Amount, NonTokenDimension> }; cumulative: { work: Amount } }, eventSeq: number, at: number): void {
  if (run.phase !== "estimate" || !Object.hasOwn(group, "planHash")) return;
  const prior = Array.isArray(group.estimateOverrunGrowth) ? group.estimateOverrunGrowth as EstimateOverrunGrowth[] : [];
  const entries: EstimateOverrunGrowth[] = [];
  for (const dimension of NON_TOKEN_DIMENSIONS) {
    const excess = run.cumulative.work[dimension] - run.grant.work[dimension];
    if (excess <= 0) continue;
    const grown = prior.filter(e => e.runId === run.runId && e.dimension === dimension).reduce((sum, e) => sum + e.amount, 0);
    if (excess > grown) entries.push({ runId: run.runId, eventSeq, dimension, amount: excess - grown, at });
  }
  if (entries.length === 0) return;
  const proposal = readBudgetProposal(store, group.groupId);
  const grow = (limit: Record<string, number | null>, dimension: NonTokenDimension, amount: number) => {
    const next = BigInt(limit[dimension] ?? 0) + BigInt(amount);
    if (next > BigInt(Number.MAX_SAFE_INTEGER)) throw new ControlError("numeric-overflow");
    limit[dimension] = Number(next);
  };
  for (const entry of entries) { grow(group.limit, entry.dimension, entry.amount); grow(proposal.groupLimit as Record<string, number | null>, entry.dimension, entry.amount); }
  const ledger = group.ledger as { groupLimit?: unknown } | undefined;
  if (ledger !== undefined) ledger.groupLimit = { ...group.limit };
  group.estimateOverrunGrowth = [...prior, ...entries];
  store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id=?").run(canonicalBytes(proposal).toString("utf8"), group.groupId);
  // The stored body moves with the proposal now, so a proposal read later in this transaction (syncWebBudget) finds the
  // mirror equal; the caller's save writes the rest of its changes over it.
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), group.groupId);
}
