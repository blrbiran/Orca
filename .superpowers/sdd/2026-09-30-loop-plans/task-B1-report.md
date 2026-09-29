# Task B1 report: amendment records and the effective-contract reader

Implementer session 1d7d9aa0, 2026-09-30. Commit `3a75bd7` on `main` (parent `a2010f0`). Evidence directory:
`SCRATCH/b1/` (SCRATCH = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/1d7d9aa0-4a2b-478b-b0ec-d970d3a51afe/scratchpad`).
Mutation clone: `SCRATCH/mut-b1`. Pristine HEAD clone, used for one pre-existing-failure check: `SCRATCH/base-b1`. Both clones are kept.

Status: DONE_WITH_CONCERNS. The concern is outside B1: a driverRecovery timeout that also fails on a pristine `a2010f0` clone.

## What I implemented

- `src/control/taskAmendments.ts` (new). It exports `TASK_AMENDMENT_SCHEMA`, `taskAmendmentSchema`, `TaskAmendment`, `ArchivedPlanTask`, `writeTaskAmendment`, `workBodyOf` and `effectivePlanTask`, as the brief gives them, with one change for ruling P5. The recipe check calls `recipeExpandsTo(archived.taskId, contract.context.repoPath, record.recipe, record.originalContractCanonicalJson)` from `loopRecipeCheck.ts` instead of repeating `expandRecipe` plus the comparison. So `expandRecipe` is no longer imported here.
- The readers go through `effectivePlanTask`, exactly as the brief says:
  - `verifyTaskSet` and `readConfirmedTaskExecution` in `executionSnapshot.ts`;
  - `readArchivedContract` in `queries.ts`;
  - the `tasks` list in `webService.ts` confirm;
  - `readControlGroup` in `controlViews.ts`, where the effective `plan` now feeds both `validateExecutionSnapshot` and `workViews`.
- Because `workViews` now receives the effective plan, `taskPlanView` reads `objective` from the effective contract. This is the A5 review minor. A new assertion pins it (see Departures).
- I rewrote the A5 criterion `tests/control/loopPlanView.test.ts > … > reports a work item's amendment and loop version` as the controller ruled. It now writes a real expanded contract and a real amendment record at `loopVersion: 2` through `writeTaskAmendment`. It points the work item at that record, including `originalContractHash` and `contract.contentAddressedHash`, and still asserts `{ amended: true, loopVersion: 2 }`.

## RED

- `./node_modules/.bin/vitest run tests/control/taskAmendments.test.ts > b1/b1-red.txt` gave rc=1: `Failed to load url ../../src/control/taskAmendments.js … Does the file exist?`. This is the expected reason (the module was not there yet).

## GREEN

- The brief's Step 4 set of 9 files, run in the main tree: `b1/b1-green-final.txt`, rc=0, 9 files and 121 tests passed. The only difference from the brief's command is the verbose summary.
- `npm run typecheck > b1/b1-tsc-final.txt`: rc=0. There was one earlier type error in my own test (`item.objective` possibly undefined). I fixed it by using `toEqual` on the whole object.
- Web typecheck: not run, because no file under `web/` was touched.
- A broader set of affected files ran in the mutation clone, whose files are byte-identical to the main tree (`b1/b1-clone-sync.txt` is empty). These are the 44 test files that import `readConfirmedTaskExecution`, `readArchivedContract`, `readControlGroup`, `prepareExecutionSnapshot` or `WebControlService`. Result in `b1/b1-broad.txt`: rc=1, 486 passed, 34 skipped, 3 failed, all 3 by timeout (`Test timed out in 5000ms`). A full gate was running on the same machine.
  - `driverProgress.test.ts` rerun alone: rc=0, 7 of 7 passed (`b1/b1-rerun-driverProgress.txt`).
  - `driverRecovery.test.ts > a person's recovery-retry on a blocked driver run (spec §2.3) > drives a retried run on from where it was blocked, to settled` rerun alone: it still timed out (`b1/b1-rerun-driverRecovery.txt`). It times out the same way on a pristine clone at `a2010f0` without B1 (`b1/b1-base-driverRecovery.txt`, rc=1, same test). So B1 did not cause it. It is either load or something that already existed; I did not look further.

## Mutations

Method: each mutation made one exact edit in `SCRATCH/mut-b1`, then ran the criterion file(s) with the verbose reporter. The file was restored with `cat` and the restore checked with `cmp`. Every restore gave `cmp` rc=0, and every `b1-<name>-restore.txt` is 0 bytes. Script: `b1/mutate.py`. Definitions: `b1/muts.json` and `b1/muts-ma5.json`. Summary: `b1/b1-mut-summary.txt`. All mutations were re-run against the final criterion file.

| Name | Edit | Result | Red criterion (evidence `b1/b1-<name>.txt`) |
|---|---|---|---|
| MB1-1 | A2: `effectivePlanTask(store, groupId, archived, workBodyOf(…))` → `archived` | RED | `confirms, dispatches and shows an amended task as amended…` (`recovery-blocked`: derived contract mismatch), plus all 9 tamper cases (A2 no longer throws) |
| MB1-2 | webService confirm: `effectivePlanTask(…)` → `archived` | RED | `confirms, dispatches…` (`plan-version-conflict`) |
| MB1-3 | verifyTaskSet: `effectivePlanTask(input.store, …)` → `archived` | RED | `confirms, dispatches…` (`plan-version-conflict`) |
| MB1-4 | readArchivedContract bypass | RED | `confirms, dispatches…` (`expected 'write a' to be 'write a, as amended'`, the readArchivedContract line) |
| MB1-5 | readControlGroup `plan` → `archived.plan` (+ loopPlanView.test.ts) | RED | `confirms, dispatches…` (`derived-contract-identity`); all 9 tamper cases (second assertion: `work-item-authority` / `work-item-invalid` / no throw); loopPlanView `reports a work item's amendment and loop version` (`work-item-authority:a`) |
| MB1-5b (P3) | only `validateExecutionSnapshot(…, archived.plan)` | RED | `confirms, dispatches…` (`derived-contract-identity`) |
| MB1-5c (P3) | only `workViews(…, archived.plan, …)` | RED | `confirms, dispatches…` and loopPlanView `reports a work item's amendment…` (`work-item-authority:a`) |
| MB1-6 | delete `record.groupId !== groupId \|\| ` | RED | `… a record for another group` |
| MB1-7 | delete `record.taskId !== archived.taskId \|\| ` | RED | `… a record for another task` |
| MB1-8 | delete `\|\| record.loopVersion !== (state.data.loopVersion ?? 0)` | RED | `… a loopVersion the work item does not carry` and `… a work item that carries no loopVersion` |
| MB1-9 | delete the `sha256Canonical(contract) !== record.originalContractHash` line | RED | `… a contract hash that is not the contract's` |
| MB1-10 | delete the `recipeExpandsTo(…)` line (under P5 this is the "expanded.canonicalJson !==" check) | RED | `… a recipe that does not expand to the contract` |
| MB1-11 | delete `if (archived.loop === undefined) return invalid();` | RED (after the criterion was strengthened, see Departures) | `… an amendment of a hand-written task` |
| MB1-12 | delete the not-an-object → `return archived` line | RED | `reads a task with no work row, or an unparsable one, as not amended` |
| MB1-P3a | delete `if (!state.success) return invalid();` | RED | `… an amendment hash that is not a hash` (new case) |
| MB1-P3b | delete `if (amendmentHash === null) return archived;` | RED | F11 criterion, `confirms…`, all tamper cases (confirm refuses) |
| MB1-P3c | `loopVersion ?? 0` → `?? 1` | RED | `… a work item that carries no loopVersion` (new case) |
| MB1-P3d | catch: `rethrow + return invalid()` → `throw error` | RED | `… an amendment hash with no record` (bare `recovery-blocked`, no detail) |
| MB1-P3e | delete the catch's rethrow line | GREEN, equivalent | `invalid()` throws the same code and detail, so behavior is identical. Only the stack differs. |
| MB1-P3f | delete `if (row === undefined) return null;` in workBodyOf | GREEN, equivalent | `undefined.body` throws inside the `try`, and the `catch` returns null. Same answer. |
| MB1-P3g | workBodyOf `catch { return null; }` → rethrow | RED | F11 criterion (new `workBodyOf` unparsable-body assertion) |
| MB1-P3h | writeTaskAmendment: drop `taskAmendmentSchema.parse` | RED | `refuses to store an amendment record that is not well formed` (new) |
| MB1-P3j | A2 `archived === undefined ? undefined : effectivePlanTask(…)` → `effectivePlanTask(…archived!…)` | GREEN, equivalent (ran taskAmendments, executionSnapshot, confirmation, controlReadApi) | The TypeError is caught by `readConfirmedTaskExecution`'s outer catch, which answers `recovery-blocked`, the same as the `!task` path. The guard exists for the types. |
| MA5-4b (re-run) | `amended: …` → `false` | RED | loopPlanView `reports a work item's amendment and loop version` (amended false), and B1 `confirms…` |
| MA5-5b (re-run) | `body.loopVersion ?? 0` → `0` | RED | the same two criteria (loopVersion 0) |

No mutation went red only under typecheck.

## Files changed (commit 3a75bd7)

- `src/control/taskAmendments.ts` (new)
- `src/control/executionSnapshot.ts`
- `src/control/queries.ts`
- `src/control/webService.ts`
- `src/panel/controlViews.ts`
- `tests/control/taskAmendments.test.ts` (new)
- `tests/control/loopPlanView.test.ts` (the A5 criterion, rewritten under the controller's ruling)

The trailer was checked in `b1/b1-msg.txt`: exactly the two lines.

## Departures from the brief, and why

1. **P5**: the brief inlines `expandRecipe` plus the comparison. I call `recipeExpandsTo` instead, as the ruling says. MB1-10 therefore deletes that call.
2. **R-F5**: the summary expectation is `"Goal: write a, as amended"`, not the Chinese string.
3. **Strengthened the hand-written tamper (Rule 9).** As drafted, the case used a record whose contract was expanded for task `a` with `taskId: "c"`. The recipe re-expansion check refused it anyway, so MB1-11 (deleting the `archived.loop === undefined` check) stayed green (seen in the first mutation run). I gave `amendment()` an optional `from` argument, meaning which task's recipe inputs to use. The tamper now builds a record expanded for `c` itself from `a`'s inputs, so only the missing-recipe check can refuse it. MB1-11 is now red.
4. **Criteria added for P3 branches the brief's list omits:**
   - tamper `an amendment hash that is not a hash` (for P3a);
   - tamper `a work item that carries no loopVersion` (for P3c);
   - `workBodyOf` assertions for a missing row and an unparsable body, inside the F11 criterion (for P3g);
   - a new criterion, `refuses to store an amendment record that is not well formed` (for P3h).
5. **Added `expect(item.objective).toEqual({ goal: "write a, as amended", successCondition: "a exists" })`** to the first criterion. It pins the A5 minor (objective read from the effective contract).
6. **Commit** includes `tests/control/loopPlanView.test.ts` (controller ruling). The commit message says so.

## Self-review

- Import cycle: `taskAmendments.ts` imports only `canonicalJson`, `errors`, `loopPlans`, `loopRecipeCheck`, `schema`, `snapshot`, `store` (type), `webProtocol` (type) and `planFile`. None of these imports `queries`, `executionSnapshot`, `webService` or `controlViews`.
- F11: a missing or unparsable work row reads as "not amended". The existing `executionSnapshot.test.ts` (with no work_items rows) is green.
- A bad record blocks with `recovery-blocked:task-amendment-invalid:<taskId>` in A2, the projection, the confirm path (a durable `recovery-blocked` result; seen in the P3b evidence) and `readArchivedContract`.
- Three P3 mutants are equivalent (P3e, P3f, P3j), with the reasoning above. I kept the brief's code rather than delete those lines.

## Concerns

- `tests/control/driverRecovery.test.ts > a person's recovery-retry on a blocked driver run (spec §2.3) > drives a retried run on from where it was blocked, to settled` times out at 5000 ms, alone as well. It does the same on a pristine `a2010f0` clone (`b1/b1-base-driverRecovery.txt`). It is not caused by B1. It may be machine load from the running gate; it should be checked once the gate finishes.
- The brief's green list does not include the driver/E2E files. I ran them only in the clone (the broader set above); the E2E files skipped there, as they normally do without their environment.
