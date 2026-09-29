# Task B1 review: amendment records and the effective-contract reader

Reviewer: task-reviewer sub-agent of Orca session `1d7d9aa0`, 2026-09-30. Reviewed `a2010f0..3a75bd7` from
`review-a2010f0..3a75bd7.diff`, plus the brief, the report, `global.md` and `rulings.md`. I ran no tests. My only
commands were read-only `git grep` / `git show` at the two SHAs. Their outputs are in the session scratchpad:
`rv-b1-grep-head.txt`, `rv-b1-grep-bd.txt` and `rv-b1-ctx.txt`.

### Spec Compliance

- ✅ Spec compliant. Every file in the brief has its hunk:
  - `taskAmendments.ts` (new);
  - `executionSnapshot.ts`: the `verifyTaskSet` loop head at diff l.54-57 and A2 at l.79-82;
  - `queries.ts:141-145`;
  - `webService.ts:467-469`;
  - `controlViews.ts:722-723,745`;
  - `taskAmendments.test.ts` (new).

  The departures are all authorized:
  - **P5:** `recipeExpandsTo` replaces the inlined `expandRecipe` plus the comparison (`taskAmendments.ts:83`).
  - **R-F5:** the test expects `"Goal: …"`.
  - **Controller ruling:** the `loopPlanView.test.ts` rewrite.
- **Named risk 1: the routed readers, and the No readers left alone.**
  - I checked the plan's reader table (plan l.158-185) against the diff. All five "Yes" rows are routed:
    - `verifyTaskSet`;
    - A2;
    - `readArchivedContract`;
    - the confirm `tasks`;
    - `validateExecutionSnapshot` and `workViews`, both through `readControlGroup`'s effective `plan`.
  - No "No" row has a hunk. The ones I checked:
    - `verifyPlanAuthority` still compares only the archived bytes against `planHash` (`rv-b1-ctx.txt` l.10-41);
    - estimate create and claim, and `completeEstimateInStore`;
    - `agentFreeze`;
    - `setTaskLabels`;
    - `readGroupSummary` / `taskCompletion` (task ids only);
    - `readRunEvidence` (runs only);
    - `planImport`.
  - I re-ran the drafter's grep at HEAD (it was drafted at `bd7590c`). One new reader has appeared since, A5's
    `taskPlanView` (`controlViews.ts:481-495`). It is reached only through `workViews`, so it now reads the
    effective entry. That also fixes the A5 review's `objective` minor, which is pinned by
    `taskAmendments.test.ts:61` (diff l.489).
  - Nothing else new reads a contract.
- **Named risk 1b: a group with no amendments behaves byte-for-byte as before.**
  - `effectivePlanTask` returns `archived` itself (the same reference) in each of these cases:
    - `work` is not an object (`null` from `workBodyOf` covers a missing row and an unparsable one);
    - the object has no `amendmentHash`;
    - `amendmentHash` is `null`.
  - `readControlGroup`'s `{ ...archived.plan, tasks }` therefore carries identical entries.
  - Work bodies written before B1 carry neither field: `planImport.ts:296-302` writes neither `amendmentHash` nor
    `loopVersion`. So the new `workAmendmentStateSchema` refusal cannot fire on them.
  - The only new side effect is one extra `SELECT` per task per read.
- **Named risk 2: the A5 criterion.** `loopPlanView.test.ts > reports a work item's amendment and loop version` now
  writes a real expanded contract and a `writeTaskAmendment` record at `loopVersion: 2`. It points the work item at
  that record, and still asserts `toMatchObject({ amended: true, loopVersion: 2 })` (diff l.414). Its MA5-4b and MA5-5b
  mutations were re-run red.
- ⚠️ Cannot verify from this diff: A2 now re-derives from the effective entry at **read** time. So once B2/B3 amend a
  task after confirmation, A2 refuses unless that command also replaces the frozen derived record. The plan puts
  `replaceTaskInSnapshot` in B3. The controller should check that B3's criterion covers "amend after confirm, then
  A2 reads".

### Strengths

- `effectivePlanTask` (`taskAmendments.ts:70-89`) fails closed. Every error inside the verification, whether a missing
  record, a parse failure or a thrown `expandRecipe`, collapses to the single detail `task-amendment-invalid:<taskId>`.
  It never falls back to the archived entry.
- The implementer found a vacuous tamper in the brief. The hand-written case was refused by the recipe check, so
  MB1-11 stayed green. They fixed it (the `from` parameter, test l.456-460 and l.527) so that only the
  `archived.loop === undefined` check can refuse the record. This is Rule 9 applied properly.
- P3 coverage goes beyond the brief:
  - new tamper cases for a non-hash `amendmentHash` and a missing `loopVersion`;
  - `workBodyOf` assertions;
  - a writer-validation criterion;
  - MB1-5b/5c, which split the projection bypass into its two call sites.

  Each has named red evidence. The equivalent mutants (P3e, P3f, P3j) are declared, with reasoning, not hidden.
- The first criterion checks both sides. The non-amended task `b` still reads `write b` (diff l.484), and the archived
  plan's hash and bytes are unchanged after confirm (l.490-491).

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

None.

#### Minor (Nice to Have)

1. **`taskAmendments.ts:87` is dead code.** The line is
   `if (error instanceof ControlError && error.detail === detail) throw error;`. The implementer's own MB1-P3e shows
   that deleting it is behavior-equivalent: `invalid()` throws the same code and detail. Deleting it would leave
   nothing to mutate. The line is kept because the brief wrote it, so leaving it is acceptable.
2. **`taskAmendments.ts:57` is also equivalent (MB1-P3f).** The line is `if (row === undefined) return null;`. The
   explicit guard is clearer than depending on a caught `TypeError`, so keep it. It is noted only because Rule 9
   treats an unkillable branch as unmeasured.
3. **The writer-validation test cannot tell failures apart** (`taskAmendments.test.ts`,
   `refuses to store an amendment record that is not well formed`, diff l.512-513). It uses a bare `.toThrow()`, so
   any throw passes it, including one from a broken fixture. Asserting a `ZodError` (or its message) would pin the
   intent.
4. **The implementer's concern: a `driverRecovery.test.ts` retried-run timeout.** It reproduces on a pristine
   `a2010f0` clone (`b1/b1-base-driverRecovery.txt`), so B1 did not cause it. It should be re-run once no gate is
   loading the machine. That run is recommended here, not performed.

### Assessment

**Task quality:** Approved

**Reasoning:** All five "Yes" readers now go through a single fail-closed verifier. No "No" reader changed. A group
with no amendments gets the identical archived entries. Every new branch has a named deletion mutation seen red, or
is declared equivalent.
