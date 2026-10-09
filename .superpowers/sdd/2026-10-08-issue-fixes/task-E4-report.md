# Task E4 report (implementer E4, session e34dc963, 2026-10-09)

Status: DONE

## Commits (branch fix/issues-20261008)
- dd82218 feat(control): refuse every command but unarchive-group on an archived group at the ledger gate
  (src/control/commandLedger.ts, src/control/archiveGroup.ts, tests/control/archiveGroup.test.ts)
- 87c16c3 fix(web): say archive waits for the handoff to finish, completely or partially
  (web/src/locales/en.ts, web/src/locales/zh.ts)

## Implemented
1. Gate (spec §6.3): in `applyWebCommand`, after the revision check and before expand/apply:
   `else if (commandScope.groupId !== null && rawCommand.verb !== "unarchive-group" && isGroupArchived(store, commandScope.groupId))`
   -> `domainErrorOutcome(new ControlError("group-archived"), resultCommandRevision)!` (booked durably like any refusal).
   Import `isGroupArchived` from ./archivedMark.js. Exactly the brief's code.
2. Ruling E3-minor-3: archive-group on an already-archived group is refused group-archived by this gate (in the walk).
3. Ruling E3-minor-1: `refuseArchive` lets archive proceed when the derived stop state is `handoff-partial` as well as
   `handoff-complete`; doc comment updated. New test "archives under a handoff stop that settled partially…" (claims a
   run, handoff-stop, settles the request `settled-unrecoverable` via `settleHandoffRequest`, asserts
   groupStopState = handoff-partial, then archive succeeds).
4. en/zh `archive-stop-pending` now say archive once the handoff has finished, completely or partially
   (was "once it reaches handoff-complete", false after 3).

## Tests
- tests/control/archiveGroup.test.ts: brief's describe appended (verb walk over commandVerbSchema, 25 refusal cases,
  unarchive-then-start) + the partial-handoff case. 37/37 pass.
- TDD RED (before implementation): `vitest run tests/control/archiveGroup.test.ts` rc=1, 26 failed — every refusal case
  got its verb's own answer (start -> scheduled, archive-group -> archived, estimate -> profile-changed, retry-task ->
  task-not-retryable, …) and the partial case got archive-stop-pending:handoff:handoff-partial. GREEN after: rc=0, 37 passed.
- `npm run typecheck` rc=0.
- `vitest run tests/control tests/entry tests/scheduler` rc=1: 4 failed | 1809 passed | 55 skipped, all four 5 s timeouts
  at load 16 (activityRuns "a driver run gets endedAt…" [registered candidate], driverRequirementSplit "fails the third…",
  integrationKeep "lands and settles…", profiledService "probes both profiles…"); re-run alone rc=0 36/36 (load 13.5) —
  load flakes, not regressions.
- `vitest run tests/panel` rc=0 500/500 (web/dist present); after locale change: web build rc=0,
  `npm run --workspace web check` rc=0 655/655, tests/panel/refusalCoverage rc=0 5/5.
- Outputs: scratchpad/orca/E4/{e4-red,e4-green,typecheck,wide,rerun,panel,webcheck,build,refcov}.txt

## Mutations (git clone --local at 87c16c3; worktree diff 4669/0 bytes before and after — the 4669 bytes are D9's
uncommitted tests/control/executionDriverE2E.test.ts, untouched by me)
- m1 delete the `else if` gate branch -> 25 failed (every refuses-<verb> case incl. archive-group). RED.
- m2 `rawCommand.verb !== "unarchive-group"` -> `true` -> "still takes unarchive-group…" and the existing
  "unarchive removes the mark…" red. RED.
- m3 drop `&& state !== "handoff-partial"` -> the new partial-handoff case red. RED.
Clone discarded.

## Deviations from the brief
- `retry-task` entry calls `s.retryTask(c)` directly — D3/D4 landed `WebControlService.retryTask`, so the brief's
  `as unknown as {...}` cast is unnecessary (follow current code).
- The partial-handoff change, its test and the locale wording were added per the E3 rulings (not in the brief).
- Locale commit was made separately after D8 committed its en.ts/zh.ts edits (pathspec commits would otherwise have
  swept D8's uncommitted hunks into mine).

## Self-review / concerns
- No new error code (group-archived already has en+zh from E3).
- The wording "finished, completely or partially" is not literally true for handoff-unresolved (it needs recovery
  first); that state's banner already points to Retry recovery (Part C ruling). Minor.
- The legacy CLI applyCommand path stays ungated (Part E flag 5 ruling).
