# Final fix wave re-review (F1-F11)

- Who: scoped re-reviewer (subagent of controller session `1d7d9aa0`). When: 2026-09-30.
- Fix base `4117725`, head `07240ff`. Read: final-fix-findings.md, final-fix-report.md, review-4117725..07240ff.diff.
- Checks run: read-only greps of `src/control/webService.ts:581`, `src/scheduler/planFile.ts:37-158` and `web/tests/loopPlanEdit.test.tsx:37`. No tests were re-run.

## Finding verdicts

- **F1**: ADDRESSED. `tests/control/loopPlanImport.test.ts` restores `expect(sha256Canonical(archived.plan)).toBe(archived.planHash)` as the first assertion (diff line 274).
  - MF1-2 bypasses import's four self-checks. It goes red at this equality, and the HEAD criterion stays green under it. That shows the equality is the half that can see the mutant.
- **F2**: ADDRESSED. `web/tests/loopBudgetRows.test.tsx` adds a `task a / reserve` row and an `estimate a / work` row, and asserts that the hinted rows are exactly `["task a / work"]`.
  - MF2-1 (MB4-9) and MF2-2 (MB4-10) are each red on the extra row.
  - Both guards are kept.
- **F3**: ADDRESSED. `web/src/LoopPlanCard.tsx:144` now reads `Discard plan draft`. The label editor keeps `Discard draft`.
  - `loopPlanEdit` asserts exactly one `Discard draft` button, and none inside the form. It clicks the button by its new name.
  - MF3-1 (the rename reverted) is red.
- **F4**: ADDRESSED. `web/src/LoopPlanCard.tsx:111-114` offers the editor only when the state is draft or ready and `stopMode === null`. This matches the server guard at `src/control/webService.ts:581`.
  - The criterion covers `running`, `review` and `pause` as negatives, and `draft` as a positive control. The base fixture is `ready` (`loopPlanEdit.test.tsx:37`).
  - MF4-1, MF4-2 and MF4-3 are each red.
  - The frozen line and the move of loopPlanDraft's fixture from running to ready were accepted by the controller.
- **F5**: ADDRESSED. Two new criteria, each with a named deletion mutation seen red:
  - the first-dimension shortfall: MF5-4;
  - blank-line filtering: MF5-1;
  - the goal and successCondition trims: MF5-2 and MF5-3.
- **F6**: ADDRESSED. `tests/panel/taskLoopApi.test.ts:+300-303` requires the lookup to answer 404 `command-result-not-found`.
  - MF6-3 ledgers the refusal. It is red under the new criterion and green under the old one.
- **F7**: ADDRESSED. `web/tests/loopPlanCard.test.tsx` renders a `loopPlan: null` row, confirms the row is present, and asserts no `span.plan-chip`.
  - MF7-1 is red.
- **F8**: ADDRESSED. `src/scheduler/run.ts:158-172` appends the loop rejections, read from the raw tasks, to loadPlan's rejections.
  - Criterion (a) was red at HEAD. MF8-1 through MF8-8 are each red.
  - Consistency check: `"loop" in raw` agrees with `isLoopPlanTask` (`planFile.ts:37`, `"loop" in task`) for any plan that loadPlan accepts. JSON cannot carry `undefined`, and the schema refuses `loop: null`. So the post-accept filter at `run.ts:173` is unchanged in effect.
- **F9**: ADDRESSED. `src/control/taskAmendments.ts:30` has the history-only comment.
- **F10**: ADDRESSED. The five moves put the new keys in alphabetical position in `src/control/errors.ts`. The diff changes no status, and it adds or removes no key.
- **F11**: ADDRESSED. The comment is at `tests/control/loopPlanE2E.test.ts:238-239`.
  - The finding named `ccloopWorld.ts` or the B7 criterion. The comment sits beside `loopFor` in the B7 criterion file, which satisfies the "/ the B7 criterion" alternative.

## New breakage in the fix diff

None at Critical or Important.

- Minor: a raw task that carries both `contract` and `loop` now yields `malformed` plus `loop-plan-cli-unsupported:<id>`. Before this change it yielded `malformed` alone.
  - This is consistent with the aim of reporting everything at once, and it is not wrong.
  - No criterion pins it.

## Out-of-scope observations

- The web guard reads `summary.stopMode`, and the server reads `group.stopped`.
  - I did not trace whether these can diverge, for example after `continuation.ts:218` clears `stopped`.
  - If they can, the card might hide the form where the server would accept, or the reverse.
  - The server remains the authority. Non-blocking.

## Verdict

**Fix round:** all findings addressed, and no new Critical or Important breakage.

The Part B gate (B8 full suite) is still owed, per the fix report's concern 6.
