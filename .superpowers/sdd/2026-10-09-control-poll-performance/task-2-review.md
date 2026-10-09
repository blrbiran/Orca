# Task 2 independent review

## Spec Compliance

- ✅ **Spec compliance verdict: Spec compliant.** The fixed review package is BASE `63d9e9bf15510269eb9d8670c73a751ac8480dd8` → HEAD `5f0f5ee6d43328e345fc3aad3ba4ce090c9e5975`. The requested three production files, new entry-point test file, and counter fixture all have corresponding hunks. No unrelated product writer, schema migration, dispatch policy, or persistent business cache was added.
- Ownership: Codex fresh independent reviewer `review_archived_wakes_task`, 2026-10-09 (Asia/Shanghai). This new review is attributed to the fixed HEAD above; source and existing evidence were read-only. Requirements reviewed: task-2-brief.md, global-constraints.md, implementation report, and design through appended §7.2.
- `src/control/executionDriver.ts:802,808`: the already parsed body for the same row/group is passed at the original next-claimable position. Plan/status/stopped, stop intent, group blocker, pending wake and last-start short circuits retain their order; no await intervenes. `src/control/webDispatch.ts:306,309` adds the specified optional unknown body and treats undefined exactly as the old database reader; supplied bodies still use strict archivedMarkOf.
- `src/control/dispatch.ts:105,112,113,123,132`: rowid ordering, global blocker → missing handler → group blocker priority, eligible kinds (start/no-start/resume), pending deferral, and the original acknowledgment location are preserved. Estimate/requirement kinds keep their original paths.
- `src/control/dispatch.ts:119,120,123` uses the existing archive semantics and filters only literal true. Bad JSON or invalid marks become unknown and continue to the existing handler; absent rows/marks produce false. `src/control/archivedMark.ts:14,17,23` confirms strict mark validation and the same absent-row behavior as isGroupArchived. `tests/control/archivedWakePerformance.test.ts:217,231` asserts actual authority entries, pending wakes and direct error behavior for invalid marks and bad JSON.
- `src/control/dispatch.ts:97,108,117,130`: only a prepared statement lives in the store-keyed WeakMap. Mutable archive judgments are pump-local and cleared in finally after every entered handler, including true/false/throw. Wake decoding failure leaves the synchronous segment intact because no handler was entered. `tests/control/archivedWakePerformance.test.ts:114,154,168,186,243` verifies malformed-wake reuse, next-pump freshness, all awaited outcomes and store separation.
- `src/control/webDispatch.ts:199,208,214,219`: the existing pre-probe archive check and final transaction check remain. `tests/control/archivedWakePerformance.test.ts:203,209,211` checks archive during probe, no active claim, and unconsumed wakes. The isolated transaction-guard deletion log confirms the criterion turns red on incorrect acknowledgment rather than being protected solely by the earlier guard.
- ⚠️ Round-wide timing, normalized before/after output equivalence and full-round gates are outside this task diff and remain Task 3/controller obligations, as explicitly recorded at task-2-report.md:37. This is a Task 2 gate, not approval of the whole performance round.

## Strengths

- `tests/control/archivedWakePerformance.test.ts:64,93,133` exercises real service/handler entry points, durable wake results and measured reads/parses: 100 legally archived groups across three pumps, compatible default/body readers, and four actual mixed-pump reads/parses (two filter plus two unchanged estimate-authority reads). The tests avoid claiming all SQL or JSON work disappears.
- `tests/control/fixtures/controlReadCounters.ts:23,35,49,57`: group bytes are added to the existing raw-byte alias collector; DB/statement methods are wrapped in place, cached executions remain observable, reset collection uses the original prepare, and restore restores patched methods. The original ControlStore identity is retained.
- `tests/control/archivedWakePerformance.test.ts:168,186,255,271` pins true/false/throw freshness, blocker priority and unchanged non-start handling. The production implementation is a small local change with no separate invalidation protocol or duplicated archive schema.

## Issues

### Critical (Must Fix)

- None found.

### Important (Should Fix)

- None found.

### Minor (Nice to Have)

- `/private/tmp/od9/logs/perf-task2-named-final.log:4` (also lines 6, 8, 10, 12, 14) contains Node experimental SQLite warnings; lines 28 and 33–35 contain bundle verification informational output. The test output is therefore not pristine. These are visible runtime/tool diagnostics rather than a new Task 2 correctness failure, and the implementation report already discloses the SQLite warning at task-2-report.md:19. Retain that disclosure in the controller's final evidence; any cleanup should be a separate harness concern, without filtering validation output.

## Checks and evidence

- Read the supplied review package; the tool truncated a small middle portion, so recovered only the missing package slices. No git command or suite was re-run. Source line references above were measured from package hunk positions; focused unchanged-code references were measured using numbered Python reads.
- Named risk: strict archive semantics could drift from the existing authority. Focused check: read src/control/archivedMark.ts. Result: the filter calls exactly the same archivedMarkOf/JSON.parse composition as isGroupArchived.
- Named risk: a new optional API/body cache could bypass an awaited final claim authority or affect unrelated callers. Focused check: searched nextClaimableTask/isGroupArchived/deliverScheduledStart/createWebWakeHandlers in webDispatch/executionDriver, then read the final transaction and handler aliases. Result: only replenish supplies a body; live authority calls retain default database reads and the final transaction guard. The execution-driver hunk was cut off before its group scan, so read its function opening to verify synchronous same-row provenance.
- Named risk: fixture extension could undercount cached executions or change store identity. The fixture hunk was cut off mid-function; read the complete helper once. Result: group collection extends the existing in-place wrapper without replacing the store or cache identity.
- Read complete `/private/tmp/od9/logs/perf-task2-named-final.log` and `.rc`: RC 0, 6 files/116 tests passed, no skipped tests reported. Read complete typecheck log and `.rc`: RC 0. These existing runs correspond to the implementer's precommit owned files recorded in task-2-report.md:23–27 and its final hashes at lines 63–67; no new test run was needed to resolve a specific code doubt.
- Read complete `/private/tmp/od9/logs/perf-task2-mutations.log`: all twelve mutation invocations report RC 1 and each restoration reports unstaged/staged diff bytes 0, at isolated clone commit `b00dedf43afaeb7d041fa7b7ea22706e88da57a9`. Read the complete transaction mutation log: deletion produces delivered `[scheduler-wake:g:3]` instead of deferred, failing the expected business assertion at test line 209. Targeted mutation skips are selection skips, distinct from the full normal gate.

## Assessment

**Code quality verdict / Task quality: Approved.**

The implementation preserves the original authorities and ordering while bounding archive work per store and synchronous segment. Tests and the visible mutation evidence cover the failure boundaries that make this optimization safe; the only concern is disclosed diagnostic noise in existing validation output, which does not block this task.

## Reference correction — reviewer, 2026-10-09, fixed HEAD 5f0f5ee

- Ownership: Codex `review_archived_wakes_task`. A final numbered read measured the implementation-report references using `rtk proxy python3` with `Path.read_text().splitlines()` and `enumerate(..., 1)`. The warning disclosure cited above as task-2-report.md:19 is at **task-2-report.md:17**. The Task 3 boundary cited above as task-2-report.md:37 is at **task-2-report.md:36**. The source/test references and both verdicts are unchanged. Original review text is preserved under repository Rule 13.
