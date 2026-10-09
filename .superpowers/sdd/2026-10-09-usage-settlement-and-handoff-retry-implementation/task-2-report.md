# Task 2 implementation report

Owner: `/root/implement_handoff_retry` (controller-dispatched worker). Date: 2026-10-09. Worktree: `/Users/biran/.codex/worktrees/usage-settlement-handoff-retry/Orca`. Branch: `codex/d9-m3-implementation`. Product BASE: `d3b9d6a06db98ce75f85e1fb27c15f30d16e18c0`. Binding: usage-settlement-and-handoff-retry design §9, especially §9.5.

Status: DONE. Product commits: `ce4de4b` (M3 lifecycle/actual policy), `a78d5eb9d18f1b175a379b05a772bdb21b832bb8` (self-review: explicit null pending run). This report is a separate evidence commit. No push, merge, branch/worktree removal, provider, real user state or ccloop/ccmem product change.

## Delivered

`applyRetryTask` now admits the active blocked-at-C failure, an inactive recoverable failed handoff holding its remainder, and an inactive manually settled released failure. Held retries restore the failed run's own claim grant and reserve only grant minus held remainder. Released retries reserve the entire claim grant and never call releaseCommitment again. Ordinary active confirmed retries retain confirmed allocation semantics. Active continuation/reduced retries use retrying and can update their source to the newest failed run. Source run usage, reason, checkpoint, wall-clock times and lineage remain historical evidence.

`validateRetryGrantSource(store, groupId, work)` is the shared live commitment validator used by contract, panel and dispatch readers. Retry allocations omit only amount from frozen comparison; identity, bucket and provenance still compare to the immutable snapshot. It binds source/current/intermediate runs to task, row order, exact lineage, graph/target, frozen agent/provenance, profiles, content-addressed original claim, hash, grants and owner token. Historical usageSettlement markers remain strictly validated. Missing source for retrying, incompatible states, drift, or pending usage are recovery-blocked. Ready no-provider reclaims retain the original source and commitment while currentRunId remains the newest row. Invalid first proof may have a nonzero providerAttemptOrdinal, but must have executionId=null, zero cumulative, full remaining and known usage; restartable additionally requires its settled request. Normal held/continuing/terminal writers clear the source in the same transaction; shared saveWork prevents an old local work body from reintroducing it.

A2 now always derives the actual accept envelope policy with withinGrant, including normal retry and no-start reclaims: tokens, attempts and active time are independently min(frozen policy, claim grant). Contract hash remains frozen, retry checkpoint is null and retry base is the newest group head. Sessions remain admission accounting.

Task 1's marker, receipt, hasObservedUsage, manual request settlement and stop derivation were consumed unchanged. Both real synthetic-driver orderings are covered: failure→D9→handoff→empty resume→retry→claim, and failure→handoff→released D9→empty resume→retry→claim. New settled-failed manual runs still refuse Continue.

## Qualification and errors for Task 3

Common: group is neither clarifying, stopped nor under any stop intent; archive command-ledger guard remains. Current run is newest by rowid, belongs to the exact group/task/work item and lineage, matches frozen agent/target and its immutable original claim. Drive outcome is non-null and non-success. Current unknown or usage_events seq>highWater refuse with `task-not-retryable:usage-unknown` / `usage-pending`; open adoptable handoff requests refuse with `handoff-request-open:<id>`. A persisted manual marker must validate fully.

| Admission | Required work/run/allocation | Reservation/source |
|---|---|---|
| Existing active | active=1, run blocked, drive.blockedAt=C | Ordinary confirmed keeps prior grant/state; existing reduced/continuing retry uses run grant and retrying/source |
| New held M3 | active=0, settled-recoverable, recoverable=true, work held/current run; both held allocations and work grant equal run.remaining; latest request settled-recoverable; complete content-addressed failed checkpoint, snapshot/artifacts and isolation proof | Restore run.grant, release held remainder, reserve run.grant; source=current failed run |
| New released M3 | active=0, settled-failed, recoverable=false, work blocked/current run; both terminal allocations; work grant=run.grant; valid released D9 marker with settled-failed request | Full run.grant reservation, zero release; source=current failed run |

New held/released admission requires pendingRunId explicitly null. An absent field or pending id refuses `task-not-retryable:continuation-pending`; ordinary active legacy records retain optional-field compatibility. work.continuation may be absent/null or exactly the consumed strict registration: same task, derived desired/continuation identity, pendingRunId=current run, matching claimOrdinal and run continuationIntentId. A foreign/unconsumed registration refuses `continuation-identity`. Only that consumed registration is removed. Historical run/wake identities remain.

Controller ruling (2026-10-09): new held/released M3 also refuses any OTHER historical group run's unknown or highWater-after pending usage, before release/reserve. It uses exported budget `groupUsageUnknown(store, groupId, currentRun?)`, not the UI ledger mirror; errors remain `task-not-retryable:usage-unknown` / `usage-pending`. Ordinary active branch keeps its existing conditions, and start/claim group guards remain intact.

Other details: wrong current/run frozen identity is `recovery-blocked:retry-identity`; immutable claim mismatch is `recovery-blocked:retry-claim-identity`; invalid manual settlement is `recovery-blocked:retry-settlement`; an inactive state outside the two M3 qualifications is `task-not-retryable:run-state:<state>`. Held missing its settled request is `handoff-settlement`; checkpoint validation uses `run-stop-proof-required:handoff-checkpoint`. Short reserve is `group-reserve-insufficient:<dimension>:<shortfall>`, including both buckets/all four dimensions. Source validator details have prefix `retry-source:<workItemId>:` and keys missing, work-state, lineage, source-state, settlement, amount, identity, claim, claim-identity, pending-usage, continuation, normal-claim, active-work, no-provider, source-work, invalid. UI should present qualification, not hide the existing failure reason or offer manual failed checkpoint Continue.

## Verification at final product commit

All shell invocations were through rtk; git was `/usr/bin/git`. Tests used `/private/tmp/od9/run.py` and redirected HOME/XDG/control data. ORCA_CCLOOP_BIN is the required `/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js` pin. Synthetic driver ports perform local fixture work only. Logs and real RC files were read back without filtering.

Final observation: `a78d5eb9d18f1b175a379b05a772bdb21b832bb8`.

```
rtk proxy python3 /private/tmp/od9/run.py task2-final-directed-limited npx vitest run --reporter=dot --maxWorkers=2 tests/control/handoffFailedRetry.test.ts tests/control/retryTask.test.ts tests/control/settleUnknownUsage.test.ts tests/control/driverContinuation.test.ts tests/control/webContinuation.test.ts tests/control/webContinuationAccounting.test.ts tests/control/continuation.test.ts tests/control/driverHandoff.test.ts tests/control/handoffStop.test.ts tests/control/handoffTransaction.test.ts tests/control/handoffGuards.test.ts tests/control/driverHandoffSnapshot.test.ts tests/control/webDispatch.test.ts tests/control/executionSnapshot.test.ts tests/control/driverEstimateHandoff.test.ts
rtk proxy python3 /private/tmp/od9/run.py task2-final-type-a78 npm run typecheck
```

Results: first RC=0, 15 files/202 tests passed; typecheck RC=0. Logs: `/private/tmp/od9/logs/task2-final-directed-limited.log` and `task2-final-type-a78.log`, paired `.rc` files. 18 new criteria include actual accept policy dimensions/hash/null checkpoint/moved head, consumed registration, both D9 orders, replay/second fresh command refusal, newest currentRunId, restart close/reopen/reclaim, same reservation, repeated active reduced retry, frozen/claim/lineage/grant corruption, source clears on recoverable park/normal success/unrecoverable handoff, legal old Continue, manual failed Continue refusal, insufficient reserve, stop/archive, other historical unknown/pending and explicit null pending identity. Original retryTask tests were not changed.

Valid TDD RED: BASE with new test overlay, `task2-red-corrected.log` RC=1, six inactive-admission business failures; and `task2-other-red.log` RC=1, two missing group-usage refusal assertions. Earlier `task2-red.log` was sandbox ps EPERM; initial `task2-red-business.log`/`task2-diag.log` included a new-fixture missing await on asynchronous settle. Those are diagnostic only and do not count as TDD evidence; await was corrected and Task 1 product logic was not modified. Intermediate tightening exposed a private registration parser, then exported it and restored GREEN. Reopen fixture initially reused the old store identity, then was corrected to a new store/service/dispatch/command generator.

One final default-worker run at ce4de4b (`task2-committed-directed.log`) returned RC=1 solely for an unchanged retryTask test's 5000ms timeout while a clone run was concurrent; 201 other tests passed. No old assertion/timeout was loosened. The complete final 15-file run above used maxWorkers=2 and passed all 202. This records the failure rather than concealing it.

## Deletion mutation audit

Only `/private/tmp/od9/task2-mutations`, created by `rtk proxy /usr/bin/git clone --local --no-hardlinks <worktree> <clone>`, was mutated. Script `/private/tmp/od9/task2-mutation-run.py` restores all named product/test bytes in finally. Earlier mutations ran on BASE plus Task 2 overlay; final restored clone commit `7198864134e00d08fb96556bc0ab230912d0d9da` has byte-identical product/test paths to a78d5eb (proof includes per-file SHA256). Manifest `/private/tmp/od9/task2-mutations.json` has commands and RC for every run; latest logs are `/private/tmp/od9/logs/task2-mut-<name>.log`, paired `.rc`. Each targeted run naturally skips unrelated criteria; final normal runs skip none.

| Deleted branch / name | Business assertion hit (all RC=1) |
|---|---|
| inactive | handoff-settled continuation must retry |
| released | released manual settlement must retry |
| restore-grant | work.grant must restore claim grant in four dimensions |
| source | actual contract reader must reject missing retry source |
| no-start | valid invalid-proof retry view must not throw |
| restartable | valid pre-provider stopped retry view must not throw |
| clamp | actual accept token limit must shrink |
| tokens | actual accept token limit must shrink |
| attempts | actual accept attempts must shrink |
| runtime | actual accept runtime must shrink |
| consumed | consumed continuation must disappear from live work |
| live-clear | source must disappear on held, successful terminal and unrecoverable terminal transitions |
| other-usage | M3 must refuse other historical unknown/pending usage |
| admission-identity | drifted claim grant must refuse before reservation (mutation accepted it); identity detail assertions also red |
| strict-source-pending | actual contract reader must reject missing pendingRunId on persisted retry source |
| strict-admission-pending | M3 must refuse missing pendingRunId rather than ready/reserve |

Restored final clone: `rtk proxy python3 /private/tmp/od9/task2-clone-green.py` RC=0, 18/18 passed, log `/private/tmp/od9/logs/task2-clone-restored-green.log`. Proof `/private/tmp/od9/task2-restore-proof.json`: main named product `git diff`=0 bytes, main `git diff --cached`=0; clone `git diff`=0 and `git diff --cached`=0. Full commands, RC, observed main/clone commits and hashes are stored in the proof. The only main pending tracked change is controller-owned progress.md; untracked node_modules remains excluded.

## Self-review and remaining scope

Verified command/savepoint atomicity, no second release on released admission, exact consumed registration, row-order lineage (not lexical id order), all four budget dimensions/two buckets, unchanged historical marker checks, frozen provenance/hash and actual port.accept limits. Shared source clearing covers both allocation transitions and stale local work writes; estimate/review owners without a work row retain prior allocation behavior. Schema stays at Task 1's single-way schema 10; old records without retry source remain compatible. New allocation vocabulary is paired in stored schema, wire view, mirrored web type and both locales.

No functional concern remains in Task 2. UI eligibility/button/reason work is Task 3. Full repository suite and broader adversarial/audit gates are Task 4, as dispatched; they were intentionally not claimed complete here. M5/M6 performance work remains outside this implementation. No controller ledger, prior issue-fixes work, unpublished performance spec/plan or dependency symlink was staged.
