## Part B — Activity record and run times (spec §5)

Spec: `docs/superpowers/specs/2026-10-08-issue-fixes-design.md` §5 (ruling H5), §8, §9 step 3. Worktree
`/Users/biran/code/skills/loop/Orca-issues`, branch `fix/issues-20261008`. Line numbers below were measured on the
commit whose subject is `docs(spec): revise the issue-fixes design after independent review`; executors re-locate by
the quoted anchor text, never by number alone.

### B.0 Design decisions this part fixes (read before any task)

**1. How a projection change is recorded today, and why recordActivity never double-advances.**
`src/control/projectionJournal.ts` keeps one `TransactionState { changeSeq, groups: Set<string> }` per store for the
open transaction (`beginProjectionTransaction` / `finishProjectionTransaction`, called by `store.transaction`,
`store.ts:130,141`). `recordProjectionChange(store, groupIds)` (lines 64-67) → `recordInTransaction` (lines 29-62)
filters out every group already in `transaction.groups` (lines 32-33) and only then bumps `groups.projection_seq` and
journals it (lines 49-53); the global `change_seq` is bumped once per transaction (lines 41-46). So **calling
`recordProjectionChange(store, [groupId])` a second time in the same transaction is a no-op, whichever call comes
first.** `recordActivity` therefore simply inserts the row and calls `recordProjectionChange(store, [row.groupId])`:
if the writing site already recorded the group (before or after), nothing moves twice; if it did not (e.g.
`saveDispatchRun`, a raw `UPDATE`), the activity insert is what makes the 2-second summary poll re-read the open group
(`web/src/App.tsx` re-reads the open group when the summary's `changeSeq` is newer than the cached body's).

The one exception is the `command` row. `applyWebCommand` (`src/control/commandLedger.ts`) asserts after the apply that
the success body's `projectionSeq` equals the group's final `projection_seq` (`assertFinalVersions`, called at
line 366). A row that moved `projection_seq` after the body was built would make every such command fail
`control-command-result-invalid`. Every successful **group-scoped** command already records its group's projection
change (default `projectionGroupIds` = `[groupId]` when `authorityChanged`, line 355-359; the only five callers that pass
`projectionGroupIds: []` are global/repository/spend/operator scopes: `src/panel/controlLifecycle.ts:189`,
`src/control/workspaceSettings.ts:59`, `src/control/spendCommands.ts:27`, `src/control/integrationCommands.ts:42`,
`src/control/agentPreferences.ts:42`). So the command row is written with `appendActivity` (insert + retention, **no**
projection call), placed after the ledger's own `recordProjectionChange`. A future group command that records no
projection change would still get its row; the open view would show it on its next refresh.

**2. Transaction requirement.** `appendActivity` refuses with `control-projection-transaction-missing` (an existing
`internal` code, `errors.ts:228`) when no store transaction is open — a new projection-journal helper
`inProjectionTransaction(store)` answers that. This is what makes "a row exists iff its change committed" mechanical:
no site can write a row outside the change's transaction.

**3. Run state transitions go through one choke point.** Rather than hunting every `state = "settled…"` assignment, the
three functions that write a run body with a state change call `noteRunWrite(store, run)` (in `activity.ts`) before
writing: `saveRun` (`src/control/budget.ts:26`, which `saveDriverRun` wraps, so every driver step), `saveRunBody`
(`src/control/stopIntent.ts:173`, used by `terminaliseRun`), and `saveDispatchRun` (`src/control/webDispatch.ts:48`,
used by `settleProviderAttempt` and the attempt reservation). `noteRunWrite` reads the stored state
(`json_extract(body,'$.state')`) and, only when it differs:
- new state `blocked` → `run-blocked {blockedAt, reason}` from `drive.blockedAt` / `drive.blockedReason`;
- new state in `RUN_ENDED_STATES` (`landed`, `settled`, `settled-recoverable`, `settled-restartable`,
  `settled-unrecoverable`, `failed-before-provider`) → stamps `endedAt = store.now()` on the body about to be written
  **only if absent**, and writes `run-settled {state, outcome, stopReason?}` (`outcome` = `drive.outcome ?? null`;
  `stopReason` copied when the drive record carries a string `stopReason`, which Part D adds).
Every other raw run-body writer was checked: `driveRecord.ts:106` (resume — handled explicitly as `run-resumed`),
`requirementCalls.ts:152` (adds `overview`, no state change), and the `INSERT INTO runs` sites (claims). There is no
`json_set` write of runs in `src/`.

Verified sites (each is inside a `store.transaction`): `executionDriver.ts` `blockRun` (line 147), `stepA1` refuse
(227), `persistStatus` block (396), `stepC` landed (550), `stepCSingleCall` settled-restartable (645);
`driverLanding.ts` landed (46, 364); `budget.ts` `releaseRunReserve` settled (169, 176); `driverHandoff.ts` H-settle
(346); `stopIntent.ts` `terminaliseRun` (via `saveRunBody`); `webDispatch.ts` `settleProviderAttempt`
failed-before-provider (371). A run that is re-blocked while already `blocked` (the driver's catch path keeps it
blocked and appends the new error) writes no second row — the state did not change.

**4. Kind by kind: the writing site, its transaction, and whether the activity insert itself moves the projection.**

| Kind | Site (task) | Transaction | Site already records the group's projection change? | Net effect of recordActivity's projection call |
|---|---|---|---|---|
| `command` | `applyWebCommand`, after line 359 (B7) | `applyWebCommand`'s own | yes, always, for group scope (see 1) | n/a — `appendActivity`, no call |
| `run-claimed` | `createStartingRun`, after `saveWork` (B5) | `deliverScheduledStart`'s (webDispatch.ts:206) | yes — `saveWork` changes `status`/`currentRunId` | no-op |
| `run-started` | `reserveProviderAttemptInTransaction` (B5) | `stepA1`'s `write` / `beginProviderAttempt`'s | **no** — `saveDispatchRun` is a raw UPDATE; A1's later `saveDriverRun` does, `beginProviderAttempt` alone does not | records it (A1: deduped with the later `saveDriverRun`) |
| `phase` | `collectInto` progress write (B6) | its `write` | yes — `saveDriverRun` with a changed body | no-op (existing criterion `driverProgress.test.ts` "P3: … each change moves changeSeq exactly once" keeps guarding it) |
| `run-blocked` | `noteRunWrite` (B4) | caller's | `saveRun`: yes (body changed); `saveRunBody`/`saveDispatchRun`: no | records when needed |
| `run-resumed` | `retryRun` in `stopIntent.ts` (B8) | `applyRecoveryRetry`'s command | yes — `resumeBlockedDriverRun` line 107 and the ledger | no-op |
| `run-settled` | `noteRunWrite` (B4) | caller's | as `run-blocked` | records when needed |
| `stop` | `applyPauseDispatch`, `applyHandoffStop` applies; `applyPanelShutdown` apply (B9) | the command's | pause/handoff: the ledger, after the apply (deduped either way; the body's `projectionSeq` is `nextProjectionSeq`, so the order is immaterial); shutdown: `shutdownGroup` line 172 | no-op |
| `integration` | `integrationPass.ts` `settle`, after `saveGroup` (B10) | its `write` | yes — `saveGroup` | no-op |

`stop-cleared`, `task-retried`, `archived`, `unarchived` are written by Parts C, D, E with `recordActivity`.

**5. Why `stop` and `run-resumed` are written at the command sites, not in `saveStopIntent` / `resumeBlockedDriverRun`.**
Existing criteria call those two helpers directly, outside any transaction
(`tests/panel/shutdownDriverGroup.test.ts` calls `shutdownGroup` 8 times, `tests/panel/controlLifecycle.test.ts:245`,
`tests/control/driveRecord.test.ts:78` calls `resumeBlockedDriverRun`). Writing the row inside the helpers would make
those criteria throw `control-projection-transaction-missing` and need rewriting; writing at the transactional callers
needs no rewrite and covers every production path (`saveStopIntent` has exactly three callers: pause, handoff,
shutdown; `resumeBlockedDriverRun` has one: `retryRun`).

**6. Clock injection in tests.** `openControlStore` gains `now?: () => number`; `tests/control/fixtures/store.ts`
`openTestStore(options?: { now?: () => number })`; `webFixture` gains option `storeNow?: () => number` and
`driverHarness` option `storeNow?: () => number`, passed through. (`storeNow`, not `now`, because driver/stop deps
already have a Date-valued `now` for handoff grace.) Tests drive a mutable `let clock` through `storeNow: () => clock`.

**7. Wire shape.** New fields on the server zod schemas are `.optional()` on the wire with the server always giving them
(the precedent of run `git` and work item `progress`), and optional on the Web mirror: no existing literal fixture
(`tests/control/webProtocol.test.ts:338`, the Web fixtures) needs an edit, and the parity criterion's assignability
holds both ways without normalisation. A criterion asserts the server does give them.

### B.1 Existing tests rewritten by this part (spec §5.2 "`schemaVersion` becomes "9"", §5.3 first bullet)

| File | Test name | Current line | Current | Replacement |
|---|---|---|---|---|
| `tests/control/requirementRecords.test.ts` | "migrates a version-5 store by adding the two tables, leaving every existing row byte-identical" | 27 | `expect(schemaVersion).toBe("8");` | `expect(schemaVersion).toBe("9");` |
| `tests/control/schema8.test.ts` | "a fresh store is version 8 with the usage, cap and principal surfaces" → renamed "a fresh store is at the current version (9) with the usage, cap and principal surfaces" | 41, 44 | `expect(schemaVersion).toBe("8");` | `expect(schemaVersion).toBe("9");` |
| `tests/control/schema8.test.ts` | "a version-7 store upgrades and books each group's existing usage as one pre-ledger row, in no period" | 58 | `expect(version(store.db)).toBe("8");` | `expect(version(store.db)).toBe("9");` |
| `tests/control/schema8.test.ts` | "an upgrade leaves every existing row as it was, and repeating the 7-to-8 step adds no second pre-ledger row" | 108 | `expect(version(store.db)).toBe("8");` | `expect(version(store.db)).toBe("9");` |
| `tests/control/commandClient.test.ts` | "a fresh store has commands.client and is at the current version (8)" → renamed "… (9)" | 41, 44 | `expect(schemaVersion).toBe("8");` | `expect(schemaVersion).toBe("9");` |
| `tests/control/commandClient.test.ts` | "a version-6 store upgrades, and a row written before keeps client null" | 60 | `.toMatchObject({ value: "8" });` | `.toMatchObject({ value: "9" });` |

Each rewritten line gets a comment above it:
`// Rewritten for issue-fixes spec §5.2 (ruling H5, 2026-10-08): the store is now at schema version 9.`

No other existing assertion changes. The downgrade criteria of older steps (`schema8.test.ts` `version7Store`,
`requirementRecords.test.ts`, `commandClient.test.ts`, `agentPreferences.test.ts`, `workspaceSettings.test.ts`,
`store.test.ts` "migrates schema 1") keep the `activity` table in place and re-run the chain; they pass unchanged
because the 8→9 step is `IF NOT EXISTS` (the repo's convention, `migrations.ts:69-70`).

### B.2 Executor notes (all tasks)

- `SCRATCH` = the executor's session scratchpad. Test runs: `cd /Users/biran/code/skills/loop/Orca-issues &&
  ./node_modules/.bin/vitest run <files> > $SCRATCH/<task>.txt 2>&1; echo rc=$?`, then read the whole file.
- Mutations: after Step 6's commit, `git clone --local /Users/biran/code/skills/loop/Orca-issues $SCRATCH/mut-<task>`,
  `ln -s /Users/biran/code/skills/loop/Orca-issues/node_modules $SCRATCH/mut-<task>/node_modules` (and
  `ln -s /Users/biran/code/skills/loop/Orca-issues/web/node_modules $SCRATCH/mut-<task>/web/node_modules` for B11),
  apply the named edit there, run the named test, see it red, delete nothing in the worktree. A mutation not seen red
  is fixed by strengthening the criterion in a follow-up commit (no amend).
- If any existing criterion fails with `control-projection-transaction-missing` after B4, a run-state write happens
  outside a transaction somewhere this plan did not find: stop and report the stack (do not wrap the call site blindly).
- `git add` explicit paths only.

---

