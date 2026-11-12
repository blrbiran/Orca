# A run whose ccloop worker died recovers by itself — design (#273, #267 dead-worker half)

- **Author:** controller of Orca session `7e164691` (tester follow-up H), 2026-11-12, at Orca main `ae68e2e0`, ccloop `9c2fbe47`.
- **Status:** design; built in round H. Ledger `.superpowers/sdd/2026-11-12-tester-followup-h/progress.md`.
- **Human ruling (verbatim, this session):** 「不考虑历史决策和改动大小的情况下，你看怎么样是整体最优的方案。现在 orca 还没有发布，没有历史包袱。」
  — the controller chooses; this spec is that choice, open to the human's review.
- **Replaces** the round G open item "ccloop dead-worker-at-C decision" (Orca handoff §4.0 item 4; G5 measurement
  `/private/tmp/orca-g1112/g5/267-e2e-2.log`).

## 1. The problem

The machine reboots (or the worker is killed) while a task's run is planning or executing. The run is left with
`runs.active=1`, state `accepted` (or `blocked` at C with no outcome, #267), no `control/candidate.json`, and a ccloop
worker that no longer exists. Today:

- ccloop `collect` answers `terminal:null`, `candidate:null`, stale `progress` — it has no notion of the worker's
  liveness (survey: `collect.ts:230-274`).
- Orca's `stepC` waits for a terminal forever (`executionDriver.ts:929`). `recovery list` shows no blocker, `task
  retry`/`close-run`/`archive` all refuse. No supported command ends the run; the group never finishes (tester:
  `dogfood-20261112-3` stuck at 1/6 for hours).
- ccloop's CLI crash-resume refuses Orca control dirs by design ("Orca recovers it", crash-resume spec §4.3 step 3),
  but no Orca recovery exists.

## 2. What the user should see (the goal)

After a reboot, the panel comes back and **the group carries on by itself**: the interrupted task is started again,
the activity log says why ("worker lost — the machine restarted or the process was killed; started again"), and no
command is needed. Only when Orca cannot tell whether the worker is alive, or the restart cannot be funded, does the
group show a blocker with the exact command to run.

## 3. Options considered

| | Option | Verdict |
|---|---|---|
| A | ccloop relaunches a worker for the same run (resume in place) | Rejected. ccloop's own crash-resume restarts from **fresh planning** and discards the attempt's worktree (survey §2: `resumeLoop.ts:398-413`), so it saves nothing over a new attempt, while it needs a second worker-launch path, owner-epoch transfer under Orca's generation, and a live-ceiling/usage ledger hand-over across workers. |
| B | Orca alone decides the worker is dead (reads `owner-record.json`, probes the pid) | Rejected. Ruling §5.2.8: Orca does not fabricate the peer's observations; liveness (pid + process start time) is ccloop's knowledge (`ownerLiveness.ts`). |
| **C** | **ccloop reports the worker's liveness in `collect` and, on Orca's request, settles a dead-worker run as an ordinary failed terminal with a stop proof; Orca then takes its normal failed-run path (automatic retry)** | **Chosen.** It reuses a proven shape — `settle-saved-result` already does exactly this dead-owner settlement for saved-result runs (`settleSavedResult.ts:48-110`: confirm dead, reap, force state, release lease, seal, prove stop) — and every downstream Orca path (Problems, retry ladder, usage settlement, `close-run`) already understands a failed terminal. |

## 4. ccloop half

### 4.1 `collect` reports a lost worker
New optional top-level key `worker`, present **only** when the run is not terminal, has no candidate, and its launch is
`claimed` (a worker was started and has not sealed):

```
worker: { state: "alive" | "lost" | "undetermined", reason: string }
```

Computed with the existing owner liveness classification (`classifyOwnerProcess` on the worker's recorded identity —
pid + process start time; pid reuse ⇒ `lost`). Lease age is **not** a death criterion (as crash-resume). Absent when
the trigger does not hold (Orca's collect parser is strict: the key appears only in the situation that is broken today).

### 4.2 New control method `settle-lost-worker`
Input: the run's start envelope. Generalises `settle-saved-result`'s dead-owner settlement to ordinary loop runs:

1. Refuse unless the worker is confirmed dead (`confirmOwnerDead`; `alive`/`undetermined` refuse with
   `control-worker-not-lost`). Idempotent: an already settled run answers its existing candidate.
2. Reap orphan process groups (`reapRunProcesses`).
3. Move the loop state to a failed terminal with failure cause **`worker-lost`** (new value in the failure-cause
   vocabulary; `workObserved` = whether any work event was recorded; not `usageKnownZero`).
4. Usage: everything the events already carry, plus `usageLowerBound` from calls that ended; the killed in-flight call's
   usage is **unknown** (no source records it — survey §2, §8). The run's usage is therefore reported unknown with its
   observed floor, exactly like other interrupted calls.
5. Release the lease, seal the worker, write the candidate (result: failed; no checkpoint), prove the stop.

The next `collect` then returns a normal terminal with a stop proof.

### 4.3 Criteria (ccloop, add only)
Dead worker mid-plan and mid-execute: `collect` reports `lost`; `settle-lost-worker` yields a terminal `worker-lost`
candidate with a stop proof that Orca's existing `terminalRunClosure` checks accept (`ownerLeaseReleased`,
`workerSealed`); a live worker ⇒ `alive` and the method refuses; unreadable identity ⇒ `undetermined`, refuses; a
second call is idempotent; a run with a candidate never carries `worker`.

## 5. Orca half

1. **Parse** `worker` in the collect schema.
2. **stepC**: when the report has no terminal and `worker.state==="lost"` ⇒ call `settle-lost-worker`, write a
   `worker-lost` activity, and treat the round as progress. The next round collects the terminal and takes the
   existing failed-run path.
   `worker.state==="undetermined"` for longer than a grace (default 10 min, a driver constant) ⇒ block the run at C
   with reason `worker-undetermined` and a `recovery_blockers` row, so `recovery list` and Problems show it, with next
   commands `orca recovery retry --run <r>` (re-checks) and `orca group close-run` (after the person has made sure no
   process is left).
3. **#267 unification**: a run blocked at C with no outcome whose worker is lost takes the same path after
   `recovery retry --run` returns it to C (the G5 measurement then reaches a terminal instead of waiting forever).
4. **Automatic restart**: a terminal failure caused by `worker-lost` is retried automatically as a fresh attempt
   (the existing level-1 retry, issued as `orca-auto`), and **does not consume the task's attempts**: the machine lost the
   work, the task did not fail. Bounded separately: at most **3** worker-lost restarts per task lineage; the fourth
   blocks with `worker-lost-repeated` and the commands above.
5. **Usage**: the killed call's usage is unknown. Unlimited groups settle it by the existing automatic approximate
   floor; finite groups need the existing explicit `settle-usage … --acknowledge charge-observed-floor` (#116 ruling:
   explicit, not automatic) before the restart can be funded — the blocker names that command. No double counting:
   ccloop stops emitting events for the run once settled; Orca's `recordUsage` refuses events after settlement.
6. **Display**: CLI `run show`/`group show` and the Web run reason say "worker lost (the machine restarted or the
   process was killed)"; i18n en+zh.

### 5.1 Criteria (Orca)
Against real ccloop (`ORCA_CCLOOP_BIN`), worker SIGKILLed mid-execute: the run reaches a terminal `worker-lost`, a new
attempt starts by itself, the group finishes; the worker-lost restart does not reduce the task's remaining attempts;
the fourth consecutive loss blocks with `worker-lost-repeated`; an `undetermined` worker past the grace blocks and is
listed by `recovery list`; a live worker is never settled; the #267 dead-worker path (rewrite of the G5 measurement into
a criterion). Each seen red by a named mutation.

## 6. Order and compatibility

ccloop first (new optional key + new method), then the human-authorised ccloop push, repin, then the Orca half. An Orca
on the old pin never sees `worker` (the old ccloop does not send it); an old Orca on the new ccloop sees `worker` only
in the already-broken situation — its strict parser then reports `control-collect-invalid`, which is no worse than
waiting forever and is visible.

## 7. Not in scope
Keeping the interrupted attempt's plan or worktree edits (ccloop does not keep them either); claude adapter writing a
usage floor for a killed call (it has no source for it); single-call runs (separate path, already settled by
`settleDeadSavedRecovery`-style handling where applicable — unchanged).


## As built — ccloop half (§4), ccloop seat of Orca session `7e164691`, 2026-11-12

Branch `h/ccloop-diagnostics-commits` in ccloop (worktree `.claude/worktrees/h-ccloop`), on top of ccloop `9c2fbe47`.
Criteria: `tests/control/workerLost.test.ts` (built CLI over fake codex's new `hang-in-<phase>` mode). Where the build
differs from §4 as written, the reversible choice and why:

1. **`workObserved` is not carried.** The run-level failure cause (`RunFailureCauseV1`: cause, phase, retries, detail,
   optional `usageKnownZero`) has no `workObserved` field, and collect's `failureCause` is parsed strictly on both sides; a
   new field would be a second schema change for one fact Orca can already read from the run's events. The settled
   state carries `failureCause: {cause:"worker-lost", phase:<plan|execute|verify|null from the loop status>, retries:0,
   detail:<the liveness reason>}` and `stopReason: "worker-lost: <reason>"`. `worker-lost` is added to `FAILURE_CAUSES`
   (terminal, not retryable inside a phase) — Orca's collect parser must accept the new enum value in the repin.
2. **Where `worker` appears — never for an alive worker.** `worker` is `{state:"lost"|"undetermined", reason}`; an
   alive worker is the ordinary in-flight run, whose collect answer stays byte for byte as before (existing ccloop
   criteria pin it exactly, e.g. `agentsControl.test.ts` "keeps inspect and collect working after the table is deleted…",
   and ccloop's Rule 15 forbids rewriting them without the human naming each). Orca reads "no `worker`" as alive-or-n/a.
   Further, only for a loop run without `mode` (not a saved-result recovery, which has
   `settle-saved-result`; not a single call, §7), with launch `claimed`, no candidate and no terminal. `reason` is ccloop's
   liveness text (e.g. `owner pid 123 does not exist`). Liveness = `classifyOwnerProcess` on `accepted.worker`
   (pid + start time, `lastAffirmedAt` = the worker's start); `dead` is reported as `lost`.
3. **`settle-lost-worker` answer and refusals.** Answer `{candidate}` in collect's candidate shape, with the stop proof.
   Refusals: `control-worker-not-lost` (alive, undetermined, the owner record's process not confirmed dead, or a launch that
   is not `claimed` and has no candidate), `control-envelope-conflict`, `control-worker-lost-state-unavailable` (no loop
   state: the worker died before its loop started — not seen in practice; Orca should treat it like `undetermined`),
   `control-worker-processes-not-reaped: <reason>`, `control-worker-not-stopped`.
4. **A loop state that is already terminal is kept**, not rewritten to `worker-lost` (the worker died after deciding but
   before its candidate); the candidate's result follows the worker's own mapping. A claimed run whose worker died after
   writing its candidate is sealed and its lease released by the same method (collect does not report `worker` there, but
   Orca may call it to obtain the stop proof).
5. **Usage.** One `work` observation `worker-lost` with an unknown total (`threadTotalTokens: null`) is appended whenever
   the state is moved to failed, also when the worker died between calls; the observed floor (`usageLowerBound`) is
   unchanged. Then the mechanical `handoff` observation `worker-lost-settlement`, as the worker's own end does.
6. **Attempt worktrees** of the dead worker are published under their refs and removed (the cleanup a failed attempt
   gets), extra-repository worktrees too, before the result repository is materialized.
7. **`features` is unchanged.** It advertises capabilities, not methods (`live-ceiling` is not listed either), and both
   sides parse it strictly; Orca detects the method by the pin.

ccloop main carries this as the subjects `feat(control): collect reports a lost worker; settle-lost-worker ends its run as worker-lost (Orca #273)` and `test(control): settle-lost-worker's two liveness guards, each alone (Orca #273)`.
