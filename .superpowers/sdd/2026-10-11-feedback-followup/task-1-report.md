# Task 1: Results5 continuation report

Owner `/root/results5_impl`, 2026-10-11 Asia/Shanghai. Product commit `71d19b5be49762752492bc93d8c80c26d2ec835b` (`feat(web): finish saved task and group results`); test-only closing commit `554d77e4a2883511922c07a108320ce2115578db` (`test(web): pin independent saved-result attempt authority`). Ready for independent spec/quality review. Controller owns final root gates and real-browser geometry; this report does not claim those are complete.

## Transfer and source identity

Read global constraints, continuation brief/preflight, original Task5 brief, effective Results spec §8–8.6, CLAUDE, RTK, TDD and verification skills. Started from `996516279e1f5e169d196cd1ddb032b9ba6f5280`. Applied only `/private/tmp/orca-results5-wip-20261011.patch` and copied the ten explicitly inventoried untracked Web files. Initial copied-file equality was true. Patch SHA256 `3e29c3be50cccb5a2710d2918859d99908013cedd644b7da3f3353da51076f79`. Original worktree HEAD remains `10ed031a14ed452f6fa1cf2dfca0f984e2d49a5b`; its eight-file tracked diff still byte-equals that approved patch. Never edited the original worktree, copied old ledgers/specs/node_modules, or staged shared controller artifacts. Parent documentation commit `10b02df9de6f25cb97579ecd99eb6e07c41009d9` advanced the shared HEAD between my two commits; it is not my work.

Final owned-file manifest `/private/tmp/orca-result5-final-source.json` records all 22 file hashes, main/clone identity, byte equality, own unstaged diff 0 and cached diff 0. Owned manifest SHA256: `a926998b75c3cfebe797c1289e2435fe096b106784d6afa72b213bc46701fa22`. Main final source `554d77e4a2883511922c07a108320ce2115578db`; mutation clone final source `69ca22b09db7c97ffe3335c2606a55bc4dfd646d`; byte equality across all owned files true. Final Web/type/restored-focus runner tree SHA256 `f3dbba749389ec93ced1e1203f0e39457cbc6f4bdcd43793e5ffabe36ad14577`. The runner metadata preserves HEAD plus exact source-tree hashes; earlier records predate the runner hash enhancement and preserve their HEAD/WIP context instead.

## Behavior and authority

- Completed group Results defaults remain, including missing/invalid explanation. Task results use the separate run endpoint after opening the task in Progress and choosing Results. Acceptance/outcome, actual controller verification, Agent explanation, source availability, group coverage/review and Git delivery stay independent.
- Current missing/unknown attempts never borrow earlier prose. Source ordinal growth without capture revision growth remains current. Lower late capture/attempt answers retain the newer admitted value with a stale-response refusal. Retry/continuation predecessors remain explicit saved history and do not establish the new run's current result.
- Task admission checks scope/epoch/changeSeq/task/group/run plus core generation and internally consistent nested run identity. Group admission also checks nested run changeSeq and known core generation. Both enforce monotonic capture, stable execution identity and nondecreasing known current attempt within the polling owner. Core RunView exposes no executionId; compare it with the prior admitted result, and do not invent a core execution authority or change the legacy DTO.
- Active-only polling and AbortSignals retire held run, group and output reads across hide/project/account/epoch/current-run change. Real App tests preserve local unsent labels input and focus, open/close task ownership, and cover AuthGate logout. Every result GET is read-only; fixture POST collections remain zero outside the deliberately tested auth logout.
- Output preview and download subscribe directly to login-required notifications. Revocation synchronously aborts and retires a held blob before parent rerender. Preview refusal removes formerly admitted content. Preview validates its exact run/group/attempt/output/path and nullable download URL; a non-null URL must equal the encoded owned route. The download consumes that admitted URL and exact Response blob. Existing evidence downloads and their server permission boundary are unchanged.
- HTML/scripts/URLs/links/images remain inert React text nodes. Authorized binary or too-large saved previews retain downloads; unsafe/refused/null-download variants remain explicit. No blanket rule converts binary/large/unsupported output to false missing. Attachment name remains outputId, matching the existing server Content-Disposition; this is documented rather than silently renamed to a filesystem path.
- Existing English/Chinese placeholder/key parity includes Results. Actual outcome uses the existing progressStep catalog and Git delivery state uses the existing integration catalog. Added real-Chinese and pseudo-locale Results coverage; no fabricated pass or acceptance.
- README/operator skill explain navigation, immutable execution bytes/snapshot versus later verification observations, independent source states, and installed pin `ab824d1` versus paired producer publication/repin/service boundary. No new summarizer, backfill, export pipeline, dependency, skin, provider invocation, production migration or service change.

## RED, corrections and GREEN

Historical transferred evidence remains in `/private/tmp/orca-progress-results-20261010/result5-*`, source HEAD `10ed031` plus its recorded WIP. Historical `result5-tdd-red` RC1 demonstrates absent result surfaces; its original late-owner criterion already passed, so it is not credited as that branch's RED. Historical `result5-tdd-red-outputs` RC1: 17 failed because group/preview/roving-tab surfaces were absent; its full raw log was read here. Historical `result5-focused-green` RC1: 12 failed/31 passed from ambiguous current/history controls/text; preserved and read, never treated as acceptance. Historical `result5-focused-green2` RC0: five files/47 tests, source JSON reports 17203 working-diff bytes plus the ten inventoried files. Historical GREEN is provenance, not a fresh gate. Original verbose task RED remains preserved; no claim of a new complete audit of that historical verbose DOM dump.

New functional `result5-continuation-red2` RC1: five intended failures/25 passed before the fixes: synchronous auth abort, refusal clearing previous preview, refusal of foreign download URL, foreign generation/execution identity, lower capture replacing/removing latest saved results. Initial `result5-continuation-red` also failed one new fixture query (`Tasks` versus the actual `Task control` link); the verbose raw file is retained. No product fix was made for that typo. All named functional RED assertions in red2 were inspected from its complete raw log.

`result5-continuation-green1` still failed a new test's unscoped history query despite the current-result assertion passing; narrowed that new assertion to the current region. `green2` exposed jsdom's asynchronous hash navigation in the held-hide test; the fixture now advances a controlled 1ms navigation tick before checking cancellation. `green3` passed all six focused files/72 tests. These are fixture corrections, not old expectation waivers.

Pseudo locale RED initially also found fixture collisions (IDs/prose containing translated dictionary substrings). Those fixture values were replaced by neutral data. `result5-locale-red2` then failed solely on untranslated actual `succeeded`, followed by a localized GREEN. Group Chinese RED caught that same raw outcome; the new delivery assertion was corrected to the existing catalog's actual Chinese `有冲突`, and its local-delivery fixture dropped an invalid `remote` property. Early typechecks exposed only new test implicit-this and invalid `exact` options, then the corrected typed fixtures passed.

First complete Web run `result5-full-web` RC1: **labelSourceFallback.test.tsx** failed both existing names `in en, shows a source this panel has no words for as sent and one it knows in words` and its zh counterpart. Its first paragraph query was selecting the newly prepended hidden TaskResults status. Moved TaskResults after the original labels paragraph, retaining it before bulky activity/evidence. Did not rewrite either old assertion. The failure log is preserved. Subsequent complete runs passed; the final added predecessor and ordinal rollback checks received their own deletion RED and restored GREEN.

Closing evidence: final whole Web `result5-attempt-authority-full` **104 files/894 tests RC0, no skips**; final typecheck RC0; restored clone focused eight files/109 tests RC0, no skips. Of those, the required original five + real App comprise six files/76 criteria. Build `result5-build-freeze` RC0 on unchanged product bytes; later changes are tests only. Normal Vite chunk-size warning is retained in the raw build log. No root or producer suites were duplicated: product/test edits are Web-only, server producer/read models are accepted predecessors, and controller owns final broad root/pair/formal gates.

The two baseline 15-second timeouts were not observed in my whole-Web runs and are not declared permanently closed. Task2 still owns their harness diagnosis (`web-timeout-diagnosis.md`, baseline log `/private/tmp/orca-followup-runs/baseline-web/output.log`):

1. `App re-reads a group's agent preview when the one on screen can no longer be confirmed (wave 3 I-3) > re-reads a preview whose slot was unavailable five times on the backoff, then waits for the operator's Re-read`.
2. Same suite > `retries a preview read that did not conclude five times on the backoff, reports the failure once, and then waits for the operator's Re-read`.

`agentPreviewRefresh.test.tsx` is untouched by Task1. No timeout increase, skipped test, broadened assertion or waiver was introduced.

## Clone mutations

Only `/private/tmp/orca-result5-mutations-20261011`, created by raw git `clone --local --no-hardlinks`, was mutated. Native commands/RC/source and exact deleted clauses are in `/private/tmp/orca-result5-mutation-results.json`; raw logs are each `/private/tmp/orca-followup-runs/result5-mutant-<name>/output.log`. All 14 produced their intended failing criterion (RC1), and after each restore raw `git diff` and `git diff --cached` were **0 bytes**. Targeted `-t` runs intentionally exclude the other named tests, with skip counts preserved in raw logs; none is represented as a whole-suite GREEN.

| Deleted/replaced protection | Intended observed failure |
| --- | --- |
| `stale-attempt-reuse` | Missing current attempt displayed previous Saved work. |
| `hidden-fetch` | Real hidden App continued Results GETs across multiple controlled intervals. |
| `html-inertness` | Script markup stopped being literal text. |
| `auth-late-download` | Held blob signal was not synchronously aborted. |
| `source-availability` | Unsupported source falsely became missing. |
| `capture-monotonic` | Capture 7 replaced capture 8 newest work. |
| `execution-owner` | Changed execution ID lost its stale-response refusal. |
| `generation-owner` | Foreign generation lost its core-authority refusal. |
| `download-url-owner` | Foreign URL gained a download capability. |
| `preview-refusal-clear` | Previous bytes survived preview refusal. |
| `group-projection-owner` | Nested old changeSeq lost its refusal. |
| `outcome-localization` | Pseudo-locale retained raw succeeded. |
| `predecessor-owner` | Old run incorrectly gained a Current result region. |
| `current-attempt-authority` | Same-index stale attempt 1 replaced independently known attempt 2. |

Post-restoration eight-file focused GREEN (`result5-attempt-authority-restored`) includes real App and exact saved download witness. Final clone and main match across all 22 owned files. No mutation touched the destination or original Results5 worktree.

## Native evidence inventory

Every run used `/private/tmp/orca-followup-run.py <repo> <unique-name> <argv...>` through `rtk proxy`. Runner isolated HOME, XDG_CONFIG/CACHE/DATA/STATE_HOME, TMPDIR and CCMEM_DATA_ROOT; CCMEM_CONFIG_PATH was absent. No paid calls, real global writes, load generation, release/push/repin or service action. `result.json` next to each log stores argv/RC/HEAD/tree hash where available, plus tool-measured elapsed time. No times or token cost are estimated.

- `result5-attempt-authority-full`: RC0; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run --maxWorkers=2 --no-cache`; source `10b02df9de6f`; [raw log](/private/tmp/orca-followup-runs/result5-attempt-authority-full/output.log).
- `result5-attempt-authority-restored`: RC0; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx tests/resultOutput.test.tsx tests/taskResults.test.tsx tests/groupResults.test.tsx tests/detailRegions.test.tsx tests/i18nKeys.test.ts tests/i18nPseudo.test.tsx tests/labelSourceFallback.test.tsx --maxWorkers=2 --no-cache`; source `69ca22b09db7`; [raw log](/private/tmp/orca-followup-runs/result5-attempt-authority-restored/output.log).
- `result5-attempt-authority-type`: RC0; `npm exec --workspace web -- tsc --noEmit -p tsconfig.json`; source `10b02df9de6f`; [raw log](/private/tmp/orca-followup-runs/result5-attempt-authority-type/output.log).
- `result5-build-freeze`: RC0; `npm run build --workspace web`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-build-freeze/output.log).
- `result5-continuation-green1`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx tests/resultOutput.test.tsx tests/taskResults.test.tsx tests/groupResults.test.tsx tests/detailRegions.test.tsx tests/i18nKeys.test.ts --maxWorkers=2 --no-cache`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-continuation-green1/output.log).
- `result5-continuation-green2`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx tests/resultOutput.test.tsx tests/taskResults.test.tsx tests/groupResults.test.tsx tests/detailRegions.test.tsx tests/i18nKeys.test.ts --maxWorkers=2 --no-cache`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-continuation-green2/output.log).
- `result5-continuation-green3`: RC0; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx tests/resultOutput.test.tsx tests/taskResults.test.tsx tests/groupResults.test.tsx tests/detailRegions.test.tsx tests/i18nKeys.test.ts --maxWorkers=2 --no-cache`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-continuation-green3/output.log).
- `result5-continuation-red`: RC1; `npm exec --workspace web -- vitest run tests/resultsApp.test.tsx tests/resultOutput.test.tsx --maxWorkers=2 --no-cache`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-continuation-red/output.log).
- `result5-continuation-red2`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx tests/resultOutput.test.tsx --maxWorkers=2 --no-cache`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-continuation-red2/output.log).
- `result5-focused-final`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx tests/resultOutput.test.tsx tests/taskResults.test.tsx tests/groupResults.test.tsx tests/detailRegions.test.tsx tests/i18nKeys.test.ts tests/i18nPseudo.test.tsx --maxWorkers=2 --no-cache`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-focused-final/output.log).
- `result5-focused-final2`: RC0; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx tests/resultOutput.test.tsx tests/taskResults.test.tsx tests/groupResults.test.tsx tests/detailRegions.test.tsx tests/i18nKeys.test.ts tests/i18nPseudo.test.tsx tests/labelSourceFallback.test.tsx --maxWorkers=2 --no-cache`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-focused-final2/output.log).
- `result5-full-web`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run --maxWorkers=2 --no-cache`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-full-web/output.log).
- `result5-full-web-closure`: RC0; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run --maxWorkers=2 --no-cache`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-full-web-closure/output.log).
- `result5-full-web-final`: RC0; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run --maxWorkers=2 --no-cache`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-full-web-final/output.log).
- `result5-group-locale-red`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/groupResults.test.tsx -t Chinese --maxWorkers=2 --no-cache`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-group-locale-red/output.log).
- `result5-locale-red`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/i18nPseudo.test.tsx -t 'saved results' --maxWorkers=2 --no-cache`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-locale-red/output.log).
- `result5-locale-red2`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/i18nPseudo.test.tsx -t 'saved results' --maxWorkers=2 --no-cache`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-locale-red2/output.log).
- `result5-mutant-auth-late-download`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultOutput.test.tsx -t 'auth revoke aborts' --maxWorkers=2 --no-cache`; source `62e28704a321`; [raw log](/private/tmp/orca-followup-runs/result5-mutant-auth-late-download/output.log).
- `result5-mutant-capture-monotonic`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx -t 'latest saved capture' --maxWorkers=2 --no-cache`; source `62e28704a321`; [raw log](/private/tmp/orca-followup-runs/result5-mutant-capture-monotonic/output.log).
- `result5-mutant-current-attempt-authority`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx -t 'independently newer same-index' --maxWorkers=2 --no-cache`; source `69ca22b09db7`; [raw log](/private/tmp/orca-followup-runs/result5-mutant-current-attempt-authority/output.log).
- `result5-mutant-download-url-owner`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultOutput.test.tsx -t 'foreign download URL' --maxWorkers=2 --no-cache`; source `62e28704a321`; [raw log](/private/tmp/orca-followup-runs/result5-mutant-download-url-owner/output.log).
- `result5-mutant-execution-owner`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx -t 'foreign generation' --maxWorkers=2 --no-cache`; source `62e28704a321`; [raw log](/private/tmp/orca-followup-runs/result5-mutant-execution-owner/output.log).
- `result5-mutant-generation-owner`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx -t 'foreign generation' --maxWorkers=2 --no-cache`; source `62e28704a321`; [raw log](/private/tmp/orca-followup-runs/result5-mutant-generation-owner/output.log).
- `result5-mutant-group-projection-owner`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx -t 'nested stale changeSeq' --maxWorkers=2 --no-cache`; source `62e28704a321`; [raw log](/private/tmp/orca-followup-runs/result5-mutant-group-projection-owner/output.log).
- `result5-mutant-hidden-fetch`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx -t 'mounted local drafts' --maxWorkers=2 --no-cache`; source `62e28704a321`; [raw log](/private/tmp/orca-followup-runs/result5-mutant-hidden-fetch/output.log).
- `result5-mutant-html-inertness`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultOutput.test.tsx -t 'saved HTML/script' --maxWorkers=2 --no-cache`; source `62e28704a321`; [raw log](/private/tmp/orca-followup-runs/result5-mutant-html-inertness/output.log).
- `result5-mutant-outcome-localization`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/i18nPseudo.test.tsx -t 'saved results' --maxWorkers=2 --no-cache`; source `62e28704a321`; [raw log](/private/tmp/orca-followup-runs/result5-mutant-outcome-localization/output.log).
- `result5-mutant-predecessor-owner`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx -t 'predecessor remains' --maxWorkers=2 --no-cache`; source `a5b22a186183`; [raw log](/private/tmp/orca-followup-runs/result5-mutant-predecessor-owner/output.log).
- `result5-mutant-preview-refusal-clear`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultOutput.test.tsx -t 'preview refusal removes' --maxWorkers=2 --no-cache`; source `62e28704a321`; [raw log](/private/tmp/orca-followup-runs/result5-mutant-preview-refusal-clear/output.log).
- `result5-mutant-restored`: RC0; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx tests/resultOutput.test.tsx tests/taskResults.test.tsx tests/groupResults.test.tsx tests/detailRegions.test.tsx tests/i18nKeys.test.ts tests/i18nPseudo.test.tsx tests/labelSourceFallback.test.tsx --maxWorkers=2 --no-cache`; source `62e28704a321`; [raw log](/private/tmp/orca-followup-runs/result5-mutant-restored/output.log).
- `result5-mutant-restored-final`: RC0; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx tests/resultOutput.test.tsx tests/taskResults.test.tsx tests/groupResults.test.tsx tests/detailRegions.test.tsx tests/i18nKeys.test.ts tests/i18nPseudo.test.tsx tests/labelSourceFallback.test.tsx --maxWorkers=2 --no-cache`; source `a5b22a186183`; [raw log](/private/tmp/orca-followup-runs/result5-mutant-restored-final/output.log).
- `result5-mutant-source-availability`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx -t 'source unsupported' --maxWorkers=2 --no-cache`; source `62e28704a321`; [raw log](/private/tmp/orca-followup-runs/result5-mutant-source-availability/output.log).
- `result5-mutant-stale-attempt-reuse`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/taskResults.test.tsx -t 'current missing attempt' --maxWorkers=2 --no-cache`; source `62e28704a321`; [raw log](/private/tmp/orca-followup-runs/result5-mutant-stale-attempt-reuse/output.log).
- `result5-predecessor-green`: RC0; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx --maxWorkers=2 --no-cache`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-predecessor-green/output.log).
- `result5-type-closure`: RC0; `npm exec --workspace web -- tsc --noEmit -p tsconfig.json`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-type-closure/output.log).
- `result5-type-final`: RC2; `npm exec --workspace web -- tsc --noEmit -p tsconfig.json`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-type-final/output.log).
- `result5-type-final2`: RC0; `npm exec --workspace web -- tsc --noEmit -p tsconfig.json`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-type-final2/output.log).
- `result5-type-freeze`: RC0; `npm exec --workspace web -- tsc --noEmit -p tsconfig.json`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-type-freeze/output.log).
- `result5-web-build`: RC0; `npm run build --workspace web`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-web-build/output.log).
- `result5-web-type`: RC2; `npm exec --workspace web -- tsc --noEmit -p tsconfig.json`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-web-type/output.log).
- `result5-web-type-green`: RC0; `npm exec --workspace web -- tsc --noEmit -p tsconfig.json`; source `996516279e1f`; [raw log](/private/tmp/orca-followup-runs/result5-web-type-green/output.log).

## Changed files and self-review

Reviewed full owned tracked diff, new result components/hook/API/renderer and tests; ran own-file diffcheck RC0, verified exact staged list before both commits, used one-command empty `core.hooksPath`, and checked own unstaged/cached diffs were 0 bytes afterwards. Existing command handlers remain unchanged; original evidence permissions are untouched. Core authority and result source/report availability remain separate. No additional product concern found in self-review. Independent spec/quality review and controller browser/root gates remain required, and default producer publication/repin remains a later human release boundary.

- `README.md`
- `skills/orca-control/SKILL.md`
- `web/src/App.tsx`
- `web/src/ControlGroupView.tsx`
- `web/src/ControlPanel.tsx`
- `web/src/GroupDetailRegions.tsx`
- `web/src/TaskDetail.tsx`
- `web/src/controlApi.ts`
- `web/src/locales/en.ts`
- `web/src/locales/zh.ts`
- `web/src/GroupResults.tsx`
- `web/src/ResultOutput.tsx`
- `web/src/SafeMarkdown.tsx`
- `web/src/TaskResults.tsx`
- `web/src/resultApi.ts`
- `web/src/useResultsRead.ts`
- `web/tests/fixtures/results.ts`
- `web/tests/groupResults.test.tsx`
- `web/tests/resultOutput.test.tsx`
- `web/tests/taskResults.test.tsx`
- `web/tests/resultsApp.test.tsx`
- `web/tests/i18nPseudo.test.tsx`


## Fix round 1 — independent nullable-authority finding (2026-10-11)

Owner `/root/results5_impl`; base `554d77e4a2883511922c07a108320ce2115578db`; fix commit `115830d424f87063eb835d1f3f911ba1d3dfb0b2` (`fix(web): retain saved result authority across unknown replies`). This section supersedes the preceding self-review's no-additional-concern assessment for the Important finding in `task-1-review.md`; the earlier report and evidence remain unchanged. Independent scoped re-review remains required.

Read the complete review and functional witness `/private/tmp/orca-followup-runs/results5-review-null-authority-node/output.log` (RC1). Verified the root cause in the actual composition: `useResultsRead` replaces displayed `prior` with the admitted nullable answer, and the previous guard consequently forgets attempt 2 through `2 → null → 1` at capture revision 3. Rejecting every null reply or showing a remembered attempt as current would violate the accepted nullable-authority contract.

The fix separates immutable-owner authority from display. `useSavedRunAuthority` retains a per-run/generation Map of the greatest known currentAttempt and stable known executionId. Consumers pass this independent record into their freshness guard and remember only after the entire task/group response has passed every admission check; a partially rejected response never advances authority. The shared read hook, its nullable displayed DTO, request cancellation and existing transport are unchanged. A null **currentAttempt** is still admitted and displayed as unknown with previous attempt prose noncurrent. A later lower known ordinal is refused while the latest unknown DTO remains displayed; no earlier report is promoted.

Exact reset key: task owner is JSON `[resultsScope, epoch, groupId, taskId]`; group owner is JSON `[resultsScope, epoch, groupId]`. App's resultsScope already includes `[account.user.id, project scope]`. Within that owner, the Map key is JSON `[runId, generation]`. Account/scope/epoch/group/task changes replace the Map; a new run or generation selects an independent entry. Unmount also retires memory. `changeSeq`, captureRevision changes and hide/show are request/presentation freshness, so none clears this authority. Execution ID is a stable remembered fact inside each run/generation entry, not a nullable key that could erase known ownership.

Controller's analogous execution check was implicated specifically by projection restart: the previous prior-only guard rejects known execution→null during an unchanged request owner, but changeSeq restarts discarded that prior and admitted null/foreign execution. Two additional consumer criteria first failed on that actual path, then passed with the shared authority record. The accepted server reader returns executionId from the core run body, separately from optional capture freshness; a previously known execution cannot silently become null/foreign under the same run/generation. An initially unknown execution can become known. This fix does not add a DTO field, infer verifier truth or change producer/core behavior.

New RED: `result5-r1-red` RC1, four intended failing criteria (task/group real App `2 → null → 1` and task/group projection/hide retention). New execution RED: `result5-r1-execution-red` RC1, two intended consumer failures through projection→null→foreign. Both complete raw logs were inspected. Added account-reset App cases plus direct scope/epoch/run/generation reset assertions; no old expectation changed or waived. `result5-r1-focused-green` RC0: eight files/115 tests before the final two account-reset cases. Closing restored focus is eight files/**117 tests RC0, no skips**.

Final full Web `result5-r1-full-web`: **104 files/902 tests RC0, no skips**; type and fresh product build RC0. All closing gates and restored clone share source-tree SHA256 `ba2f13c7e737e5c6186c5c52a31ca65a13e29b75e979613b00f62c97d9522bd1`. The normal Vite chunk-size warning is preserved. No baseline agent-preview timeout reproduced; prior Task2 harness ownership remains unchanged.

Clone-only deletions used `/private/tmp/orca-result5-r1-mutations-20261011`, created with raw git `clone --local --no-hardlinks`, source `28c09889d571c677cee4f8feee66748f398f1e35`. Every mutation RC1 failed its intended task and group criterion:

- `null-attempt-retention`: replacing the actual new null-preservation write with `currentAttempt: run.currentAttempt` reproduces the real-App old-attempt admission.
- `owner-reset`: deleting the owner-key reset blocks valid lower ordinals in a new scope.
- `account-reset`: the same deletion blocks valid lower ordinals after a real App account switch.
- `execution-retention`: removing the remembered execution from the actual guard admits null/foreign ownership after projection restart.
- `generation-owner`: deleting generation from the run key blocks a valid lower ordinal in a new generation.

After each mutation raw git unstaged and cached diff byte counts were **0/0**. Targeted mutation runs intentionally excluded unrelated cases (skip counts preserved in each log); they are not whole-suite GREENs. All five complete logs were read. Manifest with exact deleted branches/argv/RC: `/private/tmp/orca-result5-r1-mutations.json`. Restored focused GREEN exercises both consumers, owner resets and original result/download/i18n criteria. The original reviewer helper witness remains immutable RED provenance: its deliberately prior-only caller does not exercise the new independently retained authority passed by the real consumers; it was not rewritten to make an obsolete call pattern appear fixed.

Only four files changed: `web/src/TaskResults.tsx`, `web/src/GroupResults.tsx`, `web/tests/resultsApp.test.tsx`, `web/tests/taskResults.test.tsx`. Reviewed the full scoped diff and validated that authority is remembered only after full admission, nullable rendering remains independent, and no request lifecycle or producer/core behavior changed. Own diffcheck RC0. Verified the exact four-file staged list and used one-command empty core.hooksPath. Final own unstaged/cached diff bytes are 0/0; clone diff bytes 0/0; each owned file byte-equals the restored clone. Source/hash manifest: `/private/tmp/orca-result5-r1-source.json`. No node_modules/shared documents/ledgers were staged. No root or producer suite duplication, provider/model invocation, service action, push or publication.

Native evidence uses the same fully isolated runner as the initial report; each result.json records argv, RC, HEAD, tree hash and measured elapsed time. Raw logs:

- `result5-r1-build`: RC0; `npm run build --workspace web`; source `554d77e4a2883511922c07a108320ce2115578db`; [raw](/private/tmp/orca-followup-runs/result5-r1-build/output.log).
- `result5-r1-execution-red`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/taskResults.test.tsx -t 'known execution authority' --maxWorkers=2 --no-cache`; source `554d77e4a2883511922c07a108320ce2115578db`; [raw](/private/tmp/orca-followup-runs/result5-r1-execution-red/output.log).
- `result5-r1-focused-green`: RC0; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx tests/taskResults.test.tsx tests/groupResults.test.tsx tests/resultOutput.test.tsx tests/detailRegions.test.tsx tests/i18nKeys.test.ts tests/i18nPseudo.test.tsx tests/labelSourceFallback.test.tsx --maxWorkers=2 --no-cache`; source `554d77e4a2883511922c07a108320ce2115578db`; [raw](/private/tmp/orca-followup-runs/result5-r1-focused-green/output.log).
- `result5-r1-full-web`: RC0; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run --maxWorkers=2 --no-cache`; source `554d77e4a2883511922c07a108320ce2115578db`; [raw](/private/tmp/orca-followup-runs/result5-r1-full-web/output.log).
- `result5-r1-mutant-account-reset`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx -t 'account switch resets' --maxWorkers=2 --no-cache`; source `28c09889d571c677cee4f8feee66748f398f1e35`; [raw](/private/tmp/orca-followup-runs/result5-r1-mutant-account-reset/output.log).
- `result5-r1-mutant-execution-retention`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/taskResults.test.tsx -t 'known execution authority' --maxWorkers=2 --no-cache`; source `28c09889d571c677cee4f8feee66748f398f1e35`; [raw](/private/tmp/orca-followup-runs/result5-r1-mutant-execution-retention/output.log).
- `result5-r1-mutant-generation-owner`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/taskResults.test.tsx -t 'retention resets' --maxWorkers=2 --no-cache`; source `28c09889d571c677cee4f8feee66748f398f1e35`; [raw](/private/tmp/orca-followup-runs/result5-r1-mutant-generation-owner/output.log).
- `result5-r1-mutant-null-attempt-retention`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx -t 'known attempt high-water' --maxWorkers=2 --no-cache`; source `28c09889d571c677cee4f8feee66748f398f1e35`; [raw](/private/tmp/orca-followup-runs/result5-r1-mutant-null-attempt-retention/output.log).
- `result5-r1-mutant-owner-reset`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/taskResults.test.tsx -t 'retention resets' --maxWorkers=2 --no-cache`; source `28c09889d571c677cee4f8feee66748f398f1e35`; [raw](/private/tmp/orca-followup-runs/result5-r1-mutant-owner-reset/output.log).
- `result5-r1-red`: RC1; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx tests/taskResults.test.tsx -t 'high-water|retention resets' --maxWorkers=2 --no-cache`; source `554d77e4a2883511922c07a108320ce2115578db`; [raw](/private/tmp/orca-followup-runs/result5-r1-red/output.log).
- `result5-r1-restored-focused`: RC0; `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx tests/taskResults.test.tsx tests/groupResults.test.tsx tests/resultOutput.test.tsx tests/detailRegions.test.tsx tests/i18nKeys.test.ts tests/i18nPseudo.test.tsx tests/labelSourceFallback.test.tsx --maxWorkers=2 --no-cache`; source `28c09889d571c677cee4f8feee66748f398f1e35`; [raw](/private/tmp/orca-followup-runs/result5-r1-restored-focused/output.log).
- `result5-r1-type`: RC0; `npm exec --workspace web -- tsc --noEmit -p tsconfig.json`; source `554d77e4a2883511922c07a108320ce2115578db`; [raw](/private/tmp/orca-followup-runs/result5-r1-type/output.log).
