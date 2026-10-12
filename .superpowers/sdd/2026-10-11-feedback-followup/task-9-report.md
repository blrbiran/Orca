# Task 9 — ccloop installation observation and durable apply

Branch: `codex/feedback-followup-task9` in `/private/tmp/ccloop-feedback-followup-task9-20261011`. Base: local `main` `451a82f625db8fb0a2fe71b34bfae7eddbcb0f6e`. Commits: `4c721f0a89c34291879abcd70f5a9f1054649533` (`feat(agents): detect and apply installation changes with durable receipts`), `8b67898e13e9456acc1d70369e98a0321a1d70d1` (`fix(agents): publish update artifacts atomically`), and final HEAD `74194c8e048de2143766db9726be7cf0fe96c300` (`fix(agents): recover update locks and bind exact candidate probes`). All product and test edits are scoped to ccloop; `node_modules` is an untracked symlink and was excluded from staging. Post-commit `git status --short` showed only `?? node_modules`; `git diff 451a82f… HEAD --check` returned 0.

## Implementation

- Added configured-table `agent-installation-observe`, `agent-installation-preview`, and `agent-installation-apply` structured control methods. Their payloads contain no table path or shell command. Observation reads the exact configured command/argv and classifies current, changed, and unavailable separately. Preview persists an immutable server-owned choice list; version, alternate path, and addition are separate accepted changes.
- Added no-follow table snapshots, raw byte SHA-256 CAS, strict table validation, exact realpath/argv/version re-probe, and preservation of IDs, aliases, configDir, kind extras, timeouts, command arguments, and existing table mode. Final byte recheck occurs after the replacement temporary file is synced and immediately before rename.
- Added private adjacent `<table>.updates` storage (0700), immutable preview/intent/receipt files (0600), and an exclusive table-scoped lock. A prewritten owner ticket is atomically hard-linked as the lock so another process never sees an ownerless claim. Dead lock reclamation is serialized. Durable intent precedes table rename; receipt follows it. Same-operation replay returns the stored receipt before CAS; crash recovery distinguishes before, after, and third-state table hashes. The exact operation-owned temporary file is cleaned on recovery.
- Final self-review found a crash gap while writing a final intent or receipt file: direct `O_EXCL` creation could leave partial JSON. The follow-up change writes each JSON artifact into a private 0600 temporary, syncs it, atomically hard-links it to its immutable final name without clobbering an existing file, syncs the directory, then removes the temporary. Same-operation recovery cleans only that exact owned temporary. Crashes after opening the intent or receipt temporary now replay successfully.
- Version probes now kill their own detached process group on timeout or output overflow and wait for close. `features.agentInstallationUpdate` is advertised as `v1` after the methods and tests are present. Existing protocol-3 execution responses were not changed.

## TDD evidence

Meaningful RED and subsequent GREEN were captured in raw logs under `task9-logs/`:

| Behavior | RED log / RC | GREEN log / RC |
|---|---|---|
| Configured observation/preview/apply and preserved custom settings | `red-updates.log` / 1 | `green-updates-1.log` / 0 |
| Probe descendant cleanup | `red-probe-tree.log` / 1 | `green-probe-tree-1.log` / 0 |
| Strict observation response | `red-response-schema.log` / 1 | `green-response-schema.log` / 0 |
| Crash after durable temp fsync | `red-temp-crash.log` / 1 | `green-temp-crash.log` / 0 |
| Final pre-rename CAS | `red-final-cas.log` / 1 | `green-final-cas.log` / 0 |
| Crash after opening intent or receipt publication file | `red-intent-receipt-publication.log` / 1 (both cases fail) | `green-intent-receipt-publication.log` / 0 (both pass) |

The first-commit focused run is `focused-frozen.log`: 31/31 tests, RC 0. The publication follow-up focused run is `focused-publication.log`: 34/34 tests, RC 0. It additionally covers crashes after opening intent and receipt temporaries and an immutable no-clobber publication check. The suite covers two independent process writers, two concurrent recovery callers, crashes before rename / after temp fsync / after rename / after receipt, third-state conflict, identical receipt replay, altered digest refusal, mode preservation, path/addition choices, no caller path or shell payload, and probe cleanup.

## Clone-only deletion mutants

Baseline was copied into an isolated Git clone at `task9-mutants/base`; each mutant lives in a separate clone and never altered the source branch. All five were killed by the named business criterion. Raw logs: `task9-logs/mutant-{lock,cas,receipt,custom,probe}.log`.

| Deleted behavior | Criterion that failed |
|---|---|
| Shared exclusive lock | Two process writers both returned success, instead of one stale (`mutant-lock.log`, RC 1) |
| Final CAS | Stale original bytes were overwritten (`mutant-cas.log`, RC 1) |
| Completed receipt replay | Same operation failed with `EEXIST` on its receipt (`mutant-receipt.log`, RC 1) |
| Custom config preservation | `configDir` changed to null (`mutant-custom.log`, RC 1) |
| Process-group probe cleanup | Grandchild survived timeout (`mutant-probe.log`, RC 1) |
| Atomic JSON publication | Both `intent-open` and `receipt-open` crash replays encountered partial final JSON (`mutant-publication.log`, RC 1) |

## Gates and environment

All gates used `HOME`, four XDG roots, `TMPDIR`, and `CCMEM_DATA_ROOT` redirected under `/private/tmp`; `CCMEM_CONFIG_PATH` was absent. The formal gate uses `/private/tmp/ccloop-task9-formal/agents.json`, a private fixture-only table whose sole command is Node running `tests/fixtures/fake-codex.mjs`. No real table/config/service/provider or package pin was used or changed.

| Gate | Raw log | Result |
|---|---|---|
| First-commit focused tests | `task9-logs/focused-frozen.log` | 31/31, RC 0 |
| First-commit typecheck/build | `task9-logs/typecheck-frozen.log`, `build-frozen.log` | RC 0 / 0 |
| First-commit full suite, unsandboxed to permit local tsx IPC | `task9-logs/full-tests-frozen.log` | 149 files, 1580/1580 tests, RC 0; zero skipped |
| First-commit formal `verify:control` | `task9-logs/verify-control-frozen.log` | 70 files, 793/793 tests, RC 0; zero skipped |
| Publication follow-up focused/typecheck/build | `focused-publication.log`, `typecheck-publication.log`, `build-publication.log` | 34/34, RC 0 / 0 / 0 |
| Publication follow-up full suite | `full-tests-publication.log` | 149 files, 1583/1583 tests, RC 0; zero skipped |
| Publication follow-up formal control | `verify-control-publication.log` | 70 files, 793/793 tests, RC 0; zero skipped |

Exact acceptance command forms from `/private/tmp/ccloop-feedback-followup-task9-20261011` (the raw logs are unfiltered):

```sh
env -u CCMEM_CONFIG_PATH HOME=/private/tmp/ccloop-task9-home XDG_CONFIG_HOME=/private/tmp/ccloop-task9-xdgconfig XDG_DATA_HOME=/private/tmp/ccloop-task9-xdgdata XDG_STATE_HOME=/private/tmp/ccloop-task9-xdgstate XDG_CACHE_HOME=/private/tmp/ccloop-task9-xdgcache TMPDIR=/private/tmp CCMEM_DATA_ROOT=/private/tmp/ccloop-task9-ccmem ECC_GATEGUARD=off DISABLE_OMC=1 rtk proxy npm test -- --run
env -u CCMEM_CONFIG_PATH HOME=/private/tmp/ccloop-task9-home XDG_CONFIG_HOME=/private/tmp/ccloop-task9-xdgconfig XDG_DATA_HOME=/private/tmp/ccloop-task9-xdgdata XDG_STATE_HOME=/private/tmp/ccloop-task9-xdgstate XDG_CACHE_HOME=/private/tmp/ccloop-task9-xdgcache TMPDIR=/private/tmp CCMEM_DATA_ROOT=/private/tmp/ccloop-task9-ccmem ECC_GATEGUARD=off DISABLE_OMC=1 rtk proxy npm run typecheck
env -u CCMEM_CONFIG_PATH HOME=/private/tmp/ccloop-task9-home XDG_CONFIG_HOME=/private/tmp/ccloop-task9-xdgconfig XDG_DATA_HOME=/private/tmp/ccloop-task9-xdgdata XDG_STATE_HOME=/private/tmp/ccloop-task9-xdgstate XDG_CACHE_HOME=/private/tmp/ccloop-task9-xdgcache TMPDIR=/private/tmp CCMEM_DATA_ROOT=/private/tmp/ccloop-task9-ccmem ECC_GATEGUARD=off DISABLE_OMC=1 rtk proxy npm run build
env -u CCMEM_CONFIG_PATH HOME=/private/tmp/ccloop-task9-home XDG_CONFIG_HOME=/private/tmp/ccloop-task9-xdgconfig XDG_DATA_HOME=/private/tmp/ccloop-task9-xdgdata XDG_STATE_HOME=/private/tmp/ccloop-task9-xdgstate XDG_CACHE_HOME=/private/tmp/ccloop-task9-xdgcache TMPDIR=/private/tmp CCMEM_DATA_ROOT=/private/tmp/ccloop-task9-ccmem ORCA_CCLOOP_BIN=/private/tmp/ccloop-feedback-followup-task9-20261011/dist/cli.js ORCA_AGENTS_TABLE=/private/tmp/ccloop-task9-formal/agents.json ECC_GATEGUARD=off DISABLE_OMC=1 rtk proxy npm run verify:control
```

The final complete acceptance suites were run through approved unsandboxed command execution solely because the sandbox denies `tsx` local IPC. Each command retained the redirected environment. No skipped test occurred in either final complete acceptance run. `tests/control/protocol4.test.ts` and `tests/control/savedResultEvidence.test.ts` each changed one existing exact `features` expectation to include the now implemented `agentInstallationUpdate: "v1"`; no other existing criterion was broadened or removed.

Earlier attempts are retained without converting their failures into a pass. The sandboxed full run (`full-tests-1.log`, RC 1) had 281 failures/1293 passes in 149 files; every failed name is indexed in `task9-logs/sandbox-full-failures.txt`. Its isolated validation CLI run (`isolated-evidence.log`, RC 1, 2 failed/27 passed) reproduced `tsx` `listen EPERM` on its local pipe, while the same isolated file outside the sandbox (`isolated-evidence-escalated.log`, RC 0, 29/29) passed. An isolated Claude N2 timeout in the sandbox (`isolated-claude-n2.log`, RC 1) was retained as a distinct failure. The first unsandboxed full run (`full-tests-escalated.log`, RC 1) had 1574 passed/4 failed: the new temp-fsync crash test ran before its hook was added, plus three load-sensitive existing criteria. Each existing failure passed in a subsequent isolated unsandboxed run: `isolated-cli-escalated.log` (RC 0), `isolated-watchdog-escalated.log` (RC 0), `isolated-performance-escalated.log` (RC 0). The exact names are in that full log. The in-flight pre-CAS second full run was interrupted intentionally (RC 130; partial `full-tests-final.log`) and is not treated as acceptance evidence. Targeted `-t` runs intentionally skipped nonmatching tests; the frozen full run skipped none.

The first unconfigured `verify:control` attempt (`verify-control.log`, RC 1) correctly refused missing `ORCA_CCLOOP_BIN` and `ORCA_AGENTS_TABLE`. The fixture-configured earlier run (`verify-control-fixture.log`, RC 0) passed 793/793 tests; final frozen-source rerun is recorded above.

## Self-review

- Checked no new control payload can choose a table path or shell command; the configured CLI `--agents` path is outside the JSON payload and gets the existing path check. Reviewed no-follow reads, owner/private modes, lock acquisition/reclaim, byte CAS under lock, final recheck, fsync order, atomic rename, same-op replay, and third-state refusal.
- Confirmed aliases and custom argv/config retain their exact record values except accepted version/path fields. Path and addition require explicit accepted change IDs. The table mode is restored on replacement; no `chmod` touches the original user file.
- `git diff --check` passed on final HEAD. No product edits were made in Orca, main, the previous Results5 WIP, real user data, remotes, or package pins. Remaining limitation: ccloop cannot prevent a separate non-cooperating user process from writing the table in the tiny interval after its final byte check and before atomic rename; the shared apply entry points all use the same exclusive lock.

## Independent review fix — final Task 9 source `74194c8e048de2143766db9726be7cf0fe96c300`

The independent reviewer found three missed cases in the first two commits. All three were fixed in the scoped third commit:

1. The old process-owned `reclaim` directory could remain after killing the process that made it. `red-reclaimer-crash.log` recorded the exact process window: kill the first apply after rename, kill the second process immediately after it acquires `reclaim`, then a third same-op replay timed out (RC 1). The replacement uses a persistent private table-scoped lock file and a fixed OS advisory-lock utility (`/usr/bin/lockf` on macOS; `/usr/bin/flock` on Linux) running a fixed Node helper with no shell or caller command. The helper signals readiness only after the kernel lock is held; parent SIGKILL closes its stdin and releases it. `green-reclaimer-crash-1.log` is RC 0. `green-live-lock-process.log` proves a second process waits behind a live holder; `green-lock-release.log` proves cleanup after both normal and error returns. A macOS child simulation of missing Linux utility returned the named `agent-installation-update-invalid: table lock helper unavailable: spawn /usr/bin/flock ENOENT` in `missing-lock-utility.log` (test command RC 0 because it expected that refusal). Linux runtime behavior was not run on this macOS host.
2. Preview now discovers executable paths without a version probe, then probes each *offered* path or addition command with its full preserved/custom or descriptor-draft argv. `red-exact-choice-argv.log` recorded three failures: bare binary unavailable, bare binary reporting a misleading version, and addition draft args changing the version (RC 1). `green-exact-choice-argv.log` is RC 0 for all three. Existing `agents detect` still probes its historical bare candidate command; only reviewed configured-table choices use the exact offered argv.
3. Matching completed receipts now pass configured table path/owner and private updates-root validation, acquire the table lock, validate operation identity/digest, and return before parsing current table bytes or checking base CAS. `red-completed-replay-before-table.log` recorded failures for malformed and mode-000 current tables (RC 1); `green-completed-replay-before-table.log` is RC 0. `green-private-replay-boundary.log` proves a group/world-writable table parent and non-private updates root are still refused (RC 0).

Three additional clone-only deletion mutants were killed. `mutant-review-lock.log` bypassed the kernel lock and the live-writer criterion saw the second process complete early (RC 1). `mutant-review-argv.log` restored bare candidate probes and all three exact-argv criteria failed (RC 1). `mutant-review-replay.log` restored the pre-receipt table read and both damaged-table replay criteria failed (RC 1). These clones live under `task9-mutants/review-*`, separate from the Task 9 branch.

Final-source review-fix gates and exact raw evidence:

| Gate | Log | Result |
|---|---|---|
| Focused `npm test -- --run tests/agents tests/control/command.test.ts` (unsandboxed for tsx IPC) | `focused-review-fix-final.log` | 10 files, 117/117 tests, RC 0 |
| Typecheck and build | `typecheck-review-fix-final.log`, `build-review-fix-final.log` | RC 0 / 0 |
| Full `npm test -- --run` (unsandboxed) | `full-tests-review-fix.log` | 149 files, 1591 passed / 2 failed, RC 1; **open for Task 14** |
| Formal fixture-only `verify:control` (unsandboxed) | `verify-control-review-fix.log` | 70 files, 793/793 tests, RC 0 |

The full-run failures were retained exactly, without a waiver. `tests/cli/cli.test.ts > parseArgs > returns 0 for the example contract run` timed out at 5000 ms under full load; the exact isolated unsandboxed rerun passed in 2791 ms (`isolated-review-fix-cli.log`, RC 0). `tests/runtime/claude/claudeAgentAdapter.test.ts > ClaudeAgentAdapter, the execute result written after a stop (consolidation step 1) > a result written after a stop that already carries tokenUsage keeps it` threw `ClaudePhaseAborted` at `src/runtime/claude/claudeAgentAdapter.ts:258` in the full run and exact isolated unsandboxed rerun (`isolated-review-fix-claude-stop-result.log`, RC 1), then passed in another isolated run (`isolated-review-fix-claude-after-baseline.log`, RC 0). The exact sandboxed control CLI criterion failed with code 1 in `focused-review-fix-1.log`; direct sandbox tsx invocation reproduced `EACCES lstat /private/tmp/tsx-501/*.pipe` (`sandbox-tsx-ipc-repro.log`, RC 1), while its isolated unsandboxed rerun passed (`isolated-control-cli-unsandboxed.log`, RC 0). No Task 9 source change was made to address these unrelated gate failures.

For baseline comparison, `task9-baseline-claude` is a clone detached at immutable pre-Task9 `451a82f625db8fb0a2fe71b34bfae7eddbcb0f6e`. Its initial unbuilt test failed before the fake CLI could answer (`baseline-claude-stop-result.log`, RC 1) and is **not** valid comparison evidence; the handoff requires building clones first. After `npm run build` (`baseline-claude-build.log`, RC 0), the exact criterion passed once (`baseline-claude-stop-result-after-build.log`, RC 0) and passed 10/10 further isolated repetitions (`baseline-claude-repeat-{1..10}.log`, each RC 0). `claude-paths-base-diff.log` records `git diff --exit-code` RC 0 for the adapter, its test, phase runner, fake Claude CLI, and shared fixture between base and Task 9 HEAD. The behavioral relationship between the Task 9 change and the Claude failure is **unproven** by this comparison. The controller assigned cross-cutting Claude stop/result diagnosis and the final full ccloop gate to Task 14; Task 9 did not edit that runtime path. No additional full-suite rerun was made after that decision.

The final focused/formal gates used the same redirected HOME/XDG/TMPDIR/CCMEM fixture environment and absent `CCMEM_CONFIG_PATH` detailed above. The only skipped tests were nonmatching tests in intentional `-t` isolation runs; no focused or formal test was skipped. The scoped review-fix commit changed only `src/agents/{detect,table,updateReceipt,updates}.ts` and `tests/agents/{updateRecovery,updates}.test.ts`. The table's noncooperating external-writer check/rename race remains the documented limitation accepted by the independent reviewer.
