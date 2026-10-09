# Controller gates report — control poll performance

Owner: audit_performance_gates for controller / usage-settlement-handoff-retry session. Date: 2026-10-09 Asia/Shanghai. Observed production commit: `5f0f5ee6d43328e345fc3aad3ba4ce090c9e5975`. Historical gate launch checkout: `4fd2b266006c90fd5084b750a4e63c587451f69d` plus changing Task3 test overlay. Audit checkout: `73ac720c92b1488c00b9127fae1c7675444aa966` plus progress documentation. This new report does not amend historical evidence.

## Verdict and limits

**The full root gate is red (RC 1), not a passing final-tree gate.** It reports 370 physical files: 368 passed / 2 failed; 3,504 tests: 3,485 passed / 15 failed / 4 skipped. The JSON counts 1,050 nested suites (1,046 passed / 4 failed); those are not physical file counts. Vitest reported duration 1201.87s. No test suite was rerun by this auditor.

The full root run contains 14 panel performance parse-bound failures and one unrelated service/systemd 5000ms timeout. The test helper changed during this long run; its recorded failures demonstrate the earlier helper scope. The later separate named run verifies the corrected helper for three files / 44 tests only. It does not change the original RC 1 or prove the final overlay passed the full suite. Product `src`, `scripts`, `web/src`, package.json and package-lock.json remain byte-identical to 5f0f5ee by a fresh zero-byte git diff at audit time.

## Commands and actual outcomes

All controller gates used `/private/tmp/od9/run.py` in `/Users/biran/.codex/worktrees/usage-settlement-handoff-retry/Orca`; it runs direct argv with its saved environment, redirects combined output to the log, and writes the child return code to paired `.rc`. Shell invocation prefix: `rtk proxy python3 /private/tmp/od9/run.py <name> <argv...>`. The saved environment relocates HOME/XDG/TMPDIR and supplies `ORCA_CCLOOP_BIN=/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js`, `ORCA_AGENTS_TABLE=/private/tmp/od9/agents.json`.

| Log name | Child command | Actual RC | Observed result |
|---|---|---:|---|
| perf-final-build | `npm run build` | 0 | TypeScript production build completed |
| perf-final-web-build | `npm run build --workspace web` | 0 | Vite production build completed; 119 modules; bundle warning 589.71 kB / gzip 181.82 kB |
| perf-final-scheduler | `npm run verify:scheduler` | 0 | 56 files / 202 tests passed, zero skipped or failed |
| perf-final-panel | `npm run verify:panel` | 0 | PASS 0 through PASS 14, all 15 acceptance checks |
| perf-final-pin | `npm run verify:ccloop-pin` | 0 | 1 file / 3 tests passed; zero failed or skipped, enforced by wrapper JSON check |
| perf-final-ledger | `npm run ledger -- validate .decisions` | 2 | 7 historical Tier 0 downgrades on lines 8–14; no rejection |
| perf-final-root | `env ORCA_CONTROL_VERIFY=1 ORCA_SYNCSKILL_REAL_BIN=/Users/biran/code/skills/syncskill/dist/index.js ORCA_CCMEM_REAL_BIN=/Users/biran/code/skills/ccmem/bin/ccmem npm test -- --maxWorkers=2 --reporter=default --reporter=json --outputFile=/private/tmp/od9/logs/perf-final-root.json` | 1 | 368 files passed / 2 failed; 3485 tests passed / 15 failed / 4 skipped |

## Full control coverage and skips

The controller-declared root command explicitly supplied formal `ORCA_CONTROL_VERIFY=1`, both REAL_BIN variables, the real ccloop override, and agents table. Whole-file JSON analysis finds all 154 physical `tests/control` files with 1,730 passed tests / zero failed / 3 skipped. The real protocol test emits CONTROL_PROTOCOL_EVIDENCE naming the pinned ccloop override and table; ccloopProtocol.integration (3), syncskillReal (1), driverSkillsReal (1), and ccmemReal (1) ran and passed. This covers the full control directory under the root maxWorkers=2 invocation; it is not the existing four-worker verify:control wrapper invocation.

Default package resolution `tests/control/ccloopDefaultE2E.test.ts` has three explicit opt-in skips in root. Its separate `verify:ccloop-pin` gate sets ORCA_CCLOOP_DEFAULT_E2E=1, removes ORCA_CCLOOP_BIN and NODE_PATH, and enforces all three real cases passed (RC0). The sole remaining skip is `tests/service/realSmoke.test.ts`, real launchd smoke opt-in; launchd installation smoke was not exercised. Skips are disclosed, never reported as passed.

## Exact unexpected root failures

`tests/panel/controlPollPerformance.test.ts`: 18 tests, 4 passed / 14 failed, each failing original bounds at line 46 because the earlier shared helper included group JSON buckets in work/run M5 parses:
- `tests/panel/controlPollPerformance.test.ts` — batches real summary and group reads for 10 tasks with multiple dependencies: AssertionError: groups:g: expected 4 to be less than or equal to 1
- `tests/panel/controlPollPerformance.test.ts` — batches real summary and group reads for 50 tasks with multiple dependencies: AssertionError: groups:g: expected 4 to be less than or equal to 1
- `tests/panel/controlPollPerformance.test.ts` — reuses statements while refreshing body and projection state between real requests: AssertionError: groups:g: expected 4 to be less than or equal to 1
- `tests/panel/controlPollPerformance.test.ts` — does not borrow same-id dependency or current run bodies from another group: AssertionError: groups:g: expected 4 to be less than or equal to 1
- `tests/panel/controlPollPerformance.test.ts` — keeps missing work and bad referenced runs out of summary counts without parsing unused rows: AssertionError: groups:g: expected 4 to be less than or equal to 1
- `tests/panel/controlPollPerformance.test.ts` — isolates prepared statements across two stores and reconstructs them after close and reopen: AssertionError: groups:g: expected 4 to be less than or equal to 1
- `tests/panel/controlPollPerformance.test.ts` — uses rowid for current lineage and progress while displaying historical runs in id order: AssertionError: groups:g: expected 18 to be less than or equal to 1
- `tests/panel/controlPollPerformance.test.ts` — refreshes latest seq despite clock rollback and preserves null and retention results: AssertionError: groups:g: expected 18 to be less than or equal to 1
- `tests/panel/controlPollPerformance.test.ts` — batches run evidence validation through the same strict run and work snapshots: AssertionError: groups:g: expected 3 to be less than or equal to 1
- `tests/panel/controlPollPerformance.test.ts` — shares lazy decoding with live M3 retry authority and still rejects corrupt source and missing marker: AssertionError: groups:g: expected 15 to be less than or equal to 1
- `tests/panel/controlPollPerformance.test.ts` — preserves D9 settlement markers and strict rejection while decoding each work and run once: AssertionError: groups:g: expected 16 to be less than or equal to 1
- `tests/panel/controlPollPerformance.test.ts` — does not decode an unreferenced legacy run during summary and names it in strict detail: AssertionError: groups:g: expected 4 to be less than or equal to 1
- `tests/panel/controlPollPerformance.test.ts` — counts identical fixture raw bytes once per actual JSON parse rather than multiplying row aliases: AssertionError: groups:g: expected 4 to be less than or equal to 1
- `tests/panel/controlPollPerformance.test.ts` — shares the snapshot with a converted requirement's active work summary and preserves malformed active-run refusal: AssertionError: groups:r: expected 6 to be less than or equal to 1
- `tests/service/systemd.test.ts` — state reads ActiveState/SubState/MainPID/NRestarts; logs is journalctl; uninstall disables, removes, reloads: Error: Test timed out in 5000ms.

The systemd case is a distinct unexpected timeout, not an exemption, skip, or explained product defect. Its measured duration is 5359.169083ms, original timeout 5000ms, declaration at tests/service/systemd.test.ts:135. The other 12 systemd tests passed. No timeout was extended and this auditor did not modify product/tests.

## Corrected test helper evidence

The original proposed M5 assertion-scope edit was automatically rejected before execution and abandoned, as recorded in progress.md. The accepted alternative preserves original M5 parse assertions, restores ReadCounters.parses work_items/runs category, and exposes groupParses separately for M6. The earlier test-only try/finally placement repair remains. Separate complete log `perf-task3-named-separated-counters.log` shows controlPollPerformance (18), archivedWakePerformance (24), controlPollBenchmark (2), all 44 tests / 3 files passed, RC0, duration 7.56s. It began 21:49:27, while root began 21:29:49. This is a targeted corrected-overlay proof, not a retroactive full-tree green claim.

## Historical gates that remain red

The D9/M3 four-worker `npm run verify:control` wrapper RC1 due to a requirementOverview 5000ms timeout remains unregistered / not exempt. The later maxWorkers=2 root has requirementOverview 22 passed, but cannot relabel that original wrapper result. Its historical command/result are retained in the D9/M3 evidence; this audit has not re-audited or rerun that older wrapper.

Ledger RC2 remains its actual status. Fresh read-only byte comparison via `/usr/bin/git show <ref>:.decisions/orca-dev-09cc3ea1.jsonl` for c29676d, 5f0f5ee, HEAD and working bytes proves equality: 11172 bytes, SHA256 `c0bd54fc00e62190b8a819636213091bcfe538a37a81fd8bce0170b7dfc41cda`. Complete current log prints only seven `taskId: Required; runId: Required` historical bound-row downgrades to Tier 0, lines 8–14. Baseline classification is preserved; accepted baseline does not mean RC0.

## Raw evidence identity and complete-read proof

Each listed final gate log and paired rc was read in full after completion. Root was read in 19 contiguous line-preserving chunks spanning [0,327968), using `rtk proxy python3 /private/tmp/od9/task4-read-log.py perf-final-root <index>` for every index 0–18. Scheduler was read in three contiguous chunks. No grep/tail/head/sed filtering was used for validation evidence. `/private/tmp/od9/task4-log-read-proof.json` records per-chunk SHA256, full length/hash and matching complete chunk sets. Initial tool-display truncation for scheduler chunk1 and root chunks1/2 was corrected by complete rereads; proof is backed by untruncated displays.

| Raw artifact | Bytes | SHA256 |
|---|---:|---|
| /private/tmp/od9/logs/perf-final-build.log | 50 | `85a583a8309e758f7d2d85267f693f87462e82c2e62e16213eb3fc5b998b22f0` |
| /private/tmp/od9/logs/perf-final-web-build.log | 658 | `03ff517b911c6cd6c0e74886923e42bde1e21da4ebcfa0a5513df38ff9e8bcbc` |
| /private/tmp/od9/logs/perf-final-scheduler.log | 39559 | `06bb76ec4c7e8a1d7e8e68bd02c78d07210b3d94e3a55655f8a254275baa5f84` |
| /private/tmp/od9/logs/perf-final-panel.log | 1493 | `a67c09b84e4f8ede6b274abc5d1d7967adc954a0cd2bb79c64627d0bd9fcfd9b` |
| /private/tmp/od9/logs/perf-final-pin.log | 1053 | `95de01393508f001b572742972f831390acb548f6a13ed37148fa9093a52507f` |
| /private/tmp/od9/logs/perf-final-ledger.log | 722 | `8ec9bef266d76bf1ffd4f07c28a2512a0bf5361146ceec7b0a48a352ef248ef9` |
| /private/tmp/od9/logs/perf-final-root.log | 327968 | `a10c455a2ffa105b1a9baf211291fff2fdce2bdd8a93b83badbe3be75bc929d4` |
| /private/tmp/od9/logs/perf-task3-named-separated-counters.log | 11918 | `5a1e811b4888d636bd19758382fb6e33c5c9824391fb57855e54183d35122bbc` |
| /private/tmp/od9/logs/perf-final-root.json | 1472717 | `01a0932c6e71dcab51b37b31d2e53e599a3f643b76af9c55a7ee86550c871aac` |

JSON was read as an entire byte buffer and parsed after complete raw-root log audit; derived file/assertion totals exactly match terminal totals. Raw logs include expected intentional refusal/crash/negative-test diagnostics plus SQLite experimental warnings. Those passing negative cases are not unexpected failures. Build bundle-size warning is disclosed above. Cost/token figures were unavailable to this auditor.

Report scope ends at these completed runs and identity checks. It neither commits, updates handoffs, archives worktrees, nor declares overall performance completion.

## Controller single-case systemd diagnostic — 2026-10-09

After the initial red root, controller supplied `/private/tmp/od9/logs/perf-final-systemd-diagnostic.log` and paired RC0. Entire diagnostic log was read by this auditor. It records the exact previously timed-out state/logs/uninstall case passed in 1890ms: one selected test passed / 12 selection skips in one file, duration 3.03s. This diagnostic is neither a full systemd suite rerun nor proof of a known flake or an exemption. The original full-root RC1 stays unchanged. Controller reports service source and fake-tools diff against 1fd19a3 is zero; this attribution is not an independently measured causal explanation.

Diagnostic raw identity: 766 bytes; SHA256 `75465987abcc7fb3209838bf67fe85bd045e86d0bdb273b0e87d3803cf90205c`. Exact diagnostic argv was not captured in this log; the selected name and result are printed in full. Controller plans a later corrected full-root gate after the final benchmark; no later gate is claimed in this initial report.

## Audit process clarification — audit_performance_gates, 2026-10-09, observed 73ac720

The statement above that JSON was parsed after complete raw-log audit describes the final reconciliation pass only. A preliminary entire-buffer JSON parse was also made before full root-log reading to promptly alert the controller to genuine failures. The auditor then read all 19 raw chunks and re-analyzed the entire JSON buffer; final reported totals were reconciled against that full evidence. Root and scheduler chunk numbers in the truncation note are zero-based helper indices. Commands in the table name the observed npm entry points; exact added environment/options for the smaller gates were not recorded in their child logs. The root argv is the controller-provided full declared command. Corrected named-gate exact argv was not independently captured; its complete raw log and paired RC prove the stated three-file result.
