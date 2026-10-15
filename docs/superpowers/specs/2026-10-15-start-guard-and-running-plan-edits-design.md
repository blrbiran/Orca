# Refuse a second start while a group executes; let unstarted tasks' loop plans change while it runs (feedback #53)

Status: revised after an independent review (Orca session 026d10e3, 2026-10-15; drafted on `main` at
`Merge branch 'ui/panel-taste'`). Line numbers were read at that commit; re-measure before citing.

## 1. Why

A Web-started group stays `ready` while its first run executes: a claim only sets the work item `running`
(`src/control/webDispatch.ts:425`); the group leaves `ready` at the first checkpoint commit (`review`,
`src/control/checkpoints.ts:103`). The last round added `executionPending` to the group view
(`src/panel/controlViews.ts:371-379`) and the web hides Start while it is true (`web/src/ControlGroupView.tsx:209-212`),
but the server still accepts the second start: `scheduleStart`'s only state guard is `group.status === "ready"`
(`webDispatch.ts:151`). An accepted second start bumps the revision, writes an activity row and inserts a redundant
`start` wake (the driver's `replenishStartWakes` already arms one whenever none is undelivered and a task is claimable,
`executionDriver.ts:850-861`, so it adds noise, not parallelism). The control socket, the CLI (`orca control send
groups/<id>/start`) and MCP (`orca_send`) all reach the same function, and `skills/orca-control/SKILL.md:32` tells
agents the server still accepts it.

Separately, the loop-plan editor refuses every task once the group leaves `draft`/`ready` or is stopped
(`src/control/webService.ts:959`), although only a task with a run needs protection (`:966-967`).

## 2. Human rulings this spec implements (2026-10-15)

1. While a group's execution is pending or running, the server refuses `start` — one named code, identical over HTTP,
   the control socket, the CLI and MCP; no state change; nothing booked.
2. A task's loop plan stays editable while the group runs; an edit applies only to tasks not yet started. A claimed or
   running task, including its later continuations and retries, keeps the contract frozen at its claim.
3. Existing criteria may be rewritten where needed (each named, each with a mutation seen red).

## 3. Design

### 3.1 One predicate, shared by the view and the guard

The `executionPending` computation moves out of `controlViews.ts:371-379` into one exported function in `src/control/`
with two entry points: `groupExecutionPending(snapshot)` over the view's `GroupReadSnapshot` (the view keeps reading
inside its snapshot, and keeps skipping work items whose decode fails, `result?.ok === true`), and a store overload that
builds the same inputs inside the caller's transaction. It is defined only for groups with an archived plan (the view
computes it only then, `controlViews.ts:455`); callers check `requirement-not-split` first. True iff any of:

- an undelivered `scheduler_wakes` row for the group of kind `start`, `no-start` or `resume`;
- a run of the group with `active = 1` **and** `phase === "work"` (estimate, clarify and split single calls share the
  `runs` table and must not count — they have their own guards, `estimate-in-flight` and `requirement-not-split`);
- a plan task whose work status is in `BUSY_WORK` (`running, active, starting, start-unknown, held, continuing`).

The view's `continuation` wake kind is dropped: nothing writes it (`SchedulerWakeKind`, `src/control/dispatch.ts:87`;
continuations are armed as `resume`, `continuation.ts:192`). The view's run disjunct narrows to work runs: a group whose
only active run is an estimate stops showing `executionPending` — it then shows Start, which `estimate-in-flight`
refuses, as today before #53. The Overview gate (`controlOverview.ts:94-103`) still lists `continuation`; the plan checks
whether it can disagree with the shared predicate and aligns it if so.

`held` counts as executing (decision, agent, reversible). It comes from settled-recoverable handoff stops
(`stopIntent.ts:776,816`), settle-unknown-usage `recovered` (`settleUnknownUsage.ts:132`) and a restartable continuation
returning to its predecessor (`stopIntent.ts:795`); its way forward is `resume-from-handoff` / `continue-task` /
`retry-task`, not `start`. Refusing `start` then does not strand the group: those commands and the driver's replenish
still dispatch ready tasks. The web already hides Start in that state.

### 3.2 The guard

A new durable code **`group-execution-pending`** (409; en/zh text: "This group is already starting or running; its next
task is dispatched automatically.", which also covers a start wake parked by a spend cap or a capability refusal).
`start` follows the pattern `applyRequirementOpen` uses for refusals found before an async probe
(`requirementCommands.ts:74-76`): the check runs inside `applyWebCommand`'s ledgered path **before** the frozen-profile
probe (`webDispatch.ts:133-143`), so a refused start never calls the agent, writes its immutable refusal row
(`commandLedger.ts:209-230`) and answers a replayed `commandId` the same way; and it runs again inside the apply
transaction so a wake inserted after the probe is still caught.

Precedence: preflight (`revision-conflict`, `group-archived`), then `requirement-not-split`, then
`group-execution-pending`, then everything else (`group-state-invalid`, `requirement-export-pending`,
`plan-version-conflict`, `recovery-blocked`, `stop-mode-conflict`, `estimate-in-flight`, …) unchanged.
`start-state-conflict` is not reused (it names a run's start state, `en.ts:1207`).

"Nothing booked" means what every durable refusal means today: no revision bump, no activity row, no wake, no grant; the
ledger's refusal row stays. Unaffected and still allowed: `resume-dispatch`, `resume-from-handoff`, `continue-task`,
`retry-task`, `recovery-retry` (none go through `scheduleStart`) and the driver's `replenishStartWakes`.

`skills/orca-control/SKILL.md:29-32` is rewritten to name `group-execution-pending`.

### 3.3 Loop-plan edits while the group runs

`setTaskLoop` (`webService.ts:943-1090`) decides editability of the group as code:

```
editable = status ∈ {draft, ready, running, review}
           && ((!group.stopped && stopIntent === null) || stopIntent?.mode === "pause")
```

- So a paused group is editable; a handoff-stopped or shutting-down group, and a `stopped` flag with no intent
  (`settleUnknownUsage.ts:52,70`), are not (`group-state-invalid`, as today).
- `done` and `blocked` (usage breach, `usage.ts:43`) stay `group-state-invalid` (decision, agent, reversible: a breached
  group needs recovery first, and `assertKnownConservation`, which `setTaskLoop` runs first (`:957`), would refuse it
  as `recovery-blocked` anyway). A clarifying group still answers `requirement-not-split` (`readArchivedPlan` runs
  first, `:955`); an archived one `group-archived` (preflight).
- The per-task refusal `task-already-started` (work status not `draft`/`ready`, or any `runs` row for the item) is
  unchanged. It is the whole protection — runs read the contract live (`executionSnapshot.ts:329-366`) and the claim
  freezes `derivedContractHash` and the grant (`webDispatch.ts:389-396`; retry checks it, `retryTask.ts:85`) — and it is
  serialized against the claim (both are transactions on the same store).
- A task edited before its first claim runs the edited contract (that is "not yet started").

`web/src/LoopPlanCard.tsx:178-184` follows the same predicate: editable for an unstarted task in an editable group;
`loopPlan.started` for a started task; `loopPlan.notOpen` otherwise.

## 4. Non-goals

- `proposal-edit` on a started Web group (loop-plans spec §8: unguarded) — separate item.

## 5. Criteria (each seen red by its named mutation)

1. A second start while a `start` wake is undelivered → 409 `group-execution-pending`; revision, activity rows, wakes and
   grants byte-identical; the agent probe was not called (count the port's calls); a replay of the same `commandId`
   returns the same body and the ledger holds the refusal. Mutations: drop the pre-probe check; move it after the probe.
2. The same with an active **work** run alone, each of the six busy work statuses alone, and a `held` task alone — one
   fixture per disjunct. Mutation per disjunct.
3. An active estimate run alone does **not** count: start answers `estimate-in-flight`. A clarifying group with a call in
   flight answers `requirement-not-split`. Mutation: count every active run.
4. The in-transaction check catches a wake inserted between probe and apply (fault injection). Mutation: drop it.
5. Same code over the control socket and through `orca control send` (CLI envelope status 409, exit 2).
6. A group whose only run failed before committing (nothing busy, `ready`) still accepts `start`.
7. `set-task-loop` on an unstarted task, built from real states (not a flipped `status` column): a `review` group after a
   checkpoint with another task running; a paused group; a group with a `held` task — accepted and only that task's
   contract changes. A handoff-stopped group, a `stopped` flag with no intent, `done` and `blocked` stay
   `group-state-invalid`. Mutation: drop the stop-intent clause.
8. In the `review` group of 7, the running task settles and its continuation runs on its old `derivedContractHash` after
   another task's plan changed. Mutation: remove the per-task `runs`-row check → the running task's edit is accepted and
   this criterion goes red.

**Existing criteria this rewrites (named for the human):** `tests/control/setTaskLoop.test.ts:24`
(`it.each(["running","review","done","blocked"])` all refuse → `done` and `blocked` refuse, `running` and `review`
accept an unstarted task) and `:33` (a paused group refuses → accepts); `web/tests/loopPlanEdit.test.tsx:148-157` and
`web/tests/budgetI18n.test.tsx:150` (card `loopPlan.notOpen` for those states). The five `executionPending` criteria in
`tests/control/webDispatch.test.ts:277-327` keep their assertions and call the shared function; the one whose fixture
makes an active run is checked to use a work run.

## 6. Test running

Targeted files while implementing (`tests/control/webDispatch.test.ts`, `setTaskLoop*.test.ts`,
`requirementGuards.test.ts`, the socket/CLI files, `web/tests/loopPlanEdit.test.tsx`); one full gate before merge with
`ORCA_CCLOOP_BIN` set.

## Corrections found while planning (Orca session 026d10e3, 2026-10-15)

The implementation plan `docs/superpowers/plans/2026-10-15-error-codes-and-start-guard.md` lists, in its section "Spec corrections found while planning" (K1-K8), where this text disagrees with the code and what is built instead; its "Controller rulings before execution" (R1-R5) settle the open points. Where they differ, the plan's corrected behaviour is what ships; the text above is kept as drafted.
