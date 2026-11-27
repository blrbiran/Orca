import { add } from "./budget.js";
import { readFundedAllowance } from "./fundedAllowance.js";
import { readWork } from "./queries.js";
import { readRunBody } from "./stopIntent.js";
import type { ControlStore } from "./store.js";
import { remainingBudget, type BudgetAmount } from "./tokenPolicy.js";
import type { Amount } from "./types.js";
import { lineageWorkUsage } from "./usageSettlement.js";
import { topUpSum, withTopUp } from "./workTopUp.js";

export interface RetryFunding {
  authored: BudgetAmount;
  inherited: Amount;
  fresh: BudgetAmount;
  perAttemptTokens: number | null;
}

/** The task's remaining budget after lineage use. Group headroom may fund less. */
export function retryFundingOf(store: ControlStore, groupId: string, taskId: string, runId: string, incoming: Amount | null = null): RetryFunding | null {
  const run = readRunBody(store, runId);
  const work = readWork(store, groupId, taskId) as unknown as { grant: { work: BudgetAmount } };
  const funding = readFundedAllowance(store, run as never);
  if (funding === null) return null;
  const authored = withTopUp(work.grant.work, add(topUpSum(store, groupId, taskId, null), incoming ?? { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 }));
  const inherited = add(funding.inheritedUsage, lineageWorkUsage(run));
  return { authored, inherited, fresh: remainingBudget(authored, inherited), perAttemptTokens: inherited.attempts > 0 ? Math.ceil(inherited.tokens / inherited.attempts) : null };
}
