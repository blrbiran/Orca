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


## As built — Orca half (§5), implementer seat `orca-273` of Orca session `7e164691`, 2026-11-12

Built on Orca main `3f19cf1a`, against ccloop main `d5a4bd2` (built clone, `ORCA_CCLOOP_BIN`); Orca's pin still names
`9c2fbe47` until the human pushes ccloop and the controller repins. Where the build differs from §5 as written, the
reversible choice and why:

1. **Parse.** `collect` accepts `worker: {state: "lost"|"undetermined", reason}` (strict, optional); `failureCause.cause`
   was already a bounded string, so `worker-lost` needed no schema change. The port gains `settleLostWorker` (method
   `settle-lost-worker`, answer `{candidate}` parsed with collect's candidate schema), forwarded by the profile router.
   No feature probe: ccloop advertises capabilities, not methods (ccloop as-built item 7); an older ccloop refuses the method.
2. **stepC.** No terminal, no candidate, `worker` present, not a saved-result run: `lost` ⇒ `settle-lost-worker`, one
   `worker-lost` activity row (new activity kind, en/zh), progress; the next round collects ccloop's terminal and takes the
   existing failed path (blocked at C, `terminal:failed`, cause `worker-lost`). A refusal `control-worker-not-lost` or
   `control-worker-lost-state-unavailable` is read as `undetermined`. `undetermined` starts a grace kept on the run body
   (`workerUndeterminedSince`); past `WORKER_UNDETERMINED_GRACE_MS` (10 min, executionDriver.ts) the run is blocked at C
   with reason `worker-undetermined:<ccloop's reason>` and a run recovery blocker `worker-undetermined`. A collect without
   `worker` clears the grace.
3. **Next commands differ from §5.2.** `orca group close-run` is not named: it closes a *proved terminal* failure and refuses
   a run with no terminal, which is what an undetermined run is. The blocker names `orca recovery retry --run <r>` (it clears
   the blocker, resumes at C, and a fresh grace starts), after the person made sure no worker process is left; ccloop then
   sees the pid gone and answers `lost`, so the run settles.
4. **#267.** No code beyond item 2: `recovery retry --run` returns a blocked-at-C-without-outcome run to C, where the dead
   worker is reported and settled. The G5 measurement is now a criterion (`sleepBlockedResumeE2E.test.ts`, second case).
5. **Automatic restart** (`webService.ts workerLostPass`, run in `systemDebugPass` before the ladder): an orchestrated
   group's (mode `run`, as the ladder and the quota retries) task whose current run failed `worker-lost` is retried as
   `orca-auto`, command id `orca-auto-worker-lost-<task>-<run>` (its row is the record), outside the ladder —
   `ladderCandidates` skips `worker-lost`, so the ladder's level 1 is not used up. "Per task lineage" is read as
   *consecutive*: the runs of the task's lineage that lost their worker, counted back from the current one; a fourth in a
   row is not restarted and carries a `worker-lost-repeated` run blocker naming `orca task retry` (not the §5.2 commands:
   `recovery retry` refuses a terminal failure). A person's retry after it resets nothing by itself; a run that does not
   lose its worker ends the streak.
6. **Attempts — and sessions.** `retryTask.ts workerLostWant`: retrying a `worker-lost` run (whoever retries it) credits
   the lost run's own attempts *and sessions* back as a `fresh-start` credit, capped by the group's limits like one (the cap
   now covers sessions; the fresh-start rule credits none, so its arithmetic is unchanged). Sessions too because each run
   opens one: measured, the third restart of a task authoring 3 sessions was refused `authored-budget-exhausted:sessions`
   with attempts credited alone. Tokens and active time were really spent and stay counted. The finite-legacy retry
   already re-grants the failed run's full grant.
7. **Usage.** A `worker-lost` run's usage is unknown (ccloop's unknown-total observation). In approximate scope (no group
   token limit, no task budget a person set, after `softLoopSince`) Orca's existing pass books the floor and the restart
   follows on a later pass. Otherwise the run carries a `worker-lost-usage-unknown` run blocker naming
   `orca task settle-usage <g> <t> --acknowledge charge-observed-floor` (or `charge-remaining-grant` with no floor); once
   settled, the next pass restarts it. The pass removes either blocker once its run is no longer such a candidate.
   Before sending, the pass asks whether the task's own budget can fund the restart (`workerLostFundingRefusal`, the
   ladder's funding check with the credit of item 6); if not, it sends nothing and writes the ladder's `ladder-skipped`
   note (its words exist): a refused retry-task row would be final and the restart lost silently. Measured: a settlement
   by `charge-remaining-grant` charges the whole remaining grant, so the restart is then unfunded and the person retries
   with `--work`. Any other refusal of the restart is booked as its row and the task stays with the person.
8. **Display.** Web run reason: cause `worker-lost` is known — "worker lost (the machine restarted or the process was
   killed)" with the restart sentence, en/zh; the three blocker/blocked codes have en/zh words (Problems, refusalCoverage).
   CLI `run show` and `group show` (each task's current run) print the same facts and the recheck command.
   `refusalCoverage`, the `i18nPseudo` enum count (216 → 217), webParity's activity kinds and the skill line follow.
   No CLI verb was added, so `archiveGroup` CALLS and `accessMatrix` are unchanged.

Criteria (real ccloop): `tests/control/workerLostE2E.test.ts` (lost mid-execute ⇒ worker-lost, restarted by itself with
the same funded attempts, group finishes; fourth loss in a row blocks `worker-lost-repeated` and nothing else starts; a
finite group waits for the explicit settlement, then restarts; an undetermined worker is never settled, blocks past the
grace, is listed by recovery list, and `recovery retry --run` re-checks), `tests/control/sleepBlockedResumeE2E.test.ts`
(#267), plus CLI and Web wording criteria. Mutations: `/private/tmp/orca-h1112/orca-273/mutations.log`.

### Orca half, item 9 — a handoff request open on a run whose worker is lost (seat `orca-273`, 2026-11-13, controller follow-up)

Measured on the combined branch (controller, handoffE2E G intermittent at load ~20): a run with an open handoff request
is step H's (`driverHandoff.ts deliverAndCollect`), which ignored `worker`, while stepC -- when it ran before the stop
arrived -- settled the same run as worker-lost. Which won depended on timing. Now, deterministically:

- Step H, collecting for an open request, settles a `lost` worker the same way (`settleLostWorker`, `underStop`): ccloop
  writes the `worker-lost` failed terminal with its stop proof; the next round takes the run through C (blocked,
  `terminal:failed`, cause `worker-lost`), and step H closes the request from that terminal (`closeBlocked` →
  `settleHandoffCheckpoint`): **`settled-unrecoverable`** (no checkpoint to continue), at once, not at the grace.
- Under a request, a settle refusal (`control-worker-not-lost`, `-state-unavailable`) and an `undetermined` worker start
  no worker grace: the request's own grace (outcome-unknown past deadline + killGraceMs + 60 s) owns them.
- The task's restart follows item 5: the group is stopped by the handoff-stop, so `workerLostPass` does not restart it
  until the stop is cleared.

Criteria: `handoffE2E.test.ts` "H-lost" (new); "G" rewritten (Ruling, tester follow-up H) to freeze the worker with
SIGSTOP -- alive, yielding nothing -- since its subject is the grace timing, not the worker's death.


## Correction (2026-11-13, tester follow-up I, implementer seat K of Orca session `d467cbd2`): settling a lost worker's unknown usage

The text above is kept as written. Measured on the controller's paid dogfood run (group `g-28d9b560`, run `run-a4ed7f10`;
an expectation-model group with a 4M token limit; codex worker SIGKILLed mid-execute after the plan's 61,193 tokens were
observed). Built on Orca main `827b3059`; criteria `tests/control/workerLostSettlement.test.ts` K1-K6 and
`workerLostE2E.test.ts` "in an expectation-model group with a token limit …"; mutations
`/private/tmp/orca-i1113/seatK/mutations.md`.

1. **As-built item 7's "a settlement by `charge-remaining-grant` charges the whole remaining grant, so the restart is then
   unfunded" no longer holds.** Only tokens are unknown (the killed call's): a worker-lost run is charged at its token
   remainder -- or, without a work token grant, its unused live ceiling (G spec §14.1, R4) -- and every other dimension in
   both buckets (active time, attempts, sessions) stays as observed, its remainder kept, because the run never reached it
   (§5.4: the machine lost the work, the task did not fail). Orca's worker-lost restart then follows in the same pass; in
   a task whose own token budget is a hard line (a group created before the release) the token charge still exhausts it
   and the run stays with the person, as before.
2. **§5.5 / G spec §16 "no floor: refused `observed-floor-unknown`" no longer holds for a worker-lost run.** ccloop's
   floor (`usageLowerBound`) is written by the worker that ran the calls, which here was killed first, so it can never
   exist. The floor counts on top of the booked usage (spec 2026-11-06 §3.2), so for a worker-lost run that observed some
   usage the floor is 0: `charge-observed-floor` books what was observed (marker `observed-floor`, `floorTokens: 0`) and
   gives the held ceiling back. A worker-lost run that observed nothing, and every other run without ccloop's floor, is
   still refused. Explicit, never automatic, as before (#116 C3).
3. **Every group read refused the settled run (`recovery-blocked:run-identity`, the CLI's 423).** The settlement stored
   `remaining.work.tokens: 0` beside `grant.work.tokens: null`, against the invariant every read checks; and its marker
   could not validate (nothing to check the charge against), which also refused the task's retry (`retry-settlement`).
   Now the writer keeps a null remainder null, and the marker is checked against the run's live ceiling for that
   dimension. A row the old writer stored (like `run-a4ed7f10`) is read as it stands: a 0 work token remainder beside a
   null grant is taken only for a `remaining-grant` settlement of a run with a live ceiling, whose marker, booking and
   ledger receipt are checked; its old charge of the other dimensions is read too. Same class, found here: a
   `release-known-zero` settlement (#215) empties the remainder by design and was refused by every read as well; that
   stored shape is read now.

Left open (not built): a dead run blocked at C stays `active` and so keeps any unused ceiling held until it is retried or
closed (`ceilingOutstanding` counts an active run that has not ended), and as an active `group`-cause run it is a raise
candidate (`planCeilingRaises`); and ccloop's `settle-lost-worker` could compute a floor from the killed call's transcript
(codex reports turn usage on stdout), which would make the floor a real observation (a ccloop change).

## Correction and as built — review of #273, implementer seat E of tester follow-up I (Orca session `d467cbd2`, 2026-11-13)

The human asked for an independent review of #273 and then its fixes (「派独立subagent review 然后实现」). Built on Orca main
`b281f0ec` and ccloop main `b43e29b`, branch `i/worker-lost-fixes` in both repositories; Orca's pin is unchanged until the
controller repins. The text above stays as written; where it no longer holds, this section says so.

1. **§5.4 "at most 3 worker-lost restarts per task lineage" means: consecutive, in claim order.** The as-built Orca half,
   item 5, counted the runs "back from the current one" by walking `lineageRunIds` reversed -- but that list is stored
   sorted by run id (`webDispatch.ts`), and run ids are random, so the walk was in random order: the bound could be
   skipped after a real failure, or fire on the first loss of a new streak. `workerLostCandidates` (systemDebug.ts) now
   walks the lineage's runs newest first by the `runs` table's rowid -- the claim order every other "earlier run" reader
   uses (fundedAllowance.ts, landingWatch.ts). The stored order of `lineageRunIds` is unchanged. Criterion:
   `tests/control/workerLostStreak.test.ts` (ids chosen so that id order is not claim order).
2. **A worker that dies between writing its candidate and releasing its lease** (its end is candidate → seal → lease
   release) left a candidate whose stop could never be proved, and the run waited forever -- the #273 symptom. ccloop
   as-built items 2 and 4 ("a run with a candidate never carries `worker`") no longer hold:
   - ccloop `collect` reports `worker` (`lost` or `undetermined`) also beside a loop run's candidate that has no stop
     proof while the launch is `claimed` or `sealed`. A candidate with a stop proof never carries it.
   - ccloop `settle-lost-worker` settles a `sealed` run whose stop cannot be proved as it settles a claimed one (confirm
     dead, reap, release the lease), and answers a sealed run whose stop is proved at once, without reading liveness.
   - **A candidate the worker wrote is kept as its outcome** (a success stays a success): it is the worker's own decision,
     already on disk; only the stop proof was missing. Only a run with no candidate is moved to the `worker-lost` failure.
   - Orca stepC (`workerReportActionable`, executionDriver.ts) calls `settle-lost-worker` for `lost` also beside a
     candidate without a stop proof, and treats `undetermined` there as in §5.2 (grace, then `worker-undetermined`). The
     next round takes the now-proved candidate on as usual: a success lands; the run is not failed and not restarted. One
     `worker-lost` activity row records that the worker was lost.
   - **Not changed:** step H (a run with an open handoff request, item 9) still acts on `worker` only when there is no
     candidate; a candidate without a proof under a request is left to the request's own grace (outcome-unknown), as
     before -- it does not wait forever, but its checkpoint is not taken. No criterion was built for that path this round.
3. **ccloop `readProcessStartedAt`** (the worker's recorded start) read `ps lstart` in the local zone, ambiguous in a DST
   fall-back hour, where a live worker could be recorded an hour early and look lost. It now reads lstart under TZ=UTC and
   parses it as UTC, as the owner liveness check does.
4. **A `settle-lost-worker` interrupted after it wrote the failed state** is completed by running it again; the unknown
   usage observation of the killed call is now booked from the stored failure cause, so the re-run books it too (before,
   the re-run found a terminal state and booked none, so the run's usage looked known). **Not fixed, reported:** the
   interrupted process leaves ccloop's `control/accepted.lock` behind, and ccloop has no stale-lock recovery for it, so in
   that case every later `settle-lost-worker` answers `control-accepted-busy` until the file is removed (the criterion
   removes it by hand, saying so). Orca surfaces that as a peer error each pass.
5. **§5.1 "a live worker is never settled"** is now its own criterion (`workerLostE2E.test.ts`, "never asks ccloop to
   settle a run whose worker is alive").

Criteria (ccloop, added only): `tests/control/workerLost.test.ts` (two new describe blocks), `tests/control/workerLaunch.test.ts`.
Criteria (Orca, added): `tests/control/workerLostStreak.test.ts`; `tests/control/workerLostE2E.test.ts` (a new describe block;
its second case needs the ccloop branch above).
