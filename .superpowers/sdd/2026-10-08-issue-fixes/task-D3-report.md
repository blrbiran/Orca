# Task D3 report: retry-task, end to end

Implementer: D3 (session e34dc963 subagent), 2026-10-08. Base ebe9882. Commits:
- 6a90702 feat(control): add retry-task, settling a terminally failed run and returning its task to ready
- 707bb40 test(control): pin that retry-task leaves exactly one run-settled row for the failed run (criterion follow-up, see below)

Status: DONE

## What was implemented
- `src/control/webProtocol.ts`: verb `"retry-task"` in `commandVerbSchema`; `retryTaskPayloadSchema` (`{ taskId }`, strict);
  raw and effective variants (group target); result `{ kind: "task-retried", taskId, fromRunId }`; `RetryTaskPayload` type.
- `src/control/stopIntent.ts`: `releaseCommitment` now delegates to a private `moveCommitment` (same statements in the
  same order, so its behaviour is unchanged); new exported `reserveCommitment` (adds to `group.reserved`).
- `src/control/activity.ts`: `"settled-failed"` added to `RUN_ENDED_STATES` (Part D amendment, Pre-flight amendment 2).
- `src/control/retryTask.ts` (new): `applyRetryTask`, `RetryTaskCommand`, `RetryTaskResult`, `RetryTaskDeps`. Following the
  controller amendment, it does **not** set `endedAt` and does **not** write `run-settled`. `saveRunBody` → `noteRunWrite`
  does both. The only row it writes itself is `task-retried`. It sets `drive.cleanedUp: false`, makes the run inactive,
  releases the remainder and then reserves the full grant (ledger ruling D flag 3), sets the task to `ready`, and keeps
  `currentRunId` on the settled-failed run.
- `src/control/webService.ts`: `retryTask(command)` (synchronous, as in the brief).
- `src/panel/controlApi.ts`: route `POST /api/control/groups/:groupId/retry-task` (`fromParams`), plus a `case "retry-task"` in the verb switch.
- `src/panel/humanOnly.ts`: `"retry-task": "any"`.
- `web/src/controlTypes.ts`: `RetryTaskPayloadV1`, the verb, and the result union member.
- `tests/panel/webParity.test.ts`: two assignability functions, both added to the export array.
- `skills/orca-control/SKILL.md`: route row `| POST groups/<groupId>/retry-task | retry-task | {"taskId":"t1"} |`.
- `tests/entry/skill.test.ts`: named rewrites 1–3 (counts 29→30, comment updated to "30 routes carry the 31 verbs" and
  extended with the retry-task sentence), plus `retryTaskPayloadSchema` added to the imports and to `schemaByVerb`.
- `tests/control/retryTask.test.ts`: the brief's helpers and its new describe, kept as written.

No archived-group check was added (Part E adds it), and no preconditions or refusals were added (D4 adds those).

## TDD
- RED (`vitest run tests/control/retryTask.test.ts tests/entry/skill.test.ts`, before implementing): rc=1. The new `it`
  failed with `TypeError: t.service.retryTask is not a function`; the 3 skill tests failed with `expected 29 to be 30`.
- GREEN: `npm run typecheck` rc=0; web `tsc --noEmit` rc=0. The brief's Step 4 set (retryTask, skill, permissions,
  humanOnly, webParity, stopIntent) passed: rc=0, 6 files, 60 tests.
- Suites, run after `npm run build --workspace web`:
  - `vitest run tests/control tests/panel tests/entry`: rc=0, 211 files passed and 8 skipped, 2047 tests passed and 54 skipped. Load was 4.00 at the start and 13.88 at the end. The skipped files are suites gated on the environment (for example handoffE2E, which is also skipped on the base).
  - `npm run --workspace web check`: rc=0, 82 files, 645 tests.
- After the follow-up commit: typecheck rc=0 and retryTask.test.ts rc=0 (4/4).
- Outputs are under scratchpad `orca/D3/` (d3.txt, d3b.txt, suite.txt, webcheck.txt, tc*.txt).

## Mutations
All mutations ran in a `git clone --local` made after each commit. The worktree diff and the cached diff were 0 and 0 bytes before and after.
- (a) delete `reserveCommitment(...)` → red at `committedRemaining` (tokens: expected 4550000, got 1250000).
- (b) delete `releaseCommitment(...)` → red at `committedRemaining` (got 7849990).
- (c) `saveRunBody(..., null)` → red at `active(t, runId)` (expected 0, got 1).
- (d) delete `work.status = "ready"` → red at `work(t,"a")` (status "running").
- (e') remove `"settled-failed"` from `RUN_ENDED_STATES` → red at `endedAt` toBeGreaterThanOrEqual (undefined).
  (e2) The same mutation with the `endedAt` assertion also removed, so the activity assertion is measured directly → red
  at the activity `toEqual`: a `run-blocked` row appears where `run-settled` was expected.
- (f) delete the `task-retried` recordActivity → red at the activity `toEqual`.
- (g) `cleanedUp: false`: no mutation can make this go red, as the brief says and as the ledger records (D flags 5/6).
- (h) remove the route object → red in skill.test (2 counts) and permissions.test (the route list is missing `retry-task`).
- (dup) the follow-up criterion: an extra `run-settled` recordActivity in applyRetryTask (the shape the amendment forbids) → red at the
  new `toHaveLength(1)` (got 2), at 707bb40.

## Deviations from the brief
1. Per the controller amendment, the `endedAt: store.now()` property and the `run-settled` recordActivity call were not
   written. `src/control/activity.ts` was edited and committed (Pre-flight amendment 2).
2. Follow-up commit 707bb40 adds `expect(... run-settled rows ...).toHaveLength(1)`. The brief's activity assertion only
   checks the newest two rows. If applyRetryTask wrote a duplicate `run-settled` after saveRunBody, the newest two rows
   would still be `[task-retried, run-settled]` and the test would stay green. The amendment says "exactly one run-settled
   row", so that requirement was not pinned. Before the fix this is reasoning, not a measurement; after the fix, mutation (dup) was seen red.
3. Brief anchors were matched by text. The line numbers had moved, and every anchor was found exactly once.

## Self-review / concerns
- The `activity.ts` doc comment ("Part D adds "settled-failed" here and needs nothing else") is now accurate. I left it unchanged.
- `retryTask` on WebControlService is synchronous, like `retryIntegration`. The route switch calls it without `await`, as in the brief.
- None blocking.
