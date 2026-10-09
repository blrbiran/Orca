# Task 2 implementation report

Ownership: Codex `implement_archived_wakes`, 2026-10-09 (Asia/Shanghai), branch `codex/d9-m3-implementation`. Observed implementation baseline: `63d9e9bf15510269eb9d8670c73a751ac8480dd8` (`rtk proxy /usr/bin/git rev-parse HEAD`). This new report is committed with its owned implementation; existing specs, ledgers, named regression assertions/timeouts, Schema 10 and D9/M3 proof/source guards were untouched.

## Change and self-review

`replenishStartWakes` passes its original synchronous parsed group body to the new optional third `nextClaimableTask` parameter, exactly where the old archive read occurred. Default callers retain the old database reader; strict `archivedMarkOf` validation remains. Dispatchable/stopped/blocker/wake/last-start refusal order stays in place.

`deliverSchedulerWakes` keeps global blocker, missing handler and group blocker first. Only start/no-start/resume with a valid archived mark are deferred before wake decoding or handler/probe/accept. Invalid marks or malformed group JSON become `unknown` and continue into original authorities. A store-bound WeakMap owns only the prepared group lookup. Parsed archive state is local to one pump, is discarded after every entered handler's true/false/throw outcome, and survives a malformed wake that never enters a handler or awaits. The final claim transaction archive check is unchanged.

Self-review checked same-group/current-synchronous-body use, rowid result order, acknowledgement location, exception isolation, default readers, absent archive marks, strict error code/detail, unarchive next pump, archive/unarchive after await, archive during probe and store isolation. No product writer, schema or cross-request business cache was added.

## Runtime and scope

Controller-provided runtime: `rtk proxy python3 /private/tmp/od9/run.py <log-name> <command...>`. `/private/tmp/od9/env.json` redirects HOME, four XDG roots, TMPDIR, CCMEM_DATA_ROOT and ORCA_CORRECTIONS_DIR to isolated `/private/tmp/od9` paths, with no real CCMEM_CONFIG/provider key. `ORCA_CCLOOP_BIN=/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js` pins detached `ab824d16004de2d3c1613a76ec0431520aa16cc9`; fake integration agents table is `/private/tmp/od9/agents.json`. No real daemon/service/provider ran. The first sandbox attempt failed in openControlStore's read-only `ps` check (`spawnSync ps EPERM`); subsequent authorized runs used require_escalated with the same isolated data.

`perf-task2-runtime` ran `node --input-type=module -e 'import {DatabaseSync} from "node:sqlite"; const db=new DatabaseSync(":memory:"); console.log(JSON.stringify({node:process.version,sqlite:db.prepare("SELECT sqlite_version() AS version").get().version})); db.close();'`: RC 0, Node `v22.13.1`, SQLite `3.47.2`. `rtk proxy uptime` during final-source review reported `21:16  47 users, load averages: 3.59 4.14 4.04`. Node's standard experimental SQLite warning was present.

## TDD and final gates

All logs and adjacent `.rc` files are under `/private/tmp/od9/logs/`; each validation output was redirected then read in full, without filtering. Main-worktree validation observed baseline HEAD plus exactly the five owned source/test diffs (node_modules remained untracked).

- `perf-task2-red-final`: `npx vitest run tests/control/archivedWakePerformance.test.ts`, RC 1, 10 failed/11 passed, reported 2.54s. Driver parsed group twice instead of once; the 100-group/300-wake pump entered 300 real handlers instead of zero. Before this final RED, a new requirement expectation was corrected to its measured existing refusal and array marks were wrapped as table values so `[]` was actually tested.
- `perf-task2-named-final`: `npx vitest run tests/control/archivedWakePerformance.test.ts tests/control/archiveGroup.test.ts tests/control/webDispatch.test.ts tests/control/dispatch.test.ts tests/control/driverRoundIsolation.test.ts tests/control/driverContinuation.test.ts`, RC 0, 6 files/116 tests passed, zero skipped, reported 18.99s. New file contains 24 tests. An earlier named run failed only the new mixed-pump measurement (4 actual reads vs an incorrectly predicted 3); its expectation/comment were corrected after reading the unchanged estimate authority, with no product or old-test changes.
- `perf-task2-typecheck-final`: `npm run typecheck`, RC 0.
- `rtk proxy /usr/bin/git diff --check`, RC 0.

Counts are direct SQL/JSON instrumentation through the original ControlStore identity, installed before the first measured pump so cached statement executions remain visible. Raw identical bytes share one alias bucket; unique group fixture bytes support per-group assertions.

## Proven bounds and remaining work

The started, dispatchable driver entry arms `drive:g:1` with one group parse and zero additional `SELECT body FROM groups WHERE id=?` executions. The pending-wake and archived no-arm results retain one parse and zero extra archive lookups. Optional-body and default entry results match; the default still reads its group once.

For 100 groups archived through real archive commands, three wakes each, all three consecutive pumps return the original rowid ordered 300 deferred IDs, with delivered/probe/accept/handler counts zero. Each pump performs 100 group lookups and one parse per group. The archive lookup prepares once on the first pump and zero times on later pumps; cached executions still count. A malformed wake between archived siblings has no handler/await and retains one filter lookup/parse. One real archived estimate handler await splits the group into two synchronous segments: two filter lookups/parses plus two unchanged estimate-authority group reads/parses = four total; first mixed pump prepares that SQL three times (one cached filter statement plus two authority prepares).

Remaining costs are explicit: replenish still scans and parses all groups, and the pump still scans pending wake rows and checks group blockers per eligible wake. The filter has O(distinct eligible groups) reads/parses per synchronous segment, including O(archived groups) work in archived-only pumps; mixed handlers can require a new read/parse after every await. This is not a SQL prefilter or zero-parse claim. Full before/after timing and normalized-output equivalence, the performance benchmark and full round gates belong to controller Task 3 and were not repeated here.

## Independent mutations

Created only `/private/tmp/od9/performance-task2-mutation` using `rtk proxy /usr/bin/git clone --local --no-hardlinks /Users/biran/.codex/worktrees/usage-settlement-handoff-retry/Orca /private/tmp/od9/performance-task2-mutation`. Final owned files were copied and locally snapshotted as `b00dedf43afaeb7d041fa7b7ea22706e88da57a9`; node_modules links to the installed workspace dependency tree. No mutations touched the shared implementation.

Command: `rtk proxy python3 /private/tmp/od9/task2_mutations.py all > /private/tmp/od9/logs/perf-task2-mutations.log 2>&1` (or the script with one name). It uses the exact isolated environment above and invokes `npx vitest run tests/control/archivedWakePerformance.test.ts -t <criterion>` from the clone, with each full output in `perf-task2-mutation-<name>.log`. All twelve individual RC files read `1`; every mutation restore measured `git diff` and `git diff --cached` as zero bytes. Targeted `-t` mutation runs deliberately select named criteria; normal gates have no skips.

| Mutation | Observed business RED |
| --- | --- |
| filter removed | 300 real handler entries instead of 0 |
| invalid/JSON unknown filtered as archived | all five invalid marks and bad JSON stop reaching actual authority |
| business map retained across pumps | first pump after real unarchive stays deferred |
| map not cleared after handler await | all six true/false/throw archive/unarchive cases fail |
| final transaction archive guard removed | archive-during-probe wake incorrectly acknowledged |
| driver body argument removed | group parses become 2 instead of 1 |
| optional body ignored | extra group lookup becomes 1 instead of 0 |
| synchronous map reuse removed | group lookups become 300 instead of 100 |
| prepared statement reuse removed | prepares become 100 instead of 1 |
| kind filter broadened | estimate/requirement authority entries become 0 instead of 2 |
| map cleared without entering a handler | malformed wake splits a synchronous segment, 2 lookups instead of 1 |
| prepared lookup shared across stores | live second store is incorrectly deferred by first store's archived row |

Restored clone ran the full new test file: `perf-task2-clone-restored`, RC 0, 24/24 passed, zero skipped, reported 2.65s. A byte comparison of each final owned file against the clone succeeded; final source SHA256 values were measured by the same Python verification:

| File | SHA256 |
| --- | --- |
| src/control/dispatch.ts | a3d0d6551ab0f9afa229a68d4e247b48a99b31e027ab94c8992382027728ebd9 |
| src/control/executionDriver.ts | bfb3d7b57535d6e421c69a40a596824789b9d69eed520ed6b4b504251b9816aa |
| src/control/webDispatch.ts | 58f2be5cf6417a2293c7d9c3f79511bb17b8ac9251757bf8a0ee15ee7c0cb208 |
| tests/control/fixtures/controlReadCounters.ts | 3df3c75abe83f8e33b926ca26c484b73528b6c36acf42e2c48e36998a7a4e955 |
| tests/control/archivedWakePerformance.test.ts | 395a1646d275ab0c4897f34ec61f77c0ba424b444fd70447f0bf74a3d4204808 |

No unresolved Task 2 correctness concerns. Local implementation commit only; no push/merge/branch/worktree removal.
