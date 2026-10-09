# Task 4 D9/M3 verification report

Owner: `/root/verify_usage_retry_round`, controller-dispatched sole coverage/verification writer. Date: 2026-10-09 Asia/Shanghai. Worktree: `/Users/biran/.codex/worktrees/usage-settlement-handoff-retry/Orca`; branch `codex/d9-m3-implementation`; BASE `ace22093d498eb155dda0b783ad43b3cdcf114f5`. Binding: design §9 including §9.5; latest Task2 Minor and Task4 migration rulings. No final whole-branch review claim; that and all three repository handoffs remain controller-owned.

## Coverage and directed evidence

Coverage commit `e7df5df89826e152590831fa8f86a894bf5c3d92` adds exactly `directly retries an active failed continuation from head` to the new-round `tests/control/handoffFailedRetry.test.ts`. A real synthetic-port run parks, resumes through a consumed continuation, fails while still active/continuing, and retries directly without a second handoff. After the actual command it checks ready/retrying/source, consumed registration removal, inactive settled-failed predecessor and retained historical identity, both allocation buckets, four-dimensional grant-minus-remainder commitment increase, unchanged used, normal next claim without another reservation, and actual accept policy clamp/frozen hash/moved group head/null checkpoint. The fixture does not seed its own final result. Existing assertions were unchanged by this commit.

`task4-coverage-initial` and `task4-coverage-committed`: each RC0, 1 file/19 tests, no skips. `task4-mutation-run` invokes `/private/tmp/od9/task4-mutation.py` using runner env, creates `/private/tmp/od9/task4-mutation` via `/usr/bin/git clone --local --no-hardlinks`, deletes only `|| allocations.some(a => a.state === "continuing")` from retrying admission, and restores in finally. `task4-mut-direct-continuing-red` RC1: the named business assertion lacks retryGrantSourceRunId, not a startup/import error; 18 unrelated tests intentionally skipped by `-t`. Restored full file `task4-mut-restored-green` RC0, 19/19 no skips. `/private/tmp/od9/task4-mutation-proof.json` records exact commands/commits and main/clone unstaged+cached diff all 0 bytes, equal source/test bytes. Main product code was never mutated.

## Named migration correction

First formal control run at e7df5df: RC1, 153 files, 1709 tests = 1701 passed/4 failed/4 skipped, duration 757.91 s. All four failures are exact schema-version assertions (10 received vs 9 expected); none is a timeout. Complete 178736-byte raw log `/private/tmp/od9/logs/task4-control.log` was read across 10 complete contiguous chunks, with SHA/chunk coverage proof. Failures:

- commandClient: `a fresh store has commands.client and is at the current version (9)`;
- commandClient: `a version-6 store upgrades, and a row written before keeps client null`;
- requirementRecords: `migrates a version-5 store by adding the two tables, leaving every existing row byte-identical`;
- shutdownHealing: `a stranded v8 store migrates, heals, renders a run with startedAt null, and then accepts start`.

Controller approved only final schema9→10 values, corresponding current-version title and appended dated comments. Commit `cc50570477ee20052cc8c39975112981aaa277dd` touches these three named files only. `/private/tmp/od9/task4-migration-assertion-proof.json` proves reversing the approved values/title and removing only dated corrections recovers every original byte, including old comments and all null client/old rows/null times/healing/start assertions. Directed 5files33 tests RC0: these three files + schema10 + handoffFailedRetry, no skips. Formal final control and full root are recorded separately below; original RC1 is not relabelled as 0.

## Isolated gates

All commands below use `rtk proxy python3 /private/tmp/od9/run.py <name> <command>`. Runner `/private/tmp/od9/env.json` relocates HOME, four XDG roots, TMPDIR, CCMEM_DATA_ROOT and corrections; fixed ORCA_CCLOOP_BIN=`/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js`, clone HEAD ab824d16004de2d3c1613a76ec0431520aa16cc9. `/private/tmp/od9/agents.json` installs fake codex in integration mode. No real control library, paid provider or real daemon run. Outer HOME guards concern isolated HOME, not a per-process audit of real user HOME. Full-root optional CLI vars are command-local, not env.json changes.

| Runner name / command | Observed commit/tree | Actual RC / result |
|---|---|---|
| `task4-web-build` / `npm run build --workspace web` | e7df5df | 0; bundle built; existing >500 kB warning |
| `task4-coverage-initial` / `node_modules/.bin/vitest run tests/control/handoffFailedRetry.test.ts --maxWorkers=2` | ace22093+test | 0; 1 file/19 passed, no skips; BASE+test overlay |
| `task4-coverage-committed` / `node_modules/.bin/vitest run tests/control/handoffFailedRetry.test.ts --maxWorkers=2` | e7df5df | 0; 1 file/19 passed, no skips |
| `task4-typecheck` / `npm run typecheck` | e7df5df | 0; root tsc passed |
| `task4-build` / `npm run build` | e7df5df | 0; root build passed |
| `task4-mutation-run` / `python3 /private/tmp/od9/task4-mutation.py` | e7df5df | 0; independent arm RED1/restored GREEN0; full restore 19/19 |
| `task4-migration-directed` / `env FORCE_COLOR=0 node_modules/.bin/vitest run tests/control/commandClient.test.ts tests/control/requirementRecords.test.ts tests/control/shutdownHealing.test.ts tests/control/schema10.test.ts tests/control/handoffFailedRetry.test.ts --maxWorkers=2 --reporter=dot` | e7df5df+approved tests | 0; 5files33 passed, no skips; e7df5df + approved test overlay |
| `task4-control` / `npm run verify:control` | e7df5df | 1; 153 files;1701 passed/4 schema failures/4 skips;757.91 s |
| `task4-control-final` / `env FORCE_COLOR=0 npm run verify:control` | cc50570 | 1; 153 files;1704 passed/1 unregistered timeout/4 skips;568.77 s |
| `task4-overview-diagnostic` / `env NO_COLOR=1 node_modules/.bin/vitest run tests/control/requirementOverview.test.ts --maxWorkers=1 --reporter=dot` | cc50570 | 0; 1file22 passed;10.00 s, no skips; observed load 8.90 |
| `task4-scheduler` / `env NO_COLOR=1 npm run verify:scheduler` | cc50570 | 0; 56files202 passed, no skips |
| `task4-pin` / `env NO_COLOR=1 npm run verify:ccloop-pin` | cc50570 | 0; inner 0,3 passed/0 skipped |
| `task4-panel` / `env NO_COLOR=1 npm run verify:panel` | cc50570 | 0; PASS steps 0–14 and teardown; isolated HOME guard |
| `task4-root-test` / `env NO_COLOR=1 ORCA_SYNCSKILL_REAL_BIN=/Users/biran/code/skills/syncskill/dist/index.js ORCA_CCMEM_REAL_BIN=/Users/biran/code/skills/ccmem/bin/ccmem npm test -- --maxWorkers=2 --reporter=dot --reporter=json --outputFile.json=/private/tmp/od9/task4-root-results.json` | cc50570 | 0; 368files3462 tests:3458 passed/0 failed/4 skipped;1155.98 s |
| `task4-leak` / `env NO_COLOR=1 node scripts/check-tmp-leak.mjs tests/control/settleUnknownUsage.test.ts tests/control/handoffFailedRetry.test.ts tests/panel/settleUnknownUsage.test.ts --maxWorkers=2` | cc50570 | 0; inner 0,58 tests,0 entries; outer 0 |
| `task4-ledger` / `npm run ledger -- validate .decisions` | e7df5df | 2; 7 historical downgrades; package.verify explicitly accepts 2 |
| `task4-ledger-baseline` / `python3 /private/tmp/od9/task4-ledger-baseline.py` | e7df5df | 0; old/current/working blob 11172 bytes equal |
| `task4-ledger-baseline-validate` / `npm run ledger -- validate /private/tmp/od9/baseline-ledger` | e7df5df | 2; same 7diagnostics and RC2 on scratch baseline copy |
| `task4-claude-md` / `node scripts/check-claude-md-lines.mjs` | e7df5df | 0; 150/200 lines |
| `task4-hooks-path` / `node scripts/check-hooks-path.mjs` | e7df5df | 0; scripts/githooks; retained Xcode cache/FSEvent diagnostic |
| `task4-formal-flag-chain` / `python3 /private/tmp/od9/task4-formal-flag.py` | cc50570 | 0; main only fail-fast consumer; fixed clone no consumer |

Every row has full raw `/private/tmp/od9/logs/<runner-name>.log` and paired `.rc`; exact argv additionally in `/private/tmp/od9/task4-command-manifest.json`. The mutation inner logs/RCs and exact clone cwd are in its proof. No raw output was grep/tail/head/sed-filtered. Initial overlarge displays were re-read as complete contiguous chunks, including every final byte.

Formal coverage refinement: controller accepted the already-started full-root run without ORCA_CONTROL_VERIFY=1. Exact source search finds only the ccloopProtocol integration test consumer; it merely fails fast when binary/table are missing, and both valid variables are present here. Fixed ccloop clone src/tests contain no consumer (task4-formal-flag-chain RC0, internal rg1=no matches). Full-root JSON confirms all three protocol cases passed, all 153 control files/1709 cases present (1706 passed/3default-pin skips). The four-worker formal wrapper retains its own RC1/timeout, not a passing-wrapper claim. No second full-root run is authorized by this refinement.

Web full check is reused from Task3 `task3-check-final`: RC0, 90files729 tests and tsc. Final web bytes are identical to aa03c91994d660ce765910fdbbc34372b505f0de (`git diff aa03c91 -- web`=0); this coverage/migration addition changes backend tests only. No redundant full web or closed issue-fixes gate rerun was performed. Real ccloop test runs use fake agents; no paid acceptance claim.

## Ledger, pin, and historical evidence

Ledger validation is RC2, explicitly accepted by package.json's verify command. Seven unchanged historical bound records in `.decisions/orca-dev-09cc3ea1.jsonl` lines8–14 lack taskId/runId and are downgraded to tier0. Read-only c29676d blob, current HEAD blob and working file match 11172 bytes/SHA256 `c0bd54fc00e62190b8a819636213091bcfe538a37a81fd8bce0170b7dfc41cda`. Scratch-copy baseline validation also returns2 and the complete seven diagnostic lines are identical after only explicit scratch-path-prefix normalization. Logs `task4-ledger`, `task4-ledger-baseline`, `task4-ledger-baseline-validate` and paired real rc files retained. No old data fix and no RC0 claim.

Installed `node_modules/.package-lock.json` resolves ccloop at exact ab824d1; installed path is `/Users/biran/code/skills/loop/Orca/node_modules/ccloop`. Package/package-lock/product source remain unchanged from BASE. Prior Task1/Task2/Task3 reports and fresh reviews preserve 21/16/12 independent business deletion reds and restored greens; no old issue-fixes mutations rerun. `/private/tmp/od9/task4-prior-mutation-code-audit.json` mechanically maps all their deletion targets to final source; all fragments present (including exact D9 zero-token guard rather than previously excluded wrong-target mutant). Task2 source/pending/clear/clamp and Task3 authority/amount/Continue/retry guards remain present. Web same-source proof and final root guards cover integrated consumption.

Final `/private/tmp/od9/task4-final-byte-proof.json`, observed cc50570, measures source/scripts/web/skills/package diff against BASE 0 bytes; owned test unstaged 0 bytes; full index 0 bytes; clone unstaged/cached0 bytes and exact retryTask source/new test bytes equal. All 123 historical issue-fixes paths have BASE diff 0 bytes; old progress ledger SHA256 `8dd6e35cc489153c7d33726798c3fd65ead5f362d0c51fc7f3453bf29dbbd045` is unchanged. Only the three approved migration files and controller-owned current progress differ from the coverage preflight; no source drift. `web` diff vs aa03c91 remains 0 bytes. Controller progress, performance docs and node_modules are excluded from every stage.

Raw read proof: original control 178736 bytes/10 chunks, final wrapper 171823 bytes/10 chunks, scheduler 32184 bytes/2 chunks, root 108390 bytes/7 chunks. Each complete range has SHA256 and chunk hashes in `/private/tmp/od9/task4-log-read-proof.json`. All shorter Task4 logs and paired RC files were read entire. Final root JSON is `/private/tmp/od9/task4-root-results.json`; exact protocol/realCLI statuses are copied to `/private/tmp/od9/task4-root-summary.json`.

## Remaining concerns and exact skips

Status: DONE_WITH_CONCERNS. Final formal four-worker control wrapper actually returned 1 for `requirementOverview` / `reaches structure status failed and still gives an overview`: Test timed out in 5000 ms, observed 5005 ms. It is NOT on the registered flake list, was not registered/exempted, and its timeout/assertion was unchanged. Original full wrapper at e7df5df passed that file; final single-worker diagnostic at load 8.90 passed 22/22 but does not constitute low-load evidence. Same committed tree's two-worker full root passed 22/22, including this exact case at730.233 ms. Controller accepts that root's equivalent all-control business coverage after the formal-flag consumer audit; the raw failed wrapper remains failed. No third control wrapper or second full-root run was performed.

Final wrapper skips: driverSkillsReal 1 (real CLI env absent when it started), default ccloop 3. Full root enables both command-local REAL_BIN variables and really passes driverSkillsReal 1, skills/syncskillReal 1 and memory/ccmemReal 1; no provider or daemon action. Full root's four skips are exactly default ccloop 3, separately executed 3/3 by pin gate, and `tests/service/realSmoke.test.ts` / opt-in real launchd lifecycle 1, intentionally not run under the no-real-daemon boundary. No other skip/failed/todo test exists in its JSON. Root success=true/failed=0/RC0.

`uptime` measurement commands are `rtk proxy python3 /private/tmp/od9/run.py <name> uptime`, each RC0 with full log+paired RC: task4-control-uptime19:01=7.62/5.04/4.69; task4-control-late-uptime19:10=5.54/6.15/5.63; task4-control-final-uptime19:17=6.48/6.30/5.84; task4-overview-uptime19:26=8.90/8.78/7.33; task4-root-uptime19:28=5.55/7.73/7.16; task4-root-mid-uptime19:39=7.07/6.90/6.91. These are observations before/during/after their named runs, not fabricated exact failure-time loads. Build's existing chunk warning, Node22 SQLite experimental warnings, fixture rejection/crash diagnostics, Xcode cache/FSEvent hints and ledger2 are retained; this is not an all-warning-free claim.

## Self-review and boundary

No product changes were needed. Coverage explicitly separates initial active continuing binding from subsequent already-retrying source refresh, tests both buckets/all four commitment dimensions, and measures actual port.accept rather than only a reader. Only the four controller-authorized migration expectations moved; no timeout/old business assertion relaxed. Raw wrapper output and actual rc files are read whole or by contiguous complete chunks; `/private/tmp/od9/task4-log-read-proof.json` records byte/SHA/chunk coverage. `check-tmp-leak` must show inner vitest 0 and 0 entries, not merely outer 0. Final report preserves all failures/skips/warnings and excludes a new flake declaration. Cost/token totals unavailable; no estimates.

Whole-branch fresh review, performance implementation, final ledger/three compact handoffs and human summary are controller-owned. No spawn-agent, push, merge, branch/worktree deletion, dependency stage or other-repository product write.

## Persisted proof supplement

Owner verify_usage_retry_round, 2026-10-09; observed product cc50570, report commit ea7ce0d. `task-4-verification-proof.json` preserves compact gate counts, exact actual protocol/real-CLI outcomes, skip names, wrapper concerns, clone/migration/source restoration, pin and complete raw-read hashes. Root owns subsequent raw-log packaging; this supplement introduces no new test run.
