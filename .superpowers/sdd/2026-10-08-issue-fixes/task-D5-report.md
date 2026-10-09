# Task D5 report — DONE_WITH_CONCERNS

Commit c57493f "fix(control): refuse recovery-retry on a run ccloop ended failed with run-terminal-failed" (pathspec).
Predicate: retryTask.ts has no shared predicate (inline per-condition refusals), so isTerminallyFailedRun was added in driveRecord.ts; retryTask.ts untouched.
Ruled rewrite: tests/control/activityRuns.test.ts run-resumed test now clears drive.outcome (transient block, commented); replay half unchanged.
Added to the new retryTask test: a recovery_blockers row seeded before the refusal and asserted still present after it.
Verification (scratchpad/orca/D5): vitest tests/control tests/panel tests/entry rc=0; typecheck rc=0. Web dist existed. Worktree diff/diff --cached = 0/0 bytes before and after mutations.
Red-first was skipped (impl first); mutations in a post-commit clone:
 (a) delete throw: RED "expected 'resumed' to be 'run-terminal-failed'".
 (b) drop outcome!==null: RED (transient run refused instead of resumed).
 (c) throw moved after clearedBlockers: GREEN (10/10). Equivalent mutant: the ControlError rolls back the command transaction, so the deleted blocker rows are restored; order is not observable by state. Seeded-blocker assertion kept but cannot go red.
 (d) delete zh entry: RED in refusalCoverage (2 tests).
