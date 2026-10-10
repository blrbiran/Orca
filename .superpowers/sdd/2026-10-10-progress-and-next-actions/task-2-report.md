# Progress Task 2 implementation report
Owner: /root/progress_task2, Codex implementer, 2026-10-10. Worktree: `/Users/biran/.codex/worktrees/progress-results-20261010/Orca`. Branch: `codex/progress-results-20261010`. Base authority: `4ee9b794e1b9336acad6797e4ed888f5189b1790`.
Status: DONE. Implementation commit `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166`; final source/test commit `b15a1dc2fbcf43a8ff814f5c1ddc97d1631a428a`. Native full Web/typecheck: **95 files, 789 tests passed**, RC0 (`task2-self-review-web`). Root and Web builds passed. Twenty-nine distinct semantic clone faults hit intended business criteria; every clone restored working/cached diff bytes 0; restored final criteria 42/42 passed.
## Implemented behavior and interfaces

`overviewApi.ts` provides the existing authenticated GET-only `fetchOverview(): Promise<OverviewV1>`. `overviewNavigation.ts` defines the requirement/group/decision/global-control discriminated destination and shared focus IDs. `overviewModel.ts` composes the full Overview DTO, independently unfiltered todo, independently read recovery, unresolved client commands, actual project registry mappings and current scope. `Overview.tsx` is a pure callback-only view: no fetch, command intent, POST, acknowledgement or start/retry logic.

Overview is the empty/unrecognized-hash default. Valid previous section hashes are preserved. Progress precedes the human queue in DOM and uses the selected layout B: a wider primary progress column with queue alongside, collapsing in the same order. Existing tokens/style, integer budget controls, role guards, frozen Agent choices, defaults and commands remain. Task counts use producer plan-task completion/counts; `review` names goal review and `done` explicitly keeps Git delivery separate. Missing counts are unavailable. Normal running/ready/review/dependency summaries never manufacture queue steps.

The independent todo read runs initially and every 5000 ms while Overview is active. Projection and recovery run at the control 2000-ms cadence only while Overview is active. Latest request tokens, actual AccountContext identity, scope/project identity and control epoch are captured; current identity is updated during render so effect cleanup cannot admit an older reply. Projection responses also respect epoch and monotonic changeSeq. Timers and pending arrivals are invalidated on pane change/unmount/context change. Metrics failure is local to Metrics and does not discard healthy todo/control; todo failure retains explicitly stale rows or unavailable state, with an unavailable badge/count instead of zero. Reviewed/All decision-list refresh no longer depends on a successful metrics read.

Only producer steps plus independent decision/recovery/uncertainty facts enter the human queue. Recovery dedup uses the admitted producer key and `(scope,groupId,runId,code)`, retaining distinct scope/code/run/owner facts and OR-ing ownerRequired. An accepted requirement's export problem retains the producer's Requirements destination when the independent recovery source repeats it. Unknown registry ownership, unresolved imports, global blockers and per-source issues remain visible in concrete scopes. Ordinary Decisions filters do not filter Overview todo; composite `(projectKey,id)` identity survives All and concrete filtering.

App owns all source records, selections, drafts, callbacks, navigation and focus. Group/requirement navigation reads its live owner, validates identity/repository/archival/epoch/changeSeq and requested task/run, rejects old request arrivals, and focuses after arrival. Removed/changed owners cause explicit unavailable plus source reread. All stays All. Exact decision owner GET uses the existing composite selection path, with auth/scope/epoch/late-arrival guards preserved. Global recovery/import opens the existing Tasks region and reads existing control state; it creates no command. Group passive anchors are preparation/dispatch/problem/integration/results; requirement anchors answers/draft/problem. The results anchor is deliberately passive; actual Results hierarchy and settings belong to subsequent tasks.

Both English and Chinese resources are complete and pseudo-locale-tested. No dependencies/schema/backend/default-pin changes. No paid provider, production data mutation, runtime/service switch, merge, push or deletion. No subagents/reviewers were spawned. Controller audit document and node_modules symlink were never staged.

## TDD and failure classification

Behavioral tests were written against the existing App before implementation. `task2-red-app-real` observed five expected failures: no Overview, wrong default hash/order, metrics failure suppressing the whole shell, and missing owner navigation. `task2-red-freshness` observed all seven initial independent freshness criteria fail against the missing Overview behavior. DTO fixtures typechecked subsequently; these failures were assertions/observable missing behavior, not malformed producer DTOs.

`task2-owner-red` caught the actual race where an owner response older than the newest projection reopened detail. Production validation was corrected to consult the latest source/control revision. Its other three failures came from a test querying inside Overview while the navigation alert was its pane sibling; those were test-scope errors and are not presented as TDD proof for already-working rejection.

`task2-decisions-unavailable-red` observed the real false `0 of 0` result on initial todo failure. Decisions now renders an unknown count and unavailable list state. Focused GREEN, final native full check and clone deletion proofs are recorded below. Composition/recovery/filter tests extended coverage after integrated App RED; they are not falsely described as having each independently failed before their existing integrated behavior.

The first write was denied by this agent's ordinary sandbox because the managed worktree was outside its writable roots. Nothing was written and `task2-red-app` therefore ran baseline shell only, RC0; it is NOT RED evidence. Controller-authorized narrow escalation wrote subsequent files. No automatic approval-review rejection occurred.

Other retained setup/test-correction evidence: `task2-type1` used a nonexistent typed category translation path; corrected to the existing graph category family. `task2-model-first` expected an unjustified ordering among same-priority exceptions; the visibility test now compares its hand-derived set, while a separate priority/stable-key test remains. Early project helper failures clicked a missing/transient row or empty repository option before the initial epoch/source settled; they now await the actual row/current initial epoch/options. All ownership/draft/filter assertions remain. `task2-green3` lacked new pseudo-locale imports, and `task2-i18n-final` lacked within; both were ReferenceError setup failures, not business RED. `task2-focused-freeze` and `task2-fresh-final` accidentally held the shared legacy control recovery consumer as well as/newer than the independent Overview source; the fixture now holds only the independent poll. No unrelated recovery lifecycle repair was made. `task2-final-criteria` initially matched the Decisions link without its badge; fixed to the existing badge-aware accessible name.

The first native full Web run, `task2-web-full`, failed only the existing recorded-outcome i18n test because its global status query became ambiguous with mounted Overview source statuses. The exact outcome texts were preserved, the query scoped to its decision detail, and the workflow explicitly navigates into Decisions and asserts data-active=true. Failed logs remain. Later full runs passed, and self-review added real filter navigation, positive task/run focus and accepted requirement recovery ownership before the final frozen full gate.

The initial projection-monotonic clone fault produced an esbuild syntax error when removing a ternary arm. It is retained as setup evidence and excluded from effective fault count. A fresh corrected clone disabled the conditional while preserving syntax and failed its lower-changeSeq business criterion.

## Exact existing criterion adjustments

- `web/tests/shell.test.tsx`: former “round-trips every section through its hash and sends an empty or unknown hash to requirements” is now “…to overview”; empty, `#`, and unknown defaults are Overview, while every recognized old hash still round-trips. Existing “lists Requirements in the nav after Task control and keeps its pane mounted while another is active” (its inherited name already predates the prior ordering) now asserts `[overview, requirements, tasks, decisions, memory, metrics, chains]` and still requires the inactive Requirements pane mounted. No deep-link expectation was weakened.
- `web/tests/decisionsI18n.test.tsx` → `the recorded outcome in Chinese` → `says each recorded outcome in Chinese, and in English after a switch`: same exact Agree/Correct/refusal/retry/language outcome strings; only decision-owned status scoping, actual Decisions activation and async row readiness were added.
- `web/tests/projectFiltering.test.tsx`: shared openDecision helper now awaits current initial epoch and exact intended row. `decision identity and count` cases “7: without a project list the pane keeps today's behaviour: every row, its own repository filter” and “8: a repository filter set before the project list arrived does not hide rows once the scope takes over” await initial epoch/live options before selecting. `selection lifecycle` case “7: a decision opened before the project list answers stays open when the list resolves” still opens before registry resolution and still requires persistence afterward. Expectations unchanged.
- `web/tests/projectScopeDecisionRequests.test.tsx`: shared openDecision readiness fixed; all request owner/reverse-order/retry/draft-preservation expectations unchanged. Exact affected failure names remain in task2-regressions.log and the full output audit.
- `web/tests/i18nPseudo.test.tsx`: a genuine Overview/source-state fixture adds pseudo-locale and Chinese coverage; existing catalogue counts and translations unchanged.

## Native commands, CWD, logs and RC

All executions use the controller-owned `/private/tmp/orca-progress-results-20261010/run.py`, which records exact argv before execution and full stdout/stderr to `.log`, then `.rc`. Outer shell calls use `rtk proxy`; native validation output is retained without shell pipes/grep/tail. Main-task CWD for every native command below is the feature worktree above; Vitest reports the Web subdirectory itself. Clone commands have their exact CWD/full observed SHA in their `.command.json` and `.cwd` before execution. The owned HOME/XDG/TMPDIR/CCMEM environment is inherited from the controller runner, not printed or changed.

Commands below were measured on base plus Task2 working bytes, committed without production changes as implementation SHA above; self-review added only two test files at final SHA. Each later clone captured and asserted its full current HEAD automatically. Final byte binding is in task2-final-source-agreement.json.

| Run | RC | Exact native argv | Full raw log |
|---|---:|---|---|
| task2-decisions-unavailable-red | 1 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewFreshness.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-decisions-unavailable-red.log](/private/tmp/orca-progress-results-20261010/task2-decisions-unavailable-red.log) |
| task2-default-ssr-red | 0 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/App.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-default-ssr-red.log](/private/tmp/orca-progress-results-20261010/task2-default-ssr-red.log) |
| task2-diff-check | 0 | `["git", "diff", "--check"]` | [task2-diff-check.log](/private/tmp/orca-progress-results-20261010/task2-diff-check.log) |
| task2-filter-diagnosis | 1 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/projectFiltering.test.tsx", "-t", "repository filter set before", "--maxWorkers=2", "--no-cache"]` | [task2-filter-diagnosis.log](/private/tmp/orca-progress-results-20261010/task2-filter-diagnosis.log) |
| task2-filter-final | 1 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/projectFiltering.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-filter-final.log](/private/tmp/orca-progress-results-20261010/task2-filter-final.log) |
| task2-filter-green | 1 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/projectFiltering.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-filter-green.log](/private/tmp/orca-progress-results-20261010/task2-filter-green.log) |
| task2-final-criteria | 1 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewFreshness.test.tsx", "tests/overviewApp.test.tsx", "tests/decisionsI18n.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-final-criteria.log](/private/tmp/orca-progress-results-20261010/task2-final-criteria.log) |
| task2-final-criteria2 | 0 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/decisionsI18n.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-final-criteria2.log](/private/tmp/orca-progress-results-20261010/task2-final-criteria2.log) |
| task2-focused-freeze | 1 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewApp.test.tsx", "tests/overviewFreshness.test.tsx", "tests/overviewModel.test.ts", "tests/projectFiltering.test.tsx", "tests/projectScopeDecisionRequests.test.tsx", "tests/i18nPseudo.test.tsx", "tests/shell.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-focused-freeze.log](/private/tmp/orca-progress-results-20261010/task2-focused-freeze.log) |
| task2-fresh-final | 1 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewFreshness.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-fresh-final.log](/private/tmp/orca-progress-results-20261010/task2-fresh-final.log) |
| task2-fresh-final2 | 0 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewFreshness.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-fresh-final2.log](/private/tmp/orca-progress-results-20261010/task2-fresh-final2.log) |
| task2-green1 | 0 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewApp.test.tsx", "tests/overviewFreshness.test.tsx", "tests/shell.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-green1.log](/private/tmp/orca-progress-results-20261010/task2-green1.log) |
| task2-green2 | 0 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewApp.test.tsx", "tests/overviewFreshness.test.tsx", "tests/overviewModel.test.ts", "tests/shell.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-green2.log](/private/tmp/orca-progress-results-20261010/task2-green2.log) |
| task2-green3 | 1 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewFreshness.test.tsx", "tests/projectScopeDecisionRequests.test.tsx", "tests/projectFiltering.test.tsx", "tests/i18nPseudo.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-green3.log](/private/tmp/orca-progress-results-20261010/task2-green3.log) |
| task2-green4 | 1 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/projectFiltering.test.tsx", "tests/i18nPseudo.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-green4.log](/private/tmp/orca-progress-results-20261010/task2-green4.log) |
| task2-i18n-final | 1 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/decisionsI18n.test.tsx", "tests/overviewApp.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-i18n-final.log](/private/tmp/orca-progress-results-20261010/task2-i18n-final.log) |
| task2-i18n-green | 0 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/decisionsI18n.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-i18n-green.log](/private/tmp/orca-progress-results-20261010/task2-i18n-green.log) |
| task2-model-first | 1 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewModel.test.ts", "--maxWorkers=2", "--no-cache"]` | [task2-model-first.log](/private/tmp/orca-progress-results-20261010/task2-model-first.log) |
| task2-mutations-corrected | 0 | `["python3", "/private/tmp/orca-progress-results-20261010/task2-mutations-corrected.py"]` | [task2-mutations-corrected.log](/private/tmp/orca-progress-results-20261010/task2-mutations-corrected.log) |
| task2-mutations | 1 | `["python3", "/private/tmp/orca-progress-results-20261010/task2-mutations.py"]` | [task2-mutations.log](/private/tmp/orca-progress-results-20261010/task2-mutations.log) |
| task2-owner-red | 1 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewApp.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-owner-red.log](/private/tmp/orca-progress-results-20261010/task2-owner-red.log) |
| task2-red-app-real | 1 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewApp.test.tsx", "tests/shell.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-red-app-real.log](/private/tmp/orca-progress-results-20261010/task2-red-app-real.log) |
| task2-red-app | 0 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewApp.test.tsx", "tests/shell.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-red-app.log](/private/tmp/orca-progress-results-20261010/task2-red-app.log) |
| task2-red-freshness | 1 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewFreshness.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-red-freshness.log](/private/tmp/orca-progress-results-20261010/task2-red-freshness.log) |
| task2-regressions | 1 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/projectFiltering.test.tsx", "tests/projectScopeDrafts.test.tsx", "tests/projectScopeDecisionRequests.test.tsx", "tests/projectScopeRecovery.test.tsx", "tests/controlCommandRecovery.test.tsx", "tests/controlPollSettles.test.tsx", "tests/controlRefetch.test.tsx", "tests/confirmSelection.test.tsx", "tests/requirementsApp.test.tsx", "tests/appSelection.test.tsx", "tests/i18nKeys.test.ts", "tests/i18nPseudo.test.tsx", "tests/i18nSwitch.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-regressions.log](/private/tmp/orca-progress-results-20261010/task2-regressions.log) |
| task2-restored-corrected-green | 0 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewApp.test.tsx", "tests/overviewFreshness.test.tsx", "tests/overviewModel.test.ts", "tests/shell.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-restored-corrected-green.log](/private/tmp/orca-progress-results-20261010/task2-restored-corrected-green.log) |
| task2-restored-green | 0 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewApp.test.tsx", "tests/overviewFreshness.test.tsx", "tests/overviewModel.test.ts", "tests/shell.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-restored-green.log](/private/tmp/orca-progress-results-20261010/task2-restored-green.log) |
| task2-root-build | 0 | `["npm", "run", "build"]` | [task2-root-build.log](/private/tmp/orca-progress-results-20261010/task2-root-build.log) |
| task2-self-review-criteria | 0 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewApp.test.tsx", "tests/overviewModel.test.ts", "--maxWorkers=2", "--no-cache"]` | [task2-self-review-criteria.log](/private/tmp/orca-progress-results-20261010/task2-self-review-criteria.log) |
| task2-self-review-mutations | 0 | `["python3", "/private/tmp/orca-progress-results-20261010/task2-self-review-mutations.py"]` | [task2-self-review-mutations.log](/private/tmp/orca-progress-results-20261010/task2-self-review-mutations.log) |
| task2-self-review-restored-green | 0 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewApp.test.tsx", "tests/overviewFreshness.test.tsx", "tests/overviewModel.test.ts", "tests/shell.test.tsx", "--maxWorkers=2", "--no-cache"]` | [task2-self-review-restored-green.log](/private/tmp/orca-progress-results-20261010/task2-self-review-restored-green.log) |
| task2-self-review-web | 0 | `["npm", "run", "--workspace", "web", "check", "--", "--maxWorkers=2", "--no-cache"]` | [task2-self-review-web.log](/private/tmp/orca-progress-results-20261010/task2-self-review-web.log) |
| task2-source-commit | 0 | `["git", "commit", "-m", "feat(web): add progress-first overview and owner navigation"]` | [task2-source-commit.log](/private/tmp/orca-progress-results-20261010/task2-source-commit.log) |
| task2-test-commit | 0 | `["git", "commit", "-m", "test(web): strengthen overview owner and filter criteria"]` | [task2-test-commit.log](/private/tmp/orca-progress-results-20261010/task2-test-commit.log) |
| task2-type-final | 0 | `["npm", "exec", "--workspace", "web", "--", "tsc", "--noEmit", "-p", "tsconfig.json"]` | [task2-type-final.log](/private/tmp/orca-progress-results-20261010/task2-type-final.log) |
| task2-type1 | 2 | `["npm", "exec", "--workspace", "web", "--", "tsc", "--noEmit", "-p", "tsconfig.json"]` | [task2-type1.log](/private/tmp/orca-progress-results-20261010/task2-type1.log) |
| task2-type2 | 0 | `["npm", "exec", "--workspace", "web", "--", "tsc", "--noEmit", "-p", "tsconfig.json"]` | [task2-type2.log](/private/tmp/orca-progress-results-20261010/task2-type2.log) |
| task2-type3 | 0 | `["npm", "exec", "--workspace", "web", "--", "tsc", "--noEmit", "-p", "tsconfig.json"]` | [task2-type3.log](/private/tmp/orca-progress-results-20261010/task2-type3.log) |
| task2-web-build | 0 | `["npm", "run", "--workspace", "web", "build"]` | [task2-web-build.log](/private/tmp/orca-progress-results-20261010/task2-web-build.log) |
| task2-web-frozen | 0 | `["npm", "run", "--workspace", "web", "check", "--", "--maxWorkers=2", "--no-cache"]` | [task2-web-frozen.log](/private/tmp/orca-progress-results-20261010/task2-web-frozen.log) |
| task2-web-full-final | 0 | `["npm", "run", "--workspace", "web", "check", "--", "--maxWorkers=2", "--no-cache"]` | [task2-web-full-final.log](/private/tmp/orca-progress-results-20261010/task2-web-full-final.log) |
| task2-web-full | 1 | `["npm", "run", "--workspace", "web", "check", "--", "--maxWorkers=2", "--no-cache"]` | [task2-web-full.log](/private/tmp/orca-progress-results-20261010/task2-web-full.log) |

Final full Web check includes project scope, detail drafts, request ownership, recovery/uncertainty, confirmation/selection hashes, recognized/default hashes, source availability, bilingual/pseudo-locale and all existing regressions. It reports no skipped tests and no unexpected warnings. Build warnings: Vite reports a chunk larger than 500 kB (609.49 kB observed in task2-web-build); Git commits report automatic committer identity under owned HOME. Neither warning was suppressed nor global configuration changed. Vitest's worker reuse suggestion is native informational output, not acceptance of another worker configuration.

## Clone fault matrix and exact restoration

First proof snapshot is implementation SHA; the two self-review proofs use final source/test SHA. Production bytes are identical at both SHAs (all web/src files compared with git show and current disk). Original and corrected setup-failed fault logs remain distinct. All effective rows below are RC1 at the intended business criterion, not transform/ReferenceError/TypeError setup errors. Every row has exact source restoration, working diff bytes 0 and cached diff bytes 0; clones were made with --local --no-hardlinks and were not deleted. Full patches, commands, CWDs, SHAs and native logs remain in the controller-owned temporary root.

| Semantic fault | Intended criterion | Observed SHA | RC / working / cached | Raw log |
|---|---|---|---|---|
| todo-refresh | shows independent todo changes | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-todo-refresh.log) |
| inactive-timers | stops inactive reads | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-inactive-timers.log) |
| todo-arrival | latest successful refresh wins | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-todo-arrival.log) |
| projection-arrival | drops late progress replies | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-projection-arrival.log) |
| recovery-arrival | drops late recovery replies | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-recovery-arrival.log) |
| metrics-independent | metrics failure leaves healthy | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-metrics-independent.log) |
| live-owner-get | All queue navigation reads the live owner | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-live-owner-get.log) |
| navigation-arrival | older owner response cannot reopen | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-navigation-arrival.log) |
| owner-monotonic | owner read older than the live projection | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-owner-monotonic.log) |
| requested-task | disappeared requested task | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-requested-task.log) |
| requested-run | disappeared requested run | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-requested-run.log) |
| requirement-owner-get | opens exact requirement owner | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-requirement-owner-get.log) |
| arrival-focus | All queue navigation reads the live owner | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-arrival-focus.log) |
| decision-composite | preserves same-name decisions | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-decision-composite.log) |
| decision-scope | preserves same-name decisions | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-decision-scope.log) |
| unknown-ownership | retains unknown imports | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-unknown-ownership.log) |
| archived-progress | does not manufacture queue work | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-archived-progress.log) |
| recovery-identity | deduplicates exactly the same cross-source | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-recovery-identity.log) |
| owner-required-or | deduplicates exactly the same cross-source | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-owner-required-or.log) |
| global-blockers | retains unknown imports | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-global-blockers.log) |
| exceptions-first | retains authoritative exceptions before preparation | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-exceptions-first.log) |
| known-empty | unavailable, stale and loading sources | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-known-empty.log) |
| retained-stale | failed todo refresh retains explicitly stale rows | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-retained-stale.log) |
| default-overview | round-trips every section | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-default-overview.log) |
| unavailable-badge | initial todo failure exposes unavailable | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-unavailable-badge.log) |
| unavailable-count | initial todo failure exposes unavailable | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-unavailable-count.log) |
| projection-monotonic-corrected | lower overview changeSeq | `9d17d4cb4d74224bc17c383a2cfcfe6cff5d7166` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-projection-monotonic-corrected.log) |
| ordinary-filter-contamination | same-name decision queue entries | `b15a1dc2fbcf43a8ff814f5c1ddc97d1631a428a` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-ordinary-filter-contamination.log) |
| task-owner-focus | task/run attention destination opens the requested task | `b15a1dc2fbcf43a8ff814f5c1ddc97d1631a428a` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-mutant-task-owner-focus.log) |

Final restored clone check: 4 files / 42 tests green, task2-self-review-restored-green RC0. Earlier restored implementation clone checks: 40/40 green twice. No feature-tree fault was ever applied. The runner asserts full clone HEAD and byte restoration, not handwritten short SHA or visual git status. Native source agreement checks found owned working diff bytes 0 and cached diff bytes 0; the controller's unrelated audit document remains dirty and node_modules remains untracked.

## Full output audit and self-review

All raw native logs were read in full by the audit program; it retains byte length and SHA256, every FAIL header, setup-error classification, native summaries and warnings in task2-final-raw-output-audit.json. Fault audits additionally reject transform/ReferenceError/TypeError results for effective business proofs. The native failure logs and diagnostic DOM dumps are preserved rather than truncated/overwritten or re-labelled as successful runs. The filtered audit metadata is a separate index; raw validation output was never filtered away. Mutation/source binding is in task2-final-effective-mutations.json and task2-final-source-agreement.json.

Self-review found and fixed live projection freshness on owner navigation, unknown Decisions counts, metrics-dependent full-list refresh, transient helper readiness, status ownership in i18n, archived fixture aliasing, and missing positive filter/task/recovery-owner coverage. Production source is still the single 9d17d4c snapshot. The App remains an inherited large coordinator; this task added its owned source/navigation responsibility without restructuring unrelated command/draft systems. Pure view/model responsibility remains limited to the task brief.

Concern/remaining integration boundary: desktop/390px/short-height real HTTP geometry is the controller's final gate; no jsdom/prototype visual-acceptance claim is made. Actual Results detail hierarchy/settings and final broad root/panel/pin/temporary-root gates belong to downstream/controller work. Existing low-level auxiliary recovery/uncertainty lifecycle warnings remain out of scope; no unrelated backend/metadata lifecycle change was attempted. No known Task2 functional failure remains.

## Changed paths

- `web/src/App.tsx`
- `web/src/ControlGroupView.tsx`
- `web/src/ControlPanel.tsx`
- `web/src/DecisionsView.tsx`
- `web/src/Overview.tsx`
- `web/src/RequirementsPanel.tsx`
- `web/src/Shell.tsx`
- `web/src/locales/en.ts`
- `web/src/locales/zh.ts`
- `web/src/overviewApi.ts`
- `web/src/overviewModel.ts`
- `web/src/overviewNavigation.ts`
- `web/src/sections.ts`
- `web/src/styles.css`
- `web/tests/decisionsI18n.test.tsx`
- `web/tests/i18nPseudo.test.tsx`
- `web/tests/overviewApp.test.tsx`
- `web/tests/overviewFreshness.test.tsx`
- `web/tests/overviewModel.test.ts`
- `web/tests/projectFiltering.test.tsx`
- `web/tests/projectScopeDecisionRequests.test.tsx`
- `web/tests/shell.test.tsx`

## Report packaging note (append-only, same implementer/run)

The report directory is ignored by repository rules. The first exact-path add was refused, so task2-report-commit RC1 committed nothing; its raw log remains. The report is now staged with force for this exact authorized report path only. No ignored node_modules or controller audit path is included.

## Fix round 1 — independent review I1/I2/I3 (append-only)

Owner: `/root/progress_task2`, 2026-10-10. Fix base `60b3500a9187c7373a913cd512449344474d147a`; source/test commit `472a0f483d9d369fb5f695f6184668fcdcd05d44` (`fix(web): bind overview decision reads to current navigation`). CWD: `/Users/biran/.codex/worktrees/progress-results-20261010/Orca`. This named append supersedes the original report's claim that no functional failure remained: independent review reproduced three acceptance-blocking decision-navigation defects that the original tests did not cover. Original report/history remain byte-for-byte unchanged.

### Findings and final behavior

I1 was a real cached-repeat bug: setting the identical retained todo row did not trigger the ordinary selection effect. Overview now creates an explicit read record and makes one fresh exact composite-owner GET on every click, including during a pending todo refresh. The ordinary selected-row reader is suppressed while that explicit record owns the actual selection/context. Ordinary Decisions navigation clears explicit ownership and retains its existing read, draft, command/refusal and request-result ownership behavior. Context/selection changes cancel the explicit intent instead of converting it into an automatic read of the old owner.

I2 was a real focus race: a new navigation could consume focus on A's shared wrapper while B was loading. Accepted decision state now carries composite owner, navigation request and actual auth/scope/epoch source identity. Rendering binds the body to that accepted owner/request/context. Focus is published only after the current owner GET succeeds; the focus consumer checks the accepted request/composite owner and active Decisions pane before marking the request focused. A → Overview → delayed B now focuses B after its own body arrives. Same-owner repeat revalidates instead of using cached detail.

I3 was a real error-routing bug: removed decision GETs used ordinary setError and replaced the shell, and a late refusal could arrive after newer section navigation. Both success and refusal callbacks now reject obsolete navigation/context. A current Overview-owned read failure follows local unavailable plus registry/Overview/todo reread; it clears that failed selection while retaining shell/navigation. A late 404 cannot clear newer accepted B or replace Metrics/Overview. No repeated GET or POST workaround was introduced.

Controller approved the explicit unknown-owner option: in a concrete project an unmapped/different decision project or group repository stays honestly unavailable, keeps the current project and rereads registry/sources; it never guesses or borrows the previous context. All may inspect the exact live group owner and keeps All. Actual group and decision unknown-owner cases now demonstrate those policies, including GET counts, current project/section and zero POST.

Only App and two regression files changed in this fix. No backend/schema/settings/detail hierarchy/default pin/runtime/service/production-data change. No paid provider or subagents. Existing command payloads, integer budgets, frozen selections, role guards, source timers, drafts and decision request results remain intact. Controller audit/node_modules were not staged.

### Reviewer criteria, RED and GREEN

Reviewer-owned criteria were transferred into `web/tests/overviewDecisionNavigation.test.tsx` with only local imports/environment adapted; their assertions were not weakened:

- “reopened decision always does a live owner GET while overview todo refresh is pending” — expected two owner GETs, observed one before the fix.
- “switching overview decision retains requested focus after the new detail arrives” — B rendered, but active decision focus was null before the fix.
- “removed decision owner leaves overview available with navigation failure” — before the fix the shell was replaced by decision-not-found ErrorPage.

`task2-fix1-red` RC1 observed those three exact business failures, plus a late refused read replacing the shell after newer section navigation and concrete unknown group context wrongly opening instead of staying unavailable. Five intended failures / eighteen passing. Complete DTO fixtures collected normally; no transform/ReferenceError/schema setup failure. The late-refusal-after-newer-accepted-owner and All unknown-owner controls already passed and were retained as regressions, not falsely claimed as new RED.

Further covering criteria exercise a successful response after newer navigation, pending owner response across auth/scope/epoch changes, ordinary Decisions return after accepted Overview selection, unknown concrete decision project with registry reread, and All exact owner GET/focus. Existing overview/freshness/model, appSelection, projectFiltering, projectScopeDecisionRequests and decisionsI18n assertions all remain unchanged and green.

Focused stable GREEN: eight files / 107 tests, RC0. Frozen full Web: **96 files / 802 tests passed**, native tsc plus Vitest, RC0, no skipped tests or unexpected test warnings. Root and Web builds RC0; retained Vite chunk warning (610.14 kB measured in this fix). One full Web run was performed after the fix froze. No broad gate was repeated after success.

### Exact native commands and raw evidence

All main commands have CWD `/Users/biran/.codex/worktrees/progress-results-20261010/Orca` and run through the existing controller-owned run.py under its fake owned environment. Native argv was saved before execution, full stdout/stderr remains in .log, RC in .rc. Clone .command.json/.cwd also captures exact clone CWD and automatically observed full HEAD before each run. Environment contents were not printed or changed.

| Run | RC | Exact native argv | Full raw output |
|---|---:|---|---|
| task2-fix1-extra-mutations | 0 | `["python3", "/private/tmp/orca-progress-results-20261010/task2-fix1-extra-mutations.py"]` | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-extra-mutations.log) |
| task2-fix1-extra-restored-green | 0 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewDecisionNavigation.test.tsx", "tests/overviewApp.test.tsx", "tests/overviewFreshness.test.tsx", "tests/overviewModel.test.ts", "tests/appSelection.test.tsx", "tests/projectFiltering.test.tsx", "tests/projectScopeDecisionRequests.test.tsx", "tests/decisionsI18n.test.tsx", "--maxWorkers=2", "--no-cache"]` | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-extra-restored-green.log) |
| task2-fix1-focused-final | 0 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewDecisionNavigation.test.tsx", "tests/overviewApp.test.tsx", "tests/overviewFreshness.test.tsx", "tests/overviewModel.test.ts", "tests/appSelection.test.tsx", "tests/projectFiltering.test.tsx", "tests/projectScopeDecisionRequests.test.tsx", "tests/decisionsI18n.test.tsx", "--maxWorkers=2", "--no-cache"]` | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-focused-final.log) |
| task2-fix1-green | 0 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewDecisionNavigation.test.tsx", "tests/overviewApp.test.tsx", "tests/overviewFreshness.test.tsx", "tests/overviewModel.test.ts", "tests/appSelection.test.tsx", "tests/projectFiltering.test.tsx", "tests/projectScopeDecisionRequests.test.tsx", "tests/decisionsI18n.test.tsx", "--maxWorkers=2", "--no-cache"]` | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-green.log) |
| task2-fix1-mutations | 0 | `["python3", "/private/tmp/orca-progress-results-20261010/task2-fix1-mutations.py"]` | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-mutations.log) |
| task2-fix1-red | 1 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewDecisionNavigation.test.tsx", "tests/overviewApp.test.tsx", "--maxWorkers=2", "--no-cache"]` | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-red.log) |
| task2-fix1-restored-green | 0 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewDecisionNavigation.test.tsx", "tests/overviewApp.test.tsx", "tests/overviewFreshness.test.tsx", "tests/overviewModel.test.ts", "tests/appSelection.test.tsx", "tests/projectFiltering.test.tsx", "tests/projectScopeDecisionRequests.test.tsx", "tests/decisionsI18n.test.tsx", "--maxWorkers=2", "--no-cache"]` | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-restored-green.log) |
| task2-fix1-root-build | 0 | `["npm", "run", "build"]` | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-root-build.log) |
| task2-fix1-source-commit | 0 | `["git", "commit", "-m", "fix(web): bind overview decision reads to current navigation"]` | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-source-commit.log) |
| task2-fix1-stable | 0 | `["npm", "exec", "--workspace", "web", "--", "vitest", "run", "tests/overviewDecisionNavigation.test.tsx", "tests/overviewApp.test.tsx", "tests/overviewFreshness.test.tsx", "tests/overviewModel.test.ts", "tests/appSelection.test.tsx", "tests/projectFiltering.test.tsx", "tests/projectScopeDecisionRequests.test.tsx", "tests/decisionsI18n.test.tsx", "--maxWorkers=2", "--no-cache"]` | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-stable.log) |
| task2-fix1-type-final | 0 | `["npm", "exec", "--workspace", "web", "--", "tsc", "--noEmit", "-p", "tsconfig.json"]` | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-type-final.log) |
| task2-fix1-type | 0 | `["npm", "exec", "--workspace", "web", "--", "tsc", "--noEmit", "-p", "tsconfig.json"]` | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-type.log) |
| task2-fix1-web-build | 0 | `["npm", "run", "--workspace", "web", "build"]` | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-web-build.log) |
| task2-fix1-web-full | 0 | `["npm", "run", "--workspace", "web", "check", "--", "--maxWorkers=2", "--no-cache"]` | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-web-full.log) |

### Clone proofs and restoration

All mutations were independent --local --no-hardlinks committed clones. Current full SHA was read automatically and asserted before mutation and after exact restoration. No feature-tree fault was applied. Each effective fault below is RC1 at the intended business assertion; all restored working/cached diff bytes are 0. No transform/ReferenceError/TypeError setup failures occurred in these fix proof runs. No failed setup log was discarded or counted as business evidence.

| Fault | Intended assertion | Observed full SHA | RC / working / cached | Raw output |
|---|---|---|---|---|
| fix1-cached-repeat | reopened decision always does a live owner GET | `472a0f483d9d369fb5f695f6184668fcdcd05d44` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-mutant-fix1-cached-repeat.log) |
| fix1-success-arrival | older successful Overview decision read cannot reopen | `472a0f483d9d369fb5f695f6184668fcdcd05d44` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-mutant-fix1-success-arrival.log) |
| fix1-refusal-arrival | late refused Overview decision read cannot replace a newer accepted decision owner | `472a0f483d9d369fb5f695f6184668fcdcd05d44` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-mutant-fix1-refusal-arrival.log) |
| fix1-local-unavailable | removed decision owner leaves overview available | `472a0f483d9d369fb5f695f6184668fcdcd05d44` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-mutant-fix1-local-unavailable.log) |
| fix1-focus-request | switching overview decision retains requested focus | `472a0f483d9d369fb5f695f6184668fcdcd05d44` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-mutant-fix1-focus-request.log) |
| fix1-reader-context | Overview decision owner response is ignored after auth changes | `472a0f483d9d369fb5f695f6184668fcdcd05d44` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-mutant-fix1-reader-context.log) |
| fix1-composite-acceptance | same-name decision queue entries open their exact composite owner | `472a0f483d9d369fb5f695f6184668fcdcd05d44` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-mutant-fix1-composite-acceptance.log) |
| fix1-ordinary-return | ordinary Decisions selection remains independently readable | `472a0f483d9d369fb5f695f6184668fcdcd05d44` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-mutant-fix1-ordinary-return.log) |
| fix1-registry-reread | unknown decision project in concrete scope rereads registry | `472a0f483d9d369fb5f695f6184668fcdcd05d44` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-mutant-fix1-registry-reread.log) |
| fix1-concrete-group | concrete project keeps an unknown registry owner visibly unavailable | `472a0f483d9d369fb5f695f6184668fcdcd05d44` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-mutant-fix1-concrete-group.log) |
| fix1-concrete-decision | unknown decision project in concrete scope rereads registry | `472a0f483d9d369fb5f695f6184668fcdcd05d44` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-mutant-fix1-concrete-decision.log) |
| fix1-duplicate-reader | reopened decision always does a live owner GET | `472a0f483d9d369fb5f695f6184668fcdcd05d44` | 1 / 0 / 0 | [raw](/private/tmp/orca-progress-results-20261010/task2-fix1-mutant-fix1-duplicate-reader.log) |

Both restored clone checks re-ran the eight covering files and passed 107/107, RC0. Final source agreement asserts the three changed source/test files match committed `472a0f483d9d369fb5f695f6184668fcdcd05d44` and owned working/cached diffs are zero. Clones retained; no branch/worktree deletion, main merge or push. Native commit output's automatic identity notice was retained; global Git config was not changed.

### Full output audit, source binding and self-review

Complete fix native logs were read in full by the audit program, preserving byte length/SHA256, all failure headers, all native summaries, setup-error classifications and warnings in `/private/tmp/orca-progress-results-20261010/task2-fix1-full-output-audit.json`. Raw logs remain separate and unfiltered. Proof metadata is `/private/tmp/orca-progress-results-20261010/task2-fix1-effective-mutations.json`; final disk/commit byte agreement is `/private/tmp/orca-progress-results-20261010/task2-fix1-source-agreement.json`. These indexes do not substitute for native raw evidence. No private env dump.

Self-review confirmed one fresh GET per Overview click, no duplicate ordinary-reader GET, accepted composite ownership before display/focus, current-navigation success and refusal guards, context cancellation, local recovery without losing shell, exact All owner inspection, concrete unknown-owner unavailable/reread and unchanged ordinary correction/draft/request ownership. No new test expectation waiver or existing assertion weakening. The code remains App-owned and the pure Overview interface is unchanged.

Concerns/boundary: real desktop/390px/short-height geometry and final broad integration remain controller gates, as the reviewer marked cannot-verify. No jsdom visual acceptance claim. The native Web build still warns about bundle size. No known I1/I2/I3 functional failure remains after this fix; the scoped independent re-review is the controller's next step.
