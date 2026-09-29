# Final fix wave — complete findings list (controller, from final-review.md + ledger)

Fix every item. Each production change needs a criterion seen red first (or a deletion mutation seen red, if the
criterion is added after), per Rule 9. Criteria written in this round (all loop-plans test files) may be edited;
pre-existing criteria may not.

Must fix:
F1 (Important) tests/control/loopPlanImport.test.ts ~32-39: restore `expect(sha256Canonical(archived.plan)).toBe(archived.planHash)` (P7 wrongly dropped it; the surviving `!==` is vacuous). Show it red under a mutation where planHash is computed without the recipe.
F2 web/src/BudgetEditor.tsx ~275: add one criterion with a task row of another bucket, or a non-task row whose ownerId equals a loop task id, that goes red under MB4-9 and MB4-10 (keep both guards).
F3 Rename the plan form's discard button to exactly `Discard plan draft` (web/src/LoopPlanCard.tsx ~140); the label editor keeps `Discard draft`. Update the criteria that name it.
F4 web/src/LoopPlanCard.tsx ~110-112: offer no "Change plan" (read-only card) when the group summary state is not draft/ready or `stopMode !== null` — the server always refuses there. Criterion + mutation.

Recommended, same wave:
F5 B6 unmutated branches: first-dimension-only shortfall (LoopPlanCard.tsx ~60), blank-line filtering in `lines()` (~93), goal/success trimming — a named deletion mutation each, seen red (add a criterion where none can go red).
F6 tests/panel/taskLoopApi.test.ts ~63/137: the "before the ledger" criterion must assert the refused command is absent from the ledger (or a lookup 404), as its name says.
F7 web/tests/loopPlanCard.test.tsx: assert a hand-written task (`loopPlan: null`) shows no chip in the task list (ControlGroupView.tsx ~130); mutation seen red.
F8 src/scheduler/run.ts ~162-167: report loop refusals together with loadPlan's other rejections (all at once), not only when there are none. Criterion + mutation.
F9 src/control/taskAmendments.ts: one comment line that `previousContractHash` is history only and is not verified.
F10 src/control/errors.ts ~49,119-126: put the new codes in the map's alphabetical order (no behavior change).
F11 tests/control/fixtures/ccloopWorld.ts / the B7 criterion: one comment that tasks a and b share answer.txt in their write sets on purpose (the fake codex always reports it).

Not in scope (stay registered): everything else in progress.md.
