# Task 2 report (implementer: Claude Sonnet 5.5), commit 536ed9f2 on codex/round-20261017

Changed: queries.ts (record schema + EstimateRecord: proposalVersion, repairs, origin, retriedAs, retrySkipped, all optional),
webProtocol.ts (contract `retryProblems` 1..20; view five fields), controlViews.ts (pass-through, only when defined),
web/src/controlTypes.ts, planImport.ts (`proposalVersion: 1`), webService.ts createEstimate (`proposal.proposalVersion`).
No existing criterion needed a rewrite (no Ruling comments). Test: tests/control/estimateRecordFields.test.ts (5 tests).

Verification (outputs in /private/tmp/claude-501/o/): new file 5/5; typecheck exit 0; `npm run build --workspace web` exit 0.
Full vitest run (full.txt): 43 failed / 3774 passed; all 43 failures are scheduler/schedulerBridge tests with
"ccloop bin not found at .../Orca-wt/ccloop/dist/cli.js" (environment: no ccloop build), 40 of 43 message-checked, no non-ccloop error text anywhere in the file.

Mutations (clone --local /private/tmp/mut-NKkp/c, worktree untouched; restore proof git diff 0 bytes / git diff --cached 0 bytes):
- M1 createEstimate stops writing proposalVersion -> "stamps proposalVersion 1 ... 2" RED
- M2 import stops writing proposalVersion -> same test RED
- M3 view drops repairs passthrough -> "all five fields" RED
- M4 contract retryProblems loses min(1) -> contract test RED
- M5 record schema loses proposalVersion (perl deleted 2 matching lines in queries.ts) -> all 5 RED
