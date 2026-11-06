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

## As built (session 86352010, implementer subagent)

Commits on `feat/soft-loop-settlement-orca` (base `fa593909`): `8c09d592` feature, `a074250b` O16 admission case,
`539457e3` O4/O10/O11 criteria fixes (see mutations below). Not merged, not pushed.

### Decisions (each reversible; reported for review)

1. Authored task budget = task work allocation `amount.tokens !== null` and `fieldProvenance.tokens.provenance !== "model"`
   (plan reading 1); a missing allocation reads as authored. Consequence with §6 Q6: the only loop runs whose
   approximate settlement ccloop will accept for saved-result recovery are **estimator-sized finite** codex grants
   (null grant ⇒ ccloop refuses on the null ceiling; authored finite ⇒ person path).
2. Row context `{ client: "panel", principal: "orca-auto" }` (plan reading 2). **ccloop's receipt branch must accept
   `client: "panel"`** -- told to the controller for the ccloop agent.
3. Recovered optional-v1 releases the whole pre-booking remainder (plan reading 3), diverging from §3.4's row; O10 restated
   (resume-from-handoff continues, not retry-task).
4. Cutoff measured on `endedAt`, else the first `run-blocked` at C (plan reading 5); no cutoff row ⇒ the pass is off.
5. Evidence read and apply in one synchronous stretch, no recheck (plan reading 7).
6. Transient preflight codes: the spec's three plus `group-archived` (an archived group would otherwise book a permanent
   refusal that survives unarchiving).
7. Refusal visibility: `unknownUsageSettlement.approximateRefusal` (the refused row's error code) on the run view, shown by
   `UsageSettlement.tsx` as "Orca could not settle the usage automatically: <code>".
8. Activity `reason` = the run's `drive.blockedReason`, else `failureCode`, else `usage-unknown`.
9. Not done: §3.5's last bullet (a person's refusal reading "settled approximately by Orca"): the refusal code stays
   `run-usage-settled` with the existing wording. Open item.

### Criteria and mutations (clone `scratchpad/sloMut2`, runner `scratchpad/slo-mutate.py`, logs `scratchpad/slo-mut/`; every restore `git diff` 0 bytes)

Files: `tests/control/softModeLoopRunSettlement.test.ts` (15 cases), `tests/control/approximateFloorMarker.test.ts` (6).
Red line = the first failing assertion vitest reported.

| # | Mutation | Result |
|---|---|---|
| O1 | `approximateUsageApplies` false for task runs / pass call deleted | red, both at softModeLoopRunSettlement.test.ts:30 (marker) |
| O1 (row context, controller request) | apply without `withCommandContext` | red :32 (row `client`/`principal` null; the marker at :30 stays green) |
| O2 | `?? 0` for a null floor | red :43 |
| O3 | limit check dropped | red :69 |
| O3b | authored check dropped | red :83 |
| O4 | usageApproximate check / charge check / principal `z.string()` / row principal / row verb / branch on row verb | red :32, :40 (after fix `539457e3`; first run green because the forgery also moved cumulative), :36, :41, :42, O4 second case |
| O5 | validator branch removed | red :58 (`recovery-blocked:run-usage-settlement`) |
| O6 | recovered subtracts | red :68 |
| O7 | `run-usage-settled` guard deleted | red (code `run-usage-not-unknown`) |
| O8 | `max(F - B, 0)` | red :56 |
| O9 | committed reserve rule applied always | red :101 |
| O10 | release only `min(F, held)` | red :117 |
| O11 | park the pre-booking remainder | red :136 (after `539457e3`; first run green: fixture floor was 0) |
| O12 | row-exists skip removed / candidate filter removed / both | green / green / red (`command-id-conflict`). Two independent guards; each alone is covered by the other |
| O13 | person's in-transaction admission removed | red (code `run-usage-not-settleable` instead of `run-usage-settled`; still refused: evidence-changed is the second layer) |
| O14 | candidate filter removed / preflight removed | red :179 / green (the filter excludes a settled run first) |
| O15 | `approximateUsageApplies`-like limit check in validator | red approximateFloorMarker.test.ts:90 |
| O16 | proof preflight skips / permanent admission code skipped / row-exists removed | red :190 / red :210 / red (`command-id-conflict`) |
| O17 | mode/recoveryOf check dropped | red :221 |
| O18 | cutoff dropped | red :232 |

Environment note: in the O4g run `tests/setup/relocateUserData.ts` also reported a change in the real `~/.orca`
(`control/panel/control.sqlite` and `panel/logs/*` sizes): the user's live panel writing its own files during the run,
not the test (it opens only temp stores). Recorded, not suppressed.

### Rewrites (Ruling: 「这次批准改写所有必要的判据。」)

- `tests/commands/verbCoverage.test.ts`: the escape-hatch list gains `settle-approximate-usage`.

### Open items

- **O19** (needs the new ccloop pinned). The case to add to `tests/control/savedResultRecovery.paired.test.ts`, run with
  `ORCA_SAVED_RESULT_VERIFY=1 npx vitest run tests/control/savedResultRecovery.paired.test.ts`: a codex run whose task
  grant is estimator-sized finite (provenance `model`) in an unlimited group fails with unknown usage; `since(t)` and
  `softLoopSettlementPass` book it; `readSavedResultEligibility` answers `eligible`. Mutation: the old pin ⇒
  `saved-result-evidence-invalid`.
  Non-merged-gate attempt (controller's suggestion, ccloop 32163ed): not run. `savedResultWorld`
  (`tests/control/fixtures/savedResultWorld.ts:27`) throws `saved-result-integration-prerequisites-missing` unless
  `ORCA_SAVED_RESULT_OLD_ORCA_ROOT`, `ORCA_SAVED_RESULT_OLD_CCLOOP_ROOT` and `ORCA_SAVED_RESULT_CCLOOP_BIN` are set; the old
  Orca and old ccloop roots it needs are not prepared in this session's scratchpad, and the fixture always books a
  person's settlement (`:89-90`), so the case also needs a `settle: "none"` fixture option. Left for the repin round.
- §3.5 refusal wording (decision 9).

### Gate (Rule 18; never `npm run verify`)

- Rebased on main `efc789b7` (controller's message; no migration on this branch). `npx tsc --noEmit -p tsconfig.json`
  rc 0, `-p web` rc 0, `npm run gen:cli-docs` idempotent (0 files changed on the second run).
- Final gate, `node scripts/test-affected.mjs --base main > scratchpad/slo-gate2.txt 2>&1` at `4b278c81`: 823 files selected
  (642 root, 181 web); root 4 failed | 638 passed files (4 failed | 5555 passed | 32 skipped tests), web 181/181
  (1666 tests), rc 1. The four reds -- `driverReconcileN` (hook timeout), `multiDirDue` (driver deadline), `schedulerBridge`
  (timeout), `flow/startForm` (`fetch failed`) -- each ran alone on the branch and on a fresh `git clone --local` at main
  `efc789b7`, alternately: 8/8 green (load 12-35; `scratchpad/slo-rerun2-summary.txt`). Classified as load.
- First gate at `8c09d592` (pre-rebase, `scratchpad/slo-gate1.txt`): root 31 failed files, web 23. One real red,
  `tests/control/archiveGroup.test.ts` (the archive walk did not cover the new verb), fixed in `4b278c81` with a Ruling
  line. Eight suite-level reds were `tests/setup/relocateUserData.ts` reporting the user's live panel growing its own
  `~/.orca/control/panel/control.sqlite` and logs during the run; the rest were timeouts. 33 of those files were rerun
  alone on both trees before the rebase (`scratchpad/slo-rerun-summary.txt`): all green on the branch, `schedulerBridge`
  once red on main.
