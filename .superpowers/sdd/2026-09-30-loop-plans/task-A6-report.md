# Task A6 report: read-only loop plan card and task-list chip

Implementer: session `1d7d9aa0` subagent (Opus 5.5), 2026-09-30. BASE `4bec875`, commit `a2010f0`.
SCRATCH = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/1d7d9aa0-4a2b-478b-b0ec-d970d3a51afe/scratchpad/a6/`.

## What was implemented

- `web/src/LoopPlanCard.tsx` (new): `loopPlanTitle(plan)` and `LoopPlanCard({ view, item })`, as the brief specifies, with
  English strings (R-F5, P1):
  - title `<planName> · v<n> · chosen by hand | chosen by label \`<l>\` | no label, default[ · changed]`;
  - summary list `aria-label="Plan summary <taskId>"` rendering `loopPlan.summary` verbatim (server-built, not rebuilt);
  - `<details>` (closed) with summary `Check commands (<n>)` and the commands in `<code>`;
  - `Budget: <tokens> tokens · active time <ms> ms · max attempts <n>` from the task's `work` allocation (omitted if none);
  - `Git workspace: its own worktree, merged back into orca/<groupId>; pushing is done by a person`;
  - `Skill set: not supported yet`;
  - `loopPlan === null` -> `Hand-written contract` with `Goal: …` / `Done when: …` (when `objective` is present);
  - `loopPlan === undefined` -> no card.
  - Section `aria-label="Plan <taskId>"`.
- `web/src/TaskDetail.tsx`: import + `<LoopPlanCard view={view} item={item} />` before `Runs of`.
- `web/src/ControlGroupView.tsx:130`: `<span className="plan-chip"> {planName}</span>` after the label chips.
- `web/tests/loopPlanCard.test.tsx` (new): the brief's 6 criteria with English values, plus 3 added for P3 (see Departures).

## RED (before implementation)

`(cd web && ../node_modules/.bin/vitest run tests/loopPlanCard.test.tsx) > a6/a6-red.txt` -> rc=1,
`Tests 7 failed | 1 passed (8)`. All 7 fail for the expected reason (no heading / list / details text / budget text /
chip). The 1 pass is "shows no card when the view says nothing about the plan" -- a guard test that is trivially green
before the card exists; its red is shown by MA6-14 below.

## GREEN

- `(cd web && ../node_modules/.bin/vitest run tests/loopPlanCard.test.tsx tests/taskLabels.test.tsx tests/taskLabelsDraft.test.tsx tests/taskLabelsDraftBase.test.tsx tests/controlPanel.test.tsx) > a6/a6-green.txt` -> rc=0, 5 files, 33 tests passed (loopPlanCard then had 8).
- After adding the 9th criterion: `vitest run tests/loopPlanCard.test.tsx > a6/a6-green2.txt` -> rc=0, 9 passed.
- Neighbouring web criteria (every web test file that renders App/ControlPanel/ControlGroupView/TaskDetail, 16 files):
  `a6/a6-neighbours.txt` -> rc=0, 83 passed. No existing criterion turned red.
- Web typecheck `(cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json)`: `a6/a6-web-tsc.txt` and
  `a6/a6-web-tsc2.txt` -> rc=0, empty. Root `npm run typecheck` not run: no root file touched.

## Mutations (clone `$SCRATCH/mut-a6`, kept; copy check `a6/a6-copy.txt` empty)

Runner `a6/runmut.sh` (exact-match single replacement via `a6/mutate.py`; each run also runs web tsc; restore by `cat`,
proof by `cmp` into `a6-<name>-restore.txt`). Red test names digested in `a6/a6-mut-digest.txt` (awk of `FAIL`/`Tests`
lines from the full per-mutation files `a6/a6-MA6-<n>.txt`, which are kept whole).

| Name | Edit | Criterion red | vitest rc | tsc rc | Restore |
|---|---|---|---|---|---|
| MA6-1 | `<details>…</details>` -> inner `<ul>` | keeps the check commands collapsed | 1 | 0 | rc=0, 0 bytes |
| MA6-2 | chip removed from ControlGroupView:130 | puts the plan's name next to the labels in the task list | 1 | 0 | rc=0, 0 bytes |
| MA6-3 | `=== undefined` -> `!item.loopPlan` | shows a hand-written task's goal and success condition | 1 | 0 | rc=0, 0 bytes |
| MA6-4 | delete Git workspace paragraph | shows the work budget and the two dimensions … (D1) | 1 | 0 | rc=0, 0 bytes |
| MA6-5 (P3) | delete `explicit ? "chosen by hand" :` | says chosen by hand and changed when they hold | 1 | 0 | rc=0, 0 bytes |
| MA6-6 (P3) | delete `chosenByLabel === null ? "no label, default" :` | says a plan chosen with no label came from the default | 1 | 0 | rc=0, 0 bytes |
| MA6-7 (P3) | delete `amended ? " · changed"` | says chosen by hand and changed when they hold | 1 | 0 | rc=0, 0 bytes |
| MA6-8 (P3) | hand-written branch disabled (`if (false as boolean)`) | shows a hand-written task's goal … | 1 | 2 | rc=0, 0 bytes |
| MA6-9 (P3) | delete `objective !== undefined &&` guard | leaves out the budget line with no work row, and the goal lines with no objective | 1 | 2 | rc=0, 0 bytes |
| MA6-10 (P3) | delete `work !== undefined &&` guard | leaves out the budget line … | 1 | 2 | rc=0, 0 bytes |
| MA6-11 (P3) | delete Skill set paragraph | shows the work budget and the two dimensions … (D1) | 1 | 0 | rc=0, 0 bytes |
| MA6-12 (P3) | delete Budget paragraph | shows the work budget and the two dimensions … (D1) | 1 | 0 | rc=0, 0 bytes |
| MA6-13 (P3) | delete `<LoopPlanCard …/>` in TaskDetail | 6 card tests (title, collapsed, D1, chosen by hand, default, hand-written) | 1 | 0 | rc=0, 0 bytes |
| MA6-14 (P3) | delete `if (item.loopPlan === undefined) return null;` | shows no card when the view says nothing about the plan | 1 | 2 | rc=0, 0 bytes |
| MA6-15 (P3) | chip unconditional (`item.loopPlan!.planName`), criterion `tests/taskLabels.test.tsx` | 6 taskLabels tests (fixtures carry no loopPlan -> crash) | 1 | 0 | rc=0, 0 bytes |

Note: MA6-9/MA6-10 were first run before the 9th criterion existed and were green at runtime (typecheck-red only);
the criterion was added and both re-run red (the later files overwrite the first). MA6-1..8 and 11..15 were run with
the 8-criterion test file; the 9th criterion was only added afterwards (additive), so their red evidence still holds.
All 15 mutations are seen red under vitest; none relies on typecheck alone.

## Files changed

- `web/src/LoopPlanCard.tsx` (new)
- `web/src/TaskDetail.tsx` (+2 lines)
- `web/src/ControlGroupView.tsx` (line 130)
- `web/tests/loopPlanCard.test.tsx` (new, 9 criteria)

## Commits

- `a2010f0 feat(web): show a task's loop plan on its card and in the task list` -- trailer checked in `a6/a6-msg.txt`
  (both lines present, exact).

## Self-review

- Strings match R-F5/P1 exactly (checked against the table); summary lines are the server's (`loopPlan.summary`), the
  fixture uses the exact strings `describeLoopPlan` produces for that input (`src/control/loopPlans.ts:247-253`).
- Chip class `plan-chip` (not `label`), so `taskLabels.test.tsx`'s `td span.label` collection is unaffected (green).
- The budget line reads the task's `work` allocation from `view.allocations`, like the brief; it does not rebuild
  anything from the recipe.

## Departures from the brief

1. English strings everywhere (R-F5, P1) -- the brief's code and test values are Chinese.
2. `summary` in the collapsed list pinned: the collapsed test also asserts `Check commands (1)` (P1 string).
3. Three criteria added for P3 (branches the brief's tests did not reach): "says a plan chosen with no label came from
   the default" (MA6-6), "leaves out the budget line with no work row, and the goal lines with no objective"
   (MA6-9/10 runtime red), "shows no card when the view says nothing about the plan" (MA6-14).

## Concerns

- None blocking. The chip's absence for a hand-written task (`loopPlan: null`) is not asserted directly; MA6-15 shows
  the guard is load-bearing only via fixtures without `loopPlan` (undefined) crashing.
