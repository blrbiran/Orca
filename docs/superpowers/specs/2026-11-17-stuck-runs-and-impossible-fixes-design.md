# Stuck runs and impossible fixes: a way out of every stop (#344, #343)

Session 2026-11-17 evening (Orca). Tester issues #344 (with its two supplements) and #343 (with its supplement) in
`orca_archived_files/issue-20261023.md`. Code facts: a read-only survey of this session (file:line below are from it and
were spot-checked). Status: **design for the human's review; nothing is built.**

## Why

On `changelog-dogfood-20261117-1` (7/7 tasks done, acceptance passed) one auto-opened review fix task was impossible: its
criterion was about the frozen plan's `targetPaths`. It burned 48.28M tokens (73% of the group), then:

1. `group pause` left a `start-pending` run at `active=1` forever (no provider call made); `groupComplete` stayed false,
   so integration never ran.
2. On a retry, `pause`, `close-run` and `stop-handoff` all failed to stop the running run; the view said it had stopped.
   Handoff did stop it, 8.07M tokens later.
3. After that the run was `settled-recoverable` and the task `held`; `task retry`, `task continue`, `accept-attempt` and
   `close-run` all refused it. Only the Web "Continue task" button or archiving the group got out.
4. No recovery view (`recovery list`, `recovery_blockers`, `group brief` firstFailure) showed it; only `counts.blocked=1`.

The four are separate defects. Each one alone can leave a group that the person cannot move.

## Code facts this rests on

- `applyPauseDispatch` (`stopIntent.ts:395-421`) writes the intent and touches no run. The driver holds a paused group at
  step A1 (`executionDriver.ts:402`: the run stays `starting`) and step B (`:830`: a prepared `start-pending` stays). An
  `accepted` run is not held; ccloop is never told. Only a handoff/shutdown stop settles a never-started run (`restartRun`,
  `driverHandoff.ts:105-169` → `settled-restartable`, `active=0`, work back to `ready`).
- stop-handoff's deadline is enforced only by `settleIfPastGrace` (`driverHandoff.ts:324-333`): the request becomes
  `outcome-unknown`, the stop state `handoff-unresolved`; the run is untouched (`active=1`, still collected). Orca never
  kills a run (`:205-209`).
- A handoff that ends with a stop proof settles the run `settled-recoverable` and the work `held` (`settleHandoffCheckpoint`,
  `:388-431` → `terminaliseRun`, `stopIntent.ts:1021-1089`), with a `"partial"` checkpoint.
- The CLI's `checkpointOf` keeps only checkpoint state `"complete"` (`commands/domains/verbs.ts:482-486`), while every
  handoff checkpoint is `"partial"` and the server requires `"partial"` (`continuation.ts:160`). So `task continue` and
  `group resume-handoff --continue` from the CLI can never find one (`checkpoint-not-found`). The Web button works.
- `task retry` refuses a `held` run in a token-policy group: `terminaliseRun`'s token branch (`stopIntent.ts:1042-1048`)
  marks allocations "held" without amounts and releases the commitment, so the retry's amount checks fail
  (`retryTask.ts:261`); and `:269` refuses `outcome:none`.
- A review fix task copies the source task's grant and contract (`requirementReview.ts:550-569`, `:529`); in an
  expectation-model group its grant has no token number, so nothing caps it. The review answer has, per criterion, only
  `verdict`, `evidence`, `missing` (`:53-72`): no field says whether changing files can meet it.

## Design

### S1. Pause settles a run that never reached the provider (#343 supplement, #344 item 3)

When a group is paused, the driver settles its runs at A1 (`starting`) and B (`start-pending`, never accepted by ccloop)
the way a handoff stop already does: `restartRun` → `settled-restartable`, `active=0`, work `ready`, grant released.
Resume dispatches them again as new runs. Runs ccloop already accepted are untouched: pause still means "running ones
finish" (the CLI already says so, `work.ts:480`). A run whose ccloop accept is in doubt (`unknown`) is left to the
existing inspect path.

### S2. `orca run abandon`: end an attempt now (#344 main ask)

A new person-only verb `abandon-run` (CLI `orca run abandon <group> --run <run> --note <why>`, Web: "Abandon this
attempt" on a running run's row and on the stuck-task problem row). It is for "this attempt cannot succeed; stop paying
for it". It:

1. Records the request on the run (`abandon {by, note, at}`) and activity `run-abandon-requested`.
2. Stops the run through the mechanism ccloop already has for a stop in flight: a live ceiling revision whose token
   ceiling is the run's observed usage now (`control live-ceiling`, ccloop's `liveCeiling`: claude/omp stop mid-call,
   codex between turns). No new ccloop method, no repin, and Orca still never kills a process.
3. When the run reports its terminal (`exhausted`, `liveCeilingStop`), settles it `settled-failed` with
   `operatorSettlement {kind: "abandoned", by, note}`, `active=0`, its unused grant released and its used tokens booked
   as they are; the work item becomes `blocked` with failure code `run-abandoned`, so `task retry` (a fresh run) and,
   for a review fix task, `group review-accept` / `review-fix` are the next steps. Nothing is dispatched for it until a
   person acts.
4. If the run is held in a state the ceiling cannot reach (`start-pending`, `starting`), it is settled at once as in S1.
   If ccloop does not report a terminal within the handoff grace after the ceiling (`handoffGraceMsOf`), the run becomes
   a named blocker `abandon-unresolved` in `recovery list` with the run id: Orca does not pretend it stopped.

`stop-handoff` past its deadline is unchanged (the run is still collected and may yet hand off cleanly), but its
`handoff-unresolved` row now offers `run abandon` as the next step.

Read in ccloop (session 2026-11-17): the worker watches `control/live-ceiling.json` **only when the start envelope
carried a `liveCeiling`** (`ccloop src/control/worker.ts:310`), and an envelope may carry one only when the work grant has
no token number. Today Orca puts one only on expectation-model runs whose ceiling is finite (`liveCeiling.ts`
`runCeiling` returns null when no bound applies) -- the tester's "no token limit" group had none. So S2 needs:

- Orca gives every run whose work grant has no token number a `liveCeiling` in its start envelope; with no bound it is a
  watch-only ceiling (`tokens: Number.MAX_SAFE_INTEGER`, cause `group`), recorded on the run as watch-only so it is
  **not** added to the group's ceiling reserve (`liveCeilingReserved`). This changes envelope bytes for new runs only.
- A run with a finite token grant (no live ceiling allowed) is already bounded by its `tokenBudget` (#225's in-phase stop);
  abandon on it goes to `abandon-unresolved` unless it ends first. Recorded as a limit, not hidden.
- Codex stops after its current response (live usage from the rollout, the ccloop Codex live-usage work), claude / omp
  mid-call; no ccloop change and no repin.

**Open for the human (S2)**: should an abandoned run's partial work be kept for `accept-attempt`? The controller's
recommendation: no -- "abandon" means the person judged the attempt worthless; keeping the work is what handoff is for.

### S3. A held task always has a way out (#344 supplement)

- Fix the CLI `checkpointOf` to accept the checkpoint the run actually records (state `partial` or `complete`, by the
  run's own `checkpointId`), so `task continue` and `group resume-handoff --continue` work from the CLI as on the Web.
- `task retry` accepts a `settled-recoverable` run whose task is `held` (a fresh run, the checkpoint not used), in both
  the token-policy and the legacy branch: the token-policy case checks `fundingReleased === true` and every allocation
  `held` instead of amount equality, skips the outcome check for a held run, and does not release the commitment twice.
- No change to `close-run` (it is for active, proved terminal failures) or `accept-attempt`.

### S4. A stuck task is visible where people look (#344 supplement)

- `recovery list` gains `heldTasks[]`: work `held` with an inactive `settled-recoverable` current run; each row names the
  run, whether it is continuable, and its next commands (`task continue` when continuable, `task retry`, `run abandon`
  is not needed: the run already stopped).
- `group brief` firstFailure gains cause `task-held` for such a task; Overview shows it as `task-attention`.
- `handoff-unresolved` and `abandon-unresolved` runs appear in `recovery list` too.

### S5. A review criterion that work cannot meet opens no work fix (#343)

- The review answer schema gains, per criterion, `fixableBy: "work" | "plan" | "person"` (required; the review prompt
  defines them: `work` = changing repository files can meet it; `plan` = it is about the accepted plan itself -- tasks,
  targetPaths, dependsOn, order; `person` = only the person can decide -- a contradiction between their instructions, a
  fact outside the repository). Classifying is the model's job; routing on the label is code's (Rule 5). The review
  prompt version is bumped; an answer without the field is `invalid` as any other schema miss.
- `settleNotPassed` opens a fix task only for not-met criteria with `fixableBy: "work"`. When every not-met criterion is
  `plan` or `person`, the review stops `not-passed`, why `not-fixable-by-work`, and names the next steps:
  `requirement feedback` (a new draft) for `plan`, `review-accept` / `review-rerun --note` for `person`. When some are
  `work`, the fix task covers only those and the round records the others as left to the person.
- The fix task's goal adds: "If a criterion cannot be met by changing files, stop and report it in `decisions` instead of
  trying." (a cheap second line of defence).
- **Cap**: an automatic fix task gets a token ceiling of twice the tokens its source task used (from the usage ledger),
  at least 1M, written into its contract's `tokenBudget`, so #225's in-phase stop applies; a person's `review-fix` keeps
  today's grant. **(agent's call, for review: the number.)**

## Out of scope

- Killing worker processes from Orca. Mid-turn steering (#226/#243).
- `held` semantics for continuations in general (only the exit and the visibility change).

## Acceptance (each a command that exits 0 / non-0)

1. Driver harness: a paused group with a `start-pending` run → that run `settled-restartable`, `active=0`, the task
   `ready`; resume dispatches a new run.
2. Driver harness with a fake ccloop that honours live ceilings: `run abandon` on an `accepted` run → a live-ceiling
   revision is sent, the run settles `settled-failed` / `abandoned`, `active=0`, task `blocked` `run-abandoned`; no new
   run is dispatched; `task retry` then works.
3. Same, fake ccloop ignores the ceiling: after the grace, `recovery list` shows `abandon-unresolved` for the run.
4. CLI: `task continue` on a run with a `partial` handoff checkpoint finds it (fake panel).
5. `task retry` on a token-policy `settled-recoverable` / `held` task succeeds and books the commitment once.
6. `recovery list` and `group brief` show a held task with its next commands.
7. Review fake answers: all not-met `plan` → no fix task, why `not-fixable-by-work`; one `work` + one `plan` → one fix
   task covering only the `work` criterion; an auto fix task's contract carries the token ceiling.

## Correction 1 (same session, after the builders' reports; these win over the sections above)

1. **S1 does not release the grant.** It settles a never-started run the way `restartRun` does (`settled-restartable`):
   a legacy task's commitment is kept for its next claim and only optional-policy tokens go back. The criterion asserts
   the ledger is unchanged.
2. **S3 also needed `retryGrant.ts`.** A held retry was accepted but its next claim failed
   (`recovery-blocked:retry-source:<task>:source-state`) because a retry source had to have an outcome; a run with no
   outcome whose handoff request settled recoverable with a checkpoint is now a valid source.
3. **S4's Overview row already existed** (`controlOverview.ts`, reason `task-held`); only a criterion was added. Held
   tasks are left out of `heldTasks[]` and `task-held` while the group is under a stop or archived (both exits are
   refused there) -- builder's call. The third S4 bullet (`handoff-unresolved` / `abandon-unresolved` rows) is not built
   yet; it goes with S2.
4. **S5's field and limits.** The cap is carried by the fix task's work grant `tokens` (`deriveContract` writes it into
   `executionPolicy.tokenBudget`). In a group whose remaining finite token reserve is below the cap, an automatic fix now
   stops `unfunded` instead of opening uncapped. The review prompt has no version marker; none was invented.

## Correction 2 (same session, after the S2 build; wins over the sections above)

1. **S2.4 is not S1's settle.** A run abandoned before it reached the provider is proved never-started as S1 does it, but
   settled abandoned (`settled-failed`, task `blocked` `run-abandoned`, drive outcome `not-started`), not
   `settled-restartable` / `ready`: S1's settle would redispatch it at once, contradicting S2.3.
2. **A run that succeeds after an abandon request lands** as any success does (controller's call, overriding the
   builder's "settles abandoned whatever its terminal"): abandon ends an attempt that cannot succeed; finished, paid-for
   work is kept. Every other terminal of an abandoned run settles abandoned.
3. **Untested by a run** (read from the code only): a run whose usage is unknown at its abandoned terminal is blocked as a
   failed run is, so `settle-usage` / `close-run` end it. The criterion's observed tokens are 0 (the fake ccloop books
   usage only at its terminal), so the ceiling write is checked for its revision and source, not a non-zero amount.

## Correction 3 (review 2026-11-18, Orca session 4389b15f)

An independent review of the S1-S5 build found the faults below; the fixes are on the worktree branch's commit
`fix(abandon): abandon wins over an open handoff request; ...` (criteria `tests/control/abandonUnderStop.test.ts`).
File:line references were read at that commit (`/usr/bin/git show <commit>:<file>`). These win over the sections above.

1. **Abandon wins over an open handoff request** (controller's decision). A person's abandon is the final word on that
   run. When an abandoned run reaches a terminal (or is proved never started) while it owns a handoff request in any
   adoptable state, `outcome-unknown` included, the request is closed `settled-unrecoverable` with failure code
   `run-abandoned` (the existing state for "not continued"; no new state), in the same transaction that settles the run
   as every abandoned run is settled (`settled-failed`, `operatorSettlement: abandoned`, task `blocked`
   `run-abandoned`). Only the request row is written for it: the run's accounting is `terminaliseRun`'s, once, so
   nothing is released or booked twice. A request closed `run-abandoned` does not make the group's stop
   `handoff-partial`: the person chose to drop that attempt, and `resume-from-handoff` refuses a partial stop. Before
   this, such a run stayed `accepted`, `active=1` for ever: the abandoned settle yielded to the request and step H sent
   the terminal back to it. That included the route S2 itself names (`stop-handoff` past its grace, `handoff-unresolved`,
   `run abandon`). Correction 2.2 still holds: a run that succeeds after an abandon lands. An abandoned run under a
   request is named `abandon-unresolved` after the grace on step H's path too. Recovery rows offer no step that would be
   refused: a run already abandoned is not offered `run abandon`, and a group already under a handoff or shutdown stop
   is not offered `stop-handoff`.
2. **An abandoned start-pending run found accepted is stopped by its ceiling.** A run abandoned while `start-pending`
   whose envelope ccloop had in fact accepted moved to `accepted` (the never-started inspection, or stepB's accept
   answering after the abandon) with its watch-only ceiling untouched, so nothing stopped it. Every write that moves a
   run carrying `abandon` to `accepted` now lowers its live ceiling to its observed work tokens, through the same writer
   `run abandon` uses (`abandonRun.ts` `lowerAbandonedCeiling`).
3. **Documentation gaps the reviewer found** (facts, nothing changed for them):
   a. Since S5 an automatic fix task has a finite token grant (its cap), so it carries no live ceiling, and
      `run abandon` on it can only end `abandon-unresolved` unless it ends first. The case #344 was raised for (an
      impossible auto fix burning tokens) is bounded only by S5's cap, not by abandon.
   b. The watch-only ceiling exists only for protocol-4 task runs that are not recoveries and whose work grant has no
      token number (`webDispatch.ts:444`, `watchOnly`). That is narrower than S2's "every run whose work grant has no
      token number".
   c. S5's "at least 1M" is clamped to the source task's grant when that grant has a token number
      (`requirementReview.ts:657-660`, `autoFixTokenCeiling`), so the cap can be below 1M.
   d. S1 on a continuation run gives the task back `held` to the predecessor it continued (existing `terminaliseRun`
      behaviour, `stopIntent.ts:1098`), not `ready`. So resume does not dispatch it again: the person continues it
      again, and `recovery list` `heldTasks[]` shows it.
4. **Re-review fix: an abandoned attempt never becomes continuable through its handoff** (controller's ruling,
   2026-11-18; the gap predates Correction 3 but contradicts point 1). A run that carries `abandon` and that ccloop answers
   with a stop-proof checkpoint and no terminal, or that is blocked with a collected failure (not a success), was settled
   as a handoff checkpoint: `settled-recoverable`, task `held`, continuable on resume. With its usage known it now settles
   as every abandoned run does (`driverHandoff.ts` `settleAbandonedUnderStop`): evidence archived, workspace removed,
   `settled-failed` / `abandoned`, task `blocked` `run-abandoned`, its request closed `run-abandoned`. With no terminal its
   drive outcome is `stopped`, so `task retry` admits it. With its usage unknown it is settled as before, unrecoverable with
   `usage-unsettled` (not blocked at C first, as the ruling asked: a blocked run with no outcome is collected again by
   `closeBlocked` and would loop), and `settle-usage` refuses `recovered` for a run carrying `abandon`
   (`run-usage-not-settleable:abandoned`), Orca's own approximate settlement included. Settling it as abandoned there
   instead would change that branch's reservation arithmetic, so it was not done. **Limit:** such a run then has no way
   out short of archiving the group (no settle-usage disposition, no `task retry`).

## Correction (2026-11-19, session 3ba26002): the automatic fix task's cap never exceeds what the group has left (#377)

Tester #377: S5's cap (`autoFixTokenCeiling`: twice the source task's used tokens, at least 1M, clamped by the source's
grant -- Correction 3.3c) was 4.09M while the group's unallocated reserve held 1.58M, so appending the fix task failed
`group-budget-unavailable` and the review stopped `unfunded` with budget still left. Now the cap is also clamped by what
the group can fund: the unallocated reserve's tokens less the fix task's handoff tokens (the two allocations
`appendConfirmedTaskInTransaction` reserves together). The 1M floor holds only when the group can pay it; below that the
cap is what the group has left. Only when that is zero or less (or another dimension -- active time, attempts, sessions --
does not fit) does the fix stay `unfunded`, shown with its existing next steps. A group with no token limit (reserve
tokens `null`) is not clamped. A person's `review-fix` keeps the source's grant as before. A positive but very small
remainder still opens a fix task with that cap (no minimum below the floor); see the build report.
