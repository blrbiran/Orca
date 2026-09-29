# Task A3 report: plan-file `loop` form, import expansion, CLI refusal

Author: implementer subagent, session 1d7d9aa0, 2026-09-30. Base commit d40eed2; result commit b97e88a (branch main, local only).
SCRATCH = /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/1d7d9aa0-4a2b-478b-b0ec-d970d3a51afe/scratchpad/a3/

## Status: DONE_WITH_CONCERNS

## What was implemented (brief Step 3, as written)
- `src/scheduler/planFile.ts`: imports `expandLoopTask`, `loopPlanFileSchema`, `LoopPlanFileInput`, `LoopRecipe` from
  `../control/loopPlans.js` (names checked against the A1 exports). Adds `LoopPlanTask`, `isLoopPlanTask`, `LoadedPlanFile`,
  and `loop?: LoopRecipe` on `SchedulerControlPlanSource.tasks[]`. `planTaskSchema` now has optional `contract` and `loop`,
  with `.superRefine` enforcing exactly one of them (`exactly-one-of-contract-or-loop`). Adds `loadedTask` and
  `expandPlanFileLoop` (refusal -> `control-plan-rejected:loop-plan-invalid:<taskId>:<reason>`). `readSchedulerControlPlanSource`
  expands loop tasks and stores the recipe as `loop`. `loadPlan` returns `LoadedPlanFile`; relative-path and
  contract-inside-target-repo checks run on contract tasks only.
- `src/scheduler/graph.ts:33`: `detectCycle(tasks: ReadonlyArray<Pick<PlanTask, "taskId" | "dependsOn">>)`.
- `src/scheduler/run.ts`: `loadRound` refuses every loop task as `loop-plan-cli-unsupported:<taskId>` before any contract
  is read, then narrows to `PlanFile`. Per P10, nothing else in run.ts changed (line 201 untouched).
- `src/control/service.ts:50,:60`: `ControlError("control-plan-rejected", <codes joined by ",">)`.

## Criteria
- `tests/scheduler/planFileLoop.test.ts`: the brief's file verbatim, plus one criterion (ruling P2):
  `Web import's source expands a loop task (spec §3.3) > refuses an investigate loop whose file cap is not 1, rather than
  silently overriding it (ruling R-F15)`. It expects `control-plan-rejected:loop-plan-invalid:fix-login:investigate-max-files`.
- `tests/scheduler/loopPlanCli.test.ts`: the brief's file verbatim (`Sandbox` is exported by that name), plus one criterion
  (P3, see Departures): `a profiled controlled round refuses it with the same name` (`ControlService.runProfiled`).

### RED (before implementation)
Command: `./node_modules/.bin/vitest run tests/scheduler/planFileLoop.test.ts tests/scheduler/loopPlanCli.test.ts > $SCRATCH/a3-red.txt 2>&1` gave rc=1.
There were 11 failures and 1 pass. The pass was `still loads the contract form unchanged`, a regression guard that is
expected to pass. Every failure has the reason the brief predicts: `malformed tasks.0.contract: Required` /
`tasks.0: Unrecognized key(s) in object: 'loop'`. The CLI criteria print `rejected: malformed:`, and the controlled round
throws bare `control-plan-rejected`. The investigate criterion was red for the same malformed reason. The runProfiled
criterion was added after implementation; its red is shown by mutation MA3-6b.

### GREEN
- `vitest run` of the 2 new files plus the 7 existing files the brief names (planFile, graph, scenarios/inputRejections,
  control/schedulerBridge, agentPlanImport, targetVersion, planImport) > `a3-green.txt`: rc=0, 9 files, 109/109 passed.
- `vitest run tests/scheduler/loopPlanCli.test.ts` after adding the runProfiled criterion > `a3-green-cli2.txt`: rc=0, 4/4.
- `npm run typecheck` > `a3-tsc.txt` and `a3-tsc2.txt`: rc=0, no output. The web typecheck was not run because nothing
  under web/ changed.
- No existing criterion turned red. I grepped the tests for the old messages (`contract: Required`, bare
  `control-plan-rejected`). Only planImport.test.ts references the code, and it stays green.

## Mutations (clone `$SCRATCH/mut-a3`; `a3-copy.txt` is empty; driver `$SCRATCH/mutate.py`; summary `a3-mutations.txt`)
| Name | Edit | Red criterion | Evidence | Restore cmp |
|---|---|---|---|---|
| MA3-1 | `.superRefine(...)` removed | `refuses a task with both …` and `… with neither …` | a3-MA3-1.txt | rc=0, empty |
| MA3-2 | path push unconditional (`task.contract ?? ""`) | `runs the contract path checks on contract tasks only` (+ loads, 3 import criteria) | a3-MA3-2.txt | rc=0, empty |
| MA3-3 | `isInsideRepo(data.targetRepo, task.contract ?? data.targetRepo)` | same criterion (+ loads, 3 import criteria) | a3-MA3-3.txt | rc=0, empty |
| MA3-4 | `task.labels ?? []` -> `[]` | `stores the expansion …` (planId standard instead of bugfix) | a3-MA3-4.txt | rc=0, empty |
| MA3-5 | `if (loopRejections.length > 0) return …` deleted | all 4 loopPlanCli criteria (plan exits 0; run hits adapter-config; controlled: control-protocol-unavailable) | a3-MA3-5.txt | rc=0, empty |
| MA3-6 | service.ts:50 detail removed | `a controlled CLI round refuses it with the same name` | a3-MA3-6.txt | rc=0, empty |
| MA3-6b (P3) | service.ts:60 detail removed | `a profiled controlled round refuses it with the same name` | a3-MA3-6b.txt | rc=0, empty |
| MA3-7 (P3) | `...(original.recipe ? { loop: … } : {})` deleted | `stores the expansion …` (loop missing) | a3-MA3-7.txt | rc=0, empty |
| MA3-8 (P3) | `if (!expanded.ok) return sourceRejected(…)` deleted | `refuses a loop the expansion refuses …`, `refuses an investigate loop …` (vitest); typecheck also red (a3-MA3-8-tsc.txt) | a3-MA3-8.txt | rc=0, empty |
| MA3-9 (P3) | `isLoopPlanTask` body -> `return false` | 3 import criteria + all 4 CLI criteria | a3-MA3-9.txt | rc=0, empty |
| MA3-10 (P3) | `tasks: data.tasks.map(loadedTask)` -> `tasks: data.tasks` | typecheck only (vitest rc=0 in a3-MA3-10.txt; tsc rc=2 in a3-MA3-10-tsc.txt) | a3-MA3-10-tsc.txt | rc=0, empty |
| MA3-11 (P3) | run.ts narrowing filter -> `result.plan.tasks as PlanTask[]` | NOT RED: vitest rc=0, tsc rc=0 | a3-MA3-11.txt, a3-MA3-11-tsc.txt | rc=0, empty |

## Files changed
src/scheduler/planFile.ts, src/scheduler/graph.ts, src/scheduler/run.ts, src/control/service.ts (modified);
tests/scheduler/planFileLoop.test.ts, tests/scheduler/loopPlanCli.test.ts (created). Pre-commit diff: `$SCRATCH/a3-diff.txt`.

## Commits
b97e88a feat(scheduler): accept a plan-file task that names a loop plan. `a3-msg.txt` shows both trailer lines exactly.

## Self-review findings / concerns
1. MA3-11 cannot be killed, because the mutation does not change behaviour. The `filter(... !isLoopPlanTask)` in `loadRound`
   runs only after every loop task has been refused, so at runtime it never removes anything. Its only job is to narrow the
   type to `PlanFile`, and a cast does the same. No criterion can go red on it. I kept the filter as the brief wrote it: it
   is safer than a cast if the refusal is ever removed, because it drops loop tasks instead of passing them on untyped.
   MA3-5 shows that dropping them is still caught. The controller should decide whether to keep it.
2. MA3-10 (`loadedTask`) is red only under `npm run typecheck`. Zod 3 does not add keys that are absent, so `data.tasks`
   already has exactly the right runtime shape. `loadedTask` is a type-level projection. Per the dispatch rules, red under
   typecheck counts as red.
3. The `orca run` criterion's `result === 1` assertion is also satisfied without the refusal: exit 1 comes from the
   missing `--adapter-config` (MA3-5 evidence). Its `stderr` assertion is the one that tells the two cases apart, and it
   does go red. `orca run` checks loadRound before adapter-config, so the refusal is what the user sees.
4. MA3-2 and MA3-3 also turn `loads a task that names a loop plan …` red first. The "contract task beside it is still
   checked" half of the path-check criterion is not isolated by a mutation here. That behaviour already existed and
   `planFile.test.ts` covers it.

## Departures from the brief
- One criterion added in planFileLoop.test.ts (ruling P2, investigate-max-files import refusal).
- One criterion added in loopPlanCli.test.ts for `runProfiled` (service.ts:60). Without it, the brief's edit to line 60
  had no criterion, and its P3 deletion mutation could not be seen red. The selection value is a well-formed literal:
  loadRound runs before any profile is used.
- Mutations MA3-6b through MA3-11 were added under P3.
