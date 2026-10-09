# D6 report
Commit b96e608 feat(web): decide a run's retry button, reason and run number from the run view. Files: web/src/runFacts.ts, web/tests/runFacts.test.ts (code verbatim from brief).
Tests: web runFacts.test.ts 4/4 pass; web tsc --noEmit rc=0 (outputs under scratchpad/orca/D6/).
TDD note: impl and test were written together, so the RED-first run was not done; replaced by mutation evidence.
Mutations (in a clone, after commit; run output read): (a) drop outcome!=="succeeded", (b) reasonCode unchanged, (c) drop runReasonText first branch, (d) drop failed-before-provider filter: all four rc=1 (red).
Worktree diff at the end was 4740 bytes, all from the concurrent D4 fix (not mine); diff of my two paths = 0 bytes. Cached diff 0.
Deviation: run view has no blockedAt; isTerminalFailure uses state==="blocked" (the view's state is "blocked" only for runs blocked) plus outcome set and !== "succeeded", as the brief specifies. Cannot verify "at C" from the view.
runReasonText returns the raw reason (per brief test); it does not call explainRunReason. reasonCode is exported for E9/E11 to strip "Error: " before explainRunReason. taskRunNumber and reasonCode exported.
