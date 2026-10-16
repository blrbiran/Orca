# A paid estimate yields a usable answer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A paid single-call budget estimate ends `ready` whenever the answer carries a real estimate for every task: Orca repairs mechanical defects, and makes one automatic, feedback-carrying retry when it cannot.

**Architecture:** A pure repair module sits in front of the existing classifier inside `completeEstimateInStore`. Instruction v2 adds a per-request response schema keyed by taskId. The retry is decided by a pure, non-throwing function after settlement and written as a new estimate row + contract + wake in the same transaction.

**Tech Stack:** TypeScript (ESM, Node 24), zod, better-sqlite-style `node:sqlite` store, vitest, React (web).

**Spec:** `docs/superpowers/specs/2026-10-17-estimate-usable-answer-design.md` (read it whole before any task; §-numbers below refer to it).

## Global Constraints

- Work only in the worktree `/Users/biran/code/skills/orca/Orca-wt/round-20261017`, branch `codex/round-20261017`; never push, merge, or delete branches (Tier 0).
- Every git command is `/usr/bin/git`. Every verification run redirects to a file and the whole file is read back (CLAUDE.md Rule 14).
- Tests run with `ECC_GATEGUARD=off DISABLE_OMC=1 ./node_modules/.bin/vitest run <files>`; web tests from `web/` with `../node_modules/.bin/vitest run <files>`; new web DOM test files start with `// @vitest-environment jsdom`.
- Rule 9: every new branch gets a named mutation (done in a `git clone --local` copy, never the worktree) that removes it and is seen red; restore proof is `git diff`/`git diff --cached` byte counts 0/0. Report each mutation in the task report.
- Existing criteria may be rewritten when the change requires it (human authorization, 2026-10-17, this session); each rewrite carries a comment `Ruling (session 4de777f4, 2026-10-17): …` saying why.
- v1 requests, the v1 instruction text and `BUDGET_ESTIMATE_JSON_SCHEMA` stay byte-identical. `responseSchemaVersion` stays the literal `budget-estimate-v1`; the request schema stays `budget-estimate-request-v1`.
- Placeholder rationales (trimmed, lower-cased): `placeholder`, `todo`, `tbd`, `x`, `n/a`, `...`, `-`.
- `problems`: at most 20 entries, each at most 200 characters, never empty when a retry is queued.
- Retry id: `estimate-${sha256Canonical({ groupId, retryOf: failedEstimateId }).slice(0, 24)}`; version = max existing + 1.
- No write to `~/.orca` from any test or script (Rule 17); no paid call from any task (paid runs are the controller's, after Task 7).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` (an implementer on another model writes its own true model name).

## Review Focus

- Estimate rows written before this change (no `repairs`/`proposalVersion`/`origin`) must still decode, display, and never get a retry (`proposal-unknown`). → Task 2 and Task 5 tests.
- The person edits the budget proposal between the failed call's queueing and its settlement: no retry (`proposal-changed`); a person's newer `estimate` already queued: no retry (`superseded`). → Task 5.
- The settlement is replayed (crash after commit, driver re-runs Ce): the receipt makes the second completion return early; exactly one retry row exists. → Task 5.
- Task ids that are object-prototype names (`constructor`, `toString`) or all digits (`10`, `2`) in a v2 keyed answer. → Task 1.
- A large plan whose every entry is broken: problems are capped at 20 × 200 chars and the retry prompt still fits or skips with `input-too-large`. → Task 1 (cap), Task 5 (size skip).

---

### Task 1: The repair module

**Files:**
- Create: `src/control/estimateRepair.ts`
- Test: `tests/control/estimateRepair.test.ts`

**Interfaces:**
- Produces:
  - `export const PLACEHOLDER_RATIONALES: readonly string[]` (the list above).
  - `export interface RepairContext { planHash: string; taskIds: readonly string[]; instructionVersion: string }`
  - `export type RepairResult = { ok: true; output: unknown; repairs: string[] } | { ok: false; problems: string[] }`
    (`output` is the repaired value, still to be judged by `classifyEstimateOutput`).
  - `export function repairEstimateOutput(raw: unknown, ctx: RepairContext): RepairResult` — spec §4.2 steps 1–7 in order, codes exactly as the spec spells them; collects every problem; never throws.
  - `export function problemsFromRefusal(issues: readonly { path: (string | number)[]; message: string }[], notCanonical: boolean): string[]` — `field-invalid:<path joined by ".">:<message>` per issue, plus `output-not-canonical`; capped.
  - `export function capProblems(problems: readonly string[]): string[]` — first 20, each truncated to 200 chars.

- [ ] **Step 1: Write failing tests** in `tests/control/estimateRepair.test.ts`, one `it` per behavior, building answers from a valid fixture `answer(taskIds)`:
  - each repair code alone: `answer-v2-converted` (v2 keyed answer, instructionVersion "2" → v1 array in plan order); `schema-name-set`; `plan-hash-copied`; `assumptions-normalized:a` (`[" x ", "x", ""]` → `["x"]`); `unknown-task-dropped:zz`; `duplicate-task-dropped:a` for the evidence shape (real first, `rationale: "placeholder"` second) **and** reversed order (placeholder first → the real one is kept); `tasks-reordered`. Each: `expect(r).toEqual({ ok: true, output: <exact>, repairs: [<exact code>] })`, and `classifyEstimateOutput(r.output, planHash, taskIds).ok === true`.
  - an already-valid v1 answer → `repairs: []`, output deep-equal to input.
  - unrepairable, problems collected together: missing task `b` and placeholder `a` → `{ ok: false, problems: ["placeholder-entry:a", "task-missing:b"] }` (sorted); `null`/array/string → `["not-an-object"]`; a task with `work` missing → contains `task-invalid:a:work`; all assumptions empty → `task-invalid:a:assumptions`.
  - v2 traps: ids `constructor` and `10` with only `10` present in the keyed object → `task-missing:constructor`, and conversion order follows the plan's ids, not `Object.keys`.
  - v2 shape under contract "1" (keyed object while v1 expected) → not converted; problem `field-invalid:tasks…`.
  - cap: 30 broken tasks with 300-char ids → `problems.length === 20`, every entry `length <= 200`.
  - `PLACEHOLDER_RATIONALES` equals the exact list (pins the only judgement).
- [ ] **Step 2: Run** `./node_modules/.bin/vitest run tests/control/estimateRepair.test.ts > $LOG 2>&1` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `src/control/estimateRepair.ts`. Per-task validity uses the task object schema inside `budgetEstimateSchema` (export it from `webProtocol.ts` as `budgetEstimateTaskSchema`, no behavior change) after step 4; read keys with `Object.hasOwn`; no `Object.keys` ordering anywhere.
- [ ] **Step 4: Run** the test file — expect PASS; run `npm run typecheck` — expect exit 0.
- [ ] **Step 5: Mutations** (clone): drop step 6's "skip placeholder" → reversed-order test red; replace `Object.hasOwn` with `in` → `constructor` test red. Report both.
- [ ] **Step 6: Commit** `feat(control): repair an estimate answer's mechanical defects (estimateRepair)`.

### Task 2: Record, contract and view fields

**Files:**
- Modify: `src/control/queries.ts` (`estimateRecordSchema`, `EstimateRecord`), `src/control/webProtocol.ts` (`estimateExecutionContractSchema`, `estimateViewSchema`), `src/panel/controlViews.ts` (`estimateViews`), `web/src/controlTypes.ts`, `src/control/planImport.ts` (estimate insert), `src/control/webService.ts` (`createEstimate` insert)
- Test: `tests/control/estimateRecordFields.test.ts`

**Interfaces:**
- Produces (all optional on the record, absent ⇔ not applicable; canonical bytes of old records unchanged):
  - record: `proposalVersion?: number`, `repairs?: string[]`, `origin?: { kind: "auto-retry"; of: string; problems: string[] }`, `retriedAs?: string`, `retrySkipped?: string`.
  - contract: `retryProblems?: string[]` (1..20 entries).
  - view: the same five fields passed through; web types mirror them.
  - `writeImportedPlan` writes `proposalVersion: 1`; `createEstimate` writes `proposalVersion: proposal.proposalVersion`.

- [ ] **Step 1: Failing tests**: an old-shape record body (no new fields) decodes and its view has none of them; a record with all five decodes and the view carries them; a fresh import's estimate has `proposalVersion: 1`; a re-estimate after one proposal edit has `proposalVersion: 2`; a contract with `retryProblems: []` is refused (min 1).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the schema fields and the two writers. Rewrite any existing criterion that pins the exact record/view key set (search `tests/` for `estimatorSlot` beside `toEqual` on estimate bodies) with a Ruling comment.
- [ ] **Step 4: Run** the new file, `tests/control/estimate*.test.ts`, `tests/panel/*estimate*`, typecheck, and `npm run build --workspace web` — all exit 0.
- [ ] **Step 5: Mutation**: stop writing `proposalVersion` in `createEstimate` → its test red.
- [ ] **Step 6: Commit** `feat(control): estimate records carry proposalVersion, repairs and retry links`.

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

### Task 6: Panel display

**Files:**
- Modify: the web component that renders estimates (`web/src/BudgetEditor.tsx` and/or `web/src/ControlGroupView.tsx`), `web/src/locales/en.ts`, `web/src/locales/zh.ts`
- Test: `web/tests/estimateRepairRetry.test.tsx`

**Interfaces:**
- Consumes: Task 2 view fields.

- [ ] **Step 1: Failing test**: a view with `repairs: ["duplicate-task-dropped:a"]` shows "repaired" and the code; `origin.of` shows "retry of v1"; `retriedAs` shows "retried as v2"; `retrySkipped: "proposal-changed"` shows "retry skipped: proposal-changed"; in zh the same four (`已修复`, `第 1 版的重试`, `已重试为第 2 版`, `未重试：proposal-changed`).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** the new file and `npm run --ws check` (and `npx vitest run tests/panel/scanPanelText.test.ts` from the root) — exit 0.
- [ ] **Step 5: Mutation**: remove the repaired label → red. **Step 6: Commit** `feat(web): show an estimate's repairs and its automatic retry`.

### Task 7: Acceptance harness for paid runs

**Files:**
- Modify: `scripts/live-driver-acceptance.ts`
- Test: run it in fake modes (no paid call)

**Interfaces:**
- Produces flags: `--scenario estimate` accepts `--codex <bin> --model <name>` (soft estimate mode, profile declares the window from `--context-window`, default 1000000); `--instruction-version 1|2` (default `2`, written into the harness's own profile); `--repeat <n>` (default 1) runs n estimates of the same plan in fresh groups; `summary.json` gains `estimates: [{ state, reasonCode, repairs, origin, retriedAs, retrySkipped, calls, tokens }]` and a tally `{ firstCallReady, readyAfterRepair, readyAfterRetry, failed }`.

- [ ] **Step 1: Run** `--fake-omp --scenario estimate --estimate-only --repeat 2 --instruction-version 2` before the change — expect a usage error (flags unknown).
- [ ] **Step 2: Implement**; the fake-omp answer for the second repeat is the evidence shape (duplicate `a` + placeholder) so the tally shows one `readyAfterRepair`.
- [ ] **Step 3: Run** the fake command above and `--fake --scenario estimate …` for codex — exit 0, tally as expected, `~/.orca` unchanged (the script's own check).
- [ ] **Step 4: Commit** `test(acceptance): estimate scenario for codex, instruction v2 and repeated runs`.

### After Task 7 (controller only, not a subagent task)

Whole-branch review; final gate in a fresh clone; paid acceptance per spec §6 (omp alias ×5+, codex `gpt-6-luna` ×1, claude 1M ×1) with tool-reported tokens only; ledger `.superpowers/sdd/2026-10-17-estimate-usable-answer/progress.md`; handoff with the human's one-field profile edit (`instructionVersion` → `"2"`, after checking no estimate is queued/running).
