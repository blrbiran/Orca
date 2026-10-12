# Task 14 scoped Claude runner fix

Prepared 2026-10-12 Asia/Shanghai. This report covers only `/private/tmp/ccloop-feedback-followup-task9-20261011`, branch `codex/feedback-followup-task9`, base `74194c8e048de2143766db9726be7cf0fe96c300`. The source was frozen for final gates at SHA256 `98f6990a4ac02f9881f6d5748782439f2dc2d6bf61f954f6179bda6bff31efce` over 450 counted files. All Task 14 final gate `result.json` records carry that same measured working-tree source hash; HEAD at gate time was the base commit, not a claim that the committed base contained the fix. The `node_modules` symlink was untracked and not staged.

Scoped commit: `d4e408b9ce0466949134b29995056400f9239d74` (`fix(claude): serialize runner response after interrupt`). Post-commit worktree has no staged or unstaged tracked diff; only the pre-existing untracked `node_modules` symlink remains.

## Root cause and scoped change

The prior [diagnostic report](task14-claude-diagnostic-report.md) preserved the two original Task 5 full-suite RC1 results and observed a new real-process witness: `handleInterrupt` captured `childHadExited=false` before awaiting termination, the fake then exited 0 while its stdout pipe remained held open, and main plus interrupt each wrote JSON. The uninstrumented witness had the same concatenation shape and parse position 541 as the historical runner failure. The historical physical stdout/exit schedule was not retained, so its exact event order remains an inference. The historical `ClaudePhaseAborted` could also arise from a marker observed before the fake's actual exit; that precise original schedule remains unproven.

The runner now re-reads the captured child's actual `exitCode` and `signalCode` after termination/close. A successful exit 0 leaves the complete answer to main. Main and interrupt claim a single finalization owner before asynchronous response work; an interrupt during a main-owned stdout write waits for that write instead of publishing a second JSON or calling `process.exit` while it flushes. The pre-existing runner partial, error, never-started, parent-gone, validation and single-call paths remain in place. No adapter production code changed; its existing execute-only after-stop, exit-0/no-signal/object parse and explicit-token-usage rules are tested. Test-only runner lifecycle and main-claim gate environment variables provide deterministic runner-observed exit and publication-order witnesses; they are stripped before launching the fake CLI and are inert unless explicitly set.

Changed product/test paths: `scripts/claude-phase-runner.mjs`, `tests/runtime/claude/claudePhaseRunner.test.ts`, `tests/runtime/claude/claudeAgentAdapter.test.ts`, `tests/fixtures/fake-claude-cli.mjs`. No Task 9 installation lock, Orca product, main, pin, real configuration, service, provider, remote, or original Results5 WIP was touched.

## TDD and behavior evidence

The new repository-local graceful-exit criterion ran on unchanged runner source first: `t14-fix-red-runner`, RC1, one failed/24 filtered skips, two JSON objects and `JSON.parse` error at position 502. This was a real fake-CLI child, not a mocked child or external-only probe. After the scoped fix it passed in `t14-fix-green-runner` RC0. The final criterion uses a lifecycle-controlled main-claim gate so the after-close exit recheck is load-bearing: M1 produces the wrong runner partial instead of the complete answer. A separate paused-pipe 2 MB response criterion verifies that a later interrupt cannot append a partial or cut an owned flush; M2 produces concatenated JSON at position 2,000,500.

The adapter's two existing `answer-then-linger` execute criteria and the plan-abort control now wait for a **runner-observed** inner `exit(0,null)` while inherited stdout remains open, rather than treating `.answered` as exit proof. The explicit-use criterion also proves `observed-usage.json` is 1109 before abort and that the returned complete execute answer keeps `tokenUsage:15` with no `completionStatus`. A gated-exit companion deterministically exposes the pre-exit state: full streamed envelope and observation 1109 are present, but abort signal-kills the CLI; the adapter raises `ClaudePhaseAborted(observedTokens=1109)`, outcome is runner code 1/no signal with empty stdout, and runner lifecycle records inner exit `(null,SIGTERM)`. A direct runner control sends a full envelope then exits 7; the runner publishes its error partial from the dirty worktree, never that envelope. The plan-abort control still throws. No deadline or arbitrary sleep was added to the existing answer-then-linger tests.

The final focused Claude runner/adapter/fake suite was RC0, **71/71 across 3 files, 0 skips**, raw log and result under `/private/tmp/orca-followup-runs/t14-final-focused/`. Final typecheck and build were each RC0 under `t14-final-typecheck` and `t14-final-build`. `git diff --check` was RC0.

## Clone-only deletion checks

The repeatable script and machine-readable outcomes are `task14-mutants.py` and `task14-mutants-results.json` beside this report. Each mutant cloned immutable base locally, copied only the frozen scoped source into its own `/private/tmp/ccloop-task14-*` clone, linked dependencies/build output without staging, and ran one named fake-only criterion. All five were killed (criterion RC1); the candidate checkout was untouched. The final-source rerun overwrote only the named mutant log directories with its own raw/results, preserving final-source mutant evidence.

| Mutant | Deleted guarantee | Named observed failure |
|---|---|---|
| M1-final-exit-recheck | Reinstated pre-await exit snapshot authority | Graceful criterion returned partial `dirty.txt` instead of complete `inner-success.txt` |
| M2-response-ownership | Removed claim exclusion and main-owned interrupt wait | Paused-pipe criterion received concatenated JSON at position 2,000,500 |
| M3-preserve-explicit-usage | Overwrote explicit token usage with observation | Gated successful-exit criterion got 1109 instead of 15 |
| M4-successful-exit-proof | Removed runner-observed successful-exit wait | Gated criterion got `ClaudePhaseAborted` |
| M5-phase-boundary | Accepted after-stop JSON for every phase | Plan-abort criterion resolved rather than throwing |

## Full and formal gates

All commands ran through `/private/tmp/orca-followup-run.py` with private HOME/XDG/TMPDIR/CCMEM roots, absent `CCMEM_CONFIG_PATH`, a local fake-only [agents table](task14-fake-agents.json), and process-registration-capable execution. `ORCA_CCLOOP_BIN` named this checkout's built `dist/cli.js`. Each run has a `result.json` recording argv, RC, elapsed time, base HEAD, frozen measured source SHA, raw-log path and file count. JSON reporter outputs were preserved. No real provider was invoked.

The [evidence manifest](task14-fix-evidence-manifest.json) records SHA256, byte size, RC, source identity, test counts, and failed names for 36 retained runs, including the review-fix runs below; `task14-evidence-manifest.py` reproduces it.

| Gate | Result | Evidence |
|---|---|---|
| Default-worker unfiltered full suite | **RC1**, 1596 passed / 2 failed of 1598, 0 skips, 148.8 s | `/private/tmp/orca-followup-runs/t14-final-full/{output.log,tests.json,result.json}` |
| Whole CLI test file, three isolated repetitions | RC0 ×3, no failed/skipped criteria | `/private/tmp/orca-followup-runs/t14-cli-file-{1,2,3}/` |
| Whole Codex phase test file, three isolated repetitions | RC0 ×3, no failed/skipped criteria | `/private/tmp/orca-followup-runs/t14-codex-file-{1,2,3}/` |
| Formal `npm run verify:control` | **RC0**, 793/793 across 70 files, 0 skips, 142.5 s | `/private/tmp/orca-followup-runs/t14-final-formal/{output.log,result.json}` |
| Two-worker unfiltered full suite, same frozen source | **RC0**, 1598/1598, 0 skips, 315.0 s | `/private/tmp/orca-followup-runs/t14-final-full-two-workers/{output.log,tests.json,result.json}` |
| `check-known-reds` against final two-worker JSON | RC0, zero failed / zero unexpected | `/private/tmp/orca-followup-runs/t14-final-known-reds/{output.log,result.json}`; JSON above is the input |

The default-worker RC1's **two UNKNOWN failures are retained without waiver**: `parseArgs > returns 0 for the example contract run` timed out at its existing 5000 ms; `Codex skill phase lifetime > keeps links during ignore-term and cleans after child closes` returned `io-error` where the criterion expected `aborted`. Both files passed whole-file 3/3 at lower load. This supports load sensitivity but does not prove the Codex failure's root cause. The failing test's cleanup removed its per-call outcome/process evidence, so the exact `io-error` subtype from that full run cannot be recovered. No unrelated timeout or Codex product change was made solely for those signals. The two-worker full run is a fresh green **unfiltered** gate on the same source, not a reinterpretation of the earlier RC1.

The preceding Task 9 full gate was separately RC1, **1591 passed / 2 failed**, including the historical ClaudePhaseAborted, as preserved in `task-9-report.md` and its raw logs. It is historical evidence, not overwritten or called green by this Task 14 run. This scoped repair proves the deterministic duplicate-publication race and the confirmed-exit usage contract; it does **not** prove the exact historical ClaudePhaseAborted interleaving was repaired.

## Remaining limits

These gates use local fake CLIs and this macOS host. They do not test a real Claude provider, Linux `/usr/bin/flock`, or Orca's final branch/native/browser gates. The controller owns whole-round review and integration; this report is a scoped ccloop handoff, not whole-round acceptance.

## Scoped review fix, round 2

The independent [scoped review](task-14-claude-scoped-review.md) marked the original duplicate-publication Critical addressed and raised an Important concern for SIGTERM followed by exit 0 with no valid answer. Its predicted **empty stdout** mechanism did not occur on the reviewed source: main claims finalization immediately after `runClaude` resolves and, on validation failure, writes exactly one Git-derived partial with `failureType:"error"`. The behavior is still wrong for an interrupted dirty execute, which must retain the timeout partial. This distinction is recorded rather than silently adopting the review's causal hypothesis.

A repository-local real-child test now covers **no result** and **malformed result** separately. Each fake handles TERM by exiting 0 after a held stdout pipe overlaps the interrupt; the worktree contains `dirty.txt`. `t14-r2-red-exit-zero-invalid` was RC1 with two named failures/27 filtered skips: each produced one `error` partial where `timeout` was required. The minimal runner change records that `runClaude` resolved successfully but no complete answer was validated; only when that state coincides with an interrupt does main's already-owned execute fallback use timeout and the recorded signal message. Without interruption, the same missing-answer state remains an error partial. `t14-r2-green-exit-zero-invalid` was RC0 for both new criteria. A separate noninterrupted missing-answer control passed with `failureType:"error"`.

The round-two frozen source SHA256 is `696d4499dcbb7410b30ca9b8ba0dbf7a559c745ae22ac3880c1a9b98ad6b8092` over 450 counted files, on HEAD `d4e408b9ce0466949134b29995056400f9239d74` during gates. Only `scripts/claude-phase-runner.mjs` and `tests/runtime/claude/claudePhaseRunner.test.ts` changed after the first commit. The response owner, exit-after-close guard, adapter execute-only rule and preexit signal refusal were not removed.

Scoped review-fix commit: `e7f69f964cacfc8023b2d03e80a5f9db0694d5d3` (`fix(claude): retain timeout partial for invalid interrupted answer`). `git diff --cached --check` was RC0 before commit. Post-commit tracked tree is clean; only the pre-existing untracked `node_modules` symlink remains.

Round-two clone-only mutant script/results: `task14-r2-mutants.py` and `task14-r2-mutants-results.json`. M1 reinstated pre-await exit authority and the graceful criterion returned the wrong `dirty.txt` partial (RC1). M2 disabled the response owner and the paused-pipe criterion got concatenated JSON at position 2,000,500 (RC1). M6 disabled the new interrupted-invalid-answer timeout choice and both new criteria returned `failureType:"error"` (RC1). Each mutant ran in a fresh local clone; its raw log and `result.json` are in `/private/tmp/orca-followup-runs/t14-r2-M*/`.

| Round-two frozen gate | Result | Preserved evidence |
|---|---|---|
| Focused Claude runner/adapter/fake suite | RC0, 74/74 across 3 files, 0 skips | `/private/tmp/orca-followup-runs/t14-r2-focused/{output.log,result.json}` |
| Typecheck and build | RC0 / RC0 | `/private/tmp/orca-followup-runs/t14-r2-{typecheck,build}/` |
| Unfiltered full suite, two workers | RC0, 1601/1601, 0 skips, 312.1 s | `/private/tmp/orca-followup-runs/t14-r2-full-two-workers/{output.log,tests.json,result.json}` |
| Formal `verify:control` with local fake agents | RC0, 793/793 across 70 files, 0 skips, 142.1 s | `/private/tmp/orca-followup-runs/t14-r2-formal/{output.log,result.json}` |
| Known-reds classification of round-two full JSON | RC0, zero failed / zero unexpected | `/private/tmp/orca-followup-runs/t14-r2-known-reds/{output.log,result.json}` |

The original round-one default-worker RC1 and its two unrelated failures remain above, as do the Task 9 historical RC1 and the limitation on reconstructing the exact historical ClaudePhaseAborted interleaving. None was recast as a green result. The round-two full/formal gates used the same isolated HOME/XDG/TMPDIR/CCMEM and local fake-only agents table as round one. No timeout/skip was changed.
