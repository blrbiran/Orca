# Issue fixes from the 2026-10-08 local deployment — design

- Date: 2026-10-08
- Author: Orca development session `e34dc963` (Claude)
- Branch: `fix/issues-20261008` (worktree `/Users/biran/code/skills/loop/Orca-issues`), based on `main` at the commit whose
  subject is `Merge branch 'deps/usage-by-model-pin' into feat/integration-schemes`
- Source: the human's issue list from a local deployment (kept outside git by the human's instruction), issues 1, 3, 7,
  8, 10, 15 and 16. Issue 15's root fix is in ccloop: `ccloop/docs/superpowers/specs/2026-10-08-codex-phase-output-hardening-design.md`.
- Human direction (2026-10-08, conversation): fix root causes, choose the globally best design rather than the minimal
  patch. Rulings H1–H7 below were proposed by the controller and approved by the human in the conversation.

## 0. Human rulings

| | Ruling |
|---|---|
| H1 | `targetVersion` stays required on Web import; the refusal must say what is missing and what to write. No default. |
| H2 | A new `retry-task` command: the failed run is settled as failed, the task returns to `ready`, normal dispatch starts a new run. |
| H3 | A new run made by `retry-task` starts from the group branch's current head, not from the failed run's workspace. |
| H4 | Groups are **archived**, never hard-deleted. Archived groups keep every record, refuse new work, and are hidden by default. |
| H5 | Wall-clock activity is recorded by Orca itself in a new `activity` table (approach A). This bumps the control store schema from 8 to 9, one-way. |
| H6 | ccloop may be changed (prompt + tolerant final-object extraction, no automatic retry); Orca re-pins after the human pushes. |
| H7 | The five parts below plus the ccloop spec are the scope; the order is §9. |

## 1. Scope and non-goals

In scope: §2 refusal explanations and plan-import issue lists (issues 1, 10, and the "nothing happened" half of 3);
§3 the shutdown stop-intent lifecycle (issue 3); §4 `retry-task` (issue 16); §5 the activity record (issue 8, feeds §6);
§6 group list, archive, and status display (issues 7, 8); §7 Orca's side of issue 15.

Non-goals: issues 2, 4, 5, 6, 9, 11–14 of the list (medium/low priority, not requested now); a server-side "stuck"
judgement; a live log stream of the model's own output; hard deletion of groups; automatic retry of failed tasks.

## 2. Refusals that explain themselves (issues 1, 10, part of 3)

### 2.1 Root causes

1. **English shows machine text.** `refusalText` (`web/src/i18n.ts`) returns the server message verbatim when the
   language is not Chinese, so an English user reads `control-plan-rejected:task-control-metadata:a`.
2. **Chinese coverage has holes.** About 62 control error codes (of roughly 200 in `src/control/errors.ts`) have no
   entry in `zhErrors` (`web/src/locales/zh.ts`), so they fall back to the same machine text. Nothing stops a new code
   from being added without text.
3. **The refusal is far from the button.** The control panel renders the group's refusal as one `role="alert"` line at
   the bottom of the ControlPanel section (`web/src/ControlPanel.tsx`), below the group view the person was using.
4. **Plan import stops at the first problem.** `schedulerControlPlanSourceOf` (`src/scheduler/planFile.ts`) collects
   every schema issue from `loadPlan`, but its own Web-import checks return on the first failure, and `control-metadata`
   lumps three different problems (repository mismatch, missing goal, missing success conditions).
5. **Docs omit a required field.** README §5's example and `docs/cli.md` never mention `targetVersion`.

### 2.2 Design

**(a) Every control error code has an explanation in both languages.** Each locale gets an `errors` table keyed by
code. An entry has a sentence that says what happened and, where there is one, what the person can do next. The raw code
stays on screen next to it (small, monospace), so support can still quote it. `{{detail}}` is the part of the server
message after `<code>:`; `{{status}}` stays as today.

`refusalText` becomes: look up the entry for the code in the current language; else fall back to the server message
(unchanged fallback). The English path no longer returns the raw message when an entry exists.

**Completeness criterion:** a test enumerates every member of `KnownControlErrorCode` (and the panel's own error codes
that reach the browser) and asserts both locales have a non-empty entry. A new code without text turns this red.

**(b) Detail decoding for the plan refusal.** `control-plan-rejected`'s detail is a comma-separated list of items. The
web decodes each item to one line of a bulleted list under the explanation:

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

**(c) Plan import reports every problem.** `schedulerControlPlanSourceOf` gathers all Web-import problems into one
list before throwing a single `control-plan-rejected` whose detail joins them. `control-metadata` is split into
`target-repo-mismatch`, `missing-goal`, `missing-success-conditions`; `task-control-metadata:<task>` is renamed
`missing-target-version:<task>`. Order: schema issues (as today), then plan-level items, then per-task items in plan
order. A plan with one problem produces exactly one item, so the error code and HTTP status are unchanged. The
`schedulerControlPlanSourceOf` callers (Web import and the requirement split validator, N1 spec §8.3.1) see only the
detail text change.

**(d) The refusal is shown where the person acted.** The per-group refusal (already kept per group in
`web/src/controlState.ts`) is rendered at the top of the group view, above the action buttons, as an alert with the
explanation, the decoded list, and the raw code. The bottom-of-panel line stays only for refusals that are not tied to a
group (import form, settings). A new refusal for the same group replaces the old one; a successful command for that
group clears it (today's reducer behaviour, kept).

**(e) Documentation.** README §5's example gains `"targetVersion": 1`; README and `docs/cli.md` list the Web-import
requirements in one place: `targetRepo` equals the repository, `goal`, at least one `successConditions`, every task
has a positive-integer `targetVersion`, no duplicate or dangling dependencies.

### 2.3 Criteria

- Completeness test over all codes, both locales (red if any code lacks text; mutation: delete one zh entry).
- Plan with all five metadata problems at once ⇒ one refusal listing five items in the specified order (mutation:
  restore early return ⇒ one item).
- Web: a `control-plan-rejected` refusal renders the decoded list inside the group view, English and Chinese.
- Existing criteria that pin the old detail strings (`task-control-metadata`, `control-metadata`) are rewritten to the
  new names; they are listed in the plan by test name for the human's awareness.

## 3. Shutdown stop-intent lifecycle (issue 3)

### 3.1 Root cause

Web spec `2026-09-19-web-recoverable-control-design.md` §6.4 step 3 requires that "for a dispatch-enabled group with
no active run, [shutdown] persists a shutdown stop intent so no claim can begin during drain", and the same section says
such a group "after restart uses an empty `resume-from-handoff` followed by an explicit `start`". The panel has never
rendered that exit for `stopMode === "shutdown"` (handoff delivery plan, gap `D-RESUME-SHUTDOWN`), so after any
restart every idle group refuses `start` with `stop-mode-conflict` and the person has no button that helps.

The durable row protects nothing: §6.4 step 1 already closes an in-memory admission gate that refuses every mutation
(`503 panel-draining`) and every scheduler claim during drain. The row's only lasting effect is the dead end.

The scan also covers groups whose work is all done (`SELECT id FROM groups`, no filter), contrary to §6.4 step 2's
"every nonterminal group".

### 3.2 Design

**Invariant S1:** a persisted `shutdown` stop intent exists only when the shutdown froze at least one active run
(including the case where it strengthens a pause because a run was active). An idle group is never given one.

1. **Shutdown writes no intent for idle groups.** In `shutdownGroup` (`src/panel/controlLifecycle.ts`), a group with no
   active run and no existing intent gets the new disposition `unchanged-idle`: no stop intent, no `stopped` flag, no
   command-revision or projection change. It is still listed in the global shutdown result (§6.4 step 4 requires every
   scanned group to be listed). A group whose work items are all done is listed the same way.
   Unchanged dispositions: existing pause, handoff and shutdown intents are preserved exactly as today; a paused group
   with an active run is still strengthened.
2. **Recovery heals stale rows.** Panel startup recovery (`recoverControl`, `src/control/recovery.ts`, before scheduler
   wakes are delivered) deletes every `shutdown` intent whose `frozenRunIds` is empty, and sets that group's
   `stopped = false`, in one transaction that records a projection change and does **not** advance the command
   revision (web spec: recovery changes projection state, not command revision). Each healed group gets an activity
   row (§5) of kind `stop-cleared` with detail `empty-shutdown-intent`. This repairs stores written by older Orca
   versions on their first start after upgrade, with no manual SQL.
3. **The exit from a real shutdown is rendered.** For a group whose stop mode is `shutdown` and whose stop state is
   `handoff-complete`, the group view shows the same resume dialog as for a human handoff-stop (continue selected tasks,
   or resume with no continuation). `ControlGroupView`'s `handoffActive` covers both modes.
4. **A stop banner explains the state.** When a group has any stop intent, the top of the group view shows one banner:
   how it stopped (pause / handoff-stop / panel shutdown), the current stop state, and the one action that leaves it
   (Resume / Resume from handoff / wait for frozen runs). Buttons that the current stop mode refuses are not rendered.

### 3.3 Published-text corrections

Appended (original text untouched) as named ERRATUM sections:
- web spec, after its last ERRATUM: §6.4 step 3's idle-group clause and §6.4's "ready group with no active run …
  empty `resume-from-handoff` followed by an explicit `start`" sentence are superseded by S1 and §3.2; cite this spec.
- handoff delivery plan `docs/superpowers/plans/2026-09-25-handoff-delivery.md`: gap `D-RESUME-SHUTDOWN` is closed by
  §3.2 (3).

### 3.4 Criteria

- An idle ready group, a never-started group with a driver, and an all-done group each get `unchanged-idle`: no
  `stop_intents` row, `stopped` unchanged, revision unchanged, still listed in the shutdown result.
- A running group is frozen exactly as today; a paused idle group stays paused; a paused group with an active run is
  strengthened (unchanged criteria survive).
- Recovery on a store holding an empty-frozen-set shutdown intent deletes it, clears `stopped`, keeps the revision,
  advances the projection once, and a following `start` succeeds. A non-empty one is untouched.
- Web: a `shutdown`/`handoff-complete` group renders the resume dialog and no Start/Pause/Handoff-stop buttons.
- Existing criteria pinning the old idle behaviour are rewritten (names in the plan): `tests/panel/controlLifecycle.test.ts`
  "gives a ready group an empty frozen set that completes, so restart can resume and start" and "commits one global
  command and leaves unchanged groups out of the command ledger and projection" (idle half);
  `tests/panel/shutdownDriverGroup.test.ts` "freezes a started group exactly as before when no driver exists, idle or
  running" (idle half) and "freezes a group that was never started even when a driver exists: it is not the driver's
  yet"; `tests/control/webFaults.test.ts` "applies a cross-group shutdown to every group or to none, and an epoch
  replays it once" if its groups are idle (the plan verifies).

## 4. Retrying a failed task (issue 16)

### 4.1 Root cause

A run whose ccloop run ended with an outcome other than `succeeded` is blocked at driver step C with reason
`terminal:<outcome>`. It keeps `active = 1`, its work item stays `running`, and its budget remainder is never
released. `recovery-retry` sends it back to step C (`resumeBlockedDriverRun`), which collects the same terminal report
and blocks again, so the button looks dead and the attempt count never moves. Execution driver spec §2.3 states "no new
human commands", so no path exists to try the task again. The UI shows the dead button for every blocked run.

### 4.2 Design

**New command `retry-task`** (Web verb, access `any`, same class as `continue-task` and `recovery-retry`; group target,
payload `{ taskId }`).

Preconditions (each refusal has its own code and explanation, §2):
- the group is not clarifying, not archived (§6.3), has no stop intent and is not `stopped`
  (`stop-mode-conflict` / `group-archived` / `group-state-invalid`);
- the task's current run (`work.currentRunId`) is `active`, in state `blocked` with `drive.blockedAt === "C"` and
  `drive.outcome` set and not `succeeded`; otherwise `task-not-retryable` (409) with detail naming the run state;
- the run has no open handoff request, no unknown usage and no pending usage events
  (`releaseRunReserve`'s preconditions); otherwise `task-not-retryable` with the detail;
- after releasing the failed run's remainder, the group's unallocated reserve covers the task's full `work.grant` in
  every dimension; otherwise `group-reserve-insufficient` (existing code) with `<dimension>:<shortfall>` detail, and the
  explanation points at the budget editor.

Effect, in one store transaction:
1. The failed run moves to the new run state **`settled-failed`**, `active = 0`. Its usage is already booked; its
   remainder is released to the group (`releaseCommitment`).
2. The work item returns to `ready`, `currentRunId` cleared; the allocation is re-reserved at the task's full original
   `work.grant` and stays `confirmed` (snapshot identity unchanged).
3. The group's command revision advances (an ordinary command); an activity row `task-retried` is written (§5).
4. The run's `drive` gains `cleanupPending: true`.

Asynchronous follow-up, in the execution driver: `driverRunIds` also visits `settled-failed` runs with
`cleanupPending`. For each, the driver archives the run's evidence (`archiveRun`, using the saved terminal report as
the stop proof) and removes its workspace (`cleanupRunWorkspace`), then clears `cleanupPending`. Failure to clean is
recorded as `cleanupError` and retried next round; it never blocks the new run, whose workspace path is per-run.

Normal dispatch then claims the `ready` task as for any task (`nextClaimableTask`), creating a new run from the group
branch's current head (H3). The task's run count — the length of its run lineage — is the attempt number the UI shows
("run 2 of this task").

**`recovery-retry` on a terminally failed run is refused** with the new code `run-terminal-failed` (409), whose
explanation says to use "Retry task". It no longer silently re-blocks.

**Run-state vocabulary:** `settled-failed` is added to the stored run state and to `runViewSchema`'s state enum.
Readers that assume the old set are found by search in the plan. The schema bump in §5 means an older Orca never reads
a store that contains it.

**UI:** in the runs table and task detail,
- a run blocked with a transient reason shows "Retry run" (`recovery-retry`), as today;
- a run blocked with `terminal:<outcome>` shows "Retry task" (`retry-task`) with the failure explanation (§7) and
  never the "Retry run" button;
- other blocked runs show no retry button.

### 4.3 Published-text correction

Appended ERRATUM in `docs/superpowers/specs/2026-09-25-execution-driver-design.md`: §2.3's "no new human commands" is
amended by H2: `retry-task` settles a terminally failed run as `settled-failed` and returns its task to `ready`.

### 4.4 Criteria

- A task whose run ended `failed` (fake ccloop) and is blocked at C: `retry-task` ⇒ run `settled-failed`, `active=0`,
  remainder released, work `ready`, the driver starts a new run, the new run's lineage length is 2, and it can succeed.
- The old workspace is removed and evidence archived by the driver; a cleanup failure does not stop the new run.
- Refusals: transient-blocked run, active healthy run, stopped group, archived group, insufficient reserve (exact
  dimension and shortfall). Each red when its guard is deleted.
- `recovery-retry` on a terminally failed run ⇒ `run-terminal-failed`; on a transiently blocked run, unchanged.
- Web: the right button per blocked reason.

## 5. Activity record (issue 8; feeds §6)

### 5.1 Root cause

The control store records almost no wall-clock time: runs have no created/started/ended time, the command ledger has
no timestamps, groups have no last-activity time. ccloop's own `events.jsonl` is per run and is removed with the run
directory after cleanup. So the UI cannot say when a run started, how long it has been running, what happened
recently, or whether it has stalled.

### 5.2 Design

**Schema v9** (`src/control/migrations.ts`): one new table.

```sql
CREATE TABLE activity (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  task_id TEXT,
  run_id TEXT,
  at INTEGER NOT NULL,          -- wall clock, ms since epoch, from the store's clock
  kind TEXT NOT NULL,
  body TEXT NOT NULL            -- JSON, kind-specific, small
);
CREATE INDEX activity_group_seq ON activity(group_id, seq);
CREATE INDEX activity_run_seq ON activity(run_id, seq);
```

`schemaVersion` becomes `"9"`; store open accepts `9`; the migration from 8 only creates the table and indexes. An
older Orca refuses the v9 store with `control-schema-unsupported` (one-way, as v7→v8 was). The panel service install
docs and README note this.

**Writer:** one function `recordActivity(store, row)` called **inside the transaction that makes the change**, so an
activity row exists if and only if its change committed. Kinds and where they are written:

| Kind | Written when | Body |
|---|---|---|
| `command` | a Web or agent command is accepted (`applyWebCommand` success) | `{verb, actor}` |
| `run-claimed` | a run is created by a claim | `{claimOrdinal}` |
| `run-started` | A1 reserves a provider attempt | `{providerAttemptOrdinal}` |
| `phase` | a collect stores progress whose `step` or `attempt` differs from the previous | `{step, attempt}` |
| `run-blocked` | a driver run enters `blocked` | `{blockedAt, reason}` |
| `run-resumed` | a blocked run is resumed (recovery-retry) | `{}` |
| `run-settled` | a run reaches a settled state, landed, or `settled-failed` | `{state, outcome}` |
| `task-retried` | `retry-task` | `{fromRunId}` |
| `integration` | the integration pass records a result | `{state, reason}` |
| `stop` / `stop-cleared` | a stop intent is created / removed (including §3.2 healing) | `{mode}` / `{reason}` |
| `archived` / `unarchived` | §6.3 | `{}` |

**Retention:** after each insert, rows of that group beyond the newest 500 are deleted in the same transaction.

**Reads:**
- group view: `activity`, the newest 50 rows of the group (newest first);
- run view: `startedAt` (the `at` of the run's `run-started`, else `run-claimed`, else null) and `endedAt` (its
  `run-settled`, else null), and `lastActivityAt`;
- group summary: `updatedAt` (max `at` of the group), via the `(group_id, seq)` index;
- a new read route `GET /api/control/runs/:runId/activity` returns the run's rows (newest 200) for the task detail.

Rows written before v9 do not exist, so older runs show `startedAt: null` and the UI shows "—". No back-fill.

**Change notification:** an activity insert always happens in a transaction that already records a projection change
for the group (every listed kind changes group, run or work state), so the existing 2-second summary poll refreshes the
group view; no new push channel.

### 5.3 Criteria

- Migration 8→9 on a populated v8 store keeps every row and adds the table; a v10 store is refused.
- For each kind: the change that commits writes exactly one row; a change that rolls back writes none (mutation: write
  activity outside the transaction ⇒ rolled-back test red).
- Retention keeps exactly the newest 500 for a group and never touches another group's rows.
- View: `startedAt`/`endedAt`/`updatedAt` come from the rows; null when absent.

## 6. Group list, archive and status display (issues 7, 8)

### 6.1 Group summary additions

`groupSummarySchema` (`src/control/webProtocol.ts`) gains optional fields (optional so the wire stays compatible with
clients that ignore them; `webParity` updated):

- `goal` — the plan goal, or the requirement idea for a clarifying group;
- `branch` — `orca/<groupId>`;
- `counts` — work items by view category: `{ idle, running, waiting, blocked, done }`, computed in the same loop as
  today's `completion` (`taskCompletion`, `src/panel/controlViews.ts`), using the view's status mapping;
- `updatedAt` — §5;
- `archived` — boolean.

### 6.2 Group list (web)

- Each group is a card (whole card is the button: border, hover and focus styles, cursor): group id and goal; a
  progress bar `done/total`; a status chip; an issue badge when `counts.blocked > 0`, `recoveryBlockerCount > 0`,
  `claimBlocked`, or a stop intent is not settled; the branch; "updated N minutes ago".
- Filter chips: All (excludes archived) / Not started / Running / Needs attention / Done / Archived. The category of a
  group is computed by one exported function `groupCategory(summary)` with its own unit tests:
  archived ⇒ Archived; issue badge ⇒ Needs attention; `total > 0 && done === total` ⇒ Done; any running or waiting
  item, or state `running` ⇒ Running; else Not started. The chosen filter is kept per viewer in `localStorage`
  (wrapped in try/catch).

### 6.3 Archive

New Web verbs `archive-group` and `unarchive-group` (access `any`, group target, empty payload).

- Archive is refused (each with its own code and explanation) while the group has an active run, a stop intent that
  is not `handoff-complete`, an integration state of `resolving` or a pending push, or an estimate or requirement call
  in flight.
- Effect: group body gains `archived: { at, actor }`; `unarchive-group` removes it. The status enum is **not**
  extended (old readers parse group bodies with strict status enums).
- An archived group refuses every new-work command (`start`, `continue-task`, `retry-task`, `estimate`,
  `recovery-retry`, `resume-*`, `set-task-loop`, `pause-dispatch`, `handoff-stop`, `retry-integration`) with `group-archived`, and the claim gates
  (`replenishStartWakes`, `nextClaimableTask`, claim delivery) skip it. Read views are unchanged.
- The group list hides archived groups unless the Archived filter is chosen. The group view shows an "Archived" banner
  with an Unarchive button.

### 6.4 Group detail order and the work-items graph

- Order: heading and alerts (claim-blocked, refusal §2.2(d), stop banner §3.2(4), archived banner), then the
  **work-items graph**, then the work-items table and task detail, then runs, then budget, agents, integration,
  skills, estimates, actions. (Graph first by the person's request.)
- The graph always renders when the group has work items, including when there are no dependency edges (today it
  returns nothing).
- Node colour is a filled background by category, with a legend; colours are tokens defined for light and dark themes:
  - running (`starting`, `active`, `continuing`) — green, with a slow pulse (disabled under `prefers-reduced-motion`);
  - waiting (`ready` with unfinished dependencies, `held`, `start-unknown`) — amber;
  - blocked or failed — red;
  - not started (`draft`, `ready` with dependencies done) — grey;
  - done — blue.
- Each node shows: task id; a status word; for a running task, the current step and ccloop attempt
  (`execute · attempt 2`), the task's run number when > 1 (`run 2`), and elapsed time since `startedAt`; for a running
  task whose `lastActivityAt` is older than 10 minutes, "no progress for N min" in amber.
- Selecting a node selects that task (same as the table): the task detail shows the task's recent activity (from the
  run activity route) above the existing evidence list.

### 6.5 Criteria

- `groupCategory`: one test per category plus precedence (archived over issue over done over running).
- Summary: `counts`, `goal`, `branch`, `updatedAt`, `archived` for a fixture store with mixed tasks.
- Archive: refusals for each guard (red when the guard is deleted); archived group refuses `start` with
  `group-archived` and is never claimed; unarchive restores; activity rows written.
- Web: list hides archived by default; filters; graph renders with zero edges; node classes per category; reduced
  motion disables the pulse; graph precedes the budget editor in the DOM.

## 7. Orca's side of issue 15

- A failed run's `failureCode` / `terminal:<outcome>` reason is explained in both locales using the same `errors`
  tables (§2.2(a)), with entries for the ccloop failure reasons Orca surfaces most: `codex-result-invalid` ("the model
  did not answer in the required JSON format"), `codex-events-invalid`, `codex-no-completion`, `codex-usage-*`,
  timeouts and exhaustion. The explanation for a terminal failure offers "Retry task" (§4).
- After the human pushes the ccloop change, Orca re-pins ccloop (`package.json`, `pin-ccloop.mjs` checks) and the
  gate's `ORCA_CCLOOP_BIN` moves to a clone build of the new pin.

## 8. Cross-cutting

- **Attribution:** every new durable write path already carries the actor (commands) or is internal (driver, recovery).
- **Languages:** code, comments, spec and ledger in English; Chinese only in `zh.ts` and the handoff.
- **Rule 17:** no test writes to the real `~/.orca`; all criteria use the existing temporary control roots.
- **Mutations** run only in a `git clone --local` copy under the session scratchpad; the plan names, per task, the
  mutation that deletes each new branch and must be seen red.

## 9. Delivery order

1. ccloop spec (separate repo, human pushes).
2. §2 refusals and plan issues; §3 shutdown lifecycle. Independent of each other.
3. §5 activity table and schema v9 (needed by §4's `task-retried`, §3's `stop-cleared`, §6's times). If §3 lands
   first, its healing writes its activity row once §5 exists (the plan orders §5 before §3's healing step).
4. §4 `retry-task`.
5. §6 summary, archive, list, graph.
6. §7 explanations and the ccloop re-pin.

Gate per the handoff: isolated clone, HOME and the four XDG roots redirected, `ORCA_CCLOOP_BIN` a clone build of the
pin by absolute path, fake codex `integration`; web build, typecheck, `--ws check`, `verify:control`, `verify:panel`,
full `npm test` with only registered load flakes, `check-tmp-leak`.
