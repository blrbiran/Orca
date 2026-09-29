# Task A5 report — projection recipe check and `loopPlan` view

Implementer: session `1d7d9aa0` subagent (Opus 5.5), 2026-09-30. BASE `1fc5271`, commit `8df7fd3`.
SCRATCH = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/1d7d9aa0-4a2b-478b-b0ec-d970d3a51afe/scratchpad/a5/` (evidence files below are relative to it).

Status: DONE_WITH_CONCERNS

## What was implemented
- `src/control/loopRecipeCheck.ts` (new): `export function recipeExpandsTo(taskId, repoPath, recipe, contractCanonicalJson): boolean`
  — the single recipe re-expansion check (ruling P5). **B1 must reuse it** in `effectivePlanTask` instead of
  `expandRecipe` + byte comparison. It sits in its own module, not in `loopPlans.ts`, so it calls `expandRecipe` through
  the module export; that is what lets `loopPlanDrift.test.ts`'s `vi.mock` of `loopPlans.js` simulate registry drift.
  If it lived in `loopPlans.ts`, the internal call would bypass the mock and the drift criterion could never go red.
- `src/control/webProtocol.ts`: import extended; `loopPlanViewSchema` added; `workItemViewSchema` gains
  `loopPlan` (nullable, optional) and `objective` (optional). These match the brief.
- `src/panel/controlViews.ts`: imports; `workBodySchema` gains `amendmentHash` and `loopVersion` (optional); new `taskPlanView`,
  spread into each work item. A recipe that does not re-expand throws `recovery-blocked:loop-plan-recipe-mismatch:<taskId>`.
- `web/src/controlTypes.ts`: `WorkItemViewV1.loopPlan?` and `objective?`; `LoopPlanIdV1`, `LoopInputsV1` and `LoopPlanViewV1` appended.
- Tests: `tests/control/loopPlanView.test.ts` and `tests/control/loopPlanDrift.test.ts`, as the brief wrote them, except for one departure below.

## Departures from the brief
1. The expected `planName` is `"Bug fix (red first)"`, not `修 bug（先红后绿）` (R-F5: English strings; the registry already holds the English name).
2. The brief's inline `expandRecipe(...)` plus `!expanded.ok || canonicalJson !== ...` became a call to `recipeExpandsTo`, because of P5.
   The mutation MA5-1 is unchanged in meaning: it deletes the `if (!recipeExpandsTo(...)) return blocked(...)` line.
3. The commit message has one extra paragraph sentence that names `recipeExpandsTo`. The trailer is exactly the two mandated lines (checked in `a5-msg.txt`).

## RED
`./node_modules/.bin/vitest run tests/control/loopPlanView.test.ts tests/control/loopPlanDrift.test.ts > a5-red.txt` gave rc=1 and 5/5 failed.
The failures were `expected undefined to …` on `loopPlan` (and `objective` was not reached). That is the expected reason: the fields did not exist yet.

## GREEN
- `vitest run` over loopPlanView, loopPlanDrift, taskLabels, webParity, controlReadApi, confirmation, loopPlanImport,
  loopPlanSummary and loopPlans gave rc=0: 9 files, 144 tests passed (`a5-green.txt`).
- `npm run typecheck` gave rc=0 (`a5-tsc.txt`). The web tsc also gave rc=0 (`a5-web-tsc.txt`).
- The full suite ran in the clone `mut-a5` only (never in the main tree) and gave rc=1: 58 failed, 2179 passed, 48 skipped (`a5-full-clone.txt`).
  All 58 failures are environmental. 78 error lines say "ccloop bin not found" (there is no sibling `ccloop` next to the scratch clone), 14 say "web/dist does not exist", and one is a
  readyHint 60s timeout (the panel does not boot without dist). Their breakdown is in `a5-full-fails.txt` and `a5-kinds.txt`.
  I re-ran in the main tree the four files that touch the panel or control: schedulerBridge, controlMount, controlShutdown and readyHint.
  All 4 passed, 30 tests (`a5-envfiles-main.txt`). The remaining failing files are `tests/scheduler/**`, which do not reach `readControlGroup`.
  No existing criterion turned red.

## Mutations (clone `mut-a5`, `a5-copy.txt` empty; every restore `cmp` rc=0 with an empty file; final cmp of all 6 files is empty, `a5-final-cmp.txt`)
| name | edit | result | red criterion | evidence |
|---|---|---|---|---|
| MA5-1 | delete the `if (!recipeExpandsTo…) return blocked(…)` line | RED | drift > blocks the loop task by name | a5-MA5-1.txt |
| MA5-1b | `expanded.canonicalJson === contractCanonicalJson` → `true` | RED | drift > blocks the loop task by name | a5-MA5-1b.txt |
| MA5-1c | delete `expanded.ok &&` | green at runtime (equivalent: a refusal has no canonicalJson, so the comparison is already false); **RED under typecheck** (TS2339) | typecheck | a5-MA5-1c.txt, a5-MA5-1c-tsc.txt |
| MA5-2 | the `loop === undefined` early return made unconditional | RED | view > shows the plan… ; view > names no label… | a5-MA5-2.txt |
| MA5-2b | delete the `loop === undefined` line | RED | view > shows a hand-written task… ; drift > leaves a hand-written task's view alone | a5-MA5-2b.txt |
| MA5-3 | chosenByLabel → `null` | RED | view > shows the plan… | a5-MA5-3.txt |
| MA5-3b | drop the ternary (always choosePlanByLabels) | RED | view > names no label… | a5-MA5-3b.txt |
| MA5-4 | amended → `true` | RED | view > shows the plan… | a5-MA5-4.txt |
| MA5-4b | amended → `false` | **green** (no criterion can make it true until B1 writes amendmentHash) | — | a5-MA5-4b.txt |
| MA5-5 | `?? 0` → `?? 1` | RED | view > shows the plan… | a5-MA5-5.txt |
| MA5-5b | `body.loopVersion ?? 0` → `0` | **green** (no loopVersion is written until B2) | — | a5-MA5-5b.txt |
| MA5-6 | delete `...taskPlanView(task, body),` | RED | all 3 view tests | a5-MA5-6.txt |
| MA5-7 | objective goal ← successCondition | RED | view > shows the plan… ; view > shows a hand-written task… | a5-MA5-7.txt |
| MA5-8 | delete `loopPlan` from workItemViewSchema | RED (strict parse: `recovery-blocked:group-view:…Unrecognized key 'loopPlan'`) | all 3 view tests | a5-MA5-8.txt |
| MA5-9 | delete `objective` from workItemViewSchema | RED (the same way) | all 3 view tests | a5-MA5-9.txt |
| MA5-10 | delete `loopPlan?` from web WorkItemViewV1 | **green** under root typecheck (a5-MA5-10.txt) and under web tsc (MA5-10d, a5-MA5-10d.txt) | — | |
| MA5-10b | web `amended: boolean` → `string` | RED under typecheck (webParity) | typecheck | a5-MA5-10b.txt |
| MA5-10c | drop `"investigate"` from web LoopPlanIdV1 | RED under typecheck (webParity) | typecheck | a5-MA5-10c.txt |
| MA5-11 | delete `amendmentHash`/`loopVersion` from workBodySchema | RED under typecheck (TS2559) | typecheck | a5-MA5-11.txt |

## Concerns
1. **MA5-4b and MA5-5b are green.** Nothing in A5 writes `amendmentHash` or `loopVersion`, so `amended: true` and `loopVersion > 0` cannot be observed yet.
   B1's criterion (`amended: true, loopVersion: 1`) is what will cover them. The controller should re-run these two mutants after B1.
2. **MA5-10 is green.** The webParity mutual assignability cannot detect a missing *optional* field on the web side.
   This is the same pre-existing gap as `labels?` and `progress?`. A field that is present is pinned both ways (MA5-10b and MA5-10c are red).
   The web panel task (B6), once it reads `item.loopPlan`, will make its removal a web-tsc error. I did not add a runtime key-set parity check, because it is outside the brief.
3. B1's brief text still inlines `expandRecipe` + comparison and expects `"目标：…"` summary text. Under P5 and R-F5, B1 should call
   `recipeExpandsTo(archived.taskId, contract.context.repoPath, record.recipe, record.originalContractCanonicalJson)`
   and expect `"Goal: write a, as amended"`.

## Self-review
- A hand-written task now parses `originalContractCanonicalJson` with `taskContractSchema` in the projection. A bad stored contract then blocks
  with `original-contract-invalid:<taskId>` (the brief's detail). No existing criterion was affected (see GREEN).
- `describeLoopPlan(...)!` is safe: `recipeExpandsTo` returning true implies `loopPlanDefinition` found the version.

## Files changed
src/control/loopRecipeCheck.ts (new), src/control/webProtocol.ts, src/panel/controlViews.ts, web/src/controlTypes.ts,
tests/control/loopPlanView.test.ts (new), tests/control/loopPlanDrift.test.ts (new).

## Commits
`8df7fd3` feat(panel): show a task's loop plan and check its recipe in the projection

---

## Fix round 1 (review: task-A5-review.md) — commit `4bec875` on top of `ab4f2c9`

### Changes
- `tests/control/loopPlanView.test.ts`: a new criterion, `a task's plan in the group view (spec §4.1) > reports a work item's amendment and loop version`.
  It writes `amendmentHash: "a".repeat(64), loopVersion: 2` into loop task `a`'s `work_items` body and expects
  `loopPlan` to match `{ amended: true, loopVersion: 2 }`. No production change.
- Does an amendmentHash with no record block the projection now? **No.** Before B1 the projection does not resolve the record; the criterion is green (see below).
  **Warning for B1:** once `effectivePlanTask` runs in `readControlGroup`, this hash names no record and the projection will throw
  `task-amendment-invalid:a`, so this criterion will go red. B1 must decide how to handle it: write a real amendment through
  B1's `writeTaskAmendment`, or treat it as an existing criterion that needs the human to rename or rewrite it.
  Controller: please put this into B1's dispatch.

### Minor: `original-contract-invalid`
It is **not reachable** through `readControlGroup`, with or without B1. `readControlGroup` calls `readArchivedPlan` before `workViews`.
`readArchivedPlan` (src/control/queries.ts:122-127) already runs `taskContractSchema.parse` on every task's `originalContractCanonicalJson`,
checks its canonical bytes and hash, and checks the stored record, answering a plain `recovery-blocked` otherwise.
The field is also covered by `planHash`. So any overwrite blocks there first, and the `parseStored` in `taskPlanView` only extracts the typed objective.
No criterion was added.

### Evidence
- `vitest run tests/control/loopPlanView.test.ts tests/control/loopPlanDrift.test.ts > a5-fix1-green.txt`: rc=0, 2 files, 6 tests passed.
- `npm run typecheck > a5-fix1-tsc.txt`: rc=0.
- The new file was copied into `mut-a5` (`a5-fix1-copy.txt`, cmp rc=0, empty).
  - MA5-4b-fix1 (`amended: false`): rc=1, RED on `… > reports a work item's amendment and loop version` (`amended` expected true, received false). Evidence: `a5-MA5-4b-fix1.txt`. Restore cmp rc=0, 0 bytes.
  - MA5-5b-fix1 (`loopVersion: 0`): rc=1, RED on the same criterion (`loopVersion` expected 2, received 0). Evidence: `a5-MA5-5b-fix1.txt`. Restore cmp rc=0, 0 bytes.
- The trailer was checked in `a5-fix1-msg.txt`.
