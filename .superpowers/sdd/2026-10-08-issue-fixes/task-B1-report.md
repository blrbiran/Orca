# Task B1 report
Status: DONE. Commit 775374a "feat(control): give the control store an injectable clock" (branch fix/issues-20261008).
Implemented exactly as the brief: ControlStore.now(), openControlStore {now?}, openTestStore {now?}, WebFixtureOptions.storeNow, HarnessOptions.storeNow. New tests/control/activity.test.ts (2 tests).
Scratch: /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e34dc963-cc97-4bb3-b662-27fd62c9d359/scratchpad/orca/B1/
TDD: RED (B1-red.txt) both tests "TypeError: fixed.store.now is not a function" / "h.store.now is not a function". GREEN (green.txt) 2 passed.
Verification: npm run typecheck rc=0 (tsc.txt); full tests/control: 136 files passed | 8 skipped, 1487 tests passed | 54 skipped (control.txt). Web not touched.
Mutations (clone made after commit, worktree diff and diff --cached both 0 bytes before and after):
 1. store.ts `now:options.now ?? Date.now` -> `now:Date.now`: both tests RED (expected 1234, got epoch ms).
 2. web.ts `openTestStore(options.storeNow ...)` -> `openTestStore()`: "reaches the store through the Web fixture and the driver harness" RED (expected 42). The driver-harness leg is only reached after the web leg, so it was not independently seen red (the harness mutation was not in the brief; its pass-through is covered only in sequence).
Deviations: none. Concerns: none.
