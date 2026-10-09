# Task 1 implementation and validation report

Owner: Codex `/root/implement_batch_views`, 2026-10-09 Asia/Shanghai. Worktree: `/Users/biran/.codex/worktrees/usage-settlement-handoff-retry/Orca`; branch `codex/d9-m3-implementation`. Product before: `1fd19a3d49778d0809f96af49a7ef51647a6c0fe`. Product implementation: `e4db472f1f5bfb961db199854a5ed1b1e3613204` (`perf: batch control view work and run reads`, observed by `rtk proxy /usr/bin/git show --format=fuller --stat HEAD`). D9/M3 prior tasks were not reopened. This report is a new owned file; controller progress, published spec changes and node_modules are excluded from the owned commit.

## Implementation and approved caller compatibility

- `src/panel/groupReadSnapshot.ts`: group-scoped raw work/run batches, rowid-order run lineage, and per-request lazy JSON success/SyntaxError results. The store WeakMap holds prepared statements only. No decoded row, summary, proposal or business object survives into another request.
- `controlViews.ts`: summary/completion/category/dependencies/current progress/strict work and run views/effectivePlanTask/continuability/run evidence share that request snapshot. Embedded summary uses the same snapshot. Clarifying requirements retain their original path. Run display remains id order; current lineage uses rowid. Unreferenced bad work/run rows are not eagerly parsed. `handoffViews` also reuses the already read raw run for the existing D9 manual-settlement check.
- `activity.ts`: one store-bound latest-run SELECT reads complete activity rows by run membership and maximum seq. `get(runId)` lazily calls the original entryOf, preserving kind/body validation after run identity checks, clock rollback, null and retention behavior. It does not add activity.group_id filtering. Group feed, summary.updatedAt and independent run-activity routes remain separate reads.
- Controller-approved extra owned interface in `src/control/retryGrant.ts`: `RetryGrantReadContext` supplies same-store/same-group rowid-order raw rows and lazy decodeRun. Source/current/intermediate lineage, claim envelope, pending usage, amount, profile and frozen-agent checks remain in place. Default retry/dispatch/driver callers still read their own database rows. This avoids the prior source parse plus repeated loop parse in the panel.
- Controller-approved extra owned interface in `src/control/settleUnknownUsage.ts`: `SettlementAdmissionReadContext` supplies same-store/same-group **raw decoded** work only. The panel uses it in settlementPreview. Default applySettleUnknownUsage admission and its transaction recheck continue using readWork. readGroup, archived/marker admission and refusal order remain. A missing snapshot work row still throws work-not-found; malformed JSON retains its original SyntaxError at that read location. Neither helper imports a panel module or receives schema-stripped mutable work. Wrong store/group contexts fall back to original reads.
- `tests/control/fixtures/controlReadCounters.ts` wraps bound native db/statement methods and returns the original ControlStore identity. There is no proxy store, so projection transaction WeakMaps remain intact. JSON spy classifies fixture raw bytes and restore is in each test's finally.

## Measurement refinement and limits

Install counters **before the store's first view** and keep one installation through reset/re-read. A later installation cannot discover statements already cached before it; that is a measurement capability gap, not zero queries. The reconnect test keeps one installation per connection and observes body statements preparing 2 then 0, plus a fresh activity prepare after reopen. Other stores prepare independently.

Identical raw fixture bytes share one alias bucket: one actual JSON.parse increments once, never once per alias. That bucket does not identify which physical row parsed. The 10/50 single-group fixtures explicitly assert and output `aliasBuckets=[]`; their work/run bytes are unique by legitimate task contracts/ids. The separate identical-bytes fixture detects multiplicity 2 and still counts 3 actual work parses. Full-summary benchmarks with identical bodies must report aliases or use legitimate unique contract bytes/independent group requests; do not infer each-row counts from an alias bucket.

Only work/run body JSON is classified here. Activity group feed JSON, groups, canonical records, contract strings, profiles, proof/receipts and other JSON are outside that parse counter. Schema validation is still repeated where the original reader validated; it is not reported as JSON.parse. There are no handler/probe/provider counters in these synchronous view measurements. No real service/provider/daemon/global user data was used. Runner `/private/tmp/od9/run.py` uses isolated `/private/tmp/od9/env.json`, with ORCA_CCLOOP_BIN pinned to `/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js`; no web rebuild was performed.

## RED and green gates

Observed RED before product edits at HEAD `1fd19a3d49778d0809f96af49a7ef51647a6c0fe`: `rtk proxy python3 /private/tmp/od9/run.py perf-task1-red-count npx vitest run tests/panel/controlPollPerformance.test.ts`, rc=1, full log `/private/tmp/od9/logs/perf-task1-red-count.log`. Actual summary work body point gets were 19 for 10 tasks and 99 for 50, expected 0. Failure was from real old public readers, not a missing helper import. Earlier sandbox-only run failed at ps EPERM and was not counted as RED evidence; the authorized isolated run resolved it.

The new legacy fixture initially expected waiting for draft work; the before RED log showed idle=6/waiting=0. That expectation was corrected to the existing draft category behavior. Another initial cross-group/reference fixture expectation incorrectly treated confirmed ready dependents as idle; the original ready dependency rule and unchanged existing groupSummaryFields regression establish waiting. M3 success fixture was corrected from ordinary active retry (no retryGrantSource) to **real failed → handoff-held → resume-empty → retry** writes, with reserve raised through the real service. No old tests were changed, and no product rule was changed to satisfy those fixture corrections.

Commands and actual results:

| Gate | Observed tree | Result | Complete log |
| --- | --- | --- | --- |
| `rtk proxy python3 /private/tmp/od9/run.py perf-task1-final npx vitest run tests/panel/controlPollPerformance.test.ts tests/panel/groupSummaryFields.test.ts tests/panel/controlViewOrder.test.ts tests/control/loopPlanViewFields.test.ts tests/panel/runContinuable.test.ts tests/panel/runGitView.test.ts tests/control/activity.test.ts tests/control/activityRuns.test.ts tests/control/settleUnknownUsage.test.ts tests/control/handoffFailedRetry.test.ts` | before HEAD + final five product source blobs (same bytes as implementation commit) | rc=0, 10 files, 112 tests, no skips | `/private/tmp/od9/logs/perf-task1-final.log` |
| `rtk proxy python3 /private/tmp/od9/run.py perf-task1-commit-tests npx vitest run tests/panel/controlPollPerformance.test.ts` | `e4db472f1f5bfb961db199854a5ed1b1e3613204` | rc=0, final 17 new tests, no skips | `/private/tmp/od9/logs/perf-task1-commit-tests.log` |
| `rtk proxy python3 /private/tmp/od9/run.py perf-task1-commit-typecheck npm run typecheck` | `e4db472f1f5bfb961db199854a5ed1b1e3613204` | rc=0 | `/private/tmp/od9/logs/perf-task1-commit-typecheck.log` |
| `rtk proxy /usr/bin/git diff --check` and staged exact-file check | before committing final owned files | rc=0 | tool output, no findings |

The 112-test gate contained the earlier 16-test new file, before test-only alias/reconnect/prepare/collision refinements; final new file has 17 tests and was rerun in full on the exact implementation commit. Do not describe these as one 113-test combined run. All original regression files stayed unchanged. The complete root suite and integrated before/after benchmark are reserved for Task 3/controller, as instructed; this report makes no whole-round completion or timing benefit claim.

## Actual SQL and body parse observations

Command: exact-commit `perf-task1-commit-tests` above; observed commit `e4db472f1f5bfb961db199854a5ed1b1e3613204`. Each fixture has 1 group, 10 or 50 plan tasks with multiple dependencies, and 1 current work run. The test reads full expected output before reset, so these below are warmed statement measurements. Public-entry work/run body batches each execute exactly once, target body point gets=0. Detail latest activity batch=1, per-run latest reads=0; summary latest batch=0. Returned target rows are work T / run 1 / latest 1 (detail).

| Tasks / entry | All prepares | All SQL executions | Target executions | Remaining executions | Used work/run bodies | Work/run JSON parses | Max parses per unique body |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 / summary | 31 | 33 | 2 | 31 | 11 | 11 | 1 |
| 10 / group | 241 | 244 | 3 | 241 | 11 | 11 | 1 |
| 50 / summary | 111 | 113 | 2 | 111 | 51 | 51 | 1 |
| 50 / group | 3041 | 3044 | 3 | 3041 | 51 | 51 | 1 |

These are **not** whole-page 2/3 SQL claims. The retained canonical/proposal reads dominate the larger detail. All remaining reads, reported as executions / returned rows:

| Remaining SQL (method) | 10 summary | 10 detail | 50 summary | 50 detail |
| --- | ---: | ---: | ---: | ---: |
| `SELECT body FROM groups WHERE id=?` (get) | 4 / 4 | 32 / 32 | 4 / 4 | 112 / 112 |
| `SELECT body FROM execution_snapshots WHERE hash=?` (get) | 22 / 22 | 176 / 176 | 102 / 102 | 2856 / 2856 |
| `SELECT proposal_version,body FROM budget_proposals WHERE group_id=?` (get) | 1 / 1 | 12 / 12 | 1 / 1 | 52 / 52 |
| `SELECT revision,projection_seq FROM groups WHERE id=?` (get) | 1 / 1 | 1 / 1 | 1 / 1 | 1 / 1 |
| `SELECT mode,revision,body FROM stop_intents WHERE group_id=?` (get) | 1 / 0 | 2 / 0 | 1 / 0 | 2 / 0 |
| `SELECT group_id,run_id,scope,code,body FROM recovery_blockers WHERE group_id=?` (all) | 1 / 0 | 2 / 0 | 1 / 0 | 2 / 0 |
| `SELECT at FROM activity WHERE group_id=? ORDER BY seq DESC LIMIT 1` (get) | 1 / 1 | 1 / 1 | 1 / 1 | 1 / 1 |
| `SELECT group_id FROM execution_snapshots WHERE hash=?` (get) | 0 / 0 | 1 / 1 | 0 / 0 | 1 / 1 |
| `SELECT id FROM estimates WHERE group_id=? ORDER BY id` (all) | 0 / 0 | 1 / 1 | 0 / 0 | 1 / 1 |
| `SELECT estimate_version,state,body FROM estimates WHERE group_id=? AND id=?` (get) | 0 / 0 | 1 / 1 | 0 / 0 | 1 / 1 |
| `SELECT id FROM commands WHERE group_id=? AND original_status IS NOT NULL ORDER BY rowid DESC LIMIT 20` (all) | 0 / 0 | 1 / 3 | 0 / 0 | 1 / 3 |
| `SELECT change_seq,oldest_retained_seq FROM projection_state WHERE singleton=1` (get) | 0 / 0 | 1 / 1 | 0 / 0 | 1 / 1 |
| `SELECT group_id FROM runs WHERE id=?` (get) | 0 / 0 | 1 / 1 | 0 / 0 | 1 / 1 |
| `SELECT body FROM usage_events WHERE run_id=? ORDER BY seq` (all) | 0 / 0 | 1 / 0 | 0 / 0 | 1 / 0 |
| `SELECT body FROM checkpoints WHERE run_id=? ORDER BY id` (all) | 0 / 0 | 1 / 0 | 0 / 0 | 1 / 0 |
| `SELECT kind,body FROM outbox ORDER BY id` (all) | 0 / 0 | 1 / 2 | 0 / 0 | 1 / 2 |
| `SELECT id,group_id,state,body FROM handoff_requests WHERE run_id=? ORDER BY id` (all) | 0 / 0 | 1 / 0 | 0 / 0 | 1 / 0 |
| `SELECT group_id,scope,body FROM recovery_blockers WHERE run_id=? ORDER BY id` (all) | 0 / 0 | 1 / 0 | 0 / 0 | 1 / 0 |
| `SELECT checkpoints.id,checkpoints.run_id,checkpoints.body FROM checkpoints JOIN runs ON runs.id=checkpoints.run_id WHERE runs.group_id=? ORDER BY checkpoints.id` (all) | 0 / 0 | 1 / 0 | 0 / 0 | 1 / 0 |
| `SELECT id,run_id,state,body FROM handoff_requests WHERE group_id=? ORDER BY id` (all) | 0 / 0 | 1 / 0 | 0 / 0 | 1 / 0 |
| `SELECT body FROM spend_cap_blocks WHERE group_id=?` (get) | 0 / 0 | 1 / 0 | 0 / 0 | 1 / 0 |
| `SELECT seq,group_id,task_id,run_id,at,kind,body FROM activity WHERE group_id=? ORDER BY seq DESC LIMIT ?` (all) | 0 / 0 | 1 / 6 | 0 / 0 | 1 / 6 |

The 50-task detail has 2,856 canonical body gets, 52 proposal gets and 112 group body gets still present. Each workViews validateRetryGrantSource still reads its proposal, whose existing archived-plan/canonical verification contributes repeated reads even when no live source exists. Estimate/profile/frozen contract/proof/claim/evidence/stop reads are deliberately retained. This is a remaining hotspot for benchmark/next-round judgment, not an authorized expansion in Task 1.

## Named new coverage and self-review

Real readGroupSummary/readControlSummary/readControlGroup/readRunEvidence entries cover 10/50 count bounds, multi-dependency categories and complete output equality; full/reset/incremental/empty projection; legacy bad/missing work, referenced bad current run, unused bad work/run; same id across groups; two stores, close/reopen, refreshed state/activity; rowid history vs lexical display/current progress; strict schema/authority/amendment/frozen agent/run identity details; maximum seq with smaller at, no feed and retention; full corrupt kind/body in a different activity.group_id while retaining run membership; identity before activity rejection; run evidence strict work parsing; real held M3 retry source, corrupt source/missing marker and foreign context fallback; real released D9 marker preview and corrupt marker/foreign context fallback; alias-safe total instrumentation.

Self-review: exposed wire signatures are unchanged; only the two approved core reader helpers add optional context types. Snapshot decodes raw JSON separately from validation and never replaces schema/identity/profile/hash/provenance checks with cache hits. Each caller consumes rows in its original logical order; rejected marker/run identity precedes lazy latest activity decode. All default writer/driver callers were searched and still omit context. No proposal/frozen/canonical verification was removed, no persistent writer/migration was added, no business data is in a store WeakMap, and measurement returns original store identity. Prepared statements belong to the connection/store lifecycle. Type inference was corrected to Zod output type for the new strict wrapper; initial typecheck failures were fixed and the final exact-commit typecheck is green.

## Independent clone guard removals

Clone: `/private/tmp/od9/performance-task1-mutation-verified`, created by authorized `rtk proxy /usr/bin/git clone --local ...`; sandbox first blocked hardlinks, so a fresh authorized clone was used (the incomplete first temporary directory is not evidence). Mutation baseline: `6e8448eedae6a469118d0ac1af49880dff8a4eb1`. Product source bytes match implementation commit; `/private/tmp/od9/logs/perf-task1-final-restore-proof.json` records SHA-256 and equality for all five source files. Later test-only refinements strengthen alias/collision/reopen checks; the existing mutation assertions were preserved.

Command: `rtk proxy python3 /private/tmp/od9/task1-mutations.py`. For each row it changed only that own guard in the clone, ran `npx vitest run tests/panel/controlPollPerformance.test.ts -t <named pattern> --reporter=dot` under the isolated env, recorded the **complete native reporter log** and raw diff, then restored all changed bytes before the next mutation. All 24 independent runs have rc=1 and restored unstaged/staged diff sizes 0/0. `-t` intentionally selects the named criteria; other cases in these mutation runs are reported as skipped, unlike the complete green gates.

| Mutation | Named pattern | RED observation | rc |
| --- | --- | --- | ---: |
| work-scope | `does not borrow same-id` | foreign done task changed completion/counts | 1 |
| run-scope | `does not borrow same-id` | foreign blocked run changed category | 1 |
| decode-refresh | `reuses statements while refreshing` | second request retained done=0 instead of 1 | 1 |
| decode-once | `batches real summary and group reads for 10` | work raw body parsed 3 times | 1 |
| strict-schema | `pins strict schema` | schema detail replaced by authority refusal | 1 |
| strict-authority | `pins strict schema` | authority detail replaced by later run-work refusal | 1 |
| rowid-lineage | `uses rowid for current lineage` | valid lineage refused as work-item-run-lineage | 1 |
| latest-seq | `refreshes latest seq` | lastActivityAt 200 instead of 100 | 1 |
| latest-entry | `checks the full latest activity` | corrupt kind/body accepted | 1 |
| activity-membership | `checks the full latest activity` | original run feed at 100 replaced by null | 1 |
| unused-lazy | `does not decode an unreferenced legacy run` | summary rejected unused malformed legacy run | 1 |
| point-reads | `batches real summary and group reads for 10` | 10 target point gets instead of 0 | 1 |
| m3-context | `shares lazy decoding` | 2 run body batches instead of 1 | 1 |
| m3-source | `shares lazy decoding` | corrupt succeeded source accepted | 1 |
| m3-store-context | `shares lazy decoding` | foreign store data used and valid source refused | 1 |
| m3-group-context | `shares lazy decoding` | foreign group context used and valid source refused | 1 |
| d9-context | `preserves D9 settlement` | 1 target work point get instead of 0 | 1 |
| d9-marker | `preserves D9 settlement` | marker authority refusal deferred to handoff manual check | 1 |
| d9-store-context | `preserves D9 settlement` | foreign raw work reader invoked | 1 |
| d9-group-context | `preserves D9 settlement` | foreign group raw work reader invoked | 1 |
| work-statement-reuse | `reuses statements while refreshing` | second request prepared 2 target body statements | 1 |
| activity-statement-reuse | `refreshes latest seq` | second request prepared latest activity again | 1 |
| statement-store-scope | `isolates prepared statements` | other store borrowed work and valid detail refused authority | 1 |
| counter-alias | `counts identical fixture raw bytes` | alias bucket counted 2 for one actual parse | 1 |

Logs/diffs: `/private/tmp/od9/logs/perf-task1-mutation-<mutation>.log` and `.diff`; full commands/rc/per-mutation restoration values: `/private/tmp/od9/logs/perf-task1-mutation-results.json`. Final restoration proof measured via Python `len(subprocess.check_output(['/usr/bin/git','diff'],cwd=clone))` and the corresponding `diff --cached`: both **0 bytes**. Shared implementation worktree was never mutated for guard-removal testing; `/private/tmp/od9/performance-before` received no product patch.

## Handoff status

Task 1 is DONE_WITH_CONCERNS: own batching/semantic/type/regression/mutation acceptance is complete; unchanged canonical/proposal/evidence reads remain substantial, and counter installation/alias attribution limits are explicit. Task 3 must measure integrated before/after output/refusal equivalence and the specified workloads, with no timing extrapolation from these tests. No old test edits, push, merge, branch/worktree deletion or real provider action occurred. Source commit is the implementation hash above; the following report-only commit owns this evidence file.


## Late self-review correction — converted requirement summaries

Owner: Codex `/root/implement_batch_views`, 2026-10-09 Asia/Shanghai, latest product commit `9092f6beba51d178df556527e978207ad4084d36` (`perf: reuse snapshots for converted requirement summaries`), following `e4db472f1f5bfb961db199854a5ed1b1e3613204`. The earlier text is preserved as written; its implementation-complete assessment was premature for converted requirement groups. This section supersedes that assessment, the final product hash, new-test count and mutation baseline/count. Initial report prefix SHA-256 before append: `402e85a8033e0d8126243c9f9feb43f589d771676e45feaa04b62e3f9a556c60` (18901 bytes), measured by the append script.

Final call-chain audit found a real missed edge: non-clarifying converted requirement summary → public requirementSummaryOf → blockedRequirementRun performed another active run body batch and JSON parse. Ordinary imported-plan fixtures did not exercise it. Controller explicitly approved only private non-clarifying snapshot wiring, while keeping public requirementSummaryOf's two-argument/default path and the clarifying path unchanged.

RED: `rtk proxy python3 /private/tmp/od9/run.py perf-task1-converted-red npx vitest run tests/panel/controlPollPerformance.test.ts -t 'converted requirement'`, observed product HEAD `e4db472f1f5bfb961db199854a5ed1b1e3613204`, rc=1: the real converted requirement summary executed 2 run body batches, expected 1. Complete log: `/private/tmp/od9/logs/perf-task1-converted-red.log`.

Fix: private requirementSummaryFromSnapshot carries the request snapshot to blockedRequirementRun only from non-clarifying readGroupSummaryFromSnapshot. It filters active=1 over the original rowid-order rows and performs lazy raw decode at the original read position. Public requirementSummaryOf still delegates without a snapshot and retains its original query. No requirement writer, exported signature, role rule, active-run interpretation or rejection guard changed. The snapshot is kept in a local variable so task completion and the requirement line use that same instance.

The new criterion creates a real split → accept → confirm → export → start → claimed active work group through existing services and fake single-call provider. Valid summary/detail each execute one work and one run body batch, target point gets=0, each used raw body parse≤1; detail latest activity batch=1 and summary=0. It retains historical single-call runs in strict detail. Malformed active body still causes the original SyntaxError with the exact native JSON.parse message **before** strict work/run detail validation; malformed inactive history stays unparsed by summary and is named run-invalid:<historyId> by strict detail. No inactive body is eagerly decoded or swallowed into an empty blocker result.

Late gates:

| Command | Observed tree | Result | Complete log |
| --- | --- | --- | --- |
| `rtk proxy python3 /private/tmp/od9/run.py perf-task1-late-regression npx vitest run tests/panel/controlPollPerformance.test.ts tests/panel/groupSummaryFields.test.ts tests/panel/requirementApi.test.ts tests/control/requirementGuards.test.ts tests/control/requirementExport.test.ts tests/control/settleUnknownUsage.test.ts tests/control/handoffFailedRetry.test.ts` | e4db472 + latest private product source patch | rc=0, 7 files, 127 tests, no skips | `/private/tmp/od9/logs/perf-task1-late-regression.log` |
| `rtk proxy python3 /private/tmp/od9/run.py perf-task1-latest-commit-tests npx vitest run tests/panel/controlPollPerformance.test.ts` | `9092f6beba51d178df556527e978207ad4084d36` | rc=0, final 18 new tests, no skips (including later inactive-history assertions) | `/private/tmp/od9/logs/perf-task1-latest-commit-tests.log` |
| `rtk proxy python3 /private/tmp/od9/run.py perf-task1-latest-commit-typecheck npm run typecheck` | `9092f6beba51d178df556527e978207ad4084d36` | rc=0 | `/private/tmp/od9/logs/perf-task1-latest-commit-typecheck.log` |

The original named seven regression files remain green in the earlier 112-test gate; requirement/summary plus D9/M3 were rerun for this new private edge. All old test files are unchanged. Latest exact-commit observations re-confirm the prior 10/50 table and aliasBuckets=[]; no broader SQL/timing benefit is claimed.

Latest isolated mutation baseline: `4f17b34cb0c9d8d474a71201542bcc08dbad4147`; all five product source byte comparisons against `9092f6beba51d178df556527e978207ad4084d36` are true. `rtk proxy python3 /private/tmp/od9/task1-mutations.py` reran the original 24 guard removals plus the three below, each with a unique exact-source replacement anchor and its named real-entry assertion. All **27** runs returned rc=1, and restoration after each was unstaged/staged diff 0/0 bytes. Latest final proof: `/private/tmp/od9/logs/perf-task1-late-restore-proof.json` (also includes source SHA-256 values).

| Additional mutation | Named pattern | Exact RED behavior | rc |
| --- | --- | --- | ---: |
| converted-context | `converted requirement` | removing snapshot argument restores 2 run body batches instead of 1 | 1 |
| converted-active-filter | `converted requirement` | removing active=1 filter makes summary reject malformed inactive history | 1 |
| converted-error | `converted requirement` | swallowing stored SyntaxError changes refusal into TypeError, failing exact error-class assertion | 1 |

Stable copies of the **latest** complete logs/diffs are `/private/tmp/od9/logs/perf-task1-late-mutation-<name>.log` / `.diff`, with full per-run commands/rc/restore values at `/private/tmp/od9/logs/perf-task1-late-mutation-results.json`. Earlier generic temporary mutation filenames were reused by the latest run and now refer to the new baseline; the 24-run history above remains a historical tool observation, not a description of those mutable paths' present contents. The late-prefixed copies freeze the current evidence. Complete native logs were read; an initially oversized tool display was truncated, so the missing middle logs were reread in a bounded complete batch before acceptance.

Final Task 1 status: DONE_WITH_CONCERNS. Both product commits are required (`e4db472…` then `9092f6beba51d178df556527e978207ad4084d36`), plus this owned report-only commit. The converted edge is closed. Remaining canonical/proposal/proof/evidence reads and instrumentation attribution limits remain as described, and Task 3/controller still owns integrated before/after equivalence, timings and whole-round gates.
