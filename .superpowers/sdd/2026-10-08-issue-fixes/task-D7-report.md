# Task D7 report — the driver cleans a settled-failed run; run 2/3 claimed and land

Implementer: D7 (session e34dc963 subagent), 2026-10-09. Branch fix/issues-20261008, worktree /Users/biran/code/skills/loop/Orca-issues.
Commit: 585fb72 `feat(control): archive and clean a settled-failed run's workspace in the driver loop` (parent f6db4fd, a
concurrent Part E commit; mine is a pathspec commit of exactly the two files below).

## Implemented
- `src/control/executionDriver.ts`
  - new `export async function stepCleanupFailed(deps, runId): Promise<boolean>` after `stepE`, exactly as the brief:
    reads the run, returns false unless `settled-failed` with a drive not yet cleaned; `savedReport` -> `archiveRun`
    (stop proof = `report.candidate?.stopProof ?? null`) -> `cleanupRunWorkspace(resolveRepository(groupRepoId), roots,
    runId, workspaceOf(drive))` -> re-read inside `write` and set `cleanedUp: true, cleanupError: null` only if still
    `settled-failed`.
  - `driverRunIds`: also lists a `settled-failed` run with a drive and `!cleanedUp`.
  - `advance` work chain: `case "settled-failed": return stepCleanupFailed(deps, runId);`.
  - `pass` catch: the "record cleanupError, keep the state" branch now covers `settled` or `settled-failed` (outer
    check and the re-check inside the write); the comment now reads "A settled (or settled-failed) run stays where it is".
- `tests/control/retryTask.test.ts`: imports (`existsSync`, `deliverScheduledStart`, `taskRunNumber`, `git`), helpers
  `claimAgain` and `archived` after `unchanged`, and the new describe "after retry-task: cleanup, a new run, success" with
  the brief's three `it`s verbatim.

## Deviation from the brief
- The three new `it`s carry a 30000 ms timeout (comment above them; same convention as driverSettle.test.ts). Reason:
  in the first full tests/control run (load 8 -> 21) all three timed out at the default 5 s (alone: 0.57 s, 0.53 s,
  2.4 s). Without it they would be three new load flakes. Assertions unchanged.
- "flag 11 caveats about integration-pass ordering": I found no "flag 11" text in progress.md, part-D.md, the plan
  index or preflight-scan.md. What I verified instead: in the cleanup-failure test the round visits runs before the
  integration pass (pass(): runs loop, then exportPendingRequirements, then integratePendingGroups), so `cleanupError`
  is written before the integration pass could touch the throwing `resolveRepository`; the test's stderr shows exactly
  one `orca-driver: <run>: repository-unavailable` line and no `round failed` line, i.e. the integration pass did not
  throw on that round. If flag 11 says something else, the controller should check it against this.

## TDD
- RED: `./node_modules/.bin/vitest run tests/control/retryTask.test.ts > $S/d7-red.txt` rc=1 — 3 failed / 12 passed:
  test 1 at `cleanedUp: true` (received false, line 305), test 2 at `cleanupError: "repository-unavailable"` (received
  null, line 328), test 3 "the driver did not reach the expected state" (final `until`, line 358). Exactly the brief's
  predicted reasons.
- GREEN: same command rc=0, 15/15 (`$S/d7-green.txt`; after the timeout edit `$S/d7-green2.txt`, 15/15).
($S = /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e34dc963-cc97-4bb3-b662-27fd62c9d359/scratchpad/orca/D7)

## Verification
- `npm run typecheck` rc=0 (before and after the timeout edit).
- Driver suites (`tests/control/driver*.test.ts tests/control/executionDriver*.test.ts tests/control/blockedStaysPut.test.ts`):
  rc=1 with 2 x 5 s timeouts (driverProgress "P3/R1 ...", driverRequirementSplit "fails the third consecutive invalid
  draft ...") at load 8.5-9.3; both files alone rc=0 (7/7, 8/8) at load 8.2. 186 passed, 10 skipped.
- executionDriverE2E.test.ts: all 9 skipped in this environment (real ccloop absent; same as base) — the brief's
  real-ccloop scenario was not exercised here.
- Full tests/control run 1 (pre-timeout edit, load 8 -> 21.6): 8 failed, all "Test timed out in 5000ms": driverProgress
  x2, driverRecovery "drives a retried run on ...", driverRequirementSplit, integrationKeep, and my 3 new tests. Each file
  re-run alone rc=0 (load 18.8 -> 13.3).
- Full tests/control run 2 (after the 30 s timeout, at HEAD 585fb72, load 7.2 -> 10.1): 1 failed / 1541 passed / 54
  skipped — activityRuns "a driver run gets endedAt when it lands ..." 5 s timeout (ledger already lists it as a B4
  load-flake candidate); alone rc=0, 12/12 (load 8.4). My new tests green in the full run.

## Mutations (clone `git clone --local` at 585fb72, `$S/clone`, discarded after)
Worktree `git diff | wc -c` / `git diff --cached | wc -c` (/usr/bin/git): 0/0 before, 0/0 after.
- (a) drop the settled-failed clause from driverRunIds -> test 1 red at `cleanedUp: true` (line 306). `$S/mut-a.txt`
- (b) drop `case "settled-failed"` from advance -> test 1 red at `cleanedUp: true`. `$S/mut-b.txt`
- (c) catch back to `run.state === "settled"` only -> test 2 red: state `blocked` (not settled-failed), cleanupError null. `$S/mut-c.txt`
- (d) delete the `archiveRun(...)` call -> test 1 red at `archived(t, runId)` "expected 0 to be greater than 0". `$S/mut-d.txt`
- (e) delete the final `write(...)` -> test 1 red at `cleanedUp: true`. `$S/mut-e.txt`
- extra (f) delete the `cleanupRunWorkspace(...)` call -> test 1 red at `existsSync(workspacePath)` true. `$S/mut-f.txt`
- extra (g) inner catch re-check back to `current.state === "settled"` only -> test 2 red at `cleanupError` null (state
  stays settled-failed). `$S/mut-g.txt`
All seven seen red. Not separately pinned: the in-write re-check `current.state !== "settled-failed"` in
stepCleanupFailed (a concurrent state change during the awaits; no test produces one) — same unpinned shape as stepE's.

## Files changed
- /Users/biran/code/skills/loop/Orca-issues/src/control/executionDriver.ts
- /Users/biran/code/skills/loop/Orca-issues/tests/control/retryTask.test.ts

## Self-review / concerns
- Setup guards per preflight #19 (not criteria): `existsSync(workspacePath)` true before retry, `netOf(...).tokens` 10.
- Test 3 pins Review Focus 2: run number 2 then 3 via `taskRunNumber`, the exact `group-reserve-insufficient:tokens:10`
  refusal on the second retry, then run 3 lands and all three runs end cleaned.
- Load-flake exposure: the full suite at load > 8 times out several existing 5 s driver tests; my three are protected by
  the 30 s timeout.
