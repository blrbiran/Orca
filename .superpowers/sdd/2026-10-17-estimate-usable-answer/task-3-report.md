# Task 3 report: repair in settlement

Who: implementer subagent (Claude Opus 5.5) for controller session 4de777f4, 2026-10-17. Commit 0213d16a on codex/round-20261017 (base 536ed9f2).

## Implemented
- `src/control/webService.ts` `completeEstimateInStore`: for a non-null raw answer, builds the RepairContext (plan hash, plan task ids, `readEstimateContract(...).instructionVersion`) and runs `repairEstimateOutput`. On ok, the repaired value goes to `classify`. On failure, reasonCode is `estimate-output-invalid` and classify is skipped. A null answer never reaches repair, so the existing `estimate-call-failed[:code]` path is unchanged. `estimate.repairs = repairs` is written on every settled estimate, ready or failed (`[]` when nothing was repaired or repair failed). The raw canonical record is still written as before.
- New `export interface EstimateFailure { reasonCode; problems }` and a private `estimateFailureProblems(...)`. The local `failure: EstimateFailure | null` is computed after classification, ready for Task 5:
  - repair failed: repair's problems;
  - `estimate-call-failed:single-call-output-invalid`: `["no-json-object"]`;
  - any other `estimate-call-failed*`: `[]` (not retryable);
  - classify refused a repaired answer, or the answer is not canonical: `problemsFromRefusal(budgetEstimateSchema.safeParse(judged) issues, notCanonical)`. If that is empty (for example a post-repair plan-mismatch), it falls back to `["output-not-canonical"]`, as the controller ruled.
- `estimator.ts` is unchanged. Zod issues come from `budgetEstimateSchema.safeParse` in the helper, so no `classifyEstimateOutputDetailed` was added. The classifier stays the only judge of the verdict.

## Criteria rewritten (Ruling comments, session 4de777f4)
- `tests/control/driverEstimate.test.ts`: the row "an answer for another plan → plan-mismatch" becomes "an answer about another task → estimate-output-invalid". A wrong hash is now repaired; that case is covered in the new file.
- `tests/control/estimateOutcome.test.ts` settlement it.each: removed the "another plan" row (it now settles ready, covered in the new file). "Other tasks" now expects `estimate-output-invalid`. The classifier's own plan-mismatch unit assertions are untouched.

## Tests
New: `tests/control/estimateRepairSettle.test.ts` (5 tests, driven through estimateHarness):
- evidence answer (duplicate `a`, placeholder second) → ready, `repairs:["duplicate-task-dropped:a"]`, output equals the first entry, raw record kept, used tokens 777;
- valid answer → `repairs: []`;
- wrong planHash → ready, `["plan-hash-copied"]`;
- missing task → failed `estimate-output-invalid`, raw record kept;
- failed call with errorCode `single-call-output-invalid` → `estimate-call-failed:single-call-output-invalid`, `repairs: []`.

Results (outputs in /private/tmp/claude-501/o3/):
- RED (red.txt): `vitest run tests/control/estimateRepairSettle.test.ts` exit 1, all 5 failed (no `repairs` field; evidence answer was `estimate-output-invalid`). Expected, since there was no repair yet.
- GREEN (run2.txt), with ORCA_CCLOOP_BIN and CCLOOP_CACHE_DIR set: `vitest run estimateRepairSettle + driverEstimate, estimateOutcome, estimateE2E, estimateSchema, estimator` exit 0, 6 files and 81 tests passed.
- Full suite (full.txt), same env: exit 0, 426 files passed, 3884 tests passed, 36 skipped. I did not check whether the skip count matches the base. `npm run typecheck` exit 0.

## Mutations
Done in clone /private/tmp/mut-Lz5F/c (`git clone --local`, node_modules symlinked). Baseline there: 5/5 green. Every restore showed `git diff` 0 bytes and `git diff --cached` 0 bytes.
- M1, bypass repair (`classify(rawOutput, …)`): evidence test and wrong-hash test RED.
- M2, drop `estimate.repairs = repairs`: all 5 RED.
- M3, repair failure falls through to classify: missing-task test RED (got plan-mismatch).
- M4, run repair on a null answer too: failed-call test RED.

## Concerns
- The `failure.problems` branches (`no-json-object`, `[]`, refusal and fallback) have no observable effect until Task 5 consumes them, so no mutation can be seen red yet. Task 5's tests must cover them.
- Settlement now reads the estimate contract for every non-null answer. A missing contract throws `recovery-blocked` and rolls back the settlement. `prepare` already requires the contract, so this should not happen in the driver path.
