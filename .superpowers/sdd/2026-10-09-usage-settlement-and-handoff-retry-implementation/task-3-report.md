# Task 3 implementation report

Owner: `/root/implement_settlement_ui` (controller-dispatched product writer). Date: 2026-10-09. Worktree: `/Users/biran/.codex/worktrees/usage-settlement-handoff-retry/Orca`. Branch: `codex/d9-m3-implementation`. BASE: `c2e81f2cba160546e633ab683c02a23522f0d13c`. Binding: design §9 including §9.5, task-3-brief and global-constraints.

Status: DONE. Product commit: `aa03c91994d660ce765910fdbbc34372b505f0de` (`feat(web): confirm conservative usage settlement and handoff retry`). This report is a separate evidence commit. No push, merge, branch/worktree deletion, real service/provider/control library, ccloop/ccmem product change or subagent spawn.

## Delivered

The real `AccountContext` user roles are read in App and passed through ControlPanel to ControlGroupView. The new D9 entry requires an explicit owner role; null/absent accounts and members get contact-owner guidance. This does not reuse `mayHumanOnly`'s null fallback. Server `allowed` describes business qualification, never owner authority. Commands carry only the exact task/run/generation/acknowledge payload; neither identity authority nor charged amounts are accepted from the browser.

Controller approved the small `web/src/UsageSettlement.tsx` component: its only responsibilities are read-only server remaining/charged tables, translated refusal/receipt information and explicit local confirmation. GroupView's existing onCommand/App sender retain command ids, revision handling, lost-response recovery and canonical re-reads. The two-bucket table shows tokens, activeMs (labelled milliseconds), attempts and sessions without deriving a charge. Confirmation explains all remaining amounts, including known unused amounts, conservative accounting rather than actual model usage, irreversibility and no automatic restart. An unchecked confirm is disabled and guarded at click time. Preview/revision/roles changes discard prior consent. Settled receipts show conservative method, principal, ISO time and charged amounts; activity rows show method and both four-dimensional charged buckets in human words. Both locales have complete text.

Failure cause now follows a non-success outcome across settlement/handoff state changes via `hasFailureOutcome`; the original exported `isTerminalFailure` predicate keeps its original blocked-only semantics. The table and task detail use the same `retryRunOpen`: current run only, no pending continuation/open request/current unknown usage. Existing active failures retain their path. New held admission requires held work and both allocations, settled-recoverable request and a complete checkpoint with snapshot. New released admission requires blocked work, terminal allocations, released manual marker and settled-failed request. Both inactive branches refuse group usageUnknown and require pendingRunId explicitly null. Stopped/clarifying/archived groups refuse Retry. Plain historical settled-failed without the marker remains ineligible. The client does not validate immutable claims/isolation proofs or invent a server grant/source pointer; race/pending-event and full identity validation remain the Task 2 server's authority and its refusal appears via the existing command flow.

The existing no-continuation resume button is reused, sends selections=[] only for handoff-complete, and remains reachable when nothing may Continue. Manual settled-failed is explicitly excluded from continuation even if a stale client flag is true. Guidance distinguishes resuming a saved checkpoint with held remainder from creating a new run at current group branch head with a new reservation. An unresolved other run keeps the stop banner/request/run state visible and offers no empty resume or Retry; this UI never clears a stop itself or announces the whole group recovered.

`controlTypes.ts` already contained Task 1's settlement payload/view/result/activity and Task 2's vocabulary, so it was consumed without gratuitous type edits. The frontend ControlAction union and command route gained D9. `UsageSettlement.tsx` and `web/tests/usageRecoveryFixture.ts` are the only ancillary new files beyond the two required test files.

## Named existing-test migrations approved by controller

Only these existing criteria were migrated; historical comments and business assertion strength were retained:

1. `web/tests/i18nPseudo.test.tsx` / `every enum value has its words in both languages (spec §3.5)` / `reads every family`: ENUM_VALUES count 178→181, documenting usage-settled activity, settled-failed request and retrying allocation. The 34-family count and every-value English/Chinese checks remain unchanged. Controller ruling: register new protocol vocabulary so the catalogue guard remains meaningful.
2. `web/tests/archiveGroup.test.tsx` / `archiving from the group view (spec §6.3)` / `offers no retry on an archived group, because the server refuses every command but Unarchive (group-archived)`: fixture now sets currentRunId=failed.runId and lineageRunIds=[failed.runId] rather than a null current run. Original open-group 2 Retry and archived-group 0 Retry assertions are unchanged. Controller ruling: test archive qualification on a legitimate current failed run; review should still examine any other identity mismatch.

No original commandRecovery assertion or timeout was changed. One new D9 test was appended, using existing AccountContext and real App/ControlPanel/GroupView wiring with HTTP fixtures, to observe the sent strict payload and retained original command id after lost POST response.

## Verification and RED evidence

All shell commands used rtk; git was `/usr/bin/git`. Runs use `/private/tmp/od9/run.py` with HOME/XDG/control data redirected by `/private/tmp/od9/env.json`; ORCA_CCLOOP_BIN remains `/private/tmp/orca-d9-ccloop-ab824d1/dist/cli.js`. Web tests use HTTP fixtures and jsdom, no real service/provider. Each complete log and paired real RC was read back. The runner's fixed cwd is the worktree above.

Valid initial TDD business RED, observed BASE c2e81f2 with new test overlay:

```
rtk proxy python3 /private/tmp/od9/run.py task3-red-corrected env DEBUG_PRINT_LIMIT=200 npm exec --workspace web -- vitest run tests/settleUnknownUsage.test.tsx tests/handoffFailedRetry.test.tsx --maxWorkers=2 --reporter=dot
```

RC=1: 8 business failures (missing owner confirmation/contact guidance/refusal, missing held failure reason/Retry and settlement receipt), 7 baseline negative criteria passed. Log `task3-red-corrected.log`. Earlier `task3-red.log` incorrectly used root cwd/include and found no tests; `task3-red-business.log` had a missing fieldProvenance fixture and was corrected before implementation. These are diagnostic, not claimed TDD evidence.

Activity RED before its implementation: `task3-activity-red.log`, RC=1, the real activity output was only “usage settled” and lacked conservative method/charged fields. The same run exposed an incomplete App project-scope fixture; that fixture was corrected. Early `task3-green-1` had a misuse of refusalText's typed interface, caught by both the business refusal test and web tsc; corrected rather than weakening the assertion. `task3-directed.log` observed the App sender waits for the next tick to look up a lost POST; the new test was corrected to assert the actual lost-answer state/original id, not an immediate 503 lookup that production never performs.

Whole Web check, observed BASE c2e81f2 plus final byte-identical product/test overlay:

```
rtk proxy python3 /private/tmp/od9/run.py task3-check-final env DEBUG_PRINT_LIMIT=100 npm run --workspace web check -- --maxWorkers=2
```

RC=0, 90 files/729 tests, including tsc. Log `/private/tmp/od9/logs/task3-check-final.log`. Prior `task3-check.log` RC=1 had four failures: the old 178 enum count, null-current archive fixture, original blocked-only isTerminalFailure expectation (restored through the separate helper), and the unchanged commandRecovery `drops the id when the lookup returns the command's retained result` observing storedIds=[cmd-lost] after its DOM pending line disappeared. No original storage assertion or timeout was altered; the complete final run and committed directed run below passed it. This records the observation without declaring or registering a new flake.

Committed verification, observed product `aa03c91994d660ce765910fdbbc34372b505f0de`:

```
rtk proxy python3 /private/tmp/od9/run.py task3-committed-directed env DEBUG_PRINT_LIMIT=100 npm exec --workspace web -- vitest run tests/settleUnknownUsage.test.tsx tests/handoffFailedRetry.test.tsx tests/driverRetry.test.tsx tests/taskActivity.test.tsx tests/controlCommandRecovery.test.tsx tests/archiveGroup.test.tsx tests/runFacts.test.ts tests/i18nPseudo.test.tsx --maxWorkers=2 --reporter=dot
rtk proxy python3 /private/tmp/od9/run.py task3-committed-type npm run typecheck
rtk proxy python3 /private/tmp/od9/run.py task3-committed-build npm run build --workspace web
```

All RC=0. Directed: 8 files/84 tests; logs `/private/tmp/od9/logs/task3-committed-{directed,type,build}.log`, paired `.rc`. Initial non-escalated build `task3-build.log` was filesystem EPERM when replacing ignored web/dist; authorized escalation reruns `task3-build-approved` and committed build succeeded. Build reports the >500kB chunk warning; no warning suppression or bundling scope expansion was done. Root full repository suite is explicitly Task 4 and has not been claimed here.

## Isolated deletion mutation audit

Command: `rtk proxy python3 /private/tmp/od9/task3-mutations.py`. It created `/private/tmp/od9/task3-mutations` with `/usr/bin/git clone --local --no-hardlinks <worktree> <clone>` at c2e81f2, copied the 15 named final product/test bytes, mutated only that clone and restored in finally. `/private/tmp/od9/task3-mutations.json` records every exact per-mutant vitest command, log and RC. Every targeted run ran the complete selected file, not filtered criteria; restored GREEN ran all three selected files without skipping tests.

| Deleted/disabled branch | Direct business observation | RC |
|---|---|---|
| owner guard | member/absent account incorrectly gets D9 button | 1 |
| explicit confirmation | unchecked irreversible confirm becomes enabled | 1 |
| four-dimensional fee table | missing remaining table in English and Chinese | 1 |
| outcome-based failure reason | held failure loses reported-error explanation | 1 |
| held retry | no Retry in current failed task detail | 1 |
| released retry | no Retry after empty resume of manual failure | 1 |
| other/group unknown guard | inactive task incorrectly gets Retry | 1 |
| current-run identity | old failure incorrectly gets Retry | 1 |
| manualfailed Continue exclusion | manual failure incorrectly enters selected continuation | 1 |
| App authenticated roles | actual owner App loses settlement entry | 1 |
| settlement activity branch | method/charged details vanish | 1 |
| empty resume block | manual failure loses its resume exit | 1 |

Logs are `/private/tmp/od9/logs/task3-mut-<name>.log`, paired `.rc`, with exact names in the manifest. Restored `task3-mut-restored-green.log` RC=0, 3 files/21 tests. The clone's restored overlay was committed as `442ffe8f8cf83f1966c5f2562e7aadd864465e62` solely to make git restoration evidence explicit; this is not a product-worktree commit.

`task3-mutation-proof.json` records main tracked diff 26718→26718 bytes, byte-identical, main cached 0→0 and all 15 named main/clone SHA256 hashes equal throughout the mutation run. After product commit, `/private/tmp/od9/task3-final-restore-proof.json` records main named product diff=0/cache=0, clone full diff=0/cache=0, observed main aa03c91/clone 442ffe8, all 15 hashes equal. Controller progress.md and untracked node_modules are excluded from the product stage.

## Self-review and remaining boundary

Checked strict D9 payload and route, current preview data rather than budget reserve/derived fee, all eight dimensional values, irreversible consent reset, real role propagation, unchanged server authority, failure history retention, shared table/detail retry qualification and explicit null inactive pending identity. Both released and held paths remain separate from checkpoint Continue. Existing ordinary Retry and archive/stop gates retain coverage. No unrelated UI styling, socket/MCP authority, source pointer, server proof validation or M5/M6 work was added.

No functional concern remains in this task. Server pending events, content-addressed proof/claim/lineage and continuation-registration qualification are intentionally not recomputed from incomplete UI DTOs. Full root integration/adversarial audit and final user review remain controller Task 4. No token/cost estimates are asserted.
