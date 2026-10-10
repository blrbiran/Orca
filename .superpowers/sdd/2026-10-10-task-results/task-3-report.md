# Task3 report — review checkpoint

Owner: Codex /root/results_task3, 2026-10-10. Status: implementation committed; final heavy gates and final clone proof pending. This checkpoint is append-only; final findings will be appended below.

SOURCE: 6ab6b321248acf7c387e3f3aacb13d34654749f4, cwd /Users/biran/.codex/worktrees/progress-results-20261010/Orca. Product source commit 0ebe05113484157af774a168125d2e9975967a95; native git diff over src, web/src and package/lock files between commits measured 0 bytes in `/private/tmp/orca-progress-results-20261010/task3-product-byte-equality.json`. Second commit corrects only two independently exposed business criteria.

Implemented independent optional port/transport, exact producer DTOs/constants, owned task-results outbox/index, bounded process queue and per-run exclusion, complete-page monotonic admission and immutable per-attempt snapshots, saved evidence membership/hashes, actual verifier-start/completed distinction, changed-executable-only unsupported caching, results-only projection changes. Core collect/usage/terminal transitions do not await result metadata. Controller-approved additive seams: profiles.ts bound optional forwarding and cleanup.ts actual source deletion. Core cleanupRunWorkspace keeps source captures, so no metadata wait was added there. Core archive excludes exactly control/task-result-evidence and run/task-result-captures before traversal; ancestor filtered-entry validation prevents optional mtime changes poisoning core evidence. Acceptance/continuation authority remains fail-closed.

Ordinary metadata transport/read/capture failures preserve prior admitted state as stale/unavailable and allow existing settled cleanup after the bounded 67000-ms queue-inclusive flush. Store owner, run generation/execution, lease token, admission or shutdown loss refuses old writes/deletion. New assembly invalidates old jobs, retains same-run queue exclusion, and an old stop cannot cancel new owner acquisition. Ownership is checked after asynchronous artifact publication admission and again immediately before actual rm.

Synthetic complete lifecycle/isolation GREEN reached 26 tests, RC0 (`task3-green-handover`); prior fixed default full focused gate 25/25 RC0 (`task3-default-green`). Subsequent independent artifact-register, before-rm, deadline-authority guards have targeted GREEN native evidence; final full root is still pending. Exact feature CLI `/private/tmp/orca-results-ccloop-20261010/dist/cli.js` at accepted c3643a9fb11a6d0a023e88b384356d3f7fedc58f: live execution output + actual verifier-start observed with core candidate/terminal null, then completed verifier success; 1/1 RC0 (`task3-paired-router-green`), exactly plan/execute/verify calls. This is real protocol transport with fake providers, no real-browser or production-release claim. Fixed default remains `/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js`; package/lock unchanged.

Native validation runner for every named record: `python3 /private/tmp/orca-progress-results-20261010/run.py NAME CMD...`; final gates use task3-gate.py to record cwd/full source SHA/source diff0 before invoking that exact runner. Commands, complete logs and RCs are retained in the same owned directory; env.json is never printed or attached. Root typecheck/build and Web build all RC0 at product source 0ebe051 (`task3-final-types`, `task3-final-build`, `task3-final-web-build`). Web emits the pre-existing chunk-size warning; logs preserve it. Panel gate is currently running at authoritative SOURCE 6ab6b32. Full root, explicit D9/M3/handoff/parity regression, leak and final committed-clone mutants are pending; none are claimed complete.

Original RED/setup/error evidence preserved: sandbox ps EPERM, missing initial module import, inert-collector business failures, missing lease token fence, wrong historical-remainder test assumption with teardown rejection, wrong test import, real router stripping optional methods (two paired failures including bounded diagnostics), cross-assembly takeover/shutdown deletion, last-rm shutdown, unreadable authority deadline. No criteria waiver or source/runtime switch.

Two actual original clone mutants SURVIVED and are not counted as proof: immutable snapshot guard removal was masked by invalid changed-file byteLength (7 actual/12 declared); corrected to equal-length valid new snapshot bytes. Awaiting optional flush inside core collect was masked by its normal 1000-ms timeout; corrected with held synthetic optional timeout clock and independent native race proving real core usage/collection progress while acquisition stays blocked. Both fixes are tests-only, targeted GREEN, full source history preserved. Original patches/logs/RCs and working/cached restore 0/0 are retained; final killing proofs on SOURCE are pending. An earlier premature clone mutation attempt produced a missing-file setup error and an unmutated 0-diff run; it is not fault evidence. The snapshot original patch was exactly reproduced from its captured transform and matched the recorded 1329-byte diff; this reconstruction is disclosed.

Task4 integration notes: saved observation verification is an actual historical fact; combine with current lifecycle before showing started-only interrupted/terminal evidence. Missing start must not imply not-run. Output IDs must include run/attempt ownership, since producer output-1 is attempt/manifest-local; readOwnedTaskResultEvidence validates exact admitted manifest membership and hashes without live workspace reads. No historical backfill, summarizer/model, paid provider, ccloop source change, dependency/schema/runtime switch, push/main merge or branch/worktree deletion.

Final append-only gate and fault map follows after native completion.

## Frozen-gate self-audit concern (2026-10-10, /root/results_task3)

While fullRoot runs on 6ab6b321248acf7c387e3f3aacb13d34654749f4, source remains unchanged. Read-only review found that the per-page evidence Map may retain bytes from up to 64 manifests, each admitting up to 64 files of 1048576 bytes, before index admission. This is a concrete aggregate-memory concern despite per-file limits. Proposed narrow remedy is owned artifact staging after each complete manifest and dropping its byte buffers, retaining page-atomic cursor/history admission. Controller requested supplemental review of this and currentAttempt failure boundaries; no fix or final approval is claimed here. Any accepted fix waits for the current native gate and preserves its pre-fix source/log/RC.

## Fix round 1 — review ruling while pre-fix root gate remains frozen

Controller assigned the original worker after Astra supplemental review changed the effective verdict to Needs fixes. FIX_BASE is 6ab6b321248acf7c387e3f3aacb13d34654749f4. The page-wide Buffer Map is an Important robustness defect: schema-derived output limits alone permit 4 GiB/job, two jobs twice that (arithmetic bound, not an allocation measurement). The authorized fix is per-reference private owned artifact staging/release with only bounded metadata/derived facts retained; complete page index/cursor/history remains atomic, and unadmitted bytes stay inaccessible through the result API. Every asynchronous publication must keep owner/run/lease/admission/shutdown fences. Deterministic staging, later-ref failure and incremental ownership loss criteria are required; no GiB allocation test.

Controller also resolved current-attempt freshness in Task3: separately retain a strictly identity-checked source/index current-attempt fact before complete evidence admission, including same-index-revision attempt growth from live loop-state. Reject index/attempt regression, malformed/foreign identity and obsolete-owner writes. Fact updates never promote partial evidence, advance capture cursor or replace history. Old core attempt 1 cannot overrule a later optional validated attempt 2; null core progress must likewise not make saved attempt 1 current. Task4 will consume the exact private fact plus lifecycle. The final report will document its precise interface and independent source/core failure boundaries.

No source/test edits have been made during the running pre-fix root suite. Its complete source/log/RC will be retained. All further obsolete heavy gates and clone proofs are paused until that gate settles and the authorized correction is implemented and frozen. Receiving-code-review, TDD and verification discipline apply; no interim human confirmation is required.

## Fix round 1 checkpoint — source 8dee7c1 (2026-10-10, /root/results_task3)

SOURCE is 8dee7c1247fb4dc32688780b3f6c6e40d2f9e40e. Fix commit preserves all prior history. Pre-fix full root at 6ab6b32 is RC1: 373 passed/3 failed files, 3562 passed/4 failed/4 skipped tests (3570 total), native duration 1166.79 s. Complete raw log SHA256 df49a446870a75d212c9d606d236a20ef8ddf13604fc31c48ca5f1f823e47eb0; original command/source/log/RC remain task3-final-full-root.*. Four failures were two driverRequirementClarify repository/recovery cases, handoffFailedRetry unrecoverable-provider M3, and retryTask failed cleanup. Copying driver options made later resolver/router replacements invisible. A narrow Proxy overlay now reads the original getters with original receiver and binds methods to their original owner; caller config is not rewritten or frozen.

The page-wide Buffer Map is removed. Each hash-checked bounded reference is published through the existing fenced immutable publisher and its Buffer is released before the next reference. Only manifests and derived verifier facts survive acquisition. Full-page result membership/cursor/history remains one admitted transaction. Per-read and post-publication owner/run/lease/admission/shutdown checks remain. No generic core API change was needed: its real authenticated download route revalidates core manifest membership rather than trusting registry/hash alone.

Exact Task4 interface: TaskResultState.currentAttemptFact?: TaskResultCurrentAttemptFactV1|null, schema 'orca-task-result-current-attempt-v1', fields identity (the exact full accepted TaskResultIdentityV1), revision (source index revision), currentAttempt (validated live loop-state number). Fact updates are independently admitted before evidence reads, including same-index-revision attempt growth. Capture cursor TaskResultState.revision, captured history/observations and last-complete-page currentAttempt remain unchanged on evidence failure. readTaskResultCurrentAttemptFact(store,runId): TaskResultCurrentAttemptFactV1|null is read-only: no RPC/filesystem discovery/writes; it validates strict persisted fact against the current run and canonical accepted envelope/lease. Foreign/stale/malformed advertisements and obsolete owners cannot update it. Task4 must use this source fact with lifecycle, never old saved history/core attempt 1 to substitute for a later proved source attempt 2.

Native coverage records in /private/tmp/orca-progress-results-20261010 (full argv is each .command.json; complete output each .log; RC each .rc):

| Record | Native child command | Observed |
| --- | --- | --- |
| task3-fix1-red | vitest run tests/control/taskResultCollector.test.ts --maxWorkers=2 --no-cache -t 'fix round 1 bounded' | 6 business failures/1 pass, RC1 before fixes |
| task3-fix1-coredeps-green | vitest run tests/control/driverRequirementClarify.test.ts tests/control/handoffFailedRetry.test.ts tests/control/retryTask.test.ts tests/control/taskResultCollector.test.ts --maxWorkers=2 --no-cache -t 'repository the run cannot resolve\|shows an A2 repository-path\|clears live retry source on unrecoverable\|records a cleanup failure on the failed run\|caller getter and method ownership' | Original four unchanged cases plus getter/owner case: 5 passed, RC0; selection skips are explicit |
| task3-fix1-staging-owner-green | vitest run tests/control/taskResultCollector.test.ts --maxWorkers=2 --no-cache -t 'checks incremental lease ownership' | 1 passed, RC0 |
| task3-fix1-full-focused-second | vitest run tests/control/taskResultCollector.test.ts tests/control/taskResultIsolation.test.ts tests/control/taskResultPaired.test.ts --maxWorkers=2 --no-cache | Complete default fixed gate, 37 passed/0 skipped, RC0 |
| task3-fix1-paired | env ORCA_CCLOOP_BIN=/private/tmp/orca-results-ccloop-20261010/dist/cli.js vitest run tests/control/taskResultPaired.test.ts --maxWorkers=2 --no-cache | Exact feature CLI live-before-terminal and started/completed observations, 1 passed, RC0 |
| task3-fix1-final-types | npm run typecheck through task3-gate.py/run.py | RC0, source 8dee7c1 with source diff 0/0 |

The actual HTTP staging criterion first serves a legitimate core ref with the same authenticated session/run/route (200 and exact bytes), proves the partial result ref is registered with the exact hash, confirms healthy core manifest GET200 excludes it, then proves generic known-hash GET423 with recovery-blocked:evidence-reference-unknown and owned result-reader refusal. Later-ref failure keeps old cursor/history while the independently proved source attempt 2 remains available with old core 1 or null. Incremental lease loss blocks subsequent publication and leaves unindexed blobs inaccessible. No real large/GiB allocations are used.

Expected-fixture corrections are disclosed, not waivers: the existing generic refusal is 423 rather than the initially guessed 409; prior late-write criteria now compare the exact already-admitted pre-fence fact snapshot rather than wrongly requiring no earlier valid fact. Artifact registration ownership injection now targets the actual post-publication transaction rather than being accidentally consumed by the preceding source-fact transaction. Known-hash membership fixtures now persist the unrelated artifact, and initial hash corruption is equal-length, excluding unrelated missing/size/duplicate guards. All original failure logs are retained. Source-construction Python quoting errors were pre-validation helper/setup errors in the tool transcript; no product write occurred from those failed helpers.

Remaining at this checkpoint: amended root build (running), Web build, panel parity, complete frozen root, explicit D9/M3/handoff/isolation/parity/leak and fresh committed-clone killing/restoration proofs, plus independent fix-scoped re-review. None is claimed GREEN or complete. Product/test source stays frozen while those native gates run.

## Frozen fix1 gate progress and scoped review (2026-10-10, /root/results_task3)

At SOURCE 8dee7c1247fb4dc32688780b3f6c6e40d2f9e40e, task3-fix1-final-types, task3-fix1-final-build, task3-fix1-final-web-build and task3-fix1-final-panel all returned RC0 with source working/cached diff 0/0 captured before each command. Exact native argv: npm run typecheck; npm run build; npm run build --workspace web; npm run verify:panel. Panel numbered checks 0 through 14 passed (15 checks); it is a scripted HTTP/process verification, not a real-browser claim. Web build retained the existing chunk warning. Complete amended fullRoot is running frozen; explicit targeted regression/leak and final clone proof remain pending.

Controller received fresh Astra scoped re-review: I1 memory, C1 source-attempt freshness and I2 dynamic core dependency forwarding are addressed, no new Critical/Important finding. The frozen/nonconfigurable function-property Proxy invariant is a deferred Minor: binding a non-writable nonconfigurable function through this overlay can violate JavaScript Proxy invariants. Controller explicitly excluded expanding this fix round for that Minor and retained it for final cross-repo review. Source/test code stays unchanged while gates finish.

## Final native evidence — 2026-10-10, /root/results_task3

Task3 implementer status: DONE_WITH_CONCERNS. Authoritative product/test SOURCE is 8dee7c1247fb4dc32688780b3f6c6e40d2f9e40e, following 0ebe05113484157af774a168125d2e9975967a95 and 6ab6b321248acf7c387e3f3aacb13d34654749f4 from BASE d58c21450b740949193b9c8fda87f4f435584cef. Every final gate records cwd /Users/biran/.codex/worktrees/progress-results-20261010/Orca/full source SHA/working and cached source diff0/0 before execution. Product/test source stayed frozen throughout. This is Task3 evidence for controller review; overall project/human audit is separate.

Durable complete raw records: [manifest with measured SHA256/byte counts](task-3-evidence/manifest.json). Original failures, two original surviving mutants, complete pre-fix/final root logs and all command/log/RC/source/patch/restore records are attached. env.json/secrets are excluded. Early records without source.json remain historical; source-bound final records establish provenance. Some large log tool views truncate; complete original byte streams remain in attachments, not replaced by summaries. Failed external Python helper construction/filename-inventory attempts are tool-transcript setup limitations, not native business results.

Every final command uses python3 /private/tmp/orca-progress-results-20261010/task3-gate.py NAME CMD..., recording source before the required python3 /private/tmp/orca-progress-results-20261010/run.py NAME CMD... runs in its owned fake environment. All Vitest root gates use maxWorkers2/no-cache/no minWorkers. Root/Web builds precede panel/fullRoot, heavy gates sequential.

| Final record | Exact child argv (full JSON also attached) | Native outcome |
| --- | --- | --- |
| task3-fix1-final-types | ["npm", "run", "typecheck"] | RC0 |
| task3-fix1-final-build | ["npm", "run", "build"] | RC0 |
| task3-fix1-final-web-build | ["npm", "run", "build", "--workspace", "web"] | RC0, existing chunk warning |
| task3-fix1-final-panel | ["npm", "run", "verify:panel"] | RC0,15 numbered checks |
| task3-fix1-final-full-root | ["./node_modules/.bin/vitest", "run", "--maxWorkers=2", "--no-cache"] | RC0,376 files;3573 passed/4 existing skips of3577;1192.10s |
| task3-fix1-final-regression | ["./node_modules/.bin/vitest", "run", "tests/control/settleUnknownUsage.test.ts", "tests/control/schema10.test.ts", "tests/control/handoffFailedRetry.test.ts", "tests/control/retryTask.test.ts", "tests/control/driverRequirementClarify.test.ts", "tests/control/driverHandoff.test.ts", "tests/control/driverHandoffSnapshot.test.ts", "tests/control/driverContinuation.test.ts", "tests/control/taskResultIsolation.test.ts", "tests/panel/settleUnknownUsage.test.ts", "tests/panel/webParity.test.ts", "--maxWorkers=2", "--no-cache"] | RC0,11files/140passed/0skipped;97.54s |
| task3-fix1-final-leak | ["python3", "/private/tmp/orca-progress-results-20261010/task3-leak.py"] | RC0,7files/107passed/0skipped;zero owned-root entries;76.44s |
| task3-fix1-final-paired | ["env", "ORCA_CCLOOP_BIN=/private/tmp/orca-results-ccloop-20261010/dist/cli.js", "./node_modules/.bin/vitest", "run", "tests/control/taskResultPaired.test.ts", "--maxWorkers=2", "--no-cache"] | RC0,1file/1passed/0skipped;16.49s |
| task3-fix1-final-proof | ["python3", "/private/tmp/orca-progress-results-20261010/task3-proof.py", "/private/tmp/orca-progress-results-20261010/task3-fix1-proof-clone", "8dee7c1247fb4dc32688780b3f6c6e40d2f9e40e"] | outerRC0;26faultRC1/restored0/0 |


Explicit regression covers D9 settlement/migration/transport, all19 M3 failed-handoff retries, all15 failed-task retries, all12 requirement-driver cases (original four regression criteria unchanged), all30 handoff cases, snapshot-missing refusal, continuation closure, optional archive isolation and parity. Leak child argv is in task3-leak.py and its complete raw log: seven complete files under owned /tmp/t3l-7bienb4x, childRC0/107tests/entries[]. JSON report and empty root retained, no standard leak-script stdout suppression/report deletion. Exact feature pairing uses /private/tmp/orca-results-ccloop-20261010/dist/cli.js at accepted c3643a9fb11a6d0a023e88b384356d3f7fedc58f. Fixed default ab824d1 remains separate. Real transport proves live-before-terminal execution/start/completion and exactly plan/execute/verify provider calls, all fake.

Complete final fullRoot log: SHA256 99b7d2617c63f79d40cd2d6884a4b74ae7dbb376c16df50e8d930625103a5ac8,333609 bytes. Four existing skips are surfaced, not waived; no Task3 tests skipped in complete37 focused default or final107 leak gate. SQLite experimental/snapshot diagnostics and Web chunk warning remain visible. No real-browser/production-provider/installed-release/native-Linux claim.

Clone creation is recorded task3-fix1-clone-source, RC0: git clone --local --no-hardlinks /Users/biran/.codex/worktrees/progress-results-20261010/Orca /private/tmp/orca-progress-results-20261010/task3-fix1-proof-clone. Committed8dee identity/initial diffs0/0 verified. Every fault captured/asserted a nonempty exact patch before running the independent criterion; exact source restoration measured entire working/cached diffs0/0 after each. Final clone also0/0. [Fault map](task-3-evidence/task3-fault-map.json) supplies full source/argv/patch/log hashes and restores; [native counts/failure kind](task-3-evidence/task3-fix1-fault-summary.json) disclose selection skips.

| Fault | Independent failed criterion | RC / restored working,cached |
| --- | --- | --- |
| namespace | ignores missing, special and changing | 1 / 0,0 |
| ancestor-filter | ignores missing, special and changing | 1 / 0,0 |
| snapshot | immutable execution snapshot successors | 1 / 0,0 |
| monotonic | never admits a partial/corrupt page | 1 / 0,0 |
| owner | rejects late writes after owner fence | 1 / 0,0 |
| lease | rejects late writes after lease fence | 1 / 0,0 |
| registration | owner changes after publication admission | 1 / 0,0 |
| flush | flushes owned queued results before actual source deletion | 1 / 0,0 |
| last-rm | last source deletion fence | 1 / 0,0 |
| core-wait | core usage and terminal settle independently | 1 / 0,0 |
| concurrency | permits at most two process-wide jobs | 1 / 0,0 |
| per-run | permits at most two process-wide jobs | 1 / 0,0 |
| handover | observes the old RPC but lets the new assembly | 1 / 0,0 |
| profile | retains evidence through the real frozen router | 1 / 0,0 |
| hash | never admits a partial/corrupt page | 1 / 0,0 |
| membership | retains manifest-owned hashes | 1 / 0,0 |
| attempt-owner | retains manifest-owned hashes | 1 / 0,0 |
| started | separates actual verifier start | 1 / 0,0 |
| cache-identity | caches only old command refusal | 1 / 0,0 |
| deadline-queue | flush deadline with available | 1 / 0,0 |
| deadline-authority | flush deadline with unavailable | 1 / 0,0 |
| incremental-staging | stages one owned reference before the next read | 1 / 0,0 |
| independent-fact | keeps validated source attempt two | 1 / 0,0 |
| fact-freshness | records same-index-revision attempt growth | 1 / 0,0 |
| fact-lease | checks incremental lease ownership | 1 / 0,0 |
| dynamic-deps | repository the run cannot resolve | 1 / 0,0 |


Deadline-queue +1ms is a completion-timeout proof: after advancing synthetic time67000ms, flush cannot complete and30s test watchdog fails. Deadline-authority removal exposes the thrown unreadable resolver. These are separate from assertion failures. Hash/monotonic faults remove duplicated enforcement of their invariant to prevent redundant guards masking the fault. Incremental staging removal fails staged-before-next-read; independent fact removal fails source2 retention for both old-core1/null; freshness removal rolls attempt back; consumer lease removal exposes obsolete fact; copied options fault the original repository-resolution case. No survivor/setup failure counted among these26 detected faults.

Both original snapshot/core-wait survivors remain attached with originalRC0/restore0/0, never retroactively counted as kills. Final snapshot removal now admits changed equal-length bytes/revision2 and fails revision1; final core await yields metadata-gated instead of core-progress and fails the independent real-timer race.

Self-review and assigned-fix scoped Astra review completed. Concerns: controller-deferred Minor Proxy invariant for frozen/nonconfigurable function properties; native Linux reader proof; later human ccloop publication/repin. Boundaries are explicit, no criteria waivers. No source/UI/package/lock/schema/runtime/provider scope expansion, main merge/push/deletion, extra agent or ccloop source/suite work. Task4 currentAttemptFact interface above is authoritative; API must combine it with current core lifecycle and admitted saved membership.

## Audit commit check — 2026-10-10, /root/results_task3

Evidence/report commit 856011035d9c3ffdd81d9d3d84661781c8874242 preserves all366 attachments byte-for-byte; measured product/test/source-path diff versus validated8dee is0 bytes. Exact owned stage list matched369 paths before commit; controller note and node_modules remained excluded. Product range git diff --check d58c214..8dee returnedRC0. Audit-only git diff --cached --check returnedRC2 on native raw-log blank EOF lines and raw patch context whitespace; those captured bytes are deliberately preserved and are not product edits. The report does not claim this audit whitespace check passed. No native gate was bypassed or rerun against changed product code.
