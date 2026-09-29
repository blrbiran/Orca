# Task A2 report — the plan summary text (`describeLoopPlan`)

Implementer: session `1d7d9aa0` subagent (Opus 5.5), 2026-09-30. BASE 2ce72e2. Commit d40eed2 on local `main`.
SCRATCH = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/1d7d9aa0-4a2b-478b-b0ec-d970d3a51afe/scratchpad/a2/`
(evidence files below are relative to it).

## What was implemented

- `src/control/loopPlans.ts` (appended after `choosePlanByLabels`):
  - module-private `countOf(n, noun)` → `"1 file"` / `"25 files"` (ruling P1 singular for 1);
  - `export function describeLoopPlan(recipe: Pick<LoopRecipe, "planId" | "planVersion" | "inputs">): { planName: string; summary: string[] } | null`
    — the brief's structure with the R-F5 English strings: `Goal: X`, `Done when: X`, `Only changes: X` (joiner `, `),
    `Must not change: X (reported by the agent, not checked in git)` only when protectedPaths is non-empty,
    `At most N file(s) changed (reported by the agent)` via the A1 module-private `maxFilesOf` (investigate → 1),
    `Acceptance: N check command(s), all must pass`, then the plan's `discipline` when non-null. Unknown plan/version → `null`.
- `tests/control/loopPlanSummary.test.ts` (new, 11 criteria): the brief's file with English expected values.

## Departures from the brief (and why)

1. English strings throughout (R-F5), including test values: `由模型核对` → `checked by a model`, red-first prefix
   `Write a failing test that reproduces the bug`, `不许改：` → `Must not change: `, plan names per the table.
2. P7: the self-equality assertion `lines(plan)` toEqual `lines(plan)` was dropped; the test keeps only the second
   assertion and is renamed to what it now checks: `puts another goal into another first line`.
3. P1: added one criterion `says 1 check command in the singular (ruling P1)`; the file singular is pinned by the
   existing investigate assertion (`At most 1 file changed (reported by the agent)`), the plurals by the bugfix pin
   (`2 check commands`, `25 files`) and refactor (`7 files`).
4. Test title for the F6 criterion uses `'checked by a model'` in place of `由模型核对`.

## RED

`./node_modules/.bin/vitest run tests/control/loopPlanSummary.test.ts > a2-red.txt 2>&1` → rc=1.
All 11 criteria fail with `TypeError: describeLoopPlan is not a function` — expected: the export does not exist yet.

## GREEN

`./node_modules/.bin/vitest run tests/control/loopPlanSummary.test.ts tests/control/loopPlans.test.ts > a2-green.txt 2>&1` → rc=0:
`loopPlanSummary.test.ts (11 tests)`, `loopPlans.test.ts (85 tests)`, `Tests 96 passed (96)`.
`npm run typecheck > a2-tsc.txt 2>&1` → rc=0 (tsc output empty). Web not touched; web typecheck not run.

## Mutations (clone `mut-a2`, kept; clone rc=0, copy file `a2-copy.txt` empty)

Criterion file: `tests/control/loopPlanSummary.test.ts`. Each edit applied by `mutate.py` (exactly one match, edit
file empty), restored with `cat`, `cmp` rc=0 with empty `a2-<name>-restore.txt`. Final cmp of both files vs REPO: 0.

| Name | Edit (src/control/loopPlans.ts) | Red criteria | Evidence |
|---|---|---|---|
| MA2-1 | acceptance line → `` `Checks: ${inputs.checks.join("; ")}` `` | pins bugfix's lines; all 5 `<plan>: never puts a check command's text …`; says 1 check command in the singular | a2-MA2-1.txt (7 failed) |
| MA2-2 | protected line unconditional | marks protected paths … shows no protected line … | a2-MA2-2.txt (1 failed) |
| MA2-3 | `countOf(maxFilesOf(plan, inputs), "file")` → `countOf(25, "file")` | marks protected paths … investigate's cap as 1 | a2-MA2-3.txt (1 failed) |
| MA2-4 | REGISTRY design `discipline` → bugfix's red-first line | shows the red-first discipline for bugfix only … | a2-MA2-4.txt (1 failed) |
| MA2-5 (P3, new branch) | delete `if (plan === null) return null;` | names each plan … knows no plan version it does not have (TypeError reading `name` of null) | a2-MA2-5.txt (1 failed) |
| MA2-6 (P3, new branch) | delete the `...(plan.discipline === null ? [] : [plan.discipline])` line | pins bugfix's lines; shows the red-first discipline … | a2-MA2-6.txt (2 failed) |
| MA2-7 (P3, new branch) | `countOf`: `${n === 1 ? "" : "s"}` → `s` | marks protected paths … investigate's cap as 1; says 1 check command in the singular | a2-MA2-7.txt (2 failed) |

All 7 red under vitest (none needed typecheck). Every run rc=1.

## Files changed

- `src/control/loopPlans.ts` (+28 lines)
- `tests/control/loopPlanSummary.test.ts` (new)

## Commits

- d40eed2 feat(control): describe a loop plan in plain words for the panel — trailer checked in `a2-msg.txt` (both lines present, exact).

## Self-review

- Pure: no clock/fs/model; reuses `loopPlanDefinition` and `maxFilesOf` so the summary cap never disagrees with the contract.
- `describeLoopPlan` does not validate path shapes (it describes; expansion refuses). A recipe that would be refused
  by `expandRecipe` still gets lines — consistent with the brief; callers are expected to hold only valid recipes.
- Existing criteria: `loopPlans.test.ts` stayed green (85/85). Full suite not run (main-tree rule).

## Concerns

- The `, ` list joiner (multi-path targetPaths / protectedPaths) is not pinned by any criterion: every fixture uses one
  path. It is not a branch (P3 does not require it), but a joiner regression (e.g. back to `、`) would stay green.
  A one-line assertion with two paths would close it; not added to stay within the brief.
