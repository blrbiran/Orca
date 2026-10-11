# Task14 Claude stop/output diagnosis — diagnostic preparation only

Prepared 2026-10-11 Asia/Shanghai. No product implementation, integration, commit, provider call, publication, deadline change, or whole-round acceptance is claimed. The active Task6 checkout was not edited, built, or tested.

## Identity and evidence preservation

Owned checkout: `/private/tmp/ccloop-task14-claude-diagnostic-20261011`, created with `/usr/bin/git clone --no-hardlinks --no-checkout /private/tmp/ccloop-feedback-followup-20261011 <owned>` and detached checkout of immutable `367066b38f171d01663d7b767fdbfecca7d4f53c`. Only this checkout received a dependency symlink and diagnostic instrumentation. No child agents were used.

The original run metadata logs Git HEAD `5b0adea413b885a1151259d5eb88d21eedcc2ce0` separately from the **measured working-tree** source SHA256 `b325e1b5123b4eb03a6a9de761778e447b8d86165c14325a42bbf5fb96d1586f`, 247 counted source files. These runs included Task5 working changes; that SHA is not attributed to the committed tree of `5b0adea`. `task-5-source-inventory-alias.json` records that working candidate against base `5b0adea`, and `task-5-final-source.json` records it subsequently committed as `8d1f707634318561dcbc151cd6c33f0ef0da6c49`, with the same measured source SHA and changed-file hashes. New diagnostic baseline SHA256 is `84a998e8db7fa95eeb257653bdfc9bba6ed36f1f3541272aafda4aa2cd52c5e5`, 248 files, at immutable commit `367066b38f171d01663d7b767fdbfecca7d4f53c`. The nine scoped byte comparisons actually performed were committed `5b0adea` versus committed `367066b`, not a reconstruction of the historical dirty checkout: relevant runner/adapter/stream/task-result/fixture/test/spec bytes match. Exact per-file hashes and baseline/current bytes are saved in `task14-claude-diagnostic-source-inventory.json` and the evidence source directories. Task5's recorded changed-path inventory contains none of those nine scoped files. Tree-wide identity is not inferred from scoped equality or logged HEAD.

Exact original failure triplets were copied byte-for-byte before investigation:

* `/private/tmp/orca-followup-runs/t5-final3-full/{output.log,tests.json,result.json}`: RC1; 1456 passed / 1 failed of 1457; `claude phase runner waits for close before interrupting a close-pending successful execute`; JSON syntax error at position541, test line846. Full raw log has 691 lines.
* `/private/tmp/orca-followup-runs/t5-final3-full-recheck/{output.log,tests.json,result.json}`: RC1; 1456 passed / 1 failed of 1457; `ClaudeAgentAdapter, the execute result written after a stop (consolidation step 1) a result written after a stop that already carries tokenUsage keeps it`; `ClaudePhaseAborted` at adapter258, test384. Full raw log has 677 lines.

Preserved copies and SHA256/size manifest: `task14-claude-diagnostic-original/manifest.json`. Both complete raw logs and complete JSON reports were consumed, not reconstructed from today's tests. The historical second call directory `/private/tmp/t5u.6QX3Z3/ccloop-tmp-AEQamA/codex-integration-eEL3Pe/run/claude/1/execute/call-PLUjXA` no longer exists; the first fixture did not retain failed stdout. Thus original physical exit/signal histories cannot now be recovered, and a new witness is not mislabeled as original stdout.

## Readiness, commands, and invalid samples

All shell invocations used `rtk proxy`. Tests/probes used `/private/tmp/orca-followup-run.py <owned> <fresh-name> <command...>`; HOME/XDG/CCMEM were private, CCMEM_CONFIG_PATH absent; an owned launcher or shell supplied a fresh short real `/private/tmp/t14*` TMPDIR. Only explicit fake CLI installations were reached. No concurrent full suite or CPU/load generation was used.

Exact verification commands, argv, RC, source identity, raw-log SHA256 and preserved result paths: `task14-claude-diagnostic-commands.json`. Exact source/probe scripts: `task14-claude-diagnostic-{instrument.py,probe.mts,launch.py,run-probes.py,probe-commands.json,instrumented-runner.mjs}`. Runtime raw stdout, traces, adapter call evidence, fixture files, original paths, SHA256 and sizes: `task14-claude-diagnostic-evidence/manifest.json` (229 preserved runtime files at collection).

* `t14-claude-readiness-build`: `npm run build`, RC0, 4.86s, before instrumentation. Full raw build output was read.
* `t14-claude-baseline`: two native Claude files, one worker; RC1, 137.06s; runner 24 passed, adapter failures caused by sandbox `ps` denial before request/CLI launch (21 failed / 27 passed, 13 unhandled errors). This is an **invalid adapter lifecycle sample**, not a product regression. It is fully preserved. A direct default-sandbox `ps` command also returned permission denied.
* `t14-claude-baseline-process`: unchanged checkout, process-registration-capable execution, two exact historical criteria selected; RC0, 2.30s, **2 passed / 46 filtered skips**. This establishes readiness for diagnosis only; it is neither the native full gate nor resolution of historical failures.
* `t14-claude-regression-red1`: proposed diagnostic criterion against runner restored byte-for-byte to immutable HEAD; RC1, **1 failed / 0 skipped**; exact position541 syntax error. This is meaningful RED, not an intentionally expected-error passing test.

Ordinary successful probe harness RC0 only means the trace/result recorder completed. Its `probe-result.json` may document a product failure; RC0 is not called GREEN.

## Failure 1: observed product race

Relevant unchanged production flow: runner268–335, runner616–675; `handleInterrupt` stores `childHadExited` before awaiting `terminateClaudeProcess`; a successful child's `close` independently resolves `runClaude`; normal `main` success has no `interruptHandled`/publication ownership fence. Main's catch alone suppresses interrupted errors.

Three instrumented real-process `runner-graceful` witnesses all recorded this causal order (first trace: `t14-claude-graceful1/probe/trace.jsonl`):

1. Fake has already written its complete success envelope, remains alive, and a separate process retains its stdout pipe.
2. Outer runner receives SIGTERM; snapshot is `childHadExited=false`, exitCode/signalCode null.
3. Runner sends SIGTERM to fake; fake's actual TERM handler exits0. Runner receives inner `exit(0,null)` before retained pipe `close(0,null)`.
4. `close` releases both paths. `main-run-resolved` writes success JSON, **541 bytes**, from normal main.
5. Interrupt continuation records `childHadExited=false` but current child `exitCode=0,signalCode=null`; stale predicate fails. It reads dirty git state and writes a distinct runner partial JSON.
6. Outer result is `code=0,signal=null`, stdout is exactly `successJSON + partialJSON`; JSON.parse fails at **position541 (line1,column542)**.

Exact stdout bytes are `stdout.raw`; chunk boundaries/base64 and each write/callback/stack are in the trace. No mocked child object or manufactured stdout was used. The fake gracefully exiting0 on TERM is an explicit controlled schedule; it is not asserted to be the historical fixture's exact signal behavior.

To exclude logging-induced failure, the owned runner was restored from `git show HEAD:scripts/claude-phase-runner.mjs`. `t14-claude-plain-graceful1` again produced the same two JSONs and position541. A proposed native criterion `tests/runtime/claude/task14Diagnostic.test.ts` then failed identically on the restored production runner (`t14-claude-regression-red1`). Its companion is `task14-claude-diagnostic-proposed-regression.test.ts`; its external-path harness is diagnostic scaffolding, to be made repository-local by the later worker.

Five bounded reproductions of the original split-tail schedule (`runner-original1..5`, started marker then 10ms, tail25ms, exit35ms) returned a single complete success. Those traces observed child exit0 before the interrupt snapshot. They do not refute the real race or determine the historical exact scheduling. Historical position541 plus byte-identical code and new exact-position witness strongly support the same duplicate-publication cause, but without original stdout its precise event order remains an inference.

## Failure 2: marker is not successful-exit proof

Unchanged fixture179–195 writes a full streamed result, creates a stdout-retaining grandchild, writes `.answered`, **then calls process.exit(0)**. A marker-observing test can abort before physical exit, before runner exit notification, or after both. An exit callback inside fake is not itself runner-reported/reaped exit proof. The adapter's abort signals the **entire runner group**; runner inner-child termination additionally signals the child. Distinguish these senders from actual child termination.

`adapter-marker1..3` (normal fixture, instrumentation only) all returned complete tokenUsage15. In marker1 caller abort occurred before the runner's inner-exit event, but the runner processed inner-exit0 before its interrupt snapshot; the snapshot was true. The other two also took snapshot true. These samples are ordinary successful schedules only.

`adapter-exit1..2` explicitly waited for the runner's actual `inner-exit(code0,signalnull)` trace before abort while the retained pipe was still open. Both observed:

* closed-message usage observation **1109** already persisted before caller abort;
* group SIGTERM, runner snapshot true with child exit0, retained pipe close0;
* exactly one complete runner JSON, outer runner exit0/no signal; adapter outcome reason `aborted`;
* adapter's §5.1 post-stop parsing branch returns the complete object and **preserves tokenUsage15**, with usage evidence input12/output3; it does not overwrite with1109.

`adapter-preexit1` is a **controlled timing probe**, not an unmodified reproduction: only the owned fake adds an asynchronous 150ms pause after `.answered` and before process.exit0; no busy wait, deadline extension or product semantic change. Caller sees `.answered` and observed1109, then aborts. Exact trace:

* caller group SIGTERM -> runner interrupt snapshot false -> runner inner SIGTERM;
* actual fake exit is **code=null, signal=SIGTERM**, not exit0; no fake normal exit callback;
* inner close null/SIGTERM; main catches child failure and suppresses it under interruptHandled;
* clean worktree gives no runner partial; runner exits **1/no signal**, prints empty stdout;
* adapter persists reason `aborted`, code1, stdout empty; throws `ClaudePhaseAborted(observedTokens=1109)`.

The received full success event is retained in runner failure-tail evidence in this probe. Receipt of a model envelope is distinct from a successful child/runner exit. Consolidation spec §5.1 explicitly requires **runner exit0/no signal and a JSON object**; §5.1 leaves nonzero/killed cases unchanged, and §9 explicitly registers that reading a flushed post-interrupt Claude answer is not implemented. Therefore this controlled preexit failure is consistent with current semantics, not evidence that adapter tokenUsage preservation is broken. Accepting an envelope from a SIGTERM/nonzero child would expand product semantics and is not recommended as a fixture fix.

The original second raw log contains only the thrown abort, not outcome/raw call files; it cannot prove whether fake was signal-killed, runner output duplicated, or another nonzero/invalid-output interleaving occurred. Marker timing is a demonstrated sufficient explanation, **not a proven reconstruction of that historical run**. Failure1 can also prevent the adapter's post-stop parse from returning a result; keep these hypotheses separate.

## Smallest later scoped implementation recommendation

Implement one runner response-publication ownership/finalization path. Re-read the actual captured child's final code/signal **after awaited termination/close**, allowing normal success to own the response when the child really exited0. Ensure main and interrupt cannot both write or force process.exit while another owned response is flushing. Do not merely add `if (interruptHandled) return` to main success: the graceful successful execute would then lose its answer. Do not treat every parsed envelope as success after signal/nonzero exit. A naive write-once guard alone can accidentally make a premature partial win; response ownership must follow the actual successful-close decision. Validation/errors/partial fallback and parent-gone behavior need their existing semantics retained.

For the two existing `answer-then-linger` execute criteria, replace `.answered`-only success synchronization with proof that the runner has observed the inner CLI's successful exit while stdout remains pending (repository-local test hook/lifecycle witness; no arbitrary sleep or broader assertion). Preserve the exact expectation **tokenUsage15**, prove observation1109 before abort, preserve the no-completionStatus assertion and all existing deadlines. Retain a separate pre-exit-abort criterion that expects abort/observed1109 under current semantics. Do not change plan/verify/singleCall stop rules. The plan-abort control stays necessary.

## Later RED/GREEN, deletion criteria and review requirements

The proposed graceful-exit criterion is already meaningful RED on byte-unchanged runner. Later worker should make this repository-local, run it before the fix, then after one scoped fix; retain raw stdout/exit/close/signal evidence. Add a confirmed-exit0 adapter criterion with usage15 vs observation1109, and preexit signal-kill control. Do not claim success based on serial rechecks alone.

Named clone-only load-bearing deletion checks for later implementation (not executed here because no fix/GREEN exists):

* `T14-M1-final-exit-recheck`: delete the after-close actual exit0 decision / reinstate pre-await snapshot authority; graceful-success criterion must fail with duplicate output or wrong partial.
* `T14-M2-response-ownership`: delete publication ownership fence; a controlled interruption during/after successful response publication must fail for duplicate stdout/incorrect process exit. If graceful M1 criterion alone does not kill this mutant, add a lifecycle-controlled writing/flush interruption criterion instead of claiming coverage.
* `T14-M3-preserve-explicit-usage`: delete the adapter's tokenUsage-undefined guard so post-stop observation overwrites explicit15; confirmed-exit0 usage criterion must report15 vs1109 RED.
* `T14-M4-successful-exit-proof`: delete fixture successful-exit synchronization; controlled preexit pause must distinguish signal-killed path and must not be allowed to satisfy the complete-answer/tokenUsage15 criterion.
* `T14-M5-phase-boundary`: delete execute-only post-stop eligibility; existing aborted-plan criterion must fail. Preserve nonzero/killed/non-object refusal controls.

Independent scoped spec and quality review are required after implementation and after any review fixes. Required broader package/native/formal gates belong to the final repaired tree and controller. This report provides no Task14 closure or whole-round acceptance.

## Runtime cleanup and limits

Final recorded runner/fake PID check: `task14-claude-diagnostic-process-check.json`; specific observed PIDs produced no rows (`ps` RC1 empty stdout/stderr means none exist). The fixture's grandchildren were stopped via adapter group SIGTERM/SIGKILL or their bounded timer exits; they were not individually recorded in the original fixture, so this PID check is explicitly limited to recorded runner/fake PIDs, not a universal process census. No process unrelated to these probes was signaled.

Owned checkout remains diagnostic: adapter and fake instrumentation plus proposed test; runner restored to immutable HEAD bytes for the uninstrumented RED. Diagnostic artifacts remain for review. Nothing was staged or committed.
