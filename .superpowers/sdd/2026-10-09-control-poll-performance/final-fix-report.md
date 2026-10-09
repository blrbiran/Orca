# Final portability fix and validation

Owner: Codex `/root/fix_performance_portability`, 2026-10-10 Asia/Shanghai. BASE `91a0f725bd255998834d91ebfe0668a4a09d7bc0`, branch `codex/d9-m3-implementation`, managed feature checkout `/Users/biran/.codex/worktrees/usage-settlement-handoff-retry/Orca`. This is the controller-authorized one final fix wave. The report and all `perf-finalfix-*` evidence are new; no historical report or evidence is edited. No subagents, production change, measured callback/getter change, benchmark formatting, broad suite, pin gate, web build or timing repeat. No push, main merge, branch/worktree deletion, real-home data or provider actions.

## Requirement read verbatim

### Important — I1: negative namespace test depends on checkout location

**File:** `tests/control/controlPollBenchmark.test.ts:52` and `:59`; related guard `tests/control/fixtures/controlPollPerformance.ts:25`.

The test called “refuses a nontemporary sandbox” creates its root with `mkdtemp(join(process.cwd(), ".orca-control-poll-sandbox-"))`, then unconditionally expects `control-poll-fixture-root-not-temporary`. A legitimate checkout beneath `/tmp` or `/private/tmp` makes that directory temporary by the guard's own definition. The namespace guard correctly accepts it; the sentinel then makes build reject with `control-poll-fixture-root-not-empty`, failing the test before its open-entry case. This breaks the normal test file in temporary checkouts, including the repository's established isolated local-clone workflow.

This is supported by the current source and the retained `benchmark-evidence/perf-task3-namespace-mutation-results.json`, whose two nonqualifying cases explicitly record the temporary-cwd oracle failure. `perf-task3-namespace-mutation-open-entry.log` fails at the unchanged build-entry expectation before reaching the mutated open guard. The later green outside-temp clone is valid proof for that environment; moving the proof clone does not fix the committed test's cwd dependency. The earlier green namespace-clone baseline belongs to the subsequently abandoned environment-based sandbox variant and must not be treated as current temporary-checkout coverage.

**Fix:** make the negative namespace premise independent of the checkout location, while preserving real build/open entry assertions and owned clone-local scratch data. One safe approach is an isolated test process with explicitly controlled temporary-root inputs, so an owned sandbox beneath that clone is provably outside every temporary root used by the guard. Do not redirect fault-injection writes into the shared worktree or the user's real data, and do not silently skip this criterion. Verify the focused integrity file in both a normal checkout and a temporary clone; repeat the two guard deletions only against the corrected criterion, with clean restored diffs. Product code, benchmark callbacks and historical timings need not change for this fix.

The latest progress ruling permits an intersection-only setup namespace seam, requires genuine real build/open negative checks without skips, normal and temporary-clone focused green, independent guard deletions with zero restored diffs, type/leak and exact setup-only source scope. It supersedes the checkout-dependent negative oracle without rewriting it in historical records.

## Code choice and default-bound proof

`buildControlPollFixture(options, temporaryNamespace?)` and `openExistingControlPollFixture(now, temporaryNamespace?)` pass a per-call optional namespace to the existing pre-mutation setup guard. This test-only seam is preferable here to changing process-wide OS temporary roots or spawning another test process: it adds no environment/global state and it is used only by the focused integrity tests.

The guard canonicalizes candidate/default roots exactly as before (including symlinks and absent suffixes), still rejects relative fixture roots, and evaluates the same strict-descendant predicate for `os.tmpdir()`, `/tmp`, `/private/tmp`. Extracting that predicate into `within` changes no operand or truth condition. Default acceptance is P(root); supplied acceptance is P(root) AND Q(root, canonical(namespace)). The original P rejection happens first, so even a broad supplied namespace can never override it. Q requires a strict descendant and rejects a namespace itself, `..`, any `../` prefix, and any absolute relative result. All default arguments, canonical physical bounds, nonempty-root refusal and error classes remain intact. The new conditional rejection is independently deleted and seen RED below.

The negative test now owns a fresh `mkdtemp(os.tmpdir())` parent. Its restriction is the parent’s `allowed` descendant (deliberately absent, exercising existing canonical absent-suffix resolution); its rejected root is a fresh existing sibling named `rejected-*`. The checkout location cannot affect their sibling relationship. The real builder and real writable opener must each throw `control-poll-fixture-root-not-temporary`, then sentinel bytes and the exact one-entry directory listing must remain unchanged. Returned fixtures close even under a failing assertion. `withFreshRoot` restores the original environment and removes only its owned temporary parent. The separate positive case builds a zero-group legal fixture beneath a supplied temporary namespace and reopens that real store; the existing nonempty refusal and populated lifecycle/replenishment tests are preserved.

Caller inventory (`perf-finalfix-callers.log`) contains only the integrity test and `tests/bench/controlPollPerformance.ts`. The harness seed/open calls omit the new argument. The populated integrity fixture and existing nonempty refusal also omit it; only new positive/negative namespace cases supply it. No product consumer or trusted configuration callback is changed.

## Isolated runtime and RED → GREEN

Execution uses `/private/tmp/od9/env.json`, the same isolated runtime environment consumed by `/private/tmp/od9/run.py`, through the new recorded `perf-finalfix-wave.py` runner so normal and clone CWD can be selected and this run can own distinct scratch. Normal focused runs use `/private/tmp/od9/ff/{h,t,c,k,d,s,ccm,cor}` for HOME/TMPDIR/four XDG/CCMEM/corrections. Clone fault injection overrides every one of those roots to `/private/tmp/od9/ff/clone/{h,t,c,k,d,s,ccm,cor}`. Code and all potentially written fixture data during mutations stay in that clone and its own TMPDIR; no managed-worktree or real-home sandbox is targeted. Dependencies are read through the existing node_modules link; the real pinned ccloop clone remains `ab824d16004de2d3c1613a76ec0431520aa16cc9` (`perf-finalfix-source-proof.json` records its CLI SHA256). The fixture’s execution port uses its existing fake lifecycle. No credentials are introduced.

Clone creation command is `/usr/bin/git clone --local --no-hardlinks <managed-feature-checkout> /private/tmp/od9/ff/clone`; native command/RC/log are retained. The clone starts at BASE; only the two owned test/fixture files are overlaid and locally committed as mutation baseline `32395a96f133c8680e6f77900970a787b9fe75af`. This clone commit is evidence isolation, not a managed branch integration.

Full native logs are retained unfiltered with adjacent `.rc` files and SHA256/lengths. `perf-finalfix-commands.json` records exact subprocess command, CWD, observed HEAD, environment roots, RC and raw-log identity for every run. Human-facing shell invocations were prefixed `rtk proxy python3`; the runner’s subprocess outputs are never filtered. Qualified RED runs preceded the fixture implementation:

| Evidence prefix `perf-finalfix-` | Exact criterion / result |
| --- | --- |
| `old-temp-qualified-red` | Old committed test in the temporary clone: RC1, 3 passed / 1 failed / no skips. Failure is expected `root-not-temporary`, received `root-not-empty`. |
| `test-first-normal-qualified-red` | Corrected negative test against old fixture in normal checkout: RC1, 4 passed / 1 failed / no skips; same wrong rejection. |
| `test-first-temp-qualified-red` | Same test-first tree in temporary clone: RC1, 4 passed / 1 failed / no skips; same wrong rejection. |
| `normal-green` | `npx vitest run tests/control/controlPollBenchmark.test.ts`, managed normal CWD at BASE + two owned changes: RC0, 5 passed / 0 failed / no skips. |
| `temp-green` | Same full focused command and identical owned bytes in temporary clone: RC0, 5 passed / 0 failed / no skips. |
| `typecheck` | `npm run typecheck` in normal checkout: RC0. |
| `formal-tmp-leak` | `ORCA_OUTER_LEAK_CHECK=1 node scripts/check-tmp-leak.mjs tests/control/controlPollBenchmark.test.ts`: outer RC0; native log explicitly reports **inner Vitest exit 0, 5 tests, 0 entries left**. Outer RC0 alone would not establish passing tests. |
| `clone-restored-green` | Full focused command after all deletions restored, clone-owned HOME/XDG/TMPDIR/CCMEM: RC0, 5 passed / 0 failed / no skips. |

Initial restricted-sandbox runs `old-temp-red`, `narrowed-normal-red`, `test-first-normal-red`, `test-first-temp-red` are retained but nonqualifying: the normal old test’s managed CWD scratch was blocked by EPERM and real store setup was blocked by `spawnSync ps EPERM`. The temporary old run also shows the real oracle mismatch, but qualified reruns remove unrelated sandbox failures. Those initial attempts do not serve as acceptance or guard proof and did not create managed sandbox data. A first test-edit generator had a Python string-literal syntax error before any edit; the corrected generator was run before qualified test-first RED. No failed command is relabeled. Required runtime/checks were rerun with sandbox permission; no approval rejection occurred.

## Independent guard deletion proof

`perf-finalfix-mutations.py` deletes one exact guard per run in the no-hardlinks local clone; each full focused file executes all five tests with no selection skips. `perf-finalfix-mutation-results.json` records each baseline, exact deleted line, clone-only data roots, actual RC and restored native git diff byte lengths. Each exact mutant diff and complete native log is separate:

| Mutation | Business failure | Actual result | Restored `git diff` / `git diff --cached` |
| --- | --- | --- | --- |
| `build-entry` | Real builder proceeds to `root-not-empty` instead of namespace refusal. | RC1, 4 passed / 1 failed, no skips | 0 / 0 bytes |
| `open-entry` | Real opener succeeds instead of returning an Error; writable initialization is therefore wrongly admitted. | RC1, 4 passed / 1 failed, no skips | 0 / 0 bytes |
| `restriction` | Removing only the new restrictive branch wrongly admits the rejected sibling to build’s nonempty check. | RC1, 4 passed / 1 failed, no skips | 0 / 0 bytes |

All three are business assertion failures, with the populated real lifecycle and positive reopen cases passing. They are not syntax, startup, sandbox or temporary-CWD oracle failures. The opener deletion reaches its own real entry after the intact build guard rejects. Every case restores original bytes in finally and mechanically requires both native diff lengths to be zero. The restored full file passes afterwards. No production guard is mutated.

## Source identities and evidence package

`rtk proxy python3 /private/tmp/od9/finalfix-source-proof.py` measures against BASE and writes `perf-finalfix-source-proof.json`; `source-proof` is the recorded raw command/RC0. It records SHA256/byte inventory for every tracked production source file, all equal to BASE, with `src` diff **0 bytes**. The harness, counter and original M5/M6 tests each compare byte-for-byte equal to BASE. The fixture proof restores only the changed setup helper, optional signatures and two pre-open guard arguments in-memory and requires the entire remaining fixture to equal BASE; result `fixtureOutsideSetupDeltaIdentical=true`. Thus all fake/trusted callbacks, measured fixture lifecycle, getter and measurement logic remain identical. The getter line SHA is `6f80d17253f37106c62d9cf6d1acbe55280c30f88805650cac3e870a90795d69`.

Unchanged harness SHA256: `7ebe22e0a0d470b560ead069a09a45466b5f26eaf30a5350ad2414fbbcc0ea83`; counter `6a9a8ae7ef01ab942db5abc355e46bdadf2345dba1f226f4af928860510d1067`; M5 `57346432b566a6ae1b1fa063b4685f69c1834fbc9756a732655e0709869d4328`; M6 `74c2ac0700a280bc5e50645e2c23d1f1e9fa0d18e20f57728b502aca1701224d`. Current fixture SHA256: `c6fb813e67f794d8c729a04666bcd1b712fd1b51a4c6637172de7a2737fd7ea6`; current focused test `c98579e48317cafe2b8ed764332a341d8519eab30a81a8f1868c77e6ab949b69`. Both match the restored clone exactly.

`perf-finalfix-source.diff` is the complete two-file diff. `perf-finalfix-callers.log` is the mechanical caller search. `perf-finalfix-artifacts.json` lists the new evidence files with native byte lengths/SHA256 (excluding itself). Runner, edit, mutation, source-proof and package scripts are included for reproducibility. Raw SQLite experimental warnings, expected bundle diagnostics, clone Xcode cache diagnostics and an npm update notice remain visible. No suppressions or new exemptions are added.

Overall `git diff --cached --check` returns RC2 on preserved native log EOF blank lines and raw diff context whitespace (plus one evidence runner EOF blank line). That original output is retained in `perf-finalfix-staged-whitespace.log`; it is not relabeled or removed. The exact source/test/report scoped staged check returns RC0 (`perf-finalfix-staging-checks.json`). Native evidence bytes remain unchanged.

Only the two owned source/test files, this new report and new uniquely prefixed evidence are staged. Historical performance timing claims and integrated gate revision limits remain unchanged and attributed to their original reports; this wave makes no unrun broad-suite claim. The previously deferred harness formatting and diagnostic-noise Minors remain deferred. Controller owns fresh review and integration. Task status: DONE, with those inherited concerns disclosed.
