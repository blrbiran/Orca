# Task 1 integration P2 — capture authority fix report

Owner `/root/saved_verification_takeover`, 2026-10-11 Asia/Shanghai. Authorized BASE `be35141f778c2773ab75cd2af6be5901b027ee53`; product HEAD `e9f898b61cde33b8c1a67602e140f0f3b8af022a` (`fix(web): retain capture authority across Results refreshes`). Product commit owns exactly `web/src/TaskResults.tsx` and `web/tests/resultsApp.test.tsx`. A separate evidence-only closing commit owns this report and `handoff-results-freshness-fix-evidence/`; its exact final HEAD is supplied in the controller completion message. Independent scoped re-review is pending.

Task 7 explicitly released checkout/Git before this implementation. Read the full scoped brief/preparation, complete integration P2, Results spec 8.3, completed Task 1 report and actual consumers/App tests. Used receiving-code-review, TDD and verification-before-completion. No subagents, original Results5 WIP edits, deferred Tasks 8–14 work, provider calls, remote push, main merge, repin, production migration or service change occurred. All commands used RTK proxy and raw `/usr/bin/git`; both commits use a one-command empty hooksPath and quiet commit.

## Result and boundaries

The same immutable Results owner now remembers the greatest admitted captureRevision per `[runId, generation]` alongside existing known currentAttempt/executionId. `freshSavedRun` compares the incoming capture against `Math.max(effect prior, persistent authority)`. Existing task/group compositions still call remember only after complete response admission. An invalid member therefore cannot advance capture, attempt or execution authority. The source change is two replacements and one added record write; GroupResults and useResultsRead are unchanged.

Same account/project/epoch/group/task preserves capture authority across hide/show and changeSeq refresh. Existing real owner reset keys remain unchanged, and new run/generation uses an independent Map entry. Nullable currentAttempt still displays unknown without promoting previous-attempt prose; remembered known ordinal/execution checks remain intact. No new request, timer, global state, DTO field or owner bypass was added.

Ten actual App criteria were added: four task/group × hide/show/changeSeq stale-capture cases; two task/group sequences validating account, project, epoch, run and generation reset; two task/group aggregate refusal cases; two task/group nonregressing capture with unknown currentAttempt cases. All existing criteria and expectations were preserved. Aggregate fixtures begin at capture8/attempt1/unknown execution, then reject a candidate capture10/attempt2/first known execution together with another member's foreign execution. Valid capture9/attempt1/unknown execution remains admissible after a same-owner restart. No authority from the rejected response can be used to refuse it.

## RED and fixture corrections

All complete raw logs were read and archived byte-for-byte. `results-freshness-red-01` RC1 first observed the four actual lifecycle failures at the missing stale refusal; 22 other tests were intentionally selected out. Changed the new assertion's missing-alert input from undefined to an empty string so Vitest reports the behavior directly rather than its undefined matcher diagnostic. Product remained unchanged.

`red-02` RC1 had the same four lifecycle failures plus one new fixture error: actual App epoch replacement retires the opened task detail. The positive task test now reopens the task through its existing Progress/Results navigation after that genuine reset. No old assertion or product behavior was changed. `red-03` RC1 then showed exactly four intended lifecycle failures (`expected '' to contain result-response-stale`), six positive boundary cases passed, 22 selected skips. Product at all three REDs was unchanged BASE be35141; exact test-source hashes are retained in each result.json.

The three-line source fix passed focused 8 files/127 tests. Self-review strengthened aggregate inputs so capture, attempt and execution all exercise the rejected-response boundary. The first final typecheck then caught only the new fixture array's overly narrow inferred union; annotated it `RunResultsV1[]`. Its RC2 raw log is preserved and never credited as a mutant. Product logic remained unchanged. Completed self-review of the full scoped diff and actual caller ordering before the final source freeze. No product/test edit occurred after corrected final source freeze.

## Exact final source and gates

Final source-tree SHA256 is `3564d91114e89a4b7f25a5566a322aa58b660406b7a553fb8e432cc458b493ed`, 932 source files under the shared runner's declared source inventory. All final native gates below and restored clone have this exact hash. Verification HEAD was be35141 plus the two owned working files; committing did not change their bytes.

| Final gate | Result | Tool-measured elapsed seconds |
| --- | --- | --- |
| results-freshness-type-final02 | RC0, Web tsc --noEmit | 5.7948219776153564 |
| results-freshness-build-final02 | RC0, Web Vite production build | 1.4771473407745361 |
| results-freshness-full-final | RC0, 105 files / 922 assertions / zero failed, skipped or todo | 72.70509481430054 |
| results-freshness-clone-type | RC0, exact-source clone Web typecheck | 5.714533805847168 |
| results-freshness-clone-build | RC0, exact-source clone Web build | 1.3773880004882812 |
| results-freshness-clone-baseline | RC0, 8 files / 127 assertions / zero skips | 7.601977825164795 |
| results-freshness-clone-restored | RC0, 8 files / 127 assertions / zero skips | 7.727843999862671 |

Exact argv, RC, verification HEAD, source hash, counts, elapsed time and durable raw-log paths for **all 17 runs** are in [run-inventory.json](handoff-results-freshness-fix-evidence/run-inventory.json). Final native commands:

- Web type: `npm exec --workspace web -- tsc --noEmit -p tsconfig.json`.
- Web build: `npm run build --workspace web`.
- Full Web: `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run --maxWorkers=2 --no-cache --reporter=default --reporter=json --outputFile=/private/tmp/orca-followup-runs/results-freshness-full-final/vitest.json`.
- Clone focused baseline/restored: `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/resultsApp.test.tsx tests/taskResults.test.tsx tests/groupResults.test.tsx tests/resultOutput.test.tsx tests/detailRegions.test.tsx tests/i18nKeys.test.ts tests/i18nPseudo.test.tsx tests/labelSourceFallback.test.tsx --maxWorkers=2 --no-cache`.

Full log is 11497 bytes, SHA256 `90cbd594ea57f5130c61a1c44a60e7d78cd6ca2feaf26a1baf21b0a92c3d5201`. Native JSON is 367317 bytes, SHA256 `f8639dd83525181d2335ef52e5fba9e493c6549572d33d8c7247e2fb6867350b`; strict audit visited every file and all 922 assertions, requiring passed state and empty failure messages, with zero pending/todo. [Full audit](handoff-results-freshness-fix-evidence/full-audit.json) and both original files are durable. Ordinary Vite >500kB chunk warning is retained; no warning suppression or unrelated build change was introduced. Existing agentPreviewRefresh cases passed in this run; no old timeout is waived or declared permanently cured.

## Clone guard deletions

Only raw local no-hardlinks clone `/private/tmp/orca-results-freshness-mutants-20261011` was mutated. Clone snapshot `2f5c7f52da3ac322d7ef58912704b7bfbf118588` matches every final source byte and uses existing dependencies. Its unmutated type/build and 127-case baseline passed before any mutation. [Source readiness](handoff-results-freshness-fix-evidence/source-readiness.json) retains the complete 932-file hash inventory and dependency locations.

| Named deletion | Intended observed failure | RC / failed / selected skips |
| --- | --- | --- |
| capture-authority-retention | Remove remembered capture from admission, keep prior and other guards. All task/group hide/changeSeq cases lose stale refusal. | 1 / 4 / 28 |
| capture-authority-write | Replace admitted capture retention with zero while preserving typed record/other writes. Same four lifecycle cases lose stale refusal. | 1 / 4 / 28 |
| whole-response-authority-commit | Remove `if (accepted)` from both actual task/group remember compositions. Valid capture9 after refused aggregate loses its Current result region. | 1 / 2 / 30 |

Every full mutant log and exact patch was read. Failures are the intended observable criteria, never compiler/build errors. Every restore has raw unstaged and cached diff **0/0 bytes**. Restored focused suite is 127/8 RC0 with zero skips and the final source hash. Targeted skips are preserved and are not represented as a full-suite pass. [Mutation audit](handoff-results-freshness-fix-evidence/mutation-audit.json) binds each patch/run/changed-source hash/failure/restoration.

## Ownership, isolation and remaining review boundary

[Precommit proof](handoff-results-freshness-fix-evidence/precommit-proof.json) verifies BASE, all main/clone bytes, clean clone source/index and the explicit two owned product/test paths. Product/test unstaged and cached diffs are 0/0 after product commit. Parent ledger/spec/handoff drafts, Task 7 artifacts, preparation note and node_modules are excluded from both commits. Evidence manifest records the archived bytes/hashes; historical logs are unchanged.

Runner `/private/tmp/orca-followup-run.py` SHA256 `64a9805f8b5100cd1abe5fd1df384f48a80b2af65aa211447511f213ad1375c5` is saved verbatim. Each child isolates HOME, all XDG roots, TMPDIR and CCMEM_DATA_ROOT; CCMEM_CONFIG_PATH and real adapter variables are absent. NPM_CONFIG_UPDATE_NOTIFIER=false is child-only. Tests use fake fetch/clock/localStorage and existing dependencies, with zero fixture command posts in the new criteria. No real user data or paid provider was used.

No unresolved product concern found in scoped self-review. Independent Task 1 integration re-review and controller's final merged native/panel/UI source binding remain required. Browser geometry and production acceptance are not claimed. The unchanged producer/CLI/root suites were deliberately not duplicated for this browser-only fix, as the scoped brief directs. Existing publication/old installed pin and Task 14 fixture concerns remain their established owners' boundaries.

Closing evidence check: the complete staged `git diff --check` returned RC2 solely for native Vitest raw logs' blank line at EOF (ten archived logs). Those exact original bytes are intentionally preserved; no log was normalized to hide the notice. Product/test diffcheck is RC0, and the staged report/metadata/patches check excluding only raw output.log files is RC0. This is an evidence whitespace notice, not a failing product/native gate.
