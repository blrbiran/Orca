# Task A4 report: the recipe in the archived plan

Implementer: subagent of session `1d7d9aa0` (Claude Opus 5.5), 2026-09-30, on `main`, parent commit `b97e88a`.
Commit: `1fc5271 feat(control): archive a loop task's recipe inside its plan entry`.
SCRATCH = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/1d7d9aa0-4a2b-478b-b0ec-d970d3a51afe/scratchpad`; evidence is in `$SCRATCH/a4/`, and the mutation clone is `$SCRATCH/mut-a4` (kept).

## What was implemented
- `src/control/webProtocol.ts`: imports `loopRecipeSchema` from `./loopPlans.js`. The `controlPlanSchema` task object gets `loop: loopRecipeSchema.optional()` right after `labels`, with a comment. It is optional and has no default.
- `src/control/planImport.ts` `normalizeControlPlan`: adds `...(task.loop ? { loop: task.loop } : {})` after the labels spread. It is written only for a loop task.
- `tests/control/fixtures/web.ts` (additive): `WebFixtureTask` gains `loop?: Record<string, unknown>`. The task loop gets a first branch that writes a plan-file `loop` task with no contract file. `planTasks` needed no type annotation because typecheck passed as written.
- `tests/control/loopPlanImport.test.ts` (new): 3 criteria, as the brief gives them, with one change required by ruling P7 (listed under Departures).

## RED (before implementation)
`./node_modules/.bin/vitest run tests/control/loopPlanImport.test.ts > $SCRATCH/a4/a4-red.txt 2>&1` → rc=1. 2 failed, 1 passed:
- `archives the recipe …`: `expected undefined to deeply equal { schema: 'orca-loop-recipe-v1', …(4) }`. This is the expected reason: normalizeControlPlan dropped `loop`.
- `puts the recipe under planHash …`: `expected 'bb77e39…' not to be 'bb77e39…'`. This is the expected reason: with no recipe archived, the hashes are equal.
- `gives a hand-written task's archived entry no loop key`: passed, as expected, because it is a guard.

## GREEN
- `vitest run tests/control/loopPlanImport.test.ts tests/control/planImport.test.ts tests/control/webProtocol.test.ts tests/control/taskLabels.test.ts tests/control/estimator.test.ts > $SCRATCH/a4/a4-green.txt` → rc=0. 5 files, 74 tests passed, 0 skipped.
- `npm run typecheck > $SCRATCH/a4/a4-tsc.txt` → rc=0, no diagnostics.
- Web typecheck `(cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json) > $SCRATCH/a4/a4-webtsc.txt` → rc=0, empty file. `web/` was not touched; I ran it because `webProtocol.ts` is a shared wire module.

## Mutations (clone `$SCRATCH/mut-a4`; `a4-copy.txt` is 0 bytes; criterion file `tests/control/loopPlanImport.test.ts`)
| Name | Edit | Red criterion | Evidence | Restore (cmp) |
|---|---|---|---|---|
| MA4-1 recipe not archived | delete the `...(task.loop ? { loop: task.loop } : {}),` line (planImport.ts) | `archives the recipe …` (undefined) and `puts the recipe under planHash …` (hashes equal) | `a4/a4-MA4-1.txt` rc=1 | rc=0, 0 bytes |
| MA4-2 key for every task | `...(task.loop ? …)` → `loop: task.loop ?? null,` | `gives a hand-written task's archived entry no loop key`: import refused, `control-plan-rejected:Expected object, received null` | `a4/a4-MA4-2.txt` rc=1 | rc=0, 0 bytes |
| MA4-3 (P3) schema field deleted | delete `loop: loopRecipeSchema.optional(),` (webProtocol.ts) | `archives the recipe …` and `puts the recipe under planHash …`: `Unrecognized key(s) in object: 'loop'` | `a4/a4-MA4-3.txt` rc=1 | rc=0, 0 bytes |
| MA4-4 (P3) fixture loop branch deleted | `if (task.loop !== undefined) {` → `if (false) {` (fixtures/web.ts) | `archives the recipe …` (undefined) and `puts the recipe under planHash …` (hashes equal) | `a4/a4-MA4-4.txt` rc=1 | rc=0, 0 bytes |

## Files changed
`src/control/webProtocol.ts`, `src/control/planImport.ts`, `tests/control/fixtures/web.ts` (additive), `tests/control/loopPlanImport.test.ts` (new). Diff before commit: `$SCRATCH/a4/a4-diff.txt`. Commit message checked in `$SCRATCH/a4/a4-msg.txt`: both trailer lines are present.

## Self-review
- A hand-written task's entry has no `loop` key, so its archive bytes and planHash do not change. The guard criterion checks this, and MA4-2 proves that criterion can go red.
- `task.loop` reaches normalizeControlPlan from `SchedulerControlPlanSource` (A3, planFile.ts:315 `...(original.recipe ? { loop: original.recipe } : {})`), and the strict `controlPlanSchema` parse re-validates it.
- The fixture's interface change moved `labels?: string[] }` onto a new line followed by the `loop` field. That is a 1-line textual deletion, but no existing field changed.

## Concerns
- With P7 applied, the planHash criterion no longer checks on its own that `planHash === sha256Canonical(plan)`. MA4-1 and MA4-4 turn it red (the hashes are equal when the recipe is missing), which shows it is measured against the real planHash and does not pass vacuously.

## Departures from the brief
- P7: I dropped `expect(sha256Canonical(archived.plan)).toBe(archived.planHash);` from the second test, kept its second assertion, and added a comment citing P7.
- P3: I added deletion mutations MA4-3 (schema field) and MA4-4 (fixture branch), which the brief's list did not include.
