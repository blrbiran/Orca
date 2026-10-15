# Refuse a second start while a group executes; let unstarted tasks' loop plans change while it runs (feedback #53)

Status: draft for human review (Orca session 026d10e3, 2026-10-15, on `main` at `Merge branch 'ui/panel-taste'`).
Line numbers were read at that commit; re-measure before citing.

## 1. Why

A Web-started group stays `ready` while its first run executes: a claim only sets the work item `running`
(`src/control/webDispatch.ts:425`); the group leaves `ready` at the first checkpoint commit (`review`,
`src/control/checkpoints.ts:103`). The last round added `executionPending` to the group view
(`src/panel/controlViews.ts:371-379`) and the web hides Start while it is true (`web/src/ControlGroupView.tsx:209-212`).
The server still accepts the second start: `scheduleStart`'s only state guard is `group.status === "ready"`
(`webDispatch.ts:151`). A second start sent at the new revision raises the revision, writes an activity row and inserts
another `start` wake, which claims one more task in parallel when delivered (`webDispatch.ts:210-284`). The control
socket, the CLI (`orca control send groups/<id>/start`) and MCP (`orca_send`) all reach the same function, and
`skills/orca-control/SKILL.md:32` tells agents that the server still accepts it.

Separately, the loop-plan editor refuses every task once the group leaves `draft`/`ready` or is paused
(`src/control/webService.ts:959`), although only a task with a run needs protection (`:966-967`).

## 2. Human rulings this spec implements (2026-10-15)

1. While a group's execution is pending or running, the server refuses `start` — one named code, identical over HTTP,
   the control socket, the CLI and MCP; no state change; nothing booked.
2. A task's loop plan stays editable while the group runs; an edit applies only to tasks not yet started. A claimed or
   running task, including its later continuations and retries, keeps the snapshot frozen at confirm.
3. Existing criteria may be rewritten where needed (each named, each with a mutation seen red).

## 3. Design

### 3.1 One predicate, shared by the view and the guard

Move the `executionPending` computation out of `controlViews.ts:371-379` into one exported function in
`src/control/` (`groupExecutionPending(store, groupId)`), used by both the view and `scheduleStart`. Same disjuncts as
today, minus the dead one:

- an undelivered `scheduler_wakes` row for the group of kind `start`, `no-start` or `resume`;
- any run of the group with `active = 1`;
- any plan task whose work status is in `BUSY_WORK` (`running, active, starting, start-unknown, held, continuing`).

The `continuation` wake kind is removed from the list: no code writes it (`SchedulerWakeKind`,
`src/control/dispatch.ts:87`; continuations are armed as `resume`, `continuation.ts:192`). Its removal is a no-op by
construction; the criterion in §5 pins that the three remaining kinds each count.

Decision (agent, reversible; ruling 1's "running" read this way): a group with a `held` task counts as executing. `held`
is a settled-recoverable run waiting for `resume-from-handoff` (`stopIntent.ts:776,816`); `start` would claim a
different task beside it. The web already hides Start in that state, so the server now agrees with the UI.

### 3.2 The guard

A new durable code **`group-execution-pending`** (409, en/zh entries; `src/control/errors.ts`, both locales).
`scheduleStart` checks it:

- **before** the async frozen-profile probe (`webDispatch.ts:133-143`) — a refused start must not call the agent; and
- again as the **first** check inside `applyWebCommand` (before `requirement-not-split` at `:150`), so a wake inserted
  between the probe and the transaction is still caught, with the same precedence.

"Nothing booked" means what every durable refusal means today: no revision bump, no activity row, no wake, no grant; the
command ledger keeps its immutable refusal row (`commandLedger.ts:209-230`) so a replayed `commandId` gets the same
answer. Precedence: after the preflight refusals (`revision-conflict`, `group-archived`), before every other start
refusal — an executing group is reported as executing even when it is also `review`, stopped or estimating
(`group-state-invalid`, `stop-mode-conflict` and `estimate-in-flight` keep their meaning for groups that are not
executing). `start-state-conflict` is not reused (it means a run's start state, `en.ts:1207`).

Unaffected and still allowed: `resume-dispatch`, `resume-from-handoff`, `continue-task`, `retry-task`, `recovery-retry`
(they do not go through `scheduleStart`), and the driver's own `replenishStartWakes`.

`skills/orca-control/SKILL.md:29-32` is rewritten to say the server refuses with `group-execution-pending`.

### 3.3 Loop-plan edits while the group runs

`setTaskLoop` (`webService.ts:943-1090`):

- drops the group-status refusal for `running`, `review`, `blocked` and for a paused group (`stopped` / a `pause` stop
  intent); keeps it for `done`, `clarifying` and an archived group (nothing left to edit, or not yet a plan);
- keeps, unchanged, the per-task refusal `task-already-started` (work status not `draft`/`ready`, or any `runs` row for
  the item), decided in the same transaction as the claim — this is what keeps a claimed task, its continuations and
  retries on the contract frozen at claim (`webDispatch.ts:389-396`; retry checks it, `retryTask.ts:85`).
- A `shutdown` or `handoff` stop intent still refuses (`group-state-invalid`): the group is being torn down or handed
  off. Decision (agent, reversible): only `pause` is treated as "still running" for editing.

The confirmed-path rewrite (`:1051-1081`) already repoints `proposal.executionSnapshotHash` and rewrites only the edited
task's `derivedContractHash` and grant; runs read the contract live (`executionSnapshot.ts:329-366`) — the per-task
guard is the whole protection and is pinned by `tests/control/setTaskLoopConfirmed.test.ts:126,139,147`.

`web/src/LoopPlanCard.tsx:178-184` follows: the card is editable for an unstarted task in any group state the server
accepts, and shows `loopPlan.started` for a started task.

## 4. Non-goals

- `proposal-edit` on a started Web group (loop-plans spec §8 notes it is unguarded) — separate item.
- The Overview start gate (`controlOverview.ts:94-103`) keeps its own facts (it reads the same tables plus
  `claimable` / `estimateLaunching`); whether it can disagree with the shared predicate is checked in the plan, not
  changed here.

## 5. Criteria (each seen red by its named mutation)

1. A second start while a `start` wake is undelivered → 409 `group-execution-pending`; revision, activity rows, wakes and
   grants byte-identical; the agent probe was not called (count the port's calls). Mutation: drop the pre-probe check.
2. Same with an active run alone, a busy work status alone (each of the six), and a `held` task alone; each disjunct by
   its own fixture. Mutation per disjunct.
3. The in-transaction check catches a wake inserted after the probe (fault-inject the insert between probe and apply).
   Mutation: drop the in-transaction check.
4. Same code over the control socket and through `orca control send` (CLI envelope status 409, exit 2).
5. A group whose only run failed before committing (nothing busy, `ready`) still accepts `start`.
6. `set-task-loop` on an unstarted task of a `running`, `review`, `blocked` or paused group is accepted and changes only
   that task's contract; on a started task it is refused `task-already-started`; on `done` / shutdown it stays
   `group-state-invalid`.
7. The running task settles on its frozen contract after another task's plan changed (existing
   `setTaskLoopConfirmed` criteria keep passing unchanged).

**Existing criteria this rewrites (named for the human):** `tests/control/setTaskLoop.test.ts:24`
(`it.each(["running","review","done","blocked"])` refuses — becomes: `done` refuses, the others accept for an unstarted
task) and `:33` (paused group refuses — becomes accepts); `web/tests/loopPlanEdit.test.tsx:148-157` and
`web/tests/budgetI18n.test.tsx:150` (card shows `loopPlan.notOpen` for those states). The five `executionPending`
criteria in `tests/control/webDispatch.test.ts:277-327` keep their assertions and move to call the shared function.

## 6. Test running

Targeted files while implementing (`tests/control/webDispatch.test.ts`, `setTaskLoop*.test.ts`, the socket/CLI files,
`web/tests/loopPlanEdit.test.tsx`); one full gate before merge with `ORCA_CCLOOP_BIN` set.
