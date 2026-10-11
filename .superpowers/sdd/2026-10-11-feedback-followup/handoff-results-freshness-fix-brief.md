# Scoped Task 1 integration fix — capture revision authority

Dispatch only after the Task 7 implementer releases the checkout with its product commit. One product implementer at a time. This is an established Tasks 1–7 integration blocker, not implementation of deferred Tasks 8–14.

Read the exact P2 in handoff-integration-review.md, Results spec section 8.3 and completed Task 1 reports. Controller independently verified that useResultsRead resets its effect-local prior on active/identity restart and SavedRunAuthority remembers attempt/executionId without captureRevision. Do not redo completed Results 5 or touch its original WIP worktree.

Minimal required behavior: remember greatest admitted captureRevision per immutable run/generation inside existing owner memory, compare it independently of transient display DTOs. Whole-response rejection never advances any authority. Same account/project/epoch/group/task retains this floor across hide/show and changeSeq refresh; genuine owner/run/generation replacement has an independent floor. Preserve currentAttempt-null unknown display semantics and established attempt/execution high-water guards. No new requests, timer redesign, globals or owner bypass.

Show meaningful actual-consumer RED before fixing: Task and Group admit capture8, restart by hide/show and separately changeSeq refresh, receive capture7 with otherwise matching authority, reject stale response and never show older current content. Cover legitimate reset, rejected aggregate not raising accepted floors, and nonregressing nullable attempt display; preserve existing tests. Use existing fake-clock/App test conventions and isolated runner; no paid provider/real state.

After a minimal source fix, run focused GREEN, Web typecheck/full tests/build and appropriate related assertions. Use a ready exact-source private clone for a named capture-authority guard deletion that fails the intended lifecycle assertion; restore and verify clean source/index. Do not run redundant CLI suites if the product change is entirely browser authority; the controller will bind final merged product evidence separately.

Only stage explicit owned product/tests and your report/evidence paths; exclude node_modules, parent ledger/spec/handoff drafts and Task 7 artifacts. Commit with one-command empty hooksPath through rtk proxy /usr/bin/git. Preserve exact command/RC/source/hash/skip metadata and complete raw logs. No subagents. Report exact BASE/HEAD and limitations for independent scoped rereview. Subsequent agent must use gpt-6.1-sol, never Astra.
