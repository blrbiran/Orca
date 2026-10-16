# Task 10 report (implementer, Orca session a852f96a, 2026-10-16)

Status: DONE_WITH_CONCERNS. Commit `06f15c53` on Orca branch `codex/every-agent-chain` (base `1322d099`, main).
LOGS = /private/tmp/claude-501/-Users-biran-code-skills-orca-Orca/a852f96a-f3c8-4721-9df4-b10c19154451/scratchpad/logs

## Setup (rulings applied)
- Worktree: `OR=/Users/biran/code/skills/orca/Orca-wt/every-agent-chain`, `-b codex/every-agent-chain main` (`or-wt.txt`, RC=0, HEAD 1322d099).
- P25: real `npm ci` in $OR (no node_modules symlink) -> `or-npmci.txt` RC=0 (250 packages; ran `prepare`, which sets `core.hooksPath scripts/githooks` -- the same value the shared repo config already holds). `npm run build --workspace web` -> `or-webbuild.txt` RC=0.
- ccloop binary: `git clone --local --branch codex/every-agent-chain` -> `/private/tmp/ccb-0bIg/repo` at `efcd5b3`, node_modules symlinked to ccloop main tree, `npm run build` RC=0 (`ccb-clone.txt`, `ccb-build.txt`). `ORCA_CCLOOP_BIN=/private/tmp/ccb-0bIg/repo/dist/cli.js`. Never mutated.
- TMPDIR for every run: `/private/tmp/cl-lyLy`.

## What changed (10 files)
- `src/control/profiles.ts` intersectCapabilities: R7 expression exactly as the brief (observed null -> null; declared null -> observed; else min), with the brief's comment.
- P17: `src/control/ccloopPort.ts:47` `singleCallExecution:z.enum(["v1","v1-soft"])` + comment line `// Spec 2026-10-15 §6.2: "v1-soft" (codex) ...`; `src/control/agentSelection.ts:36` type `"v1" | "v1-soft" | null`. estimatorCompatibility untouched (still requires "v1"; Task 11's split).
- `tests/setup/relocateCcloopCache.ts` (new): sets `CCLOOP_CACHE_DIR` AND `CODEX_HOME` to empty `mkdtemp` dirs under the file's scoped TMPDIR (ruling). `vitest.config.ts`: added right after scopeTmpdir.ts, plus one comment line.
- `tests/control/declaredNullWindow.test.ts` (new): the brief's two tests verbatim.
- `tests/control/webCcloopSmoke.test.ts`: E6 rewritten (`contextWindowTokens: 272000`) with the brief's "Rewritten for ..." comment (date 2026-10-15) and `// Ruling: human named E6 in Orca session a852f96a, 2026-10-15`. NEW additive criterion (P17): "accepts the real codex resolution's singleCallExecution v1-soft through Orca's schema" -- real ccloop, asserts `[selection.agent, singleCallExecution]` equals `["codex","v1-soft"]`.
- ERRATUM comments (appended, original text verbatim, no assertion touched) on three P-5 prose lines a run proved false: `tests/control/fixtures/ccloopWorld.ts:82` (fixture file, comment only), `tests/control/executionDriverE2E.test.ts:16`, `tests/control/estimateSingleCallGate.test.ts:11`. Evidence: clone-only probe (`t10-probe-out.json`): a codex world's import-time estimate is `blocked-capability` with reasonCode `agent-selection-rejected:estimator:agent-unselected`, not a window; and declaredNullWindow's green run shows a declared null with observed 272000 has no context-unavailable. `handoffE2E.test.ts:319` left unedited: still true (estimator is blocked-capability).

## RED / GREEN
- RED `t10-red.log`: RC=1, both tests failed (`[null,200000,null,null]` vs `[272000,...]`; `[true,true]` vs `[false,true]`).
- GREEN `t10-green.log` RC=0 2/2; `t10-e6-green.log` (verbose) RC=0: 2 R7 + 6 webCcloopSmoke passed by name, incl. E6 and the v1-soft criterion.
- typecheck `t10-typecheck.log`, `t10-typecheck2.log`: RC=0.

## R7 sweep (`t10-sweep.log`, `t10-sweep.json`, summaries `t10-sweep-summary.txt`, `t10-sweep-fails.txt`)
Scope: `tests/control tests/panel tests/agents tests/entry` (brief's two dirs plus the two others that spawn the real ccloop), with ORCA_CCLOOP_BIN, BEFORE the E6 rewrite. 2662 tests: 2547 passed, 82 failed, 33 skipped; 27 files red. Load during the run 116-164 (uptime at end; other agents' gates were running).
- E6 (`webCcloopSmoke.test.ts:156`) red exactly as predicted (deep-equal diff on contextWindowTokens) -> rewritten (human-named).
- `taskResultPaired.test.ts` 2 red: `expected [fixed, feature] to include /private/tmp/ccb-0bIg/...` -- the file hard-codes two other ccloop build paths; environment red, independent of this change (handoff §6 "taskResultPaired (环境红)").
- Every other red: 77 x `Test timed out`, plus `driverReconcileN` ENOTEMPTY teardown race and `handoffE2E` H2 `expected 1 to be +0` at :219 (a landing before the stop: real-time window under load). All 25 such files re-run alone 3x each, sequentially (`t10-rerun/index.txt`, per-run logs `t10-rerun/<file>-<n>.log`, `tests-lines.txt`): **75/75 RC=0, no skips**, load 8-32 (1-min avg). Classified as load flakes (most are registered in known-load-flakes.md; not registered there before: `panel/{controlOverviewApi refuses-altered..., integrationApi, projectsApi, projectsFileMode B4, todo (e)(f), decisionsApi, controlRecoveryApi}`, `control/{activityRuns run-resumed, profiledService, requirementExport, tokenPolicyRestartable, tokenPolicyStop, settleUnknownUsageUnmetered}` -- all 5 s timeouts at load >100, 3/3 green alone; for the controller to register if wanted).
- P-5 "read and predicted unchanged" confirmed green in the sweep (passed counts): profiles.test 10/10, planImport 39/39, agentPlanImport 18/18, agentSelectionE2E 6/6, estimatePrompt 5/5, estimateSingleCallGate 3/3, agentUpgradeE2E 2/2 (ccloopWorld.ts:244 exercised through them; executionDriverE2E 10/10, estimateE2E 3/3).
- Skipped (33, env-gated, pre-existing): ccloopDefaultE2E 3 (skips when ORCA_CCLOOP_BIN is set), ccloopProtocol.integration 3, agentUpdatePaired 3, savedResultRecovery.paired 20, savedResultRetryAuthorization.paired 3, driverSkillsReal 1. ccloopProtocol.integration therefore did NOT run against the new ccloop here (Task 16 gate must run it with its env).
- Neighbours after all edits (`t10-neighbours.log`, verbose, read whole): 9 files, 82/82 passed (declaredNullWindow, profiles, webCcloopSmoke, estimateSingleCallGate, executionDriverE2E, estimatePrompt, agentSelection, ccloopPort, agentSelectionE2E).

## Real cache path never touched (plan issue 14)
- `~/.cache/ccloop` absent before and after the sweep and after the relocated-HOME run (`t10-realcache-before.txt`, `-after.txt`, `-after2.txt`). XDG_CACHE_HOME / CCLOOP_CACHE_DIR / CODEX_HOME unset in the shell.
- Relocated HOME, all 27 real-ccloop test files of control/panel/agents/entry in the clone (`t10-home-suite.log/.json`, `t10-home-fails.txt`, `t10-home-suite-find.txt`): fake HOME holds only vitest's own `Library/Application Support/vitest/.vitest-secret-token` -- no `.cache`. Reds there: 7 `panel-dist-missing` (the clone has no web build, handoff §6.7) + taskResultPaired env red; so those 7 panel/entry tests did not reach ccloop in that run (they did in the $OR sweep, with the real cache absent after).

## Mutations (clone `/private/tmp/mut-CoB9/repo`, from $OR + uncommitted files copied in; node_modules symlink removed after; clone dir left for the human)
Baselines green: `t10m-baseline-r7.log` 2/2, `t10m-baseline-smoke.log` 6/6. (all in `t10m-all.txt`)
- M10.1 R7 expression -> old `declared !== null && observed !== null ? min : null`: sha256 `eaa557d9...f5302 -> 46cf3038...53438`; `t10m-M10.1.log` RC=1, BOTH declaredNullWindow tests red (same diffs as RED). Restored.
- M10.3 (P17) enum -> `["v1"]`: sha256 `fcb2566b...f4823 -> ab4d2289...899d01`; `t10m-M10.3.log` RC=1, the new v1-soft criterion red with `control-response-invalid` (also E6 and the delivery-guard test, which resolve codex the same way). Restored.
- M10.2 setup-file entry removed from vitest.config.ts, run with `HOME=$M/fakehome`: sha256 `5d74d1f5...73f1 -> 2387b1cf...066c`; tests green (recorded, not a red criterion as the brief says), and 3 entries appeared under `$M/fakehome/.cache/ccloop/agent-catalog/*.json` (`t10m-M10.2-find.txt`); same run WITH the setup file (`t10m-M10.2-base*`): no `.cache` under the fake HOME. Restored.
- Restore proof: `git diff`+`git diff --cached` bytes 8014 before the battery and 8014 after (non-zero because the files under test are uncommitted copies); `cmp` with $OR: profiles.ts, ccloopPort.ts, vitest.config.ts identical (`t10m-cmp.txt`).
- Clone also holds a measurement-only file `tests/control/zzT10ProbeReasons.test.ts` (never in $OR) and `fakehome*` dirs.
- pgrep before/after (`pgrep-t10-mut-*.txt`, `pgrep-t10-before.txt`): the leftover processes are from `/private/tmp/ccg-cEhq` (the Task 9 gate's clone) -- not this task's; this task's one handoffE2E worker (pid 65261, ccb-0bIg) seen during the sweep was gone afterwards. Nothing killed.

## Rewritten criteria
- E6 only (human-named): `tests/control/webCcloopSmoke.test.ts:158-161` old `contextWindowTokens: null` -> new `contextWindowTokens: 272000`; ruling comment beside it. No criterion rewritten under the blanket naming.

## Self-review
- Diff read whole (`t10-staged.diff`); deleted lines (`t10-deleted-lines.txt`) are only: the old type, the old enum line, the old 3-line R7 expression, E6's literal line, the old setupFiles line. No published comment removed.
- Not done by me (per ruling): progress.md / ledger commit (controller).

## Concerns
1. ccloopProtocol.integration (3) and the paired suites stay skipped without their env; real-ccloop coverage of those must come from the Task 16 gate.
2. Rule 14: I used grep on two derived summary files (re-run index RC lines; "Tests" lines of re-run logs) and on the neighbours log once before reading it whole; the sweep's 4390-line log was summarised through its JSON (script `t10-summarize.py`, `t10-fails.py`), not read line by line. All raw logs are on disk.
3. Rule 6: this run's own context usage is not reported by any tool; not estimated.
4. ERRATUM placement in `ccloopWorld.ts` is a fixture-file comment (listed for the human's fixture list, handoff §6.9).

## Fix round 1 (2026-10-16, same implementer) -- commit `dfd76de5`
Only the files I touched were run, as instructed (the machine is running the ccloop gate).
1. ERRATUM wording corrected in place. These lines were added on this branch and never published, so editing them is allowed; every published original word is untouched. Files: `tests/control/executionDriverE2E.test.ts` (~:19-22) and `tests/control/fixtures/ccloopWorld.ts` (~:85-89). They now say: measured on 06f15c53 (ccloop efcd5b3 built), the import-time estimate is blocked first by `agent-selection-rejected:estimator:agent-unselected` (planImport's layer resolution at src/control/planImport.ts:176-183, which predates R7), and the window is not reached in these worlds. There is no longer any claim that R7 caused this. Not measured on base 1322d099 (optional; skipped because the machine is busy). `estimateSingleCallGate.test.ts`'s erratum is unchanged: it states the general R7 rule, which declaredNullWindow proves, and no world-specific cause.
2. `tests/control/declaredNullWindow.test.ts` gains `declared(300000), observed(272000) => 272000`. The expected value is now `[272000, 200000, 272000, null, null]`.
   - Focused run in $OR: `t10f1-green.log` RC=0, 2/2 passed.
   - Mutation in a fresh clone `/private/tmp/mut-mEVr/repo` (node_modules link removed, clone left in place). Baseline `t10f1-base.log` RC=0, 2/2. Math.min changed to Math.max in profiles.ts (sha256 `eaa557d9...f5302 -> 2964f720...2b886`). `t10f1-max.log` RC=1: the first test is red with `[272000, 272000, 300000, null, null]` against `[272000, 200000, 272000, null, null]`. Both min/max slots differ, so the mutation is now red in both directions.
   - Restore: `git diff -- src` + `--cached` = 0 bytes (`t10f1-restore.txt`).
- Typecheck `t10f1-typecheck.log` RC=0 (tsconfig includes tests/).
- The changes to executionDriverE2E.test.ts and ccloopWorld.ts are comments only. Neither file was re-run (heavy real-ccloop suites; the instruction was focused runs only); typecheck covers syntax.
- Deleted lines in the fix diff (`t10f1.diff`): only the branch's own unpublished erratum lines and the new test's old expected literal.
