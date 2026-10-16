# Task 6 report (implementer session 4de777f4 subagent, 2026-10-17, commit 9dbbaed2)

Status: DONE. Commit 9dbbaed2 `feat(web): show an estimate's repairs and its automatic retry`.

Changes: web/src/ControlGroupView.tsx (estimate row appends repaired / retry of vN / retried as vN / retry skipped: code; ids mapped to versions via the same group's estimate list, falling back to the id), locales en.ts + zh.ts (control.group.estimateRepaired/RetryOf/RetriedAs/RetrySkipped), web/tests/estimateRepairRetry.test.tsx (3 tests: en, zh, old row/empty repairs shows nothing).

Verification (observed at 9dbbaed2): new file 3 passed; `npm run --ws check` exit 0; root scanPanelText 1 file passed, exit 0 (outputs redirected to /tmp/t6a.txt, t6c.txt, t6s.txt).

Mutations (git clone --local under /private/tmp/mut-*, each seen red, exit 1): repairs branch -> false; repairs branch -> always true; origin branch removed; retriedAs removed; retrySkipped removed; version lookup replaced by raw id. Restore proof: git diff and git diff --cached 0 bytes in clone; worktree status clean after commit.

Concern: the lookup falls back to showing the raw estimate id if the referenced estimate is absent from the list (not specified by the brief).
