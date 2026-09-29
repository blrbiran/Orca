# Task A5 re-review, fix round 1 (4bec875 on ab4f2c9)

- MA5-4b (`amended` forced false) and MA5-5b (`loopVersion` forced 0): ADDRESSED.
  tests/control/loopPlanView.test.ts adds "reports a work item's amendment and loop version": it writes
  amendmentHash (64 hex) and loopVersion 2 into the loop task's work_items body and asserts
  `toMatchObject({ amended: true, loopVersion: 2 })` after the write, through readControlGroup.
  The code under test is src/panel/controlViews.ts:494 (`amended: typeof body.amendmentHash === "string", loopVersion: body.loopVersion ?? 0`);
  forcing either field to false/0 fails the assertion. The report records both mutants red (rc=1) with restore cmp 0 bytes.
  Not re-run; the evidence files a5-MA5-*-fix1.txt were not in the sdd directory, so the red runs are unverified claims, but the reasoning from code holds.

New breakage in the fix diff: None. Test-only change (13 lines); the assertion follows the write, so it is not the never-red shape.
The report's warning that B1's effectivePlanTask will make this hash unresolved (task-amendment-invalid) is a legitimate hand-off to B1.

Out-of-scope: none.
