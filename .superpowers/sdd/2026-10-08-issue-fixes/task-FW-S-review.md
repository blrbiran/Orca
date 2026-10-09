# Task FW-S review (reviewer subagent of controller session 3156185d, 2026-10-09; reviewed at 587193b, base 6b90629)

Verdict: Needs fixes — one Important (S2's replay pin does not cover the gate S1 added); S1, S3, S4, S5 are sound.

### Spec Compliance
- ✅ S1 — `preflightWebCommand` books `group-archived` after the stale-revision check, exempting `unarchive-group` (src/control/commandLedger.ts:152-165). Booking matches `revision-conflict` there: same `validatedOutcome` → `assertFinalVersions` → `persistCommandOutcome(store, raw, outcome, commandRevision, projectionSeq)` path, with no effective identity. The body's `commandRevision` uses the same formula as `applyWebCommand`'s `resultCommandRevision` (commandLedger.ts:300, 320), so a preflight-booked refusal is byte-shaped like an apply-booked one.
- ✅ S1 order and exemptions — replay lookup still comes first (commandLedger.ts:145-146). Stale beats archived, as in apply (commandLedger.ts:314-320). Non-group scopes (global/repository/spend/operator) have `groupId === null` (commandLedger.ts:48-57), so the gate never fires for them. `unarchive-group` passes (pinned by tests/control/archiveGroup.test.ts:315-324; mutation 2 in the report).
- ✅ S1 backstop — the in-transaction gate in `applyWebCommand` (commandLedger.ts:316-320) is untouched by the diff. Every preflight caller (webService.ts:415/573/587/610/665/846, planImport.ts:400, webDispatch.ts:108, requirementCommands.ts:63/191) still goes through `applyWebCommand` after its await.
- ✅ S1 test — archiveGroup.test.ts:301-313 has a control run proving `start` probes when the group is not archived. It then asserts the refusal, the durable booking and `calls() === 0`. All assertions come after the call. The switch from estimate to start is justified: estimate does not probe on a confirmed group, per the report.
- ⚠️/❌ S2 — the test exists (archiveGroup.test.ts:326-341) but uses `pause-dispatch`, which never calls `preflightWebCommand` (webService.ts:539-541). It pins replay-before-gate in `applyWebCommand` only, not in the preflight gate S1 added. See Important 1.
- ✅ S3 — archiveGroup.test.ts:197-208: every NOT_GROUP verb is in `commandVerbSchema`, and its raw schema rejects group and task targets with an issue at `target`. Mutation 3 (NOT_GROUP gains `start`) is plausible and RED per the report.
- ✅ S4 — approval row at integrationCommands.ts:159 and failure row at integrationResolve.ts:327. Both are `{ groupId, kind: "integration", body: { state, reason } }` with no taskId/runId, the same shape as B10's settle row (integrationPass.ts:491). Placement deviation accepted: see Strengths. Test integrationResolve.test.ts:321-339 asserts the full ordered row list after each step.
- ✅ S5 — activityRuns.test.ts: `}, 30000);` on the named test.

### Focused checks run (one per named risk)
- (a) callers / TOCTOU: read every `preflightWebCommand` call site and `applyWebCommand` lines 284-320 at 587193b. All callers return `replay.body` on non-null, so the new `group-archived` return needs no caller change. The apply gate remains and is still exercised by the walk for verbs that skip preflight (pause-dispatch, archive-group, retry-task, …), so deleting it still turns the walk red.
- (b) mutations in `git clone --local` of the worktree at 587193b, under `<scratchpad>/orca/review/fws-clone`. `src` was restored with `git checkout -- src`; `git status --short` then shows only the untracked node_modules symlink. The worktree was not touched.
  - **Mutation B (preflight: archive gate wins over replay)** — in `preflightWebCommand`, `if (prior) return prior;` became `if (prior && !(gid !== null && verb !== "unarchive-group" && isGroupArchived(store, gid))) return prior;`.
    - Command: `vitest run tests/control/archiveGroup.test.ts tests/control/commandLedger.test.ts > fws-mutB.txt`.
    - Result: **rc=0, 86 passed — the mutation survives.** Effect in production: a replayed `start`/`estimate`/`confirm`/… on an archived group falls through to `persistCommandOutcome` and hits the commands UNIQUE key. It throws instead of replaying.
  - **Mutation C (apply: archive gate wins over replay)**, same shape in `applyWebCommand`.
    - Command: `vitest run tests/control/archiveGroup.test.ts > fws-mutC.txt`.
    - Result: rc=1. Only the S2 test went red, with `UNIQUE constraint failed: commands.group_id, commands.id`. So S2 does pin apply's order.
  - (Mutation A, a cruder non-persisting early return in preflight, was red through other tests and is not informative.)
- (c) S4 "exactly once":
  - The approval row is reached only when `approveResolution` succeeds. That requires `state === "conflict"` (integrationResolve.ts:170), so the row is written once per conflict→resolving.
  - Replays never re-run `apply`.
  - Every resolving→conflict save goes through `failResolution`, whose guard `state !== "resolving" || key mismatch → return false` precedes both the save and the row (integrationResolve.ts:321-327).
  - Projection: `recordActivity` advances projection_seq inside `apply`. `recordProjectionChange` moves a group at most once per transaction (activity.ts:33-41), so the success body's `nextProjectionSeq` still matches `assertFinalVersions`. The test's `"applied"` confirms this.

### Strengths
- S1 reuses the exact booking path and revision formula of the existing refusal. The comment states the stale-then-archived order and the reason.
- The S1 test carries its own control run, so "0 probes" cannot be vacuous.
- S3 checks behaviour (the schema rejects the target) rather than introspecting zod internals, and checks the issue path, so an unrelated parse failure cannot satisfy it.
- S4 placement is correct: `approveResolution` (integrationResolve.ts:168-185, the line the B10 ruling cited) is pure and returns the new record. The only store save is in `applyResolveIntegrationConflict`, so recording the row there keeps it inside the same transaction as the save.
- S4's test asserts the whole ordered list after each transition. That covers both new rows and also catches a duplicate.

### Issues

#### Critical
None.

#### Important
1. **S2 does not pin replay-over-archive in the gate S1 added** (tests/control/archiveGroup.test.ts:326-341).
   - Why: the test sends `pause-dispatch`, which never reaches `preflightWebCommand`. The report says "replay precedes both gates by construction; guards future reordering only", but that guard holds only for `applyWebCommand`, the gate S1 did not change.
   - Evidence: Mutation B moves preflight's archive gate ahead of replay and leaves archiveGroup + commandLedger fully green (86/86). Its production effect is a thrown UNIQUE-constraint error on a legitimate retry of a pre-archive `start`/`estimate`/`confirm`.
   - Fix: add a preflighted verb to the S2 case, e.g. `start` with the counting router. Send it before archiving, archive, re-send the same id, and assert `toEqual(first)`, the unchanged command-row count, seq and revision, and 0 probes on the replay. Then show Mutation B turning it red.

#### Minor
1. The TOCTOU backstop is kept but not pinned for a preflighted verb: no test archives the group between preflight and apply, e.g. inside the start probe via the existing `countingRouter(h, during)` pattern at archiveGroup.test.ts:346. Deleting the apply gate is still caught, but only through non-preflighted verbs.
2. S3 checks group and task targets only. `scope()` treats a `run` target as group-scoped (commandLedger.ts:57; webProtocol.ts:638), so a run-only verb could still sit in NOT_GROUP unnoticed. The brief's literal wording is "neither group nor task", so this is compliant. Adding `{ kind: "run", groupId: "g", runId: "r" }` to the loop closes it.
3. Two pre-existing read-only git preparations still run before preflight on an archived group: `set-group-integration`'s `schemeCheck` (webService.ts:584-586) and `resolve-integration-conflict`'s `prepareResolution` (`git rev-parse`, webService.ts:607-609; integrationResolve.ts:188-199). Neither is an agent probe, and the brief names estimator/ccloop probes only. Recorded so the next reader does not take "no probe runs" to mean no git child runs.

### Assessment
Task quality: Needs fixes. S1, S3, S4 and S5 are correct and well pinned. S4's file deviation is right. S2's test pins replay order only in `applyWebCommand`; the new preflight gate's order relative to replay is unpinned (Mutation B survives), so S2 needs a preflighted-verb case.
