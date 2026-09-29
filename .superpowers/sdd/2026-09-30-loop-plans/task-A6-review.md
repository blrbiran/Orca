# Task A6 review (BASE 4bec875, HEAD a2010f0), reviewer session on Sonnet 5.5

### Spec Compliance
- ✅ Spec compliant. D9 principle holds: the card renders `loopPlan.summary` verbatim (LoopPlanCard.tsx:41-43), never contract JSON; command text appears only inside the closed `<details>` (LoopPlanCard.tsx:44-47) and the summary lines carry only "Acceptance: N check commands"; all strings match the R-F5/P1 table (title, Goal/Done when, Budget, Git workspace, Skill set, Hand-written contract, Check commands (n), Plan / Plan summary aria-labels). Chip uses `plan-chip` (ControlGroupView.tsx:130), not `label`. TaskDetail hunk inserted before `Runs of`.
- ⚠️ Cannot verify from diff: that `describeLoopPlan` output for the fixture equals PLAN.summary (implementer cites src/control/loopPlans.ts:247-253); that the 16 neighbour web files stay green (reported rc=0, 83 passed).

### Strengths
- Card is a pure function of the view; no rebuilding of server text. Null/undefined distinction (older server vs hand-written) handled and both tested.
- Mutation discipline beyond the brief (P3): 15 named deletions, each seen red under vitest, restore proven by cmp; three criteria added for branches the brief's tests missed (default-label title, no-work/no-objective guards, undefined -> no card).
- Chip class choice keeps taskLabels.test's `td span.label` collection unaffected.

### Issues
#### Critical
none
#### Important
none
#### Minor
- web/tests/loopPlanCard.test.tsx:105-108: the chip test only covers a plan-bearing item. Nothing asserts that a hand-written task (`loopPlan: null`) shows NO chip; the `item.loopPlan ?` guard in ControlGroupView.tsx:130 has its null arm unpinned (MA6-15 only exercises undefined). Add one assertion with `loopPlan: null`, and a mutation `item.loopPlan ?` -> `item.loopPlan !== undefined ?` that crashes it red.
- web/src/LoopPlanCard.tsx:25-27 vs 33: both sections use `aria-label="Plan <taskId>"` while the h5 text differs; a screen-reader landmark named "Plan a" is fine, but consider aria-labelledby the h5. Cosmetic.
- LoopPlanCard.tsx:46-47 Budget shows raw ms / unformatted token counts (matches R-F5 table verbatim; readability only).
- Report note: MA6-1..8, 11..15 ran against the 8-criterion file, not the final 9-criterion file; low risk (criterion 9 is additive) but a final full re-run of the mutation set was not done.

### Assessment
**Task quality:** Approved
**Reasoning:** Small, faithful, English-string-compliant implementation of the read-only card; D9 holds and new branches have red-seen deletion mutations. Only a missing negative chip assertion for hand-written tasks.
