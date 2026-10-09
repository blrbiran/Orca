# Task B6 report
Commit c405c3e "feat(control): record a phase row when ccloop's step or attempt changes" (pathspec: src/control/executionDriver.ts, tests/control/activityRuns.test.ts).
Implemented per brief verbatim (imports recordActivity, RunProgress; phase row body {step: raw status, attempt}).
TDD: RED = "expected [] to deeply equal [Array(3)]" (rows []); GREEN: activityRuns + driverProgress + progressE2E rc=0 (15 passed, 1 skipped), typecheck rc=0.
Full tests/control (uptime load 6.38): 1503 passed, 1 failed: tests/control/activity.test.ts "an accepted group command writes one row..." -- that file is modified (uncommitted) by concurrent B7 (command row not yet implemented in commandLedger); fails deterministically alone too (rc=1, load 6.00). Not B6-related.
Mutations (clone, after commit): (a) delete recordActivity call -> RED; (b) condition -> progress !== null -> RED; (c) drop currentAttempt compare -> RED. Worktree diff --cached 0 bytes; worktree diff 3675 bytes = B7's uncommitted files, not mine (clone discarded not deleted: scratchpad orca/B6/mut).
Deviations: none. Outputs in scratchpad orca/B6/*.txt.
