# Terminal Run Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close a proved terminal failed task run once, release its unused reservation, and let its group be archived while keeping legitimate retry and saved-result verification possible.

**Architecture:** An Orca-owned scan follows soft usage settlement and verifies the existing immutable report, stop proof and ledger before one transactional closure. A strict closure marker on the run distinguishes it from an owner usage settlement; retry and automated failure routing validate the marker. A separate recovery projection presents runs awaiting accounting and closure.

**Tech Stack:** TypeScript, node:sqlite, Zod, Vitest. No ccloop wire changes for this plan.

**Spec:** `docs/superpowers/specs/2026-11-07-terminal-run-closure-design.md`

## Global Constraints

- Existing Orca schema 23; additive optional run field and optional recovery-view field, no historical row rewrite.
- Work on temporary fixture stores. Do not open the real control DB in tests. Mutations only in a local clone.
- Normal `npm test` selects affected tests and includes typecheck. `npm run verify` is release-only.
- A terminal close is not a usage charge or task acceptance; `usageSettlement` semantics remain unchanged.
- Orca control import cycle: load the new pass on first use in the driver, as `softLoopSettlementPass` and `markGroupsDone` do.

## Review Focus

- A paused finite unknown-usage run remains pending and gives the order settle→close→archive (Task 1, Task 3).
- A successful run or a transient block cannot acquire terminal closure merely because a report exists (Task 1).
- A forged marker with a valid report hash but changed owner, generation or highWater fails (Task 1 and Task 2).
- An already-open ladder is not superseded by the same run becoming closed (Task 2).
- A crash/repeat driver pass cannot release a reserve or emit an activity twice (Task 1).

---

### Task 1: Terminal proof and the explicit close command

**Files:**
- Create: `src/control/terminalRunClosure.ts`
- Modify: `src/control/{webProtocol,webService,errors,driveRecord}.ts`, `src/panel/{controlApi,humanOnly,controlViews}.ts`, `src/commands/domains/work.ts`, `web/src/controlTypes.ts`
- Modify: `tests/control/fixtures/{driverPort,driverHarness}.ts` (optional sealed owner proof)
- Test: `tests/control/terminalRunClosure.test.ts`

**Interfaces:**
- Produces: `terminalClosureSchema`, `validTerminalClosure(store: ControlStore, run): boolean`, `applyCloseRun(deps, command): CommandSuccessV1 | CommandErrorBodyV1`.
- Consumes: `settlementProof`, `hasObservedUsage`, `hasValidUsageSettlement`, `releaseCommitment`, `setAllocationStates`, `saveRunBody`, `saveWork`, `recordActivity`, `finiteCommitment`.

- [x] Write a failing real-driver criterion: a proved failed/exhausted run becomes `settled-failed/active=0` through the close command, work blocked, allocation terminal, used unchanged, reserved falls by exactly the remaining grant; a paused group archives; original outcome remains. Run it RED before the command exists.
- [x] Implement strict proof validation and one transactional close; require current work/run ownership, sealed owner proof, usage and immutable terminal proof. Reworked after RED: an automatic driver pass broke existing blocked-run criteria, so the transition is an explicit `close-run` command (Ruling in the ledger).
- [x] Run the criterion GREEN. Add and run independent cases for unknown/pending usage, forged settlement, missing owner seal, adoptable handoff, idempotent replay and corrupt marker. Each tests the production gate, not a synthetic restatement.
- [x] Commit only Task 1 files and the spec/plan once targeted tests and typecheck pass, after inspecting the diff.

### Task 2: Preserve retry, ladder, quota and saved recovery authority

**Files:**
- Modify: `src/control/retryTask.ts`, `src/control/driveRecord.ts`, `src/control/systemDebug.ts`, `src/control/webService.ts`, `src/control/savedResultRecovery.ts`
- Test: `tests/control/terminalRunClosure.test.ts`, existing `retryTask.test.ts` and focused ladder/quota/recovery files.

**Interfaces:**
- Consumes Task 1 `validTerminalClosure` and the existing source/funding validators. A terminal failure is either live blocked/C or closed with a valid marker.

- [x] Write failing tests: closed source optional/top-up and finite retry without double reserve release; old grant and cumulative stay unchanged; failed or forged closure rejects; a closed source still qualifies for source-side saved-result checks if its capsule is otherwise valid.
- [x] Implement the separate terminal release branch in retry and guard saved recovery before admission. Preserve exact latest-run, stop, cap and lineage guards.
- [x] Write failing tests for existing ladder ownership, quota wait, failover and probe with a closed current run; fix their shared candidate predicate and the debug-fold check without scheduling blocked_waiting_human.
- [x] Run focused files GREEN and typecheck, inspect diff, commit Task 2.

### Task 3: Operator visibility and archive route

**Files:**
- Modify: `src/panel/controlViews.ts`, `src/control/webProtocol.ts`, `src/commands/domains/reads.ts`, `skills/orca-control/SKILL.md` (or dedicated reference if needed)
- Test: `tests/control/terminalRunClosure.test.ts` and focused recovery read/CLI tests.

**Interfaces:**
- Produces: optional `terminalRuns` list on recovery view, with group/task/run/outcome and one of `needs-usage`, `needs-proof`, `ready-for-retry-or-archive`; preserves `blockers` as dispatch blockers.
- Consumes Task 1 proof and closure readers.

- [x] Write failing read tests: blocked known/unknown/closed states produce distinct next steps; malformed closure is an explicit read refusal, not 'done'; archive refuses genuinely active execution and succeeds for closed run after pause.
- [x] Extend the strict recovery schema and operator output, keeping previous consumers compatible with absent optional field. Tell the owner to settle unknown usage before pause; link eligible saved result separately.
- [x] Run focused files GREEN, `npm test` with affected base `main` and root typecheck; compare each red to untouched main if load sensitive. Run named mutations in a local clone and re-run them after the final implementation change.
- [x] Inspect diff and commit Task 3. Then integrate to main only with `--ff-only`, leaving user-owned push untouched.
