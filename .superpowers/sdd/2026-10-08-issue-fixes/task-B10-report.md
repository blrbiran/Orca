# Task B10 report
Status: DONE. Commit aa3f9dc "feat(control): record an integration row for each result the pass records".
Files: src/control/integrationPass.ts (import + 2 lines in settle), tests/control/integrationGit.test.ts (new describe, 2 cases).
- Case 1 (brief's test): idle row, then blocked row (integration-work-branch-diverged); no-op pass writes none.
- Case 2 (added per ruling B-10, pins the transient guard): ORCA_INTEGRATION_TIMEOUT_MS=500 + ext:: sleep remote yields a real transient; asserts record backed off (transient: 1) AND zero integration rows.
TDD: with src reverted, case 1 RED at `expect(rows()).toEqual([{state:"idle",reason:null}])` (got []); case 2 passed (as expected before impl: nothing writes). GREEN after impl: integrationGit+integrationCrash+integrationResolve rc=0, 82 passed 2 skipped; typecheck rc=0.
Mutations (clone made after commit, worktree diff/--cached 0 bytes before and after):
- M1 delete recordActivity line -> case 1 RED.
- M2 drop the `!== "transient"` guard -> case 2 RED (seen red; the brief's "unpinned guard" caveat no longer applies).
Deviation: none beyond the added case 2. Logs: scratchpad/orca/B10/*.txt.
Note: `cp` is interactive-aliased in this shell; use /bin/cp -f.
