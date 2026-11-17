# Orca test-gate analysis (read-only survey, 2026-11-17)

Who: a read-only subagent of Orca session `0ae7510a`, dispatched at the human's request ("下一轮我们顺便看下当前 test case 是否需要精简
……每合入一组 patchset 就要跑一遍，浪费了太多时间"). Observed on Orca main after the merge of `fix(recovery): say that a landed run is
settling instead of a bare refusal (#332)`, with the `fix/delivery-tail` branch's gate running at the same time (load 20–42).
No test was run for this survey; every number came from existing logs, the vitest results cache, the static import graph and
`/usr/bin/git log`. The agent's scripts and raw outputs lived in its session scratchpad (lost when the session ends). Record of
a deviation the agent reported: its graph script briefly wrote `graph.json` into the repo root; it moved it out within a minute,
and the controller confirmed `git status --porcelain --untracked-files=all` showed only the handoff edit afterwards.

This file is evidence for the next session's work; numbers are estimates as labelled. Nothing here has been approved by the human.

## Bottom line

- Selection is wide because of the code's structure, not a selection bug: narrowing `test-affected` rules buys little for
  branch-sized diffs.
- The big levers: (a) stop running the wide gate per patch set and re-running it per flake; (b) take ~15 heavy E2E files out of
  the per-patch-set path; (c) fix a few time-based tests.
- The gate is throughput-bound: one 829-file selection sums to 13,257 s of file time, ~1,473 s over ~9 workers (10 cores);
  measured root wall times were 944–1,603 s.

## 1. Why selection is so wide

This gate: 37 changed paths selected 1,085 files (837 root, 248 web).

| Changed path | Root files it selects | Exclusively |
|---|---|---|
| `src/control/errors.ts` | 806 | 5 |
| `src/control/webProtocol.ts` | 799 | |
| `src/control/activity.ts` | 791 | |
| `src/control/integrationScheme.ts` | 789 | |
| `executionDriver`, `groupAcceptance*`, `groupEdges`, `integrationPass`, `requirementReview`, `deliveredAcceptance` | 746 each | |
| `webService`, `integrationCommands`, `groupAcceptanceCommands` | 718 each | |
| `src/panel/controlViews.ts` | 476 | |
| `web/src/locales/{en,zh}.ts` | 250 / 251 (247–248 web) | 1 each |
| `web/src/controlTypes.ts` | 191 | |

Files selected only by the mirror-directory rule: 37. Each file had 2–22 selecting paths, so dropping one rule changes almost nothing.

Import chains (static graph, type-only imports dropped; it reproduces the gate: `errors.ts` reaches 789 vs 806 selected; suite
on main = 922 root + 266 web test files):
- `src/control` has a **52-module import cycle** (`commands`, `budget`, `stopIntent`, `webDispatch`, `proposalReopen`, `queries`,
  `snapshot`, `archive`, … plus 5 `src/flow` modules) and a second 17-module cycle around `executionDriver`. **743 of 922 root
  tests reach the 52-module cycle.**
- The edge that pulls even plain store tests in: `src/control/store.ts → migrations.ts:3 → proposalReopen.ts` (`reopenProposalBodies`).
- Direct test entry points into the cycle: `controlViews` 171, `webService` 168, `fixtures/driverHarness` 154, `fixtures/web` 150, `queries` 142.
- Leaf hubs: `errors.ts` 66 direct test importers (224 importers total), `webProtocol.ts` 63 (108).

How often hubs change (`/usr/bin/git log --since=2026-10-18 --no-merges --name-only main`, current graph applied to history,
approximate): 1,635 commits, 715 touching `src`; **584 of 715 (82%) touch a file whose import closure alone selects ≥500 root tests**;
191 touch the 52-module cycle. Counts: `errors.ts` 56, `webProtocol.ts` 153, `executionDriver.ts` 92, `webService.ts` 107, `en.ts` 283,
`zh.ts` 287, `controlTypes.ts` 151, `package-lock.json` 41, `package.json` 44; 51 commits touched whole-suite config.

Bounding import distance does not rescue a branch diff: direct importers of this diff alone are 430 files (390 root). File time by
distance: 1 = 387 files / 9,017 s; 2 = 248 / 3,575 s; ≥3 = 155 / 568 s.

#328 check (`git show 1098ef8f`, `1098ef8f^`): all four post-merge regressions lived in direct importers (`requirementE2E`,
`dirRequirementE2E`, `dirRequirementOutOfRepo`, `agentWalk`, `splitParallelCandidates` import `SPLIT_PROMPT_HEAD`; the import cycle
broke `integrationScheme`'s 25 direct test importers), except `refusalCoverage` at distance 2 from `errors.ts` (via
`src/commands/generate.ts`, though it imports `en`/`zh` directly). #328 slipped because it ran a hand-picked focused set, not `test-affected`.

Selection proposals and risks:
- (a) Additive-only diffs to `errors.ts` or locale files select the catalogue tests (`refusalCoverage`, `errorClassification`,
  `i18nKeys`, `noteCodes`, the `skills/` error-code readers) plus tests whose text names the added literals. Renames/removals fall
  back to the full rule; without `refusalCoverage` in the table, #328 ② is missed. Small saving (web suite 47–75 s per run).
- (b) Do not narrow `webProtocol.ts`: one added line can make a `.strict()` field required and break producers anywhere (handoffE2E G
  went red once when Orca's strict parser rejected ccloop's new `worker` key, `known-load-flakes.md:317`).
- (c) Structural: cut `store→migrations→proposalReopen` (lazy import or leaf module), then shrink the cycle, so `related` means
  something. Respect the 3cfc2e73 evaluation-order lesson; an import-each-module smoke test (item 11) guards it.
- (d) Cost-based tier instead of distance (item 3) — the one with real leverage.

## 2. Slowest files

Sources: vitest results cache in `.claude/worktrees/split-overlap-335/node_modules/.vite/vitest/*/results.json` (829 files) and
per-test times from the 2026-11-17 gate log. Flags: **R** real ccloop via `ccloopWorld`; **DH** `driverHarness` (fake port, real git
and SQLite); **FW** `flowWorld` (vault git).

Concentration: top 10 = 3,054 s (23%); top 30 = 5,244 s (40%); files ≥30 s: 107 files / 9,067 s (68%); ≥60 s: 49 / 6,542 s.

| Family | Files | Time | Share | Median per file |
|---|---|---|---|---|
| DH | 154 | 4,233 s | 32% | 14.5 s |
| R | 69 | 3,800 s | 29% | 23.1 s |
| FW | 54 | 1,406 s | 11% | — |

Cost is in test bodies (older vitest summaries: tests 98%, import 1%), mostly real git or child processes. In the partial log, 60
slow settles spent 671 s, 620 s of it in `archive` (`src/control/snapshot.ts:78-85`: bundle verify and fetch; 217 verifies so far).

Top 30 (seconds, cache / 2026-11-17):
1. **handoffE2E** 803 / 978, R, 13 cases: H2 224 s; R-H ×5 ≈300 s (four repeat crash points covered by `driverHandoff`/`driverContinuation`);
   G 74 s waits the production 60 s grace (`HANDOFF_EXTRA_GRACE_MS`). The long pole: split it, move R-H to release, inject the grace.
2. **agentSelectionE2E** 424 / 536, R: C3 205, M1 81, CH 81, CC 73, D1 62 (C3 and D1 redundant, §3).
3. **executionDriverE2E** 350 / 469, R: R1 ×5 ≈200; E1 73; R-F red on 2026-11-17.
4. **stepSkipDefer** 278 / 335, FW: 16 tests at 17–47 s from vault git.
5. **driverReconcile** 220 / 258, DH: 35 tests at 10–17 s, each spawns `fake-ccloop-run.mjs`, polls every 50 ms.
6. **feedbackIntake** 217 / 264, FW: 29 tests at 5–20 s.
7. **heldEffectChains** 199 / 305, FW: one property test 301 s (216 sequences, `:84-86`). Length 2 daily, 3 in release.
8. **requirementReviewFix** 189, DH: 12 tests at 11–25 s.
9. **handoffFailedRetry** 187, DH: 19 tests at 6–16 s, four near-identical "drifted X" refusals.
10. **multiDirLandingD** 186 / 229, R: 6 tests at 29–47 s.
11. **integrationResolve** 175 / 223: 29 DH tests at 2–10 s + 2 R at 32–37 s.
12. **sleepBlockedResumeE2E** 174 / 220, R: one test 148 s.
13. **coverParam** 152 / 187, FW: ~20 s per vault test.
14. **dirPlacement** 147: 38 git tests.
15. **workerLostE2E** 142 / 590, R: two tests red on 2026-11-17, one with a 240 s wall-clock wait. Release-only or event-driven wait.
16. **settleUnknownUsage** 132, DH: 36 tests at 2.5–7.8 s, each a full world.
17–30 (all DH or R at 75–120 s): `systemDebug` 120, `integrationGit` 114, `modelReviewE2E` 106, `integrationCrash` 98, `driverHandoff` 95,
`tokenPolicyRuntime` 95/130 (3 R tests 31–51 s), `integrationGh` 90, `debugClosing` 87, `handoffNotesE2E` 81, `retryTopUp` 81,
`retryTask` 77, `skillsE2E` 76/100, `driverReconcileN` 75, `retryTopUpSavedResult` 75. The `delivery-tail` cache adds `chain/gateCheck`
166 (deliberate ≥10 s wait, spawns `sleep`), `chain/run` 105, `chain/cli` 101.

Generic speed-ups: build each DH/flow world once per `describe` and copy the state directory per test (measure the fixture's share
first); fewer per-settle git spawns in `snapshot.ts`.

## 3. Redundancy (same behaviour, same path)

- Handoff stop/continuation against real ccloop: handoffE2E H1/H2/deadline (codex) vs agentSelectionE2E CH/C3/D1 (fake claude). C3 is
  H2 under claude; its extra claim ("reconcile slot model") is already asserted in M1. Keep H1, H2, H5, H6, G, H-lost, deadline, plus
  CH (frozen selection survives a resume). Move C3 (205 s, a registered flake) and D1 (62 s) to release-only, or delete C3.
- Crash-point E2Es duplicating harness coverage: handoffE2E R-H (H-after-deliver, H-after-candidate, B-after-accept,
  H-between-commit-and-settle in `driverHandoff.test.ts`; A2-after-bundle in `driverContinuation.test.ts`). executionDriverE2E R1:
  A2-after-workspace (`executionDriver.test.ts`, `driverSkills`), B-after-accept (`driverHandoff`), D-after-cas (`driverDecisions`,
  `debugClosing`, `historySource`, `multiDirLandingD`), E-after-acceptance (`driverSettle`, `driverSettleLane`); **only C-after-terminal
  is E2E-only**. Keep one real-ccloop crash case per file daily (B-after-accept; C-after-terminal); the rest release-only (~400 s).
- Table-driven refusals that rebuild a full world: `settleUnknownUsage` (9 "refuses X without accounting…", 4 "released accounting
  refuses a X defect", 6 "strictly rejects fake X marker", 3 caps; ~3.5 s each); `handoffFailedRetry` four "drifted X". Keep one end-to-end
  case per group; the rest on one shared world or calling the validator directly (rewrites criteria).

## 4. Obsolete tests

- No unconditional skips (`it.skip`/`describe.skip`/`xit`/`.todo` appear only as scanner samples; all skips are conditional).
- `tests/control/agentUpdatePaired.test.ts` (3 tests) is gated on `ORCA_TASK9_CCLOOP_BIN`/`ORCA_TASK9_OLD_CCLOOP_BIN`, which no script,
  `package.json` or verify step sets: it never runs. Delete it, or wire it into `verify`.
- `savedResultRecovery.paired` (22) and `savedResultRetryAuthorization.paired` (1) run only via `npm run verify:saved-result`, not part of
  `verify`; `known-load-flakes.md:333` says 19 need an old build. Effectively unrunnable — the owner decides.
- `taskResultPaired.test.ts`: the `!paired` branches (`:11-12`, `:26-32`, `:71`) target the historical ab824d1 build (dead code); the
  paired half is unique, keep it (61 s).
- Legacy-record tests (`finite-legacy`, retired protocol-2/v1, `legacyAgentRouting` 5.2 s, `finiteRetryGolden` 9.3 s,
  `tokenPolicyMigration` 0.7 s) pin compatibility with stored data; keep unless the owner confirms no such records exist.
- Speed gain from pruning obsolete tests ≈ 0 s; it is hygiene.

## 5. Load flakes that can be made deterministic

1. `flow/startForm` "answers the templates…" (red in ≥9 sessions): `:139-142` writes `FOLDER_ENTRY_LIMIT+1` = 20,001 files and lists
   them over HTTP inside the 5 s `FOLDER_LIST_MS` cap. Fix: injectable entry limit, test with ~10 files; the constant stays pinned at `:101`.
2. handoffE2E H2 / agentSelectionE2E C3: a 30 s execute hold (`ccloopWorld.ts:131`, `PARALLEL_STOP_HOLD_MS`). Replace with a barrier
   (the fake waits on a release file the test writes) — needs ccloop's fake support (ccloop repo, Rule 16).
3. handoffE2E G: make `HANDOFF_EXTRA_GRACE_MS` (`driverHandoff.ts:39`) injectable, unit-pin the 60 s value (saves ~60 s).
4. workerLostE2E "…successful candidate…": wait on state, not a 240 s deadline (red in 3 earlier gates and on 2026-11-17), or release-only.
5. taskResultCollector "core usage and terminal settle independently…": a real 1,500 ms race through `node:timers/promises` (fake
   timers don't patch it). Inject the sleep.
6. criteriaBaseRun "a restart while the re-run is in flight…" (`index.lock`, or blocked vs landed): await the old driver's `stop()` and
   `landingWatchesSettled()` before the new one starts (pattern at `driverHarness.ts:168`).
7. Pure timeouts still: schedulerBridge "success" (30 s), acceptAttemptLanding, driftLock D15 — fix by less load, not longer timeouts
   (`known-load-flakes.md` rule 4).
8. executionDriverE2E R-F `task-not-retryable` red again on 2026-11-17 (n=2): investigate; not exempt.

## 6. Process

- Measured gate wall times (every `/private/tmp` log mentioning `test-affected`, 11-15 → 11-17): eleven root gates of 794–915 files,
  944–1,603 s each, **12,437 s (3.45 h) total**; at least 6 re-ran the same or nearly the same selection. Web parts: 47–75 s.
- Session `0ae7510a` alone ran wide gates of 846, 1,075 and 1,085 files, and lost one 38-file re-run to 138 `panel-dist-missing`
  false reds (no `web/dist` in a new worktree).
- Proposal: per patch set a quick tier (direct importers, mirror files, catalogue tables; ≥30 s files and real-ccloop E2E deferred
  and printed); once per merge batch on main a full `npm test`; never re-gate an identical tree after `merge --ff-only`; on red re-run
  only the failed files; one gate at a time machine-wide; build `web/dist` automatically when panel tests are selected (1.56 s).

## Do next session (prioritised; nothing here is approved yet)

| # | Change | Files | Expected saving (how estimated) | Risk | Owner approval? |
|---|---|---|---|---|---|
| 1 | Wide `npm test` once per merge batch on main; quick tier per patch set; skip re-gating an identical tree (tree-hash green stamp) | `scripts/test-affected.mjs`, CLAUDE.md Rule 18, spec 2026-10-20 correction | 50–70% of 12,437 s / 2.5 days (gate counts above) | Heavy-file regressions surface at batch time, as in #328 ④ | **Yes** (Rule 18) |
| 2 | `--rerun-failed`: re-run failed files from the last JSON report, labelled as a re-run, not a gate | `scripts/test-affected.mjs` | ~950–1,600 s per avoided full re-run; ≥6 seen | None if labelled | No |
| 3 | Quick tier excludes ≥30 s files (from the results cache) unless changed, listed as deferred | same | Summed time ~13,257 s → ~4,190 s, ~8 min wall vs ~25 (sum ÷ 9) | No cache in a new worktree → fall back to full | **Yes** (policy) |
| 4 | Build `web/dist` automatically when panel tests are selected and it is missing or stale | same | One avoided 38-file re-run per new worktree | None | No |
| 5 | Machine-wide gate lock; print `uptime` at start and end | same | Fewer flake re-runs (not quantified) | Waiting | No |
| 6 | heldEffectChains: length 2 daily, 3 in `verify-suite.mjs` | `tests/flow/heldEffectChains.test.ts:84`, `scripts/verify-suite.mjs` | ~265 s file time per selection | Bugs reachable only via 3-step chains (the named 3-step chain stays in test 1) | **Yes** |
| 7 | agentSelectionE2E C3 and D1 to release-only (or delete C3) | `tests/control/agentSelectionE2E.test.ts` | ~267 s (measured 2026-11-17) | Claude-specific parallel-stop bug caught later | **Yes** |
| 8 | handoffE2E: R-H keeps B-after-accept daily, the rest release-only; inject the grace for G; split into 2–3 files | `tests/control/handoffE2E.test.ts`, `src/control/driverHandoff.ts:39` | ~250 s file time; the 978 s long pole → ~400 s | Protocol-level crash bugs caught at release; G no longer exercises the 60 s constant end to end | **Yes** |
| 9 | executionDriverE2E R1: keep C-after-terminal daily, other 4 release-only | `tests/control/executionDriverE2E.test.ts` | ~160 s | Covered by harness tests (§3) | **Yes** |
| 10 | startForm: injectable entry cap, test with ~10 files | `tests/flow/startForm.test.ts:139-142`, its route | Removes the most frequent flake | Cap value still pinned at `:101` | **Yes** (rewrite) |
| 11 | Cut `store.ts→migrations→proposalReopen`; add an import-each-module smoke test (catches #328 ①) | `src/control/migrations.ts:3`, new test | Enables narrower `related` later (not measured) | Evaluation-order bugs (3cfc2e73 lesson); the smoke test guards them | No (new criterion only) |
| 12 | Delete `agentUpdatePaired.test.ts`; remove dead `!paired` branches in `taskResultPaired`; owner decides on the two `*.paired` saved-result files | files in §4 | ~0 s (hygiene) | None (they never run) | **Yes** (deletions) |

Saving estimates are summed file time from `results.json` and the 2026-11-17 log; wall time ≈ that ÷ 9. Nothing above was measured as
a full-run before/after.
