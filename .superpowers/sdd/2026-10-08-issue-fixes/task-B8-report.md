# Tasks B8 + B9 report (one implementer, batched: both edit src/control/stopIntent.ts)

Status: DONE_WITH_CONCERNS (concerns below).

## Commits
- 7aca55c feat(control): record run-resumed when recovery-retry resumes a blocked run (B8)
- fb08b7d feat(control): record a stop row when a group stop intent is created (B9)

## B8
- `retryRun`: `if (resumedDriverRun) recordActivity(... kind "run-resumed", body {})`; import became `{ noteRunWrite, recordActivity }`.
- Tests (tests/control/activityRuns.test.ts): the brief's test, plus the controller-ruled pinning test for the guard:
  "a run-scope recovery-retry of a run that is not blocked resumes nothing and writes no run-resumed row".
- RED (before implementation): newest two rows were [command, run-blocked] instead of [command, run-resumed]. Guard test was only meaningful after implementation; seen red by the `if (true)` mutation below.
- The B8 commit contains only the B8 tests (B9 tests were held back and added in B9's commit).

## B9
- `applyPauseDispatch`, `applyHandoffStop`: `stop {mode}` row after `saveStopIntent`. `applyPanelShutdown`: one `stop {mode:"shutdown"}` row per group whose disposition is `created` or `strengthened-pause`; `shutdownGroup` stays row-free. Import added in controlLifecycle.ts.
- Tests: the brief's two, with `await t.claim()` before the first shutdown (Pre-flight amendment 1).
- RED before implementation: both new stop tests saw `[]`.

## Results
- GREEN B9 run: `vitest run tests/control/activityRuns.test.ts tests/control/stopIntent.test.ts tests/panel/controlLifecycle.test.ts tests/panel/shutdownDriverGroup.test.ts tests/control/handoffStop.test.ts --testTimeout=30000` -> 5 files, 81 tests passed; typecheck rc=0.
- B8 run (activityRuns, blockedStaysPut, driverRecovery, driveRecord, stopIntent): all pass except load timeouts (5 s default) in two driver tests: "a driver run gets endedAt when it lands..." (B4's, first test of the file, cold start) and driverRecovery "drives a retried run on...". Both pass alone / with `--testTimeout=30000` (load average 9-11 at the time, `uptime` 22:50). Known load-flake shape, not a regression; the former also timed out in the pre-implementation RED run.
- Logs: scratchpad/orca/B8/*.txt, scratchpad/orca/B9/*.txt.

## Mutation evidence (clone made after the B9 commit, scratchpad/orca/B9/clone; each seen RED, only the named test failed)
- `if (resumedDriverRun)` -> `if (true)`: RED "…run that is not blocked resumes nothing…" (this is the guard pin).
- delete the run-resumed line: RED "…blocked run writes run-resumed…".
- delete pause row: RED "pause and its strengthening…"; delete handoff row: RED same test.
- shutdown condition -> `false`: RED "a shutdown that creates…"; -> `true`: RED same test (extra row from preserved-shutdown).
- Main worktree: `git diff --cached` 0 bytes; `git diff` non-zero only because other implementers (B10-B12 files) have uncommitted work; none of my paths.

## Deviations / concerns
- B8's test expects the `command` row, which comes from B7. B7's commit (5406b0f) landed immediately after mine, so the B8 commit (7aca55c) alone is red on the command-row expectation if B7's change were absent; at HEAD all green.
- Tooling note: `cp` is interactive-aliased here (a first attempt hung on a prompt); `/bin/cp -f` used.
- Test file order: new describes append after "phase"; B9 imports (`readGroupActivity`, `applyPanelShutdown`) added in the B9 commit via the full file, B8 commit had the reduced imports.
