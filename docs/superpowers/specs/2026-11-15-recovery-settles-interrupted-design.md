# Recovery settles an interrupted run instead of clearing its block

Status: design (not implemented). Owner: Orca controller. Tester issues: #267, #273 (the `blockedAt=C + outcome=null`
half). Related: worker-lost recovery spec `2026-11-12-worker-lost-recovery-design.md`, terminal-run closure spec
`2026-11-07-terminal-run-closure-design.md`.

## 1. Problem

A driver run blocked at C with no outcome has no supported way to reach a terminal state.

- `resumeBlockedDriverRun` (`src/control/driveRecord.ts`) clears `drive.blockedAt`/`blockedReason` and puts the run back
  at `accepted`, but keeps `drive.outcome=null`. The next `stepC` collects the same ccloop state again: if no terminal and
  no stop proof appear, it returns without settling anything, and the run falls back to `blocked` on the next error.
- `retryTask` refuses `outcome:none` (`retryTask.ts`), `close-run` requires a terminally failed run
  (`terminalRunClosure.ts`), and `recovery list` only lists runs whose `drive.outcome` is a string.
- `recovery retry --run` therefore reports `resolved:true` (a state was changed) while the run never leaves the
  half-state. The tester reproduced this on a machine-sleep interruption (`control-peer-timeout`), and #273 shows the same
  shape after a different driver error (`control-binary-invalid`) blocks a run that `worker-lost` had just converged.

The missing fact is not another command. It is a **decision**: when the worker is provably gone and ccloop has no terminal,
the run is interrupted, and Orca must record that instead of waiting for a terminal that will never exist.

## 2. What the evidence says

- `stepC` already knows how to settle a lost worker, but only on the `accepted` path
  (`executionDriver.ts` `stepC` → `settleLostWorker`). Once another error blocks the run at C, `stepC` is never entered
  again (`run.state !== "accepted"`), so that settlement is unreachable.
- ccloop's `collect` reports `worker: {state, reason}` when the owner pid is gone (`src/control/workerLiveness.ts`), and
  its `settle-lost-worker` method produces a failed terminal with cause `worker-lost`.
- The terminal-closure path is deliberately narrow: it ends accounting for a proven terminal failure and must not be
  widened to "make a stuck run go away".

## 3. Proposal: recovery retry decides, once

`orca recovery retry --run <id>` on a driver run blocked at C with `outcome=null` performs one bounded recovery collect
before it clears anything:

1. **Collect once** with the run's stored start envelope (read-only, same `collect` the driver calls; no new provider call).
2. **If ccloop reports `worker.state=lost`** and there is no candidate/terminal: call ccloop's existing
   `settle-lost-worker` (the same method `stepC` uses), record the terminal it returns on the run
   (`state=settled-failed`, `drive.outcome` from ccloop, `failureCause=worker-lost`), clear `blockedAt`, and write one
   `worker-lost` activity row. Return `resolved:true` only after the run is no longer blocked and no longer has
   `outcome=null`. The task follows the existing worker-lost recovery policy (bounded automatic retries).
3. **If a terminal or stop proof appeared**: do not settle here; put the run back at `accepted` as today, so `stepC`
   consumes the report through its normal branches.
4. **If the worker is alive** (or ccloop says undetermined): resume at C as today, with the existing undetermined-grace
   behavior for `worker-undetermined`.
5. **If ccloop cannot answer at all**: leave the run blocked, but name the reason and return `resolved:false` with the
   command that can follow (`recovery retry` again, or `settle-unknown-usage` when usage is the open dimension).

The decision is code (Rule 5): worker liveness and terminal presence are facts from ccloop, not model judgments.

## 4. What this deliberately does not do

- It does not write `work_items.status=blocked`. The stored `running` is load-bearing for scheduling, retry and
  close-run; read views already derive blocked from the run (`blockedRunTaskStatus.test.ts`).
- It does not invent zero usage. A run with unknown usage is settled through `settle-unknown-usage`
  (`charge-observed-floor`/`known-zero`), which already refuses when the facts are missing.
- It does not widen `close-run`. That command still requires a proven terminal; this design produces the terminal.
- It does not change ccloop's `collect`/`settle-lost-worker` contracts. If the pinned ccloop cannot settle a run that was
  blocked (rather than accepted), the Orca half stops at the named refusal and the ccloop half is a separate change.

## 5. Acceptance criteria

1. Fixture: an `accepted` run with a live worker is killed; the driver blocks it at C before this change runs (simulate
   `control-peer-timeout` or `control-binary-invalid`); ccloop answers `worker.state=lost`, no candidate/terminal.
   - `recovery retry --run` settles it to `settled-failed` with outcome/cause, and `recovery list` no longer lists it as
     `blockedRuns` or `terminalRuns` with `next: recovery retry`.
   - A second `recovery retry --run` is refused (`run-terminal-failed`) instead of re-entering the same block.
   - `task retry` then succeeds.
2. Fixture: the worker is alive. `recovery retry --run` resumes at C exactly as today and the run reaches its own terminal
   through `stepC`.
3. Fixture: ccloop returns a terminal on the recovery collect. The run is consumed by `stepC`, not settled by the recovery
   command (no duplicate terminal activity).
4. Fixture: ccloop answers undetermined. The run keeps the existing grace behavior; the command never reports
   `resolved:true` for a run that is still `blocked + outcome:null`.
5. Regression: `tests/control/workerLostE2E.test.ts` and `tests/control/sleepBlockedResumeE2E.test.ts` stay green,
   including the `#267`/`#273` ten-case paired run on the pinned ccloop build.
6. `recovery list` gives the same next for a blocked-C run with `outcome=null`: `recovery retry --run` while a collect can
   still decide it, and `settle-usage`/`close-run` only after the run has an outcome.

## 6. Open questions for the owner

- Trigger: should this be the semantic of `recovery retry --run` (recommended: the natural user action means "make
  progress or tell me the truth"), or a separate `recovery settle-interrupted --run`?
- Scope: only C-blocked runs (recommended), or every blocked step whose worker is provably gone?
- Should the automatic worker-lost retry policy (`workerLostPass`, up to 3) run from this path too, or only the manual
  command settle and leave re-dispatch to the person?
- If ccloop cannot settle a blocked run, does the Orca half ship a named refusal now, or wait for the ccloop change?
