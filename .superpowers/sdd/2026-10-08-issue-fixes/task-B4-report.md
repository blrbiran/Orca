# Task B4 report (implementer B4, session e34dc963, 2026-10-08)

Status: DONE_WITH_CONCERNS (one criterion strengthened in a follow-up commit; see Deviations)

Commits (branch fix/issues-20261008, on top of 3c50309):
- 22b61df feat(control): record run-blocked, run-settled and endedAt at every run-state write
- 3f43813 test(control): pin that re-blocking a blocked run writes no second run-blocked row

## Implemented
- src/control/activity.ts: appended RUN_ENDED_STATES, RunTransitionSubject, noteRunWrite exactly as in the brief.
- src/control/budget.ts: import noteRunWrite; RunRecord gains startedAt?/endedAt?; saveRun calls noteRunWrite first
  (so every saveDriverRun goes through it).
- src/control/stopIntent.ts: import; saveRunBody calls noteRunWrite first.
- src/control/webDispatch.ts: import; saveDispatchRun calls noteRunWrite first.
- src/panel/controlViews.ts: persistedRunSchema accepts startedAt/endedAt (safeInteger.optional()), before `drive:`.
- tests/control/activityRuns.test.ts: new, 4 tests (brief Step 1 text, plus the follow-up change below).

## Tests
- TDD RED (before implementation): `vitest run tests/control/activityRuns.test.ts` -> rc=1, 4/4 failed for the expected
  reasons (`expected undefined to be 2000`; body missing endedAt 4000 / 5000; `expected [] to deeply equal [[6000, …]]`).
  Output: scratchpad/orca/B4/red.txt.
- GREEN: same file rc=0, 4/4 (green.txt; after the follow-up green2.txt). `npm run typecheck` rc=0 (tc.txt, tc2.txt).
- Full suites, per the planning ruling (any run-state write outside a transaction would now throw):
  `vitest run tests/control tests/panel` -> rc=0, Test Files 202 passed | 8 skipped (210), Tests 1990 passed | 54 skipped
  (2044), 203.8 s, load 30.9 at start / 14.6 at end (suites.txt, read whole). No `control-projection-transaction-missing`
  anywhere: no production path or existing test writes a run state outside a transaction. The 8 skipped files are the
  env-gated real-binary E2E files (it.skipIf/describe.runIf: handoffE2E, webCcloopSmoke, executionDriverE2E, etc.) —
  pre-existing gates, not skipped by this change. Web was not changed; web/dist was present and not rebuilt.
- The full suites were run before the follow-up commit; the follow-up changes only tests/control/activityRuns.test.ts,
  which was re-run green with typecheck.

## Mutations (clones made after the commits: scratchpad/orca/B4/clone at 22b61df, clone2 at 3f43813)
- (a) drop `if (run.endedAt === undefined) run.endedAt = store.now();` -> red: all three run-settled tests.
- (b) make it unconditional -> red: "a driver run gets endedAt when it lands, kept through settle…" (settled body 3000).
- (c) drop the run-settled recordActivity -> red: the three run-settled tests on their row assertions.
- (d) drop the run-blocked recordActivity -> red: "a run entering blocked writes one row…".
- (e1) drop noteRunWrite from saveRunBody -> red: "a handoff-stopped run settled unrecoverable…" only.
- (e2) drop noteRunWrite from saveDispatchRun -> red: "a first attempt proved never started…" only.
- (f) remove the `prior.state === run.state` check -> at 22b61df red ONLY on the driver test (4 run-settled rows), NOT on
  the blocked test the brief names; at 3f43813 red on both, the blocked test failing `expected length 1 but got 2`.
- (g, extra) drop noteRunWrite from saveRun -> red: driver run-settled test and the run-blocked test.
Worktree `git diff | wc -c` and `git diff --cached | wc -c` were 0 and 0 after each commit; mutations touched only clones.

## Deviations from the brief
- Finding (Rule 9): the brief's blocked test drove `driver.round()` twice after the run blocked and asserted one row.
  The driver never touches a blocked run (it is not in DRIVEN), so that assertion could not go red under mutation (f).
  Follow-up commit 3f43813 replaces the two rounds with `blockRun(t.deps, runId, "C", "terminal:exhausted | then: later")`
  — the exact re-block the driver's catch path performs on an already-blocked run (executionDriver.ts, "a run that is
  already blocked stays blocked where it was") — checks the body did change (blockedReason), then asserts one row.
  Seen red under (f) afterwards. Imports blockRun and LATER_ERROR from executionDriver.js.
- No other deviations; code is verbatim from the brief. File/line anchors matched the current code.

## Self-review
- noteRunWrite runs before saveRun's "body unchanged" early return; a write keeping state is a no-op by the prior-state
  check, so no spurious rows. endedAt is stamped on the object before JSON.stringify in all three writers, so the
  stamped value is persisted in the same UPDATE.
- A run whose row does not exist yet (`prior === undefined`) writes nothing; claims INSERT, they do not go through these
  writers.
- Import graph: activity.ts imports only errors/projectionJournal/store types, so budget/stopIntent/webDispatch importing
  it adds no cycle.

## Concerns
- The run-blocked row body takes blockedAt/blockedReason from the body about to be written; every current blocker sets
  both before saving, so this holds, but a future blocker that saves `state="blocked"` before setting the reason would
  write `{blockedAt:null, reason:null}`.
- Part D must only add "settled-failed" to RUN_ENDED_STATES (ledger ruling flags 4/5).
