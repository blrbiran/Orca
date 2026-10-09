# Task 1 fresh review — Spec ✅ / Task quality Approved

Owner: Codex `/root/review_batch_views_task`, 2026-10-09 Asia/Shanghai. Task-scoped M5 gate only. Reviewed supplied package `review-1fd19a3..deaae38.diff`, BASE `1fd19a3d49778d0809f96af49a7ef51647a6c0fe`, HEAD `deaae382ff2c72af4e9c41ec5b9b6c8a6b4ec851`; latest product `9092f6beba51d178df556527e978207ad4084d36`. Bindings: task brief, global constraints, design §3/§7–7.2 and controller rulings in performance progress. Historical report is interpreted using its appended late correction.

## Spec Compliance

- ✅ The requested files and approved extra core readers are present; the package changes no existing regression test. Work/run SQL is group-scoped, statement caches are store-keyed, decoded values/errors are request-local, and unused bodies remain lazy (`src/panel/groupReadSnapshot.ts:17`, `:18`, `:32`). Public summary/group/evidence signatures remain unchanged (`src/panel/controlViews.ts:373`, `:885`, `:1033`).
- ✅ Summary completion/category catch boundaries remain lenient, while strict wrappers retain schema error detail and authority checks (`src/panel/controlViews.ts:217`, `:223`, `:304`, `:321`, `:649`). Group detail shares one snapshot with effective tasks, embedded summary, work/run/continuability and manual handoff settlement; rowid lineage and id display remain distinct (`:661`, `:758`, `:861`, `:892`).
- ✅ Latest activity selects full rows at maximum seq through runs membership and defers `entryOf` until each run has passed identity/profile/settlement checks (`src/control/activity.ts:77`, `src/panel/controlViews.ts:762`, `:845`). Clock rollback, null/retention, foreign activity ownership and refusal precedence are asserted in `tests/panel/controlPollPerformance.test.ts:205`, `:223`.
- ✅ M3 context is core-defined, accepts only matching store/group, filters task rows without changing rowid order, and retains source, claim, pending-usage, lineage, frozen-agent and no-provider guards (`src/control/retryGrant.ts:14`, `:36`, `:42`, `:58`, `:68`). D9 reads raw snapshot work at the former read position and retains default database reads and admission order (`src/control/settleUnknownUsage.ts:19`, `:25`; `src/panel/controlViews.ts:1088`). Real M3/D9 entry criteria and foreign-context fallback checks are at `tests/panel/controlPollPerformance.test.ts:247`, `:277`.
- ✅ Converted requirements use the private context only for non-clarifying summaries, filter active rows in rowid order, and rethrow the stored SyntaxError at the old read position; public two-argument/default behavior remains (`src/panel/controlViews.ts:342`, `:354`, `:395`, `:412`). The real conversion test checks active corruption class/message before detail validation and inactive-history laziness (`tests/panel/controlPollPerformance.test.ts:325`, `:349`, `:359`).
- ✅ Counters retain the original ControlStore and wrap bound statement methods so cached executions remain visible; one parse increments one raw-byte bucket regardless of alias multiplicity (`tests/control/fixtures/controlReadCounters.ts:12`, `:30`, `:45`, `:52`). Reuse/freshness/store/reopen and alias tests exercise those promises (`tests/panel/controlPollPerformance.test.ts:84`, `:143`, `:310`).
- ⚠️ Whole before/after output/refusal equivalence and the 100-group timing workloads cannot be certified from this Task 1 diff. In the 10/50 tests, full DTO equality compares repeated calls of the same implementation (`tests/panel/controlPollPerformance.test.ts:73`, `:78`); independently pinned fields, unchanged regressions and mutation checks provide task-level semantic evidence, not a complete old/new oracle. Task 3 must still supply its independently executed baseline digest and benchmark. The report correctly leaves that gate pending (`task-1-report.md:157`).

## Strengths

- Raw decoding is separated from validation rather than treating a cache hit as authority. Original strict checks and error precedence survive the reader substitution, including D9/M3 and converted-requirement edge paths (`src/panel/controlViews.ts:223`, `:649`, `:767`; `src/control/retryGrant.ts:42`).
- Tests measure real public readers and writes, not mock query counts, and explicitly distinguish request freshness from statement reuse (`tests/panel/controlPollPerformance.test.ts:70`, `:84`, `:205`). The alias criterion checks actual parse total as well as the shared bucket (`:310`).
- Evidence claims preserve the performance boundary. Latest complete test output records summary/group target executions 2/3, with 50-task detail still 3,044 total SQL executions and 2,856 canonical body gets (`/private/tmp/od9/logs/perf-task1-latest-commit-tests.log:12`). The report does not claim a whole-page 2/3-query result or elapsed-time speedup.

## Issues

### Critical

None found.

### Important

None found.

### Minor

1. `tests/panel/controlPollPerformance.test.ts:73`: the two initial view calls and expectations run after installing the global JSON.parse/db hooks but before entering `try/finally` at line 76. A regression in either initial reader or assertion skips `counter.restore()` and fixture disposal, leaving hooks installed for subsequent tests in this file. Start the `try` immediately after installation and keep initial expected-value reads inside it. This does not invalidate the observed successful gates, but makes future failures less isolated.
2. `/private/tmp/od9/logs/perf-task1-latest-commit-tests.log:4` and `/private/tmp/od9/logs/perf-task1-final.log:55`: green output is not pristine. It includes Node's SQLite ExperimentalWarning, and the earlier regression gate also includes successful Git bundle verification output. These are identifiable runtime/subprocess messages, not assertion failures; record their provenance in acceptance notes or capture expected subprocess chatter narrowly when maintaining that harness. Do not describe these logs as warning-free or blanket-suppress unknown errors.

## Checks and Evidence

- Read the supplied U10 diff in bounded sections. One oversized initial display truncated; unread sections were retrieved before judgment. No implementation changes, git state changes, suite reruns or diagnostic mutations were made by this review.
- Named off-diff risk checks only: inspected `workBodyOf`/`effectivePlanTask` (`src/control/taskAmendments.ts:56`, `:69`) to confirm the former lenient raw-body contract and no raw mutation; inspected `compareText` (`src/control/webProtocol.ts:23`) for display ordering; searched the two changed core helper call sites to confirm writer/driver callers still omit context (`src/control/retryTask.ts:112`, `src/control/webDispatch.ts:333`, `:386`, `src/control/executionSnapshot.ts:326`, `src/control/settleUnknownUsage.ts:59`, `:68`). Filled cut-off workViews/runViews/retryGrant guard context from the corresponding source ranges only.
- Fully read existing `perf-task1-red-count.log`, `perf-task1-final.log`, `perf-task1-late-regression.log`, `perf-task1-latest-commit-tests.log`, and `perf-task1-latest-commit-typecheck.log` using `rtk proxy cat`. RED is actual public-reader point gets 19/99 versus zero, not a missing helper. Green logs show the historical 112-test gate, overlapping late 127-test gate, final 18 new tests, and clean typecheck output. Counts are not added; final new-test result is 18, not 17.
- Read all 27 **late-prefixed** mutation logs and diffs in bounded complete batches with `rtk proxy python3`, plus `perf-task1-late-mutation-results.json` and `perf-task1-late-restore-proof.json`. Each recorded run has rc=1 with an actual named business/count assertion or expected-refusal difference; each recorded restoration is unstaged/staged 0/0 bytes. The old 24 and latest 27 are successive evidence sets, not 51 distinct final guards. Mutation `-t` skips are intentional selection, separate from unskipped full green gates.
- Read-only Python SHA-256/byte comparisons at the reviewed tree confirm all five current product files match the late restoration proof and isolated clone, and both final new test files equal the clone's tests. The historical report's first 18,901 bytes hash to `402e85a8033e0d8126243c9f9feb43f589d771676e45feaa04b62e3f9a556c60`, matching the recorded pre-append prefix. Commands used `rtk proxy python3` with `Path.read_bytes()`, `hashlib.sha256()` and byte equality; no regeneration or mutation of evidence.

## Assessment

**Task quality: Approved.** No blocking source or spec defect found. The request-local reader substitutions and targeted guards are supported by the final-code evidence; the two Minor items concern failure cleanup and log clarity. Integrated equivalence, actual timings and whole-round completion remain outside this gate.

## Citation correction — same reviewer, 2026-10-09, reviewed HEAD deaae382

The bundle-output citation in Minor 2 is `/private/tmp/od9/logs/perf-task1-final.log:43` (also lines 44, 45, 51, 79 and 88), not line 55. Measured by read-only `rtk proxy python3` enumerating the existing complete log lines. The SQLite warning citation at latest-commit-tests.log:4 and count observation at :12 are confirmed. Findings and verdict are unchanged.
