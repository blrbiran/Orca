# Task C4 report
Status: DONE. Commit 7835728 "docs: errata for the shutdown stop-intent lifecycle" (pathspec commit of exactly the two files, 53 insertions, 0 deletions).
Check: both grep -c = 1 (were 0). Anchors: spec lines 1274 and 1282 matched (1677 earlier erratum not separately needed; numbers unchanged).
Diff (git diff -U0, read whole, saved scratchpad/orca/C4/c4-diff.txt, 63 lines): hunks `@@ -5576,0 +5577,19 @@` (plan) and `@@ -1735,0 +1736,34 @@` (spec); no `-` content lines.
Text verbatim from the brief; no change needed. Verified against current code: unchanged-idle enum in webProtocol.ts/controlLifecycle.ts (C1 in progress, uncommitted, skipped-driver-owned decided first), recovery.ts heal + stop-cleared {reason:"empty-shutdown-intent"} (C2, f9f730b).
Concerns: erratum names commit subjects for C1 and C3 and web/tests/stopBanner.test.tsx, none committed/present yet at this time (shutdownHealing.test.ts exists). C3 text (resume dialog, banner) not yet verifiable; Continue-task-only-without-stop-intent ruling is not contradicted by the text. Plan file ended with a blank line, so two blank lines precede its erratum.
