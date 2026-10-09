# Spec review 2 — corrected new draft

Owner: Codex subagent `/root/review_usage_design`, 2026-10-09 (Asia/Shanghai). Observation commit: `c29676d6d0050d46b9cf61f45ffaee583f9dec76`, measured with `rtk proxy /usr/bin/git rev-parse HEAD`. Scope: corrected `docs/superpowers/specs/2026-10-09-usage-settlement-and-handoff-retry-design.md` only. Review 1 remains untouched. No human ruling signed; no cost estimate available.

## Previous findings

- Important 1 resolved: §4 preserves task allocation amount/state like recordUsage, so D9 no longer corrupts frozen snapshot comparisons or leaves a zero task allocation for active retry.
- Important 2 resolved at allocation-design level: §5's retrying state and persisted retryGrantSourceRunId separate legitimately reduced live grants from immutable snapshot grants. Exact allocation/work/source grant checks in both frozen readers, retention through claim and subsequent retries, and unchanged ordinary confirmed active retry are coherent.
- Both previous Minor points are addressed: §3 explicitly supplies both bucket amounts and authenticated owner/member UI behavior; §5 places empty-selection resume next to preserved checkpoint Continue and states the excluded unknown handoff-partial/unresolved path.

## Critical

None found.

## Important — one remaining required clarification

**Do not reject a consumed continuation registration as if it were pending.** Draft §5 (line 64, measured with `rtk rg -n`) requires “无 pendingRunId/continuation 注册才允许 M3 重试”. Yet the acceptance row at line 93 explicitly supports a failed continuation's reduced claim grant. Existing `continuation.ts:registerContinuation` saves work.continuation (line 177). `webDispatch.ts:createStartingRun` clears work.pendingRunId at line 368 but retains work.continuation because A2 needs it (`executionDriver.ts:continuationOf`). Recoverable `stopIntent.ts:terminaliseRun` (line 746; grant parking at 792) also preserves that consumed record. The record is cleared only on a different restartable-never-started branch (line 771). Therefore a genuinely claimed continuation that fails, is handed off recoverably, and resumes with selections=[] is held/current with pendingRunId=null but continuation still present; the stated absence guard rejects it and makes the reduced-grant acceptance path unreachable.

Required within M3: distinguish an unclaimed pending continuation from a consumed registration belonging to the current failed run. Continue to reject a non-null work.pendingRunId, an unclaimed registration, a mismatched registration, or one targeting a different run. Permit the consumed registration only when its pendingRunId identifies the existing current failed run and its continuationIntentId matches that run. `continuation.ts:continuationAlreadyClaimed` (285) and `continuationClaimable` (290) already demonstrate the distinction. Explicitly describe retiring/clearing that consumed work registration during retry if needed, while preserving run/checkpoint and historical wake evidence. This does not authorize discarding a pending continuation and requires no relaxation of stop/resume guards.

Add the distinguishing acceptance/refusal cases to the reduced-grant/pending-continuation tests in §7. A blanket continuation != null refusal mutation must make the real consumed-continuation acceptance case fail.

## Minor

No additional blocking design concern found. Implementation plan should name all readers/enums touched by retrying/source validation and preserve the source/grant through claimed, active, failed-before-provider/retry, settlement, and the explicitly stated terminal/held lifecycle boundaries. This is implementation precision, not added product scope.

Read-only source inspection only; no product/test writes, test suite, real user data, paid providers, commits, push, merge, or deletion. The only write is this new report. Source locations above measured with rtk rg -n at the observation commit.

**Ready for human spec review: No**, pending the consumed-versus-pending continuation correction. The previous allocation findings are resolved.

## Re-review correction and latest verdict — same reviewer, 2026-10-09, same observation commit

The controller revised the §5 sentence concurrently with the initial review-2 write. The earlier observation and No verdict above apply to the preceding draft snapshot; they are preserved as evidence. This appended re-review covers the latest draft, re-read with `rtk proxy sed -n '30,77p' docs/superpowers/specs/2026-10-09-usage-settlement-and-handoff-retry-design.md` and `rtk rg -n` for pendingRunId/claimOrdinal/charged on the same file. No existing review text was edited.

The latest §5 (line 64) now requires work.pendingRunId=null while permitting a consumed work.continuation only if registration.pendingRunId equals the current failed runId; group/task/workItem identity, continuationIntentId, claimOrdinal, and lineage must all match. Unclaimed or mismatched registrations are refused. Retry clears only the consumed work registration and preserves historical run/checkpoint/wake identity, without rearming the old wake. This resolves the remaining Important finding and supports the real reduced-claim-grant continuation path while protecting pending work.

Latest §3 (line 35) also explicitly defines usage-settled result fields and named refusal codes, including rejection of late new events. They are compatible with the proposed command-ledger replay and read-preview contracts.

**Latest findings: Critical none; Important none; no additional blocking Minor finding. Ready for human spec review: Yes.** Original review-1 allocation issues, read-data/UI precision, and the consumed-continuation issue observed during re-review are all resolved in the latest draft. This is readiness for human design review, not human approval or evidence that implementation/tests have passed. No product/tests or other historical review files were changed.
