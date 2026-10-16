### Task 4: Instruction v2, per-request schema and the feedback tail

**Files:**
- Modify: `src/control/estimatePrompt.ts`, `src/control/singleCallPurposes.ts` (`ESTIMATE.prepare`), `src/control/estimator.ts` (`buildBudgetEstimateRequest` prompt-size bytes)
- Test: `tests/control/estimatePromptV2.test.ts`; existing `tests/control/estimatePrompt.test.ts` must stay green unchanged

**Interfaces:**
- Produces:
  - `ESTIMATE_INSTRUCTIONS` gains `"2"`.
  - `export interface EstimatePromptOptions { taskIds: readonly string[]; retryProblems?: readonly string[] }`
  - `export function buildEstimatePrompt(instructionVersion: string, requestCanonicalJson: string, options?: EstimatePromptOptions): string` — v1 without options is byte-identical to today; v2 requires `taskIds` and appends after the request: a blank line and `This plan has N tasks: "a", "b". Answer each exactly once, as a key of "tasks".`; `retryProblems` (either version) appends a blank line and the spec §4.3 feedback paragraph listing them one per line.
  - `export function estimateResponseSchema(instructionVersion: string, taskIds: readonly string[]): Record<string, unknown>` — `"1"` → `BUDGET_ESTIMATE_JSON_SCHEMA`; `"2"` → spec §4.1 keyed schema (schema enum `budget-estimate-answer-v2`, no `planHash`, `tasks` object with one property per id, all required, `additionalProperties: false`), using only `type`/`properties`/`required`/`additionalProperties`/`items`/`enum`.
  - `export function estimateTaskIds(request: BudgetEstimateRequestV1): string[]` — parsed from `planSnapshotCanonicalJson`, plan order.

- [ ] **Step 1: Failing tests**: sha256 of `buildEstimatePrompt("1", req)` equals the value computed from today's code on the same fixture (compute it once in the test from the frozen v1 text so it pins bytes); v2 prompt ends with the task-list line for ids `a`,`b`; v2 schema for `["a","b"]` has `tasks.required` `["a","b"]` and no keyword outside the allowed set (walk it); `retryProblems: ["task-missing:b"]` appends the paragraph in both versions; `prepare` for a v2 contract returns the v2 schema and the tail; the preflight token count for a v2 request counts the tail (a plan whose v1 prompt fits and v2 prompt is larger counts more tokens).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**. The v2 instruction keeps v1's text, minus the `planHash` copy rule and the "sorted" assumption rule, with the answer object as spec §4.1 shows; write it as a separate constant.
- [ ] **Step 4: Run** the new file, `tests/control/estimatePrompt.test.ts`, `tests/control/estimateSchema.test.ts`, `tests/control/singleCall*.test.ts` — exit 0.
- [ ] **Step 5: Mutation**: emit `BUDGET_ESTIMATE_JSON_SCHEMA` for v2 → schema test red.
- [ ] **Step 6: Commit** `feat(control): estimate instruction v2 with a per-request schema keyed by taskId`.

