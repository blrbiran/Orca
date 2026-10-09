# Task 2 review — Spec ✅ / Task quality Approved

Owner: `/root/review_handoff_retry_task`, 2026-10-09 Asia/Shanghai. Fixed BASE `d3b9d6a06db98ce75f85e1fb27c15f30d16e18c0`; HEAD `2c7a531029e7e461de6dfdf23c373b7dc4245267`. Reviewed the supplied three-commit diff package, Task 2 brief/report, global constraints, spec §9 (including §9.5) and controller historical-group-usage ruling. No product/index/HEAD/branch mutation, subagent, or suite rerun; this new review file is the only write.

## Spec Compliance

- ✅ Three admissions and reservations match the task: active blocked-at-C, inactive recoverable held, released manual settled-failed (`src/control/retryTask.ts:75`). Held uses source claim grant minus held remainder; released uses zero release and full reservation (`retryTask.ts:115`, `retryTask.ts:123`). All four dimensions use the two-bucket sum; mutations and post-command assertions exercise actual restoration/accounting (`tests/control/handoffFailedRetry.test.ts:94`, `:113`). Original retryTask tests are untouched in the supplied diff.
- ✅ New held/released admissions check all historical group unknown/pending usage inside command application before release/reserve (`retryTask.ts:94`, `src/control/budget.ts:89`); ordinary active retains the current-run unknown condition (`retryTask.ts:89`). Stopped/archived and explicit-null pending identity remain refusals (`tests/control/handoffFailedRetry.test.ts:263`, `:273`, `:298`).
- ✅ Shared live source binds source/current/intermediate row order, exact lineage membership, task/target/agent, original content-addressed claim, profiles, grant and owner token (`src/control/retryGrant.ts:28`, `:40`). Frozen comparison omits only task amount for retrying (`src/control/executionSnapshot.ts:314`); driver and panel both call the validator (`executionSnapshot.ts:326`, `src/panel/controlViews.ts:617`). Missing source and drift fail closed (`tests/control/handoffFailedRetry.test.ts:184`).
- ✅ No-provider invalid proof and settled-restartable transitions retain source, newest currentRunId and commitment, require zero cumulative/full remaining/known usage, and do not require ordinal zero (`retryGrant.ts:68`). Tests close/reopen the store and reclaim, then reach actual accept (`tests/control/handoffFailedRetry.test.ts:144`, `:158`).
- ✅ Live source clears on held/continuing/terminal allocation transitions and on stale work writes (`src/control/stopIntent.ts:825`, `src/control/queries.ts:51`). Tests cover held+legal Continue, normal terminal success and unrecoverable terminal handoff (`handoffFailedRetry.test.ts:219`, `:233`, `:245`).
- ✅ Consumed continuation registration is parsed strictly, matches the current claim and derived continuation identity, and is removed only after checks (`retryTask.ts:99`, `:133`). Original run/history stays intact. First active continuation changing continuing→retrying (`retryTask.ts:115`) is consistent with the task's reduced/continuing support: §5's “随后 active retry 保留已有 allocation state/amount” concerns an already established M3 retry commitment; ordinary confirmed active retries still retain confirmed. This is not treated as an extra feature or a spec violation.
- ✅ A2 clamps the actual execution policy for every task claim (`src/control/executionDriver.ts:306`). Actual fake-port accept assertions check independent token/attempt/runtime minima, frozen hash and null checkpoint; the group head is moved before retry dispatch (`handoffFailedRetry.test.ts:68`, `:71`, `:72`, `:73`, `:106`). Active-after-reduced and invalid-proof reclaims also reach this accept assertion helper (`:173`, `:144`).
- ✅ Both D9 orderings reach retry/claim (`handoffFailedRetry.test.ts:113`, `:132`), and released manual failure cannot Continue (`:119`). Existing marker validation is preserved: source uses `hasValidUsageSettlement` (`retryGrant.ts:35`), admission rechecks it (`retryTask.ts:114`), and panel historical run reading still checks every present marker (`src/panel/controlViews.ts:742`). No provider event or historical marker rewrite was introduced.
- ⚠️ Full UI reasons/buttons and the whole-round account cap/integration gates are outside this Task 2 diff and belong to Tasks 3/4. No completion claim for those scopes. Task 1's already-reviewed settlement implementation was inspected only at directly consumed proof/marker interfaces; its gate was not repeated.

## Strengths

- Grant authority comes from the immutable source claim, and the relaxed frozen amount comparison is paired with a live validator (`retryTask.ts:67`, `retryGrant.ts:44`), rather than permitting arbitrary reduced amounts.
- New tests use real control commands, persisted SQLite state, synthetic execution ports, handoff and restart flows. Their budget/source assertions run after the action; they are not reads of their own fixture setup (`handoffFailedRetry.test.ts:100`, `:105`, `:125`, `:154`).
- Cleanup addresses both persisted allocation transitions and stale local work objects, avoiding reintroduction of a removed source (`stopIntent.ts:825`, `queries.ts:51`).

## Evidence checked

Read full raw final logs and RC files: `/private/tmp/od9/logs/task2-final-directed-limited.log` (RC 0, 15 files/202 tests, no skipped final tests), `task2-final-type-a78.log` (RC 0), and `task2-clone-restored-green.log` (RC 0, 18/18). Commands and observed final product commit `a78d5eb9d18f1b175a379b05a772bdb21b832bb8` are recorded in task-2-report.md. Read corrected RED logs `task2-red-corrected.log` (six real inactive admission failures) and `task2-other-red.log` (two group-usage refusal failures); diagnostic sandbox/fixture errors were not counted as RED.

Read `/private/tmp/od9/task2-mutation-run.py`, `task2-mutations.json`, all 16 distinct latest mutation logs and their RC files. Each returned 1 with a business assertion failure, not a compiler/import error. Mapped old log line numbers by assertion content to the final diff:

| Mutation | Final assertion / observation |
|---|---|
| inactive | handoff retry succeeds, test :100 |
| released | released retry succeeds, :121 |
| restore-grant | work grant equals failed claim, :101 |
| source | contract reader rejects missing source, :209 |
| no-start | view accepts valid no-provider state, :150 |
| restartable | view accepts valid restartable state, :165 |
| clamp / tokens | actual accept token limit, :68 |
| attempts | actual accept maxAttempts, :69 |
| runtime | actual accept runtime, :70 |
| consumed | consumed registration absent, :102 |
| live-clear | source absent after held/success/unrecoverable transitions, :225 / :239 / :258 |
| other-usage | unknown/pending refusal, :281 |
| admission-identity | grant corruption was incorrectly admitted by the mutant, :292; other identity cases changed refusal details |
| strict-source-pending | missing pending field rejected by contract reader, :209 |
| strict-admission-pending | missing pending field rejected before reservation, :309 |

The early mutation logs used evolving overlays (some have 12 tests); they are not falsely described as final-tree reruns. Their changed branches and assertions remain in the final diff. A fresh read-only `rtk proxy python3` SHA256 comparison on the reviewed HEAD found all 15 product/test paths equal both to `task2-restore-proof.json` and the restored clone. The proof records main product commit a78d5eb, clone commit 7198864 and zero named-product/staged diff bytes. The supplied HEAD's later commit is evidence-only. No git commands or validation suite were rerun by this reviewer.

## Focused cross-module checks

- Risk: source cleared by one writer but resurrected by another. Checked the direct `setAllocationStates` callers: `stopIntent.ts:772` restartable/recoverable/terminal transitions, `continuation.ts:177` register, and `budget.ts:167` releaseRunReserve. Read changed-file context only where diff hunks cut off these functions. The allocation hook plus saveWork safeguard covers the examined writers.
- Risk: a released marker becomes invalid after retry, or the new failed state accidentally becomes continuable. Checked `usageSettlement.ts:89` marker/receipt/proof conditions and `continuation.ts:137` assertPredecessor; marker validity does not require the live work's old status, while Continue still requires held/settled-recoverable. Checked `stopIntent.ts:193` request reader and `:209` latest request identity path.
- Risk: contract reader accepts a source whose frozen binding changed. Completed the cut-off `executionSnapshot.ts:328` reader context and `webDispatch.ts:422` immutable claim lookup; the reader retains snapshot/provenance/agent checks and source independently validates claim hashes/profiles.
- Risk: historical marker corruption becomes hidden after source advancement. Checked the existing historical `controlViews.ts:742` check; it remains unchanged and active for all run rows.
- Risk: final GREEN conceals an unaccounted operational error. Located `repository-unavailable` in unchanged `tests/control/retryTask.test.ts:327`, where cleanup recovery intentionally injects it; see Minor below.

## Issues

### Critical

None.

### Important

None.

### Minor

1. **Direct active-continuation entry is not independently demonstrated.** `src/control/retryTask.ts:115` adds a continuing→retrying arm. The new reduced fixture first handoffs the failed continuation (`tests/control/handoffFailedRetry.test.ts:88`), and the active retry case starts from an already retrying normal claim (`:173`). Existing directly-related retry/continuation tests inspected do not exercise that first active-continuation arm. Add a focused continuation-fails→retry-without-second-handoff criterion and delete only this arm in a clone; current code is coherent, so this is a coverage improvement rather than a demonstrated behavioral defect.
2. **GREEN output has known noise.** `/private/tmp/od9/logs/task2-final-directed-limited.log` contains Node SQLite ExperimentalWarning, snapshot bundle verification output, and the intentional repository-unavailable cleanup diagnostic from `tests/control/retryTask.test.ts:327`. These do not invalidate RC 0/202 passed, but the evidence is not pristine. Capture/assert intentional test diagnostics or explicitly document expected noise rather than presenting a warning-free gate.

## Assessment

**Task quality: Approved.** Task 2's reservation, immutable source and no-provider lifecycle behavior matches its scope; the independent policy minima and core lifecycle branches have concrete mutation evidence. No Critical or Important defect found; the two Minor observations do not block Task 3.
