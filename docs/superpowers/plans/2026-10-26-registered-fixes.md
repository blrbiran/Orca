# Six registered fixes — Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. TDD per task: the criterion first, seen red for the named
> reason, then the code, then green. One commit per task.

- **Goal:** close the six unfinished items registered in `docs/handoff/handoff.md` (2026-10-25 section, "registered
  unfinished") and in the schedules quality review (Minor 4): (1) a `work` step's diagnostic checks reach neither the
  child nor the record; (2) saved-result recovery does not fill skill dirs; (3) `orca status` judges the caller shell's
  environment instead of the installed service's; (4) `runViewGrant` has no handoff-run case; (5) the decisions route
  reads the group body several times; (6) `scheduleListView` / `schedule-remove` fail whole-read/whole-delete on a
  corrupt row.
- **Base:** main `535c0a05`, clean. No schema migration, no new dependency, no ccloop repin, no paid run.
- **Rules:** Rule 9 (each task: one named mutation seen red in a `git clone --local` copy under `/private/tmp`, the log
  appended to `/private/tmp/orca-ffec7b28/registered-fixes-mutations.log`, restore proved by `git diff | wc -c` and
  `git diff --cached | wc -c` = 0). Rule 14 (logs to files). Rule 17 (tests use temp paths; never `~/.orca`). Rule 18
  (`npm test`; no perf scripts). Tests: `ORCA_CCLOOP_BIN=/private/tmp/orca-ffec7b28/ccloop-c205d55/dist/cli.js`,
  `CCLOOP_CACHE_DIR=/private/tmp/orca-ffec7b28/ccloop-cache-h7`; never `~/.cache/ccloop`.
- **Authorization:** no merge, push, branch/worktree deletion, or paid run without a separate human nod.

## Scope decisions

- **D1 — diagnostics are Orca's, not ccloop's.** ccloop has no non-gating check concept, and changing its contract is
  out of scope. Gates remain the child's `verification.requiredChecks` unchanged. Diagnostics (a) appear in the child's
  prompt as `diagnostic: <expanded>` lines so the agent knows them, and (b) run in Orca after the child lands, in a
  throwaway tree at the landed commit (the `check` kind's own mechanism), recorded on the step and projected to later
  prompts. They never fail a step.
- **D2 — a diagnostic never breaks a step.** Expansion or execution failure is a recorded `exitCode: 1` result with
  output `orca: diagnostic not run: <message>`. No diagnostics run on a failed child or a `needs` outcome.
- **D3 — saved-result inspection input mirrors A2.** The rebuilt envelope for a `verify-saved-result` run resolves the
  same frozen skill set, injects it for the recovery run id, fills `{{skill.<name>.dir}}`, and records `drive.skills` —
  exactly A2's block. A run without skills keeps byte-identical envelope fields (no added key).
- **D4 — status reads the service's environment.** When `service.json` exists, every installed-path check uses its
  `env` (doctor's `ccloopBinCheck` precedent). The service's config location and manager selection still come from the
  caller's env; `--control-state-dir` still wins; the ccloop pin comparison stays checkout-local.
- **D5 — the decisions read takes the group record.** The route reads the body once and passes the record through pure
  helpers. No behavior change.
- **D6 — a corrupt schedule row is a fact, not a failure.** The list returns it under `corrupt`; remove works without
  parsing (the body bytes are preserved). Other schedule verbs keep refusing unreadable rows.

## Tasks

- [x] **F1 — work diagnostics reach the child and the record** (`src/flow/kinds/work.ts`, `src/flow/kinds/check.ts`,
  `src/flow/kinds/registry.ts`, `src/flow/kernel.ts`, `src/flow/childPort.ts`, `tests/flow/workDiagnostics.test.ts`).
  - `check.ts`: extract `runAcceptance({checks, idOf, vault, commit, scope, runCommand, onError?})` from `CHECK_KIND.start`
    (same temp dir, private index materialize, `{{base:<path>}}` copies read from the composition commit, 64 KiB bound,
    per-check loop); `CHECK_KIND.start` becomes a call to it with `scope.skillDirs = {}` and no `onError`. Export
    `checksProjection(record)` and use it for both kinds.
  - `work.ts` `start`: expand the step's `diagnostic` checks with the same `expand` used for gates and add them to
    `ctx.prompt({acceptance: [...gates.map(g => `gate: ${g}`), ...diagnostics.map(d => `diagnostic: ${d}`)]})`; a
    diagnostics expansion failure is swallowed (they are already non-gating; settle records not-run).
  - `work.ts` `settle` becomes `async`; on a landed child with no `needs`, run the diagnostics with
    `ctx.runCommand` in a tree at `status.commit` (empty when the effect landed nothing), scope
    `{params: expansionParams(ctx.env, ctx.run), runId, skillDirs: the injected skills' real dirs (status.skillsDir +
    status.skills names), effectRecordId}`, `onError` recording not-run. Attach `checks` to the record only when non-empty.
  - `childPort.ts`: landed status gains `skillsDir: current.drive?.skills?.dir`; `registry.ts` `settle` may return
    `KindOutcome | Promise<KindOutcome>`; `kernel.ts` `pollChild` awaits it, and `pointers()` appends a kind projection
    of a commit output's `exec.body.record` after `workspace commit <ref>` (artifact outputs fall back to
    `JSON.stringify(record)` when the projection is empty, preserving today's effect-step pointers).
  - Tests: diagnostic lines in the child's goal with params expanded and skill tokens kept; after landing the fake
    `runCommand` sees the landed tree and a 0400 base copy, and the record carries the result; a non-zero diagnostic
    leaves the step done; an unknown skill token records not-run; a failed child and a `needs` outcome run nothing; the
    next step's prompt contains `check check-2 (diagnostic) exit 0:`.
  - Mutation: `pointers()` drops the appended projection (or `settle` filters diagnostics out) — the new criterion red.
  - Commit: `fix(flow): a work step's diagnostics reach its child and later prompts`.

- [x] **F2 — saved-result inspection input fills the run's skill dirs** (`src/control/executionDriver.ts`,
  `tests/control/savedRecoverySkills.test.ts`).
  - Extract A2's skill block (380–416) into `skillFilledRuntime(deps, run, targetRepo, contract, confirmed)` returning
    `{kind, runtime} | {blocked: string}`: resolve the installation kind, `injectRunSkills`, `withSkillDirs` when the
    task has no explicit skills but the flow child declares some, and the present-only envelope keys.
  - In `savedRecoveryInspectionInput`, use `readConfirmedTaskExecution(store, run.groupId, run.taskId)` for the frozen
    contract and its skill set, call the same helper for the recovery run id, use the filled runtime as the envelope
    contract, and write `drive.skills`. Keep `base = original.work.base`, the package record, `inputCheckpoint = null`.
  - Test (unit, no paid run): a web fixture task run, then a fabricated `verify-saved-result` run whose source envelope,
    admission and package artifacts are persisted via `persistRecoveryArtifact`, a private `sourceDir`, and a frozen
    `work` claim outbox record; a fake syncskill (the `tests/skills/fixtures/fake-syncskill.mjs` convention) injects one
    skill. Assert the returned envelope carries the skill key for the resolved agent kind and that
    `readDriverRun(...).drive.skills.dir` is that injected copy; a no-skill run's envelope has no skill-dir key and
    `drive.skills === null`.
  - Mutation: drop `withSkillDirs` (or the envelope key) in the recovery path — the criterion red.
  - Commit: `fix(control): a saved-result recovery run fills its skill directories`.

- [x] **F3 — `orca status` reads the installed service's environment** (`src/commands/status.ts`,
  `src/commands/doctor.ts`, `tests/commands/status.test.ts`).
  - `CheckContext` gains `serviceEnv?: NodeJS.ProcessEnv | null`; `contextOf` becomes async and resolves
    `servicePaths(ctx.env).configFile` + `readServiceConfig(paths).env` once (any failure leaves it null).
    `envOf(ctx) = ctx.serviceEnv ?? ctx.env`.
  - `panelSocketCheck`, `panelHttpCheck`, `schemaCheck`, `agentsTableCheck`, `ccloopPinCheck` (override label only),
    `ccmemCheck`, `skillCheck` use `envOf(ctx)`; `serviceCheck` and the service config's own location keep `ctx.env`;
    the pin/installed comparison stays checkout-local. `runStatus`/`runDoctor` await `contextOf`.
  - Test: a sandbox `service.json` naming a different `ORCA_CCMEM_BIN` (an executable) and `ORCA_AGENTS_TABLE` than the
    caller env; the checks report the service's values; without `service.json` they report the caller's; the
    `--control-state-dir` flag still decides the control directory.
  - Mutation: `envOf` returns `ctx.env` — the criteria red.
  - Commit: `fix(cli): status judges the panel's environment, not the caller shell's`.

- [x] **F4 — runViewGrant covers a handoff-phase run** (`tests/control/runViewGrant.test.ts`).
  - Confirm the group, arm the start wake, then claim a task run via `deliverScheduledStart` (the `webDispatch`
    fixture's `startedFixture`/`claimRunId` pattern), clone its body to `runId: "handoff-run"`, same
    `workItemId`/`taskId`, `phase: "handoff"`, `providerAttemptOrdinal: 1`, keep `grant`/`handoffProfile`, state
    `start-pending`, `active: 1`, and insert a matching `handoff_requests` row (canonical bytes) whose body's
    `phaseAttemptOrdinal` is 1. The predecessor settles (`settled-recoverable`, `active: 0`), and `work.currentRunId`
    moves to the handoff run with it added to `lineageRunIds`: `readControlGroup` throws when the current run is not the
    task's last row and the only active one, so the view cannot pass with `currentRunId` left on the predecessor.
  - Assert the view's `grant` equals the stored `grant.handoff` and differs from `grant.work`.
  - Mutation: the view's bucket is always `"work"` — the new criterion red.
  - Commit: `test(control): a handoff-phase run's view carries its handoff grant`.

- [x] **F5 — the decisions route reads the group body once** (`src/panel/controlApi.ts`, `src/panel/groupDecisions.ts`,
  `src/control/ledgerAtRef.ts`, `src/control/dirGroup.ts`, `src/control/multiGroup.ts`, `src/flow/groups.ts`,
  `tests/panel/groupDecisionsApi.test.ts`).
  - Pure helpers: `dirGroupRepoIdOf(body)`, `multiPrimaryRepoIdOf(group)`, `flowGroupOf(store, id, body?)` /
    `flowGroupRepoId(store, id, body?)`, `groupRepoId(store, id, group?)`, `integrationTargetRef(store, id, group?)`,
    `ledgerSources(store, repo, id, group?)` (uses `dirWorkspaceOf(record)`), `readGroupDecisionsView(..., group?)`.
  - Route: `const group = readGroup(store, groupId)` once; multi id via `multiDirOf(group)`; then
    `multiPrimaryRepoIdOf(group) : groupRepoId(store, groupId, group)`; pass `group` to the view.
  - Test: wrap `store.db.prepare` and count `SELECT body FROM groups WHERE id=?` during one GET — exactly 1; behavior
    assertions of the existing cases unchanged.
  - Mutation: the route reads the group again inside `groupRepoId` (drop the `group` argument) — the count red.
  - Commit: `fix(panel): the decisions route reads the group once`.

- [x] **F6 — a corrupt schedule row does not take the list or remove down** (`src/control/schedules/views.ts`,
  `src/control/schedules/store.ts`, `src/control/schedules/commands.ts`, `src/commands/domains/schedule.ts`,
  `web/src/controlTypes.ts`, `web/src/ScheduleSettings.tsx`, `web/src/locales/{en,zh}.ts`,
  `tests/control/scheduleModel.test.ts`).
  - `scheduleListView` uses `listLiveSchedules` and returns `corrupt: [{id, code, message}]` (always present).
  - Store: `readScheduleState(store, id): {removed} | null` reading only `removed`; `markRemovedUnparsed(store, id,
    {revision})` writing revision + `removed = 1` only. `schedule-remove` uses the raw state for the no-op check; a
    parseable body keeps the stamped path, an unparseable one is removed by the raw writer (bytes kept).
  - Web: `SchedulesViewV1.corrupt?`; render `<p data-testid="schedules-corrupt">` with
    `settings.schedules.corrupt` (en/zh). CLI `schedule list --all` flattens `corrupt` beside `schedules`.
  - Tests: the existing corrupt-body case now asserts one `corrupt` entry and no schedules instead of a throw; removing a
    corrupt schedule succeeds and leaves its body bytes unchanged; a live parseable row still lists and removes as before.
  - Mutation: `scheduleListView` uses `listSchedules` again (or `remove` reads through `readSchedule`) — red.
  - Commit: `fix(schedules): a corrupt row is listed as unread and can be removed`.

## Verification

- Per task: the named test file green; `npm run build` where the change is buildable (F1–F3, F5–F6); the mutation seen
  red and restored byte-identically.
- Before any milestone merge (human-only): `npm test` plus `npm run test:all` server side per AGENTS.md.
- No ccloop change, no paid agent run, no panel restart.
