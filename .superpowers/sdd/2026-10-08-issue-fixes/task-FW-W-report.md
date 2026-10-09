# FW-W report (commit b6c943c, base 5bc96ab+; scratchpad .../scratchpad/orca/FW-W/)
Implemented W1-W4 in one commit. Files: web/src/TaskDetail.tsx, web/src/locales/{en,zh}.ts, web/tests/{failureReasons,styles,taskActivity}.test.*, tests/panel/refusalCoverage.test.ts (listed codex-exit-error).
- W1 en/zh archive-stop-pending gain "If it is unresolved, retry recovery first." (zh: 如果停止状态未解决，请先重试恢复。); {{detail}} kept, no own code in en.
- W2 codex-exit-error en+zh entries; added to failureReasons REASONS and refusalCoverage VIEW_REASONS.
- W3 styles test pins `.dep-node text.dep-stall` -> var(--stall).
- W4 RunActivity: separate effect resets entries/refusal on runId only (not changeSeq, so polling does not flicker); test switches run-a -> run-b with a pending fetch and asserts run-a rows gone and no "none recorded" text.
TDD RED seen before implementing: failureReasons (2 fail), taskActivity (1 fail); styles test green at once (pins existing state; proven by mutation).
Mutations (clone after commit), all RED: stall var(--stall)->var(--warn) (styles); remove runId reset (taskActivity); drop en clause; drop zh codex-exit-error; change zh clause; delete en codex-exit-error with list kept (refusalCoverage).
Results: web check rc=0 (88 files, 701 tests); build rc=0; tests/panel 1 fail = controlShutdown SIGTERM (known flake), alone with refusalCoverage 11/11 green at load 14.8.
Concern: root `npm run typecheck` rc=2 on tests/control/archiveGroup.test.ts(203): `.options` on a ZodEffects, in FW-S's uncommitted work, not mine.

## Fix note (commit 6b90629, review follow-ups)
- RunActivity is now keyed by run id at its call site (`key={item.currentRunId}`) and the runId reset effect is removed, so a new run mounts empty with no frame of the old rows. Mutation in a clone after the commit (key removed): taskActivity W4 test RED.
- zh archive-stop-pending pin is the full clause "如果停止状态未解决，请先重试恢复。".
- web check under load 13-14: one different timeout each run (agentPreviewRefresh 15 s, known load flake class); that file plus taskActivity and failureReasons alone: 24/24 green. Review minor 3 (alphabetical order of codex-exit-error) not taken.
