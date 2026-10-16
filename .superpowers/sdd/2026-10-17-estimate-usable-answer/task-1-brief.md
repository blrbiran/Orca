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

