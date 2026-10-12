# Task 8 implementation report — Primary Agent and role inheritance

Worktree: `/private/tmp/orca-feedback-followup-task8-20261011` on `codex/feedback-followup-task8`; base local main `381362e1fb88878f7e36846e2d39fe5da94dd570`. Scope was Task 8 only. No ccloop pin, remote, publication, provider, real service, or real user data changed. The pre-existing `node_modules` symlink and controller-owned `progress.md` were not staged.

Commits: `10c6646` (`feat(agents): share primary selection with compatible role overrides`), `56925d0` (`fix(agents): explain blocked estimator compatibility locally`), and `87463dc` (`fix(agents): complete no-estimator import and inheritance feedback`).

## Independent-review fix round — 2026-10-12

Review: `task-8-independent-review.md`. Controller required all three findings in one scoped pass. Commit: `87463dc8188676d36d987ac506acc36041f98040` (`fix(agents): complete no-estimator import and inheritance feedback`), tree `11ed492fda9eb02abd9111f7cc53bcd7cfcc9c1c`.

1. **Browser no-estimator import.** RED: the new jsdom test found only the old “cannot import” note and no import button in English or Chinese. GREEN: `ControlPanel` renders the normal repository/plan controls with a truthful bilingual note; the real button emits an `import-plan` action whose payload has exactly `groupId`, `repoId`, and `planId` when defaults are null. A separate test preserves the configured-estimator fields on ordinary imports. The superseded `controlPortBanner` expectation now requires the button, and the Chinese `controlI18n` wording assertion uses the new truthful note.
2. **Null-mask inheritance.** RED: a group worker with null-masked plan Agent/model/context showed no concrete inherited values. GREEN: the existing server-resolved preview supplies value and provenance for all three; null now counts as inherited in `SelectionFields`. The masked-plan Web test asserts `claude` from operator and model/context from that Agent's operator defaults.
3. **Claim-time capability degradation.** RED: `estimateSingleCallGate` read only generic `estimate-capability-degraded` after the selected Agent stopped answering single-call v1. GREEN: the claim transition keeps that generic reason for compatibility and persists `compatibilityReasonCodes: ["single-call-unavailable"]`; the panel estimate projection exposes it. A context-window shrink also produces a named `context-window-degraded` reason.

**Post-commit evidence** is indexed by `task8-fix-gates.json` in this directory. The JSON records final HEAD/tree, exact fixed-pin ccloop HEAD `ab824d16004de2d3c1613a76ec0431520aa16cc9`, `TMPDIR=/private/tmp`, each complete command, raw log path, return code, duration, and named test count. Logs are `task8-fix-typecheck.log`, `task8-fix-root-build.log`, `task8-fix-web-build.log`, `task8-fix-focused-root.log`, `task8-fix-full-web.log`, `task8-fix-diff-check.log`, plus three isolated Overview logs and `task8-fix-full-web-retry.log`.

At final HEAD, root typecheck/build, Web build, and diff check returned 0. The focused root gate passed **20 files / 252 tests**. The first recorded full Web run returned 1: one `overviewDecisionNavigation` async decision-owner response was still loading at the test's wait, with 940 other tests passing. No Overview/App source changed in this fix. That file passed **10/10** in each of three isolated runs with unchanged timeouts, and a second unfiltered Web run at the same HEAD returned 0 with **107 files / 941 tests passed**. Both the red and green full-Web raw logs and RCs remain in the manifest. No unfiltered whole-root gate was repeated; Task 14 retains that gate and the prior high-load timeout evidence.

## Product changes

- Estimator selection now follows the effective group worker primary, including the archived plan layer and panel null masks, when no operator estimator role field is concrete. A concrete operator role stays associated with the operator primary; group role fields overlay that baseline. Agent switches keep model and context from the selected installation only. `group-primary` is a strict provenance source in root and browser DTOs.
- Import probes the effective plan primary before the asynchronous call and rechecks a hash of the effective layers and provenance at commit. Re-estimate rechecks the same hash after its probe. This catches a source change even when the final agent/model/context partial is identical. Requirement split acceptance carries the same plan-primary authority into its import.
- New confirmation previews use a `v2` selection hash domain. The historical `selectionsHash` v1 function and stored frozen bytes stay intact. The panel also exposes read-only group worker and estimator role previews for concrete inheritance labels; these are outside the confirmation hash.
- A draft import without an estimator profile records a blocked, profile-null estimate and retains deterministic proposal defaults. Confirmation can explicitly bind worker, handoff, and goal-review profiles with estimator null, and start schedules work. Required clarification returns `control-estimator-unconfigured` or a named local compatibility reason. The shared compatibility predicate judges the selected resolution, configured mode, preflight instruction, context, usage, budget, handoff, and strict request bound; there is no kind-based shortcut or alternate Agent probe.
- New blocked import and re-estimate records optionally carry the predicate's exact compatibility reason codes into the panel estimate view. Historical estimate bodies omit the field and remain byte unchanged; the generic existing `reasonCode` remains compatible.
- Agent settings place the primary Agent, model, and context together, fold other installations and role overrides, retain inactive preferences, and keep existing model/context role overrides associated with their old primary when the primary changes. Group/task fields show server-resolved inherited values and sources. Unsupported context drafts remain selected and visible, return typed `SelectionFieldError`, and disable lossy submission. Switching Agents clears old model/context drafts. No-profile confirmation offers explicit budget mode and required execution profile choices.

## RED → GREEN witnesses

All root commands below used `TMPDIR=/private/tmp` and a local fake-only ccloop binary under `ORCA_CCLOOP_BIN` where process identity was needed. `rtk proxy` was used for shell commands.

| Behavior | RED observed before production change | GREEN evidence |
|---|---|---|
| No estimator role inherits B/B-m; partial operator role stays A/A-m; group model-only B-x; explicit C switch | `npm test -- tests/control/agentSelection.test.ts`: 3 expected selection assertions failed | Same file: 16 tests passed after implementation |
| Import probes archived plan primary | `npm test -- tests/control/planImport.test.ts -t 'probes the plan worker primary'`: imported estimate was blocked, not queued | Exact test passed and frozen B/B-m selection was read back |
| Plan layer moves during an async probe | New same-fields plan-layer test imported successfully when it should refuse; ordinary changed-primary test was also RED | Both return `plan-version-conflict`; no group was written |
| Operator role source moves during re-estimate with identical partial | New role-source race test created estimate v2 when it should refuse | Returns `agent-selection-changed`; estimate row count stays 1 |
| No estimator profile | New async import test failed reading `null.estimatorProfileId`; synchronous import test wrote an invalid frozen slot | Import/confirm/start fake-only lifecycle passes; profile-null estimate is readable; synchronous slot is null |
| Compatibility from selected resolution | `estimatorCompatibility.test.ts` failed because the shared module did not exist | 3 predicate tests pass, including strict versus soft bound behavior; real fake-CLI requirement E2E passes in configured soft mode |
| Local estimate reason projection | New fake-only blocked import test found `compatibilityReasonCodes` undefined; a legacy queued record test pins absent field and unchanged stored bytes | Blocked import and re-estimate records expose `single-call-unavailable`, panel projection and Web display show it, legacy body stays unchanged |
| Unsupported context and Agent switch | Web tests saw unsupported select value silently drop and allowed saving; Agent switch retained old visible model; old-Agent role context disabled valid save | Focused Web cases pass with retained draft, disabled invalid action, cleared old draft fields, and valid old-Agent role save |
| Inheritance labels | Task fields lacked concrete inherited model/context/Agent; panel group role previews absent | Task and group estimator fields show server value plus provenance; strict panel preview test passes |

## Test gates and environmental diagnosis

- Root `npm run typecheck`, root `npm run build`, Web `npm run build --workspace web`, and `git diff --check`: passed on the Task 8 source.
- Final focused root selection/import/requirements/panel on `56925d0` source, including real local fake-CLI E2E and strict mirrors: **16 files, 220/220 passed**. This is Task 8's planned root gate. Earlier focused runs passed 163/163 before the role-preview addition, 61/61 strict panel preview/mirror tests after it, and 217/217 before the compatibility-reason follow-up.
- Full Web check on final UI source: **937/937 passed**. A concurrent root/Web run earlier had 935 passed and one `memoryLayout` scroll timing assertion fail; that exact file passed 2/2 in isolation without a timeout change. The final reduced-load full Web run was green.
- Initial bare root `npm test`: 3549 passed, 101 failed, 89 skipped. It lacked `web/dist`, selected the nonexistent `/private/tmp/ccloop/dist/cli.js`, and used a long system temp path that exceeded Unix socket limits. This is prerequisite/environment evidence, not a passing gate.
- Corrected full root against Tasks 1–7 ccloop clone: 3700 passed, 6 failed, 33 skipped; raw log `task8-full-root.log`. Two `taskResultPaired` failures were the test's exact-binary guard because the clone path is neither of its two allowed paths. Both paired tests passed 2/2 against the exact fixed pin (`ab824d1…`) and 2/2 against the exact feature binary (`adbc9a9…`). Three `retryTask` tests timed out at their unchanged 5000 ms limit during the loaded run; the whole file passed 15/15 in each of three sequential reduced-load runs. Two of those names are registered in `docs/handoff/known-load-flakes.md`; the reserve-shortfall timeout is a new observed load sensitivity and is not registered. `requirementE2E` exposed a Task 8 bug: compatibility used strict despite the configured soft mode. That code was fixed and the real local fake-CLI E2E passed in isolation.
- A fixed-pin whole-root run was deliberately interrupted with exit 130 before the authority-hash changes; raw log `task8-full-fixed.log` is preserved as non-acceptance evidence. The final-source fixed-pin whole-root run had **3700 passed, 9 failed, 33 skipped** in 623 s; raw log `task8-full-fixed-final.log`. All nine were unchanged 5000 ms timeouts: `gateCheck` K1 and K6, and seven `settleUnknownUsage` tests. These are new observations, not the registered K12/K13 or F2 cases. During the loaded full run, `uptime` showed load averages about 19/16/12. With load down to about 7 then 5, the whole `gateCheck` file passed 19/19 on each of three sequential runs; the whole `settleUnknownUsage` file passed 36/36 on each of three sequential runs. No timeout was broadened or test skipped. A low-load unfiltered whole-root run at `--maxWorkers=2` reached about 67/392 files and 956 passing test lines without a reported failure before the controller explicitly reassigned that whole-repository gate to Task 14; it was stopped with exit 130. Its 147 KB raw partial log is `task8-full-lowworkers.log`; JSON was not emitted before interruption. It is non-acceptance evidence.

The nine final-source whole-root timeout names were: `gateCheck` K1 “PreToolUse removed” and K6 “settings.json is not JSON”; `settleUnknownUsage` “settlement before handoff counts as complete usage,” “refuses report without accounting or activity writes,” the snapshot/artifact/missing released-accounting defect cases, and both `silent=false` and `silent=true` other-run blocker cases. The reduced-load 3/3 runs covered every test in both files.

## Deletion mutants

All six temporary source mutations were restored byte-for-byte by a `finally` block; `task8-mutants.log` records the assertion failures:

1. Remove the same-agent field guard: `switching agent drops the model...` failed.
2. Remove the single-call compatibility check: the absent-single-call predicate test failed.
3. Remove invalid-draft Save disablement: the unsupported-context Web test failed.
4. Replace v2 freeze hash with v1: the version-domain test failed; historical v1 literal remained unchanged.
5. Add an empty compatibility field to all estimates: the legacy-byte test failed.
6. Omit the compatibility-reason panel projection: the blocked import view test failed.

## Exact superseded expectations

- `tests/control/agentPlanImport.test.ts` — “still imports when no operator layer names an agent -- a plan's worker agent does not count ...” was replaced by plan-primary selection; re-estimate provenance now names `group-primary`.
- `tests/control/agentPlanPanelMerge.test.ts` — estimator panel null inherits the group primary source.
- `tests/control/agentFreeze.test.ts` and `tests/panel/agentSelectionApi.test.ts` — new previews use the v2 hash domain; the v1 literal remains tested separately.
- `tests/control/planImport.test.ts` — a new import now reads the plan primary before the probe, so the stale-revision test expects that one source read but still proves no import after the await.
- `tests/panel/controlMount.test.ts` — without a configured estimator, import reaches the target validation route instead of failing at the estimator default gate.
- `web/tests/agentSelectionEditor.test.tsx` — group estimator context follows group worker primary without an explicit operator role.
- `web/tests/feedbackRequirements.test.tsx` — the browser no longer rejects all `kind="codex"` installations; the server checks the selected resolution's actual capability.
- `web/tests/agentsI18n.test.tsx` and `web/tests/i18nPseudo.test.tsx` — the new actionable missing-Agent text and `group-primary` enum are included.

## Self-review and residuals

The strict source and browser schemas were changed together; no historical frozen record is rewritten. Import/re-estimate authority is rechecked inside the command transaction after awaited probes. No Agent replacement or kind-based capability inference remains. Unsupported context is retained in a select option and invalid submission is disabled; low-level historical drop helpers remain for compatibility. The panel's extra role previews are read-only and excluded from confirmation hash and dispatch authority. No code or test outside Task 8 was intentionally changed. The unfiltered root gate remains red under concurrent load and belongs to Task 14; this report does not relabel it green or waive the new timeout names. After the follow-up commit, the final required Task 8 gates are root typecheck/build, Web build/check, focused root 220/220, `git diff --check`, and six deletion mutants, all passed. No remaining Task 8 product concern is known; Task 14 owns the unfiltered root gate.
