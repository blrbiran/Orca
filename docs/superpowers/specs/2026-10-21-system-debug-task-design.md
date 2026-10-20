# A system-generated debug task (and the escalation ladder's level 2 that uses it) — design

- **Author:** Orca session `9ec98639` (2026-10-21), track G. **Status:** as-built in the same round.
- **Rulings it implements (not new design):** kanban spec `2026-10-20-kanban-and-group-orchestration-design.md` §6
  (escalation ladder), §9a.3 (system-generated debug runs start without a click, actor `orca-auto`), §9a.4 (level 2);
  protect-acceptance-criteria spec §7a.3 (system findings open debug tasks directly, never correction rows).
- Human, this round: "这一轮先不做需要brainstorm的工作" / "这一轮执行过程中如果有问题，先按你的建议执行" — every choice below
  is the builder's, reversible, and recorded here.

## 1. What exists and what was missing

A person's correction opens a debug group (`debugGroup.ts`, verb `correction-debug-open`): a one-task plan built from a
frozen input, imported with no estimate, confirmed and started by the person. Its mark (`body.debug`) names the
correction, and three landing paths key on it (closing the correction, the reproduce-first check, the integration
pass's `correction-closed`). Nothing could open a debug task **without** a correction, and a confirmed group's plan
cannot gain a task (plan, graph version, snapshot and proposal are frozen at confirm).

## 2. The mechanism: a system debug group

- **Verb** `system-debug-open` (orca-auto only in practice; not routed over HTTP). Target: the new group's id, which is
  derived by code from the source — `sysdebug-<kind>-<sha256(canonical source key)[:16]>` — so a second open of the same
  source is an idempotent lookup (as the correction debug group's `debug-<id>`).
- **Mark** `body.systemDebug` (separate from `body.debug`, so none of the correction paths fire):
  `{ source: { kind: "ladder" | "integration-check" | "criteria-review", groupId, taskId|null, runId|null },
  stackOn: groupId|null, inputHash, profilesFrom: groupId, settled: null | { state, at, detail } }`.
- **Input** (`SystemDebugInputV1`, frozen as a canonical record, as the correction debug input is): the source, the
  repository, a goal text built by code from observed facts only (outcome, stop reason, failure code, blocked reason,
  the attempt commit when there is one; for an integration check the failing commands and their output tails), the
  original task's contract when there is one, and the checks the debug task is held to.
- **Plan**: one task `debug`, built by code from the input (no model, no I/O; same input ⇒ same bytes). Contract: the
  original's execution policy (budgets), relevant docs, denylist and human gates when there is one (else `debugPlan.ts`'s
  defaults); **write set = the whole repository (`**`; `.` would be a directory literally named `.` to `writeSet.ts`), no file cap, no allowlist** — the cause may sit outside the
  original's write set (a check, a test, a shared module; first seen as `out-of-bounds:debug` when it inherited the
  original's paths); verifier `command`; required checks = the input's checks. **No reproduce-first requirement** (the correction debug task's §12.8 check):
  the failure was already observed by Orca itself — the failed run, the red integration check, the flagged test change.
- **Estimate: none.** The group is imported with `estimate: "deferred"` like a correction's debug group; its grant is
  the contract's own budget (TASK_WORK when there is no original). Deviation from §9a.3's "estimate, confirm, start":
  the estimate is a paid single call that only sizes the grant, and a debug task already carries one; recorded here.
- **Confirm without a click**: the driver's system-debug pass confirms it as `orca-auto` with the source group's
  confirmed profiles, budget mode and context policy (`profilesFrom`), the selections resolved now, and the group's
  own integration scheme hash when it has one; mode `run`, so the start-on-confirm pass (kanban S2) starts it. A refusal
  is recorded on the mark (`settled: { state: "confirm-refused" }`) and the source is escalated to a person (§3).
- **Debug groups are admitted first** under the running-group cap (orchestration.ts already does it for `body.debug`;
  extended to `body.systemDebug`).
- **No recursion**: a system debug group's own failure is never escalated by the ladder; neither is a correction's
  debug group (a person opened it, a person looks at it).

## 3. Escalation ladder level 2 and level 3 (kanban §6)

Correction to kanban §9a.4 ("a task inside the original group"): infeasible without a design round because a confirmed
plan cannot grow (§1). Built instead as **a system debug group stacked on the original group's work branch**, which
behaves the same where it matters:

1. **Trigger (code)**: a task of a group that has an orchestration record (confirmed since start-on-confirm) whose
   current run ended terminally failed (`isTerminallyFailedRun`: blocked at C with a non-`succeeded` outcome), and no
   ladder debug group exists for that task yet (one per `(group, task)` ⇒ the cap). Groups with a `debug` or
   `systemDebug` mark are not escalated.
2. **Open**: `system-debug-open` with source `ladder`, `stackOn` = the original group. The debug group's work branch
   starts from `orca/<original>` (`stackBaseOf` reads `stackOn` first), so it sees exactly what the original saw.
   Its integration is forced to `keep` (its work reaches the target only through the original group).
3. **Fold**: when every task of the debug group is done, the pass fast-forwards `orca/<original>` to `orca/<debug>`
   (only if the original's branch is an ancestor — it cannot have moved while its task was blocked; if it did, level 3)
   and sends `retry-task` for the failed task as `orca-auto`. The original task reruns once, from the branch head that
   now holds the fix (retry-task's normal dispatch, H3). That rerun is part of level 2 (§9a.4).
4. **Level 3 (needs you)**: the rerun fails again, the debug group's own task ends terminally failed, its confirm is
   refused, or the fold cannot fast-forward ⇒ the mark records why (`settled`), nothing further is opened, and the
   original task stays blocked for a person. Only explicit dependents wait (kanban S3).
5. **What the person sees**: while level 2 runs, the original group's summary carries `escalation`
   `{ taskId, debugGroupId, state: "debugging" | "rerunning" }`, and the list/board do not count that blocked task as
   needs-you; `state: "exhausted"` (level 3) counts. The debug group's summary carries `systemDebug`.
6. **Level 1** (re-dispatch with all prior failures, optionally on the role's alternate agent) stays deferred until the
   ccloop verifier/last-failure spec is repinned; the ladder starts at level 2. "At most 2 extra runs per task" holds:
   today level 2's rerun is the only extra run of the original task.

## 4. Constraints kept

Rule 5 (every trigger, id and transition is code; the model only works inside the debug run); Rule 13 (every open,
confirm, start, fold and retry is a ledgered command or an activity row with actor `orca-auto`); Rule 17 (no new
out-of-repo writes; branches are under the repository's `refs/heads/orca/*` that Orca already owns).

## 5. Residuals

- The fold is a ref move on the original group's branch outside a landing; a crash between the move and the retry is
  recovered by the next pass (fold is idempotent: already an ancestor-equal ref ⇒ only the retry is sent).
- A debug task that changes the original's checks is not yet flagged by the protect-criteria detection unless that
  lands (track G4) — it runs at the debug group's own landing like any other task.
