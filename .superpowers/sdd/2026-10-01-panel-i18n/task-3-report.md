# Task 3 report — DONE (was BLOCKED; resolved by controller ruling, see the section at the end)

Implementer subagent of session e604b1ba (controller session_01GCbsgLfqFPgpeG3gTbBkbh), 2026-10-01, BASE 545f881.
No commit made. The working tree of `main` holds the uncommitted Task 3 change (19 files, listed below). The same change
is saved as a patch at `$SCRATCH/t3-wip.patch` (68269 bytes, `git diff HEAD --binary` after `git add -N` on the two new files).

## Why blocked

An existing criterion that the brief's H18 rewrite list does not name turns red:

- **`tests/control/taskAmendments.test.ts > the effective contract (spec §5.1) > confirms, dispatches and shows an amended task as amended, and leaves the archived plan as it was`**
  - line 60: `expect(item.loopPlan!.summary[0]).toBe("Goal: write a, as amended");`
  - runtime: `TypeError: Cannot read properties of undefined (reading '0')` (`$SCRATCH/t3-green-root.txt`)
  - `npm run typecheck` rc=2: `tests/control/taskAmendments.test.ts(60,29): error TS2339: Property 'summary' does not exist on type ...` (`$SCRATCH/t3-tsc.txt`)

The view no longer carries `summary` (spec §3.1), so this assertion cannot stand in its current form. The contract says to stop and
report it rather than rewrite it. The plan's rewrite list for Task 3 missed this file: the plan's grep evidently checked only
`loopPlan.summary`, not `loopPlan!.summary`.

Proposed rewrite (not applied), which keeps the intent that the view shows the amended recipe, not the archived one:
```ts
      // Rewritten under human ruling H18 (2026-10-01) for panel i18n: the view carries the recipe's fields, not the English line.
      expect(item.loopPlan!.inputs.goal).toBe("write a, as amended");
```
If the controller approves it under H18, the remaining work is: apply it, rerun Step 5 (all of it), run Step 6 (MT3-1 to MT3-12), and do Step 7
(add `tests/control/taskAmendments.test.ts` to the `git add` list).

## Done (uncommitted)

- Step 1 (P1: `.mts`): `REPO=$PWD ./node_modules/.bin/tsx "$SCRATCH/t3-capture.mts" > "$SCRATCH/t3-capture.txt"` rc=0, 40 lines;
  `cmp` against the brief's ROWS (brief lines 94-133) rc=0 (`$SCRATCH/t3-rows-brief-cmp.txt` is empty). The registry at 545f881 still
  produces exactly the plan's rows.
- Step 2: `web/tests/loopSummary.test.tsx` and `tests/control/loopPlanViewFields.test.ts` were extracted verbatim from the brief.
  The ROWS check `cmp "$SCRATCH/t3-capture.txt" "$SCRATCH/t3-rows-in-test.txt"` gave rc=0 with an empty `t3-rows-cmp.txt`. The named H18
  rewrites were applied to loopPlanView, taskLoopApi and the six web fixtures, plus loopPlanCard :51/:75. `tests/control/loopPlanSummary.test.ts`
  was removed with `git rm`.
- Step 3 red: `$SCRATCH/t3-red-root.txt` rc=1. Both loopPlanViewFields tests, loopPlanView "shows the plan…" and taskLoopApi "mirrors every
  plan's current version…" (`version` undefined) are red. `$SCRATCH/t3-red-web.txt` rc=1: loopSummary 43/43 red (not a function), and loopPlanCard 7 red
  (`plan.summary` undefined; chip '').
- Step 4: implemented as the brief specifies. Deviations are layout only. The LoopPlanCard header sentence and the controlViews
  `taskPlanView` doc were rewrapped to the file's line width after the substitution. The taskLoopApi block was de-indented by 2 (the brief's
  markdown list indent). The loopPlanCard :51 `expect` became two lines, as the brief shows `.toEqual(...)` on its own line.
- Step 5:
  - root criteria `$SCRATCH/t3-green-root.txt` rc=1. 12 files pass; only the taskAmendments test above is red.
  - `npm run typecheck` `$SCRATCH/t3-tsc.txt` rc=2, from the same line.
  - `npm run check --workspace web` `$SCRATCH/t3-web-check.txt` rc=0: 44 files, 263 tests (loopSummary 43, i18nKeys 4).
  - leftovers (P12: `describeLoopPlan\|planName\|loopPlan\.summary` over src, web/src) `$SCRATCH/t3-leftovers.txt` rc=0. Every hit was checked,
    and none is a view field:
    - `agentSelection.ts:66,69` is an unrelated `planName` parameter.
    - `LoopPlanCard.tsx:42` is the brief's doc sentence naming the removed describeLoopPlan.
    - `LoopPlanCard.tsx:46-53` are the i18n keys `loopPlan.summary.*`.
- Step 6 mutations: **not run**. They wait until the criteria are green.
- Step 7 commit: **not made**.

## Files changed (uncommitted)
src/control/loopPlans.ts, src/control/webProtocol.ts, src/panel/controlViews.ts, tests/control/loopPlanSummary.test.ts (deleted, staged),
tests/control/loopPlanView.test.ts, tests/control/loopPlanViewFields.test.ts (new, intent-to-add), tests/panel/taskLoopApi.test.ts,
web/src/ControlGroupView.tsx, web/src/LoopPlanCard.tsx, web/src/controlTypes.ts, web/src/locales/en.ts, web/src/locales/zh.ts,
web/tests/loopBudgetRows.test.tsx, web/tests/loopPlanCard.test.tsx, web/tests/loopPlanDraft.test.tsx, web/tests/loopPlanEdit.test.tsx,
web/tests/loopSuggestionApply.test.tsx, web/tests/loopSuggestionDraft.test.tsx, web/tests/loopSummary.test.tsx (new, intent-to-add).

## Concerns
- The two new files are `git add -N` (intent-to-add) in the index, so that the patch includes them. Nothing else is staged apart from the `git rm`.
- The `loopPlanE2E.test.ts` ccloop-binary E2E was not run, per the brief's list. It does not reference the removed fields (the grep above over
  the whole repo excluding docs showed no hit).

## Resolution (same implementer, after the controller ruling)

Controller ruling (ledgered): the taskAmendments rewrite is inside H18 (spec §6.1 completes the list by scanning for `summary`).
Applied exactly: `tests/control/taskAmendments.test.ts:60` is now
`// Rewritten under human ruling H18 (2026-10-01) for panel i18n.` followed by
`expect(item.loopPlan!.inputs.goal).toBe("write a, as amended");`.

**Commit `bd6ccfc`** (parent 545f881): `feat(panel): send a loop plan's fields and build its words in the panel`, 20 files.
The message was read back with `/usr/bin/git log -1 --format=%B > $SCRATCH/t3-commit-msg.txt` and ends with the two trailer lines exactly.

### Step 5 rerun (before the commit)
- Root: the 13 files of Step 5 (taskAmendments included), `$SCRATCH/t3-green-root2.txt`, rc=0, 13 files, 158 tests passed.
- `npm run typecheck`: `$SCRATCH/t3-tsc2.txt`, rc=0, no output from tsc.
- `npm run check --workspace web`: `$SCRATCH/t3-web-check2.txt`, rc=0, 44 files, 263 tests.
- Leftovers (P12): hits recorded above. None is a loop-view field. The ruling says they are fine.
- Doc comment naming describeLoopPlan (`web/src/LoopPlanCard.tsx`, doc of `loopSummaryLines`): it was written this round, in this commit, verbatim from the brief. It
  says the lines are those "the server's describeLoopPlan **used to** send", which is a correct statement about a removed function. It is left
  as is. The `web/tests/loopSummary.test.tsx` header also names it in the past tense ("produced before its removal").

### Step 6 mutations (clone `$SCRATCH/mut-t3`, kept)
Setup:
- `git clone --local` rc=0 (`t3-clone.txt`).
- The 19 changed files were copied with cat and checked with cmp. `t3-copy.txt` is empty (0 bytes), and `loopPlanSummary.test.ts` was deleted in the clone.
- Baselines in the clone: `t3-mut-baseline-root.txt` rc=0 and `t3-mut-baseline-web.txt` rc=0.
- Mishap: the first copy attempt ran in zsh, which did not word-split the file list. It created one empty junk file at a path built from the whole list inside the clone. That single file was removed (non-recursive `/bin/rm -f`), and the empty directories are left in the clone. The copy was redone under bash.

Driver: `$SCRATCH/t3-mut.py`. It applies each edit to the clone, runs the named criterion into `$SCRATCH/t3-<name>.txt`, detects the named test on a `×`/`FAIL` line, then
restores with cat and checks with cmp into `t3-<name>-restore.txt`. Every restore file is empty with rc=0. The full run log is `$SCRATCH/t3-mut-run.txt`. The detector was checked by reading
`t3-MT3-3.txt` and `t3-MT3-10.txt` whole.

| Mutation | rc | Named test seen red |
|---|---|---|
| MT3-1 input cap, not the contract's | 1 | loopPlanViewFields > carries exactly the fields |
| MT3-2 hasDiscipline: true | 1 | same |
| MT3-3 .strict() to .passthrough() | 1 | loopPlanViewFields > refuses a view that still carries summary or planName |
| MT3-4 protected line always shown | 1 | loopSummary > standard v1 one-path |
| MT3-5 no "No file limit" | 1 | loopSummary > standard v2 one-path |
| MT3-6 discipline dropped | 1 | loopSummary > bugfix v1 one-path, and > never puts a check command… |
| MT3-7 no fallback in planText | 1 | loopSummary > shows a plan version this panel has no words for |
| MT3-8 en bugfix v2 name "Bug fix" | 1 | taskLoopApi > mirrors every plan's current version… |
| MT3-9 WEB_LOOP_PLANS standard version 1 | 1 | same |
| MT3-10 zh files_one differs | 1 | i18nKeys > gives each Chinese _one key…, and > keeps every placeholder… |
| MT3-11 chip shows the id | 1 | loopPlanCard > puts the plan's name next to the labels |
| MT3-12 separator hard-coded to ", " | 1 | loopSummary > builds the lines… in Chinese |
| MT3-13 (P16) goal line deleted | 1 | loopSummary > standard v1 one-path |
| MT3-14 (P16) doneWhen line deleted | 1 | same |
| MT3-15 (P16) onlyChanges line deleted | 1 | same |
| MT3-16 (P16) mustNotChange line deleted | 1 | loopSummary > standard v1 two-paths-protected-cap1 |
| MT3-17 (P16) files branch set to "" | 1 | loopSummary > standard v1 one-path |
| MT3-18 (P16) checks line deleted | 1 | same |
| MT3-19 (P16) byHand set to "" | 1 | loopPlanCard > says chosen by hand and changed when they hold |
| MT3-20 (P16) noLabel set to "" | 1 | loopPlanCard > says a plan chosen with no label came from the default |
| MT3-21 (P16) byLabel set to "" | 1 | loopPlanCard > titles the card with the plan… |
| MT3-22 (P16) " · changed" suffix dropped | 1 | loopPlanCard > says chosen by hand and changed when they hold |
| MT3-23 (P16) card's lines not rendered | 1 | loopPlanCard > titles the card with the plan… |
| MT3-24 probe: `useTranslation()` removed from LoopPlanCard | 0 over the whole web suite | none |

P16, sites no criterion sees:
- (a) `useTranslation()` in `LoopPlanCard`, which re-renders the card on a language change. MT3-24 shows no web criterion sees it.
- (b) the picker option text `planText(option.planId, option.version, "name")`. No web test reads the `<option>` text of the Plan select (checked by grep).

Neither has a criterion in this Task's brief.

### Evidence files
t3-capture.txt, t3-rows-brief-cmp.txt, t3-rows-cmp.txt, t3-red-root.txt, t3-red-web.txt, t3-green-root.txt (the blocked run), t3-tsc.txt,
t3-web-check.txt, t3-leftovers.txt, t3-green-root2.txt, t3-tsc2.txt, t3-web-check2.txt, t3-copy.txt, t3-mut-baseline-*.txt, t3-mut-run.txt,
t3-MT3-*.txt with their -restore.txt files, t3-commit-msg.txt. All are under `$SCRATCH`. `t3-wip.patch` is now superseded by bd6ccfc.
