# Task B3 report
Status: DONE. Commit 3c50309 "feat(control): record group activity inside the change's transaction".
Files: src/control/activity.ts (new), src/control/projectionJournal.ts (+inProjectionTransaction), tests/control/activity.test.ts (+5 tests, imports).
Implemented verbatim per brief; no deviations.
TDD: RED = "Cannot find module ../../src/control/activity.js" (scratchpad orca/B3/red.txt). GREEN: activity.test.ts + projectionJournal.test.ts 13/13, typecheck rc=0.
Mutations (clone made after commit, node_modules symlinked), each seen red on the named test only: (a) drop transaction guard -> "refuses to write outside a transaction"; (b) drop recordProjectionChange -> "writes one row..."; (c) global retention -> "keeps exactly a group's newest 500"; (d) ORDER BY at -> "reads newest first by seq". Worktree diff and diff --cached were 0 bytes before and after.
Concerns: none.
