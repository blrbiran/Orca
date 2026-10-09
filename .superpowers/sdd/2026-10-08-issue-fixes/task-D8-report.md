# Task D8 report — BLOCKED (existing test outside the brief's rewrite list goes red)

Implementer: D8, session e34dc963, worktree /Users/biran/code/skills/loop/Orca-issues (fix/issues-20261008), HEAD bcf5584
at the time of the work. No commit made. The worktree is back to its pre-D8 state for every D8 path (the only tracked
modification left is D9's tests/control/executionDriverE2E.test.ts, untouched by D8; `git diff --cached` 0 bytes).

## What was implemented (saved, not committed)

Saved under `$S = /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e34dc963-cc97-4bb3-b662-27fd62c9d359/scratchpad/orca/D8`:
- `$S/saved/d8-tracked.patch` (16528 bytes; `git apply --check` clean on bcf5584): ControlGroupView.tsx, TaskDetail.tsx,
  controlApi.ts, locales/en.ts, locales/zh.ts, tests/driverRetry.test.tsx.
- `$S/saved/web/src/RunReason.tsx`, `$S/saved/web/tests/failureReasons.test.ts` (new files).
- `$S/proposed-workspaceMode.patch`: the one-assertion rewrite needed (below).

Content is exactly the brief's code, with these findings against current code:
- `terminal` already existed from Part A in both tables (en: "ccloop finished this run without success (outcome
  {{detail}})."; zh likewise). Kept Part A's text; added only the 12 `codex-*` entries, en and zh, right after `terminal`.
  en entries never contain their code and use no placeholder; key sets stay equal.
- `RetryTaskPayloadV1` already existed in web/src/controlTypes.ts (D2/D3); only imported.
- Not added to tests/panel/refusalCoverage.test.ts VIEW_REASONS (its comment says "Part D adds ccloop's stop reasons
  here") — the brief does not name that file; failureReasons.test.ts covers the 13 reasons. Flag for controller.

## TDD

RED (`cd web && ../node_modules/.bin/vitest run tests/driverRetry.test.tsx tests/failureReasons.test.ts > $S/red.txt`):
rc=1, 5 failed / 3 passed. Failures as expected: "offers Retry task, not Retry run…" (a Retry run button present),
"explains a settled-failed run's reason…" (no "reported an error"), "shows the task's run number…" (no "Run 2 of this
task"), failureReasons both `it`s (12 codex codes missing; `explainRunReason` → null). Deviation from the brief's
expectation: "keeps Retry run for a blocked run whose ccloop run succeeded" passes before the change — it pins existing
behaviour (the brief said four driverRetry `it`s fail; three do).

GREEN (same command, `$S/green.txt`): rc=0, 8/8.

Other checks with the change applied in the worktree: `npm run typecheck` rc=0; `npm run build --workspace web` rc=0;
`./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts tests/panel/webParity.test.ts` rc=0 (10/10).

## Why BLOCKED

`npm run --workspace web check` ($S/webcheck.txt): rc=1, 654/655 —
`web/tests/workspaceMode.test.tsx > a blocked run in the group view (execution driver §2.3) > shows the reason next to the
blocked state`:
`expected '<section …' to contain 'blocked — inspect-unknown'`; rendered:
`blocked — After several checks ccloop still cannot tell whether this run is alive. Choose "Retry run" once ccloop can
answer. <code>inspect-unknown</code>`.

Cause: the brief's prescribed `<RunReason run={run} />` replaces the raw `" — ${run.blockedReason}"` with the explanation
followed by the raw reason in `<code>` (spec §2.2(a)/§4.2(5)). The test (088529f) pinned the raw-only rendering; it is not
in Part D's "Existing tests rewritten" list, so per common-implementer.md I stopped.

Proposed rewrite (keeps the intent: the reason is shown next to the blocked state), `$S/proposed-workspaceMode.patch`:
```
-    expect(html).toContain("blocked — inspect-unknown");
+    // Issue fixes spec §2.2(a), §4.2(5): the reason is explained in the reader's language, the raw reason beside it.
+    expect(html).toMatch(/blocked — After several checks ccloop still cannot tell whether this run is alive\.[^<]* <code>inspect-unknown<\/code>/);
```
Verified in a `git clone --local` at $S/clone (D8 patch + new files + this rewrite): web check first run 654/655 with a
different red, controlCommandRecovery "drops the id only when the server says no result was ever retained" (load avg
10.52; it passed in the worktree run) — re-run alone 6/6 green, then full web vitest rc=0, 655/655 ($S/clone-web2.txt).

## To resume after a ruling
`git -C $W apply $S/saved/d8-tracked.patch && cp $S/saved/web/src/RunReason.tsx $W/web/src/ && cp $S/saved/web/tests/failureReasons.test.ts $W/web/tests/ && git -C $W apply $S/proposed-workspaceMode.patch`,
re-run checks, commit with pathspec (8 brief paths + web/tests/workspaceMode.test.tsx), then the Step 5 mutations (not yet run).

## Not done
Commit (Step 6) and mutations (Step 5) — blocked on the ruling.

---

# Resumed after controller ruling — DONE_WITH_CONCERNS (commit 759930c)

Ruling applied: (1) web/tests/workspaceMode.test.tsx "shows the reason next to the blocked state" rewritten with the
proposed one-assertion change; (2) the 12 codex-* reasons added to tests/panel/refusalCoverage.test.ts VIEW_REASONS.
The saved patch re-applied cleanly on bcf5584. E4 had not yet touched en.ts/zh.ts. Before the commit, each en/zh diff was
exactly D8's 15 lines. Pathspec commit of 10 paths:
`759930c feat(web): offer Retry task for a run ccloop ended failed, explain its reason, and show the run number`.
E4 then committed dd82218 and 87c16c3 on top; 759930c is an ancestor of HEAD.

## Verification (worktree, before commit)
- `npm run typecheck` rc=0; `npm run build --workspace web` rc=0; refusalCoverage + webParity rc=0 (10/10) ($S/r2-*.txt).
- Web check: tsc passed. In 3 full web vitest runs, 654/655 each time. The one red each time was
  web/tests/agentPreviewRefresh.test.tsx "re-reads a preview whose slot was unavailable five times on the backoff…",
  which timed out at 15000 ms. Load averages were 21.88 / 19.08 / 20.52.
  - Run alone it passes 13/13 ($S/r2-flake.txt).
  - Timed alone with --reporter=verbose on a clean HEAD clone (no D8) it took 7682 ms, and with D8 it took 5313 ms
    ($S/base-apr.txt, $S/d8-apr.txt). D8 does not slow it; it is a wall-clock backoff test with no D8 code on its path.
  - The same D8 content plus the rewrite passed the full web suite 655/655 in a clone at load ~9 ($S/clone-web2.txt).
  - Concern: under load above ~19 this test fails the full suite consistently. It is not on the handoff's flake list.

## Mutations (clone of 759930c; worktree D8-path diff 0 bytes and --cached 0 before and after; clones discarded)
- (a) Swap the branch order in ControlGroupView → "offers Retry task, not Retry run…" red at line 63 (one Retry run button).
- (b) Delete the retry-task branch → same `it` red at line 63, before the click: the run still shows Retry run, and that
  assertion runs first.
- (c) Restore the raw blocked-reason text → "offers Retry task…" red at the explanation, and "explains a settled-failed
  run's reason" red at line 79.
- (d1) Delete the TaskDetail button → "shows the task's run number and Retry task" red at the click (line 90).
- (d2) Delete the runNumber paragraph → same `it` red at "Run 2 of this task" (line 89).
- (e) Delete zhErrors codex-result-invalid → failureReasons first `it` red.
- (f) Make reasonCode the identity → failureReasons second `it` red (null). explainRunReason does not strip `Error: `.
- (g, extra) Delete zhErrors codex-timeout → refusalCoverage "has a zh entry for every … view-shown reason" red, naming
  codex-timeout, which only the new VIEW_REASONS rows require. The key-parity `it` is red too.

---

# Fix round 1 — commit b95c88a

Review finding (Important): Retry task was shown under a stop intent and on a clarifying group. The server always refuses
it there (src/control/retryTask.ts: clarifying ⇒ group-state-invalid; group.stopped or a stop intent ⇒
stop-mode-conflict). Minor: a terminally failed run with taskId === null fell through to Retry run.

Fix:
- New pure helper `retryTaskOpen(view)` in web/src/runFacts.ts: `view.stop === null && view.summary.state !== "clarifying"`.
- ControlGroupView: a terminally failed run shows Retry task only when retryTaskOpen(view) holds and it has a taskId.
  Otherwise it shows no button, and it never falls back to recovery-retry, which the server refuses with
  run-terminal-failed. The explained reason (RunReason) is still shown.
- TaskDetail: Retry task requires retryTaskOpen(view).
- The server's `group.stopped` is not in the web view. `view.stop` (the stop intent) is the signal the panel has, the same
  one Part C's Continue task uses (summary.stopMode). Archived-state hiding is left to E10.

Tests (web/tests/driverRetry.test.tsx, new describe "no Retry task where the server refuses it"):
- stop intent ⇒ no button in the runs table, and the explanation is still shown;
- clarifying group ⇒ no button;
- terminal failure with no task ⇒ no Retry run;
- stop intent ⇒ no Retry task in the task detail, and the run number is still shown.

Process deviation: the implementation was written before the first test run. Red-first is instead shown in a clone of
b95c88a with web/src checked out from 759930c (pre-fix): all 4 new `it`s red ("expected length 0 but got 1" at lines
103/109/114/122). That checkout also brought back pre-E4 en/zh lines, which none of these assertions read.

Verification (worktree, before commit): focused 15/15; web check rc=0 (84 files, 659/659); typecheck rc=0; web build rc=0;
refusalCoverage + webParity 10/10. Load average 14.23.

Mutations (clone of b95c88a; worktree web diff and --cached both 0 bytes before and after; clone discarded):
- m1 drop `view.stop === null` from retryTaskOpen ⇒ stop-intent table `it` and task-detail `it` red.
- m2 drop the clarifying check ⇒ clarifying `it` red.
- m3 drop retryTaskOpen from TaskDetail ⇒ task-detail `it` red.
- m4 drop retryTaskOpen from ControlGroupView ⇒ stop-intent and clarifying `it`s red.
- m5 restore the fall-through to Retry run ⇒ stop-intent, clarifying and no-task `it`s red (a Retry run button appears).
