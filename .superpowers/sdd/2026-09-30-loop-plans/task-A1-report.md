# Task A1 report: the plan registry, expansion and label choice

- Who: implementer subagent of session `1d7d9aa0` (controller session https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh), model Opus 5.5.
- When: 2026-09-30.
- Base commit: `65e64a3`. Result commit: `2ce72e2`, on `main`, local only. Nothing was pushed or merged.
- Evidence directory: `SCRATCH=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/1d7d9aa0-4a2b-478b-b0ec-d970d3a51afe/scratchpad`. Every file below is under `$SCRATCH/a1/`, and each was read back whole.

## Status: DONE_WITH_CONCERNS

The concerns are three equivalent mutants that no runtime criterion can turn red, plus one guard whose deletion only typecheck catches. They are listed under "Mutations" and "Concerns".

## What was implemented

- `src/control/loopPlans.ts` has every export the brief lists, with the brief's code and three changes:
  1. **R-F5**: registry `name` and `discipline` use the English strings: `Standard`, `Bug fix (red first)`, `Safe refactor`, `Design / docs first`, `Investigate only`, and the four discipline lines copied verbatim from the global.md table.
  2. **R-F15 / P2**: `LoopRefusal` gains `"investigate-max-files"`. `expandRecipe` refuses an `investigate` recipe whose `maxFilesTouched` is neither null nor 1. The check order is unknown-plan, path-shape, investigate-target, investigate-max-files, design-target.
  3. Nothing else departs from the brief's code.
- `tests/control/loopPlans.test.ts` holds the brief's criteria plus these changes:
  1. **P2**: in criterion 2, the shared `GIVEN` becomes `givenFor(plan)`, which drops `maxFilesTouched` for `investigate`. The expected cap for investigate stays 1.
  2. **R-F15**: a new criterion, `refusals (criterion 3) > investigate refuses a file cap other than 1 instead of silently overriding it (R-F15), after the target check`. It checks that 7 is refused, 1 and absent are accepted, and that a bad target combined with cap 7 gives `investigate-target` (the order in P2).
  3. **P3**: a new criterion, `refusals (criterion 3) > refuses a recipe whose plan version the registry does not hold (versions are never invented, spec §2.2)`. It covers `expandRecipe`'s own `unknown-plan` branch (version 2), `loopPlanDefinition(...)` returning null, `currentLoopPlanVersion("yolo")` returning null, and `isLoopPlanId`. Before this criterion existed, none of those branches could be seen red: the `plan === null` deletion was never reached, and `isLoopPlanId` was only used in a redundant guard pair.

## RED evidence

1. `./node_modules/.bin/vitest run tests/control/loopPlans.test.ts > $SCRATCH/a1/red.txt 2>&1` gave rc=1 with `Failed to load url ../../src/control/loopPlans.js ... Does the file exist?` and `Tests no tests`. This is the brief's expected reason: the module did not exist yet.
2. I then created the module with the English strings and the new refusal type, but without the R-F15 check. `vitest ... > $SCRATCH/a1/red2.txt` gave rc=1 with `84 tests | 1 failed`. The only red test was the R-F15 criterion (`expected null to be 'investigate-max-files'`). This is expected, because the check was absent.
3. The P3 criterion (unknown recipe version) was added after green, so its red was seen through mutations MX-1, MX-19, MX-20a and MX-21 below.

## GREEN evidence

- `vitest run tests/control/loopPlans.test.ts > $SCRATCH/a1/green3.txt` gave rc=0 with `Tests 85 passed (85)`, on the final test file, before the commit.
- Earlier runs: `green.txt` (84/84, before the P3 criterion) and `green2.txt` (85/85, before the `isLoopPlanId` assertion).
- The fixed-point criterion (`taskContractSchema` re-parse gives the same canonical bytes) is green for all five plans, so the Self-Review U1 stop did not trigger.

## Typecheck

`npm run typecheck > $SCRATCH/a1/tsc3.txt 2>&1` gave rc=0. The file holds only the npm banner and no errors. (`tsc.txt` and `tsc2.txt` are earlier runs, also rc=0.)

## Mutations

Clone: `$SCRATCH/mut-a1`, made with `git clone --local` from `65e64a3`, with `node_modules` and `web/node_modules` symlinked. The files were copied with `cat` and `cmp`; `copy.txt` and `copy2.txt` are both 0 bytes. The mutations were applied by `$SCRATCH/a1/apply.mjs`, which refuses unless the old text occurs exactly once; every `*-apply.txt` reads `<name> applied`. After each mutation `cat "$REPO/$f" > "$M/$f"; cmp` restored the file: every `*-restore.txt` gave rc=0 and is 0 bytes. The one-line summary per mutation is in `mutations-summary.txt`. The clone was kept.

Criterion command: `./node_modules/.bin/vitest run tests/control/loopPlans.test.ts`, run in the clone. For MX-2, MX-20b and MX-20c, `npm run typecheck` was also run in the clone.

| Name | Edit (in `src/control/loopPlans.ts`) | Red criterion (seen in the evidence file) | Evidence | Restore |
|---|---|---|---|---|
| MA1-1 | `denylistPaths: [...inputs.protectedPaths]` → `[]` | `criterion 2 > {standard,bugfix,refactor,design,investigate} > denylist = protectedPaths` (plus `changing protectedPaths alone changes the hash`) | `MA1-1.txt` | cmp rc=0, 0 B |
| MA1-2 | `constraints: [...plan.constraints]` → `[]` | `criterion 2 > {bugfix,refactor,design,investigate} > constraints` (plus the bugfix bytes criterion) | `MA1-2.txt` | rc=0, 0 B |
| MA1-3 | `maxFilesTouched: maxFilesOf(plan, inputs)` → `25` | `criterion 2 > <all five> > maxFilesTouched` (plus `changing maxFilesTouched alone ...`) | `MA1-3.txt` | rc=0, 0 B |
| MA1-4 | swap the `bug` and `refactor` rows of `LABEL_PRIORITY` | `criterion 5 > takes the highest priority of several labels, whatever their order` | `MA1-4.txt` | rc=0, 0 B |
| MA1-5 | `entry.startsWith("/") \|\| entry.includes("*")` → `entry.startsWith("/")` | `refusals > refuses the path shape src/*.ts ...` (plus src/\*, \*, \*\*/x.ts, src/\*\*/x.ts, investigate docs/\*\* and \*\*, R-F15 order) | `MA1-5.txt` | rc=0, 0 B |
| MA1-6 | investigate target statement deleted | `refusals > investigate refuses targetPaths` for all three rows (plus the R-F15 order assertion) | `MA1-6.txt` | rc=0, 0 B |
| MA1-7 | design check deleted | `refusals > design refuses the whole repository and accepts a documents prefix` | `MA1-7.txt` | rc=0, 0 B |
| MA1-8 | `input.plan ?? choosePlanByLabels(labels).planId` → `choosePlanByLabels(labels).planId` | `criterion 5 > lets an explicit plan win over the labels ...` (plus 18 others, because the helpers pass no labels) | `MA1-8.txt` | rc=0, 0 B |
| MA1-9 (R-F15) | investigate-max-files statement deleted | `refusals > investigate refuses a file cap other than 1 ...` (only this one) | `MA1-9.txt` | rc=0, 0 B |
| MX-1 | `if (plan === null) return ... "unknown-plan"` deleted in `expandRecipe` | `refusals > refuses a recipe whose plan version the registry does not hold ...` (TypeError on null) | `MX-1.txt` | rc=0, 0 B |
| MX-2 | `if (version === null \|\| !isLoopPlanId(planId)) return ...` deleted in `expandLoopPlan` | **vitest stays green** (85/85): `expandRecipe`'s own null check still refuses the unknown plan. **typecheck red** (rc=2): `TS2322 ... 'string' is not assignable to ...LoopPlanId`, `'number \| null' is not assignable to 'number'` | `MX-2.txt`, `MX-2-tsc.txt` | rc=0, 0 B |
| MX-3 | segment check → `return true` | `refusals > refuses the path shape` for src/../secrets, src//a.ts, ./src/a.ts, src/ | `MX-3.txt` | rc=0, 0 B |
| MX-4 | `entry.startsWith("/") \|\|` removed | **stays green (85/85): equivalent mutant** | `MX-4.txt` | rc=0, 0 B |
| MX-5 | `if (entry === "**") return true;` deleted | `refusals > accepts the path shape **` (plus investigate `**`, design) | `MX-5.txt` | rc=0, 0 B |
| MX-6 | `/**` prefix branch deleted | `refusals > accepts the path shape src/**` (plus 54 others) | `MX-6.txt` | rc=0, 0 B |
| MX-7 | `plan.planId === "investigate" ? 1 :` removed in `maxFilesOf` | `criterion 2 > investigate > maxFilesTouched` (only this one) | `MX-7.txt` | rc=0, 0 B |
| MX-8 | `?? DEFAULT_MAX_FILES_TOUCHED` removed | bugfix bytes criterion (`maxFilesTouched: null` vs 25) and the fixed-point criterion for four plans (ZodError) | `MX-8.txt` | rc=0, 0 B |
| MX-9 | whole path-shape statement deleted | `refusals > refuses the path shape <each of 10>` | `MX-9.txt` | rc=0, 0 B |
| MX-10 | `...inputs.protectedPaths` removed from the shape check | same 10 rows, red on the protectedPaths assertion (line 125) | `MX-10.txt` | rc=0, 0 B |
| MX-11 | `targetPaths.length !== 1 \|\|` removed | `refusals > investigate refuses targetPaths ["docs/a.md","docs/b.md"]` | `MX-11.txt` | rc=0, 0 B |
| MX-12 | `\|\| !exactPath(targetPaths[0])` removed | `refusals > investigate refuses targetPaths ["docs/**"]`, `["**"]`, and the R-F15 order assertion | `MX-12.txt` | rc=0, 0 B |
| MX-13 | chosenBy ternary → `"explicit"` | `criterion 5 > lets an explicit plan win ...` (`chosenBy: "labels"` expected) | `MX-13.txt` | rc=0, 0 B |
| MX-14 | `choosePlanByLabels` fallback → `undefined` | `criterion 5 > [] chooses standard`, `ignores custom labels` | `MX-14.txt` | rc=0, 0 B |
| MX-15/16/17 | `?? []` removed for nonGoals / relevantDocs / protectedPaths in `normalizeLoopInputs` | 72 / 72 / 37 red, including the bugfix bytes criterion (`... is not iterable`) | `MX-15.txt`, `MX-16.txt`, `MX-17.txt` | rc=0, 0 B each |
| MX-18 | `maxFilesTouched: input.maxFilesTouched ?? null` → no default | bugfix bytes criterion (`null` vs `undefined` in the recipe) plus investigate cases | `MX-18.txt` | rc=0, 0 B |
| MX-19 | `?? null` removed in `loopPlanDefinition` | `refusals > refuses a recipe whose plan version ...` | `MX-19.txt` | rc=0, 0 B |
| MX-20a | `plan.planId === planId &&` removed in `currentLoopPlanVersion` | same criterion (`[null, 1]` vs `[null, null]`) | `MX-20a.txt` | rc=0, 0 B |
| MX-20b | `newest === null \|\|` removed | **green in vitest and typecheck: equivalent mutant** | `MX-20b.txt`, `MX-20b-tsc.txt` | rc=0, 0 B |
| MX-20c | `\|\| plan.version > newest` removed | **green in vitest and typecheck: equivalent mutant** | `MX-20c.txt`, `MX-20c-tsc.txt` | rc=0, 0 B |
| MX-21 | `isLoopPlanId` → `return true` | `refusals > refuses a recipe whose plan version ...` (`[true, true]` vs `[true, false]`) | `MX-21.txt` | rc=0, 0 B |

### Why the survivors cannot be seen red

- **MX-4**: an absolute path such as `/etc/passwd` splits into a first segment `""`, and the segment check already refuses an empty segment. With or without `startsWith("/")`, every string gets the same verdict. I kept the brief's text because MA1-5's edit string quotes it. The controller may choose to delete `entry.startsWith("/") ||` as redundant; MA1-5 would then become the deletion of `if (entry.includes("*")) return false;`.
- **MX-20b and MX-20c**: `currentLoopPlanVersion` only differs from these mutants when a plan has two versions, and the registry holds exactly one per plan (spec §2.2). No test can reach the difference without adding a registry version, which A1 must not do. The first task that adds a v2 should add a "current version is the highest" criterion.
- **MX-2**: the guard exists to narrow `planId` and `version` for the type checker. At runtime `expandRecipe` refuses the same inputs, so the guard is only seen red through `npm run typecheck`.

## Files changed

- `src/control/loopPlans.ts` (new, 228 lines)
- `tests/control/loopPlans.test.ts` (new, 170 lines)

Both line counts come from the diff header in `$SCRATCH/a1/diff.txt`, measured at `2ce72e2`'s parent plus the working tree just before the commit. The commit output reports `2 files changed, 398 insertions(+)` (`commit.txt`).

## Commits

- `2ce72e2 feat(control): add the loop plan registry and its pure expansion`. `git log -1 --format=%B > $SCRATCH/a1/msg.txt` shows both trailer lines exactly (P8).

## Self-review findings

- The diff (`diff.txt`) was read in full. Only the two new files are in it, and no existing file changed.
- The module imports only `zod`, `canonicalJson.js` and `schema.js`, with no scheduler or webProtocol imports, as the brief's header comment requires.
- `maxFilesOf` still returns 1 for investigate when the cap is absent. After R-F15, a non-1 cap never reaches it. The comment "investigate always 1" is still true.
- Discipline strings are not asserted in A1. The panel tasks own them. They were copied verbatim from the global.md R-F5 table.
- I found no assertion that runs before the code under test and reads back a value the test itself wrote (Rule 9, second consequence). The `hash === sha256Canonical(canonicalJson)` assertion compares two values the code computes.

## Concerns

1. Equivalent mutants MX-4, MX-20b and MX-20c, and the typecheck-only MX-2. This goes against a strict reading of P3; see above.
2. The global.md Scratch line says to export `ECC_GATEGUARD=off DISABLE_OMC=1` before running criteria. The auto-mode permission classifier denied that command as a "Safety Bypass Flag", so every run here used only `TMPDIR=$(mktemp -d /private/tmp/cl-XXXX)`. The tests still ran and gave the results shown. Later tasks will hit the same denial unless the human allows it.
3. `.superpowers/sdd/.../task-A1-report.md` (this file) is not committed; the brief's commit step lists only the two source files.

## Departures from the brief

- The English strings (R-F5), the `investigate-max-files` refusal and its criterion, and the `givenFor` change (R-F15, P2) follow global.md and rulings.md, which override the brief.
- An extra criterion (unknown recipe version and `isLoopPlanId`) and 23 extra mutations (MX-1 to MX-21) were added for P3.
- The guard-disabling environment variables were not set (Concern 2).
