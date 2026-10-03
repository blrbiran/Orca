# Task 7 review (2ea3271..bacb9d7)

### Spec Compliance

- ✅ Spec compliant (verified from the diff). The card shows the declared set (profile, profile plus frozen names, names, none) in `web/src/LoopPlanCard.tsx` `skillSetText`. The run view lists each lock entry's name, commit or "local", and md5 in `web/src/SkillsGiven.tsx`. Both locales get the strings, and zh is typed `Translation<typeof en>`, so a missing key fails tsc. Absent fields are omitted rather than set to null, in `src/panel/controlViews.ts` (`...(x === undefined ? {} : ...)` and `run.drive?.skills == null ? {}`). The old "not supported yet" assertions are changed in exactly 3 places, which the report lists.
- ⚠️ Cannot verify from the diff:
  - `snapshot?.skills?.find(entry => entry.taskId === ...)?.names` (controlViews.ts:142) assumes the Task 5 `ExecutionSnapshotV1.skills` shape. The server test exercises it end to end through `stepA2`, so the shape is probably right; the controller should check that `tsc` is green.
  - The report says 12 mutations were seen red. I did not re-run them. The table is plausible and covers each new branch, but none of the 12 targets the schema in webProtocol.ts, which is the only place a mutation would escape (see Minor 3).

### Strengths
- The server test (tests/panel/skillsView.test.ts) runs a real A2 against the fake syncskill. It asserts that the view's lock equals the drive record's lock and that `JSON.stringify(view)` does not contain the local `dir`. The no-skills case asserts the keys are absent, which is the "bytes unchanged" requirement.
- Web tests assert the whole row contents (`["a","run-a","beta","local","md5-beta"]`), not just substrings. They include a run without skills that must not appear, and zh coverage for every branch.
- Wire schemas are `.strict()`, and `dir` is deliberately kept off the wire, with M12 pinning it.
- The change is small and surgical. The payload code is untouched.

### Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)
None.

#### Minor (Nice to Have)
1. `src/panel/controlViews.ts:165` and `src/control/webProtocol.ts` (run `skills`): `profile` and each lock entry's `source` (including `url`) go on the wire, but no UI uses them. This is extra surface beyond the brief's name, `resolved_commit` and `content_md5`. It is harmless, since it is data the operator already owns, and it is stated in the report. Either drop them or render them in a later task.
2. `web/src/SkillsGiven.tsx:401`: the commit is truncated to 12 characters, but the constraint says to show `resolved_commit`. This matches the existing GitScheme convention and the test pins it. It is fine as long as the truncation is intended; the full md5 is shown, so the asymmetry is visible.
3. `src/control/webProtocol.ts` (`runViewSchema.skills`, `loopPlanViewSchema.frozenSkillNames`): no test parses the view through these schemas, so a wrong or removed schema entry would not go red. The report's M10 and M11 mutate the producer, not the schema. If a strict schema is applied at the wire, a mismatch would only show in a live run. Add one `runViewSchema.parse` of a skills-bearing view.
4. The report admits the full root suite was not compared against a baseline (23 scheduler files fail in the clone because `resolveCcloopBin` finds no ccloop binary). This is plausibly environmental, but the controller should run `tests/scheduler` once on the real checkout before the final gate.
5. `web/src/SkillsGiven.tsx:386`: the `run.taskId !== null` filter has no named mutation. A run with a lock and a null taskId would show a blank task cell instead of being filtered. Low impact.
