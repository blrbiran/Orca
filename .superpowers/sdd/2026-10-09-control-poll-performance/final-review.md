# Whole performance round final review

Owner: Codex `/root/final_performance_review`, 2026-10-10 Asia/Shanghai. Fixed BASE `1fd19a3d49778d0809f96af49a7ef51647a6c0fe` (closed D9/M3), fixed HEAD `f76df587a7151d912da73ced1e18acf4fc40c9fd`. Review covers the whole performance round, including production, tests, benchmark provenance and integrated gates. Only this new review file is written; no source, test, index, HEAD or branch changes, suite reruns, mutations, service/provider actions or subagents were performed.

## Strengths

- M5 replaces repeated body reads without making cached data authoritative. `src/panel/groupReadSnapshot.ts:17` stores only connection-bound statements in its WeakMap; rows and lazy decoded values/errors belong to each new request. Group scope, unused-row laziness, strict-versus-lenient handling, rowid lineage and id display order are preserved. Converted requirement summaries also share the same snapshot while public/default clarifying reads retain their original behavior.
- Strict work/run/schema/amendment/frozen/accounting checks remain at their original logical positions in `src/panel/controlViews.ts`. Latest activity selects complete rows at maximum seq through run membership, and calls the original entry validator lazily after run authority checks (`src/control/activity.ts:77`). The independent group feed and summary timestamp reads remain separate.
- The optional core contexts are narrowly wired: only panel consumers supply same-store/group raw data (`src/panel/controlViews.ts:650`, `:1088`). `src/control/retryGrant.ts:36` retains lineage/source/claim/proof/pending/frozen checks and falls back to database reads for other contexts. D9 pre-evidence and in-transaction admissions still omit context (`src/control/settleUnknownUsage.ts:59`, `:68`), preserving writer revalidation and accounting.
- M6 uses the same synchronous group body at the former archive check, leaves blocker ordering intact, filters only valid archived start/no-start/resume wakes, and sends invalid/unknown data to the original authority. Local archive decisions clear after every entered handler, including false/throw, while malformed wake JSON without a handler does not invent an await boundary. The final claim transaction archive guard remains at `src/control/webDispatch.ts:219`; its deletion evidence shows incorrect wake acknowledgment, so the criterion is not protected solely by an earlier check.
- The benchmark measures real public entries against one valid, restored store and one fixed namespace: 100 live groups × 50 tasks, computed E=9,700, 100 displayed current runs, 100 valid archived groups and 300 pending archive wakes. One real transaction changes all 100 live groups for true incremental mode; full/forced/retention reset and empty incremental are separately asserted. Replenish actually arms one wake; mixed pump actually enters 99 live handlers and 198 probes. Provider accept remains zero in these dispatch workloads, explicitly disclosed.
- Measurement hooks retain the original store identity, install before first cached statement creation, classify raw-byte aliases without multiplying actual parse totals, and restore live cached methods before timing. Full row/rowid/sqlite_sequence restoration and the first-hook/restore/alias criteria have meaningful RED evidence. The original M5 parse assertions survive; Task 3's M5 edit only moves initialization into finally-protected scope.

## Spec compliance

**Production and measurement requirements: PASS. Final acceptance: one Important test portability gap remains.** The complete source supplement implements design §§3–7.2 and all three planned tasks without new indexes, migrations, provider policy, persistent business caches or product writers. Core behavior and measured equivalence are supported by the evidence below. The late namespace test, however, assumes an unstated checkout location and fails in a supported temporary clone workflow; spec silence does not make that test assumption acceptable.

No production or timing defect was found. The narrow later fixture setup guard is appropriate; the issue is how its negative test chooses its namespace.

## Issues

### Critical

None found.

### Important — I1: negative namespace test depends on checkout location

**File:** `tests/control/controlPollBenchmark.test.ts:52` and `:59`; related guard `tests/control/fixtures/controlPollPerformance.ts:25`.

The test called “refuses a nontemporary sandbox” creates its root with `mkdtemp(join(process.cwd(), ".orca-control-poll-sandbox-"))`, then unconditionally expects `control-poll-fixture-root-not-temporary`. A legitimate checkout beneath `/tmp` or `/private/tmp` makes that directory temporary by the guard's own definition. The namespace guard correctly accepts it; the sentinel then makes build reject with `control-poll-fixture-root-not-empty`, failing the test before its open-entry case. This breaks the normal test file in temporary checkouts, including the repository's established isolated local-clone workflow.

This is supported by the current source and the retained `benchmark-evidence/perf-task3-namespace-mutation-results.json`, whose two nonqualifying cases explicitly record the temporary-cwd oracle failure. `perf-task3-namespace-mutation-open-entry.log` fails at the unchanged build-entry expectation before reaching the mutated open guard. The later green outside-temp clone is valid proof for that environment; moving the proof clone does not fix the committed test's cwd dependency. The earlier green namespace-clone baseline belongs to the subsequently abandoned environment-based sandbox variant and must not be treated as current temporary-checkout coverage.

**Fix:** make the negative namespace premise independent of the checkout location, while preserving real build/open entry assertions and owned clone-local scratch data. One safe approach is an isolated test process with explicitly controlled temporary-root inputs, so an owned sandbox beneath that clone is provably outside every temporary root used by the guard. Do not redirect fault-injection writes into the shared worktree or the user's real data, and do not silently skip this criterion. Verify the focused integrity file in both a normal checkout and a temporary clone; repeat the two guard deletions only against the corrected criterion, with clean restored diffs. Product code, benchmark callbacks and historical timings need not change for this fix.

### Minor

1. `tests/bench/controlPollPerformance.ts:83`: orchestration, replay validation and report construction use very long compressed lines and broad `any` types. The current logic is inspectable and supported by evidence, but provenance changes will be harder to review safely. Format and extract typed replay/report helpers in a separate maintenance change, preserving measured behavior.
2. `benchmark-evidence/perf-task3-temp-namespace-green.log:4` and archived `logs/perf-final-web-build.log`: passing evidence includes SQLite experimental warnings, expected bundle diagnostics and the Vite bundle-size warning. These are disclosed runtime/build diagnostics, not hidden test failures. Keep raw historical logs unchanged; consider narrowing expected diagnostic noise at its source during later harness maintenance without suppressing unknown failures.

## Independent evidence checks and interpretation

Read RTK/CLAUDE, design through §7.2, complete plan/global constraints/progress/final input, all three complete task reports and reviews, benchmark/controller-gate reports, and every production/test hunk plus inventory in `review-source-1fd19a3..2a4f322.diff`. The large initial display was supplemented with contiguous bounded slices. The full package and archive were used for named evidence risks. Focused off-diff reads checked amendment behavior, default helper call sites, complete retry-source guards, D9 writer admission/transaction paths and final archive authority.

Read-only commands used `rtk proxy python3` with full-buffer JSON/gzip/tar reads, hashlib SHA256, and `/usr/bin/git show/diff/rev-parse`, plus `rtk proxy rg -n` for callers. Observed at fixed f76df58:

- HEAD equals the specified revision. `git diff 2a4f322 f76df58 -- src tests` is zero bytes, so the source supplement covers this final tree. `git diff 4fd2b26 f76df58 -- src` is zero bytes, so measured-after production is the final production. All tracked `.decisions` bytes equal the closed before revision.
- All **188** benchmark artifact lengths and SHA256 entries verify. All **402** gate/mutation archive members also verify against their complete manifest. Production source inventories independently match **242 before / 243 after** exact git blobs. Original tool hashes, source-manifest hashes, archived progress hashes and original harness hashes match the replay chain.
- Both original raw timing logs contain exactly **400 phase records, 300 samples and 10 summaries**. Each workload has warmup indices 1–10 and sample indices 1–30; all ordered raw vectors, min/max/nearest-rank p50/p95, output digests and recorded call counts match the adopted reports. These are artifact checks, not new timing runs.
- Complete before/after canonical output bytes are identical: **8,909,162 bytes**, ten workload outputs and 103 refusal results/errors. Runtime, namespace, initial state, scope, refusal digest and operational effect records also match. Both full operational effect reports have equal complete case objects, including whole-database digests and every changed row; replenish/archive/mixed change **1/0/99** rows. The effect validator captures all tables, rowids and sqlite_sequence, not only pending-count summaries.
- Original timed commands remain **before RC0 / after RC1**. The after failure occurs after all vectors on SQLite null-prototype versus JSON plain-object effect equality. The correction spreads every selected column, preserving values/body/business fields. Fresh separate replay/finalizer commands are RC0 and bind actual current entries to the historical observations and complete canonical outputs. Their full logs were read. This supports adopting the completed historical timings without relabeling the unsuccessful timed command or deleting fields. No hot callback changed.
- M5's 27 latest mutation records independently show RC1 and restored 0/0; the complete M6 orchestrator log records twelve separate RC1/0/0 cases. Reviewed task reports retain their complete guard matrices; targeted native logs for M3 context, D9 marker precedence and the final archive transaction were read. Current Task 3 namespace baseline/deletion logs were read completely; those prove the guards in the outside-temp clone but do not resolve I1.

Timing observations are bounded claims, not promises for all workloads. The archived-only p50 changes from **30.181 ms to 9.172 ms**, all-live changed incremental from **1694.121 ms to 1488.762 ms**, and all-live detail from **51572.124 ms to 48737.864 ms** (the benchmark report gives complete vectors and extrema). Empty incremental is essentially unchanged. Retained canonical/proposal/evidence queries dominate detail; drivers still scan groups, and archive filtering still reads/parses each archived group per synchronous segment. No whole-page two-query or zero-parse claim is justified.

## Gates, historical failures and revision limits

The full controller report was read; this review independently parsed the complete archived root JSON and checked its hashes. It does not claim to have reread every line of the two large raw root logs; their contiguous full-log audit remains attributed to `controller-gates-report.md`.

- Corrected root at **a241c919**: RC0, **371 physical files**, **3,503 passed / 0 failed / 4 skipped**. The formal control subset is **155 files, 1,733 passed / 0 failed / 3 skipped**. These are physical file/assertion counts, not nested-suite counts.
- Three default-pin root skips have a separate fully read RC0 gate with three actual passes. The fourth is real launchd smoke, still unexercised. Source/build/panel/scheduler results remain those attributed in the controller report; this review did not rerun them.
- The original root remains RC1 with **15 failures**: fourteen earlier instrumentation-category mismatches and one systemd timeout. The old four-worker verify:control requirementOverview timeout remains RC1, unregistered and unexempted. The later green run does not prove either timeout was a known flake.
- Ledger remains **RC2**, with seven historical Tier 0 downgrades; the ledger bytes are unchanged. It is not reported as RC0.
- Later **48a94bb** changes only setup namespace guards/imports and their negative test. The exact a241→f76 source/test diff confirms this two-file scope; product and measured benchmark are unchanged. Its current 46-test named gate, typecheck and four-test formal leak gate are RC0 in the main worktree environment, and their complete logs were read. A241 did not run that new criterion; I1 is a concrete uncovered environment failure in the post-gate delta.
- Earlier temporary-cwd mutation attempts and managed-worktree sandbox mutation writes remain nonqualifying and disclosed. The latter violated the clone-only fault-injection data boundary; tracked production and real user data were not changed. Later isolated valid proofs do not erase that process deviation.

## Declined to judge

- Eliminating remaining canonical/proposal/evidence N+1 reads or linear driver/pump scans: explicitly excluded from this round. Their actual remaining costs were judged for truthful reporting and are not hidden.
- Actual launchd installation/service restart behavior: its opt-in smoke was skipped and this round changes no service code. No launchd readiness claim is made.
- A root cause or permanent flake classification for the original systemd and historical four-worker requirementOverview timeouts: available evidence proves later passes, not causation. Their original failures remain visible and unexempted.
- Unrelated ccmem `config-value-parity` integration and other repositories' behavior: outside this performance diff and subject to separate human constraints. No merge or permission conclusion for that branch is implied.
- Exhaustive re-review of all unchanged pre-existing D9/M3 behavior: the closed baseline review remains its gate. This review did judge all changed adapters and their default writer/authority interactions; the benchmark covers its specified workloads, not every possible stored state.

## Assessment

**Spec: production/measurement PASS, final acceptance with I1 to fix.**

**Quality: With fixes. Ready to merge: No. 0 Critical / 1 Important / 2 Minor.**

The production optimization and rigorously bound measurement evidence are sound within their stated scope. Fix the checkout-dependent negative fixture criterion before declaring the round complete or integrating it. The required follow-up is narrow test/fixture validation; no performance source change, blanket suite rerun or remeasurement is justified solely by I1. Integration and three-repository handoffs remain controller-owned after that gate; this review performs no local-main merge or push.
