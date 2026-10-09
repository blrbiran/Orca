# Task D2 report (session e34dc963, implementer D2, 2026-10-08)

Status: BLOCKED. Nothing is committed. The implementation is complete and uncommitted in the worktree, on D2's paths only.

## Blocker
An existing test the brief does not name goes red in the web check:
`web/tests/i18nPseudo.test.tsx` > "every enum value has its words in both languages (spec §3.5)" > "reads every family":
`expect(ENUM_VALUES.length).toBe(164)` -> received 165. ENUM_VALUES counts every key of `en.enums`. The new
`runState."settled-failed"` that spec §4.2(4) requires adds exactly one value. The same `describe`'s per-value test
("in Chinese shows zh.ts's words ...") passes with the new value ("已结算（失败）" differs from "settled-failed").
This count has been rewritten before as a "named rewrite" (see the comments at lines 338-340: N1 Tasks 4, 12, 13).
Proposed patch, needing a controller ruling:
```
-    expect(ENUM_VALUES.length).toBe(164);
+    // And runState.settled-failed (issue fixes spec §4.2(4), Task D2, the same named rewrite).
+    expect(ENUM_VALUES.length).toBe(165);
```
If it is approved, add `web/tests/i18nPseudo.test.tsx` to the D2 commit pathspec.

## Implemented (uncommitted)
- tests/control/fixtures/driverPort.ts: `FakeBehaviour` gains `"failed"`; `stopReason?` input; outcome failed; terminal carries stopReason when stated.
- tests/control/fixtures/driverHarness.ts: `HarnessOptions.stopReason?` passed to `fakeCcloopPort`.
- tests/control/retryTask.test.ts: created exactly as in the brief (3 its).
- src/control/driveRecord.ts: `stopReason: z.string().min(1).optional()`.
- src/control/executionDriver.ts: stepC stores `stopReason` with `outcome` for any non-succeeded terminal; blockedReason unchanged.
- src/panel/controlViews.ts: "settled-failed" in persistedRunSchema.state, displayRunState, runViews terminal list; run view `stopReason`/`outcome` (null when absent).
  B11 did NOT already copy stopReason into the view (checked: there was no `stopReason` in controlViews.ts), so nothing was duplicated.
- src/control/webProtocol.ts: runViewSchema state + `stopReason`/`outcome` nullable optional.
- src/control/budget.ts isTerminalRunState, src/control/singleCallLedger.ts STOPPED_STATES: + "settled-failed".
- web/src/controlTypes.ts RunViewV1 state + stopReason/outcome; web/src/locales/en.ts and zh.ts runState entries.
- RUN_ENDED_STATES (src/control/activity.ts) not touched; that belongs to D3 under the Part D amendment. No run-settled row or endedAt is written.

## Tests (outputs in scratchpad/orca/D2/)
- TDD RED (d2.txt): rc=1, 3 failed as the brief predicted: (1) drive record lacks stopReason; (2) view lacks outcome/stopReason;
  (3) `recovery-blocked:run-invalid:<runId>:Invalid enum value ... received 'settled-failed'`.
- GREEN (d2-green.txt): rc=0, 3/3. `npm run typecheck` rc=0. web tsc rc=0. `npm run build --workspace web` rc=0.
- tests/control + tests/panel (suites.txt): 2 failed | 2012 passed | 54 skipped. The two failures were 5 s timeouts at load 11.3:
  activityRuns "a driver run gets endedAt when it lands..." (a registered load-flake candidate) and driverRequirementSplit
  "fails the third consecutive invalid draft...". Re-run alone (flakes.txt): rc=0, 20/20.
- web check (webcheck.txt): 1 failed | 644 passed: the i18nPseudo count above.

## Not done because of the block
The commit (Step 6) and the mutations (Step 5, which run on a clone made after the commit). Mutation (g) STOPPED_STATES
is unpinnable per the Part D ruling (flags 5/6).

## Deviations
None from the brief text. The anchors were found by text. The line numbers moved after Parts A-C.

## Resolution (after the controller ruling, same session)
Ruling applied: `web/tests/i18nPseudo.test.tsx` "reads every family" is now `toBe(165)`, with the comment
"And runState.settled-failed (issue fixes spec §4.2(4), Task D2, the same named rewrite: 164 + 1)".
web check (webcheck2.txt): rc=0, 645/645.
Status: DONE. Commit ebe9882 "feat(control): keep ccloop's stop reason on the run and add the settled-failed run state to every reader" (13 paths, explicit pathspec).
Worktree after the commit: `/usr/bin/git diff | wc -c` = 0 and `--cached` = 0, both before and after the mutations.
Mutations ran in `git clone --local` at ebe9882 (scratchpad orca/D2/clone, now deleted); outputs are in mut-<x>.txt. Every one was seen red on the named assertion:
- (a) blockRun patch `{ outcome }` only: "stores ccloop's stop reason..." red at the drive toMatchObject (line 48).
- (b) the two view lines deleted: both `it`s of the first describe red at the view toMatchObject (lines 49, 57).
- (c) "settled-failed" removed from persistedRunSchema.state: "renders a settled-failed run" red, `recovery-blocked:run-invalid:...`.
- (d) removed from the runViews terminal list: same `it` red, `recovery-blocked:run-state:<runId>`.
- (e) removed from isTerminalRunState: same `it` red at toThrow("run-already-settled") (line 74, nothing thrown).
- (f) `case "settled-failed":` removed from displayRunState: `npm run typecheck` rc=2, TS2366 controlViews.ts(656).
- (g) STOPPED_STATES: no test can see this entry red. This is recorded under the existing Part D ruling (flags 5/6).
