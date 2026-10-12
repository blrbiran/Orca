# Task 14 documentation correction

- Base: `406babd`; branch: `codex/feedback-followup-task8`; commit: `5c4174cc77bf772a72532b652fd33049e78050e2`.
- Committed files: `README.md`, `skills/orca-control/SKILL.md` only. `node_modules` remains untracked and unstaged. No product code, schema, pin, handoff file, or controller-owned `progress.md` changed.

## Old misuse scenarios and corrections

1. `README.md:297-299`: An operator could assume the Requirements form blocks an explicitly selected Codex installation and never see the server refusal. The form submits every listed installation (`web/src/RequirementsPanel.tsx:92-120`); the server checks compatibility in `src/control/requirementCommands.ts:61-96` using `estimatorCompatibility` (`src/control/estimatorCompatibility.ts:16`). The README now says the form submits it and the server refuses its missing single-call capability.
2. `README.md:328-331`: An operator could look for handoff and goal-review Agent role overrides. The Agent selection editor exposes group worker, estimator and reconcile overrides (`web/src/AgentSelectionEditor.tsx:169-190`), while the budget editor binds worker, handoff and goal-review profiles (`web/src/BudgetEditor.tsx:288-300,374-381`). The README now distinguishes those controls.
3. `skills/orca-control/SKILL.md:81-82`: An agent following the old `get` list would call `orca control get operator/agent-installations` over the socket and receive 403. `src/panel/controlSocket.ts:31-37` assigns every socket caller the Agent principal; `src/panel/controlApi.ts:263-271` requires owner for this route. The skill now marks it as a Web owner-only read outside the socket `get` list.

## Validation

- `rtk python /Users/biran/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/orca-control`: RC 0, `Skill is valid!`
- `rtk git diff --check`: RC 0.
- `rtk npm test -- tests/entry/skill.test.ts`: RC 1, 2 passed / 4 failed. Three existing assertions expect 33 mutation routes although this checkout has 34; the fourth expects the phrase “same `--command-id`” already absent from the base skill. The edited lines do not affect those route rows or phrase.
- Post-commit `rtk git status --short`: only `?? node_modules`.

## Skill-test reconciliation follow-up

- Separate baseline: cloned the local Orca checkout into `/private/tmp/orca-task14-base-406babd` with `git clone --local --no-hardlinks`, detached at `406babd`, and linked the existing read-only dependency tree as `node_modules`. `CI=1 npm test -- tests/entry/skill.test.ts` at that base returned RC 1 (2 passed, 4 failed). Raw output: `/private/tmp/orca-task14-base-skill-test.log`; RC: `/private/tmp/orca-task14-base-skill-test.rc`. Three failures expected 33 mutation routes while the base source has 34. The fourth expected “same `--command-id`”, absent from the base skill.
- Test-only commit: `adda1fef9162942cc5d680158d558ffc808d2483` (`tests/entry/skill.test.ts` only). Lines 18-21 parse both spaced and compact panel route declarations and explicitly exclude `operator/apply-agent-update`. Lines 47-57 guard its presence and `human-only` policy, assert `verify-saved-result` is an Agent-allowed route, and compare documented routes and verbs with the remaining panel routes. Lines 37 and 67-74 validate the saved-result example against its raw schema. Lines 84-85 check lookup-first, uncertain lookup-miss, and same original command-id guidance already in the skill. No skill text change was needed.
- RED with the revised route expectations before fixing the compact-route parser and schema map: RC 1 (3 passed, 3 failed); raw `/private/tmp/orca-task14-red-skill-test.log`, RC file alongside. The parser omitted the compact saved-result declaration and the payload map still lacked its schema.
- GREEN final `CI=1 npm test -- tests/entry/skill.test.ts`: RC 0, 6 passed; raw `/private/tmp/orca-task14-final-skill-test.log`, RC file alongside.
- `rtk npm run typecheck`: RC 0. `rtk python /Users/biran/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/orca-control`: RC 0. `rtk git diff --check`: RC 0. Post-commit `rtk git status --short`: only `?? node_modules`.

## Scoped review residual wording

- The scoped review found that the skill quick start still called handoff and goal-review choices “agents.” Commit `9343641a4e631fa6bcc7c454848c112a44607f2c` changes only `skills/orca-control/SKILL.md:27-30` to distinguish worker/estimator/reconcile Agent selections from worker/handoff/goal-review profile bindings, matching `README.md:328-330` and the skill's `confirm` payload. No test change was needed.
- Focused `CI=1 npm test -- tests/entry/skill.test.ts`: RC 0, 6 passed. Raw `/private/tmp/orca-task14-residual-skill-test.log`; RC `/private/tmp/orca-task14-residual-skill-test.rc`.
- `npm run typecheck`: RC 0; raw `/private/tmp/orca-task14-residual-typecheck.log` and `.rc`.
- `quick_validate.py skills/orca-control`: RC 0 (`Skill is valid!`); raw `/private/tmp/orca-task14-residual-quick-validate.log` and `.rc`.
- `git diff --check`: RC 0; raw `/private/tmp/orca-task14-residual-diff-check.log` and `.rc`.
- Post-commit `git status --short`: only `?? node_modules`. The report remains under the ignored `.superpowers` area and was not staged.
