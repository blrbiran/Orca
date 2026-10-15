# Task B3 review (task reviewer, Orca session 026d10e3 subagent, 2026-10-15)

Reviewed: commit 9eab8af0 (parent 08276cf2), package `review-08276cf2..9eab8af0.diff`, brief `task-B3-brief.md`,
report `task-B3-report.md`. Clone: `/private/tmp/oec/mut/b3` at `9eab8af0` (logs `/private/tmp/oec/logs/b3-*.log`,
mutation logs `/private/tmp/oec/mut/logs/B3*.*`, specs `/private/tmp/oec/mut/specs/b3/`).

## Spec compliance: ✅

- `src/control/webService.ts`: `readStopIntent` imported (line 27, brief said :26; the import line is the same one).
  Step 1 of `setTaskLoop` is the brief's predicate verbatim:
  `["draft","ready","running","review"].includes(group.status) && ((!group.stopped && stopIntent === null) || stopIntent?.mode === "pause")`,
  else `group-state-invalid`. `assertKnownConservation` still runs first (recovery-blocked before any state refusal).
- `task-already-started` (status not draft/ready, or any `runs` row) is untouched (diff context shows it byte-identical).
- Clarifying → `requirement-not-split`: unchanged; `readBudgetProposal` (`queries.ts:113`) throws it on the line before the
  state check, which this diff does not move.
- `web/src/LoopPlanCard.tsx:181-183`: `open` follows the same predicate (state in draft/ready/running/review and stopMode
  null or pause). A stopped flag with no intent cannot reach the card: `stopView` (`src/panel/controlViews.ts:301`) blocks
  the whole view with `stop-intent-missing`, so the web side does not need the `stopped` flag.
- Real states (criteria 7-8): C7 review group, C8 retry are built by the driver harness (`driverHarness`, real claims,
  real checkpoint → `review`, real `retryTask`); paused and handoff-stopped groups by `pauseDispatch` / `handoffStop`.
  No status column flipped in the new file.
- Named rewrites only: `tests/control/setTaskLoop.test.ts:24-44` (the brief's block: done/blocked refuse, running/review
  accept on a confirmed group), `web/tests/loopPlanEdit.test.tsx:148-164`, `web/tests/budgetI18n.test.tsx:150-151`.
  Each matches the brief text and carries the "Rewritten for…" comment. No other existing assertion changed.
  `setTaskLoop.test.ts:33` ("refuses a stopped group…", stopped flag with no intent) is untouched and green (K6) — and
  B3b2 proves it still guards the `!group.stopped` clause.
- Commit subject matches the brief; trailer is a controller ruling (not a finding).

## The implementer's deviation (C8 red before the change)

Accepted. Before the change a `review` group was refused `group-state-invalid` before the per-task check, so C8 was red
at RED; the brief's "green at RED" expectation was wrong, not the test. C8 now guards two things, and the mutations
separate them cleanly:
- B3c (status back to draft/ready) → C8 red at `setTaskLoopRunning.test.ts:69` with `group-state-invalid`.
- B3d (drop only the per-task `runs`-row check) → C8 red at the same line `:69` with `undefined` error (the change of `b`,
  status `ready` after retry, was **accepted**). The preceding assertion `:68` (`b` is `ready`) is the precondition that
  makes the runs-row check the only thing standing; it passed under B3d, so the red is on the named assertion, not a
  short-circuit. C8 therefore does prove the per-task guard (Review Focus 5).

## Findings

### Critical
None.

### Important
1. **Server refusal of a shutting-down group has no criterion** (`tests/control/setTaskLoopRunning.test.ts`, missing).
   Binding constraint (spec B §3.3): "shutting down stays group-state-invalid". Extra mutation B3x — replace
   `|| stopIntent?.mode === "pause");` with `|| (stopIntent !== null && stopIntent.mode !== "handoff"));` (accepts a
   shutdown intent) — stayed **green** over all seven `tests/control/setTaskLoop*.test.ts` files (56/56, rc=0). Only
   handoff is pinned server-side; the web side does pin shutdown (`loopPlanEdit.test.tsx:158`). This is a gap in the
   brief's criterion list rather than an implementer error (the code is the brief's predicate verbatim), but per the
   contract a green mutation is a missing criterion.
   Fix (new test only): add "C7: a shutting-down group does not" beside the handoff one — confirm, issue the real global
   `shutdown` command so the group carries a `mode: "shutdown"` stop intent, then expect `setTaskLoop` → `error.code`
   `group-state-invalid`; reviewer re-runs B3x and sees it red.

### Minor
None.

## Mutations

Runner self-check: bad spec `{"from":"no such text"}` → `exit 2`, `.mutate` "found 0", clone `git diff`/`--cached` 0/0 bytes.
Baseline in clone: root `setTaskLoopRunning` + `setTaskLoop` 24/24 passed rc=0; web `loopPlanEdit` + `budgetI18n` 19/19
passed rc=0; 0 skipped. Web built in the clone (rc=0). Every mutation: sha after ≠ before, restored = before.

| Name | File | Test file | Red on (assertion) | rc | restore bytes (diff / cached) |
|---|---|---|---|---|---|
| B3a drop pause clause | src/control/webService.ts | setTaskLoopRunning | "C7: a paused group takes…" `:45` (got group-state-invalid) | 1 | 0 / 0 |
| B3b ignore stop intent | src/control/webService.ts | setTaskLoopRunning | "C7: a handoff-stopped group does not" `:55` (got task-loop-set) | 1 | 0 / 0 |
| B3b2 (same) | src/control/webService.ts | setTaskLoop | "refuses a stopped group…" `:50` (error undefined) | 1 | 0 / 0 |
| B3c status draft/ready | src/control/webService.ts | setTaskLoopRunning | C7 review `:31` and C8 `:69` (group-state-invalid) | 1 | 0 / 0 |
| B3c2 (same) | src/control/webService.ts | setTaskLoop | "accepts … running" and "… review" `:42` | 1 | 0 / 0 |
| B3d drop runs-row check | src/control/webService.ts | setTaskLoopRunning | C8 `:69` (change of `b` accepted, error undefined) | 1 | 0 / 0 |
| B3e web status | web/src/LoopPlanCard.tsx | web loopPlanEdit | rewritten test `:161` (no "Change plan" for running/review) | 1 | 0 / 0 |
| B3f web pause | web/src/LoopPlanCard.tsx | web loopPlanEdit | rewritten test `:161` (no "Change plan" for paused) | 1 | 0 / 0 |
| B3x (extra) accept shutdown intent | src/control/webService.ts | tests/control/setTaskLoop* (7 files) | **stayed green** 56/56 | 0 | 0 / 0 |

Brief-named: 8/8 red. Total: 8/9 red.

`pgrep -fl "fake-ccloop|worker.js|vitest"` before and after: no processes (exit 1 both times). Worktree
`git status --porcelain` 0 bytes; clone `git status --porcelain` 0 bytes after all mutations.

## ⚠️ Cannot verify from diff
- Implementer's green runs (full web suite 1118/1118, typecheck, web tsc, scanPanelText) — not re-run here; I re-ran only
  the four B3 test files as the clone baseline (green).

## Re-review 1 (task reviewer, Orca session 026d10e3 subagent, 2026-10-15; fix commit aa73953d, package `review-9eab8af0..aa73953d.diff`)

Scope: the Important finding (shutting-down refusal unpinned, B3x) and new breakage in the fix diff only.

- Fix: test-only, one file (`tests/control/setTaskLoopRunning.test.ts`, +18). New "C7: a shutting-down group does not"
  (`:64`) builds the state with production code: a real claim of `a`, then the real `applyPanelShutdown`, which writes the
  `shutdown` stop intent because it freezes an active run. The premise is asserted at `:69` (`stop_intents.mode` =
  `shutdown`). The refusal is asserted at `:71` on the unstarted task `b` (`group-state-invalid`), and `:72-73` check that
  nothing changed (contract hash the same, no amendment). Running without an admission gate is justified: with a gate,
  `panel-draining` would refuse first and mask the predicate.
- Fresh clone `/private/tmp/oec/mut/b3r1` at `aa73953d` (clone rc=0). Baseline `setTaskLoopRunning.test.ts` 5/5 passed,
  rc=0, 0 skipped. `pgrep` before and after: none.
- **B3x re-run** (same spec `/private/tmp/oec/mut/specs/b3/B3x.json`, accepts any intent but handoff): rc=1, **red on
  "C7: a shutting-down group does not" at `:71`** (`expected undefined to match object { code: 'group-state-invalid' }`).
  The premise at `:69` passed under the mutation, so the red is on the refusal assertion and not on the premise; the other
  4 tests passed. sha before = restored (`86243d5d…`) ≠ after; restore bytes diff 0 / cached 0; clone status 0 bytes.
- New breakage: none found. The fix touches no source, no fixture and no existing assertion; the new import
  (`applyPanelShutdown`, `src/panel/controlLifecycle.ts`) is used only by the new test, and the test writes only to the
  harness store.

Result: Important 1 **ADDRESSED**. Updated totals: Critical 0, Important 0, Minor 0; mutations 9/9 red. Spec ✅, Quality Approved.
