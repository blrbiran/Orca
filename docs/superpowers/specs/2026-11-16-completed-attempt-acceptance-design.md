# Completed-but-unsettled attempts can be accepted by their owner

**Status:** accepted 2026-11-16 (session `2026-11-16`, human ruling: continue and report at the end).
**Issues:** #230, #227 follow-up, the live `g-28d9b560/review-fix-4` run.
**Builds on:** `2026-11-11-budget-defaults-and-reviewed-acceptance-design.md` §7 (`task accept-attempt`).

## The problem

`task accept-attempt` today admits only a run that is both `settled-failed` and inactive. Two common
shapes have no supported way out even though their work is complete and a whole archive snapshot exists:

1. **A live-ceiling stop during `verify`.** The execute phase completed and its tree is in the archive,
   but the run is `settled-recoverable` with `drive.outcome="exhausted"`; `active=1`,
   `drive.cleanedUp=false`. `close-run` needs `isTerminallyFailedRun` (blocked at C, or a closed
   `settled-failed`), `verify-saved-result` says `saved-result-exhausted`, and `recovery retry` has
   nothing to resume. The task is blocked forever although its work passed independent review.
   This is `g-28d9b560/review-fix-4`: snapshot `missing: []`, `drive.base` = the group tip, checks
   independently 22/22 and AC4 reproduced.
2. **An E-block whose work already landed.** `outcome="succeeded"`, `drive.landedCommit` set, the
   checkpoint was never committed; all three recovery commands refuse (#230). The tree is in the
   archive; the branch already contains it.

## Decision

Extend `task accept-attempt` (one verb, one authority path) to admit a **completed-but-unsettled**
run when a complete archive snapshot exists. The command converts the run to the acceptance pipeline's
input shape in the same transaction:

- keep `drive.outcome` exactly as it is (`exhausted` or `succeeded`) — never rewrite history;
- add `operatorSettlement: {kind:"completed-attempt", outcome, at, principal}`;
- set `run.state="settled-failed"` and `active=0` (the existing acceptance driver requires this);
- set the work item's `status` to `blocked` when it was `running` (the acceptance driver and
  `completeAcceptedAttempt` are written against a blocked current run);
- record `operatorAcceptance` exactly as today (snapshot, note, principal, pending);
- for a run that never settled (`blocked` at E), release the remainder the run still holds
  (`finiteCommitment(run.remaining.work)` + `run.remaining.handoff`) and mark the task allocations
  terminal, exactly as `close-run` does; for an already settled `settled-recoverable` row, do not
  release again — the checkpoint settle already did.

The existing driver (`acceptAttemptDriver.ts`) then does what it already does: rebuild the attempt
from the snapshot, harvest against the write set, refuse a weakened check, merge onto the group tip,
run setup + required checks, CAS-land, write the `orca-operator-accept` ledger decision, mark the task
done. No provider call and no re-execution.

## Eligibility (all of)

- run phase `work`, no `mode`, no `recoveryOf`, `taskId` matches the command;
- `drive.outcome !== null`;
- either the existing shape (`state="settled-failed"`, `active=0`) or one of:
  - `state="settled-recoverable"` and `drive.outcome="exhausted"`; or
  - `state="blocked"`, `drive.blockedAt="E"`, `drive.outcome="succeeded"`;
- `work.currentRunId === runId`, `work.targetVersion === run.targetVersion`, newest run for the task;
- the work item is `blocked` or `running` (not `done`);
- `prepareAcceptAttempt` returns a complete snapshot (`missing: []`, every index blob and the bundle
  verified);
- no debug ladder, no reconciling sibling, group not stopped/archived, person principal (unchanged).

Refusals keep the existing codes; `accept-attempt-run-not-settled` now means "active/running and not
one of the admitted shapes". A successful normal run (`state="settled"`, outcome `succeeded`) still
refuses `accept-attempt-run-succeeded`.

## E-block already landed

When `drive.attemptSha` is set and is an ancestor of the group tip, the attempt is already on the
branch. The driver must not create a second merge commit: after rebuilding and harvesting, it records
the acceptance proof with `landing:"already-landed"`, stages it with `next=old=tip`, and finishes
without a CAS. The acceptance decision names the existing commit.

## Non-goals

- No automatic acceptance: a person still reviews and supplies the note.
- No provider call, no retry, no budget top-up.
- No multi-directory or dir groups, no recovery runs, no flow children (unchanged refusals).
- No bypass of setup or required checks; a failing check still refuses by name.
- No rewrite of `drive.outcome`, usage, or the run's ledger.

## Tests

1. A `settled-recoverable`/`exhausted` run with a complete snapshot: the command records the intent,
   converts the row (`settled-failed`, `active=0`, `operatorSettlement`), the driver lands it, the
   task becomes `done`, and the group's usage is unchanged. Mutation: drop the new state from the
   eligibility predicate → the command refuses (red).
2. An E-block (`blocked`/E/`succeeded`) whose `drive.attemptSha` is already on the branch: the
   command is accepted, the driver records `already-landed`, no second merge commit appears, and the
   task becomes `done`. Mutation: always merge → a duplicate commit appears (red).
3. A `settled-recoverable` run with a partial snapshot still refuses `accept-attempt-snapshot-partial`.
4. An `accepted`/`running` run still refuses `accept-attempt-run-not-settled`.
5. The existing accepted-failure path (closed failure → accept → land) stays green.

## Correction (2026-11-19, change-sized runs P2)

Appended by the change-sized runs P2 implementer (Orca session `3ba26002`, branch `feat/change-sized-p2`); the text above is
unchanged. Pointer only: `2026-11-19-change-sized-runs-design.md` (its §5.5.1, §7.2, and its "Correction (2026-11-19, change-sized
runs P2 as built against ccloop P1)") is what ships. "Eligibility" (line 54): a v2 snapshot is whole when `verifySnapshotInRepository` passes in the run's target (base present, bundle base..attempt, tree). Applies only to a run whose A2 found a ccloop advertising
`features.attemptRef "v1"`; every other run behaves as this spec says.
