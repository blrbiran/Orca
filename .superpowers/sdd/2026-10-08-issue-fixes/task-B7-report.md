# Task B7 report (implementer B7)

Commit 5406b0f feat(control): record a command row for every accepted group command (files: src/control/commandLedger.ts, tests/control/activity.test.ts; pathspec commit).

Implemented: import appendActivity; after the ledger's recordProjectionChange, `if (succeeded && commandScope.groupId !== null)` appendActivity a `command` row {verb, actor}, taskId/runId from the raw target. Matches the brief verbatim; no deviations.

TDD: RED with the src reverted (scratchpad/orca/B7/red.txt): `expected [] to deeply equal [ Array(1) ]` at the first rows() assertion. GREEN: activity.test.ts 8/8.
Suites (one run, load ~8-9): tests/control + tests/panel: 201 files passed, 1 failed, 1994 tests passed. Failure: driverRecovery "drives a retried run on from where it was blocked, to settled" 5 s timeout (registered load flake); alone at uptime load 7.81: 8/8 rc=0. Typecheck rc=0.
Mutations (clone after commit; worktree diff / diff --cached = 0 / 0 bytes before and after):
 (a) delete block -> RED (rows []).
 (b) drop `succeeded &&` -> RED (length 3, stale + refused wrote rows).
 (c) extra: appendActivity -> recordActivity stays GREEN: equivalent mutant, because projectionJournal dedups the group already recorded in the same transaction; appendActivity is a stated intent, not observably pinned by projectionSeq.
Concerns: none. Note: `cp` is interactive-aliased here; use /bin/cp -f.
