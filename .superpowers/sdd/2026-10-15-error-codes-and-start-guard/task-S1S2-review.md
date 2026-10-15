# Review S1 + S2 (commits 781f9cee, 8355528b; clone /private/tmp/oec/mut/s1s2 detached at 8355528b)

## Spec
S1 ✅. Diff matches the brief verbatim: runNumberOf in runFacts.ts; ControlGroupView import, map signature and the line-440 div; en/zh `attempt` + `taskRun`; new runAttemptLabel.test.tsx; in controlI18n.test.tsx only the two named criteria (array item at the old :76, toEqual at the old :144) changed, each with the #61 comment (:76's above `for (const expected of [`). No other existing test touched. Label names the attempt within its run and the run number sits beside it, en and zh.
S2 ✅. "codex-rate-limited" added to VIEW_REASONS after "codex-exit-error," with the brief's comment; nothing else.

## Findings
- Important: web/src/runFacts.ts (`runNumberOf`, the `lineageRunNumber(lineage, [run]) === 1 ? ... : 0` guard) and the 0 branch in ControlGroupView.tsx (`> 0 ? ... : ""`) are not pinned. The new tests only use two counted runs. Mutation S1e (drop the guard: `return lineageRunNumber(lineage, createdUpTo);`) stays green on runAttemptLabel, controlI18n, runsTableOrder, runFacts tests. Effect of the gap: a failed-before-provider / not-started / savedResultOrdinaryRetry run would wrongly show a run number if the guard were lost. Fix (new test only): add a third run to the fixture or a second case with a `state: "failed-before-provider"` run (and an estimate run with taskId null), expecting its cell to contain "attempt N in this run" and not "of this task"; then S1e goes red.
- Minor: none. (The brief's S1d note "red: first row" holds; it is red in both languages because both tests read the first row.)

Counts: Critical 0, Important 1, Minor 0.

## Mutations (all restore-bytes 0 / 0, sha-restored == sha-before, sha-after differs)
| name | file | red on | notes |
|---|---|---|---|
| S1a | web/src/locales/en.ts | runAttemptLabel > "...in English" only (zh test passes) | received `attempt 3 of claim 1` |
| S1b | web/src/locales/zh.ts | runAttemptLabel > "in Chinese" only | |
| S1b2 | web/src/locales/zh.ts | controlI18n: both rewritten criteria (:76 array item, :144 toEqual) | 2 failed |
| S1c | web/src/ControlGroupView.tsx | both runAttemptLabel tests | |
| S1d | web/src/runFacts.ts | both runAttemptLabel tests (run 1 shows "run 2 of this task") | |
| S1e (extra) | web/src/runFacts.ts | STAYS GREEN | missing criterion, see Important |
| S2a | web/src/locales/en.ts | refusalCoverage "has a en entry..." (`['codex-rate-limited']`) and "keeps the two tables over the same codes" | 2 failed |
| S2 contrast (clone s2pre at 781f9cee) | web/src/locales/en.ts | only "keeps the two tables..." | confirms the new VIEW_REASONS entry adds the first red; `git switch --detach` was allowed |

Runner self-check: bad spec -> exit 2, .mutate says "found 0", file sha unchanged, worktree status empty (mut.sh exits before writing restore-bytes on a failed apply, by design). Green baseline in the clone: runAttemptLabel + controlI18n 2 files / 10 tests, refusalCoverage 6/6, 0 skipped. Web build in the clone rc=0 (needed for tests/panel).
pgrep -fl "fake-ccloop|worker.js|vitest": no processes before or after.

## Cannot verify from diff
- Implementer's claims of full web suite (1120 tests) and tsc/typecheck were not re-run by me (targeted baselines only).
- S2 comment cites ccloop 3069dbf; not checked against the ccloop repo.

## Re-review 1 (fix b22a1b57; clone /private/tmp/oec/mut/s1r1 detached at b22a1b57, web built rc=0)
Verdict: NOT ADDRESSED.
- Baseline in the clone: runAttemptLabel + controlI18n green (4 + 8 tests... rc=0).
- S1e rerun (same spec, `return lineageRunNumber(lineage, createdUpTo);`): still GREEN (4 passed), restore bytes 0/0, rc=0. Mutation applied (.mutate says 1 replacement).
- Why: in the new fixture the only uncounted task run (rb-1, failed-before-provider) is the FIRST run of its task, so createdUpTo=[rb-1] counts 0 even without the guard; the guard only changes the result when an uncounted run comes AFTER a counted run of the same task (createdUpTo then includes the earlier counted one and would print "run 1 of this task" on the uncounted row). The estimate run (taskId null) is caught by the separate `run.taskId === null` early return, which S1e does not remove.
- Fix: put the failed-before-provider run after a counted one, e.g. order rb-0 (running/blocked, counted, createdOrdinal 1), rb-1 (failed-before-provider, createdOrdinal 2), rb-2 (counted, createdOrdinal 3) with lineage of all three; expect rb-1's cell to lack "of this task" and rb-2's to say "run 2 of this task". Then re-run S1e (it would show "run 1 of this task" on rb-1).
- New breakage from b22a1b57: none (test-only, +28 lines, both new tests pass, existing tests unaffected).

## Re-review 2 (fix 4095c659; clone /private/tmp/oec/mut/s1r2 detached at 4095c659, web built rc=0)
Verdict: ADDRESSED.
- Baseline: runAttemptLabel + controlI18n green (rc=0).
- S1e (drop the guard) is now RED: 2 failed / 2 passed, rc=1. English: failed row `not.toContain("of this task")` got "... (claim 2) · run 1 of this task"; Chinese: `not.toContain("这个任务的第")` got "... · 这个任务的第 1 次运行". Both on the failed-before-provider row, as required. .mutate shows 1 replacement; sha-before == sha-restored (26876197b9b9), after differs; restore-bytes 0/0.
- New breakage: none (test-only, +17/-13; the first two describes untouched; no leftover processes).
- Note: the estimate-row assertions are covered by the taskId-null early return, not by S1e (unchanged from before; not a finding).
Updated totals for S1+S2: Critical 0, Important 0, Minor 0; mutations 8/8 red (S1a, S1b, S1b2, S1c, S1d, S1e, S2a, S2 contrast).
