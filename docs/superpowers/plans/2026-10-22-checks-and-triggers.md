# Orca Checks and Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- **Goal:** one check model (kind + trigger + watermark) runs the as-built integration check and the new layer-2
  model review, plus user-defined scheduled checks, with project > global > built-in settings and optional locks.
- **Spec:** `docs/superpowers/specs/2026-10-22-checks-and-triggers-design.md` (read in full). Rulings:
  `.superpowers/sdd/2026-10-21-session-8b1469ea/progress.md:59-66` (`:64` keep/PR groups are **not** reviewed; both kinds
  cover only groups Orca merged into a local target), `.superpowers/sdd/2026-10-22-session-b37f7ce9/progress.md` (criteria
  rewrites authorised: "这次批准改写所有必要的判据"; paid real runs allowed this round).
- **Author:** plan writer for session `b37f7ce9` (2026-10-22). **Anchors measured at `1597680af4d44e7d3de2656907461202dad6973e`**
  (main, before CLI v2 lands) with `grep -n` / `sed -n` (Rule 14). **CLI v2 (`docs/superpowers/plans/2026-10-22-cli-v2.md`,
  branch `feat/cli-v2`) lands first and moves many of them** (`src/cli.ts`, `src/panel/humanOnly.ts`, `permissions.ts`,
  `controlApi.ts`, `decisionCommands.ts`, `flaggedDecisions.ts:86-90`, `skills/`): **re-measure every anchor at the start
  of each task** and record the new line in the ledger.
- **Sequencing:** CLI v2 → **this plan (control schema 15 → 16)** → flow engine phase 1 (its schema step is 16 → 17).
- **Ledger:** `.superpowers/sdd/2026-10-22-session-b37f7ce9/progress.md`. Each criterion rewrite is a ledger line
  `file:line old → new, reason`; its commit carries `Ruling: 这次批准改写所有必要的判据 (b37f7ce9)`.
- **Tech:** TypeScript ESM, zod, Express, `node:sqlite`, vitest, React 19 (web). No new dependency (no cron package in
  the tree at `1597680a`: `grep -n cron package.json` → none).

## Global Constraints

- Verification is `npm test` only (Rule 18; typecheck included). Every run `> $LOGS/<name>.log 2>&1`, read back whole
  (Rule 14). "0 selected" and skipped files are copied into the report verbatim (Rule 12). Never `npm run verify`.
- Each new branch: name the mutation that deletes it and see it red (Rule 9); mutations only in a `git clone --local`
  copy (Rule 15); restoration proved by `git diff | wc -c` = 0 and `git diff --cached | wc -c` = 0.
- Every registry change (CLI v2 `src/commands/**`) is followed by `npm run gen:cli-docs` in the same commit (CLI v2's
  drift and verb-coverage tests stay green at every task end).
- `set-integration-check` is removed with **no alias** (P1). Stored history rows that name it stay readable (Task 4).
- Automatic acts are actor `orca-auto` (`ORCHESTRATION_ACTOR`) with deterministic command ids (Rule 13).
- No new out-of-repo path (Rule 17): settings live in `repository_settings` / `orchestration_settings`, state in the
  control DB, review inputs under the existing runs root `controlWorkspaceRoots(stateDir).runsRoot`
  (`src/control/workspace.ts:33`). Tests use temp state dirs; none touches `~/.orca` (the final gate's backup is the
  controller's step, not a test).
- Built-in values (spec §3, §4.1, verbatim): integration check **off**, trigger
  `all:[{any:[landed-groups{min:2}]},{any:[queue-idle, since-last{ms:21_600_000}]}]`, `command:null`; model review
  **on**, trigger `all:[{any:[conflict-reconciled, overlapping-files{minGroups:2}]},{any:[since-last{ms:604_800_000}]}]`,
  `budgetTokens: 1_000_000`, `maxGroupsPerReview: 12`.
- Limits (spec §2.2, §2.4, §6.3): 1–4 clauses, 1–6 conditions per clause, `landed-groups.min` 1–50, `since-last.ms` ≥
  600_000, cron at most hourly, ≤ 8 scheduled checks per project and ≤ 8 global, 0–20 findings, 2–8 evidence entries.
- Refusal codes, verbatim: `check-schedule-too-frequent`, `check-schedule-limit`, `check-setting-locked`. Errored ends,
  verbatim: `no-profiles`, `findings-path-denied`, `not-read-only`, `findings-invalid`, `budget`, `archived`, `stopped`,
  `blocked-waiting-human`, `claim-refused:<code>`, `confirm-refused:<code>`, `not-admitted`, `run-failed:<cause>`,
  `target unreadable`. Records: `initialised`, `skipped: nothing new`, `watermark-rebased`, `migrated: re-covers <n> groups`,
  `no-checks: fix not opened`.

## Access mapping (spec §4.4 written for today's two tiers → CLI v2 §15)

Every new verb is `human-only` in `VERB_ACCESS` (Web members refused, unchanged — CLI v2 §15.1 "Web member: unchanged").
The socket tier follows CLI v2 §15.1's nearest existing row; every row is **refused with the dispatched-run marker**
(so the review agent can never dismiss its own findings or re-arm its own trigger):

| Verb | `SOCKET_TIER` | CLI v2 analogue |
|---|---|---|
| `set-check-settings` | `token` when `set.command` is a non-null string or `set.budgetTokens` is present; else `open` | `set-integration-check` with command ⇒ token (human "同意"); `set-limit` ⇒ token; `set-orchestration-settings` ⇒ open |
| `set-scheduled-check` | `token` when it adds or enables a schedule (`remove !== true && enabled === true`); else `open` | spend verbs ⇒ token; `set-integration-scheme` keep ⇒ open |
| `set-check-locks` | `token` | `apply-agent-update` / spend caps (admin act) |
| `run-check-now`, `resume-check` | `open` | `retry-integration` ⇒ open |
| `ratify-flagged-decision` (+ `note`) | `open` (unchanged) | CLI v2 row |
| `set-agent-preferences` (+ `review`) | not human-only (`any`) | unchanged |

Registry `access` (CLI v2 `CommandDef.access`, one static value per row): `check lock` = `"token"`; every other `check`
row `"open"`, its help naming the token cases; the socket's `SOCKET_TIER` predicate is what decides.

## Review Focus

1. A database whose command ledger already holds `set-integration-check` rows: `GET …/commands/:id` and replays re-parse
   stored success bodies against `commandVerbSchema` (`commandLedger.ts:123`, `webProtocol.ts:1861`) — removing the verb
   must not make history unreadable → Task 4 test.
2. A target branch someone rewrote (force-push, reset) between reviews: range from the merge-base, never an error loop,
   never a re-review of the whole history → Task 5 test.
3. A pump tick on a project with nothing new must cost one `rev-parse` (no per-group git) — the pump runs every wake →
   Task 5 test counts git calls.
4. A review agent that cannot read the out-of-worktree input directory would write `findings: []` and move the
   watermark silently (the §6.3 schema is strict, so no read receipt can be added) → Task 9 measures each installed
   kind's read reach statically before fixing the location, and its E2E asserts the facts name an existing directory
   whose `index.json` hash is on the mark.
5. A person dismisses a finding from an involved group's card: ratify must go to the **review group** with the note,
   never the clicked group → Task 10 test (spec criterion 11).

---

### Task 1: Cron and trigger document (pure)

**Files:** Create `src/control/checks/cron.ts`, `src/control/checks/trigger.ts`. Test `tests/control/checkCron.test.ts`,
`tests/control/checkTriggers.test.ts` (pure cases), `tests/control/checkSettings.test.ts` (validation cases).

**Interfaces (Produces):**
- `parseCron(expr: string): CronSpec` (5 fields: minute hour day-of-month month day-of-week; `*`, lists, ranges, `/step`;
  dom/dow OR when both restricted, as vixie cron) — throws `ControlError("control-argument-invalid", …)`.
- `cronSlotsBetween(spec, tz: string, afterExclusive: number, toInclusive: number): number[]` (bounded to 10_000 slots);
  `latestSlot(spec, tz, afterExclusive, now): number | null`; `nextSlots(spec, tz, from, n): number[]`.
- `cronTooFrequent(spec): boolean` = the minute field matches more than one value (two fires inside one hour need two
  distinct minutes; one minute value fires at most hourly).
- `triggerSchema` (zod, `.strict()`, discriminated conditions `landed-groups{min}`, `conflict-reconciled`,
  `overlapping-files{minGroups}`, `queue-idle`, `since-last{ms}`, `schedule{cron}`) with §2.2's bounds;
  `validateTrigger(t): void` throws `ControlError("check-schedule-too-frequent")` or `control-argument-invalid`.
- `type RangeFacts = { landed: number; conflictReconciled: boolean; overlapGroups: number; queueIdle: boolean;
  msSinceLastStart: number | null; scheduleDue: (cron: string) => boolean }`;
  `evaluateTrigger(t: Trigger, f: RangeFacts): boolean` — AND over clauses of OR over conditions; `since-last` true when
  `msSinceLastStart === null`. The implied "range non-empty" and "not in flight" are the caller's (Task 5).
- `BUILTIN_TRIGGERS: { "integration-check": Trigger; "model-review": Trigger }` (Global Constraints values).

- [ ] Step 1: failing tests. Cron: `0 9 * * 1` in `Asia/Shanghai` next 3 slots are Mondays 09:00 local; `*/30 * * * *` ⇒
  `cronTooFrequent` true, `5 * * * *` ⇒ false; three missed weekly slots ⇒ `latestSlot` = the newest. Trigger: the
  integration default fires on (landed 2, idle) and (landed 2, 6 h), not on landed 1, not on (2, running, 5 h); the
  model default fires on (conflict, 7 d) and (overlap 2, 7 d), not (overlap, 6 d), not (landed 3, no overlap/conflict).
  Validation (`checkSettings.test.ts`): 5 clauses, 7 conditions, `min:51`, `since-last{ms:599_999}`, unknown kind,
  `schedule{cron:"* * * * *"}` ⇒ each refused by its code.
- [ ] Step 2: run → red (`$LOGS/t1-red.log`).
- [ ] Step 3: implement.
- [ ] Step 4: `npm test > $LOGS/t1.log 2>&1` green.
- [ ] Mutations: swap AND/OR ⇒ red; `since-last` false when never run ⇒ red; `cronTooFrequent` always false ⇒ red; drop
  each bound ⇒ its case red; `latestSlot` returns the oldest ⇒ red.
- [ ] Commit `feat(checks): cron parser and trigger document`.

### Task 2: Schema 16 and the settings bodies

**Files:** `src/control/migrations.ts:3` (`schemaVersion` "16"), add `schema15To16` (`CREATE TABLE IF NOT EXISTS
check_state(repo_id TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(repo_id,
kind, target)) STRICT;`) to `initialSchema` and every `migrateSchema` arm (`:150-194`), plus a JS step
`migrateSettings15To16(db)` that rewrites each `repository_settings.body` with `integrationCheck` to
`checks.integrationCheck {enabled, command}` and drops the old field (canonical bytes, revision unchanged).
`src/control/store.ts:88` accepts "15". `src/control/workspaceSettings.ts:18-24` body gains `checks:
checksLayerSchema.optional()`, loses `integrationCheck`; `src/control/orchestration.ts:36` settings gain `checks`
(+ `locks`). `src/control/integrationCheck.ts:35-37,40-73` read/write `checks.integrationCheck` (the verb stays until
Task 4). `src/control/integrationCommands.ts:55` carries `checks` instead of `integrationCheck`. Create
`src/control/checks/settingsSchema.ts` (`checksLayerSchema`, `ScheduledCheck`, `LockablePath`, spec §4.1 shape,
`params: z.object({}).strict()`). Test `tests/control/checkStateMigration.test.ts` (settings part).

- [ ] Step 1: failing tests — a v15 store with body `{…, integrationCheck:{enabled:true, command:"npm ci && npm test"}}`
  opens at 16 with `checks.integrationCheck` equal and no `integrationCheck` key; every other table byte-identical
  (pattern `tests/control/schema10.test.ts:36-60`); `check_state` exists and is empty; a fresh store is 16.
- [ ] Step 2: rewrite the version pins "15" → "16" (criteria table) → red.
- [ ] Step 3: implement.
- [ ] Step 4: `npm test > $LOGS/t2.log 2>&1` green.
- [ ] Mutations: drop the field mapping ⇒ red; leave the old key ⇒ strict parse red; bump revision in migration ⇒ red.
- [ ] Commit `feat(control)!: schema 16 — check_state table, checks settings field` (+ `Ruling:` line for the pins).

### Task 3: Effective settings, locks, read route

**Files:** Create `src/control/checks/settings.ts`. `src/panel/controlApi.ts` (next to `:284`): `GET
/api/control/checks[?repoId=]`; `:293-294` drops `integrationCheck` from the repository integration read
(`webProtocol.ts:1956-1958` field removed). CLI v2 registry row `check show [--global]` (read). Test
`tests/control/checkSettings.test.ts`.

**Interfaces (Produces):**
- `type Sourced<T> = { value: T; source: "project" | "global" | "builtin"; lockedBy: "global" | null }`.
- `effectiveChecks(store, repoId: string | null): EffectiveChecks` — per kind `{enabled, trigger, command?, budgetTokens?,
  maxGroupsPerReview?}` each `Sourced`; `scheduled: Array<Sourced<ScheduledCheck> & { scope: "project" | "global" }>`
  (project entry with a global id overrides it); a locked field ignores a looser project value (`budgetTokens` > global,
  `command` ≠ global and not null/absent) and returns the global one with `lockedBy:"global"`.
- Read body `orca-checks-v1`: `{repoId|null, kinds, scheduled, locks, state}` (`state` filled by Task 5; `[]` here).

- [ ] Step 1: failing tests (spec criterion 5): project > global > built-in per field; whole trigger replaced, never
  merged; a looser project `budgetTokens` written before a lock is ignored under the lock (`lockedBy:"global"`) and
  applies again after unlock; read route body parses.
- [ ] Step 2: red. Step 3: implement. Step 4: `npm test` green.
- [ ] Mutations: swap layer order ⇒ red; deep-merge triggers ⇒ red; honour the looser value under a lock ⇒ red.
- [ ] Commit `feat(checks): effective settings with source and locks; GET /api/control/checks`.

### Task 4: Settings verbs, access, removal of `set-integration-check`

**Files:** `src/control/webProtocol.ts:638` verbs `set-check-settings`, `set-scheduled-check`, `set-check-locks` (raw
`:987`, effective `:1059`, success result kinds, projectionless list `:1874`); payloads: `{kind, set: {...},
clear: string[]}` (repository or orchestration target), `{id, kind, cron, enabled} | {id, remove:true}`, `{locks:
LockablePath[]}` (orchestration only). Remove `set-integration-check` everywhere (`webProtocol.ts:638,827-828,987,1059,1759,1874`,
`controlApi.ts:532-539,659`, `webService.ts:874-877`, `integrationCheck.ts:32,40-73`, `humanOnly.ts:47`, CLI v2
`SOCKET_TIER` row, `web/src/controlApi.ts:232-234`, `web/src/controlTypes.ts:569,593`, CLI v2 `project
set-integration-check` row). Create `src/control/checks/commands.ts` (`applySetCheckSettings`, `applySetScheduledCheck`,
`applySetCheckLocks`, revision rules spec §4.1). Create `src/control/checks/retired.ts` exporting `RETIRED_VERBS =
["set-integration-check"] as const` and the read-side schema that accepts a stored success body naming a retired verb
(used only by `commandLedger.ts:120-127`'s stored-row path; a new raw command naming it is refused by the raw schema).
`src/panel/humanOnly.ts` rows + CLI v2 `SOCKET_TIER` predicates per **Access mapping**. Registry rows `check set|reset|
schedule|lock`. `web/src/IntegrationCheck.tsx` saves through `set-check-settings` (full UI: Task 10). Tests
`tests/control/checkSettings.test.ts` (writes), `tests/control/checkAccess.test.ts`, `tests/control/removedVerb.test.ts`.

- [ ] Step 1: failing tests. Writes: locked `budgetTokens` refuses higher (`check-setting-locked` naming the lock),
  accepts lower; locked `command` refuses a different one; 9th scheduled check `check-schedule-limit` (project and
  global separately); `set-check-locks` on a repository target refused `control-target-not-allowed`. Access (criterion 9,
  in CLI v2 terms): every new verb `human-only` (Web member refused, owner ok); socket rows per the mapping table incl.
  token predicate cases; marker ⇒ `control-dispatched-run-refused`; `set-agent-preferences` with `review` accepted for
  a socket agent. History: a store with a stored `set-integration-check` success row ⇒ `GET groups/@repository:<r>/commands/<id>`
  answers 200 with that body. Removed verb (criterion 10): spawn `grep -rn "set-integration-check" src web/src skills`
  to a temp file, read back; only `src/control/checks/retired.ts` and the migration may match.
- [ ] Step 2: rewrite criteria (table: `archiveGroup.test.ts:174`, `skill.test.ts:36` or its CLI v2 successor,
  `integrationCheck.test.ts` setter calls, CLI v2 `accessMatrix` set-integration-check rows, `web/tests/integrationCheck.test.tsx`
  request shape) → red.
- [ ] Step 3: implement; `npm run gen:cli-docs`.
- [ ] Step 4: `npm test > $LOGS/t4.log 2>&1` green.
- [ ] Mutations: mark `set-check-settings` socket `open` with a command ⇒ red; allow a looser write under a lock ⇒ red;
  drop `RETIRED_VERBS` tolerance ⇒ history case red (`control-command-result-invalid`); re-add the verb string to the
  route table ⇒ removedVerb red; drop a `SOCKET_TIER` row ⇒ CLI v2 build-time check red.
- [ ] Commit `feat(checks)!: set-check-settings, set-scheduled-check, set-check-locks; remove set-integration-check`.

### Task 5: Check state, watermark, range, evaluation (integration-check kind on the new model)

**Files:** Create `src/control/checks/state.ts`, `src/control/checks/range.ts`, `src/control/checks/pass.ts`.
`src/control/integrationCheck.ts:76-130,166-182` (meta-row state, `integrationCheckDue`, start/end records) replaced by
the new state; `landedGroups` (`:101-117`) excludes any body with `systemDebug`; `src/control/webService.ts:879-946`
`integrationCheckPass` → `checksPass(): Promise<{started; initialised; skipped}>`; `src/panel/controlAssembly.ts:271`
calls it in the same place (checks open groups that the next `systemDebugPass` confirms). Read route fills `state`.
Tests `tests/control/checkWatermark.test.ts`, `tests/control/checkStateMigration.test.ts` (lazy part),
`tests/control/checkTriggers.test.ts` (store cases).

**Interfaces (Produces):**
- `check_state.body` = spec §5.4 `{watermark, lastStartAt, lastSlot, runSeq, failureStreak, paused, pendingRun, rebased,
  last:{state, at, from, to, groups, detail, reviewGroupId, debugGroupIds, recordHash}}` (`pendingRun: {commandId, at} |
  null` is Task 6's; `recordHash` Task 9's). `readCheckState(store, repoId, kind, target)`, `writeCheckState(...)`.
- `migrateIntegrationMeta(store, repo, repoId, git): Promise<void>` — spec §5.1 steps 1–4; one transaction writes
  `check_state` and deletes `meta` `integration-check:<repo>`; a crash before commit leaves the row.
- `rangeOf(repo, W, H): Promise<{from, to, groups: RangeGroup[], rebased: boolean}>`; `RangeGroup = LandedGroup &
  {paths: string[]}`; `changedPaths(repo, M, chain)`: M with ≥ 2 parents ⇒ `git diff --name-only M^1 M`; else from the
  nearest earlier first-parent commit of `H` that is `W` or another landed group's `integratedCommit` (over-includes a
  person's direct commits; recorded). Cached in-process by `(prev, M)` (commits are immutable).
- `rangeFacts(store, repoId, groups, state, now): RangeFacts` — `conflictReconciled` = a group in range has a flag of
  source `integration-conflict` in any state; `reconcile` flags never count.
- Pump fast path: `rev-parse refs/heads/<target>`; `H === W` ⇒ no further git.

- [ ] Step 1: failing tests. Watermark (criterion 4): completion moves it, start does not; `errored` and interruption
  leave it; rewritten target ⇒ merge-base range + `watermark-rebased`; first evaluation ⇒ `W := H`, `initialised`, no
  run. Triggers (criterion 2, store): ladder fix group + one ordinary group ⇒ no integration check; system group of each
  source kind with overlapping files neither counts nor overlaps; `keep`-delivery group never counts; single group with a
  `reconcile` flag ⇒ no review trigger. Migration (criterion 6, lazy): all covered ⇒ `W` = newest covered; one uncovered
  between covered ⇒ first parent of its commit + `migrated: re-covers <n> groups`; none landed ⇒ unset; old row read
  until the first pump evaluation; injected throw before commit leaves the `meta` row. Fast path: a spy on `gitChild`
  sees exactly one call when `H === W`. `integrationCheck.test.ts:63-87` behaviour holds through `checksPass`.
- [ ] Step 2: red. Step 3: implement. Step 4: `npm test > $LOGS/t5.log 2>&1` green.
- [ ] Mutations: advance at start; advance on `errored`; overlap against groups before `W`; drop "range non-empty";
  count `reconcile` flags; count system groups; count `keep` groups; `W` from `last.commit`; delete `meta` before
  writing `check_state` — each ⇒ red.
- [ ] Commit `feat(checks): watermark per (project, kind, target); integration check on the check model`
  (+ `Ruling:` line for `integrationCheck.test.ts` rewrites — system groups no longer count, spec §2.3).

### Task 6: Scheduled checks, failure streak, run now, resume

**Files:** `src/control/checks/pass.ts` (slots, streak, pause, `pendingRun`); `src/control/webProtocol.ts` verbs
`run-check-now {kind}` and `resume-check {kind}` (repository target); `src/control/checks/commands.ts`
(`applyRunCheckNow` writes `pendingRun`, answers `check-run-requested`; `applyResumeCheck` clears `paused` and
`failureStreak`, `no-op-command` when not paused); `humanOnly.ts` + `SOCKET_TIER` rows; routes
`POST /api/control/repositories/:repoId/checks/run|resume`; registry `check run <kind>`, `check resume <kind>`.
Tests `checkTriggers.test.ts`, `checkWatermark.test.ts`.

- [ ] Step 1: failing tests. `modelReview.enabled:false` + one enabled schedule ⇒ the event trigger never fires and the
  schedule does; two schedules of one kind consume their own `lastSlot`; a global schedule evaluates once per project and
  a project entry `{id, enabled:false}` disables it there; a schedule with no `lastSlot` initialises it to the latest
  slot ≤ now without a run; a slot right after an event review with no new landing ⇒ `skipped: nothing new`, slot
  consumed, no run; a slot during an in-flight run stays pending and the next start consumes it; three `errored` ends ⇒
  `paused` (neither trigger nor slot starts it) ⇒ `resume-check` ⇒ next trigger starts; interruption does not count;
  `run-check-now` ignores the trigger, respects the watermark (empty range ⇒ `skipped: nothing new`) and in-flight rule,
  runs while paused, and on no watermark records `initialised`. Slot time zone = `readUsageCalendar(store).timeZone`
  (`src/control/usageCalendar.ts:9`).
- [ ] Step 2: red. Step 3: implement; `npm run gen:cli-docs`. Step 4: `npm test` green.
- [ ] Mutations: kind `enabled` gates schedules; every missed slot runs; `lastSlot` keyed by kind; streak counts
  interruptions; pause ignored by schedules — each ⇒ red.
- [ ] Commit `feat(checks): scheduled checks, failure-streak pause, run now and resume`.

### Task 7: Schema work for the model review (sources, flags, preferences)

**Files:** `src/control/webProtocol.ts:938-942` — `SYSTEM_DEBUG_SOURCE_KINDS` gains `model-review`,
`model-review-finding`; `systemDebugSourceSchema` becomes `z.discriminatedUnion("kind", …)`: the three existing
variants byte-identical, `{kind:"model-review", repoId, target, from, to, runSeq}`, `{kind:"model-review-finding",
repoId, reviewGroupId, findingId}`; summary `:1233-1234` and `web/src/controlTypes.ts:107-108` follow.
`src/control/systemDebug.ts`: `systemDebugGroupId` (`:49-52`) ⇒ `sysreview-<sha256(canonical source)[:16]>` /
`sysfinding-<…>` for the new kinds; `systemDebugGroups` (`:212`) selects `sysdebug-`, `sysreview-`, `sysfinding-`;
mark gains optional `openedAt` (Task 9's 24 h rule). Readers of `source.groupId` / `taskId`, each handling the new
kinds: `systemDebug.ts:63-66` (sourceContract ⇒ null), `:72-73` (sourceAgent ⇒ undefined), `:87` (goal text names the
range or the review), `INSTRUCTION` table, `:331-334` (ladder prefix only — unchanged), `webService.ts:764,767`,
`:827-829` (criteria-review only), `criteriaReview.ts:49-51`, `controlViews.ts:465`, `web/src/BoardView.tsx:58`.
`src/control/flaggedDecisions.ts:15-23` body gains optional `severity`, `note` (≤ 2048), `involvedGroupIds` (2–8);
`flagDecision` takes them; `ratifyFlag` (`:86-91`, CLI v2 adds `ratifiedVia`) takes `note`; `listFlaggedDecisions` gains
`listFlagsInvolving(store, groupId)` (JSON scan over `source='model-review'`). `webProtocol.ts:924` ratify payload gains
`note`. `src/panel/groupDecisions.ts:64,126` lists involved flags and excludes `severity:"minor"` from `flaggedCount`.
`webProtocol.ts:64-71` `operatorPreferencesSchema` gains `review: partialSelectionSchema.optional()`;
`src/control/agentPreferences.ts` keeps it. Registry: `decision ratify … [--note <text>]`, `agent set-preferences
--review <agent[:model]>`. Test `tests/control/modelReviewSchema.test.ts`.

- [ ] Step 1: failing tests: the three old source variants parse unchanged and their ids are unchanged (golden ids
  from today's `systemDebugGroupId`); new ids have the two prefixes and differ by `runSeq`; a minor flag is listed on an
  involved group's decisions view but not counted; ratify with `note` stores it beside `ratifiedBy`; a socket
  `set-agent-preferences` with `review` round-trips.
- [ ] Step 2: red. Step 3: implement; `npm run gen:cli-docs`. Step 4: `npm test` green.
- [ ] Mutations: count minor flags ⇒ red; id without `runSeq` ⇒ red; old variant id changes ⇒ golden red.
- [ ] Commit `feat(control): model-review source kinds, flag severity/note/involved groups, review agent slot`.

### Task 8: Findings schema, validation, validator, inputs, plan builder (pure)

**Files:** Create `src/control/modelReview/findings.ts` (`findingsSchema` = spec §6.3 `orca-model-review-findings-v1`;
`validateFindings(doc, range, groups: RangeGroup[], lineCount: (path) => number | null): { valid: Finding[]; dropped:
Array<{finding: Finding; reason: string}> }` with reasons `ref-not-in-range:<groupId>:<path>`, `one-sided`,
`line-out-of-file`), `src/control/validateFindings.ts` (CLI entry: `<file> <from> <to>`; exit 0 valid schema and range,
1 otherwise with the zod error on stderr — schema only, refs are code-side after the run), `src/control/modelReview/inputs.ts`
(`writeReviewInputs(dir, input): Promise<{dir; sha256}>`: one JSON per §6.2 item + `index.json`, dir `0700`, files
`0600`, each item cut by the head rule at 64 KiB with the cut recorded in `index.json`),
`src/control/modelReview/plan.ts` (`buildModelReviewPlanSource(input, repoPath, agent?): SchedulerControlPlanSource` —
write set `.orca-review/findings.json` + `.decisions/**`, `requiredChecks = [validatorCommand(from, to)]`, denylist =
union of the range groups' contract `denylistPaths`, `tokenBudget = budgetTokens`, same input ⇒ same bytes).
`validatorCommand` = `node '<ORCA_ROOT>/dist/control/validateFindings.js' .orca-review/findings.json <from> <to>`,
`ORCA_ROOT` resolved as `src/panel/chains.ts:21`. Tests `tests/control/modelReviewFindings.test.ts`,
`tests/control/modelReviewPlan.test.ts`.

- [ ] Step 1: failing tests (criterion 7): must-keep set; must-drop: out-of-range group, path the group did not change,
  line past EOF, one-sided evidence; `range` mismatch ⇒ schema-level error. Plan: two builds byte-equal; write set
  exactly the two paths; validator path ends `dist/control/validateFindings.js` and `src/control/validateFindings.ts`
  exists; `validateFindings.ts` run via `tsx` on a fixture exits 0 / 1. Inputs: modes 0700/0600; over-long item cut
  and recorded.
- [ ] Step 2: red. Step 3: implement. Step 4: `npm test` green.
- [ ] Mutations: accept refs outside the range ⇒ red; accept one-sided ⇒ red; write set `**` ⇒ red.
- [ ] Commit `feat(model-review): findings schema and validation, validator entry, inputs and plan builder`.

### Task 9: Model-review run lifecycle

**Files:** `src/control/checks/pass.ts` (model-review handler: range cut to `maxGroupsPerReview` oldest first;
`runSeq += 1`; open), `src/control/systemDebug.ts:161-198` (`applySystemDebugOpen` branches on the source kind: review
⇒ `buildModelReviewPlanSource`, denylist pre-check ⇒ `findings-path-denied` (not opened), integration forced keep
(`delete body.integration`), stripped import), `src/control/planImport.ts:288-330` (option `stripped: {workTokens}`:
task work tokens = limit tokens = `budgetTokens`, non-token dimensions from `TASK_WORK`, handoff and goal-review
allocations **present with zero amounts** — `webProtocol.ts:561,564` require them — and zero reserve),
`src/control/webService.ts:698-787` (`systemDebugPass`: auto-confirm a review with the newest confirmed group in the
repository (none ⇒ settle `errored: no-profiles`), a finding fix with the newest involved group; a `model-review`
branch before `anyTaskFailed` maps the group to exactly one end per spec §6.1 and then reads findings, runs the
read-only check `git diff --name-only <H> <attemptCommit>`, validates, routes (major ⇒ `sysfinding-` group + red flag
`model-review:<reviewGroupId>:<findingId>`; empty check union ⇒ flag only + `no-checks: fix not opened`; minor ⇒ minor
flag), writes the review record artifact (`writeCanonicalRecord`, `src/control/snapshot.ts:83`), and moves the
watermark in the settle transaction), `src/control/orchestration.ts:92-99,183` (review groups admitted last;
finding groups first with other debug groups), `src/control/driverLanding.ts:178-190` and `criteriaReview.ts:49-51`
(skip review groups). Budget end: `errored: budget` when the terminal's `tokenBudgetRemaining` (or attempts/time) is
0 — read with `readLoopState` (`driverLanding.ts:392`) if the loop dir survives to settlement, else persist it on the
drive record at collection (`ccloopPort.ts:277`); measure which first and record it — or a claim/continuation refused
`group-budget-unavailable` before any `succeeded` run. Read route `GET /api/control/checks/reviews/:reviewGroupId`;
registry `check findings [<review>]`. **Before coding the input location:** read `~/.orca/agents.json` (static, no
run) and record in the ledger whether each installed kind reads outside its worktree; ccloop creates the worktree and
a linked worktree's `info/exclude` is the target repo's shared one, so the in-worktree fallback of spec §6.2 is used
only if a kind cannot read the runs root. Test `tests/control/modelReviewE2E.test.ts` on
`tests/control/fixtures/driverHarness.ts` (synthetic ccloop over a real repo, scripted files per task id, as
`criteriaReview.test.ts:25-50`; no paid run).

- [ ] Step 1: failing tests (criterion 8): the pump first initialises `W` = target head on an empty range; 3 groups land,
  two overlapping; after faked 7 days exactly one `sysreview-` group opened as `orca-auto`; profiles from the newest
  confirmed group; goal-review and handoff allocations zero; work grant tokens = limit tokens = `budgetTokens`; the
  facts name an existing input dir whose `index.json` sha256 is on the mark; the fake reviewer writes one valid major,
  one valid minor, one invalid ⇒ one `sysfinding-` group, one red and one minor flag with `involvedGroupIds`, both on the
  involved groups' views, one dropped record; `W = H`; a landing during the review is not delayed. One case each:
  extra file ⇒ `not-read-only`, `W` unchanged, streak 1; `tokenBudgetRemaining: 0` ⇒ `budget`; claim refused for limit
  ⇒ `budget`; archived; stopped; `blocked_waiting_human`; other refused claim; not admitted in 24 h (faked clock) ⇒
  `not-admitted` and archived as `orca-auto`; no confirmed group ⇒ `no-profiles`; denied path ⇒ `findings-path-denied`;
  empty check union ⇒ flag, no group; errored review then trigger on the same range ⇒ a new group (new `runSeq`), the
  errored one untouched; cut range ⇒ `W` = last included group's commit.
- [ ] Step 2: red. Step 3: implement. Step 4: `npm test > $LOGS/t9.log 2>&1` green.
- [ ] Mutations: remove the post-run path check; route minor like major; let the review fold or land; give the
  goal-review allocation `GOAL_REVIEW`; grant `TASK_WORK` tokens; derive budget from `exhausted` alone; drop the
  refused-claim → budget mapping; drop the 24 h timeout; skip the denylist check; open a group with an empty check list
  — each ⇒ red.
- [ ] Commit `feat(model-review): read-only review run, findings routing, watermark on completion`.

### Task 10: Web UI

**Files:** Create `web/src/ChecksSettings.tsx` (one component, `scope: "global" | {repoId}`: per kind enabled, trigger
form generated from the closed condition set, command, budget, groups per review, source badge per field, "locked",
override / reset to inherited, watermark, last run, streak / paused + Resume, next 3 slots, Run now, the `no-profiles`
hint; scheduled list with cron field and preview; locks for the owner in global scope), `web/src/ReviewDetail.tsx`.
Modify `web/src/OrchestrationSettings.tsx` / `GlobalSettings.tsx:43` (global), `web/src/ProjectSettings.tsx:32-34`
(replaces `IntegrationCheck`; delete `web/src/IntegrationCheck.tsx`), `web/src/BoardView.tsx:58` (review-finding badge,
major red / minor grey; review group shown as a system card), Decisions list Dismiss with note
(`web/src/controlApi.ts:378,456` ratify sends the **review group**), `web/src/AgentSettings.tsx:35-54` (`review` slot),
`web/src/locales/{en,zh}.ts` (`settings.integrationCheck` → `settings.checks`), `web/src/controlApi.ts` (new sends and
reads). Test `web/tests/checksSettings.test.tsx`; `web/tests/integrationCheck.test.tsx` removed (its cases move here).

- [ ] Step 1: failing tests (criterion 11): source badges, "locked", Run now, Resume, `no-profiles` hint; card badge on
  an involved group; Dismiss posts `ratify-flagged-decision` to `/groups/<reviewGroup>/decisions/ratify` with the note.
- [ ] Step 2: red. Step 3: implement. Step 4: `npm test` green (web selection printed).
- [ ] Mutations: render the global value's badge as `project` ⇒ red; ratify to the clicked card's group ⇒ red.
- [ ] Commit `feat(web): checks settings, review detail, finding badges, dismiss with note`.

### Task 11: Selection assertion, spec pointer, final gate (controller)

**Files:** Create `scripts/assert-selected.mjs` (reads a `npm test` log; selected = lines matching
`^  (root|web) (\S+) <- ` as printed by `scripts/test-affected.mjs:235`; exits 1 naming each missing path). Append a
one-paragraph section to `docs/superpowers/specs/2026-10-20-kanban-and-group-orchestration-design.md` pointing §7 to
the checks spec (history unchanged, Rule 13).

- [ ] Rebase on `main`. Criterion 1, one command: `npm test > $LOGS/final.log 2>&1; rc=$?; node scripts/assert-selected.mjs
  $LOGS/final.log tests/control/checkCron.test.ts tests/control/checkTriggers.test.ts tests/control/checkWatermark.test.ts
  tests/control/checkSettings.test.ts tests/control/checkStateMigration.test.ts tests/control/modelReviewSchema.test.ts
  tests/control/modelReviewFindings.test.ts tests/control/modelReviewPlan.test.ts tests/control/modelReviewE2E.test.ts
  tests/control/checkAccess.test.ts tests/control/removedVerb.test.ts web/tests/checksSettings.test.tsx > $LOGS/assert.log
  2>&1 || exit 1; exit $rc` ⇒ 0. Read both logs whole; record counts and skipped verbatim; re-run a red file singly per
  `docs/handoff/known-load-flakes.md` before calling it a regression. Mutation: drop one path from the log ⇒ exit 1.
- [ ] `git merge --ff-only <branch>` into `main`.
- [ ] `node dist/cli.js panel stop > $LOGS/stop.log 2>&1` (old build), then **one control-DB backup** before anything
  opens the DB with new code:
  `B=~/.orca/backups/schema16-cutover-$(node -e 'process.stdout.write(String(Date.now()))'); mkdir -m 700 "$B";
  sqlite3 'file:/Users/biran/.orca/control/panel/control.sqlite?mode=ro' ".backup '$B/control.sqlite'" > $LOGS/backup.log 2>&1;
  chmod 600 "$B/control.sqlite"; sqlite3 "$B/control.sqlite" 'PRAGMA integrity_check;' > $LOGS/integrity.log 2>&1`
  ⇒ `ok`; row counts of every table of source and backup (`SELECT name FROM sqlite_master WHERE type='table'`, then
  `SELECT count(*)` each, source opened `?mode=ro`) written to `$LOGS/rowcounts-{src,bak}.txt` and `diff` ⇒ 0 bytes;
  `stat -f '%Lp' "$B" "$B/control.sqlite"` ⇒ `700`, `600`. Record path, counts and `schemaVersion` (15) in the ledger.
  Path and `sqlite3` binary (`command -v sqlite3`) re-measured at that moment.
- [ ] Main tree: `npm run build > $LOGS/build.log 2>&1` and `npm run build --workspace web > $LOGS/web-build.log 2>&1`,
  both 0; `node dist/cli.js panel start > $LOGS/start.log 2>&1`; `node dist/cli.js status --json > $LOGS/status.json` 0;
  read `meta.schemaVersion` (`?mode=ro`) ⇒ `16`; row counts of the pre-existing tables equal the backup's except
  `repository_settings` bodies (same count) and new `check_state` (0 until the first pump evaluation).
- [ ] Push is the human's: list it in `awaitingHuman`. Handoff: schema 16 is one-way; rollback = the backup above.

## Criteria expected to change (each a ledger `Ruling:` line)

| File (lines at `1597680a`; re-measure after CLI v2) | Why | Task |
|---|---|---|
| `tests/control/schema10.test.ts:13,14,29,42,59`, `schema8.test.ts:45,60,111`, `schema9.test.ts:34,35,62`, `commandClient.test.ts:46,64`, `requirementRecords.test.ts:29`, `agentUpdates.test.ts:258`, `tokenPolicyMigration.test.ts:11,24`, `shutdownHealing.test.ts:131` | `schemaVersion` "15" → "16" | 2 |
| `tests/panel/integrationApi.test.ts:56,60` | `integrationCheck` leaves the repository integration read (moves to `/checks`) | 3 |
| `tests/control/archiveGroup.test.ts:174` (`NOT_GROUP`), `tests/entry/skill.test.ts:36` (or its CLI v2 successor), CLI v2 `tests/panel/accessMatrix.test.ts` `set-integration-check` rows, `web/tests/integrationCheck.test.tsx` | verb removed; replaced by `set-check-settings` | 4 |
| `tests/control/integrationCheck.test.ts:47-87,124-140` | setter, `meta` state and trigger move to the check model; system groups no longer count (spec §2.3, the one intended behaviour change) | 4, 5 |
| CLI v2 generated references (`skills/orca-control/references/{project,decision,agent}.md`, new `check.md`, `docs/cli.md` section) | regenerated, not hand-edited | 3–9 |

No other existing criterion is expected to change; if one goes red, stop and report (Rule 7).

## Decisions taken here (spec §10 and ambiguities; reversible, recorded in the ledger)

- Access tiers: the table above. Input location: runs root, measured first (Task 9). Review branch kept for audit.
- Changed paths, cron rules, first-slot initialisation, run-now semantics: Tasks 1, 5, 6.
- Cut: one review per start, oldest `maxGroupsPerReview` groups; the remainder waits for its own trigger.
- Pump order: `checksPass` in `integrationCheckPass`'s slot (`controlAssembly.ts:271`); an opened review is confirmed on
  the next `systemDebugPass`.
- Stripped group: zero-amount handoff/goal-review allocations instead of none (protocol requires them).
- Denylist (spec §6.1 step 1): no per-repository denylist exists (`grep -rn denylistPaths src`), so the union of the
  range groups' contract denylists.
- E2E harness: `driverHarness.ts` (spec named `ccloopWorld.ts`; `driverHarness` is the one that scripts files per task
  over a real repository). Web test path `web/tests/` (the selector's `WEB_TEST`, `test-affected.mjs:21`).
- **Paid run: none needed** — spec §9 calls for none (criterion 8 is "no paid run").
