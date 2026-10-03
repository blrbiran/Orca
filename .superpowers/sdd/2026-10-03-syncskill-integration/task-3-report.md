# Task 3 report: declaring `skills` on a loop recipe

Commit: 60a0eb0 `feat(loop-plans): let a loop task declare a skill set (names or a syncskill profile)` (on top of 847a7a6). Not pushed.

## Golden (captured at HEAD 847a7a6, before any code change)
Method: temp vitest file calling `expandLoopTask("a","/repo",{plan:"bugfix",goal:"fix login",successCondition:"the login test passes",targetPaths:["a"],checks:["npm test"]},[])`, then canonicalBytes/sha256Canonical of recipe, of a plan entry, and of `{tasks:[entry]}`. Stored in `tests/control/fixtures/loopPlanGolden.json`; the golden test passed at HEAD before the change and after it.
- contractHash be3e2fe59e351cae80c9487e7d1904eaa065a136124d0a4af8cd37065af2ba44
- planHash (of {tasks:[entry]}) 95215c0380e671c7f0c16fb0ee9d931dee47e339b07033ff56cb08297c193be5
- recipe and plan-entry canonical bytes: in the fixture.
Note: planHash here is of a hand-built plan object (repoPath "/repo"), not a real archived group (real ones embed a temp repo path).

## RED / GREEN
RED: before implementing, 17 of 19 tests failed (skills undefined, no refusal, missing exports). The "contract has no skills" test passes at HEAD trivially (it is a guard, killed by mutations only if skills leak). GREEN: 21/21 after implementation, after adding the recipe-schema and Web-import tests.

## Mutations (clone: scratchpad/t3/clone, env HOME/XDG*/TMPDIR redirected)
| mutation | result |
|---|---|
| write `skills: normalized` (undefined) when absent | red |
| write `skills: null` when absent | red |
| drop `,` from isSafeSkillName | red |
| drop sort | red |
| drop dedup | red |
| drop names isSafeSkillName check | red |
| drop skills-shape refusal in expandLoopPlan | red |
| expandLoopTask not passing input.skills | red |
| profile regex removed | red |
| `.min(1)` on names removed | red |
| `.strict()` removed on profile object | red |
| `skills` removed from loopRecipeSchema | first run GREEN (survived) -> added test `re-parses a recipe with skills` + Web import test -> second run red |
Restore proof after each: file shasum equal to pre-mutation (`SHA-SAME`), `git diff` 5478 bytes before and after, `git diff --cached` 0 bytes.

## Verification (clone)
- `tsc --noEmit -p tsconfig.json`: exit 0.
- vitest on tests/control/loopPlan*, setTaskLoop*, planImport*, taskAmend*, tests/scheduler/planFile*, tests/skills, requirementSplit/driverRequirementSplit: 22 files, 282 passed, 2 skipped (pre-existing skips, not mine), exit 0.
- Main tree: only loopPlanSkills.test.ts run.

## Files
- src/control/loopPlans.ts: `loopSkillsSchema`, `LoopSkills`, `normalizeLoopSkills`; `skills` optional on `loopPlanFileSchema` and `loopRecipeSchema`; `LoopRefusal` += "skills-shape"; `expandLoopPlan(..., skills?)`; `expandLoopTask` passes `input.skills`. Imports isSafeSkillName/PROFILE_NAME_PATTERN from src/skills/syncskill.ts.
- tests/control/loopPlanSkills.test.ts (new, 21 tests), tests/control/fixtures/loopPlanGolden.json (new).
- No existing test modified. webProtocol.ts, planFile.ts, requirementSplit.ts unchanged: archive uses loopRecipeSchema, which now carries skills.

## Decisions
- Normalisation (validate, sort, dedup) happens inside `expandLoopPlan`, so Task 5's set-task-loop gets it for free; `normalizeLoopSkills` also re-runs the schema so a malformed runtime value yields "skills-shape" rather than throwing.
- At the plan-file door, shape errors (both keys, `names: []`, bad profile, unknown key) are rejected by `loopPlanFileSchema` (zod) before expansion; name-rule violations (".x", "a/b", "a,b", " a") surface as `loop-plan-invalid:<task>:skills-shape`. Both paths are tested. loopRecipeSchema itself does not apply the name rule (parse-only shape, per brief); normalisation is at expansion.
- Sort uses default JS code-unit order.

## Concerns
- progress.md in the main tree was already modified before I started; left unstaged and untouched.
- The panel's/web's plan schemas other than via loopRecipeSchema were not audited for `skills` (set-task-loop payload is Task 5).
