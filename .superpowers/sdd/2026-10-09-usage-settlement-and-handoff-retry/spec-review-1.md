# Spec review 1 — new usage settlement and handoff retry draft

Owner: Codex subagent `/root/review_usage_design`, 2026-10-09 (Asia/Shanghai). Observation commit: `c29676d6d0050d46b9cf61f45ffaee583f9dec76`, measured with `rtk proxy /usr/bin/git rev-parse HEAD`. Reviewed draft: `docs/superpowers/specs/2026-10-09-usage-settlement-and-handoff-retry-design.md`. This reviews the new draft only; completed issue-fixes work is not reopened. No human ruling is signed here. No cost estimate is available.

## Critical

None found.

## Important — required corrections within the approved D9/M3 scope

1. **D9 zeroing the task allocation breaks the frozen execution snapshot, and existing active retry does not restore it.** Draft §4 step 2 changes the task allocation amount to zero while preserving ownership state. `src/control/executionSnapshot.ts:frozenAllocationShape` (line 313) ignores mutable amounts only for held/continuing/terminal allocations. Normal failed tasks retain confirmed allocations. Both `readConfirmedTaskExecution` (323) and `src/panel/controlViews.ts:validateExecutionSnapshot` (422) compare confirmed allocations exactly against the immutable snapshot, so an otherwise successful settlement makes the group view fail with execution-snapshot-identity. `src/control/retryTask.ts:applyRetryTask` re-reserves work.grant but does not restore allocation amounts; `webService.ts:assertKnownConservation` (220) then counts zero allocation for ready work against the nonzero reservation. Required: specify the exact allocation invariant through settlement and active retry. Simplest proposal: leave task allocation amount/state unchanged at settlement, as recordUsage already does; update run remaining/cumulative and all group/reserve mirrors. This is a proposal, not a new human decision.

2. **M3 marking the restored claim grant confirmed is incompatible with failed continuations.** Draft §5 correctly restores the failed run's own claim grant, rather than its newly parked remainder. That claim grant can itself be smaller than the original confirmed snapshot: `stopIntent.ts:terminaliseRun` (746) parks remaining as work.grant and `webDispatch.ts:createStartingRun` (322) claims that smaller grant for the continuation. After that continuation fails and is handed off, restoring its smaller run.grant while setting allocations to confirmed reactivates exact frozen-amount comparison and prevents view/A2 reads. Required: define a live allocation lifecycle that accepts the legitimate reduced grant without rewriting the immutable snapshot/derived contract. The controller's proposed new retrying allocation state is coherent; make it amount-exempt in frozenAllocationShape while checking exact live allocation == work.grant and current failed predecessor identity before claim. It must remain compatible after claim and repeated retries; resetting the smaller allocation to confirmed at claim recreates the failure. Reusing held/continuing would misdescribe ownership. Uniform retrying state for both branches is reasonable but not inherently required for an untouched original confirmed grant.

## Minor — spec precision / UI proposals

3. **Name the settlement read data explicitly.** `webProtocol.ts:runViewSchema` (1189) and `controlViews.ts:runViews` expose only the current phase's used/remaining, and no per-run unknown flags or settlement marker. The D9 confirmation requires both buckets in all dimensions and eligibility/settlement status. Specify an additive server-derived preview/read shape with both amounts and settlement marker, so the UI cannot infer the charge from the wrong allocation or phase. Existing owner permission enforcement (`panel/permissions.ts:permissionRefusal`, `panel/controlApi.ts` route guard) is an appropriate authorization boundary; actorId/acknowledge must remain insufficient.

4. **Clarify failed-task continuation discoverability.** The current `ControlGroupView.tsx:continuableRuns` / selections() includes every continuable held checkpoint, including a failed run, in the batch Continue action. Merely expanding the Retry predicate does not change that batch. The spec already selects the empty-selection resume path for M3; explicitly describe how it is discoverable beside the batch action, and whether failed runs remain an optional continuation or are excluded from the recommended batch. Do not silently broaden the scope by removing a previously supported continuation path.

## Checked contracts / limits

- Charging both complete remaining buckets and all four dimensions preserves remaining == max(grant - cumulative, 0), including existing overages; unattributed token rows can use the existing usageSource without inventing model/provider counts. groupUsageUnknown already recomputes across historical runs and pending events; settlement must call it with the updated run or persist that run first.
- Idempotent original event replay before the settlement marker rejection matches recordUsage's existing order. Schema 10 plus a strict optional marker is compatible with old records and lets schema 9 readers refuse the store; migrateSchema and the store preflight must both explicitly admit v9 for the new upgrade.
- M3 cleanup can reuse stepCleanupFailed: stepC saves report:<run> before marking a terminal failure; closeBlocked hands off from savedReport, and H-settle preserves that report. Preserve it and endedAt; do not replace it with the rewritten partial checkpoint's outcome.
- The excluded failure → handoff with unknown usage → settled-unrecoverable/handoff-partial path does not acquire a recovery route in this draft. This is an explicit scope limit, not a request to relax stop/resume guards. UI wording must not imply D9 repairs every stopped unknown run.
- Read-only source inspection only; no product/test mutation, test suite, real user data, paid provider, commit, push, merge, or deletion performed. Relevant references were measured with rtk rg -n and source reads at the observation commit.

**Ready for human spec review: No**, until the two required allocation corrections are incorporated. Re-review the revised new draft before the implementation plan.

## Citation correction — same reviewer, 2026-10-09, same observation commit

Final `rtk rg -n` measurement: validateExecutionSnapshot starts at controlViews.ts:423 (not 422); createStartingRun starts at webDispatch.ts:323 (not 322). These correct only the source locations above, with no finding change. Other agents' handoff/spec writes visible in the final git status were not made by this reviewer.
