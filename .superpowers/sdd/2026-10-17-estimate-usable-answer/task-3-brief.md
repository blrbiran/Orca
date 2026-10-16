### Task 3: Repair in settlement

**Files:**
- Modify: `src/control/webService.ts` (`completeEstimateInStore`), `src/control/estimator.ts` (only if `classifyEstimateOutput` needs to expose zod issues: add `classifyEstimateOutputDetailed` returning `issues`; keep the old export's behavior)
- Test: `tests/control/estimateRepairSettle.test.ts` (drive through `tests/control/fixtures/estimateHarness.ts`, whose synthetic single-call answer the test sets)

**Interfaces:**
- Consumes: Task 1 `repairEstimateOutput`, `problemsFromRefusal`; Task 2 `repairs`.
- Produces: inside `completeEstimateInStore`, after the call is classified, a local `failure: { reasonCode: string; problems: string[] } | null` that Task 5 consumes (problems empty only for non-retryable codes).

- [ ] **Step 1: Failing tests**: the evidence answer (duplicate `a`, placeholder second) settles `ready` with `repairs: ["duplicate-task-dropped:a"]`, the output equals the first entry, usage booked as before; a valid answer settles `ready` with `repairs: []`; a missing-task answer settles `failed` with reasonCode `estimate-output-invalid` (repair failed; it no longer reaches the plan-mismatch check) and the raw record is kept; `null` with callFailure `single-call-output-invalid` → `failed`, `estimate-call-failed:single-call-output-invalid`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: contract's `instructionVersion` and the plan's task ids form the `RepairContext`; repair runs only on a non-null raw answer; on `ok` the repaired value goes to `classify`; `repairs` is written on every completed estimate. A repair failure keeps reasonCode `estimate-output-invalid`. Existing criteria that pinned `estimate-output-plan-mismatch` for an answer repair now fixes (wrong planHash, reordered tasks) are rewritten with a Ruling comment.
- [ ] **Step 4: Run** the new file and `tests/control/{driverEstimate,estimateOutcome,estimateE2E,estimateSchema,estimator}.test.ts` — exit 0.
- [ ] **Step 5: Mutation**: bypass repair (classify the raw answer) → evidence test red.
- [ ] **Step 6: Commit** `feat(control): settle a repairable estimate answer as ready, with its repairs`.

