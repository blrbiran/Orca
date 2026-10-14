# Settle a handoff-stopped run's unknown usage and continue it from its checkpoint

Orca session `b39a5527`, 2026-10-14. Follows `2026-10-13-unmetered-usage-settlement-design.md` ("D"), whose
Corrections §3 left this case held and named it a separate decision.

## 1. Problem (measured)

A run that is still working when the owner sends `handoff-stop`, and whose usage the provider never reported (real Codex
reports usage only at phase end, so this is the normal Codex shape), ends as:

- run `settled-unrecoverable`, `recoverable: false`, `drive.outcome: null`, `unknown.work: true`, a committed `partial`
  checkpoint;
- its handoff request `settled-unrecoverable` with `failureCode: "usage-unsettled"`
  (`src/control/driverHandoff.ts`, the `usage-unsettled` failure code);
- the group stop state `handoff-partial`.

Every way out is refused (probe in this session, all three budget shapes: `optional-v1` unlimited, `optional-v1` finite,
`finite-legacy`):

- `settle-unknown-usage` (either acknowledgement): `run-usage-not-settleable:current-failed-task`, because
  `settlementAdmission` requires `drive.outcome` to be a failure;
- `retry-task`: `stop-mode-conflict`; `resume-from-handoff`: `group-state-invalid` (the stop is `handoff-partial`).

So the dead end is not specific to unlimited budgets, as D's Corrections §3 assumed: a finite run of the same shape is
held in the same place.

## 2. Ruling (human, 2026-10-14, this session)

Open the path. After the owner settles the unknown usage, the run continues **from its checkpoint** (the handoff stop's
purpose), not from head. Options presented: continue from the checkpoint (chosen) or retry from head (discards the
checkpoint).

## 3. Design

### 3.1 Admission

`settlementAdmission` gains a third disposition, `recovered`, admitted when all hold (every other existing rule — owner
Web principal, not archived, not settled, the acknowledgement matches the remainder, no open request, no pending usage
events, some usage unknown, stop mode — applies unchanged):

- the run is the task's current run, `phase: "work"`, a task run (no estimate), inactive, `drive.outcome === null`;
- `run.state === "settled-unrecoverable"`;
- its latest request is `settled-unrecoverable` with `failureCode: "usage-unsettled"`;
- `work.status === "blocked"`, no pending run;
- its checkpoint passes `releasedSettlementCheckpoint` and is `partial` (what `resume-from-handoff` requires).

A run with a failure outcome keeps today's `committed`/`released` dispositions unchanged.

### 3.2 Effect

The usage charge is exactly today's: the conservative remaining grant, or, for an unlimited work token remainder,
`release-unmetered` (nothing booked for work tokens). Both unknown flags clear. Then the run is put where a handoff stop
with known usage would have put it (`terminaliseRun`, `settled-recoverable`):

- run `settled-recoverable`, `recoverable: true`, `failureCode: null`; request `settled-recoverable`, `failureCode: null`;
  the stop intent's state is re-derived (so the group can reach `handoff-complete`);
- work `held`; task allocations `held`.

The commitment differs by accounting mode, because the two modes fund a continuation differently:

- **`optional-v1`** (commitment still reserved, allocations `unknown`): the charge consumes the reservation
  (`reserved -= charged`, as the `committed` disposition does); nothing is left to release. A continuation is funded at
  claim from `work.grant` minus the lineage's observed usage (`lineageWorkUsage`, D's Corrections §1), so the conservative
  charge does not shrink it.
- **`finite-legacy`** (commitment already released at the stop, allocations `terminal`): the charge books to `used` only
  (as `released` does). A continuation is funded from the parked commitment, which must be what the lineage rule gives:
  the grant minus observed usage, i.e. the run's `remaining` as it was before the charge. That amount is reserved again
  (`reserveCommitment`) and parked as the `held` allocation and `work.grant`. It must fit the group's unallocated reserve;
  otherwise the command is refused `group-reserve-insufficient:<dimension>:<shortfall>` with no writes, and the owner raises
  the group limit first (same rule as `retry-task`, and as D's ruling for a retry after a release).

Marker: `reservationDisposition: "recovered"` with the same `handoffResolution` block as `released` (request id,
previous state and failure code, checkpoint id and hash). `"released"` ⇔ `handoffResolution` becomes
`{"released","recovered"}` ⇔ `handoffResolution`. Existing markers parse unchanged.

### 3.2a Settled during implementation

- **Evidence.** Such a run has no terminal report (no `report:` outbox row). `settlementProof` takes its stop proof from
  the handoff checkpoint, which must be `partial`, and records the checkpoint's handoff packet as the marker's `report`.
  `releasedSettlementCheckpoint` accepts a `partial` checkpoint for a run with no outcome (a failed run's checkpoint must
  still name its failure).
- **Lineage.** `lineageWorkUsage` also excludes a `recovered` marker's `remaining-grant` charge (D's Corrections §1 rule,
  applied here): otherwise the charge (all remaining attempts) leaves the continuation `budget-overrun`. A failed run's
  `remaining-grant` settlement keeps its charge in the lineage, unchanged.
- **Non-token headroom.** Continuing still needs group headroom for the continuation's non-token grant, as D ruled for a
  retry after a release; without it the claim is held `funded-allowance-unavailable` (pinned).
- **Web.** Task detail shows the settlement entry for a `settled-unrecoverable` run; a `recovered` receipt says the run
  continues from its checkpoint.

### 3.3 After

`resume-from-handoff` (or `continue-task` once dispatch resumes) accepts the run as a recoverable predecessor with no
further change. `retry-task` from it behaves as from any held handoff run.

## 4. Criteria (each seen red by deleting its own branch)

1. `optional-v1` unlimited: `release-unmetered` succeeds; run/request `settled-recoverable`; group stop `handoff-complete`;
   `resume-from-handoff` with the run's checkpoint is accepted and the continuation is claimed with
   `inheritedUsage.tokens` equal to the observed usage (literal).
2. `optional-v1` finite: `charge-remaining-grant` succeeds; `group.used` grows by the remaining grant and `reserved`
   shrinks by the same (literal); continuation as in 1.
3. `finite-legacy`: charge succeeds; the held allocation and `work.grant` equal the pre-charge remaining (literal);
   `reserved` grows by it; continuation claimed.
4. `finite-legacy` with too little reserve: refused `group-reserve-insufficient`, business tables unchanged.
5. A failed run's settlement still takes `committed`/`released` (existing criteria stay green, unmodified).
6. A `recovered` marker without `handoffResolution` (and `committed` with one) fails `usageSettlementSchema`.
7. The rewritten `tokenPolicyStop` criterion: what used to pin `current-failed-task` now pins the release succeeding.

## 5. Out of scope

A stopped run with unknown usage but no valid partial checkpoint stays held (no checkpoint to continue). Web: the
settlement entry already shows for blocked/failed runs; it is extended to this run shape only if criterion work shows it
is hidden (§B.1 of D placed it on failed or blocked runs; this run is `settled-unrecoverable`).
