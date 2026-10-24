# Scheduled flows and groups, with a plan library — Implementation Plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax. TDD per task: the criterion first, seen red for the
> named reason, then the code, then green. One commit per task, trailer
> `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

- **Goal:** build `docs/superpowers/specs/2026-10-24-scheduled-flows-and-groups-design.md` (cited "§n", criteria "Cn"),
  in the spec's build order P1–P4 (§18). §21 and §22 take precedence over earlier sections; `autoConfirmBlocker` is the
  3-argument function of the tester-round2 spec D14 / §19.1 (`src/control/autoConfirm.ts`), which governs.
- **Author / anchors:** implementer subagent of Orca session `ffec7b28`, 2026-10-24, branch `feat/scheduled` from `main`
  `6ec49411` (R2 merged: schema `"19"`, `autoConfirmUnlimitedPass`, `createdByPerson`, `personCreated` already reads
  `origin.kind = "schedule"`). Worktree `/private/tmp/orca-ffec7b28/sched`. Line anchors in the spec are at `fdceeb83`;
  every anchor a task cites is re-measured there.
- **Human rulings carried:** H9 「两种都要」; the plan source need not be a merged in-repo file (requirement split, group
  export, owner import); "schedule this group" is one action; a schedule never counts as the person (gaps spec §21
  entry 8). Criterion rewrites: 「这次批准改写所有必要的判据」 — only for tests red because of a ruled change (schema
  version pins `"19"` → `"20"`; a hand start naming a template version the build does not ship, §20 item 9 / M-4), each
  named in its commit body with the reason. Any other red is this branch's regression.
- **Rules:** Rule 5 (scheduling, overlap, streak, confirm-record derivation are code); Rule 9 (each new branch: its named
  mutation seen red, in the `git clone --local` copy `/private/tmp/orca-ffec7b28/sched-mut`, log
  `/private/tmp/orca-ffec7b28/sched-mutations.log`, restore proved by `git diff | wc -c` = 0 and
  `git diff --cached | wc -c` = 0); Rule 14 (every verification run redirected to a file, read whole); Rule 15 (no
  push, no merge); Rule 17 (stores, vaults and HOME only in `mkdtemp` dirs; never `~/.orca`); Rule 18 (`npm test`
  only). No paid runs (fake agents only). The panel is never restarted.
- **Security boundary (§10):** every fire act is `orca-auto` with `via: schedule:<id>`; no fire path builds a principal;
  this spec's code sends no `confirm` and no `flow-effect`; a scheduled run's `external`/`irreversible` effects resolve
  to at least `confirm`, applied last (after configured delivery). `tests/flow/heldEffectChains.test.ts` must stay
  green (it is selected by the flow changes; read it in the final log).

## Builder's decisions (§19; reversible, recorded here)

| # | Decision |
|---|---|
| B1 | Modules: `src/control/planLibrary/{codec,store,commands,views}.ts`; `src/control/schedules/{model,store,commands,pass,views}.ts`. |
| B2 | Ledger scopes. Library verbs: target `{kind: "plan-library"}`, key `@plan-library`, constant revision 0 (as `@flows`). Schedule verbs `schedule-set`, `schedule-enable`, `schedule-remove`, `schedule-resume`: target `{kind: "schedule", scheduleId}`, key `@schedule:<id>`, revision = `schedules.revision` (0 while no row) — the per-schedule optimistic concurrency of §11.1. `schedule-from-group`: target the source group (`{kind: "group", groupId}`), expected revision the group's, `authorityChanged: false`. A fire's import: target the new group `sgrp-…` (revision 0). CLI `RevisionScope` gains `schedule` (read `schedules/<id>` → `revision`, 0 on 404) and `plan-library` (0). |
| B3 | Ids: schedule `sch-<slug>` with slug = the name lower-cased, runs of `[^a-z0-9]` → `-`, trimmed, ≤ 59 chars (client-computed: CLI/Web; `--id` overrides); library entry `pl-<sha256(commandId)[:16]>` (deterministic under replay); fired group `sgrp-<sha256(scheduleId + "\0" + slot)[:16]>`; its plan id `lib-<entryId>-<sha256[:12]>`. |
| B4 | Payloads. `schedule-set` create `{projectId, name, cron, enabled, start}` (no row yet) / edit `{set: {name?, cron?, start?}}` (`start` replaced whole, same `kind`); group `start` always carries `sha256`. `schedule-enable {enabled}`; `schedule-remove {}`; `schedule-resume {}`; `schedule-from-group {scheduleId, name, cron, enabled, tokenLimit?}`; `plan-library-save {source, name, entryId?}`; `plan-library-import {projectId, name, entryId?, doc, provenance: {fileName, fileSha256, format}}`; `plan-library-archive {entryId}`; `import-plan` gains `libraryEntry {entryId, sha256}` (exactly one of `planId` / `libraryEntry`), `tokenLimit: int ≥ 1 \| null` and `integration: IntegrationScheme \| null` (only with `libraryEntry`). |
| B5 | `projectId` is the registered project's `repoId`. A flow schedule's project must be a registered `dir` project (`deps.flowProjects()`); a group schedule's / library entry's a registered repository (`knownRepository`, `repositoryPath`). |
| B6 | The pass: `WebControlService.schedulesPass()` (delegating to `schedules/pass.ts` with injected `startFlow`, `importGroup`, clock, zone), called by the pump after `checksPass` and before the flow pass, with its own catch (as `autoConfirmStep`). |
| B7 | Step 9's facts (§9.2 + §22): the booked row is the group's newest `commands` row whose id starts `orca-auto-confirm-unlimited-v`; success ⇒ `auto-confirmed`; error `auto-confirm-selections-unresolved` ⇒ `waiting: auto-confirm-ineligible:10`; any other error ⇒ `waiting: auto-confirm-refused:<code>`; then `limited`; then `autoConfirmBlocker(store, group, defaults())` condition 8 ⇒ `waiting: auto-confirm-ineligible:8` (re-evaluated each pass: a later success moves `waiting → started`, the only such move); then `delivery-needs-person:<delivery>`; then the group's newest estimate row in `failed \| interrupted \| blocked-capability \| input-too-large` ⇒ `waiting: estimate-failed:<state>[:<reasonCode>]`; else transient (nothing written). |
| B8 | Template version: `builtin/<id>@<n>` with `n !== (template.version ?? 1)` ⇒ `flow-template-version-missing` (FlowRefusal, booked; 422). A schedule stored without `@n` gets `@<shipped>` at write. |
| B9 | Effect clamp: `resolveLevel(cls, step, project, global, {configuredDelivery?, scheduled?})`; `scheduled` applied last: `external`/`irreversible` with value `apply-flag` ⇒ `{value: "confirm", source: "schedule"}`; `stage-only` kept; `local`/`cost` untouched. `gateEffect` passes `scheduled: run.body.origin?.kind === "schedule"`. |
| B10 | `orca plan export --out`: a read row whose `compose` performs the local write (new file `0600`, temp file in the same directory + rename, existing path and missing parent refused, temp removed on failure). |
| B11 | Web test path: `web/tests/schedules.test.tsx` (the repo's web tests live under `web/tests/`, the selector's `WEB_TEST`); the spec's `web/src/schedules.test.tsx` is the same criterion. The spec's P1 Web items (plan library view, import-form listing) are built in P4 with the rest of the Web. |
| B12 | Estimate-failure codes: `estimate-failed:<state>` plus `:<reasonCode>` when the row has one. |

## P1 — library (§5, §12, §11 library rows, §13.1 plan rows) — C8, C9 (library rows), C11, C12 (plan rows)

### Task 1 — schema 19 → 20 (§12) — C11
Files: `src/control/migrations.ts` (`schema19To20`, `initialSchema`, `migrateSchema("19")`, every older path ends with it),
`src/control/store.ts` (accept `"19"`), new `tests/control/scheduleMigration.test.ts`.
- [ ] C11: a store at `String(Number(schemaVersion) - 1)` with groups, flow runs and settings migrates: four tables
  exist, empty; every pre-existing table byte-identical; the backup file exists; a fresh store has the tables. M-C11a
  `drop-table` (remove `schedule_fires` from the step), M-C11b `rewrite-existing` (an `UPDATE groups` in the step).
- [ ] Rewrites (schema 20): every test pinning `"19"` as the current version (measure with `grep -rln '"19"' tests`).

### Task 2 — `orca-plan-v1` codec and the library store (§5.2, §5.4, §5.6) — C8 (codec/store part), C10 (version rows)
Files: `src/control/planLibrary/codec.ts` (schema, canonical bytes, 2 MiB, `docFromArchivedPlan`, `docFromSource`,
`sourceOfDoc(doc, repoPath)` — contracts checked with `taskContractSchema` + `objective.taskId`, loops expanded by
`expandLoopPlan`), `src/control/planLibrary/store.ts` (the single writer: insert entry, append version, archive; no
update/delete of a version row), `src/control/errors.ts`. Test `tests/control/planLibrary.test.ts`.
- [ ] Unknown key, dangling dependency, cycle, contract `objective.taskId` mismatch, > 2 MiB ⇒ refused, nothing stored.
- [ ] Appending version 2 leaves version 1 byte-identical; the writer refuses a version update. M-C8b `rewrite-v1`.

### Task 3 — library verbs + `import-plan` with `libraryEntry` (§5.3, §5.5, §11) — C8, C9 (library rows)
Files: `src/control/webProtocol.ts` (verbs, targets, payloads, result kinds), `src/control/commandLedger.ts` (scopes),
`src/control/planLibrary/commands.ts`, `src/control/planImport.ts` (library source, `tokenLimit`, `integration`,
`origin`), `src/panel/humanOnly.ts`, `src/panel/controlApi.ts` (routes + reads: `GET /api/control/plan-library?repoId=`,
`/plan-library/:id`, `/plan-library/:id/versions/:sha256` download), `src/control/webService.ts`. Tests
`tests/control/planLibrary.test.ts`, `tests/control/scheduleAccess.test.ts`, rows in `tests/panel/accessMatrix.test.ts`.
- [ ] C8 round trip: save from a group, import from the entry ⇒ same task ids, dependencies, contract hashes, loop
  recipes. M-C8a `contracts-by-reference`.
- [ ] C8 draft: save from an awaiting-review draft with its `draftHash` (stays awaiting review); wrong hash ⇒
  `plan-version-conflict`. M-C8d `no-draft-hash`, M-C8e `accept-while-saving`.
- [ ] C8 archive refused while a disabled schedule pins it (a schedule row inserted directly until P2). M-C8c `archive-while-pinned`.
- [ ] C8 `import-plan` with `libraryEntry` / with `planId` work; both or neither refused; `tokenLimit` without `libraryEntry` refused.
- [ ] C9 library rows: tiers per §11.1; dispatched run refused every row. M-C9c `save-ignores-entryId`, M-C9d `save-any`.

### Task 4 — `plan` CLI rows (§13.1) — C12 (plan rows)
Files: new `src/commands/domains/plan.ts` (list, show, save, import, export, archive; `plan preview` stays in `dev.ts`),
`src/commands/domains/work.ts` (`group import --library`), `src/commands/types.ts`, `src/commands/write.ts`,
`src/commands/registry.ts`, generated docs (`npm run gen:cli-docs`). Test `tests/commands/scheduleCli.test.ts`.
- [ ] `plan import` of a scheduler plan file sends an inline `orca-plan-v1` and never a path (request body asserted);
  refuses `targetRepo` ≠ the project's path, a contract outside the repository, one reached through a symlink
  (`plan-library-contract-path-refused`). M-C12a `send-path`, M-C12b `follow-symlink`, M-C12c `no-inside-check`.
- [ ] `plan export --out` creates `0600`, refuses an existing path, leaves no temp file on a forced failure. M-C12d
  `default-mode`, M-C12e `overwrite`.
- [ ] HOME and every `ORCA_*` redirect in temp dirs; nothing under HOME. M-C12f `homedir-default`.

## P2 — schedules and flow fires (§6, §7, §8, §10) — C1–C6v, C9, C10, C12

### Task 5 — schedule model and verbs (§6, §11) — C1, C9 (schedule rows), C10 (schedule attribution)
Files: `src/control/schedules/{model,store,commands,views}.ts`, webProtocol, commandLedger, humanOnly, controlApi
(reads `GET /api/control/schedules?repoId=`, `/schedules/:id`, `/schedules/:id/fires`), webService, errors. Tests
`tests/control/scheduleModel.test.ts`, `tests/control/scheduleAccess.test.ts`.
- [ ] C1 as the spec lists (too frequent, bad zone, 9th schedule, non-dir project, param type, absolute image, version
  stored, group sha256 required/unknown/other project, id prefixes). M-C1a `no-validateSchedule`, M-C1b `no-limit`,
  M-C1c `no-param-check`, M-C1d `no-version`, M-C1e `default-head`, M-C1g `sch-prefix-groups`. (M-C1f
  `project-default-in-from-group` lands with Task 9.)
- [ ] C9 schedule rows. M-C9a `set-open`, M-C9b `enable-true-open`.
- [ ] C10: every schedule write stores the person's `by`/`via`.

### Task 6 — `schedulesPass` (§7) — C2, C2u, C3, C4, C5 (a, b, c, e), C10 (fire rows)
Files: `src/control/schedules/pass.ts`, `src/control/schedules/store.ts` (fire writer: only `starting → started|failed`,
`started → waiting`, `confirm` null → value, and `waiting → started` for `auto-confirm-ineligible:8`),
`src/panel/controlAssembly.ts` (pump), webService. Tests `tests/control/schedulePass.test.ts`, `tests/control/scheduleCrash.test.ts`.
- [ ] C2 slots (no catch-up at create/enable, one late fire with `missed`, cron edit, `state.tz` stored with `lastSlot`,
  DST, zone change). M-C2a `fire-every-missed`, M-C2b `lastSlot-minus-infinity`, M-C2c `no-reinit-on-enable`, M-C2d
  `no-zone-reinit`, M-C2e `tz-null-at-create`, M-C2f `fire-twice-autumn`.
- [ ] C2u direct second insert rejected. M-C2u `drop-unique`.
- [ ] C3 overlap. M-C3a `slot-pending`, M-C3b `paused-inactive`, M-C3c `blocked-inactive`, M-C3d `starting-not-active`,
  M-C3e `any-run-of-template`, M-C3f `skip-is-failure`.
- [ ] C4 streak. M-C4a `never-pause`, M-C4b `resume-catches-up`, M-C4c `skip-resets`, M-C4d `waiting-is-failure`.
- [ ] C5 (a)(b)(c)(e). M-C5a `random-command-id`, M-C5c `slots-before-resume`, M-C5e `no-already-happened-check`.
- [ ] C10 fire rows. M-C10a `by-is-creditedTo`, M-C10b `second-outcome-move`, M-C10c `waiting-to-started-any-reason`.

### Task 7 — flow fires, template version, the clamp (§8, §10) — C6, C6v
Files: `src/flow/kernel.ts` (version check; `origin` into `FlowRunBody`), `src/flow/kinds/registry.ts`,
`src/flow/flowCommands.ts` (BOOKED), `src/flow/settings.ts`, `src/flow/effects.ts`, errors. Tests
`tests/flow/scheduledFlowFire.test.ts`, `tests/flow/templateVersion.test.ts`, cases in `tests/flow/policyResolution.test.ts`.
- [ ] C6. M-C6a `no-clamp`, M-C6b `clamp-before-delivery`, M-C6c `clamp-hand-started`, M-C6d `clamp-cost`,
  M-C6e `scheduled-from-template`.
- [ ] C6v. M-C6v `no-version-compare`.
- [ ] Rewrites (§20 item 9): a hand start naming an unshipped version, if any test does.

### Task 8 — `schedule` CLI rows (§13.1, §13.2) — C12 (schedule rows)
Files: new `src/commands/domains/schedule.ts`, registry, generated docs. Test `tests/commands/scheduleCli.test.ts`.
- [ ] every row parses and maps; `schedule add group` without `--version` refused locally; MCP runs `schedule list`.

## P3 — group fires (§9) — C5 (d), C7, C7a

### Task 9 — booked import, step 9, `schedule-from-group`, `group schedule` — C1 (from-group part), C5d, C7, C7a
Files: `src/control/schedules/pass.ts`, `src/control/schedules/commands.ts` (`schedule-from-group`),
`src/panel/controlOverview.ts` (`scheduled-waiting:<reason>` on the `budget-review` step), `src/commands/domains/work.ts`
(`group schedule`). Tests `tests/control/scheduledGroupFire.test.ts`, `tests/control/scheduleWithAutoConfirm.test.ts`,
`tests/control/scheduleCrash.test.ts` (d), `tests/panel/controlOverview.test.ts`.
- [ ] C7. M-C7a `import-head`, M-C7b `no-hash-recompute`, M-C7c `project-integration-at-fire`, M-C7d `drop-tokenLimit`,
  M-C7e `direct-writeImportedPlan`, M-C7f `send-confirm`, M-C7g `estimate-failure-failed`.
- [ ] C7a (with §22.3). M-C7a1 `drop-integration-local`, M-C7a2 `default-finite-limit`, M-C7a3 `copy-unbooked-confirm`,
  M-C7a4 `drop-ineligible-8`, M-C7a5 `ineligible-8-write-once`, M-C7a6 `selections-as-refused`.
- [ ] C5 (d). M-C5d `confirm-from-memory`.
- [ ] C1 from-group: source scheme pinned (`local` ⇒ that scheme, `keep` ⇒ null). M-C1f `project-default-in-from-group`.

## P4 — Web, copy, skill (§13.3, §14) — C13

### Task 10 — Web schedules, library, group actions, requirement save, badges, copy — C13
Files: `web/src/ProjectSettings.tsx`, new `web/src/ScheduleSettings.tsx`, `web/src/ScheduleDetail.tsx`,
`web/src/PlanLibraryView.tsx`, `web/src/ControlGroupView.tsx`, `web/src/GroupActionsMenu.tsx`,
`web/src/RequirementsPanel.tsx`, `web/src/ControlPanel.tsx`, `web/src/FlowRunPage.tsx`, `web/src/FlowBoard.tsx`,
`web/src/controlApi.ts`, `web/src/controlTypes.ts`, `web/src/locales/{en,zh}.ts`. Test `web/tests/schedules.test.tsx`.
- [ ] C13. M-C13a `group-page-sends-schedule-set`, M-C13b `hide-paused`, M-C13c `auto-with-delivery`, M-C13d
  `no-scheduled-waiting-reason`, M-C13e `drop-zh-key`.

## Task 11 — gate (C0)

- [ ] `ORCA_CCLOOP_BIN=/private/tmp/orca-ffec7b28/ccloop-f4de340/dist/cli.js CCLOOP_CACHE_DIR=/private/tmp/orca-ffec7b28/ccloop-cache npm test > /private/tmp/orca-ffec7b28/sched-npmtest.log 2>&1; echo rc=$?`, read whole;
  `node scripts/assert-selected.mjs` over the C0 list (web path per B11); selected count and skips copied as printed.
  M-C0 `unselected-name` (an expected path the log does not select ⇒ exit 1). A red not ours is rerun alone and
  compared with untouched `main` per `docs/handoff/known-load-flakes.md`.
