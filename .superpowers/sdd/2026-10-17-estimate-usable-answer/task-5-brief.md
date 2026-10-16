### Task 5: The automatic retry

**Files:**
- Create: `src/control/estimateRetry.ts`
- Modify: `src/control/webService.ts` (`completeEstimateInStore`), `src/control/singleCallPurposes.ts` (`prepare` passes `contract.retryProblems`)
- Test: `tests/control/estimateRetry.test.ts`

**Interfaces:**
- Consumes: Task 2 fields, Task 3 `failure`, Task 4 `buildEstimatePrompt`/`estimateTaskIds`.
- Produces:
  - `export type RetryDecision = { kind: "retry"; problems: string[] } | { kind: "skip"; code: RetrySkipCode } | { kind: "none" }`
  - `export type RetrySkipCode = "group-not-prestart" | "budget-deficit" | "usage-unknown" | "dispatch-blocked" | "reserve-insufficient" | "proposal-changed" | "proposal-unknown" | "superseded" | "tokenizer-unavailable" | "input-too-large"`
  - `export function decideEstimateRetry(input: { estimate: EstimateRecord; contract: EstimateExecutionContractV1; failure: { reasonCode: string; problems: string[] } | null; group: <the WebGroup type completeEstimateInStore holds>; proposalVersion: number; newestEstimateVersion: number; reserveAfterSettlement: Amount; dispatchBlocked: boolean }): RetryDecision` — pure, total, never throws; `none` when the failure code is not retryable or the estimate has `origin`; skip checks in the spec §4.3 order.
  - `export function retryPromptFits(contract, request, problems): boolean` — frozen tokenizer ratio + framing overhead + output bound vs window and grant.
  - `export function writeEstimateRetry(store, groupId, failed: EstimateRecord, contract, problems): string` — new row (`origin`), new contract (`retryProblems`) via `persistEstimateArtifacts`'s writers, grant reserved, wake inserted; returns the retry id. Called only after `decideEstimateRetry` said `retry`.

- [ ] **Step 1: Failing tests** (estimate harness; count the synthetic ccloop's calls):
  - duplicate-free unrepairable answer → failed estimate `retriedAs: <id>`, retry row `origin.problems` non-empty, one new `budget-estimate` wake; driving the rounds makes exactly 2 single calls; if the second answer is also bad → still 2 calls, retry `failed` with no `retriedAs`.
  - second answer good → retry `ready`; panel current estimate is the retry.
  - `single-call-output-invalid` → retry with problems `["no-json-object"]`; `estimate-call-failed:codex-rate-limited` → `retrySkipped` absent and no retry (`none`).
  - each skip code sets `retrySkipped` and writes no wake: deficit after settlement (soft overrun; asserts the transaction committed, estimate `failed`, not `running`), proposal edited, newer estimate queued, old record without `proposalVersion`, exact tokenizer, prompt too large, group stopped, reserve too small.
  - replay: call `completeEstimateInStore` twice with the same raw answer → one retry row.
  - prompt of the retry contains the feedback paragraph with the problems.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: compute settlement numbers first (existing code), then `decideEstimateRetry` with plain reads only, then either `writeEstimateRetry` or set `retrySkipped`; both inside the existing transaction, after the failed row is updated. Record in the task report what a still-queued retry does when the group starts (spec §5).
- [ ] **Step 4: Run** the new file plus `tests/control/{driverEstimate,estimateE2E,estimateOutcome,planImport,webMutations}.test.ts` — exit 0.
- [ ] **Step 5: Mutations**: (a) remove the `origin` check → a third call happens, red; (b) let `decideEstimateRetry` throw on deficit → deficit test red (estimate left `running`); (c) derive the retry id from the version number instead of the failed id → replay test red (two retry rows).
- [ ] **Step 6: Commit** `feat(control): one automatic estimate retry that tells the model what was wrong`.

