# Issue fixes from the 2026-10-08 local deployment — design

- Date: 2026-10-08
- Author: Orca development session `e34dc963` (Claude)
- Branch: `fix/issues-20261008` (worktree `/Users/biran/code/skills/loop/Orca-issues`), based on `main` at the commit whose
  subject is `Merge branch 'deps/usage-by-model-pin' into feat/integration-schemes`
- Source: the human's issue list from a local deployment (kept outside git by the human's instruction), issues 1, 3, 7,
  8, 10, 15 and 16. Issue 15's root fix is in ccloop: `ccloop/docs/superpowers/specs/2026-10-08-codex-phase-output-hardening-design.md`.
- Human direction (2026-10-08, conversation): fix root causes, choose the globally best design rather than the minimal
  patch. Rulings H1–H7 were proposed by the controller and approved by the human in the conversation.
- Review: one independent subagent review of the first version; its findings and their dispositions are in §10.

## 0. Human rulings

| | Ruling |
|---|---|
| H1 | `targetVersion` stays required on Web import; the refusal must say what is missing and what to write. No default. |
| H2 | A new `retry-task` command: the failed run is settled as failed, the task returns to `ready`, normal dispatch starts a new run. |
| H3 | A new run made by `retry-task` starts from the group branch's current head, not from the failed run's workspace. |
| H4 | Groups are **archived**, never hard-deleted. Archived groups keep every record, refuse new work, and are hidden by default. |
| H5 | Wall-clock activity is recorded by Orca itself in a new `activity` table (approach A). This bumps the control store schema from 8 to 9, one-way. |
| H6 | ccloop may be changed (prompt + schema-aware final-object extraction, no automatic retry); Orca re-pins after the human pushes. |
| H7 | The parts below plus the ccloop spec are the scope; the order is §9. |

## 1. Scope and non-goals

In scope: §2 refusal explanations and plan-import issue lists (issues 1, 10, and the "nothing happened" half of 3);
§3 the shutdown stop-intent lifecycle (issue 3); §4 `retry-task` and keeping ccloop's failure reason (issue 16, and
Orca's side of 15); §5 the activity record and run times (issue 8, feeds §6); §6 group list, archive, and status display
(issues 7, 8); §7 the ccloop re-pin.

Non-goals: issues 2, 4, 5, 6, 9, 11–14 of the list; a server-side "stuck" judgement; a live stream of the model's own
output; hard deletion of groups; automatic retry; activity rows for repository-wide or global commands (spend caps,
calendar, workspace mode, agent preferences, integration scheme, shutdown) — they have no group.

## 2. Refusals that explain themselves (issues 1, 10, part of 3)

### 2.1 Root causes

1. **English shows machine text.** `refusalText` (`web/src/i18n.ts`) returns the server message verbatim when the
   language is not Chinese, so an English user reads `control-plan-rejected:task-control-metadata:a`.
2. **Chinese coverage has holes for codes that reach the browser via views.** `tests/panel/refusalCoverage.test.ts`
   already checks durable, web-made and hand-listed codes against `zhErrors`; the 62 codes without zh text are all
   non-durable (most never reach the browser: `sendMappedControlError` maps them to `control-internal-error`). There is no
   English text at all, and run failure reasons and blocked reasons shown in views have no explanation.
3. **The refusal is global and far from the button.** `web/src/controlState.ts` keeps one global `refusal`
   (its `groupId` is used only for `revision-conflict`), rendered at the bottom of the ControlPanel section; nothing clears
   it after a later command succeeds (`App.tsx`).
4. **Plan import stops at the first problem** and joins items with commas, although `malformed:` items are zod messages
   that can contain commas. `control-metadata` lumps three problems.
5. **Docs omit a required field.** README §5's example and `docs/cli.md` never mention `targetVersion`.

### 2.2 Design

**(a) Explanations in both languages for every code the browser can show.** Each locale gets an `errors` table keyed
by code (zh: today's `zhErrors` extended; en: new). An entry says what happened and, where there is one, what to do next.
Placeholders: `{{message}}`, `{{status}}`, and new `{{detail}}` (the server message after `<code>:`). The raw code stays
on screen beside it (small, monospace).

`refusalText` looks up the current language's entry, else falls back to the server message (unchanged fallback).

The set of codes that must have text in **both** languages is the existing coverage set of
`tests/panel/refusalCoverage.test.ts` (durable catalogue, `WEB_MADE`, `BY_HAND`), plus run failure reasons and blocked
reasons that views display (§4.2(5)). That test is extended: both locales, and its placeholder allowlist gains `detail`.
Internal non-durable codes that never reach the browser get no text (they display as `control-internal-error`).

**(b) Plan-rejection details are a list.** `control-plan-rejected`'s detail becomes items separated by `\n` (a
character a zod message, task id or path in these items cannot contain; task ids are already restricted by the plan
schema — the plan verifies). The web decodes each item:

| Item | Line (English; Chinese mirrors it) |
|---|---|
| `missing-target-version:<task>` | Task `<task>` has no `targetVersion`. Add a positive integer, usually `1`. |
| `target-repo-mismatch` | The plan's `targetRepo` is not this repository. |
| `missing-goal` | The plan has no `goal`. |
| `missing-success-conditions` | The plan has no `successConditions` (at least one). |
| `duplicate-success-condition` | Two success conditions are identical. |
| `duplicate-dependency:<task>` / `dangling-dependency:<task>` | Task `<task>` lists a dependency twice / depends on a task that is not in the plan. |
| `contract-json:<task>` / `contract-shape:<task>` / `contract-canonical:<task>` | Task `<task>`'s contract file is not JSON / does not match the contract format / cannot be canonicalised. |
| `malformed:<path>: <msg>` | `<path>`: `<msg>` |
| anything else | the item verbatim |

**(c) Plan import reports every problem it can see in one pass.** Stage 1 is `loadPlan`'s schema check; if it rejects,
its issues are the whole list (there is no plan object to check further). Otherwise stage 2 collects, in this order,
plan-level items (`target-repo-mismatch`, `missing-goal`, `missing-success-conditions`, `duplicate-success-condition`),
then per task in plan order (`duplicate-dependency`, `dangling-dependency`, `missing-target-version`, then the task's
contract items from `parseContract`). Only if stage 2 found nothing does import continue. `normalizeControlPlan`'s
later refusals (`planImport.ts`) and the codes-only refusals in `service.ts` are unchanged and remain single items. A plan
with one problem produces exactly one item: error code and HTTP status are unchanged.

The requirement split validator (`requirementSplit.ts`), which wraps the detail as `import:${detail}`, pushes one
reason per item (`import:<item>`), so the model's feedback stays one problem per line.

**(d) Refusals are shown where the person acted.**
- Web state keeps `refusals: Record<groupId, ControlRefusal>` plus one `importRefusal` and one `panelRefusal` (non-group,
  non-import). A command's refusal is stored under its group; a later **successful** command for that group clears it;
  switching groups does not clear another group's refusal.
- The group view renders its refusal at the top, above the action buttons: explanation, decoded list, raw code.
- Import refusals (including `control-plan-rejected`) render inside the import form, with the decoded list.
- The bottom-of-panel line remains only for `panelRefusal`.

**(e) Documentation.** README §5's example gains `"targetVersion": 1`; README and `docs/cli.md` list the Web-import
requirements in one place: `targetRepo` equals the repository, `goal`, at least one `successConditions`, every task has a
positive-integer `targetVersion`, no duplicate or dangling dependencies, contract files valid.

### 2.3 Criteria

- Extended coverage test: both locales cover the coverage set; mutation: delete one en entry ⇒ red; delete one zh entry ⇒ red.
- A plan with `target-repo-mismatch`, `missing-goal`, `missing-success-conditions`, `missing-target-version:a` and
  `dangling-dependency:b` ⇒ one refusal with exactly those five items in that order (mutation: early return restored ⇒
  one item ⇒ red). A `malformed:` item whose zod message contains a comma survives intact.
- Split validator: a two-problem detail ⇒ two `import:` reasons.
- Web: the import form shows the decoded list (en and zh); a group refusal renders in that group's view and is cleared by a
  later successful command for the same group but not by one for another group.
- Existing criteria rewritten (named in the plan): those pinning `task-control-metadata`/`control-metadata`
  (including `tests/control/requirementSplit.test.ts`'s `import:control-metadata`), and the refusal-reducer criteria that
  assume one global refusal.

## 3. Shutdown stop-intent lifecycle (issue 3)

### 3.1 Root cause

Web spec `2026-09-19-web-recoverable-control-design.md` §6.4 step 3 requires that "for a dispatch-enabled group with
no active run, [shutdown] persists a shutdown stop intent so no claim can begin during drain", and says such a group
"after restart uses an empty `resume-from-handoff` followed by an explicit `start`". The panel never rendered that exit
for `stopMode === "shutdown"` (handoff delivery plan, gap `D-RESUME-SHUTDOWN`), so after a restart every idle,
non-driver-owned group refuses `start` with `stop-mode-conflict` and no button helps.

The durable row protects nothing: §6.4 step 1 closes an in-memory admission gate that refuses every mutation and every
scheduler claim during drain, and `replenishStartWakes`/`deliverScheduledStart` are already blocked while draining. The
row's only lasting effect is the dead end. The scan also covers groups whose work is all done, contrary to §6.4 step 2's
"every nonterminal group".

### 3.2 Design

**Invariant S1:** a persisted `shutdown` stop intent exists only when the shutdown froze at least one active run
(including strengthening a pause because a run was active).

1. **Shutdown writes no intent for idle groups.** In `shutdownGroup` (`src/panel/controlLifecycle.ts`), dispositions are
   decided in this order: existing handoff/shutdown intent ⇒ preserved (unchanged); pause with no active run ⇒
   preserved pause (unchanged); driver-owned ⇒ `skipped-driver-owned` (unchanged, existing wire value); **no active run ⇒
   new disposition `unchanged-idle`** (no stop intent, no `stopped` change, no revision or projection change, still listed
   in the global result); otherwise frozen as today. A group whose work is all done has no active run and so is
   `unchanged-idle`.
   `unchanged-idle` is added to the shutdown result enum (`webProtocol.ts`), `web/src/controlTypes.ts`, and the parity test.
   Consequence, stated plainly: after a restart, an idle non-driver group is not stopped; the person presses Start as for
   any ready group, with no resume step first. Driver-owned groups behave exactly as today.
2. **Recovery heals stale rows.** In panel startup recovery (`recoverControl`, `src/control/recovery.ts`), in its own
   transaction **before** `deliverSchedulerWakes`: delete every `shutdown` intent whose `frozenRunIds` is empty, set that
   group's `stopped = false`, record one projection change per healed group, do **not** advance the command revision
   (recovery changes projection state, not command revision), and write an activity row `stop-cleared` with
   `{reason: "empty-shutdown-intent"}` (§5; so §5 lands before this step). An empty frozen set has no requests or
   outboxes, so crash-after-commit redelivery of a real shutdown is unaffected. This repairs stores written by older Orca
   versions on their first start after upgrade.
3. **The exit from a real shutdown is rendered.** A group whose stop mode is `shutdown` and stop state
   `handoff-complete` gets the same resume dialog as a human handoff-stop; `ControlGroupView`'s `handoffActive` covers
   both modes.
4. **A stop banner explains the state.** With any stop intent, the top of the group view shows one banner: how it
   stopped (pause / handoff-stop / panel shutdown), the stop state (`stopping` = frozen runs still settling,
   `handoff-complete` = ready to resume), and the one action that leaves it. Buttons the current stop mode refuses are not
   rendered.

### 3.3 Published-text corrections

Appended (original text untouched) as named ERRATUM sections:
- web spec, after its last ERRATUM: §6.4 step 3's idle-group clause and the "ready group with no active run … empty
  `resume-from-handoff` followed by an explicit `start`" sentence are superseded by S1 and §3.2 of this spec.
- `docs/superpowers/plans/2026-09-25-handoff-delivery.md`: gap `D-RESUME-SHUTDOWN` is closed by §3.2 (3).

### 3.4 Criteria

- An idle ready group, a never-started group with a driver, and an all-done group each get `unchanged-idle`: no
  `stop_intents` row, `stopped` unchanged, revision unchanged, listed in the shutdown result.
- A running group is frozen exactly as today; a paused idle group stays paused; a paused group with an active run is
  strengthened; a driver-owned group is `skipped-driver-owned` (unchanged criteria survive).
- Recovery on a store holding an empty-frozen-set shutdown intent deletes it, clears `stopped`, keeps the revision,
  advances the projection once, writes one `stop-cleared` row; a following `start` succeeds. A non-empty one is untouched.
- Web: a `shutdown`/`handoff-complete` group renders the resume dialog and no Start/Pause/Handoff-stop buttons.
- Existing criteria rewritten (names in the plan): `tests/panel/controlLifecycle.test.ts` "gives a ready group an empty
  frozen set that completes, so restart can resume and start" and the idle half of "commits one global command and leaves
  unchanged groups out of the command ledger and projection"; `tests/panel/shutdownDriverGroup.test.ts` the idle half of
  "freezes a started group exactly as before when no driver exists, idle or running" and "freezes a group that was never
  started even when a driver exists: it is not the driver's yet"; `tests/control/webFaults.test.ts` "applies a
  cross-group shutdown to every group or to none, and an epoch replays it once" if its groups are idle (the plan
  verifies).

## 4. Retrying a failed task, and keeping the failure reason (issue 16, Orca side of 15)

### 4.1 Root causes

1. A run whose ccloop run ended with an outcome other than `succeeded` is blocked at driver step C with reason
   `terminal:<outcome>`. It keeps `active = 1`, its work item stays `running` (displayed `active`), its budget remainder is
   never released. `recovery-retry` sends it back to step C, which collects the same terminal report and blocks again.
   Execution driver spec §2.3 says "no new human commands", so there is no way to try the task again.
2. Orca drops ccloop's reason: `src/control/ccloopPort.ts` keeps `terminal.stopReason` only when it contains
   `codex-skills-`, so `codex-result-invalid` (issue 15) never reaches the store or the UI.

### 4.2 Design

**(1) Keep the reason.** The port keeps `terminal.stopReason` for every terminal report (bounded: first 500 UTF-16
units, stored as-is otherwise). The drive record gains optional `stopReason` (the drive schema is `.strict()`, so the
field is added to it; the v9 bump means an older Orca never reads it). The run view exposes it; §2.2(a)'s tables explain
the common ccloop reasons: `codex-result-invalid` ("the model did not answer in the required JSON format"),
`codex-events-invalid`, `codex-no-completion`, `codex-usage-invalid`, `codex-usage-unavailable`, `codex-event-error`,
`codex-timeout`, the `codex-skills-*` family, and exhaustion/cancellation outcomes. The reason is matched by its prefix
up to the first `:` (the rest is an evidence path).

**(2) New command `retry-task`** (Web verb, access `any` like `continue-task` and `recovery-retry`; group target,
payload `{ taskId }`).

Preconditions (each refusal has a code and an explanation):
- group not clarifying, not archived, no stop intent, not `stopped` (`group-state-invalid` / `group-archived` /
  `stop-mode-conflict`);
- the task's current run (`work.currentRunId`) is `active`, state `blocked`, `drive.blockedAt === "C"`, and
  `drive.outcome` set and not `succeeded` — this includes `codex-skills-*` failures, which also set an outcome;
  otherwise `task-not-retryable` (409) with a detail naming the run state;
- no open handoff request on the run, no unknown usage, no pending usage events (the `releaseRunReserve` preconditions);
  otherwise `task-not-retryable` with the detail;
- the reserve covers the new run: the task's current grant (`work.grant`, work + handoff dimensions; after a
  continuation this is the continuation's grant, unchanged by retry) must be available after releasing the failed run's
  remainder. The net new reservation per dimension is `grant − failedRun.remaining`; if the group's unallocated reserve
  is short, `group-reserve-insufficient` (existing code) with `<dimension>:<shortfall>`, and the explanation points at the
  budget editor.

Effect, in one store transaction:
1. The failed run moves to new run state **`settled-failed`**, `active = 0`; its booked usage stays; its remainder is
   released (`releaseCommitment`) and the net amount above re-reserved, so the allocation stays `confirmed` at its
   grant (snapshot identity unchanged).
2. The work item returns to `ready`. **`currentRunId` stays on the settled-failed run** until the next claim replaces it
   (the pattern of `settleProviderAttempt` and `settled-restartable`; the view requires `currentRunId` to be the last run
   row).
3. The run's `drive.cleanedUp` is set `false` (existing field) so the driver cleans it up.
4. The group's command revision advances; activity rows `run-settled` and `task-retried` are written.

The execution driver's `driverRunIds` also visits `settled-failed` runs with `cleanedUp === false`: it archives the
run's evidence (`archiveRun`, the saved terminal report is the stop proof) and removes its workspace
(`cleanupRunWorkspace`), then sets `cleanedUp = true`; a failure is recorded in the existing `drive.cleanupError` and
retried next round. It never blocks the new run (workspaces are per run).

Normal dispatch claims the `ready` task (`nextClaimableTask`), creating a new run from the group branch's current head.
The task's run number shown in the UI is the count of its runs that reached the provider (lineage runs whose state is
not `failed-before-provider`).

**(3) `recovery-retry` on a terminally failed run is refused** with the new code `run-terminal-failed` (409), whose
explanation says to use "Retry task". A transiently blocked run behaves as today.

**(4) `settled-failed` in every reader.** Added to: the stored run state and `persistedRunSchema`
(`src/panel/controlViews.ts`), `displayRunState` (exhaustive switch), the view's terminal-state list used by the
`active ⇔ non-terminal` check, `isTerminalRunState` (`src/control/budget.ts`), `STOPPED_STATES`
(`src/control/singleCallLedger.ts`), `runViewSchema` and the run-state enums in `src/control/webProtocol.ts`,
`web/src/controlTypes.ts`, and the en/zh `runState` labels. The plan re-greps for any reader not listed here.

**(5) UI.** In the runs table and task detail:
- a blocked run whose `drive.outcome` is set and not `succeeded` shows its explained failure reason and **"Retry task"**;
- any other blocked run shows its explained blocked reason and "Retry run" (`recovery-retry`);
- `settled-failed` runs show their failure reason and no button.

### 4.3 Published-text correction

Appended ERRATUM in `docs/superpowers/specs/2026-09-25-execution-driver-design.md`: §2.3's "no new human commands" is
amended by H2 (`retry-task`, run state `settled-failed`).

### 4.4 Criteria

- Fake ccloop run ending `failed` with stop reason `codex-result-invalid: <dir>`: the drive record and the run view carry
  the reason; the web explains it.
- `retry-task` ⇒ run `settled-failed`, `active = 0`, remainder released and net re-reserved, work `ready`,
  `currentRunId` unchanged, **the group view reads without error immediately after**; the driver then claims a new run;
  the UI run number is 2; the new run can succeed.
- Driver cleanup archives and removes the old workspace; a cleanup failure is recorded and does not stop the new run.
- Refusals: transiently blocked run, healthy active run, stopped group, archived group, insufficient reserve (exact
  dimension and shortfall). Each red when its guard is deleted.
- `recovery-retry` on a terminally failed run ⇒ `run-terminal-failed`; on a transiently blocked run, unchanged.
- A view containing a `settled-failed` run renders (no `run-state:` failure).
- Web: the right button per blocked run.

## 5. Activity record and run times (issue 8; feeds §6)

### 5.1 Root cause

The control store records almost no wall-clock time: runs have no started/ended time, the command ledger has no
timestamps, groups have no last-activity time, and the store has no clock. ccloop's own `events.jsonl` is removed with
the run directory after cleanup.

### 5.2 Design

**Clock:** the control store takes an injectable `now: () => number` (ms since epoch), default `Date.now`; tests pass a
fixed clock.

**Run times on the run body:** runs gain optional `startedAt` (set when A1 reserves the first provider attempt) and
`endedAt` (set when the run reaches a settled or landed state, or `settled-failed`), both ms. They are part of the run
body, so retention below never loses them. Runs written before v9 have neither; the UI shows "—".

**Schema v9** (`src/control/migrations.ts`): one new table, in the repo's table style.

```sql
CREATE TABLE activity (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL REFERENCES groups(id),
  task_id TEXT,
  run_id TEXT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL
) STRICT;
CREATE INDEX activity_group_seq ON activity(group_id, seq);
CREATE INDEX activity_run_seq ON activity(run_id, seq);
```

`schemaVersion` becomes `"9"`; the store's open allowlist accepts `"8"` (migrates) and `"9"`; `migrateSchema` chains
every older version through 8 to 9. An older Orca refuses a v9 store with `control-schema-unsupported` (one-way, as
v7→v8 was); README notes it.

**Writer:** `recordActivity(store, row)` called inside the transaction that makes the change, so a row exists if and
only if its change committed. A replayed (idempotent) command writes nothing. Group-scoped kinds only:

| Kind | Written when | Body |
|---|---|---|
| `command` | a group-targeted Web or agent command is first accepted | `{verb, actor}` |
| `run-claimed` | a claim creates a run | `{claimOrdinal}` |
| `run-started` | A1 reserves a provider attempt | `{providerAttemptOrdinal}` |
| `phase` | a collect stores progress whose `step` or `attempt` differs from the stored one | `{step, attempt}` |
| `run-blocked` | a driver run enters `blocked` | `{blockedAt, reason}` |
| `run-resumed` | a blocked run is resumed by `recovery-retry` | `{}` |
| `run-settled` | a run reaches a settled/landed state or `settled-failed` | `{state, outcome, stopReason?}` |
| `task-retried` | `retry-task` | `{fromRunId}` |
| `integration` | the integration pass records a result | `{state, reason}` |
| `stop` / `stop-cleared` | a group stop intent is created / removed (including §3.2 healing) | `{mode}` / `{reason}` |
| `archived` / `unarchived` | §6.3 | `{}` |

One change may write more than one row (`retry-task` writes `run-settled` and `task-retried`).

**Retention:** after each insert, rows of that group beyond the newest 500 are deleted in the same transaction. Run
times live on the run body, so retention only shortens the feed.

**Reads:**
- group view: `activity`, newest 50 rows of the group (newest first);
- run view: `startedAt`, `endedAt`, `lastActivityAt` (newest row of the run);
- group summary: `updatedAt` = `at` of the group's newest row (by `seq`);
- new route `GET /api/control/runs/:runId/activity`: the run's newest 200 rows, with the same project-scope and
  authentication checks as `GET /api/control/runs/:runId/evidence`, and a parity entry.

**Change notification:** the plan verifies, kind by kind, that each writing site's transaction records a projection
change for the group (so the 2-second summary poll refreshes the open group view); where one does not (e.g. a
`saveRun` whose body did not change), the activity insert itself records the projection change.

### 5.3 Criteria

- Migration 8→9 on a populated v8 store keeps every row and adds the table; an unknown version is refused.
- Per kind: the committing change writes its row(s); a rolled-back change writes none (mutation: write outside the
  transaction ⇒ the rollback criterion red); a replayed command writes none.
- Retention keeps exactly the newest 500 of a group and never touches another group's rows.
- `startedAt`/`endedAt` set on the run body at the specified moments with the injected clock; null for pre-v9 runs.
- The run-activity route refuses another project's run.

## 6. Group list, archive and status display (issues 7, 8)

### 6.1 Work-item display categories

One server-side function maps a work item to a display category, used by the summary counts and sent in the view so the
web never re-derives it:

| Category | When |
|---|---|
| `blocked` | the item is `blocked`, or its current run is `blocked` (this includes terminal failures, which today display as `active`), or the item is `held` waiting for a human to continue |
| `running` | the item is `running`/`continuing`/`starting`/`start-unknown` and its current run is not blocked |
| `waiting` | the item is `ready` and some dependency is not done |
| `idle` | `draft`, or `ready` with all dependencies done |
| `done` | `done` |

### 6.2 Group summary additions

`groupSummarySchema` (`src/control/webProtocol.ts`, `.strict()`) gains optional `goal` (plan goal, or the requirement
idea for a clarifying group), `branch` (`orca/<groupId>`), `counts` (`{idle, running, waiting, blocked, done}` per §6.1,
computed in today's `taskCompletion` loop), `updatedAt` (§5), `archived` (boolean). `web/src/controlTypes.ts` and the
parity test follow.

### 6.3 Archive

New Web verbs `archive-group` and `unarchive-group` (access `any`, group target, empty payload).

- Archive is refused, each with its own code and explanation, while: the group has an active run; it has a `handoff` or
  `shutdown` stop intent that is not `handoff-complete`; its integration state is `resolving`; or an estimate or
  requirement call is in flight. A `pause` intent with no active run does **not** block archiving.
- Effect: the group body gains `archived: { at, actor }` (bodies are passthrough; the status enum is not extended);
  `unarchive-group` removes it.
- An archived group refuses **every group-targeted command except `unarchive-group`** with `group-archived`; reads are
  unchanged. The claim and wake paths skip it: `replenishStartWakes`, `deliverScheduledStart`,
  `deliverContinuationWake`, `nextClaimableTask`, and the automatic integration pass's group selection.
- The group list hides archived groups unless the Archived filter is chosen; the group view shows an Archived banner
  with an Unarchive button.

### 6.4 Group list (web)

- Each group is a card; the whole card is the button (border, hover and focus styles): group id and goal; a progress
  bar `done/total`; a status chip; an attention badge; the branch; "updated N minutes ago".
- `groupCategory(summary)` (exported, unit-tested), first match wins:
  1. `archived` ⇒ Archived;
  2. attention ⇒ Needs attention, where attention is `counts.blocked > 0`, `recoveryBlockerCount > 0`, `claimBlocked`,
     state `blocked`, or a stop intent whose state is not `handoff-complete`;
  3. `total > 0 && done === total` ⇒ Done;
  4. `counts.running + counts.waiting > 0`, or state `running`/`review` ⇒ Running;
  5. otherwise ⇒ Not started.
- Filter chips: All (excludes archived) / Not started / Running / Needs attention / Done / Archived. The chosen filter is
  kept per viewer in `localStorage` (reads and writes in try/catch; the page works without it).

### 6.5 Group detail order and the work-items graph

- Order: heading; alerts (claim-blocked, the group's refusal §2.2(d), stop banner §3.2(4), archived banner); **the
  work-items graph**; the work-items table and task detail; runs; budget; agents; integration; skills; estimates;
  actions.
- The graph renders whenever the group has work items, with or without dependency edges.
- Nodes have a filled background by §6.1 category, with a legend; colours are tokens for light and dark themes:
  running green with a slow pulse (none under `prefers-reduced-motion`), waiting amber, blocked red, idle grey, done blue.
- Each node shows the task id and a status word; for a running task, the step and ccloop attempt (`execute · attempt
  2`), the run number when > 1 (`run 2`), and elapsed time since the current run's `startedAt`; when the current run's
  `lastActivityAt` is older than 10 minutes, "no progress for N min" in amber.
- Selecting a node selects the task: the task detail shows the current run's recent activity (run activity route) above
  the existing evidence list.

### 6.6 Criteria

- §6.1 category function: one test per row, including "item `running` with a blocked current run ⇒ `blocked`".
- `groupCategory`: one test per category plus precedence.
- Summary: `counts`, `goal`, `branch`, `updatedAt`, `archived` for a fixture store with mixed tasks.
- Archive: each refusal (red when its guard is deleted); pause-without-run allows it; an archived group refuses `start`
  and `confirm` with `group-archived` and is never claimed or integrated; unarchive restores; activity rows written.
- Web: archived hidden by default; filters; graph with zero edges renders; node classes per category; reduced motion
  disables the pulse; the graph precedes the budget editor in the DOM.

## 7. ccloop re-pin

After the human pushes the ccloop change, Orca re-pins ccloop (`package.json`, `pin-ccloop.mjs` checks) and the gate's
`ORCA_CCLOOP_BIN` moves to a clone build of the new pin. Until then Orca's criteria use the current pin; §4.2(1) does not
depend on the ccloop change (ccloop already reports `stopReason`).

## 8. Cross-cutting

- **Attribution:** commands carry their actor; driver and recovery writes are internal.
- **Languages:** code, comments, spec and ledger in English; Chinese only in `zh.ts` and the handoff.
- **Rule 17:** no criterion writes to the real `~/.orca`; all use temporary control roots.
- **Mutations** only in a `git clone --local` copy under the session scratchpad; the plan names, per task, the mutation
  that deletes each new branch and must be seen red.
- **Existing criteria** rewritten by this work are listed by name in the plan and in the ledger for the human.

## 9. Delivery order (linear)

1. ccloop spec (separate repo; the human pushes).
2. §2 refusals and plan issue lists.
3. §5 clock, run times, activity table, schema v9.
4. §3 shutdown lifecycle (its healing step writes `stop-cleared`).
5. §4 failure reason, `retry-task`, `settled-failed`.
6. §6 categories, summary, archive, list, graph.
7. §7 ccloop re-pin (after the human pushes ccloop).

Gate per the handoff: isolated clone, HOME and the four XDG roots redirected, `ORCA_CCLOOP_BIN` a clone build of the pin
by absolute path, fake codex `integration`; web build, typecheck, `--ws check`, `verify:control`, `verify:panel`, full
`npm test` with only registered load flakes, `check-tmp-leak`.

## 10. Review record

Independent review (subagent, 2026-10-08, same session) of the first version (commit subject
`docs(spec): design root-cause fixes for the 2026-10-08 deployment issues`). The spec was unpublished, so it was revised
in place; dispositions:

- C1 accepted: `currentRunId` is kept on the settled-failed run (§4.2(2) step 2) and a view-after-retry criterion added.
- C2 accepted: every reader of the run-state vocabulary listed (§4.2(4)) and a render criterion added.
- C3 accepted: the port keeps ccloop's `stopReason` and the drive record stores it (§4.2(1)); the Retry-task button keys on
  `drive.outcome`, so `codex-skills-*` failures get it too.
- I1 accepted: per-group refusal state with clear-on-success; import refusals in the import form (§2.2(d)).
- I2 accepted: the existing `refusalCoverage` test is extended to English and to view-shown reasons; `{{detail}}` allowed;
  no text for internal-only codes.
- I3 accepted: `\n` separator; staged collection stated; contract items included; split validator splits reasons; the
  five-problem criterion names compatible problems.
- I4 accepted: `unchanged-idle` added to the strict result enum; ordering with `skipped-driver-owned` stated; healing in
  its own transaction before scheduler wakes; behaviour change stated.
- I5 accepted: net reservation formula over work + handoff; grant is the current `work.grant`; existing `cleanedUp` /
  `cleanupError` reused; run number excludes `failed-before-provider`.
- I6 accepted: §6.1 categories make a task with a blocked current run `blocked` (red, attention).
- I7 accepted: group-scoped kinds only; replay writes nothing; run times on the run body; injectable clock; migration
  chain; `STRICT` and `REFERENCES`.
- I8 accepted: guards match durable integration states; integration pass skips archived; pause without a run allows
  archive; archived refuses every group command except `unarchive-group`; wake paths named.
- Minors accepted: multi-row changes stated; attention defined; `held` is attention; `updatedAt` from the newest row; the
  run-activity route's scope checks; linear delivery order.

## Correction 2026-11-18 — unarchive never starts a group; an archived group reads `archived (was <state>)` (#370)

Recorded by the Track V implementer of plan `docs/superpowers/plans/2026-11-18-tester-batch-d.md` (Task V3), on branch
`fix/batchd-v` over Orca `5220b1c1`. §6.3 above is kept as written; this section amends it.

- **Human ruling (2026-11-18, quoted from `.superpowers/sdd/2026-11-18-tester-pm/progress.md`):** asked
  「unarchive 一个 ready 组时是不是不应该自动开跑？」, the human answered 「同意」: unarchiving a ready group must not start it;
  the queued start is dropped and the receipt says to `orca group start`.
- **What changed.** Until now a start wake queued before the archive stayed pending while the group was archived
  (`deliverScheduledStart` answers `blocked: group-archived` and keeps it) and was delivered on the first pump after
  `unarchive-group` -- so unarchiving a ready group started it. Now `unarchive-group` deletes the group's undelivered
  `start` wakes in its own transaction (deleted, not marked delivered: `replenishStartWakes` re-arms from the last `start`
  row it finds) and its result carries `startDropped: true` when it dropped one; the CLI receipt then reads
  `unarchived <g>; its queued start was dropped -- start it with: orca group start <g>`. A `resume` wake (a continuation
  armed by resume-from-handoff) is not a start and is still delivered after unarchive, as before. Archiving itself is
  unchanged.
- **Recovery list.** `deferredWakes` no longer lists an archived group's `start` wakes (under any reason): they are never
  delivered. Its `resume` wakes are still listed.
- **Display.** The summary's `state` is unchanged for an archived group (no status enum change, ruling H4); the CLI
  `group list` and the Web card read `archived (was <state>)` for it, and the CLI lists archived groups last (they are
  still listed by default, Issue 151). `orca status` still excludes archived groups (#222).
- **Not covered (left for the human).** A group already started -- an earlier `start` wake was delivered -- that is
  archived between claims is still re-armed by `replenishStartWakes` after unarchive when a task is claimable, and so
  continues. Changing that needs a stored mark or a change to the replenish rule; the ruling named the queued start only.

## Correction 2026-11-18 (second) — unarchive pauses a group that would run; the derived `running` (#370 review)

Recorded by the Track V fix-wave implementer, on branch `fix/batchd-v` over `75f22709` (the section above is kept as
written; this one replaces its mechanism and corrects two of its claims). An independent review of the section above found
the deletion incomplete; the controller decided the replacement.

- **What the review found.** (C1) Deleting the undelivered `start` wakes missed a queued `no-start` re-arm
  (`settleProviderAttempt` writes one; `webDispatch.ts` `pendingStartWake` claims from `start` and `no-start` alike), so a
  group with one still started on unarchive. (C2) The case the section above left uncovered -- a group started before
  the archive, re-armed by `replenishStartWakes` from its earlier `start` row once a task is claimable -- also starts it,
  against the ruling.
- **Controller decision: pause, not delete.** `unarchive-group` now writes the same pause intent `pause-dispatch` writes
  (stop intent `pause`, `stopped: true`, a `stop` activity row) when the group would otherwise run on its own: a status of
  `ready`/`running`/`review`, a confirmed proposal, no stop intent already, not a flow run's child, and either an
  undelivered `start`/`no-start`/`resume` wake or an earlier `start` row with a claimable task (`archiveGroup.ts`
  `wouldRunOnUnarchive`). No wake is deleted; the pause holds them (`deliverScheduledStart` answers
  `blocked: group-stopped`, `replenishStartWakes` skips a group with a stop intent) and `orca group resume` lets the group
  run, started or never started, as any resume does. A done, draft or clarifying group, or one already paused, is left as
  it was. The result field is `paused: true` (it replaces `startDropped`); the CLI receipt reads
  `unarchived <g>; paused so it does not run on its own -- let it run with: orca group resume <g>`. The section above's
  "a `resume` wake is still delivered after unarchive" no longer holds: it waits for the resume too.
- **Recovery list.** `deferredWakes` leaves out an archived group's `start` and `no-start` wakes alike (the unarchive does
  not start the group); its `resume` wakes are still listed.
- **Correction to the Display claim above.** "The summary's `state` is unchanged for an archived group" was not true on
  the branch: the derived `running` (Track V2, #361) also came from `executionPending`, so an archived group with a queued
  start read `running` (and `archived (was running)`). The derivation now reads tasks under way only (`counts.running` or
  `counts.settling` above zero); a start queued with nothing claimed keeps the stored word, and `executionPending` says the
  start is queued. Every `archived (was <state>)` label (CLI `group list`, the Web card, the Board card, the group page's
  heading) reads `storedState ?? state`.

## Correction (2026-11-18, tester batch D, task D1 — #360, #364 a)

Who / when / base: Track D implementer subagent (Claude Opus 5.5) of the Orca session running plan
`docs/superpowers/plans/2026-11-18-tester-batch-d.md`, 2026-11-18, on `5220b1c1`. Source: triage
`.superpowers/sdd/2026-11-18-tester-pm/g2-runs-settle-storage.md` (#360, #364). The paragraph of §4.2(2) beginning
"The execution driver's `driverRunIds` also visits `settled-failed` runs" stays as written; it is corrected here.

1. "the saved terminal report is the stop proof" assumed every settled-failed run has a saved `report:<runId>`. It does
   not, and the driver threw `control-terminal-pending` on such a run every round, for ever. Which path produced the
   tester's run is **unverified** (not reproduced from the tester's store). The likely producer: a held run -- stopped by
   a handoff, holding a candidate but no terminal report -- retried by `task retry` (`retryTask.ts`, the
   `saveRunBody(... "settled-failed" ...)` for a run neither released, closed nor abandoned). A run blocked at A2, B or B′
   is not one: `task retry` refuses it (`blocked-at:`). Now, with no saved report:
   - ccloop never accepted the run (`executionId === null`) ⇒ it is archived with `stopProof: null` (the archive records
     `missing: ["stop-unconfirmed"]`; skipped when ccloop left no `<sourceDir>/repo`), its workspace is removed and
     `cleanedUp = true`;
   - ccloop accepted it ⇒ only a stop proof at collect whose `executionId` and `generation` are the run's proves it
     stopped (a terminal alone does not: ccloop writes it before its worker is proved gone). With one, the proof's
     artifact is stored and the run is archived with it, its workspace removed and `cleanedUp = true`; a missing
     `<sourceDir>/repo` is then not skipped -- the archive fails and the round records it in `cleanupError`;
   - otherwise ccloop may still be running an agent in that workspace ⇒ the workspace is **kept**, `cleanupError` is set to
     `cleanup-awaiting-stop`, one stderr line is written when it is first set, and ccloop is asked again after
     `CLEANUP_AWAITING_STOP_RECHECK_MS` (60 s; in memory, so a restarted driver asks at once).
   (Revised by the batch-D review fix wave, 2026-11-18, before this branch merged; the first wording counted a terminal as
   a stop, archived with `stopProof: null` in every case and blamed A2/B/B′ blocks.)
2. "a failure is recorded in the existing `drive.cleanupError` and retried next round" stands; the stderr line for a
   settled or settled-failed run's step failure is now written only when its `cleanupError` changes.
3. An artifact publication's temp file in `<stateDir>/staging/` is removed when the publication fails (a copy, an open or
   an fsync that threw), not only when it is renamed into place (`archive.ts` `withTemp`). Start-up cleanup of entries
   left by a killed panel (#364 b) is not part of this correction.

## Correction (2026-11-19, change-sized runs P0) — §4.2(2)

Who/when: the change-sized runs P0 implementer (Claude Opus 5.5, a subagent of the Orca control session), 2026-11-19, on branch `feat/change-sized-p0` from `main` `9bc6e304`. The original text above is kept verbatim (Rule 13).

`stepCleanupFailed` no longer archives unconditionally: it archives only when no archive row records the run (a failed
terminal is archived at step C; a recovery-mode run is not, and is archived here). Then it removes the workspace and the
extras' workspaces, then the result copy `<sourceDir>/repo` (`removeResultCopies`, `repos/` kept), and writes
`cleanedUp: true` last, so a crash after the removal resumes without reading the removed copy. Commit `c55c1e44`
(`fix(control): a settled run's result copy goes once its archive holds it, and a failed run's cleanup resumes without
re-archiving (#363 #366 P0, review I1)`). Design: `2026-11-19-change-sized-runs-design.md` §5.6.

## Correction 2026-11-19 — closed: the terminal mark's second kind; list chip counts and multi-select (#355, #357)

Recorded by the f-closed implementer (Orca session subagent, branch `feat/f-closed` over `dd799bb4`; the server half is
commit `3ae0381e`). The sections above are kept as written; this one extends §6.3 and §6.4. Human rulings: #355
「同意该方案，同意允许互转」 (one terminal mark, close only on done groups, unclose/unarchive remove it, conversion both ways);
#92 「同意」 (no generic batch on the Board; the list gets multi-select with bulk archive/close; no bulk retry).

- **§6.3 — the mark.** `archived: { at, actor }` gains an optional `kind: "closed"` (`archivedMark.ts`; the schema stays
  `.strict()`). A mark without `kind` is archived; existing marks are not rewritten (no backfill). The status enum is not
  extended (H4 holds): a closed group's status stays `done`.
- **§6.3 — verbs.** `close-group` (any principal, empty payload, `POST groups/:id/close`) writes the closed mark on a group
  whose status is `done` (`group-not-done`, 409, otherwise), after the same refusals as archive (`refuseArchive`: a flow
  child, an estimate or requirement call in flight, a stop settling, an integration resolving, an active run), and writes a
  `closed` activity row. `unclose-group` (`POST groups/:id/unclose`) removes a closed mark (`no-op-command` with none)
  and writes `unclosed`; it applies the #370 pause rule exactly as unarchive does (`wouldRunOnUnarchive`), its result
  carrying `paused: true` when it paused. `unarchive-group` removes only an archived mark.
- **§6.3 — the gate.** The ledger gate (`terminalGateRefusal`) admits on an archived group `unarchive-group` and
  `close-group` (a done one converts to closed; a group that is not done is refused `group-not-done` and stays archived),
  and refuses every other verb `group-archived`, `unclose-group` included. On a closed group it admits `unclose-group` and
  `archive-group` (converting to archived, after the archive refusals) and refuses every other verb `group-closed` (409),
  `unarchive-group` and `close-group` included. Preflight books the same codes.
- **§6.3 — frozen alike.** Every reader that asks only whether the mark is there (`isGroupArchived`, `archivedMarkOf`)
  treats a closed group as archived: no claim, no wake delivery, no integration, no landing watch, no group acceptance,
  out of `orca status`'s work health and the overview. The dispatch reason a closed group's claim is refused with stays
  `group-archived`, and `recovery list`'s `deferredWakes` reason too (not split: a closed group is done, so a wake
  waiting on it is an edge case).
- **§6.2 — summary.** `archiveKind: "archived" | "closed"` beside `archived: true` on every group with a mark. CLI
  `group list` reads `closed` for a closed group (`archived (was <state>)` for an archived one), both listed last.
- **§6.4 — the list.** Categories gain `closed` (`groupCategory`); the chips are All, Not started, Running, Needs
  attention, Done, Closed, Archived, and All shows neither closed nor archived groups. Every chip names how many groups
  in the current project scope it holds, `Done (3)`, whichever chip is chosen. A closed card reads `closed`.
- **§6.4 — the card is no longer only a button.** Where the page can send card actions, a selection checkbox sits beside
  the card's button (or a clarifying card's link) in the card row -- a sibling, since a checkbox cannot sit inside a
  button; the card's own button and accessible name are unchanged. With a selection, a toolbar ("Selected groups") shows
  how many are selected and offers Archive, Close (enabled only when every selected group is `done` and not closed) and
  Clear selection, all secondary or quiet (no primary). Each bulk action sends one command per group, in order, through
  the card action's fresh read (no server batch verb; each command keeps its own `expectedRevision` and refusal), and
  lists each group's outcome: done, nothing sent (already so, or changed under the click), or the group's refusal with
  its code and what to do. Refused groups stay selected. There is no bulk retry or pause, and nothing on the Board.
- **§6.5 — the group page.** A closed group shows a "Closed" status line with Unclose (`unclose-group`); a done group
  offers Close beside Archive, under the same guards as Archive. The card menu offers Archive or Unarchive by the mark's
  kind, and Close (a done group) or Unclose (a closed one).

## Correction 2026-11-19 — #355 review: close refused while delivery is owed; Closed requirements; the bulk toolbar

Recorded by the #355 fix-wave implementer (Orca session subagent, branch `feat/f-closed` over `3a8c97cb`). The section above
is kept as written; this one corrects it where they differ.

- **§6.3 — close and owed delivery (review I1, controller decision).** A delivery other than `local` lets a group reach
  done before it is delivered (`prerequisiteDone`), and the integration pass skips a marked group, so a close then froze
  the delivery silently. `close-group` (and the conversion of an archived done group) is now refused
  `close-delivery-pending` (409; detail: `blocked`/`conflict`/`resolving`, `pending`, `backoff`, `pr-draft` or
  `not-delivered`) while the frozen integration record shows owed delivery: not idle, a write-ahead `pending`, a backoff
  (`retryAfter`), a draft pull request not yet ready, or -- once a task landed -- the accepted work-branch tip
  (`acceptance.tip`) not equal to `lastIntegrated` (no acceptance record yet: `lastIntegrated` null). Read from the DB only
  (`archiveGroup.ts owedDelivery`). Archive stays available. Known gap: work a person merged into the target by hand is not
  seen without git and reads as owed; such a group is archived.
- **§6.3 — `recovery list`.** A closed group's deferred resume wake says `waitsOn: "unclose-then-resume"`.
- **Requirements list.** A closed requirement group is listed under its own Closed part (not Archived).
- **§6.4 — the bulk toolbar.** The selection box sits in a positioned wrapper with the card (`.group-card-anchor`), so it
  is never drawn over a refused card's notice. A project-scope change clears the selection and the outcomes. Archive is
  offered only while some selected group is not archived already. A command sent with no answer is listed as unknown
  ("no answer -- it may or may not be archived; check the group"), not as refused.
