# Task 8 independent review

Reviewed `381362e1fb88878f7e36846e2d39fe5da94dd570..56925d0e42a3e936d65227261b7e388bae0904be` against the Task 8 brief, `2026-10-11-agent-preparation-design.md` §§1, 3, 4, and the shared feedback followup spec. I read the complete 3,430-line review package and inspected the changed source and existing evidence. This review changed no source, index, or HEAD and ran no tests.

## Spec Compliance verdict

**Partial; one important browser acceptance path remains blocked.** The backend supports import, confirmation, and scheduling with a null estimator profile, but the browser import form still prevents such an import. The primary/role selection table, selected-resolution compatibility check, new v2 confirmation hash, and invalid context draft guard otherwise follow the amended spec in the reviewed paths. The field-level inheritance display has a smaller gap for explicit null masks.

## Strengths

- `slotLayers` uses the effective group worker when the operator estimator role has no concrete field, while a concrete operator role retains its operator installation baseline. The existing same-agent resolution guard handles explicit switches; see `src/control/agentSelection.ts:73-86`. Focused tests cover no override, operator model-only, group model-only, plan primary, and explicit switch in `tests/control/agentSelection.test.ts`.
- Import reads the plan primary before probing and checks effective layer authority inside the command transaction; re-estimate also checks it after probing. See `src/control/planImport.ts:199-209`, `src/control/planImport.ts:266-274`, and `src/control/webService.ts:459-466`. The package includes race tests for a changed source with identical final fields.
- The compatibility predicate uses the selected resolution and intersected capabilities, including mode-sensitive budget and request-bound checks; see `src/control/estimatorCompatibility.ts:10-26`. No kind-based shortcut or alternate-Agent probe appears in the changed code.
- The v1 hash function remains a separate historical implementation and new previews use a v2 domain; see `src/control/agentSelection.ts:157-173` and `src/control/agentFreeze.ts:142`. The package contains a fixed v1 hash literal test. The diff does not change the default ccloop package pin or frozen-record rewrite paths.
- Unsupported context values are retained as visible select options, reported with a typed error, and disable the relevant save action; see `web/src/AgentFields.tsx:42-62`, `web/src/AgentFields.tsx:221-229`, and `web/src/AgentSettings.tsx:73-77`.

## Critical findings

None found.

## Important findings

1. **The browser still blocks every no-estimator plan import.** `web/src/ControlPanel.tsx:136-138` renders only a note when `config.defaults === null`, so no repository, plan, or import button is reachable. Its `importPlan` helper still dereferences `config.defaults!` at `web/src/ControlPanel.tsx:203-215`, and the English/Chinese note still says a plan cannot be imported (`web/src/locales/en.ts:347`, `web/src/locales/zh.ts:233`). This contradicts the acceptance requirement that no-estimate import work without an estimator and leaves the normal browser path unusable even though `src/control/planImport.ts:425-445` now handles null defaults. Change the form to offer the import action with omitted estimator fields when defaults are null, and cover the real browser command payload with a test. This is the main reason Task 8 cannot be accepted as complete.

## Minor findings

1. **A null-masked field loses its concrete inheritance label.** `web/src/AgentFields.tsx:179-183` returns no model/context hint whenever `current[field]` is defined, including `null`; `web/src/AgentFields.tsx:205-208` likewise uses the generic Agent option for `current.agent === null`. A panel null mask means “inherit from below,” so these are precisely fields for which the spec asks for the effective value and source. The server preview already supplies them; render that value/source for null masks as well. A test with a masked plan model/context and Agent would catch this.

2. **Claim-time compatibility degradation loses the named local reason.** The new import and re-estimate paths store `compatibilityReasonCodes`, but if a queued estimate's selected capability changes before claim, `src/control/webService.ts:519-523` only writes `estimate-capability-degraded`. The panel then shows a generic code instead of the compatibility reason that the shared predicate can provide. This is a narrower case than the initial required-action refusal, but it leaves a blocked estimate less actionable. Preserve the predicate's reason codes on this transition if the user-facing local explanation requirement covers claim-time degradation.

## Task Quality verdict

**Needs a Task 8 fix and focused retest before acceptance.** The backend structure and most targeted criteria are sound, but the no-estimator browser import is a direct acceptance miss. No source mutation was made during this review.

The reported Task 8 gates are root typecheck/build, Web build/check, focused root 220/220, and six restored deletion mutants. I inspected the six mutant failures in `task8-mutants.log` and the red final-source whole-root summary in `task8-full-fixed-final.log` (9 failed, 3700 passed, 33 skipped). Those full-root failures remain Task 14's gate and are not a Task 8 pass. The focused and Web pass counts and build/typecheck outcomes appear in `task-8-report.md`/`progress.md`, but their raw final command logs were not present in the supplied artifact directory; I therefore treat them as reported, not independently verified. The reported gates also do not cover the no-estimator import form.

## Cannot Verify

- Final focused root 220/220, Web 937/937, typecheck, and build exit codes from raw command output; only the implementer report and controller progress entry summarize them.
- Browser behavior after fixing the no-estimator import path; no fix exists in this reviewed range.
- A low-load, unfiltered whole-root green run. The available final-source full-root log is red; Task 14 owns that separate gate.
