# Task 7 funding preflight — advisory only

Read-only source investigation, 2026-10-11. No product edits, tests, builds, provider calls, controller rulings or ledger changes. Orca references below are relative to `/private/tmp/orca-feedback-followup-20261011` (HEAD observed `de117b2`); ccloop budget references are immutable `367066b`, with old-producer references explicitly `5b0adea`. Active Task6 files were not read or changed. Final Task6 recovery schema/runtime mapping remains an integration dependency, not a verified interface here.

## Recommendation

Use a genuinely migrated finite-legacy source, with owner-authorized group reserve in **all four dimensions before its first execution**. Perform the real old-worker failure and real owner remaining-grant settlement, then admit a fresh fixed grant through ordinary transaction/exclusion/cap rules. Carry the full settled source work as inherited usage in the new v4 recovery identity, but do not subtract it again from a legacy per-run grant.

A recovery-specific **derived funded total** `T = I + F` is a sound representation of inherited accounting `I` plus newly reserved work allowance `F`; it is neither a new charge nor a replacement for the historical authored policy. It is permitted in principle by recovery spec §6 (“fresh funded limits”), §6.3 (separate frozen/runtime contract identity), and token-policy §6.6 (do not subtract legacy current authority by inherited usage again). Existing normal optional allowance persistence is NOT a ready-made representation for this. A Task7-specific typed record/validation path is needed if the final Task6 boundary consumes cumulative totals.

Do not silently place `I.tokens + F.tokens` in a field that still means the task's authored cumulative token ceiling. Keep the old finite policy and frozen source bytes, the fresh claim grant, and the derived recovery funded total as distinct facts. Exact wire placement must be checked against final Task6 code before implementation.

## Source facts and equations

Let `d ∈ {tokens, activeMs, attempts, sessions}`, `b ∈ {work, handoff}`, `G_b` be the old claim grant, `B_b` the last known run-local cumulative observations before settlement, and `S_b` the actual owner's settlement charge. All finite arithmetic must remain safe integers.

```
S_b[d] = max(G_b[d] - B_b[d], 0)
C_b[d] = B_b[d] + S_b[d] = max(B_b[d], G_b[d])
old.remaining_b[d] = 0
I = sum(prior eligible lineage runs' C_work)       // each run exactly once
F = newly authorized and actually reserved work grant
H = newly authorized and actually reserved handoff grant
T[d] = I[d] + F[d]                                // finite legacy
V = new run-local observed usage
recovery cumulative presentation = I + V
new controller usage booking = V                  // never I + V
remaining recovery funded allowance = max(F - V, 0)
                                      = max(T - (I + V), 0)
```

Settlement charges **both buckets and every dimension**, even when handoff actually used zero. A raw executor token observation is diagnostic and is not `S`, `C`, or permission to rebook. If old observed usage overshot a grant, `I` contains that overshoot; assuming `I = G_work` without checking observations is wrong. Sources: `settleUnknownUsage.ts:27–47,69–94`; `usageSettlement.ts:90–125`; recovery spec §6.8, lines77–81.

For optional cumulative accounting with authored work ceiling `A`:

```
L = remainingBudget(A, I)
F.nonToken = L.nonToken
F.tokens <= L.tokens and all applicable group/cap headroom
any L[d] == 0 => refuse authored-budget-exhausted
```

The existing retry branch refuses **any** exhausted dimension (`retryTask.ts:118–129`); `remainingBudget` is dimension-wise (`tokenPolicy.ts:16–19`). With a standard optional source, its funded non-token grant already equals its remaining authored non-token allowance. Charging that whole grant makes those cumulative dimensions exhausted. Raising only a token cap, even with task tokens null, cannot produce a positive retry. Preserve this refusal; do not reset inherited counts or expand authored task limits after the failed source to manufacture eligibility.

For legacy accounting, `F` is the current full fixed work grant and `H` its handoff grant. The retry path checks group spare against full grant minus released remainder, then reserves that full grant (`retryTask.ts:131–149`). After complete remaining-grant settlement the remainder is zero, so fresh spare must cover `F + H` in every dimension. Token-policy spec §6.6, line77 explicitly preserves this per-run authority. `fundedAllowance.ts:77–90` also treats legacy demand as fixed, with zero inherited deduction for ordinary allocation.

Group and cap invariants at the fresh claim:

```
new group committed = existing other committed + F + H
old charged group usage stays unchanged
used + committed <= authored group limit                 // every dimension
fresh token commitment = F.tokens + H.tokens
fresh token commitment <= every applicable current cap headroom
```

If ordinary retry already pre-reserved `F + H`, creation must consume that exact allocation rather than reserve twice. `webDispatch.ts:209–280` rechecks caps and awaited capability evidence in a fresh transaction; `createStartingRun` at364–430 freezes grant/claim, writes canonical envelope/outbox, and updates membership. It is private, so extract/reuse its transactional primitive with recovery identity rather than inserting handmade run/claim rows. Do not issue an ordinary retry first and later decorate its already-dispatchable normal run as recovery.

## Genuine positive fixture authority

1. Create an isolated schema10 Orca store using immutable Orca `c2a1f42` normal import/confirm commands with the installed fake Codex and a real old ccloop `5b0adea` binary. This is an actual historical producer: `c2a1f42:src/control/migrations.ts:3` is schema10; `planImport.ts:265–283,325` authors finite allocations. Close that store and open it with current `openControlStore`; `migrations.ts:110–114` derives `finite-legacy` rows without changing historical body/hash bytes. A store created/confirmed under the old controller and migrated before first run is also sufficient. Pin and report which lifecycle was exercised.
2. Before initial execution, use real owner `WebControlService.setLimit` (`webService.ts:805–827`) to preauthorize enough **all-dimension** spare. A concrete single-task default uses `F=(3,000,000;14,400,000;3;3)` and `H=(300,000;1,800,000;0;0)` from `estimator.ts:14–17`. At the confirmed pre-start state, choose `groupLimit = used + committed + (F + H) + Q`, where finite explicit `Q` covers any planned further recovery/review reserve beyond commitments. The minimal extra fresh allocation is `(3,300,000;16,200,000;3;3)`. Existing committed goal-review reserve stays included. Author cap headroom for old and fresh allocations if caps are enabled; do not rely on no cap as proof of cap enforcement.
3. Drive the genuine old worker through existing port/driver collection. Bare valid execution output rejected by the old strict envelope parser produces genuine unknown usage; Task6 investigation records that provenance at `task-6-report.md:10`. Retain real original report, stop proof, accepted envelope, events, final bytes and publication. Do not append an invented unknown usage event: existing `fixtures/unknownFailure.ts:12–30` deliberately does that and is suitable for settlement unit checks, not this historical producer acceptance.
4. For the **complete-archive positive**, retain the old worker's already published exact namespaced attempt ref and archive the actual published candidate via `archiveRun`/`captureSnapshot` (`archive.ts:164–182`). Follow the Task6 genuine complete-archive fixture's proven path after its final report. Label this explicitly as old-worker + complete-archive primitive + real owner settlement. The ordinary old detached result clone loses the ref and must separately remain `legacy-ref-missing`; do not inject the missing ref into that archive (recovery spec §6.7–6.9).
5. Invoke the actual owner settlement command with `acknowledge:'charge-remaining-grant'`, authenticated Web user context and current expected revision. `withCommandContext(...,{client:'web',principal:'user:owner'},...)` is the existing direct integration harness seam (`fixtures/unknownFailure.ts:46–49`); an assembled authenticated panel route additionally proves owner authorization. Call the actual `service.settleUnknownUsage`/`applySettleUnknownUsage`, then assert `hasValidUsageSettlement(store,run)`, preserved original failure/highWater, successful real receipt, actual immutable report/proof refs, exact charged amounts and no pending usage. No receipt/marker fabrication.
6. Admit the new verification command with ordinary membership, caps, stop and active-run exclusion, storing protected recovery lineage and derived funding authority atomically. For the no-overshoot first-source example, `I=(3,000,000;14,400,000;3;3)`, `F` is the same fixed grant, and `T=(6,000,000;28,800,000;6;6)`. Actual new grant remains exactly `F`, inherited starts at `I`, new run-local counters start at zero, and one entry consumes one new attempt/session. Historical handoff charge belongs to group spend but is not silently added to work `inheritedUsage`.
7. Require a real one-command/one-verifier/zero-plan-execute positive plus ordinary harvest/booking, preserved failed source, replay with no rebooking, and negative cap/all-dimension-exhaustion cases. This preflight does not execute or claim those checks. Keep inherited attempts in ordinary human-gate decisions; immutable ccloop `367066b:src/stop/stopController.ts:60–93` approves success first but gates later rejected attempts. Fresh funding is not a human-gate waiver.

Do NOT use `webFixture`'s default or `ccloopWorlds.startGroup` unchanged as proof of migration: `fixtures/web.ts:115,139–150` calls `seedHistoricalFiniteBudget`, and `fixtures/ccloopWorld.ts:245` calls that helper. Those directly retag a fresh import. `startGroup(...,raiseTokens)` at242–267 increases tokens only. Reuse their normal import/confirm/start and runtime scaffolding, but derive legacy provenance from the old store and authorize every reserve dimension with real commands.

## Bridge gaps and ranked alternatives

1. **Recommended: recovery-specific derived funded-limit authority, mode-aware.** Preserve recorded per-task `finite-legacy` versus `optional-v1`, source frozen contract/hash, and current mutable authored policy. Bind `I`, fresh `F/H`, effective recovery total `T`, actual reservation identity and accounting mode in the immutable admission. Derive `T=I+F` only for legacy; optional cumulative authority still obeys authored `A` and ordinary remaining-dimension guards. Use final Task6 recovery initialization to enforce `F` while carrying `I`. Recovery spec§6/§6.3 explicitly allows fresh funded runtime limits, so there is no inherent budget-spec conflict with this equation. However the final strict Task6 schema must represent it truthfully; this report does not declare a provisional wire field approved.
2. **If final Task6 permits only optional authored-ceiling semantics, make the narrow producer/consumer distinction explicit before Task7 acceptance.** Current Orca `readFundedAllowance` at107–128 insists `authoredTokenCeiling === work.grant.work.tokens`, recomputes true prior usage and demands the new grant equal/fit authored-minus-inherited. For settled legacy `I>=G`, that rejects fresh full `F=G`. Current normal `toStartEnvelope` at89–116 chooses protocol4 only from tokenPolicy and has no recovery-funded authority. Neither persisting a ordinary optional funded record with fake `I=0`, nor passing `T.tokens` as the original authored task ceiling, is valid. A typed recovery-specific validator/record (or explicit recovery-only cumulative limit interpretation with separately retained authored policy) resolves this representational gap. It must not widen ordinary optional semantics or mutate old policy rows. Final Task6 actual code is needed to choose the smallest compatible mapping.
3. **Conservative fallback: refuse legacy recovery funding pending that representation, preserving ordinary retry.** This preserves safety but does not satisfy the required positive Task7 acceptance; report that work incomplete. There is no honest “fixture-only” escape by cap increases, raw-token substitution, policy retagging, invented ceiling, or settlement refund.

Additional source edge to avoid hiding: current `retryTask.ts:118` selects its branch with group-level `hasTokenPolicy`, whereas `hasOptionalTaskPolicy` (`fundedAllowance.ts:29–33`) and token-policy§6.6 define per-task mode with group fallback. A legacy task under an optional group is not grounds to infer cumulative accounting. The proposed genuine fixture keeps both group and task finite-legacy; Task7 mode selection must respect the per-task record rather than copying that group-only predicate blindly.

Immutable normal ccloop `367066b:src/control/worker.ts:242–244` forwards v4 grant/policy; `src/controller/runLoop.ts:1126–1132` clamps ordinary contract limits to the fresh grant, and1311–1317 compares inherited token totals against authored ceiling for allowance continuation. Therefore normal initialization cannot be assumed to implement the new recovery cumulative `T/I/F` mapping. Validate the final dedicated recovery path directly. The current strict token policy has only `authoredTokenCeiling`, `bindingCauses`, `inheritedUsage` (`367066b:src/budget/tokenPolicy.ts:32–36`), so adding an unstated extra key is not an integration solution.

No irreconcilable specification conflict was found: the specs distinguish legacy fixed grant semantics, optional cumulative ceilings, and fresh recovery funding. There is a concrete existing representation/validation gap, and the final Task6 interface may require coordinated narrowing/extension before a truthful positive fixture is possible.

## Narrow interface recommendation after complete immutable-reference search

Prefer a strict **recovery-only funding discriminator in the hash-bound recovery admission/package**, mirrored into accepted recovery identity/state, over a new subtype of the shared tokenPolicy. Suggested conceptual shape (names advisory, not a finalized API):

```
recoveryFunding = {
  kind: 'legacy-fresh-grant-v1',
  historicalPolicy: <exact finite-legacy task policy + frozen authority reference>,
  inheritedUsage: I,
  freshGrant: {work: F, handoff: H},
  fundedTotal: T
}
```

Its validator requires proven controller per-task legacy mode, known exact lineage accounting, `I === envelope.tokenPolicy.inheritedUsage` in every dimension, `freshGrant === envelope.claim.grant`, `T === I + F`, source/frozen identity, reservation identity, and safe finite arithmetic. Preserve tokenPolicy's actual authored token value as historical authored authority; never replace it with `T.tokens`. Only the dedicated recovery legacy branch uses the separately named funded total to calculate cumulative remaining allowance. The ordinary optional branch continues to enforce original authored ceilings. If preserving that historical token value in the existing tokenPolicy shape is semantically ambiguous in the final Task6 code, let the recovery record carry the historical policy and inherited usage explicitly and revise the recovery-only requirement in both producer/consumer; do not silently reinterpret the generic field.

This is an accounting-mode distinction, not a ceiling exception: legacy current authority is already freshly funded per run under token-policy§6.6. Keep `inputCheckpoint:null`; do not route this recovery through ordinary allowance continuation. It must not call `parkAllowance` to arm automatic renewal or enter plan/execute. Replayed accepted recovery retains the same funding record; a new explicit interrupted successor recomputes `I` from all settled predecessors and reserves a new `F`.

Why separate metadata is least invasive: immutable `367066b` exhaustive `git grep` finds shared tokenPolicy consumers in protocol, worker, ordinary runLoop, handoff and materialize. A tagged policy subtype would force changes to the shared strict schema (`budget/tokenPolicy.ts:32–36`), normal envelope, handoff (`control/handoff.ts:329–338`), continuation lineage (`control/materialize.ts:219–245`) and ordinary renewal budget logic (`controller/runLoop.ts:1311–1317`). A mode-specific recovery funding record can be rejected outside `mode:'verify-saved-result'`, leaving those ordinary pathways untouched.

No double booking: `control/worker.ts:252–270` accumulates only this worker's observed tokens and emits run-local `elapsedMs`, attempt and session counts; `control/usage.ts:178–218` deduplicates by observation identity and builds cumulative events from those local values. A recovery state may display inherited attempts/time/tokens, but its worker observation must emit `newAttemptCount=1`, `newSessionCount=1`, actual new elapsed time and verifier tokens, not the state's inherited-plus-new totals. Inherited original work enters only the immutable recovery identity/presentation/guard inputs; Orca already booked it under the original run. Preserve ordinary stop-controller inherited attempt inputs (`runLoop.ts:1851–1862`) and the human gate (`stopController.ts:89–90`).
