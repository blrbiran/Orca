# Plan: soft mode for loop runs -- the Orca half (spec 2026-11-06 recommendation (d))

Session 86352010, implementer subagent, branch `feat/soft-loop-settlement-orca`, written on Orca main `fa593909`.
Spec: `docs/superpowers/specs/2026-11-06-soft-mode-loop-run-settlement-design.md` §3.2 (Orca bullets), §3.3-§3.6,
criteria O1-O18 of §3.7, with §6 (the human's answers) overriding the text above it. Not here: the ccloop half (C1-C6,
another agent) and O19 (needs the new ccloop pinned).

## Readings the spec left to the plan (each read at `fa593909`)

1. **"Authored" task budget (§6 Q2, O3b).** The field read is the task's work allocation in the group's budget proposal:
   `readBudgetProposal(store, groupId).allocations` row `{ownerKind:"task", ownerId:taskId, bucket:"work"}`, its
   `amount.tokens` and `fieldProvenance.tokens.provenance` (schema `src/control/webProtocol.ts:474-479`, enum
   `complex-1m-default | model | human | system`). Writers: import writes `complex-1m-default` with the plan contract's
   `executionPolicy.tokenBudget` (`src/control/planImport.ts:331-333`), an estimate writes `model` with its estimateId
   (`src/control/webService.ts:2190`, `src/control/budgetSuggestions.ts:104`), a person's proposal edit writes `human`
   (`webService.ts:2189`, `:492`). **Authored = `amount.tokens !== null` and provenance is not `model`.** A model-sized grant is
   Orca's (follows the group, as parent D2); a null grant is no limit. Conservative edge: a legacy carry's default 1M
   (`planImport.ts:331`, provenance `complex-1m-default`) counts as authored, i.e. keeps today's person path.
2. **The row's `client`/`principal` (§2 (d) "[unverified; read in the plan]").** Rows of in-panel `orca-auto` commands
   today record `client` and `principal` NULL: `persistCommandOutcome` reads them from the async command context
   (`src/control/commandLedger.ts:310`), and `autoStartPass` / failover send with no context (`orchestration.ts:281`).
   A NULL principal cannot back the marker, so the pass writes its row inside
   `withCommandContext(id, { client: "panel", principal: "orca-auto" })`; `panel` is the `via` Orca already names an
   in-process command (`commandAttributionFor`, `src/control/commandClient.ts:69-71`). ccloop's receipt therefore reads
   `{ principal: "orca-auto", client: "panel", verb: "settle-approximate-usage", commandId, result }`.
3. **§3.4 recovered optional-v1 ([unverified] how the person path satisfies `retryTask.ts:120-121`).** It does not: the
   person path zeroes `remaining` and leaves the allocation amounts at the grant, so `held` at `retryTask.ts:132-134` is
   false and retry-task refuses (`run-state:settled-recoverable`). A recovered optional-v1 run is continued by
   resume-from-handoff, as a known-usage recoverable stop is (`terminaliseRun`, `src/control/stopIntent.ts:966-971`:
   `releaseCommitment(remaining)`, allocations `held` with amounts unchanged, task `held`, `fundingReleased`). **Chosen:**
   mirror that known-usage state -- `used += F`, the run's whole pre-booking remainder released from `reserved` (the person
   path's `reserved -= charged` releases the same amount), allocations `held` unchanged, task `held` + `fundingReleased`.
   The spec's "`reserved -= min(F, held)`; allocation amounts = `run.remaining`" would leave `held - F` reserved by nothing.
   O10 is restated: reserved/used as above, allocations unchanged, resume-from-handoff continues.
4. **§3.4 finite-legacy with `limit.tokens === null` ([unverified] reachable?).** Reachable: `setGroupLimit` keeps a
   group's `finite-legacy` mode when its limit is set to null (`src/control/commands.ts:89`), and `hasTokenPolicy` admits a
   null ceiling with a null policy row (`src/control/fundedAllowance.ts:28-33`). O11 is built.
5. **D4 cutoff on `endedAt` (§3.6).** A failed run blocked at C is `state: "blocked"`, which never gets `endedAt`
   (`noteRunWrite`, `src/control/activity.ts:125-127`: only ended states stamp it). A cutoff on `endedAt` alone would leave
   every `committed` run (O1's shape) for a person. **Chosen:** the run's stop time is `endedAt` when present, else the
   `at` of its first `run-blocked` activity row at step C; a run with neither is skipped (before schema 9). The cutoff lives
   in `meta` key `softLoopSince`, written once (`INSERT OR IGNORE`) when the panel assembles (`controlAssembly.ts`). No
   cutoff row ⇒ the pass settles nothing (a store the new version never started on).
6. **Where it runs.** The driver round, after the runs are advanced and before the exports
   (`createExecutionDriver` pass, `src/control/executionDriver.ts`), loaded with `await import()` (import-cycle rule, as
   `groupDone.js`). Claims are the pump's (`deliverSchedulerWakes`); a settled run kicks the pump.
7. **Evidence recheck (§3.3 step 3).** The pass's preflight admission, evidence read and ledger transaction run in one
   synchronous stretch (no await between them), and the apply re-reads admission and proof inside the transaction, so
   there is no window for an "evidence changed" recheck to guard. O13 is therefore the person's race (pass inside the
   person's `afterEvidence`), defended by the person path's in-transaction admission.

## Tasks

1. Protocol: verb `settle-approximate-usage` (enum, raw/effective unions, payload `{taskId, runId, generation}`), result
   method `approximate-floor`; `VERB_ACCESS` `panel`; `ESCAPE_HATCH_ONLY`; generated CLI docs; escape-hatch reference.
2. Marker: `usageSettlementSchema` third branch; `hasValidUsageSettlement` branch; `lineageWorkUsage`.
3. Settlement tail shared by the person path and the pass (`settleUnknownUsage.ts`), then `softLoopSettlement.ts`:
   scope, preflight classification, apply per disposition, the pass.
4. Hooks: `softLoopSince` (leaf module), panel assembly, driver round.
5. Views: refusal of the automatic attempt on the run view; web marker wording, TaskDetail activity, types, locales.
6. Criteria file `tests/control/softModeLoopRunSettlement.test.ts` and `tests/control/approximateFloorMarker.test.ts`.

## Criteria → mutation (spec §3.7 with §6; mutations in a `git clone --local` copy)

| # | Mutation |
|---|---|
| O1 | `approximateUsageApplies` false for task runs; separately, delete the pass call in the driver |
| O2 | write `floorTokens: 0` for a null floor |
| O3 | drop the `limit.tokens === null` check |
| O3b | drop the authored-budget check |
| O4 | skip each validator check in turn (seven) |
| O5 | remove the validator branch |
| O6 | let `recovered` subtract for `approximate-floor` |
| O7 | delete the `run-usage-settled` guard in `settlementAdmission` |
| O8 | book `max(F - B, 0)` |
| O9 | release reserved for `released` |
| O10 | leave the pre-booking remainder reserved (release only `min(F, held)`) |
| O11 | park the pre-booking remainder |
| O12 | remove both the row-exists skip and the `run-usage-settled` skip (each alone is covered by the other) |
| O13 | drop the person path's in-transaction admission |
| O14 | issue the command without preflight admission |
| O15 | add `approximateUsageApplies` to the validator |
| O16 | do not issue the command on a permanent code; separately, drop the row-exists skip (second pass throws) |
| O17 | drop the `mode`/`recoveryOf` check |
| O18 | drop the cutoff |
