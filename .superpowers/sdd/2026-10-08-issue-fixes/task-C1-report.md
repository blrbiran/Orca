# Task C1 report (implementer C1, session e34dc963, 2026-10-08)

Status: DONE_WITH_CONCERNS (one concern: handoffE2E is fully skipped in this environment, on the base as well)

Commit: a715716 "fix(control): shutdown writes no stop intent for an idle group" (pathspec commit, 6 files; parent 6edcd81,
which another implementer landed while C1 ran).

## Implemented
- `src/panel/controlLifecycle.ts`: `Disposition` gains `"unchanged-idle"`; in `shutdownGroup`, directly after the
  `skipped-driver-owned` branch, `if (active.length === 0)` returns `{ disposition: "unchanged-idle", changed: false,
  ...versions(), frozenRunIds: [], requestIds: [], blockerCode: null }`. No intent, no `stopped`, no revision or
  projection change. Order: blocked-inconsistent -> preserved-handoff/shutdown -> preserved-pause -> skipped-driver-owned
  -> unchanged-idle -> created/strengthened-pause.
- `src/control/webProtocol.ts`: `"unchanged-idle"` added to the strict shutdown disposition enum.
- `web/src/controlTypes.ts`: `kind: "shutdown"` disposition union gains `"unchanged-idle"` (parity is checked by
  tests/panel/webParity.test.ts through `npm run typecheck`).
- Nothing in src/ or web/src renders the shutdown disposition (I checked with grep), so no UI change was needed.
- shutdownGroup writes no activity rows (Part C ruling 5). applyPanelShutdown's B9 `stop` rows are written only for
  created or strengthened groups, so an unchanged-idle group gets none.

## Test rewrites (exactly as the brief (a)-(j); ruling 1's four extra tests included)
- tests/panel/controlLifecycle.test.ts: import of `commandSuccessSchema`. "waits for a writer…" now uses harness
  ["g","h"]. "commits one global command…" uses ["g"]. "gives a ready group an empty frozen set…" is replaced by "lists
  an idle ready group as unchanged-idle…" plus the new "lists an all-done group as unchanged-idle". "records an
  inconsistent frozen set…" uses ["g","h"]. "leaves nothing behind…" uses ["g","h"].
- tests/panel/shutdownDriverGroup.test.ts: in "freezes a started group exactly as before… idle or running", only the
  idle half is rewritten. "freezes a group that was never started…" is renamed "lists a group that was never started as
  unchanged-idle…". "freezes a started group whose body carries no planHash…" is renamed "does not skip a started group
  whose body carries no planHash as driver-owned…".
- tests/control/webFaults.test.ts "applies a cross-group shutdown…": the stop rows are now ["g"], the
  dispositions are [["g","created"],["g2","unchanged-idle"]], and the count is 1.
- The brief's line numbers had shifted (B11 and others landed). Every anchor was found by text and matched exactly once
  (the edit script asserts count==1).

## TDD
- RED: `./node_modules/.bin/vitest run tests/panel/controlLifecycle.test.ts tests/panel/shutdownDriverGroup.test.ts
  tests/control/webFaults.test.ts` gave rc=1 with 6 failed and 26 passed. The failures were the two new controlLifecycle
  idle tests, the 3 rewritten shutdownDriverGroup tests, and webFaults (`expected [ 'g', 'g2' ] to deeply equal [ 'g' ]`).
  Each failure received `disposition: "created", changed: true`. The claim-both rewrites passed, as the brief predicted.
  File: scratchpad/orca/C1/c1-red.txt.
- GREEN: the same 3 files plus handoffE2E, requirementGuards, driverRequirementClarify and activityRuns (Pre-flight
  amendment 1) gave rc=0: 6 files passed, 1 skipped; 75 tests passed, 12 skipped (c1-green.txt). `npm run typecheck`
  rc=0 (c1-tc.txt).
- Suites: `vitest run tests/control tests/panel` rc=0: 203 files passed, 8 skipped; 2008 tests passed, 54 skipped
  (suite.txt; load 4.9 -> 11.2). `npm run --workspace web check` rc=0, 81 files and 636 tests (webcheck.txt). web/dist
  was rebuilt before both runs.
  (scratchpad = /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e34dc963-cc97-4bb3-b662-27fd62c9d359/scratchpad)

## Mutations (git clone --local after a715716; worktree diff and diff --cached were 0 bytes before and after)
1. Deleted the unchanged-idle block: 6 tests red (both controlLifecycle idle tests, the 3 shutdownDriverGroup rewrites,
   webFaults) (m1.txt).
2. Deleted `"unchanged-idle",` from the webProtocol enum: `control-command-result-invalid` from the ledger's
   validation. 5 controlLifecycle tests went red (including "lists an idle ready group…") plus webFaults (m2.txt). This
   matches the brief's "5 in controlLifecycle".
3. Reverted only controlTypes.ts: `npm run typecheck` rc=2, with TS2322 at tests/panel/webParity.test.ts:194 and :207 on
   `"unchanged-idle"` (m3.txt).
4. Dropped the planHash test in driverOwnedGroup: "does not skip a started group whose body carries no planHash…" went
   red, receiving `skipped-driver-owned` (m4.txt).

## Deviations
- None in substance. The line numbers differ from the brief; I located everything by anchor text.

## Concerns
- tests/control/handoffE2E.test.ts skips all 12 tests in this environment. It skips the same 12 on the base
  (a715716~1, run in the clone: base-e2e.txt), so it is environment-gated, not a regression. But it gave no evidence for
  C1 either way.
