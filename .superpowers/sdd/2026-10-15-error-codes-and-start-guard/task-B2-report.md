# Task B2 report

Implementer: Orca session 026d10e3 subagent, 2026-10-15. Base: 20301d89. Commit: f084ed58
(`feat(control): refuse a second start while the group's execution is pending (#53)`; the body names the 11 known reds and R1).

Status: DONE_WITH_CONCERNS. Option A was applied, but 11 existing criteria are still red and need the human's ruling.

## What changed (anchors at f084ed58)
- `src/control/errors.ts:96-97`: comment + `"group-execution-pending": 409,` after `"start-state-conflict": 409,`.
- `src/control/webDispatch.ts:29`: imports `groupExecutionPendingInStore`. `:128-137`: `startRefusedAsPending` and `refuseStart`, verbatim from the
  brief. `:144-145`: a pre-probe refusal, the first statement inside `try {`. `:164-165`: a check inside the transaction, right after the clarifying check.
  The precedence is preflight → requirement-not-split → group-execution-pending → the rest. The mutation strings B2a/B2b/B2c/B2h match the file exactly.
- `skills/orca-control/SKILL.md:32`: the sentence from the brief, verbatim.
- `web/src/locales/en.ts:1134` and `web/src/locales/zh.ts:1070`: the error entries, verbatim.
- New `tests/control/startGuard.test.ts` and `tests/panel/startGuardSocket.test.ts`, plus one test appended inside the describe of
  `tests/entry/skill.test.ts`. All are verbatim from the brief, except for one deviation (below).
- `tests/control/fixtures/driverHarness.ts:8-9, 79-91`: the Option A `claim()` from the brief, verbatim (controller ruling R1). Imports added:
  `replenishStartWakes` and `groupExecutionPendingInStore`.

## Deviation (Rule 1 step 2: reversible, decided myself)
The new criterion "C2: refuses on a held task left by a settled handoff and a resume with no selection (a real state)" was
written in the brief with a false premise. After `resume-from-handoff {selections: []}`, an undelivered `resume` wake
(`continuations: []`) stays in the store. So the premise assert `[undelivered execution wakes, active work runs]` reads `[1, 0]`, not `[0, 0]`.
This was measured with a debug print (log `/private/tmp/oec/logs/b2-debug.log`).
With two tasks, delivering that wake claims `b` and creates an active work run, so the held task is still not alone (`b2-debug2.log`).
Fix:
- The criterion now uses one task (`confirmed()`).
- After the resume it delivers the wake the way the driver would: `expect(await deliverScheduledStart(h.deps, "g")).toEqual({ kind: "idle" })`.

The premise then holds and the state is still production-made.

Also noted, but not changed: in "C2: refuses on an active work run alone", the estimate wake is delivered as well, so an estimate is `running` too.
Before the guard, start answered `estimate-in-flight`. Mutation B2f, which drops the work-run disjunct, should still go red, because the code falls through to `estimate-in-flight`.
The reviewer should confirm this.

## Commands (PATH starts with node v22.13.1; every log is under /private/tmp/oec/logs/)
- Fake-only table written with the Task G Step 1 command, because it did not exist. Modes: `700 /private/tmp/oec/gate`, `600 …/table.json` (`b2-modes.log`).
  The ccloop clone HEAD is `dc51022f965e40c3953e66e4fb34cb76cd17467d`.
- Census before (`b2-census-before.{log,json,uptime}`, load 16.44/11.33/10.67): rc=1, 2624 tests: 2581 passed, 13 failed, 30 skipped.
  The 30 skips are paired/env-gated files, the same in every census.
  - All 13 failures are registered shapes: timeouts in agentSelectionE2E C3, driverLanding D, driverRecovery, driverRequirementSplit, retryTask ×2,
    schedulerBridge and settleUnknownUsage ×4.
  - Plus the 2 `taskResultPaired` env reds.
  - Summary: `b2-census-before-summary.txt`.
- RED (`b2-red2.log`, with the corrected criterion), rc=1: 14 failed | 9 passed.
  - Red: C1, every C2 row, the held real-state row, C4, the socket test and the skill test. All are assertion reds, except the socket test, which is a TypeError at
    `.error.code` because the answer is still a 202.
  - Green: C3 ×2 and C6, as expected.
- GREEN (`b2-green.log`), rc=0: 7 files, 93/93 passed, 0 skipped. Files: startGuard, startGuardSocket, skill, webDispatch, requirementGuards,
  refusalCoverage, controlOverviewApi.
- `npm run typecheck` (`b2-typecheck.log`): rc=0. Again after Option A (`b2-optA-typecheck.log`): rc=0.
- Full web suite (web/src was touched; `b2-webfull.log`): rc=0, 129 files, 1118/1118 passed.
- Census after, before Option A (`b2-census-after.*`, load 16.37/11.96/12.45): 2641 tests, 65 failed. The diff script is `/private/tmp/oec/census.py`, run with `python3 -I`.
  Its output files are `b2-census-new-reds.txt` and `b2-census-new-reds-classified.txt`.
  - 51 failed on `group-execution-pending`: 50 passed before; `settleUnknownUsage` silent=false had been a timeout before.
  - The rest were timeouts.
- Option A applied, then those files rerun with startGuard (`b2-optA.{log,json}`): 174 tests, 163 passed, 11 failed.
- Census after Option A, at commit f084ed58 (`b2-census-afterA.*`, load 8.04/13.27/14.28; classified in `b2-census-afterA-classified.txt`): 2641 tests, 2579 passed, 32 failed, 30 skipped.
  - The 11 group-execution-pending reds listed below.
  - 19 timeouts and the 2 `taskResultPaired` env reds.
  - No new red was caused by Option A itself.
- Every timeout file rerun alone, once, sequentially (`b2-rerun/<file>.{log,uptime}`, load 7.8–13.9), all rc=0:
  - archivedWakePerformance 24/24
  - driverLanding 5/5
  - profiledService 15/15
  - retryTask 15/15
  - settleUnknownUsage 36/36
  - savedResultRecovery 3/3
  - driverRecovery 8/8
  - driverRequirementSplit 8/8
  - schedulerBridge 9/9

  `profiledService.test.ts` › "probes both profiles with the predecessor's frozen selection on the profiled continuation path" is **not** on
  the known-load-flakes list. It is a 5 s timeout in the census and green alone (n=1), so it is a candidate for registration.
- `pgrep -fl "fake-ccloop|worker.js|vitest"` at the end: none.

## Option A turned these back to green (40 criteria; all were red on group-execution-pending in the census before Option A)
- `tests/control/driverReconcile.test.ts`: 22. Every criterion in "reconciling a conflict (spec §5.3)" that the census listed, both in "a person's retry
  of a run blocked at R (final review I4)", and "a reconciliation whose landing swap fails without the tip moving (final review I2)".
- `tests/control/driverReconcileN.test.ts`: 5. N1u; "a reconciliation reset by a moved tip…"; "the spawn key after a spawn that died unbooked…";
  N2; "lands all three with exactly two reconciliations…".
- `tests/control/configHashPerTask.test.ts`: 4. "blocks at A2, before ccloop is asked…", "blocks only the run ccloop accepted under the
  other task's configHash…", "hands the reconciliation the group's reconcile slot's own configHash…", "sends each of two runs whose tasks froze
  different selections a start env…".
- `tests/control/driverHandoff.test.ts`: 3. "a landing whose worktree removal failed after the swap (T4-I1) leaves a run blocked at R…",
  "closes a run blocked after its execution ended from its collected result, beside a running run", "parks a run whose conflict the group
  cannot afford as held with a partial checkpoint".
- `tests/control/settleUnknownUsage.test.ts`: 2. "D9 does not erase other frozen runs › keeps another run's unknown/open request blocker",
  both the silent=true and silent=false rows. In the census after Option A both rows are 5 s timeouts. Alone the file is 36/36.
- `tests/control/blockedStaysPut.test.ts`: 1. "a conflict-parked run whose H-settle throws once stays at D; a retry…".
- `tests/control/driverRoundIsolation.test.ts`: 1. "names a run whose failure it could not record, and still moves the next run in the same round".
- `tests/control/driverSettle.test.ts`: 1. "R2b: an independent run settles while its sibling is blocked at B'".
- `tests/control/handoffStop.test.ts`: 1. "records the run whose request already settled as a recovery blocker and still freezes t…".
- `tests/control/startGuard.test.ts` C6, which uses `t.claim()`, is green.

## Still red after Option A (11): needs the human; not edited
1. `tests/control/handoffFailedRetry.test.ts`: 10 tests in "M3 handoff failure retry lifecycle":
   - retries a handoff-settled failed continuation at its claim grant
   - retries released manual settlement without releasing twice
   - settles unknown usage before handoff then resumes and retries from head
   - rearms invalid first proof with the newest currentRunId and no second reservation
   - resumes a pre-provider stopped retry without a second reservation
   - active retry after reduced retry remains valid
   - rejects retry source identity, amount and no-provider drift in both shared readers
   - clears the live source atomically when a provider retry parks held and Continue remains legal
   - clears live retry source on normal terminal success
   - clears live retry source on unrecoverable provider handoff

   Each fails with `claim: the driver would arm no start wake`.
   - Cause: `reduced()` ends with `resumeEmpty(t)`, which leaves an undelivered `resume` wake with `continuations: []`. That keeps execution pending.
   - `replenishStartWakes` skips a group that already has an undelivered start/no-start/resume wake, so Option A's `claim()` throws.
   - In production the driver would simply deliver the waiting wake.

   A verified candidate fix was tried in the clone `/private/tmp/oec/mut/b2-diag`; the main worktree was not touched (`b2-diag.log`).
   It is one more fixture line: when execution is pending and such a wake is already waiting, deliver it instead of arming one:
   ```ts
   const waiting = h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g' AND delivered=0 AND kind IN ('start','no-start','resume')").get() !== undefined;
   if (!waiting && replenishStartWakes(...).length === 0) throw …
   ```
   It turns 9 of the 10 green. The 10th, "resumes a pre-provider stopped retry without a second reservation", then fails in the test file's own
   `reopen()` override of `t.claim` (`handoffFailedRetry.test.ts:43-46`), which sends a fresh `start` after `resumeEmpty`.
   That needs a named rewrite; the same pattern would fix it.
2. `tests/control/shutdownHealing.test.ts` › "a stranded v8 store migrates, heals, renders a run with startedAt null, and then accepts start".
   `:142` expected 'scheduled', got 'group-execution-pending'.
   - Cause: `settleProviderAttempt(…firstAttemptProof: "invalid")` re-arms an undelivered `no-start` wake (`scheduler-wake:g:no-start:<run>:1`), with task `a` `ready`.
     That was measured in the clone.
   - Spec B §3.2 counts that wake as pending, so the criterion's "then accepts start" now contradicts the spec.
   - It needs a named rewrite: either expect `group-execution-pending`, or deliver the no-start wake first.

Task G cannot pass until these 11 are ruled on. The clone `/private/tmp/oec/mut/b2-diag` holds uncommitted diagnostic edits. It is not the reviewer's `b2` clone,
and it can be deleted by the human.

## Concerns
- The 11 reds above, pending the human's ruling (K7 follow-up).
- `profiledService` has a new, unregistered timeout name (green alone, n=1).
- The C2 "active work run alone" row's premise also has a running estimate (see Deviation). The reviewer should confirm that B2f goes red on it.

## Controller rulings (received after f084ed58, recorded verbatim in substance)
1. `handoffFailedRetry.test.ts` (10): apply the candidate fixture extension in `driverHarness.ts`. `claim()` delivers an already-waiting
   dispatch wake (resume/start/no-start) the way the driver would, instead of arming a new one, and stays default-preserving for every other caller.
   For the 10th, change only the test's own `reopen()` claim to go through the claim path, change no assertion, and add the #53 comment.
2. `shutdownHealing.test.ts:142`: deliver the pending `no-start` wake first, the way the driver does, then send start and keep the `scheduled` expectation, with the #53 comment.

### Applied (session 026d10e3 subagent, 2026-10-15, on top of f084ed58)
- Ruling 1 is applied in two files:
  - `tests/control/fixtures/driverHarness.ts` `claim()`: when execution is pending and an undelivered start/no-start/resume wake exists,
    it delivers that wake. It arms one with `replenishStartWakes` only when none is waiting. Doc comment extended. When nothing is pending, the old path runs: a fresh `start`.
  - `tests/control/handoffFailedRetry.test.ts` `reopen()` `t.claim`: if `groupExecutionPendingInStore` is true it goes straight to the file's
    `claim(t)` (`deliverScheduledStart`, the driver's delivery). Otherwise it sends the fresh `start` as before. The comment is the ruling's text, the
    import of `groupExecutionPendingInStore` is added, and no assertion was changed.
    - Note: the fixture's own `t.claim` was not reused, because after `reopen()` it would hold the pre-reopen `service`, bound to the closed store.
- **Ruling 2 is NOT applied, because it is infeasible as written.** With the delivery added (`deliverScheduledStart` on the reopened store, as the driver does), it answers
  `{"kind":"claimed"}`: task `a` → `running` and a new active `work` run `starting`, while the `no-start` wake is marked delivered.
  Debug log: `/private/tmp/oec/logs/b2-r2-shdbg.log`.
  - The group's only task is now executing, so spec B §3.2 refuses the following start with `group-execution-pending`. The `scheduled` expectation
    cannot hold unless an assertion changes, which the ruling forbids.
  - My edit was removed again, so the file is unchanged from f084ed58 and still red.
  - Options for the controller:
    - (a) Keep the delivery and assert that healing lets dispatch proceed (`claimed`), then that start answers `group-execution-pending`.
    - (b) Only replace `"scheduled"` with `"group-execution-pending"`, with no delivery.
    - (c) Other.
- Reruns (logs under /private/tmp/oec/logs/, read back whole):
  - `b2-r2-files.{log,json}` (load 6.21/8.83/12.18): rc=1, 18 files, 252 tests, 251 passed, 1 failed (the shutdownHealing criterion above), 0 skipped.
    - Files: handoffFailedRetry, shutdownHealing, the 9 files Option A touched (driverReconcile, driverReconcileN, configHashPerTask, driverHandoff,
      settleUnknownUsage, blockedStaysPut, driverRoundIsolation, driverSettle, handoffStop), and the B2 targeted files (startGuard, startGuardSocket, skill,
      webDispatch, requirementGuards, refusalCoverage, controlOverviewApi).
    - `handoffFailedRetry` is all green.
  - `b2-r2-typecheck.log`: rc=0.
  - `profiledService.test.ts` alone, 2 more runs: 15/15 rc=0 (load 7.89) and 15/15 rc=0 (load 7.58). With the earlier single run that makes 3/3 green alone.
    This matches the known-load-flakes rule for registration, which needs the human or Task G.

### Ruling on shutdownHealing:142 — option (a), applied
- Ruling: keep the delivery and assert it answers `claimed`. That is the criterion's intent: dispatch proceeds after healing. Then assert that the following start answers
  `group-execution-pending`, replacing the old `scheduled` assertion, with the #53 comment. No other assertion changes.
- Applied in `tests/control/shutdownHealing.test.ts`, in the test "a stranded v8 store migrates, heals, renders a run with startedAt null, and then
  accepts start":
  - `expect(await deliverScheduledStart(...)).toMatchObject({ kind: "claimed" })`
  - then `.toBe("group-execution-pending")`
  - The comment text is the ruling's. The test title is unchanged.
- Rerun, load 8.12: `b2-r3-shutdown.log` rc=0, 4/4 passed, 0 skipped. `b2-r3-typecheck.log` rc=0.
- All 11 reds that remained after Option A are now resolved by rulings.
