# Task B6 report — the editable plan card

Implementer: session `1d7d9aa0` (Opus 5.5), BASE 92ef663, commit **d49c7af** `feat(web): change a loop task's plan, inputs and budget on its card`.
SCRATCH = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/1d7d9aa0-4a2b-478b-b0ec-d970d3a51afe/scratchpad/b6/` (mutation clone: `.../scratchpad/mut-b6`, kept).

## What was implemented
- `web/src/controlApi.ts`: `SetTaskLoopPayloadV1` import; `ControlAction` gains the `set-task-loop` member; `controlCommandPath` case → `/api/control/groups/<g>/tasks/<t>/loop`.
- `web/src/LoopPlanCard.tsx`: replaced as the brief says, with every string in English (R-F5, P1): `loopDraftKey`, `consequenceOf`, `LoopPlanCardProps` (now with drafts/onDraft/onCommand), a `LoopPlanEditor` (draft = typed text + base loopVersion + plan; `Change plan` button; form `Change plan <taskId>`; status `The plan changed after you started this draft (v{a} → v{b})`; alert and disabled submit for `Group reserve too small: <dim> short by N`; submit text `Budget +D tokens, taken from the group reserve; R left` / `Budget -D …, returned to the group reserve; R left` / `Budget unchanged`, units `tokens` / `ms active time` / `attempts`, parts joined by `; `; `Discard draft`; `Started; the plan is frozen` for a started task). A6's read-only half unchanged.
- P9: `payloadOf` returns `{ payload } | { invalid }`, so a bad budget shows `Budgets must be positive integers` and a bad file cap shows `Max files changed must be a positive integer` (both as the alert and as the disabled submit's text).
- `web/src/TaskDetail.tsx`: passes drafts/onDraft/onCommand to `LoopPlanCard`.
- `web/src/App.tsx`: imports `loopDraftKey`; clears the loop draft after a set-task-loop answer < 400.
- `ControlGroupView.tsx` not touched (P10).

## Criteria
`web/tests/loopPlanEdit.test.tsx` (8 tests; the 4 from the brief plus 4 added for P3/P9, below) and `web/tests/loopPlanDraft.test.tsx` (1 test, App level).

RED — `(cd web && ../node_modules/.bin/vitest run tests/loopPlanEdit.test.tsx tests/loopPlanDraft.test.tsx) > b6-red.txt` → rc=1, 5 failed of 5: four with `Unable to find … button … "Change plan"` / `Unable to find … "Started; the plan is frozen"`, and `expected undefined to be '/api/control/groups/g/tasks/a/loop'` — the reasons the brief predicts. After scoping the App criterion (departure 1) it was re-run red alone: `b6-red-draft2.txt` rc=1, `Unable to find … "Change plan"` inside `Plan a`.

GREEN —
- `vitest run loopPlanEdit loopPlanDraft loopPlanCard taskLabels taskLabelsDraft taskLabelsDraftBase controlCommandRecovery loopBudgetRows` → `b6-green.txt` rc=0, 8 files, 34 tests passed (before the last two added criteria); `b6-green-edit2.txt` rc=0, loopPlanEdit 8/8 after them.
- Whole web suite, run in the clone (not the main tree) with all six files copied (`copy.txt` empty): `web-all.txt` rc=0, 37 files, 186 tests passed. No existing criterion red.
- Web typecheck `b6-web-tsc.txt` / `b6-web-tsc2.txt` rc=0 (empty). Root `npm run typecheck` `b6-tsc.txt` rc=0.

## Mutations (clone `mut-b6`; criterion = loopPlanEdit + loopPlanDraft + loopPlanCard; every restore `cmp` rc=0 with a 0-byte file `MB6-n-restore.txt`; per-mutation output `MB6-n.txt`; summary `mut-summary.txt`)
| # | Edit | Red criterion |
|---|---|---|
| MB6-1 | `payloadOf({ ...draft, base: plan.loopVersion })` | sends the plan … loopVersion the draft started from |
| MB6-2 | `disabled={false}` + guard `&& blocked === null` removed | disables the submit and names the shortfall; names what blocks a send (P9) |
| MB6-3 | `const started = false;` | freezes a task that has started …; counts a task as started … |
| MB6-4 | `case "set-task-loop"` deleted | sends set-task-loop to the task's loop route; App draft criterion (refusal never shown) |
| MB6-5 | App clear line deleted | App: `expected <input aria-label="Goal"> to be null` |
| MB6-6 (P3) | version-changed status line deleted | sends the plan … |
| MB6-7 (P3) | `BAD_BUDGET` return deleted | names what blocks a send (P9) |
| MB6-8 (P3/P9) | `BAD_FILE_CAP` return deleted | names what blocks a send (P9) |
| MB6-9 (P3) | shortfall assignment deleted | disables the submit and names the shortfall |
| MB6-10 (P3) | "returned to the group reserve" arm removed | says a lowered budget goes back … |
| MB6-11 (P3) | "Budget unchanged" arm removed | says a lowered budget …; App draft criterion |
| MB6-12 (P3) | Discard draft → no-op | says a lowered budget … Discard draft drops the draft |
| MB6-13 (P3) | editor guard `work !== undefined` removed | loopPlanCard: leaves out the budget line with no work row … (A6) |
| MB6-14 (P3) | started: lineage half removed | counts a task as started … |
| MB6-15 (P3) | started: status half removed | counts a task as started … |
| MB6-16 (P3) | readLoopDraft base/plan check deleted | reads a stored draft it cannot trust … |
| MB6-17 (P3) | readLoopDraft text check deleted | reads a stored draft it cannot trust … |
| MB6-18 (P3) | catch returns a bogus draft | reads a stored draft it cannot trust … (TypeError) |
| MB6-19 (P3) | frozen text changed | freezes …; counts … |
| MB6-20 (P3) | `Change plan` onClick → no-op | 5 criteria |
All 20 rc=1 with exactly the named tests red. None typecheck-only.

## Files changed
`web/src/controlApi.ts`, `web/src/LoopPlanCard.tsx`, `web/src/TaskDetail.tsx`, `web/src/App.tsx`; new `web/tests/loopPlanEdit.test.tsx`, `web/tests/loopPlanDraft.test.tsx`.

## Departures from the brief
1. **App criterion scoped to the card.** The App page already has an import form whose textarea is named `Goal` (seen in `b6-red.txt`), so the brief's `screen.getByRole("textbox", { name: "Goal" })` would match twice, and its final `queryByRole(... "Goal") toBeNull()` could never pass. The criterion looks up `Change plan`, `Goal` and the `/^Budget/` submit `within(region "Plan a")`, with a comment saying why. Same assertions otherwise.
2. **Four criteria added to loopPlanEdit** (P3/P9): the P9 messages; lowered budget / unchanged / Discard draft; started by status alone or lineage alone; untrustworthy stored drafts. These were written after the implementation, so they were first seen red under their mutations (MB6-7..20), not before implementing. The Discard-draft lookup is scoped to the form `Change plan a`, since the label editor has its own `Discard draft` button.
3. English strings throughout (R-F5, P1, P9) instead of the brief's Chinese. P9's message is also the disabled submit's text.
4. Test fixture copy: the brief's "verbatim" copies were taken by line (loopPlanCard.test.tsx 14–42; taskLabelsDraft.test.tsx 1–64), with the edits the brief lists. `config` in loopPlanEdit is unused, as copied.

## Self-review / concerns
- The page now has two `Discard draft` buttons at once while a plan draft is open (the label editor's and the plan form's). They are in different regions/forms, but have the same accessible name. The name is the one P1 set; I left it.
- `consequenceOf` compares against the explicit unallocated reserve only and is display only, as the brief says; the server decides.
- The consequence text joins parts with `; ` though each part already contains `; ` (R-F5's mapping of `；`). With more than one dimension changed, it reads a bit dense.
- The status line's `→` is the Unicode arrow from P1.
