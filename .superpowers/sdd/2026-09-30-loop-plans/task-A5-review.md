# Task A5 review — projection recipe check and `loopPlan` view

Reviewer: session `1d7d9aa0` reviewer subagent (Opus 5.5), 2026-09-30. Reviewed `1fc5271..8df7fd3` from
`review-1fc5271..8df7fd3.diff`. Read-only; no tests re-run.

### Spec Compliance

- ✅ Spec compliant. Every file the brief lists has its hunk: `src/control/webProtocol.ts` (import, `loopPlanViewSchema`,
  the two `workItemViewSchema` fields), `src/panel/controlViews.ts` (imports, `workBodySchema` +2 fields, `taskPlanView`,
  spread at the `workViews` return), `web/src/controlTypes.ts` (two optional fields, three appended types), and both new tests.
  The field shapes match the brief's Interfaces block.
- There are three departures. Each is justified:
  - `planName: "Bug fix (red first)"` in `tests/control/loopPlanView.test.ts:20` follows R-F5.
  - The extra module `src/control/loopRecipeCheck.ts` follows P5: B1 must reuse the check.
    It is needed as a separate module because a `vi.mock` of `loopPlans.js` would not intercept an internal call.
    That claim is correct: ESM module mocks replace exports, not intra-module bindings.
  - The import line in `controlViews.ts:11-12` changes to match.
- ⚠️ Cannot verify from the diff: the `webFixture` `loop`/`labels` inputs (A3/A4) and `describeLoopPlan`/`choosePlanByLabels`
  (A1/A2) are prior tasks' code. The controller should check that B1's brief is rewritten to call `recipeExpandsTo` and to expect
  English summary text. The implementer's concern 3 is correct on this point.

### Strengths

- `recipeExpandsTo` (`src/control/loopRecipeCheck.ts:9-12`) is the single P5 check. Its doc comment names the reason it lives in its own module.
- `taskPlanView` (`src/panel/controlViews.ts:476-498`) fails loud with a named detail (`loop-plan-recipe-mismatch:<taskId>`) and does not render
  a plan that is not the one that runs. The `!` on `describeLoopPlan` is justified inline.
- The drift criterion (`tests/control/loopPlanDrift.test.ts:28-31`) asserts the same group with drift off, then with drift on. So the red
  on the throw is not a fixture artefact. The positive precondition runs after the call under test and cannot be a read-back.
- The mutation table is broad (19 rows) and goes beyond the brief's three. It includes the typecheck-only kills (MA5-1c, MA5-10b/c, MA5-11), and
  the three survivors are declared openly (Rule 12).

### The three surviving mutants (Rule 9 / P3 verdict)

- **MA5-4b (`amended` → `false`)**: not an equivalent mutant. `typeof body.amendmentHash === "string"` is a new branch added in this task
  (`controlViews.ts:493`). Its true side is observable today: a work body carrying `amendmentHash` is accepted by the new
  `workBodySchema` field (`controlViews.ts:83`) and changes the view. No criterion drives that side, so this is a **criterion gap on a new branch**.
- **MA5-5b (`body.loopVersion ?? 0` → `0`)**: same verdict. The present-value side of the new `??` (`controlViews.ts:493`) is observable and
  untested. MA5-5 kills only the absent side.
- The claim "no criterion can make it true until B1" is inaccurate. The repo already patches stored bodies directly to exercise view
  branches (`tests/control/driverProgress.test.ts:42-46` `patchRun`, `UPDATE runs SET body=?`). The same pattern on `work_items`
  kills both mutants now. P3 says every new branch *your task* adds, so deferring the kill to B1 does not satisfy it.
- **MA5-10 (delete `loopPlan?` from web `WorkItemViewV1`)**: not a runtime branch. It is a type-mirror field, so Rule 9's branch clause
  does not strictly apply. It survives because of a **pre-existing blind spot** in `tests/panel/webParity.test.ts:138-153`:
  mutual assignability cannot see a missing *optional* property, since TS allows extra properties on non-literal assignment.
  `labels?` and `progress?` share the gap. It is a real parity gap, but it is not this task's regression.

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

1. **`src/panel/controlViews.ts:493` has two new branches with no criterion that can go red: `amended` true and `loopVersion` present
   (MA5-4b, MA5-5b green).** This is a Rule 9 / P3 violation. It matters because a view that always reports `amended: false` or
   `loopVersion: 0` would make `set-task-loop` (B2) fail every edit with `task-loop-version-conflict`. The panel would also mislabel amended
   plans. Nothing in A5 would catch that before B1/B2 land.
   Fix: add one criterion to `tests/control/loopPlanView.test.ts`. For a loop task, rewrite the `work_items` body with
   `amendmentHash: "a".repeat(64), loopVersion: 2` via `UPDATE work_items SET body=? WHERE group_id='g' AND ...`, mirroring `patchRun`.
   Then assert `loopPlan` `toMatchObject({ amended: true, loopVersion: 2 })`. Re-run MA5-4b and MA5-5b and record both red.
   If the controller prefers to defer to B1, that is a P3 exception, and it must be recorded as such with an explicit re-run obligation on B1.

#### Minor (Nice to Have)

1. `tests/panel/webParity.test.ts:138-153`: the MA5-10 blind spot. A cheap compile-time key-set check closes it for this type and for the
   pre-existing `labels?`/`progress?`:
   `const _k: [Exclude<keyof ServerWorkItemViewV1, keyof WebWorkItemViewV1>] extends [never] ? true : false = true;`
   (and the reverse). This is outside A5's brief, so log it for a follow-up and do not fix it here.
2. `tests/control/loopPlanView.test.ts:17-21`: `inputs: recipe.inputs` and `summary: describeLoopPlan(recipe)!.summary` are computed from
   the same archived recipe and the same function the production code uses. They pin the wiring, but not the content: a wrong input
   default or wrong summary text would pass here. Content is A1/A2's criteria, so this is acceptable, but note the dependency.
3. `src/panel/controlViews.ts:481`: every task now parses `originalContractCanonicalJson` on each `readControlGroup`. That adds a new fail path,
   `original-contract-invalid:<taskId>`, which has no criterion. This is low risk: the archived plan is `planHash`-checked upstream and the
   helper `parseStored` is pre-existing.
4. `src/control/webProtocol.ts` comment "the effective contract's goal": in A5 it is the *original* contract (`controlViews.ts:481-482`).
   That is correct until B1 introduces amendments. B1 must switch the source, or the comment will become false.

Checks run:
- (a) The risk that the derived contract changes the objective, which would make `objective` stale. I grepped `src/control/executionSnapshot.ts`:
  the derived contract only checks `objective.taskId` (l.183) and does not rewrite goal or successCondition. No issue.
- (b) The feasibility of killing MA5-4b/5b now. I found the `patchRun` precedent in `tests/control/driverProgress.test.ts:42-46` and confirmed that
  `work_items` is the table read by `controlViews.ts:512`.
- (c) The MA5-10 mechanism. I read `tests/panel/webParity.test.ts:108-153`: the check is assignability-only, and there is no key-set comparison.

### Assessment

**Task quality:** Needs fixes

**Reasoning:** The implementation is correct and matches the brief, and the recipe check is sound and properly single-sourced. However, MA5-4b and MA5-5b are
not equivalent mutants. They leave two new, observable branches with no criterion able to go red, and one existing test pattern closes that gap now.
MA5-10 is a pre-existing parity-checker blind spot and is only Minor.
