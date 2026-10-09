# D9/M3 whole-branch final review and Task 4 independent gate

Owner: `/root/final_usage_retry_review`, 2026-10-09 Asia/Shanghai. Read-only review of branch `codex/d9-m3-implementation`, fixed BASE `c29676d6d0050d46b9cf61f45ffaee583f9dec76` → HEAD `3a433c21f9369e1c48681fda45f217ca08df4eed`. Task 4 range: `ace22093d498eb155dda0b783ad43b3cdcf114f5` → the same HEAD. Binding: design §9 including §9.5, implementation plan, global constraints and controller rulings. RTK, CLAUDE.md and the requesting-code-review/code-reviewer.md rubric were read.

This is a fresh assessment of implementation and test intent, not adoption of prior task-review verdicts. Reviewed the whole range in file/topic passes: D9 authority/accounting/evidence, M3 frozen/source lifecycle and callers, Web and closed protocols, all changed tests, migration assertions, and the documentation/evidence changes. The supplied whole diff and Task 4 diff were cross-checked against fixed-range Git diffs and complete source files; cut-off product/test output was re-read separately. Fixed-range inventory is 81 paths, including the binary historical-review archive. Performance documents were reviewed as documents only. No suite, provider, real database or daemon was run, no subagent was dispatched, and no product, test, index, HEAD or branch state was changed. This new report is the sole write.

The controller advanced HEAD to `ab7d78a003d5278e480914989601e4198731dab0` during review for evidence packaging/progress only. That later commit is not represented as part of the reviewed range. Read-only comparisons confirm no product/test changes from the gate's `cc50570477ee20052cc8c39975112981aaa277dd` to reviewed `3a433c2`.

## Strengths and independent specification assessment

### D9 authority and evidence

The new strict verb/payload is registered in raw/effective commands, result union, service, actual HTTP route, human-only table, entry documentation, allocation/request/activity vocabulary, Web wire types and both locales. The route at `src/panel/controlApi.ts:440` first uses the listener-authenticated principal and permission table; it does not derive authority from actorId or acknowledgement. The command context supplies receipt principal, and `src/control/settleUnknownUsage.ts:44` rejects a direct call without Web/user context. `tests/panel/settleUnknownUsage.test.ts:17` exercises owner/member and actual Unix-socket agent requests using driver-generated failure evidence; the refusal checks include unchanged usage ledger and no command receipt. Existing login/session tests remain the authentication-layer evidence; this test does not claim to implement login itself.

`settlementAdmission` (`src/control/settleUnknownUsage.ts:18`) checks current task/run/generation support, terminal non-success, stop/archive/clarifying/open-request/pending/unknown conditions and separates committed from released. Evidence binds candidate group/task/work/run/generation/graph/target/highWater, immutable terminal report and isolated execution proof (`src/control/usageSettlement.ts:49`). Released admission additionally validates the checkpoint bytes/hash, all artifacts/snapshot, missing/unresolved arrays and original usage-only request (`usageSettlement.ts:69`). It does not trust the failure label alone. Transaction revalidation at `settleUnknownUsage.ts:62` compares the complete run and re-reads evidence before mutation.

The accounting formula at `settleUnknownUsage.ts:72` charges both buckets in all four dimensions. Only committed subtracts reserved; released leaves unrelated commitment untouched. Frozen task allocation amount/state and work grant remain intact. `syncWebBudget` updates reserve/deficit and scans the other historical runs, so one settlement does not clear another unknown/pending run. Existing overage/breaches are retained, and deficient reserve does not hide real settlement. Nonzero token deltas use the existing bucket source, unattributed quality, null model breakdown and current applied time; zero-token buckets produce no artificial ledger row.

Marker, activity, usage ledger, budget, run/request changes and authority receipt share applyWebCommand's transaction. Original event replay is checked before the new-marker guard in `src/control/usage.ts:17`; a new event after settlement refuses before insertion. `hasValidUsageSettlement` (`usageSettlement.ts:89`) independently checks receipt principal/client/verb/result, identity, charged amount against original provider cumulatives, zero remaining, known usage, proof and released request linkage. The supported Web claim begins with known zero and gains unknown through a null usage event; the validator's null-event evidence requirement is consistent with these writers. Old legacy claim initialization is outside D9's supported admission.

The dedicated manual request close (`src/control/stopIntent.ts:912`) does not call terminaliseRun/releaseCommitment a second time. It preserves original endedAt, failureCode, checkpoint and evidence, and recomputes the full frozen set, substituting only the current validated request while its receipt is pending. New request state is SETTLED, not ADOPTABLE and not a provider HandoffDisposition. Both strict request readers validate its released marker association.

### Both stop orders, M3 and live source lifecycle

The shared `hasObservedUsage` branch (`src/control/budget.ts:158`) recognizes valid manual accounting for all its callers: driver handoff, candidate completion, scheduler recovery and reserve release. Their independent stop-proof, checkpoint, snapshot/artifact and pending-event guards remain. This closes D9→handoff as well as handoff→D9 without fabricating a provider event or moving highWater. Tests at `tests/control/settleUnknownUsage.test.ts:82` and `tests/control/handoffFailedRetry.test.ts:175` use a work bucket that never had non-null provider usage; they therefore measure the new branch, not a pre-existing provider-observed success.

`src/control/retryTask.ts:75` admits held failed recoverable handoffs only with held amounts/work grant equal to old remaining and a complete request/checkpoint. The released arm at line 78 requires the valid manual marker and terminal allocation. Inactive admissions reject other historical unknown/pending usage before reservation. Held releases remainder then reserves source grant; released reserves the full grant and releases nothing; existing active confirmed retries preserve their old allocation semantics. The exact consumed continuation registration is checked and cleared; pending/foreign identities are refused and historical run/wake identities remain.

`src/control/retryGrant.ts:14` validates the source/current/intermediate sequence, current row order and lineage set, group/task/work identity, graph/target/frozen agent, profiles, immutable claim hash, owner token, normal-claim scope, grant and both retrying amounts. The frozen reader omits only retrying amount, retaining allocation identity/provenance/bucket comparisons; its paired live validator prevents arbitrary amounts. Driver, contract and panel readers consume this validator.

No-provider invalid proof and pre-provider settled-restartable preserve source, latest currentRunId and reservation. They require inactive, executionId null, zero cumulative, full remaining, known usage and no pending events; restartable also needs its settled request. The active retry branch can refresh source after a later failure. `setAllocationStates` (`stopIntent.ts:818`) and `saveWork` (`src/control/queries.ts:49`) cover held/continuing/terminal transitions and prevent stale local bodies reintroducing source. I checked their callers in terminaliseRun, continuation registration, normal reserve release, no-start rearm and dispatch. Other direct SQL work writers either change labels only or reject tasks with any prior run/prestart history; they do not provide an overlooked legal source-dropping transition.

A2 now always applies `withinGrant` to the actual task start envelope (`src/control/executionDriver.ts:306`). The tests capture port.accept and independently assert token, attempt and active-time minima, the frozen hash, current group head and null checkpoint for normal retry. The source/grant remain unchanged; no sessions policy field is invented. No free retry is introduced after D9: exhausted old remainder means the new grant must be reserved again.

### Web, persistence and legacy compatibility

App reads real AccountContext roles (`web/src/App.tsx:173`) and passes them through Panel to GroupView. `UsageSettlement.tsx` requires explicit owner, shows server-supplied amounts, obtains explicit irreversible consent and sends only identity/acknowledgement through the existing command sender. Revision/preview/role changes remount consent at `ControlGroupView.tsx:221`. Receipt and activity display conservative method, principal/time and both buckets' four dimensions; member/absent-account behavior is restricted.

`web/src/runFacts.ts:42` separates historical failure reason from current Retry eligibility. Both table and detail use it; inactive held/released checks include current run, explicit null pending, group unknown, allocation, request and checkpoint/marker evidence available in the DTO. Immutable proof and pending-event authority stay server-side. Manual failed checkpoints are excluded from Continue. Existing complete-only empty-selection resume is independently reachable even when there is no Continue choice; ordinary held Continue remains. Partial/unresolved groups retain their blockers. Actual App lost-response coverage at `web/tests/controlCommandRecovery.test.tsx:176` verifies the original command ID is retained rather than inventing a new settlement intent.

Schema 10 is a one-way gate. Migration admits 9 without rerunning the pre-ledger migration; old versions keep their established path. Optional run marker/work source support old records, while present fields are strictly validated. I read the actual old-v9 clone opener script and its raw result: real c29676d schemaVersion 9/openControlStore rejects 10 without modifying database bytes. New-reader schema11 refusal is separate evidence. Schema8/9 test changes retain pre-ledger, period, repeat-migration, STRICT/FK/index and byte-preservation assertions. Closed route/verb/archive/locale tests extend the exact sets instead of excluding the new feature.

## Task 4 independent specification and test-quality gate

**Task 4 spec conclusion: PASS for the delegated coverage/verification deliverable.**

**Task 4 quality conclusion: Approved.** Final controller round-close, performance work and three-repository handoffs are separate pending responsibilities; this does not certify those future deliveries.

The added `directly retries an active failed continuation from head` at `tests/control/handoffFailedRetry.test.ts:95` is independent of the earlier held-M3 and already-retrying cases. It reaches a real active failure with continuing allocation and consumed registration, invokes retry without another handoff, then measures source/ready/retrying state, registration removal, historical run identity, both allocation amounts, all four commitment deltas and unchanged used. It claims another run without another reservation and observes actual port.accept with reduced policy/hash/head/null checkpoint. Its setup asserts reduced tokens/attempts/time, so an unchanged original grant cannot vacuously satisfy the clamp.

The independent clone mutation deletes only the continuing arm of `retryTask.ts:115`. I read the full raw RED and restored logs: the new test fails after the actual retry because retryGrantSourceRunId is absent, RC1; restored full file is 19/19, RC0. This is business RED, not import/startup failure. The 18 skips in the targeted mutant are explicit -t filtering, not skipped final verification.

The four approved existing criteria in commandClient (two), requirementRecords and shutdownHealing only change final version 9→10, one current-version title and append dated comments. The diff preserves client null, original rows, null timestamps, healing/start and all other assertions. The mutation/byte proof and exact diff agree; no timeout or failing business assertion was weakened. Task 4 makes no product change.

## Verification evidence and formal-wrapper ruling

The tests were run by their evidence owners, not by this reviewer. Reports provide command/commit attribution and raw paths. I independently parsed the original full-root JSON, checked paired RCs, inspected the wrapper and flag consumer, read raw pin/leak/Task4 mutant/restoration/old-reader outputs and sampled the high-risk prior mutation logs (released reservation, manual observed usage, no-start, restartable and actual accept clamp). Other prior mutation coverage is supported by the implementation reports/manifests and final code mapping; I do not claim to have rerun or independently re-read all 49 earlier mutation logs.

Observed full-root JSON SHA256 is `7dfe9b40dfd4df6ace077720bae432ae2a884c3f355c2ef4af882f63a6ad13f2`: 368 files, 3462 tests, 3458 passed, 0 failed, 4 skipped, 0 todo, success=true, paired RC0. It contains all 153 control files and 1709 control cases. The three ccloop protocol cases actually pass; actual isolated syncskill/ccmem cases pass. The four skips are default-pin three, separately run 3/3 with pin gate RC0, and the deliberately unauthorized real launchd lifecycle smoke. No paid-model or real-daemon acceptance is inferred.

The final four-worker `verify:control` is **RC1**, with 1704 passed, one 5000ms timeout and four conditional skips. Its exact timeout is `tests/control/requirementOverview.test.ts:81`, parameter `failed`. It is not registered in known-load-flakes.md. Single-worker 22/22 at reported load 8.90 is not low-load proof and does not change that RC. The same final source's two-worker full-root result passes the exact case at 730.2330829999999 ms and all 22 file cases. A read-only blob comparison confirms requirementOverview source, test and fake-ast-grep fixture are unchanged from BASE; this specific case invokes that independent overview/Git/child-process path, not D9/M3 accounting or retry readers.

The coverage-equivalence ruling is supported, with a precise limit. `scripts/verify-control.mjs:19` only selects tests/control, sets maxWorkers=4 and supplies ORCA_CONTROL_VERIFY=1 after binary/table existence checks. The only in-tree consumer (`tests/control/ccloopProtocol.integration.test.ts:25`) throws if those variables are absent; actual eligibility uses binary && agentsTable independently. Both configured variables were valid and all protocol assertions actually ran. The fixed ccloop clone consumer search has no matches. Thus the same committed tree's complete two-worker root run supplies the missing passing control business coverage. It does **not** demonstrate the four-worker wrapper's scheduling reliability, and no report should say that wrapper passed. No additional broad suite is needed merely to toggle a semantically inactive flag.

Web full check is evidence-owner RC0, 90 files/729 tests; web bytes are unchanged from aa03c91. Root typecheck/build, scheduler and panel gate evidence are attributed in the Task4 report, not re-executed. Leak output explicitly says inner vitest exit 0, 58 tests and 0 entries, with outer RC0; this is the authorized scoped new-runtime leak check, not a claim of whole-suite leak measurement. Existing SQLite/Vite and fixture diagnostics remain visible.

## Rulings, history and documentation boundaries

The controller's extra-reserve/overage fixture, strict inactive group-unknown guard, focused UI component, exact old-criterion migrations, scoped leak check and isolated optional CLI decisions are consistent with the task and observed implementation. Direct continuing binding is now explicitly covered. Reusing unchanged web verification is justified by unchanged bytes. The later formal-flag refinement is justified only to the coverage extent above. No ruling relaxes the actual accounting/identity/proof tests or converts a failing wrapper to RC0.

Read-only fixed-range comparisons show the historical issue-fixes tracked SDD paths unchanged (115 tracked paths in this direct directory inventory); its progress is 47823 bytes, SHA256 `8dd6e35cc489153c7d33726798c3fd65ead5f362d0c51fc7f3453bf29dbbd045`. The old decision file is 11172 bytes, SHA256 `c0bd54fc00e62190b8a819636213091bcfe538a37a81fd8bce0170b7dfc41cda`, identical at BASE/review HEAD. `package.json` explicitly accepts ledger RC2; historical seven downgrades are not new corruption and must not be relabelled RC0 or repaired here. I also checked the historical diff archive SHA and all 43 member hashes against its manifest. It is preserved evidence, not new product functionality.

The whole range also includes post-merge cleanup/handoff history and next-round performance draft/spec/plan/review. Those documents distinguish drafting from implementation. Current handoff's earlier D9 status will need the controller's planned final replacement, but is not an assertion that this final gate already happened. M5/M6 product code, benchmark and acceptance are absent from this review range; no performance implementation is approved by this D9/M3 verdict. Proposed hooks handling for later sibling documentation is not an executed result reviewed here.

## Issues

### Critical

None found.

### Important

None found.

### Minor / retained verification limitation

1. **Four-worker control-wrapper completion remains unproven.** `scripts/verify-control.mjs:19` and `tests/control/requirementOverview.test.ts:81`; raw result in task-4-verification-report.md. The same-tree business coverage is complete under two workers, but the failed four-worker invocation is still a failed invocation. This does not identify a D9/M3 product regression or missing criterion after the independent equivalence check. Preserve it prominently in round-close/handoff; if future work requires that exact scheduling configuration as an acceptance target, diagnose and obtain fresh passing evidence for it. Do not silently register a new flake, increase the timeout or claim wrapper RC0.

No additional product-code or test-quality repair is requested. Existing build/SQLite warnings are disclosed evidence noise, not independently introduced blocking defects.

## Declined to judge

- M5/M6 runtime performance, query/parse bounds and benchmark speedup: only its separate future-round documents exist in this range; no implementation or measured result is present.
- Paid-provider behavior and real launchd lifecycle: excluded by authorization/isolation constraints; fake execution-port and isolated protocol/CLI evidence do not prove these environments.
- Previously closed issue-fixes behavior outside the changed D9/M3 interaction paths: the old evidence/data were verified preserved, and those tasks were not reopened.
- Future controller round-close and three-repository final handoff content: explicitly controller-owned and pending after this gate; not silently counted complete.
- Later ab7d78a evidence packaging/progress changes: outside the fixed reviewed HEAD, even though the controller reports no product/test change.

## Assessment

**Whole D9/M3 spec verdict: PASS. Whole D9/M3 quality verdict: Approved. Ready for D9/M3 technical close / merge review: Yes, with the explicitly retained verification limitation above.** This is not merge authorization or a claim that the full four-worker verification command succeeded.

**Task 4 independent spec verdict: PASS. Task 4 independent quality verdict: Approved** for its coverage/test-quality and verification deliverable. No Critical or Important defect remains in the reviewed range. The controller must still record round-close and finish the separately sequenced performance/handoff work; those are not product fixes required by this review.

Final read-only measurements used `rtk proxy /usr/bin/git diff`, Python byte/hash comparisons and `rtk proxy rg -n` at the stated reviewed bytes: product/test/script/skill/package unstaged diff 0 bytes, full staged diff 0 bytes. Existing parent progress changes and the subsequently advanced documentation HEAD are not reviewer mutations. No token/cost total is available; none is estimated.
