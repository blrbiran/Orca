# Task C3 report — stop banner, resume dialog for a completed panel shutdown, refused buttons hidden

Implementer C3, Orca development session e34dc963, 2026-10-08. Branch fix/issues-20261008, base a715716.

Status: DONE_WITH_CONCERNS (one wording/UX concern below; nothing red).

## Commit

`b9cf916 feat(web): stop banner and the resume dialog for a completed panel shutdown`

The subject matches the one cited by the C4 erratum (item 4) appended to
`docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md` in 7835728 — checked: erratum text reads
"Commit subject: `feat(web): stop banner and the resume dialog for a completed panel shutdown`". The erratum's file
`web/tests/stopBanner.test.tsx` now exists in b9cf916.

## Implemented

- `web/src/ControlGroupView.tsx`
  - `stopMode` local; `handoffActive = stopMode === "handoff" || stopMode === "shutdown"` (spec §3.2 (3)).
  - One `<div role="status" data-testid="stop-banner">` (how / exit / the old `control.group.stop` line) placed after the
    claim-blocked alert and after Part A's `group-refusal` notice (spec §6.5 alerts order); the old standalone stop
    `<p role="status">` below the plan line is deleted (its text moved verbatim into the banner).
  - Start: only `state === "ready" && stopMode === null`.
  - Pause/Handoff-stop: `!handoffActive && stopMode !== "pause"` (now hidden under shutdown too).
  - **Amendment (2) / Part C ruling 2:** per-task "Continue task" buttons moved out of the handoff-complete block into
    their own block rendered only when `stopMode === null` (server `applyContinueTask` refuses when `group.stopped` or
    any stop intent, `src/control/continuation.ts:245`). The batch "Continue selected tasks (n)" and
    "Resume (no continuation)" stay under `handoffActive && stopState === "handoff-complete"`. The fragment that wrapped
    the batch button alone was unwrapped.
- `web/src/locales/en.ts`: `stopBannerHow` (`Record` over `stopMode`) and `stopBannerExit` (`Record` over `stopState`)
  after `stopState`; `control.group.stopBanner: { how, exit }`.
- `web/src/locales/zh.ts`: `control.group.stopBanner.{how,exit}` (brief's text).
- `web/tests/stopBanner.test.tsx`: new, verbatim from the brief (7 tests). The `heading.nextElementSibling` assertion
  holds as written: Part A's refusal renders only when `props.refusal` is set (no wrapper), and the fixtures carry none.

## Existing tests rewritten (amendment (2) names them)

1. `web/tests/handoffResume.test.tsx`
   - "offers only the handed-off task, and the batch command carries only its selection": under handoff-complete it now
     asserts no `/^Continue task/` button (was: "Continue task b" present); the batch selection assertion is unchanged.
   - Added "offers a single task's continuation only once the group has no stop intent, and only for the handed-off
     task": same runs with `stop: null`; "Continue task a" absent, no batch button, clicking "Continue task b" sends the
     exact `continue-task` command.
2. `web/tests/controlI18n.test.tsx` "names every table column, the label filter and each dispatch button in Chinese":
   `继续任务 a` is no longer expected under handoff-complete; a new render with no stop intent expects it.
3. `web/tests/controlPanel.test.tsx` "shows handoff progress as pending/partial/unresolved and offers the batch
   continuation once requests settle": `settledHtml` now `not.toContain("Continue task a")`; a `resumed` (stop null)
   render expects it.

No other existing test went red.

## TDD

- RED: `cd web && ../node_modules/.bin/vitest run tests/stopBanner.test.tsx` → rc=1, 6 failed / 1 passed (only "renders
  no banner, and the Start button…" passed). First failures: "Start: expected <button> to be null" (shutdown test),
  "Pause dispatch: expected <button> to be null" (pending), "Unable to find an element by: [data-testid=\"stop-banner\"]".
  Output: scratchpad/orca/C3/c3-red.txt.
- After implementing: stopBanner green; exactly the three amendment-named tests red on "继续任务 a"/"Continue task b"
  (c3-green1.txt), then rewritten.

## Verification (all outputs under scratchpad/orca/C3/, read whole; load ~6.5–7.7)

- `web tsc --noEmit` rc=0 (c3-wtc.txt, empty)
- web vitest full: 82 files, 644 tests passed (c3-web.txt)
- `npm run --workspace web check` rc=0, 644/644 (c3-check.txt)
- `npm run typecheck` rc=0 (c3-tc.txt)
- `npm run build --workspace web` rc=0 (c3-build.txt)
- `tests/panel/refusalCoverage + scanPanelText + webParity`: 3 files, 12 tests passed (c3-root.txt)
- full `tests/panel`: 64 files, 493 tests passed (c3-panel.txt)

## Mutations (git clone --local after b9cf916, web built, clone discarded)

Worktree `git diff | wc -c` / `git diff --cached | wc -c`: 0 0 before and 0 0 after (/usr/bin/git).
Run set: stopBanner, handoffResume, controlI18n, controlPanel (33 tests; unmutated 33/33 green).

| # | Mutation | Red |
|---|---|---|
| 1 | `handoffActive = stopMode === "handoff"` | shutdown resume-dialog test, shutdown pending test, "shows the banner in Chinese" |
| 2 | Start gate `&& !handoffActive` | "does not offer Start on a paused ready group…" |
| 3 | delete the banner block | the four banner tests + controlI18n "shows the control summary, one group, recovery and the workspace mode in Chinese" |
| 4 | continue-task gate removed (`continuable.map` unconditional) | controlPanel "shows handoff progress…", handoffResume "offers only the handed-off task…" |
| 5 | banner moved after the plan line (before BudgetEditor) | "says how the group stopped… at the top of the group view" |
| 6 | continue-task never rendered (`false &&`) | handoffResume new no-stop test, controlPanel "shows handoff progress…", controlI18n "names every table column…" |

Process note: my first mutation pass reported rc=1 for every mutation but was invalid ("No test files found": zsh did
not word-split the file-list variable). Caught by reading the output; the pass was rerun with explicit paths (table above).

## Deviations from the brief

- Amendment (2) applied (not in the brief's code): per-task Continue buttons gated on `stopMode === null` and moved out
  of the handoff-complete block; three web tests rewritten as listed.
- Line numbers moved (Part A); edits made by anchor text. The banner sits after Part A's group refusal, as the brief allows.
- Two extra mutations (4, 6) for the amendment's branch, per Rule 9.

## Concerns

1. With a handoff (or shutdown) at handoff-complete and **some runs continuable**, the dialog offers only "Continue
   selected tasks (n)" (all continuable) — "Resume (no continuation)" is shown only when nothing is continuable (existing
   behaviour, pinned by handoffResume test 1). Now that the per-task buttons are hidden under the intent, a person who
   wants to continue only one of several held tasks has no path from the panel: they must continue all. Ruling 2's
   stated cost ("a person must resume before continuing a single task") assumes a resume-without-continuation is
   offered, which it is not in that case. Not changed (would rewrite an un-named test); suggest the controller decide
   whether to also offer "Resume (no continuation)" when continuable > 0.
2. controlI18n does not assert the absence of `继续任务 a` under handoff (mutation 4 kept it green); handoffResume and
   controlPanel do, so the branch is pinned.

## Ruling follow-up (coordinator ruling on concern 1)

Commit: `6a88636 fix(web): offer a plain resume beside the batch continuation at handoff-complete`.

- `web/src/ControlGroupView.tsx`: "Resume (no continuation)" now renders under `handoffActive && stopState ===
  "handoff-complete"` whether or not tasks are continuable (dropped `&& continuable.length === 0`); comment cites the ruling.
- Rewritten (approved): `web/tests/handoffResume.test.tsx` "offers only the handed-off task, and the batch command
  carries only its selection" — no longer asserts that "Resume (no continuation)" is absent.
- Added: `web/tests/handoffResume.test.tsx` "offers a resume with no selections beside the batch continuation when tasks
  are continuable" — both buttons render; pressing the plain resume sends exactly
  `{ verb: "resume-from-handoff", groupId: "g", expectedRevision: 6, payload: { selections: [] } }`.
- TDD: before the change, the new test was RED ("Unable to find … button … Resume (no continuation)"), 1 failed and 4 passed
  (scratchpad/orca/C3/f1-red.txt).
- Green: web tsc rc=0; `npm run --workspace web check` 82 files / 645 tests; web build rc=0; full tests/panel 64 files /
  493 tests (load 16.9 / 9.3 / 7.5 at that point).
- Root `npm run typecheck` in the shared worktree was RED: `src/panel/controlLifecycle.ts(5..7,10): TS2300 Duplicate
  identifier 'recordActivity'`. That file has uncommitted edits by another implementer (D1). I did not touch it.
  `npm run typecheck` in a `git clone --local` of 6a88636 is rc=0 (f1-clone-tc.txt), so my commit is clean.
- Mutation 7 (clone of 6a88636, web built): restoring `&& continuable.length === 0` makes the new test go red (1 failed / 33 passed);
  unmutated 34/34. Clone discarded. Worktree `git diff -- web | wc -c` and `git diff --cached | wc -c`: 0 0 before and
  after (the whole-tree diff is not 0 because of D1's uncommitted src/ edits).
