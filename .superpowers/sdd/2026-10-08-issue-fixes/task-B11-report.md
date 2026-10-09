# Task B11 report — views, run-activity route, wire schemas, Web mirror

Implementer: B11 (session e34dc963), 2026-10-08. Commit: `0c361cd feat(panel): show group activity, run times and a run-activity route` (parent fb08b7d).

## Implemented
- `src/control/webProtocol.ts`: `activityKindSchema` (13 kinds), `activityEntrySchema`, `runActivitySchema`; run view
  `startedAt` / `endedAt` / `lastActivityAt` (`safeInteger.nullable().optional()`); group view `activity` (optional
  array of entries); types `ActivityEntryV1`, `RunActivityV1`.
- `src/panel/controlViews.ts`: `runViews` gives `startedAt: run.startedAt ?? null`, `endedAt: run.endedAt ?? null`,
  `lastActivityAt: readRunActivity(store, runId, 1)[0]?.at ?? null`; `readControlGroup` gives
  `activity: readGroupActivity(store, groupId, 50)`; new `readRunActivityView(store, runId)`: the id has to be a valid id
  and the run has to exist in this store, or it is `run-not-found`. It returns the newest 200 rows, checked against the schema.
  `blocked(...)` is used if a row is invalid.
- `src/panel/controlApi.ts`: `GET /api/control/runs/:runId/activity`. Errors are mapped the same way as the evidence route.
- `web/src/controlTypes.ts`: `RunViewV1` times, `GroupViewV1.activity?`, `ActivityKindV1`, `ActivityEntryV1`, `RunActivityV1`.
- `web/src/controlApi.ts`: `fetchRunActivity(runId)`.
- Tests: `tests/control/activity.test.ts` kind-list parity; `tests/panel/controlReadApi.test.ts` new `it`;
  `tests/panel/webParity.test.ts` new `runActivityServerToWeb` / `runActivityWebToServer` pair.

The code follows the brief exactly. The anchors were in the places the brief named, and the run body's `startedAt`/`endedAt` were
already in `persistedRunSchema` (from B4/B5). Per Part B ruling 7, the evidence route's integrity checks are not
copied.

## TDD
RED, from `vitest run tests/panel/controlReadApi.test.ts tests/control/activity.test.ts` (rc=1):
- activity.test: `TypeError: Cannot read properties of undefined (reading 'options')`
- controlReadApi: `expect(view.activity).toHaveLength(50)` → `Target cannot be null or undefined.`
- `npm run typecheck` rc=2: `has no exported member 'activityKindSchema'` / `'RunActivityV1'` (server and web).

GREEN:
- `vitest run controlReadApi activity webProtocol runContinuable webParity` rc=0, 5 files / 50 tests
- `npm run typecheck` rc=0
- `npm run build --workspace web` rc=0
- `npm run --workspace web check` rc=0, 81 files / 636 tests

Full `npm test`:
- First run: rc=1, 3 reds: `activityRuns` "pause and its strengthening…", "a shutdown that creates…", and `controlShutdown`
  "real SIGTERM… exit cleanly" (143). B9 was committing fb08b7d at that moment, so these were B9's half-written state.
  I re-ran the two files alone after B9 committed: rc=0, 18/18 (load 8).
- Second full run, on HEAD fb08b7d plus my diff: rc=0, 351 files passed / 8 skipped, 3250 tests passed / 57 skipped.
  `uptime` load was 11.89. Another implementer's uncommitted `src/control/recovery.ts` and `tests/control/shutdownHealing.test.ts`
  were present during that run.

## Mutations
Run in `git clone --local` at 0c361cd under scratchpad/orca/B11/clone, with node_modules and web/node_modules linked
and web/dist built. Script `scratchpad/orca/B11/mutate.sh`. Each output was read whole.
- (a) Deleted the `run-not-found` guard → RED: `expected 200 to be 404` (the foreign run).
- (b) Deleted the `activity:` line → RED: `view.activity` undefined.
- (c) Set `lastActivityAt: null` → RED: `lastActivityAt` expected 1791472987108, received null.
- (d) Removed `"unarchived"` from `activityKindSchema` → RED: "are exactly the kinds the writer knows".
- (e) Changed Web `RunActivityV1.entries` to `ActivityEntryV1[] | null` → `npm run typecheck` rc=2: TS2322 at
  webParity.test.ts:193 (`runActivityWebToServer`).

The clone's diff was 0 bytes after the restores. Worktree diffs on my paths: `git diff -- <my 8 paths> | wc -c` = 0
and `git diff --cached | wc -c` = 0, both before and after. The whole-worktree `git diff` was 2831 bytes before, and that
was another implementer's in-flight `recovery.ts`, not mine. The worktree is clean after their commit f9f730b.

## Files changed
src/control/webProtocol.ts, src/panel/controlViews.ts, src/panel/controlApi.ts, web/src/controlTypes.ts,
web/src/controlApi.ts, tests/panel/controlReadApi.test.ts, tests/panel/webParity.test.ts, tests/control/activity.test.ts

## Deviations
None in the code. One process note: the first full-suite run overlapped B9's commit. Its reds disappeared once B9 had
committed (see above).

## Self-review / concerns
- `lastActivityAt` costs one indexed query per run every time the group view is read (`readRunActivity(…, 1)`). That is fine for
  normal group sizes.
- `endedAt` comes from the run body. That matches the B4 note: a run that goes from landed to settled gets two
  run-settled rows, but only one end time.
- If a stored activity row is invalid, the whole group view becomes `recovery-blocked` (423). This is inherited from
  `entryOf` in B3 and is deliberate fail-loud behaviour.
- Web types are a hand-written copy of the server types. Only the parity pair and the kind-list test keep them in step.

## Fix round 1 (2026-10-08, commit 181d4ea)
Review findings handled:
- Important: the run view's `startedAt`/`endedAt` had no test proving they are read from the run body. In the same `it`, after the
  null assertions, run-one's body now gets `startedAt: 1_000, endedAt: 2_000`. The test re-reads
  `/api/control/groups/group-a` and asserts `{ startedAt: 1_000, endedAt: 2_000, lastActivityAt: <newest row at> }`.
  2_000 is not the run's `lastActivityAt` (about 1.79e12).
- Minor: `skills/orca-control/SKILL.md` section 2 now lists `runs/<id>/activity` (the run's newest 200 activity rows). The CLI passes this path
  through; only `runs/<id>/evidence/<id>` is refused as binary (src/entry/operations.ts:7).

Verification (scratchpad/orca/B11):
- `vitest run tests/panel/controlReadApi.test.ts tests/entry/skill.test.ts` rc=0, 25/25.
- `npm run typecheck` rc=0.
- `vitest run tests/panel tests/entry` rc=0, 71 files / 525 tests. Load 14.64.

Mutations ran in a fresh `git clone --local` at 181d4ea (`clone-fix1`, web/dist built). Script `mutate-fix1.sh`:
- (1) `startedAt: null, endedAt: null` constants → RED at the new assertion (line 747): expected 1000/2000, received null/null.
- (2) `endedAt := readRunActivity(...)[0]?.at` (taken from the rows) → RED, first at the earlier null-time assertion (line 741):
  endedAt received 1791473339036. The new assertion would also fail under this mutation (it expects 2000), but it is
  reached second.

The clone's diff was 0 bytes after the restores. On my paths, the worktree's `git diff` and `git diff --cached` were 0 / 0 before and
after.
