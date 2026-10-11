
## Task 5 implementation evidence — 2026-10-11, pre-commit checkpoint

Owner: execution_evidence_impl. Product scope is only `/private/tmp/ccloop-feedback-followup-20261011`, branch `codex/feedback-followup-20261011`, base `5b0adea413b885a1151259d5eb88d21eedcc2ce0`. No original worktree edits, remote operations, default repins, live service/library changes or real providers. All test runs used the isolated `/private/tmp/orca-followup-run.py`, fresh short real private TMPDIRs, and fake providers. Process tests required the authorized unsandboxed owned-process identity path.

Implemented: strict provider-neutral execute normalizer using the existing bounded scanner; direct/exact-envelope complete and partial execution with semantic envelope/body deduplication, answer-shaped ambiguity/hidden-span/depth refusal and original opaque-report fingerprints. Codex validates intact unique completion and finite actual usage before final schema decoding. `ExecutionFormatFailure` preserves usage evidence and by-model usage through `PhaseExecutionError`. Plan and verifier extraction/acceptance remain unchanged.

The controller captures under its held owner fence after the settled process and skill cleanup and before attempt cleanup. The capsule binds accepted identity, frozen hash, exact accepted/runtime contract artifacts, sealed config, pre-provider source base/start HEAD, original final/events/schema/outcome/process/decode/normalization/plan/usage artifacts, known settled ledger/high water, positive controller verifier-not-entered proof and owner record. Complete snapshots contain original Git index, staged-tree commit/bundle, full regular-file bytes/modes including untracked and ignored inputs, directory modes and deletions. Content-addressed private bytes are synced before atomic index publication. Capture refusal leaves the original run failed and records an unavailable reason.

The separate unadvertised RPCs are `saved-result-evidence {input}` and `read-saved-result-evidence {input,capsuleRef,ref}`. They validate accepted identity, capsule identity and all typed reachable hashes/private ancestors. `features` remains `{protocol:1,tokenPolicy:"optional-v1"}`. Core protocol3 collect/terminal/candidate shapes and artifact lists are not extended. Real built-CLI audit read all 18 core artifact refs of a capsule-present failed run, found no capsule/snapshot refs, and verified core reads of both private refs refuse with `control-evidence-ref-invalid` while the new channel succeeds. Orca's actual unchanged v3 parser accepted all keys and values.

Full product self-review included all changed source and new tests; `task-5-source-inventory.json` lists exact paths, bytes and hashes. No old assertion or old test file was edited. Only new criteria were added.

### RED/GREEN and corrections retained

- `t5-normalizer-red-01`: new API absent; 1 expected failed suite. `t5-normalizer-green-01`: 77/77 including existing scanner criteria.
- `t5-adapter-red-01`: typed failure API absent; 1 expected failed suite. First process GREEN attempt (`t5-adapter-green-01`) had 22 process/identity sandbox failures and 38 passes, fully read. Authorized unsandboxed rerun (`...green-02`) yielded 59 passes and one new test's wrong fixture split (expected10/5; actual12/3, total15). Corrected only the new test; subsequent focused runtime checks pass.
- `t5-capsule-red-01`: 3 expected missing-command failures. Initial GREEN runs diagnosed an implementation assumption that semantic agentConfigHash hashes every config field; source inspection showed deliberate command/version/timeout exclusions. Corrected to the existing agentConfigHash function and separately retained exact config bytes. Corrected the known usage source payload shape from assumed wrapper to actual phase observation. `t5-capsule-green-03`: 3/3.
- Expanded bundle restoration initially used default `git clone` fetch, which does not fetch custom `refs/ccloop/...`; the bundle was valid. The new test now explicitly fetches its exact bundle ref before checking staged content/tree. `t5-capsule-expanded-02`: 27/27.
- Initial legacy consumer probe compared JSON serialization order and failed because the unchanged consumer reorders candidate terminalOutcome/stopProof. Exact structural keys and values matched, and three metadata-leak additions were rejected; `t5-legacy-consumer-02` records those actual key orders. No consumer code was changed.
- Self-review found reread authority could be changed to a different permitted narrowed runtime value or command omitted from semantic config hash. `t5-exact-authority-red` reproduced both actual fake-provider rewrites: 2 failed, 7 intentionally unselected. Worker/controller now convey the exact configuration and actual runtime contract values used; capture compares every value to them separately from permitted frozen/runtime derivation. `t5-exact-authority-green`:32/32, source `007853cdbe574c190f0334979a38a579e7a8f6554f7ae6b9365c5db426070f7c`.

### Source-specific verification

Historical candidate `71756d186bc38cf8ae15874561e0e2efa7c75936a325d95aa0a9dfd83093da70` passed package1454/1454, native681/681, typecheck and build, with zero skips; it does not cover the authority correction. All first-round seven mutants were detected and restored0/0 but are historical only.

Corrected candidate `007853cdbe574c190f0334979a38a579e7a8f6554f7ae6b9365c5db426070f7c` passed package1456/1456 across142 files, zero skips/todos, fresh typecheck, plus exact-source clone build and32/32 clone baseline. Full raw plus every per-test JSON result were audited and recorded in `task-5-full-audit-final.json`; exact argv/RC/source/log hashes appear in verification companions. Expected CLI rejection test stderr (`usage:`/EEXIST) is not a suite failure. Native/final mutations and final commit identity are appended below when complete.

### Task 6/7 boundaries and concerns

Task5 only preserves evidence; current malformed finals still normalize unavailable, so a complete capsule never licenses invented execution core fields. Task6 owns strict eligibility, legacy archives, verifier-only execution, replay/entry fences, and feature advertisement. Task7 owns consumer negotiation and separate recursive archival. Do not put capsule refs, recovery mode/entry metadata or their manifests into core protocol3 artifact lists or core read scope.

Codex is the supported original-evidence decoder. Ordinary Claude behavior remains unchanged by the controller's §6.4 ruling; unsupported provider evidence gets `saved-result-provider-original-evidence-unsupported`. No fallback model/Agent call is made. Missing evidence is `saved-result-original-evidence-unavailable`.

Conservative snapshot limitation: symlinks, submodules, nested repositories, special files, more than10,000 files/directories or oversized blobs refuse capture instead of claiming completeness. This includes otherwise ordinary repositories containing ignored `node_modules/.bin` symlinks. Only root controller Git metadata is excluded; ignored candidate inputs are not silently omitted. Each saved blob is bounded to12MiB−1024 bytes to allow base64 plus the16MiB control response envelope; a larger Git history bundle can therefore make recovery unavailable. Directory/file modes, staged/unstaged differences and deletions are captured for supported regular-file snapshots.

At this checkpoint, usage-ledger nested original-ref versus private-copy mapping was escalated for controller ruling; final interface choice will be appended. Native wire audit is an external retained verification companion rather than a new cross-repository product test dependency.

## Controller alias ruling and final refreeze

Controller §6.5 chooses explicit capsule-scoped aliases: `artifacts.usageObservations` is now an array of strict `{source: ArtifactRef, copy: ArtifactRef}` pairs. `source` is the unchanged original ledger event.source ID/hash pair; `copy` is the immutable private saved-result blob with the same hash. The new reader checks the aliases match the original raw ledger event sources in order, validates the private copied blobs, and resolves only an exact declared source ID AND hash under the accepted run/attempt/capsule. It never performs a same-hash arbitrary-ID fallback or reads a mutable original core artifact for an alias. Core protocol3 authority is unchanged. Tasks6/7 should traverse capsule refs, snapshot refs and these typed alias pairs; original ledger bytes remain unchanged.

`t5-alias-red`: actual recursive ledger read refused (1 expected failure,9 intentionally unselected). `t5-alias-green`:33/33 including recursive original-ref reads, undeclared same-hash ID refusal, foreign capsule refusal and copied observation byte tamper detection. New source tree is `b325e1b5123b4eb03a6a9de761778e447b8d86165c14325a42bbf5fb96d1586f`; the previous007853cd results are historical pre-alias evidence only.

Evidence correction: `t5-final2-native` returned0, but alias edits overlapped its execution, so it is explicitly discarded for acceptance (source-mixed). Filesystem nanosecond mtimes: native result1791674716391376734; alias test edit1791674691029729774; alias source edit1791674711526745524. No final claim uses this run. Subsequent final3 gates are run on the refrozen alias source without any source edits.

## Final alias suite failure and investigation (no source changes)

`t5-final3-full` on b325e1 returned1:1456pass/1fail/0skip across142files. The sole failure was unchanged `tests/runtime/claude/claudePhaseRunner.test.ts > claude phase runner > waits for close before interrupting a close-pending successful execute`, at line846 parsing runner stdout: `Unexpected non-whitespace character after JSON at position541`. Complete raw+per-test JSON was audited in `task-5-full-audit-alias-first.json`. The final source's Claude runner script and this old criterion are byte-identical to the base; prior full gates passed it.

`t5-claude-race-recheck` reran the entire unchanged24-test file in a fresh isolated environment and passed24/24. Source inspection suggests an existing race between handleInterrupt's pre-await childHadExited snapshot and the main successful-result write, which does not suppress its output once interruption is in progress; this is an inference because the original fixture did not retain its failed stdout bytes. No assertion/timeout/source change or waiver was made. A fresh full rerun is justified by the failure and will be recorded separately; even if green, the initial intermittent remains a disclosed concern.

### Second full result on unchanged final alias source

`t5-final3-full-recheck` returned1:1456pass/1fail/0skip. The original close-pending test passed; the sole failure moved to unchanged `tests/runtime/claude/claudeAgentAdapter.test.ts > ClaudeAgentAdapter, the execute result written after a stop (consolidation step 1) > a result written after a stop that already carries tokenUsage keeps it`, which threw ClaudePhaseAborted at line384. Complete raw/per-test audit is `task-5-full-audit-alias-recheck.json`. `task-5-claude-unchanged.json` proves both failing test files, the Claude adapter and runner script exactly match base5b0adea bytes. No test/assertion/timeout changes or acceptance waiver. Controller was asked about a complete serial-worker execution to remove suite contention; no third default parallel retry is planned.

## Controller-approved final gate handling

Controller authorized one complete serial-worker package gate with `--maxWorkers=1 --minWorkers=1`, unchanged assertions and deadlines, as isolation/coverage only. The two prior Claude failures remain unresolved out-of-scope observations and mandatory Task14 investigations before whole-round acceptance; no inference here is labeled a fix. Exact failed paths: `/private/tmp/orca-followup-runs/t5-final3-full/{output.log,tests.json,result.json}` and `/private/tmp/orca-followup-runs/t5-final3-full-recheck/{output.log,tests.json,result.json}`. Both use source tree b325e1b5123b4eb03a6a9de761778e447b8d86165c14325a42bbf5fb96d1586f.

Final native `t5-final3-native` passed684/684 across65files, zero skips, and built this clone's CLI. Complete raw log read in contiguous byte ranges0–20000,20000–40000,40000–52543 (UTF-8 file bytes). Exact fake table `/private/tmp/t5v.GnzrS6/agents.json`, SHA2561fbe389b10ca884c72c6921b21a641de8506859a6cae902cb23fcf47cdef6edf. Final typecheck passed. Final built-CLI wire audit `t5-final3-wire` passed: unchanged old consumer exact keys/values,18core refs checked, capsule/snapshot core-read exit2,2original-ID aliases served, and a deliberately tampered mutable original observation did not affect its private immutable alias. The original fake evidence bytes were restored. Full retained native fixture and audit are `task-5-native-wire-evidence-final.json`.

## Final serial gate and product inventory

Controller-authorized `t5-final-serial` completed0:1457/1457 across142files,0skips/0todos, unchanged b325e1 source. Exact argv includes `npm test -- --maxWorkers=1 --minWorkers=1 --reporter=default --reporter=json --outputFile=/private/tmp/orca-followup-runs/t5-final-serial/tests.json`. Observed elapsedSeconds393.09683084487915 comes from the runner; no token/cost estimate is claimed. Full per-test audit and raw hashes are `task-5-full-audit-serial.json`. Both unresolved Claude criteria passed here; this is coverage, not a repair or dismissal of their parallel failures. No extra diagnostic clone was run for speculative Claude mechanism; Task14 must obtain actual ordering traces.

Final product file inventory (all and only12paths; no existing assertion edits):

- src/control/command.ts
- src/control/protocol.ts
- src/control/savedResultEvidence.ts
- src/control/worker.ts
- src/controller/executionFormatFailure.ts
- src/controller/runLoop.ts
- src/runtime/codex/codexAdapter.ts
- src/runtime/codex/protocol.ts
- src/runtime/executionNormalizer.ts
- tests/control/savedResultEvidence.test.ts
- tests/runtime/codex/executionFormatFailure.test.ts
- tests/runtime/executionNormalizer.test.ts

Final33-test clone baseline passed on mutation clone commitc52dd68b0c9715a2f27cb9f807aa4c9ae30c96f1, with247source/script/test/config files identical to product source and successful clone build. Readiness manifests include all file SHA256/byte sizes; the original clone command used `--local --no-hardlinks`. Final targeted mutations are appended after completion.

Raw logs, argv/RC/source metadata and per-test JSON are also copied under append-only `task-5-evidence/<run-name>/`; `task-5-verification-precommit.json` indexes all completed runs at this checkpoint. Original `/private/tmp/orca-followup-runs/` paths remain intact. Earlier sandbox classification is based on codex-io-error process failures and the paired same-source escalated run; those fixtures deleted their per-call directories, so the exact initial syscall error was not retained.

## Final mutation results

All10final mutants were detected on the final alias baseline, exclusively in the no-hardlink clone. Exact mutation text, argv, source hashes, raw logs and every failed criterion are retained in `task-5-mutations-alias-final.json`, `task-5-mutation-audit-final.json` and the raw/per-test JSON evidence directories. Every run restored unstaged/index diff byte counts0/0; final clone also0/0. No test artifacts were deleted to simulate a mutant. Tests invoked the existing absolute Vitest entrypoint; no npx/download.

Credited witnesses:

- alias-pair: removing exactID matching allows an undeclared same-hash alias; recursive alias criterion fails.
- actual-config: removing exact in-memory config comparison makes the provider command rewrite qualify; rewrite-config criterion fails.
- actual-contract: removing exact in-memory runtime comparison makes a permitted-but-never-executed narrowed value qualify; rewrite-runtime criterion fails.
- wrapping: deleting envelope/body semantic identity fails complete/partial whole/decorated envelopes and duplicate semantic answer criteria.
- ambiguity: deleting exactly-one-shaped-node requirement admits valid+invalid independent candidates; both ambiguity fixtures fail.
- usage: deleting modelUsage propagation through PhaseExecutionError settlement drops the real worker by-model evidence; expected finite split is absent.
- identity: deleting capsule source-identity equality lets a hash-valid foreign-run capsule through; source identity criterion fails.
- capture-before-cleanup: deleting the controller capture call loses the durable snapshot; primary original-attempt/snapshot criterion and narrowed-source capsule criterion fail. Additional dependent setup errors (missing capsule/files) are retained but receive no independent mutation credit.
- nested-hash: deleting copied-blob digest validation admits tampered snapshot/usage-copy bytes; both corresponding criteria fail.
- v3-leak: injected capsule metadata in core collect fails the strict protocol3 response boundary. Separate final native audit covers actual artifact-list/core-read nonleakage.

No product source changed after final alias freeze. Full final product diff was self-reviewed, with no old assertions rewritten or loosened. Remaining limitations are the explicit conservative capture refusal boundary and the two unchanged Claude timing criteria reserved for Task14; no speculative Claude code repair is included.

## Final commit and handoff status

Task5 implementation committed as `8d1f707634318561dcbc151cd6c33f0ef0da6c49` (Git tree `9f13f544e14106e1fa1f7eeba12c7f8bdf8410a6`), message `feat(recovery): retain strict execution format failure evidence`, with one-command `core.hooksPath=/private/tmp/orca-empty-hooks`. Exactly the12owned source/test files were staged; no node_modules, parent docs or other task files. Final sourceTreeSHA256 remains `b325e1b5123b4eb03a6a9de761778e447b8d86165c14325a42bbf5fb96d1586f` and matches all credited final gates and clone baseline. Main tracked unstaged/index diffs are0/0; only the pre-existing node_modules symlink is untracked. `task-5-final-source.json` records per-file hashes/bytes and CLI SHA.

Final credited summary: serial package1457/1457 (142files), native684/684 (65files), focused33/33, type/build successful, native old-consumer/private-alias audit successful,10/10targeted final mutants detected and restored0/0. Second unchanged Claude adapter file was also rerun alone in `t5-claude-adapter-recheck`:24/24. No skips in these credited gates; only the explicitly named targeted RED runs intentionally left7/9other tests unselected. All completed command metadata, raw logs and per-test JSON now reside in `task-5-evidence/`; `task-5-verification-final.json` indexes 58runs, including all failures and excluded historical/source-mixed attempts.

Final-check disclosure: staged `git diff --cached --check` returned2 for only `src/runtime/executionNormalizer.ts:35: new blank line at EOF.` The subsequent batched commit still ran. This harmless whitespace warning is retained transparently; the tested source was not silently edited after final gates. Earlier unstaged checks could not see then-untracked new files. This is a cosmetic review concern, distinct from functional verification.

Status: IMPLEMENTED, ready for independent controller review. Task6/7 interfaces and limitations are above. The two unchanged Claude timing failures remain mandatory Task14 investigations even though their isolated and serial outcomes are green; no whole-round acceptance is implied. No remaining Task5 source change is planned pending review.

## Direct final gate and mutation provenance

All paths below are complete raw logs; each sibling result.json records exact argv/RC/source identity, and tests.json exists for serial/full and mutation runs.

| Gate | Raw log path | RC | Raw SHA256 |
|---|---|---:|---|
| t5-alias-green | `/private/tmp/orca-followup-runs/t5-alias-green/output.log` | 0 | `cda3c851cd5d1ebe3716ffe6b8c75a9b4eb190d3e917ff0e33e42c072b64213b` |
| t5-final3-types | `/private/tmp/orca-followup-runs/t5-final3-types/output.log` | 0 | `443df7778c6055e93ca0f3f4fabce5cbbe7205fa5689a62bd08268806118c185` |
| t5-final3-native | `/private/tmp/orca-followup-runs/t5-final3-native/output.log` | 0 | `61d8151d958b4542b3c2a6b79af65a5a6fb94f7dc726ad24f30c1221ef689f24` |
| t5-final3-wire | `/private/tmp/orca-followup-runs/t5-final3-wire/output.log` | 0 | `18561552eed28bc43bc640533007af7def0037123708c9381245dbefc166c439` |
| t5-final-serial | `/private/tmp/orca-followup-runs/t5-final-serial/output.log` | 0 | `ca2f3ca3ed6ef5874f4978747beb957f768fe4b70a7691a18f9c1663a726f31e` |
| t5-clone3-build | `/private/tmp/orca-followup-runs/t5-clone3-build/output.log` | 0 | `aefbc9b778e411edd79554b58143dc8c252dbc805ec4e91e0c180ac3c2e15cfd` |
| t5-clone3-baseline | `/private/tmp/orca-followup-runs/t5-clone3-baseline/output.log` | 0 | `219c754dedffa1c84bd356cdb926c819fb1b3095efdf62c399bd2160964e1cad` |
| t5-claude-race-recheck | `/private/tmp/orca-followup-runs/t5-claude-race-recheck/output.log` | 0 | `9f8106c1c8de7bbd25f80df7ba4b21170ed2583582eeec95afd014ccbb2f0df8` |
| t5-claude-adapter-recheck | `/private/tmp/orca-followup-runs/t5-claude-adapter-recheck/output.log` | 0 | `c6716ad7e25ec6d74f82b314937a2642a979a877061395e395e68aa994ea2fb3` |

| Final mutant | Raw log path | Intended detection RC | Restored unstaged/index bytes | Raw SHA256 |
|---|---|---:|---|---|
| alias-pair | `/private/tmp/orca-followup-runs/t5-final-mutation-alias-pair/output.log` | 1 | 0/0 | `7cd3770b3499d55aa695b293ad86d61d1071752d1769662eca243d4f196f7c5c` |
| actual-config | `/private/tmp/orca-followup-runs/t5-final-mutation-actual-config/output.log` | 1 | 0/0 | `7780206097fec9a624c7ff8a3c7fbfec89662d9dba678f42dd28873bbc2b8206` |
| actual-contract | `/private/tmp/orca-followup-runs/t5-final-mutation-actual-contract/output.log` | 1 | 0/0 | `980febfb42271208b82cb7c5246b00a26b305700c66f546c9adafbbc93c2f494` |
| wrapping | `/private/tmp/orca-followup-runs/t5-final-mutation-wrapping/output.log` | 1 | 0/0 | `fe4b22f383d8f0161c0695ce1314eae45ca0fda9d978c162bfae5d988a1337db` |
| ambiguity | `/private/tmp/orca-followup-runs/t5-final-mutation-ambiguity/output.log` | 1 | 0/0 | `24fa0a0321507443dedcc49e668d5d58810544b0082144337039719c8aa39156` |
| usage | `/private/tmp/orca-followup-runs/t5-final-mutation-usage/output.log` | 1 | 0/0 | `5c0a72db1b8d06bdc18beca3466229f63855add5e031cc43553efa1bc5668f31` |
| identity | `/private/tmp/orca-followup-runs/t5-final-mutation-identity/output.log` | 1 | 0/0 | `8a26958378c398c7ab02e8455bd58693e016ee832aa1ed9059f6eb2bc3c6b0fe` |
| capture-before-cleanup | `/private/tmp/orca-followup-runs/t5-final-mutation-capture-before-cleanup/output.log` | 1 | 0/0 | `e5d2254f1a739b8344116f788408c757e056f23755ac17450caaf2d28665c3ee` |
| nested-hash | `/private/tmp/orca-followup-runs/t5-final-mutation-nested-hash/output.log` | 1 | 0/0 | `f5637d29dbf64a7cca45bc8c2182cfb9d4209aca3ff74c55165a83b5dd162ce6` |
| v3-leak | `/private/tmp/orca-followup-runs/t5-final-mutation-v3-leak/output.log` | 1 | 0/0 | `f03e4ee6282c5a2ec810bfe2fe93f420198d776c52936349c05ef26caec0c5fc` |

Controller explicitly accepted retaining the disclosed EOF warning for final hygiene; no post-gate formatting edit or rerun. Final status contract: DONE_WITH_CONCERNS, independent review pending.

## Fix round 1 started — review I1/I2/M1/M2

BASE8d1f707634318561dcbc151cd6c33f0ef0da6c49. Read complete independent review, both raw reviewer business failures, reproduction sources, and controller recovery spec§6.6/ruling. Verified current ordering re-resolves the symbolic base after real worktree creation and current mode mask removes0o7000. Scope remains only the base initialization relation, conservative mode refusal, EOF hygiene and routine collection-log removal. Old Claude timing investigations remain out of scope and unresolved.

Existing legacy checkpoint schema carries snapshot HEAD but no trusted original-base identity. The scoped fix will leave ordinary continuation materialization intact, preserve its distinct verified HEAD, and mark saved-result capture `saved-result-original-base-unavailable` for such continuations rather than infer the base from current target or substitute continuation HEAD. Fresh controlled Codex runs freeze the accepted base before first creation and pass that exact commit to every fresh attempt workspace.

### Fix-round refinement and diagnostic record

Correction to the initial fix plan above: controller required preserving ordinary retry semantics. Final code freezes HEAD of the actual runtime repository separately immediately before each fresh workspace creation and passes that exact commit, preserving the prior default-HEAD policy for every attempt/infra retry. It does NOT freeze one base for the entire run and does NOT reread current target refs after creation. Accepted envelope.base remains separately recorded. A real two-attempt fake-provider regression moves the target during verifier rejection and confirms attempt2 captures its new ordinary initialization origin.

For a real checkpoint, an accepted immutable40/64hex commit SHA may establish original-base authority: the helper checks commit type and ancestry against the hash-verified restored HEAD. A real checkpoint materializer test restores a descendant HEAD distinct from its accepted original commit, then verifies valid/missing/unrelated/symbolic cases. Symbolic legacy base has precise original-base-unavailable. An actual immutable-base legacy worker still preserves the independent runtime-context refusal because prepareContinuationContract adds legacy prompt context outside the existing allowed semantic derivation; no runtime exception was widened.

Mode guards reject0o7000 for root, files and directories in both capture/stability passes; root ordinary permissions are additionally retained as private snapshot.rootMode. Native chmod probing showed /private/tmp entries inherit gid0 while the test user is gid20; setgid is stripped unless the owned fixture entry is first assigned to the user's own group. The new fixtures now use chown only on their own temporary entries and independently confirm actual special bits. `t5-fix1-mode-probe` retains the successful native proof. An initial sandbox probe also stripped setgid; no product behavior was changed to accommodate the fixture.

Focused evidence: t5-fix1-red had8business REDs plus2fixture spy setup errors (`Cannot redefine property: readdir`),10unselected. The fixture was corrected using the project's established real-fs delegation mock pattern. t5-fix1-stability-red then had3actual mode REDs/18unselected. First GREEN had18pass/3fixture-group failures; after native group correction t5-fix1-green2 passed21/21. t5-fix1-immutable-red had2expected failures/21unselected (missing ancestry helper and blanket missing-base refusal). t5-fix1-covering passed115/115 across5files. t5-fix1-retry passed the added ordinary retry criterion (22intentionally unselected), source7a402f155ebca04dde42216b961acc9f3b82d35f2d53a1964e0066c8850bcd1b. All raw logs and per-test JSON will remain in the fix evidence archive.

M1 trailing EOF blank is removed. M2 routine whole-collection console dump is removed with every assertion retained; the explicit external native collector remains the full wire evidence source. Existing `captures original attempt, usage, full snapshot and exact runtime bytes before cleanup without changing v3` only gains positive root/directory0755 assertions; no old expectation is weakened or removed. Staged `git diff --cached --check` now returns0 before final verification/commit.

### Final fix source and checkpoint graph proof

Fix source frozen at84a998e8db7fa95eeb257653bdfc9bba6ed36f1f3541272aafda4aa2cd52c5e5 (248source/script/test/config files), BASE8d1f707. Final covering gate116/116 across5files; final typecheck passes. The six owned paths are src/control/savedResultEvidence.ts, src/controller/executionFormatFailure.ts, src/controller/runLoop.ts, src/runtime/executionNormalizer.ts, tests/control/savedResultEvidence.test.ts, and new tests/controller/executionBase.test.ts. No Claude source/test changes.

The immutable checkpoint proof now ignores mutable Git replacement refs. A focused actual Git RED (`t5-fix1-raw-ancestry-red`) demonstrated an unrelated original commit becoming apparently ancestral through git replace. `--no-replace-objects` on the commit/type and ancestry operations fixes that same I1 authority boundary; the final covering criterion validates original parent/descendant, symbolic refusal, missing/unrelated commits and replacement-ref refusal through a real verified checkpoint materializer. Existing frozen/runtime semantic exceptions remain unchanged.

The source's default fresh-workspace HEAD semantics and ordinary retry behavior are retained. Captured `resolvedBase` is that attempt's actual pre-creation initialization commit; it is not a later resolution of acceptedBase. Checkpoint accepted immutable base is separately ancestry-proven against the restored HEAD. Legacy symbolic origin remains unavailable. Root normal permissions are now an explicit private snapshot.rootMode field, with07000 rejected before completeness. Private schema remains unadvertised; protocol3 core shapes/authority gain no fields.

### Fix-round frozen native/wire gates

`t5-fix1-native` passed698/698 across66files, no skips, including an actual fresh build of this clone's CLI. Raw log read completely in consecutive byte spans0–20000,20000–40000,40000–50279. Exact fake Agent table `/private/tmp/t5v.nIzEXf/agents.json`, SHA25671c42d2e9c90195e441fe2b6e559e9eb053bdbcb51e043aa6ec7e286a521ecfb. Native CLI path remains `/private/tmp/ccloop-feedback-followup-20261011/dist/cli.js`.

`t5-fix1-wire` passed actual unchanged Orca v3 reader keys/values,18core refs without private metadata, exit2 for core capsule/snapshot reads,2exact observation aliases, and private-copy independence from mutable-original tampering/restoration. Saved evidence is `task-5-fix1-native-wire-evidence.json`; the collector is explicit, so M2's routine console dump is unnecessary. Final serial package run is now executing on the same84a998e8 source with no concurrent tests or source edits. Prior Claude observations are retained, not declared fixed.

### Fix-round serial package result

`t5-fix1-serial` passed1471/1471 across143files,0skips/0todos, source84a998e8 unchanged. Exact argv is retained with `--maxWorkers=1 --minWorkers=1`; all per-test results and complete raw bytes were audited in `task-5-fix1-full-audit.json`. Raw SHA256af14121dee71fa5613258c186bdf3e33f73ac1d42c254f7be57853038eeea588; JSON SHA256bd9f421e43d19ed89a6f599a14fcb215fc5904d1ed7d1ad719641c5cb7504b85. Expected existing CLI negative-case usage/EEXIST stderr remains non-failure output. Observed runner elapsedSeconds416.43124198913574; no estimated token/cost claims.

The new no-hardlink mutation clone is `/private/tmp/ccloop-task5-fix1-mutations-20261011`, baseline commit16e11e2a9b1e6cae8a5ed3bedc344afd53c3a4d7; all248source/script/test/config files match the product tree. Fresh clone build passes. Specific base/mode mutants will run only after the unmutated focused baseline passes. The unrelated historical Task5 mutants are not repeated.

### Fix-round scoped mutation closure

Clone baseline24/24 passed with no skips after build/readiness. All9fix-specific mutants were detected, each with only intended business assertion failures and restored unstaged/index diff0/0. Filtered mutant runs intentionally leave unrelated criteria unselected; those are counted below, not silently described as zero skips. Absolute existing Vitest entrypoint used; no npx fetch or test-artifact deletion. Details in task-5-fix1-mutations.json and task-5-fix1-mutation-audit.json.

| Mutant | Intended failure(s) | Unselected | Restored diff bytes |
|---|---|---:|---|
| base-pin | fix I1 freezes the materialized base across target movement before workspace creation | 22 | 0/0 |
| base-reread | fix I1 freezes the materialized base across target movement after workspace creation | 22 | 0/0 |
| retry-origin | fix I1 preserves ordinary retry choice while binding each attempt's actual origin | 22 | 0/0 |
| immutable-base | proves an immutable original base distinct from the real restored checkpoint HEAD | 0 | 0/0 |
| base-ancestry | proves an immutable original base distinct from the real restored checkpoint HEAD | 0 | 0/0 |
| raw-ancestry | proves an immutable original base distinct from the real restored checkpoint HEAD | 0 | 0/0 |
| special-mode | fix I2 refuses unsupported file mode 2541 before complete capture; fix I2 refuses unsupported file mode 1517 before complete capture; fix I2 refuses unsupported directory mode 1517 before complete capture; fix I2 refuses unsupported directory mode 1005 before complete capture; fix I2 refuses unsupported root mode 1005 before complete capture | 18 | 0/0 |
| entry-stability-mode | fix I2 refuses file special bits introduced during the stability pass; fix I2 refuses directory special bits introduced during the stability pass | 21 | 0/0 |
| root-stability-mode | fix I2 refuses root special bits introduced between capture passes | 22 | 0/0 |

Complete fix raw logs/result metadata/per-test JSON are archived in task-5-fix1-evidence; task-5-fix1-verification-final.json indexes them. All former Task5 evidence/source hashes remain intact. No speculative Claude repair or unrelated historical mutant repetition occurred.

### Fix RED-credit correction from final audit

The earlier shorthand “8business REDs plus2spy setup errors” for t5-fix1-red was too broad. Do not credit the two initial setgid cases: their inherited gid0 fixtures could not establish actual setgid bits, as the native probe and first GREEN failures proved. Credit the two base-drift cases, the missing-origin case and the real setuid/sticky cases; record two spy-setup and two group/mode-setup failures separately. Likewise the directory case in t5-fix1-stability-red is not credited before the owned-group correction. The later real-mode GREEN and scoped mutants establish both directory/file setgid guards and both stability passes without relying on those invalid inputs. No final gate was excluded for infrastructure and no assertion was relaxed.

## Fix round1 final commit and review handoff

Committed `367066b38f171d01663d7b767fdbfecca7d4f53c` (Git tree `a21006f9d45b1277299b72160b7aa3b2ec6a0948`), BASE8d1f707, message `fix(recovery): bind initialized bases and reject lossy modes`. The final staged diff-check was executed in its own tool call, returned0, and only then was the commit command invoked in a separate call with one-command empty hooksPath. Six owned source/test paths only; no parent docs/node_modules staged, no push/merge/repin. Product tracked unstaged/index diffs are0/0; only the pre-existing node_modules symlink is untracked. Source remains `84a998e8db7fa95eeb257653bdfc9bba6ed36f1f3541272aafda4aa2cd52c5e5`, exactly matching all credited final fix gates and the restored mutation clone.

I1/I2 and M1/M2 are implemented and ready for original-reviewer scoped re-review. Final credited fix gates:116covering,1471serial package,698native,24clone baseline,types/build/wire successful;9specific mutants detected and restored0/0. Full/covering/native/baseline gates have no skips. Mutation/RED selectors' unselected counts are explicitly retained in their records. No unrelated historical mutants were rerun.

Task6/7 interface delta: private execution snapshot now includes rootMode; file/directory/root nonzero07000 flags fail capture with saved-result-mode-unsupported. Each fresh attempt's resolvedBase is its pinned actual initialization HEAD; continuation resolvedBase is separately proven from immutable accepted commit plus raw ancestry against restored HEAD, never from current symbolic target state. Unknown legacy origins fail saved-result-original-base-unavailable; existing legacy runtime-context mismatches remain refused. Frozen accepted semantics/hashes and protocol3 core shapes remain unchanged. Current capsules still do not license invented core execution or inferred verification.

Remaining concerns are explicit conservative continuation/capture limits and the two pre-existing Claude timing observations reserved for Task14; this fix contains no Claude repair or whole-round acceptance claim. Final evidence indices: task-5-fix1-verification-final.json, task-5-fix1-full-audit.json, task-5-fix1-mutations.json, task-5-fix1-mutation-audit.json, task-5-fix1-readiness.json, task-5-fix1-final-source.json; raw/per-test companions live under task-5-fix1-evidence.

| Final fix gate | Exact raw log | RC | Raw SHA256 |
|---|---|---:|---|
| t5-fix1-final-covering | `/private/tmp/orca-followup-runs/t5-fix1-final-covering/output.log` | 0 | `a0b49310eea3ebd12a5785cf7b42d3aa4d568ee121f32ba87cbd04dd009cd556` |
| t5-fix1-final-types | `/private/tmp/orca-followup-runs/t5-fix1-final-types/output.log` | 0 | `443df7778c6055e93ca0f3f4fabce5cbbe7205fa5689a62bd08268806118c185` |
| t5-fix1-native | `/private/tmp/orca-followup-runs/t5-fix1-native/output.log` | 0 | `602650d76f0accc8d173331125fba2152a53d6500fdef2c0206d075a6f635beb` |
| t5-fix1-wire | `/private/tmp/orca-followup-runs/t5-fix1-wire/output.log` | 0 | `63ecf7061c9310f575a761399042a6ca2794cfcd95115910ebba9eebd1c59eab` |
| t5-fix1-serial | `/private/tmp/orca-followup-runs/t5-fix1-serial/output.log` | 0 | `af14121dee71fa5613258c186bdf3e33f73ac1d42c254f7be57853038eeea588` |
| t5-fix1-clone-build | `/private/tmp/orca-followup-runs/t5-fix1-clone-build/output.log` | 0 | `aefbc9b778e411edd79554b58143dc8c252dbc805ec4e91e0c180ac3c2e15cfd` |
| t5-fix1-clone-baseline | `/private/tmp/orca-followup-runs/t5-fix1-clone-baseline/output.log` | 0 | `77a8816aec3a47df8e3863784dd9729a2075b560ae0152cb58db278ab27e3a69` |

Status: DONE_WITH_CONCERNS, scoped re-review pending. All previous reports/evidence remain append-only.
