# Task B4 report — one owner for a loop task's work budget

Implementer: session `1d7d9aa0` (B4 subagent), 2026-09-30, on `main` at base `6a44547`. Commit: `661273e`.
Evidence directory: `SCRATCH/b4/` (SCRATCH = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/1d7d9aa0-4a2b-478b-b0ec-d970d3a51afe/scratchpad`).
Mutation clone: `SCRATCH/mut-b4` (kept).

## What was implemented

- `src/control/errors.ts`: `"budget-owned-by-loop-plan": 422`, next to B2's 422 entries, with a comment citing spec §4.3 (C6).
- `src/control/webService.ts` `editProposal`: after `assertKnownConservation`, the set of loop tasks is read from the archived
  plan (`task.loop !== undefined`). Inside the operations loop, after the duplicate check and before `allocationFor`, an
  operation whose target is `scope: "task"`, `allocation: "work"` and a loop task is refused with `budget-owned-by-loop-plan`.
  The code is the brief's.
- `web/src/BudgetEditor.tsx`: `WorkItemViewV1` type import; exported `loopOwned(item)`. `targetOf` returns null for a loop
  task's work bucket, so that row gets no input, `editedOperations` skips it, and `suggestedOperations` skips it too (no
  field "use" button, no "Apply row", nothing in "Apply all"). This covers R-F14. The read-only cell shows the amount, plus
  `<small> Change it in the plan card</small>` (English per R-F5) when the row is a loop task's work row.
- `tests/control/loopBudgetOwner.test.ts`: the brief's criterion, verbatim.
- `web/tests/loopBudgetRows.test.tsx`: the head of `web/tests/budgetHandoffCapability.test.tsx` (lines 1–36 re-measured,
  imports through the `view` literal) with the brief's changes. The doc comment cites spec §4.3. `allocations` has 4 rows.
  `workItems` holds `a` (`loopPlan: LOOP_PLAN`, the `PLAN` literal of `web/tests/loopPlanCard.test.tsx` lines 24–28
  renamed) and `c` (`loopPlan: null`). There are the brief's two criteria, with the expected text in English
  (`Change it in the plan card`). **Added a third criterion** (see departures): with a ready estimate suggesting 4000 work
  tokens for both tasks, `suggestedOperations(all)` returns only `c`'s work operations. The rendered editor has no
  `Apply row a work` button and no `use … for a work …` button, and it still shows `Apply row c work`.

## RED (before implementing)

- `vitest run tests/control/loopBudgetOwner.test.ts` → `b4/b4-red.txt`, rc=1: `expected undefined to match object { code:
  'budget-owned-by-loop-plan' }`, at line 21. The loop work edit was accepted. This is the expected reason.
- `(cd web && vitest run tests/loopBudgetRows.test.tsx)` → `b4/b4-web-red.txt`, rc=1, 3/3 failed:
  - (1) `expected <input … value="3000"> to be null`: the editor rendered an input for `a work tokens`.
  - (2) `editedOperations` returned the `a` work operation.
  - (3) `suggestedOperations` included `a`'s work tokens and activeMs.

  All three failures have the expected reason.

## GREEN

- `vitest run loopBudgetOwner proposal confirmation setTaskLoop setTaskLoopConfirmed` → `b4/b4-green.txt`, rc=0: 5 files,
  38 passed.
- `(cd web && vitest run loopBudgetRows budgetSuggestions budgetHandoffCapability controlPanel loopPlanCard)` →
  `b4/b4-web-green.txt`, rc=0: 5 files, 33 passed.
- Neighbours: every other root file that sends `proposal-edit` (`panel/agentSelectionApi`, `panel/controlApi`,
  `webProtocol`, `agentPlanImport`, `webMutations`, `estimateE2E`, `estimator`, `agentFreeze`, `stopIntent`), plus
  `panel/webParity` → `b4/b4-neighbours.txt`, rc=0: 9 files passed and 1 skipped, 140 passed and 3 skipped. **The 3 skipped
  tests are `estimateE2E.test.ts`.** They are gated by the pre-existing `describe.skipIf(!realBinary)`, because no real
  ccloop binary is present. B4 did not cause the skip.
- `npm run typecheck` → `b4/b4-tsc.txt`, rc=0, no errors. Web typecheck → `b4/b4-web-tsc.txt`, rc=0, 0 bytes.
- No existing criterion turned red.

## Mutations (clone `mut-b4`)

Setup:
- Clone: `b4-clone.txt`, rc=0. Copy check: `b4-copy.txt`, 0 bytes.
- Driver: `b4/mutate.py`. Each pattern is asserted to occur once. Restore rewrites the file from REPO, then runs `cmp` into
  `b4-<M>-restore.txt`. All 10 restore files are 0 bytes, with cmp rc=0.
- Summary: `b4-mut-summary.txt`.
- Server mutations run `loopBudgetOwner`. Web mutations run `loopBudgetRows`, `budgetSuggestions` and
  `budgetHandoffCapability`.
- MB4-7 and MB4-8 dump the DOM, so their text output is 2.5k and 1.4k lines. I re-ran them with vitest's JSON reporter
  (`b4/mutate-json.py` → `b4-MB4-7.json`, `b4-MB4-8.json`) and read the per-test status list (`b4-MB4-{7,8}-status.txt`)
  whole.

| Name | Edit | Red criterion (evidence) |
|---|---|---|
| MB4-1 (brief) | delete the server `if (… ) throw new ControlError("budget-owned-by-loop-plan")` line | `refuses proposal-edit on a loop task's work row, and only there`: `expected undefined` at l.21 (`b4-MB4-1.txt`) |
| MB4-2 (brief) | drop `op.target.allocation === "work" &&` | same criterion: the handoff edit is refused `budget-owned-by-loop-plan`, l.22 (`b4-MB4-2.txt`) |
| MB4-3 (brief) | delete the `targetOf` loop line | all 3 `loopBudgetRows` criteria (`b4-MB4-3.txt`) |
| MB4-4 (P3) | drop the `.filter(task => task.loop !== undefined)`, so every task counts as a loop task | same server criterion: `c`'s work edit is refused, l.23 (`b4-MB4-4.txt`) |
| MB4-5 (P3) | delete the `errors.ts` entry | server criterion red (the ControlError is thrown, not a durable outcome) **and** typecheck red: TS2345, not a `KnownControlErrorCode` (`b4-MB4-5.txt`, `b4-MB4-5-tsc.txt`) |
| MB4-6 (P3) | delete the `{owned ? <small> Change it in the plan card</small> : null}` text | `shows the loop task's work row read-only, pointing at the card, …` (`b4-MB4-6.txt`) |
| MB4-7 (P3) | `loopOwned` without `item.loopPlan !== undefined &&` | 3 existing `budgetSuggestions` criteria: `offers every field whose suggestion differs…`, `sends one proposal-edit per control…`, `drops the unsaved drafts…`. Their items have no `loopPlan` field and became read-only (`b4-MB4-7-status.txt`) |
| MB4-8 (P3) | `loopOwned` without `&& item.loopPlan !== null` | all 3 `loopBudgetRows` criteria (`b4-MB4-8-status.txt`) |
| MB4-9 (P3) | the cell's `owned` without `allocation.bucket === "work" &&` | **survived** (`b4-MB4-9.txt`, 11/11 green) |
| MB4-10 (P3) | the cell's `owned` without `allocation.ownerKind === "task" &&` | **survived** (`b4-MB4-10.txt`, 11/11 green) |

Result: 10 run, 8 red, 2 survived.

The 2 survivors are sub-conditions of the brief's display-only `owned` expression, and they are unobservable by construction:
- A cell reaches `target === null` for a task row only when `targetOf` already returned null for a loop work row. A loop
  task's handoff row always has a target.
- A non-task row (`reserve`, `estimate`) would need an `ownerId` equal to a task id.

I kept them as the brief wrote them, as a defensive guard. Deleting them is also defensible (Rule 2). This is flagged for
the controller, not changed.

## Files changed

- `src/control/errors.ts` (+2)
- `src/control/webService.ts` (+3)
- `web/src/BudgetEditor.tsx` (+10 −1)
- `tests/control/loopBudgetOwner.test.ts` (new, 26 lines)
- `web/tests/loopBudgetRows.test.tsx` (new)

## Commits

- `661273e` feat(control): give a loop task's work budget one owner, set-task-loop. I checked the trailer in `b4/b4-msg.txt`:
  both lines are present, exactly as specified.

## Self-review / concerns

1. **Survivors MB4-9 and MB4-10.** See above. They affect only the hint text's guard, never what is sent to the server.
2. **The server reads the archived plan, not the effective contract.** `loopTasks` comes from `readArchivedPlan(...).plan.tasks[].loop`. That is right
   today: `set-task-loop` refuses a task without a plan-level `loop` (`task-has-no-loop-plan`), so the set of loop tasks
   cannot change after import. If a later task lets a hand-written task gain a loop plan, this read must follow it.
3. **The hint repeats per dimension.** "Change it in the plan card" is rendered once per dimension cell (4 times on the
   row), as the brief's cell-level code places it. The criterion uses `toContain`, so this is only cosmetic.
4. **The web read-only rule depends on the view.** The editor decides read-only from `workItems[].loopPlan`, which the
   server always sends. A stale view is still refused by the server (MB4-1).

## Departures from the brief

- The expected text is `Change it in the plan card`, not `在做法卡片里改` (R-F5, and the dispatch note).
- Added a third web criterion for R-F14: no suggestion or apply button for the loop work row. The brief's two criteria reach
  the suggestion path only through the shared `targetOf` line, and the dispatch names suggestions explicitly. MB4-3 turns
  it red.
- The GREEN run included `setTaskLoop`, `setTaskLoopConfirmed` and `loopPlanCard`, and I ran the neighbour sweep over every
  file that sends `proposal-edit`.
- I ran 7 mutations beyond MB4-1..3 (P3). For MB4-7 and MB4-8 I used JSON-reporter evidence instead of the DOM-dump text.
