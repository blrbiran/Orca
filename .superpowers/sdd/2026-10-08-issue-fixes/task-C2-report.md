# Task C2 report

Commit f9f730b "fix(control): recovery heals empty-frozen-set shutdown intents" (src/control/recovery.ts, tests/control/shutdownHealing.test.ts; pathspec commit).

Implemented: healEmptyShutdownIntents (own transaction, called right after dispatchBlocked is set, before deliverSchedulerWakes), exactly as the brief; explicit recordProjectionChange kept (Part C ruling 6).

Tests: shutdownHealing (3) + recovery, driverRecovery, webFaults, panel/controlStartup, panel/controlRecoveryApi: 6 files, 40 tests, rc=0 (/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e34dc963-cc97-4bb3-b662-27fd62c9d359/scratchpad/orca/C2/c2-green.txt). npm run typecheck rc=0.
Third test is the controller amendment (Review Focus 1): a claimed run settled via settleProviderAttempt (failed-before-provider), startedAt/endedAt stripped, empty shutdown intent seeded, store closed, activity table dropped and meta set to 8, reopened with openControlStore (migrates to 9), recoverControl, readControlGroup shows run startedAt null/endedAt null, then start returns scheduled.

TDD RED (heal call disabled): tests 1 and 3 red at expect(stopRow).toBeUndefined(); test 2 green (/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e34dc963-cc97-4bb3-b662-27fd62c9d359/scratchpad/orca/C2/c2-red.txt).

Mutations (git clone --local, worktree diff and diff --cached 0 bytes before and after):
- m1 frozen.length check removed: test 2 red. m2 DELETE removed: tests 1,3 red. m3 recordActivity removed: tests 1,3 red. m4 call removed: tests 1,3 red. m5 group.stopped=false removed: tests 1,3 red.
- m6 recordProjectionChange removed: GREEN. Known equivalent mutant (stated per ruling 6): recordActivity also records the projection change; the explicit call stays because spec 3.2(2) requires it independently.

Deviations: the v8 test runs recoverControl with { driverOwnsWebRuns: true } (the panel's mode); without it recovery blocks on the synthetic run (no start outbox row) and start returns recovery-blocked, which is unrelated to healing. Test 1 in the brief used h.command after the close in test 3, so test 3 builds its start command via h.rawCommand.
Concerns: none. B11 files untouched.

## Fix round 1

Commit 7c12667 "test(control): pin that recovery heals before scheduler wakes are delivered" (tests/control/shutdownHealing.test.ts only; recovery.ts unchanged).
New case: confirm + start leaves a pending start wake; a stale empty-frozen-set shutdown intent is seeded; recoverControl runs with createWebWakeHandlers (as controlAssembly.ts does). Asserts pendingWakeIds is empty, the wake is delivered=1, runs grew, and the intent is gone.
Tests: shutdownHealing 4/4 pass, typecheck rc=0.
Mutation m7 (clone2, heal call moved after the wake delivery, just before the return): new case RED (pendingWakeIds not empty: the wake is refused under the stale intent); the other three stay green.
The worktree showed a non-zero unstaged diff (18365 bytes) from other implementers' concurrent edits (not mine; I touched only my test file); the mutation was confined to the clone.
