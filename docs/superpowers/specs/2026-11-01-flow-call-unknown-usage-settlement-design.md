# Settling a flow call whose usage is unknown

Who: Claude Code session `663fb68e`, 2026-11-01. Human ruling: 「Q3 a」 (design only; implementation waits for the decisions in §6). Extends `2026-10-27-single-call-unknown-usage-settlement-design.md`, which left flow calls out (its R1).

## 1. The hole

A flow call (`flow-draft`, `flow-review`, `flow-ask`, `rerun-proposal`, `feedback-triage`, a flow `clarify` step's `clarify`) that ends with unknown usage is blocked at C with `flow-call-usage-unknown[:<failure>]` (`executionDriver.ts` `stepCSingleCall`). Today nothing can move it:

- `settleableSingleCallBlock` refuses any run with `flowCall`, and `SETTLEABLE_USAGE_UNKNOWN_REASONS` has no flow purposes.
- The combined clarify handler's evaluation throws `run-usage-not-settleable: flow-call` (`singleCallPurposes.ts`).
- `FlowRunPage.tsx` shows nothing about it: `unknownReason` reaches the spend line, but there is no action. A stop is the only way out.

The parent group's `usageUnknown` flag stays set, and the execution waits on a call that will never answer.

## 2. Shape: reuse the requirement path

Same command, same arithmetic: run-scoped `recovery-retry` with `acknowledge: "charge-remaining-grant"`, owner only, through `settleSingleCallUsageInTransaction` and `chargeRunRemainder`. No schema change: `run.singleCallSettlement` already holds the marker, and `flow_runs.body.draws` holds the draw.

Rule 5 holds: no model call in any of this.

## 3. Order inside the transaction

For an open block (not closed by a stop):

1. Refusals as today: owner, stop intent, pending usage, usage not unknown.
2. `chargeRunRemainder` books the remaining grant as used and takes it out of `reserved`.
3. Recompute the parent's flag (`syncWebBudget`, `src/control/budget.ts`). It has three branches: a clarifying group goes to `syncRequirementLedger`; a group with no `planHash` returns without doing anything; the rest recompute and also read `budget_proposals`. A flow parent (`status: "flow"`, no `planHash`, `src/flow/parent.ts`) takes the no-op branch, so reusing this call would leave its ledger as it was. The flow branch sets `ledger.usageUnknown` from `groupUsageUnknown` and syncs `used` and `committedRemaining` itself. **The first criterion to write**: the parent's `usageUnknown` is false after settlement, read back from the store. Whether a stored flow parent's flag was ever set to true is not established; a child-side reader may use `groupUsageUnknown` directly, so check its readers when implementing.
4. `resumeBlockedDriverRun`, then `FLOW_CALL_HANDLER.complete`'s core, split out as `completeInTransaction`: `commitTerminal`, `verifyStoppedSingleCall`, `assertCallUsageBooked`, `giveBack`, `storeResult`, `closeSingleCall`.
5. `storeResult` hands the kernel `{ failure: "flow-call-usage-unknown" | <ccloop's failure> }`. The output is never trusted: usage unknown means the call did not finish cleanly. The kind's `collect` then applies its own retry rule on the next pass.

For a block a stop already closed: charge only (`releaseReserved: false`), no `complete`, and no wake for a stopped run. `interruptFlowCall` already told the execution and gave the grant back.

## 4. The pool: the part the requirement path does not have

`giveBack` calls `returnUnspent(pool, drawId, spent = run.cumulative.work.tokens)`. After a settlement `cumulative` may not include the charge, so the pool would get the whole draw back and could fund more work than the person agreed to. **Rule: a settled call returns nothing to the pool**, since the charge is the claim that the grant was spent. So `spent` is `max(cumulative, drawn)` when `run.singleCallSettlement` is set. A criterion must pin `pool_drawn` unchanged after settlement, with a mutation that restores `cumulative`.

`interruptFlowCall` has already returned the draw for a closed block, and `returnUnspent` returns once by design. So a call closed by a stop and then settled has returned its draw while the parent's `used` grows by the charge: the pool and the parent's ledger disagree by that amount. The ledger is the honest one, and the pool only decides further draws. Accept and name it in the marker's activity row; do not add a "take back" path for one edge.

## 5. Panel

`FlowRunPage` execution row: when the call's run offers settlement, show the existing `ChargeRetry` component's content (amount, observed floor, confirmation text) in the row, keyed on the same read-model fields: `singleCallUsageLowerBound`, `singleCallSettlement`. `plan` and `@feedback` calls show it in their own places; if that grows the change, they can follow, because stopping the run stays available.

Also add to `orca recovery retry`'s help that flow calls are accepted. The CLI path needs no other change.

## 6. Decisions for the human

- **D1. Should flow default to soft, like groups and tasks?** Flow pools are always a finite integer (`src/flow/kernel.ts`: start argument, settings, template, `DEFAULT_TOKENS_PER_RUN`); group and task defaults are the unlimited soft mode. (a) keep finite, (b) default soft. ➡️ (a). The pool is what stops an unattended flow, and flows run unattended by design. A settled call charges a bounded amount because the grant is bounded. Soft would remove both limits for this one case, and it is a separate decision from this hole. The cost of (a): a person can still park on `flow-pool-exhausted` and has to raise the pool.
- **D2. Settlement grant size.** A call's grant is `min(REQUIREMENT_CALL_GRANT.tokens, what remains)`, so settling charges up to that. ➡️ Accept; the panel says the amount before the click.

## 7. Criteria (write first; each needs a mutation seen red)

1. A blocked flow call settles, and the parent's `usageUnknown` clears.
2. The execution then fails with the block's failure, and the kind's retry rule runs on the next pass.
3. `pool_drawn` is unchanged after settlement; the mutation restores `spent = cumulative`.
4. A member, and an unauthenticated socket, are refused.
5. A stop-closed call charges `used` only and neither wakes nor completes.
6. The output of a settled call never reaches `collect`.
7. A settled `rerun-proposal` and a settled `feedback-triage` each take their own failure path (`rerun.ts`, `feedback/intake.ts`).

## 8. Not in scope

Auto-settlement from the observed floor (a floor can under-count; spec 2026-10-27 D3). Changing how `flow-pool-exhausted` parks.
