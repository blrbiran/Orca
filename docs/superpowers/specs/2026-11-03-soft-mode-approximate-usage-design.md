# Unknown usage in the unlimited soft mode: book the floor as approximate and keep running

Who: Claude Code session `43913afc`, 2026-11-03. Human ruling (verbatim): 「同意。我们之前的很多裁定在新的语义下可能有一些过期了，一些需要、可以修改。」 on the proposal "in soft (unlimited-token) mode book the lower bound, mark it approximate, keep running; capped mode unchanged."

## 1. The problem, from the person's side

Unknown usage is the most common way a group gets stuck (tester #98, #101, #104, #116, #117 are one shape). A run or a call ends and the tool did not report its usage (a killed process, a timeout, an omp stream that stopped). Today:

- **Loop run** (a task's ccloop run): the run settles with `unknown.work`; `groupUsageUnknown` makes the group's `ledger.usageUnknown` true; no further claim is made (`webDispatch.ts` claim path, `controlOverview.ts` start gate). The person must run `settle-unknown-usage` (human-only): `charge-remaining-grant` for a finite remainder, `release-unmetered` for an unlimited one (books nothing).
- **Single call** (requirement clarify/split, estimate, flow call): blocked at C with `<purpose>-usage-unknown[:<failure>]`; the person charges the call's whole remaining grant (`REQUIREMENT_CALL_GRANT` is 1,000,000 tokens) through `recovery-retry` with the acknowledgement.

In the default mode a person chose "no token limit". Stopping the whole group to ask them to account for tokens they said they do not limit is the wrong trade, and charging a million tokens for a call that observed 1,234 is wrong the other way.

## 2. The rule

A run is **in the unlimited mode** when its group's token limit is unlimited (`group.limit.tokens === null`; the requirement default `REQUIREMENT_LIMIT_DEFAULT`, and a confirmed soft group with no token cap). Flow parents are excluded: their pool is always finite (flow D1 (a)).

When such a run's usage is unknown at the point where Orca would block or flag it, Orca settles it by code, in the same transaction that would have blocked it:

1. Book `floor` = ccloop's observed lower bound (`usageLowerBound.tokens` on the loop report; `singleCallUsageLowerBound` on a single-call record), or **0 when there is none**, as the run's work usage.
2. Mark the run `usageApproximate: { floorTokens: number | null, reason: <the block reason it replaced>, at }`. `floorTokens: null` means the tool gave no number; the view shows "unknown (at least 0)", never a bare 0 (goal.md P7).
3. Clear `unknown.work` / `unknown.handoff`, recompute the group's flag, and go on exactly as a known-usage completion goes on. A single call's purpose is told the failure it would have been told after a person's settlement, so its retry rule runs.
4. Write an activity row `usage-approximated` naming the floor and the replaced reason.

Everything else is unchanged: a group with a finite token limit, and every flow call. (A call with a finite grant inside an unlimited group follows its group: D2.)

Rule 5 holds: all of this is code.

## 3. Decisions (made by the controller under Rule 1 rung 2 -- each is reversible; listed for the human's review)

- **D1. No floor at all ⇒ continue, booked as 0 and marked `floorTokens: null`.** The alternative (block as today when there is no floor) keeps the most common stuck case: a process killed before any usage line. The cost is a total that under-counts with no number to show; the mark makes every such total read as "at least".
- **D2. A requirement call in an unlimited group** has a finite grant (1,000,000) inside an unlimited group. It follows the group: approximate floor, no charge of the grant. The finite grant is a reservation size, not a limit the person set.
- **D3. Spend caps** (account-level) still read booked usage: the floor counts toward them. A floor under-counts, so it can let a cap be passed later, never trip one wrongly. A group under an active spend cap is still "unlimited" for this rule; the cap itself keeps blocking new claims when reached, as now.
- **D4. Runs already blocked or flagged when this ships** are settled by the same rule on the driver's next pass (startup recovery reads them). Otherwise the people stuck today stay stuck.
- **D5. No later replacement of an approximate figure** in this change. If a real number arrives later (it does not today: ccloop reports usage once), that is a separate design.

## 4. What this supersedes (named, not rewritten)

- Spec 2026-10-27 single-call unknown usage **D3** ("auto-settlement from the observed floor: no, a floor can under-count") and **§9 R1–R4** for unlimited groups: they now apply only to finite groups.
- Flow call settlement spec 2026-11-01 **§8** "Not in scope: auto-settlement from the observed floor": unchanged for flows (pools are finite).
- The tester-round-3 rule that the settlement panel shows "at least N tokens" stays: it is now the shown value of an approximate run too.

Each superseded spec gets an appended correction pointing here when this is implemented.

## 5. Criteria to write first (each with a mutation seen red)

1. An unlimited group's loop run ending with unknown usage and a floor of N: the run is marked approximate with N, the group's flag stays false, and the next task is claimed with no person in between.
2. The same with no floor: booked 0, `floorTokens: null`, the view says "unknown (at least 0)".
3. A finite group's run: blocks and flags exactly as today (the existing criteria stay green, unchanged).
4. An unlimited requirement group's clarify call with unknown usage: no block, approximate floor booked, the round's retry rule runs; the 1,000,000 grant is not charged.
5. A flow call: still blocks (finite pool).
6. A run blocked before the change is settled on the driver's next pass (D4).
7. The usage ledger rows carry the floor; a spend cap sees it.
8. The panel marks approximate figures in the run, task and group totals.

## 6. Out of scope

Changing the finite-mode settlement; flow pools; how ccloop measures the floor.

## 7. As built (session `43913afc`, 2026-11-03) -- single calls only

- **Done: single calls** (requirement clarify and split, estimates; not flow calls). `src/control/approximateUsage.ts`; the hook is in `stepCSingleCall` where it would have blocked: when the group's `limit.tokens` is null it books the floor and runs the purpose's `completeInTransaction` in the same transaction. The floor is booked as ordinary usage (reserved → used, into `cumulative`, `remaining = max(grant - cumulative, 0)`), so every later check (`verifyStoppedSingleCall`, `assertCallUsageBooked`, the purpose's give-back) is unchanged.
- **D6 (added): a complete answer whose usage was not reported is used**, not thrown away as a person's settlement does (that path never trusts the output). Usage unknown is an accounting gap, not a bad answer; discarding it would pay for the call twice.
- **Marks:** run body `usageApproximate {floorTokens|null, reason, at}` (strict run schema, `controlViews.ts`); run view `usageApproximate {floorTokens}` with a badge in the runs table; requirement view `ledger.approximateRuns` with a note on the Requirements page. Activity: `usage-settled`, method `approximate-floor`, principal `orca-auto`. **Usage ledger rows stay `quality: unattributed`**: adding `approximate` needs a table rebuild (the column has a CHECK); not done.
- **Not done: loop runs** (criteria 1, 2, 6 of §5 for tasks). Their settlement writes a `usageSettlement` marker validated against the command ledger's principal (`settlingPersonFor`, `hasValidUsageSettlement`), and ccloop's saved-result recovery receipt checks that principal (`client`/`personPrincipal`, ccloop `savedResultRecovery.ts`). An automatic principal is therefore a cross-repo contract change: design it with ccloop first. Until then an unlimited group's loop run with unknown usage still waits for `settle-unknown-usage` (`release-unmetered`, which books nothing).
- **D4 (runs already blocked when this ships)** is not done either: a single call already blocked at C keeps the person's charge path.
- Criteria: `tests/control/softModeApproximateUsage.test.ts` (5), `web/tests/requirementUsageApproximate.test.tsx` (2), `web/tests/estimateChargeRetry.test.tsx` (last describe). Mutations S1–S10 seen red.

## 8. Correction (2026-11-12, tester follow-up F §2, #116; Orca session `5abcad7d`, seat w2, on main `b858261c`)

The text above is kept as written. §6 ("changing the finite-mode settlement" out of scope) and the rule that finite groups
keep the person's charge of the whole grant no longer hold as stated, by the human's 「要改」 on #116 (ledger
`.superpowers/sdd/2026-11-12-tester-followup-f/progress.md`, decision C3):

- A requirement or estimate call blocked on unknown usage in a **finite** group may now be settled with
  `recovery-retry --acknowledge charge-observed-floor` as well as `charge-remaining-grant`: it books the call's observed
  floor (`singleCallUsageLowerBound`, the record's `usageLowerBound` this design reads) by the same arithmetic as §2 here
  (`bookCallFloor`, extracted from `bookApproximateFloorInTransaction` in `src/control/approximateUsage.ts`), marks the
  run `usageApproximate`, and records `singleCallSettlement.method: "observed-floor"` (only-add). It needs a known floor
  (`observed-floor-unknown` otherwise) and a finite remainder (`unlimited-remainder`), and is explicit, never automatic.
  Principal as `charge-remaining-grant` (person or `agent:<client>`; refused to a run Orca dispatched).
- **Flow calls are unchanged**: the form is refused for them (`run-usage-not-settleable:flow-call`); they keep the
  grant charge, as §2 keeps them out of the soft path.
- Criteria: `tests/control/observedFloorSettlement.test.ts` (single-call describe), `tests/flow/flowCallSettlement.test.ts`
  (the flow-call refusal), `web/tests/observedFloorSettlement.test.tsx` (ChargeRetry).
