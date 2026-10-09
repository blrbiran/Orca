# Main integration verification

Owner: audit_performance_gates for Codex controller / usage-settlement-handoff-retry session. Observation and report date: 2026-10-10 Asia/Shanghai. Primary repository: `/Users/biran/code/skills/loop/Orca`. Historical tested main commit: `f42744d339e42c86dc7c87433eb4e1e943bcc957` (`docs: close approved control poll performance round`). This is a new evidence record; existing controller report, ledger and historical review records are unchanged.

## Measured outcome

**The completed local-main whole-root gate returned RC0:** 371 physical files passed; 3,505 tests passed / zero failed / four skipped (3,509 total). JSON reports 1,052 nested suites, all passed; nested suite count is not physical file count. The terminal reports start 01:25:46 and duration 1219.58s. No unexpected failed test, assertion timeout or unhandled suite error appears in the completed evidence. The passing suite intentionally prints refusal, simulated timeout and SIGKILL diagnostics, and SQLite experimental warnings.

All 155 physical control files ran with 1,735 passed tests / zero failed / three default-pin opt-in skips. The final namespace criteria from `f87e8b2349adb7363e2c476f44762a25dee4ce8f` are incorporated: tests/control/controlPollBenchmark.test.ts now reports **five passed / zero failed / zero skipped**, versus the earlier a241 gate’s three. This local-main gate covers the final test tree, including the portability and namespace criteria; a241 is not retrospectively credited with the later tests.

Relevant actual whole-JSON counts:

| File | Passed | Failed | Skipped |
|---|---:|---:|---:|
| tests/control/controlPollBenchmark.test.ts | 5 | 0 | 0 |
| tests/service/systemd.test.ts | 13 | 0 | 0 |
| tests/control/requirementOverview.test.ts | 22 | 0 | 0 |
| tests/control/ccloopProtocol.integration.test.ts | 3 | 0 | 0 |
| tests/control/driverSkillsReal.test.ts | 1 | 0 | 0 |
| tests/skills/syncskillReal.test.ts | 1 | 0 | 0 |
| tests/memory/ccmemReal.test.ts | 1 | 0 | 0 |
| tests/agents/command.test.ts | 13 | 0 | 0 |
| tests/entry/panelSocketE2e.test.ts | 3 | 0 | 0 |
| tests/entry/mcp.test.ts | 3 | 0 | 0 |

Four skips are explicit and remain outside this invocation’s exercised cases: all three tests/control/ccloopDefaultE2E.test.ts cases (default-installed package resolution, agents init/show, execution-port panel boot) and one tests/service/realSmoke.test.ts real launchd lifecycle smoke. They are not passed tests. The earlier independently audited perf-final-pin is a separate RC0 / three real cases / zero skipped gate; this root invocation does not replace that evidence or exercise actual launchd installation smoke.

## Commands and build ordering

Controller-provided exact root runner argv, verified against run-main.py and the printed Vitest command:

```sh
rtk proxy python3 /private/tmp/od9/run-main.py main-merged-root env ORCA_CONTROL_VERIFY=1 ORCA_SYNCSKILL_REAL_BIN=/Users/biran/code/skills/syncskill/dist/index.js ORCA_CCMEM_REAL_BIN=/Users/biran/code/skills/ccmem/bin/ccmem npm test -- --maxWorkers=2 --reporter=dot --reporter=json --outputFile=/private/tmp/od9/logs/main-merged-root.json
```

run-main.py invokes direct argv in the primary repository with the saved /private/tmp/od9/env.json environment, redirects combined output to the named log, writes the exact child return code to paired .rc and exits with that code. Saved environment relocates HOME/XDG/TMPDIR and supplies ORCA_CCLOOP_BIN=/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js and ORCA_AGENTS_TABLE=/private/tmp/od9/agents.json. Formal ORCA_CONTROL_VERIFY=1, both REAL_BINs and maxWorkers=2 are explicit argv. Whole control-directory coverage under this root command does not relabel the older four-worker verify:control wrapper.

| Main gate | Command entry point | Actual RC | Observed output |
|---|---|---:|---|
| main-build | npm run build | 0 | tsc -p tsconfig.build.json completed |
| main-web-build | npm run build --workspace web | 0 | 119 Vite modules, built in 1.28s |
| main-merged-root | exact root argv above | 0 | 371 files; 3505 passed, zero failed, four skipped |

Build logs and paired RCs were read in full. The controller launched both builds before the test command; they completed while early E2E cases were running and web/dist existed before the panel cases. This scheduling/order attribution comes from controller observation; child logs contain no build-start timestamps. The Vite warning remains: dist/index.js **589.71 kB** / gzip **181.82 kB**, exceeding its 500 kB chunk threshold. No build/test/source changes were made by this auditor.

Raw CONTROL_PROTOCOL_EVIDENCE names the pinned ccloop override, agents table, configHash `7a4a2be57081440048c57ca6ed4068c12eb532d71c6be314ad1428223a68696e`, codex/gpt-6-sol/agent-default and distinct first/continuation run/execution/checkpoint identities. It records three plan/execute/verify process entries for each execution (six phase-process registrations); this is observed protocol evidence, not a complete count of all CLI calls or cost.

## Integration and source identity

Fresh read-only git checks at audit time find branch main / HEAD f42744d, and git status --short empty before this new report and controller handoff updates. main and codex/d9-m3-implementation have identical commit/tree identity; both feature codex/d9-m3-implementation and design codex/usage-settlement-handoff-retry are ancestors of f42744d (merge-base --is-ancestor RC0). f87e8b is also an ancestor RC0. Tested main tree identity: `6108ecac26e9e8dc266b13e84836d44fa1386bc2`.

Measurements: `rtk proxy /usr/bin/git branch --show-current`, `log -4 --format=...`, `status --short`, `branch --format=...`, `rev-parse <ref>^{tree}`, and `merge-base --is-ancestor <feature/design/f87> f42744d`. Fresh `/usr/bin/git diff f42744d -- src scripts web/src tests package.json package-lock.json` produces **zero bytes**. Controller attests these source/tests stayed fixed during the completed suite. New audit/handoff documents added after the run do not change which tree this evidence tested.

## Preserved limits and pending work

The initial performance root RC1 / 15 failures, old D9 four-worker verify:control RC1 / requirementOverview timeout, and historical timed-after benchmark CLI RC1 remain preserved in existing evidence. This new passing main gate is not a historical exemption, overwrite, or known-flake declaration. Baseline ledger RC2 / seven old Tier0 downgrades also remains its historical actual result; no ledger data was rewritten.

Controller reports ccmem config-value-parity remains protected by an independent merge ban pending clarification and was not merged. This Orca main gate does not resolve or authorize that sibling change. Local-main integration is recorded here; push remains a separate human action. This auditor performs no suite rerun, agent/service invocation, merge, push or commit.

## Complete-read evidence identity

The root combined log was read unfiltered using `rtk proxy python3 /private/tmp/od9/task4-read-log.py main-merged-root <index>` for all indices0–11. These 12 contiguous line-preserving chunks span [0,188771). Index10 preserves a 22737-byte long ANSI reporter line whole. Initial aggregate display truncated part of index2; that entire chunk was then reread untruncated. Every raw byte was displayed/read; there was no grep/tail/head/sed summary filtering. Build logs each used the same reader index0, their only chunk, and paired RCs were read completely.

The helper proof /private/tmp/od9/task4-log-read-proof.json records all12indices, per-chunk SHA256 and all_read_chunks_still_match=true; final full-log SHA256 matches a fresh byte-buffer hash. Entire JSON was parsed before the raw-log read for prompt failure detection and rechecked after complete raw-log audit, with file/assertion totals matching the terminal.

| Evidence artifact | Bytes | SHA256 |
|---|---:|---|
| /private/tmp/od9/logs/main-merged-root.log | 188771 | `f42073d59389ee4ee7b1d1e0b101904575892032dbca0c1d764924bcddae2ea4` |
| /private/tmp/od9/logs/main-merged-root.rc | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| /private/tmp/od9/logs/main-merged-root.json | 1456218 | `08b074d69cd5dfdff81bb76c9a53e5d8be379caf778c0009bb86e8caa4d7e395` |
| /private/tmp/od9/logs/main-build.log | 50 | `85a583a8309e758f7d2d85267f693f87462e82c2e62e16213eb3fc5b998b22f0` |
| /private/tmp/od9/logs/main-build.rc | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| /private/tmp/od9/logs/main-web-build.log | 658 | `0b6b45c8f893e0526f7ce68525f17bff3dd8c5ed64430effb0adc5010232603b` |
| /private/tmp/od9/logs/main-web-build.rc | 2 | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |

Root contiguous chunk SHA256, index order:

- 0: `f0e17e211c7b8b427cc7eb205d2b2879ddc27dcacdf18d75c90370d71f87a284`
- 1: `c4a853f75206512199a3611324a28e4ff1c34343c5e9c11893b43a1bf511722e`
- 2: `d8b1345dc40e20ee7b68a5be5929dd669bf210f62f1a2c27a2a749473138ecb5`
- 3: `30529acd6c9e9068323023a06ad62297dd0a9de5632d931dd3c6ba9698f0af4c`
- 4: `baaf0e24de1ad3c74e2de144721d4d237b33178a3d22594c7988c9b8892003db`
- 5: `09a0689aaaf24a39bbdd7deb0375a3b5af9d62c04cf78b872716d748b8d4bf99`
- 6: `b5d63a6185c617dd61dd7eb6ceb88cdd0c21dc550ec95316d07885824224d82f`
- 7: `1bb5a383bd7a4a17a5831a456d52dda22b6b0fa0b190e18d6741dc80f5778f13`
- 8: `db995fb811aa9abae2f8824b7607cffd94aade8c20d342a74ab21acf2bcf1b8d`
- 9: `7499d9106fa51fdfc9b598e488794f9a450e9144aac5047df3e74d5c553111e0`
- 10: `c49d4f499680fb1ffb8dba73752cd75ff5cda15a21edd4d3e421af25da998f67`
- 11: `b3ffa30d20b27eeede5ca7aec19c58199553e8455c6b540c3ae4bb9db0a8537b`

Cost/token figures were unavailable to this auditor. Report-only verification command: `rtk proxy /usr/bin/git diff --check -- .superpowers/sdd/2026-10-09-control-poll-performance/main-integration-verification.md`.

Controller archival note (2026-10-10): complete main logs/RC/JSON, runner and read proof are saved in `evidence/2026-10-10-local-main-verification.tar.gz`; 10 members, 203618 bytes, SHA256 `8cdc2c8fbbbdc93af18f2a5252a58029bf0a1ffb77ecababe88e8f040eec4015`. Every member was reread and byte-compared against its source. No environment secrets or user database are archived.

Controller remote observation before final documentation commits (2026-10-10): independent `/usr/bin/git ls-remote origin refs/heads/main` returned Orca `f42744d339e42c86dc7c87433eb4e1e943bcc957`, ccloop `938b7bac5940efa9772376c8ab9e6b32635e8778`, ccmem `d052c48ffa386fb16bb43e50738807c2934b41d5`. These are historical observed remote values, not current-HEAD promises. No push command was performed by this controller; who advanced Orca remotely is not established by this observation. Final local documentation commits remain for the human to push.
