# Budget defaults and person-reviewed acceptance (#224/#225/#234/#238/#241, #227) — proposal

Status: **proposal, awaiting the human's rulings (§6).** Written 2026-11-11 by the Orca session that repinned ccloop to
#225 (tester follow-up C). Nothing here is implemented. The human asked for a brainstorm; they were away, so this is the
brainstorm written down: the problem as a user meets it, what the code does today, the options, a recommendation, and
the questions only the human can answer.

## 1. The problem, as the user meets it

The tester ran real groups for two days (issue file `orca_archived_files/issue-20261023.md`, §§L, N, #224–#241):

- **With finite per-task grants the work does not finish.** Estimates were 3–11× below the real use (one 92×, #224); a
  single execute call overran its grant up to 4.86× (#225, #238); an exhausted run's automatic retry got only the
  remainder and one attempt (#234); a run that finished its work was booked `exhausted` and needed a capsule to be
  recovered (#227's T1/T3/T5/clear). The tester needed six groups to finish a nine-task requirement (§L).
- **With an unlimited group and `tokens:null` tasks, a seven-task, two-level parallel DAG finished by itself** (#241:
  7/7, 23.5M tokens, one failed run retried with its full attempts).
- **When the work is done but a framework condition is not met** (no capsule, unknown usage, a malformed final), the
  only ways forward are paying again or rebuilding by hand (#227).

What the user wants: a run that finishes, a spend they can bound, and — when the machinery cannot prove a result — a way
to look at it and accept it.

## 2. What the code does today (read 2026-11-11, citations to verify before implementing)

1. **A new requirement's group is unlimited by default**: `REQUIREMENT_LIMIT_DEFAULT = {tokens:null, …}`
   (`src/control/requirementSchemas.ts:14`); the Web token field is human-only and defaults to unlimited
   (`web/src/RequirementsPanel.tsx`).
2. **Applying an estimate makes every task hard-capped, even in an unlimited group.** `apply-estimate` writes the
   estimate's finite `tokens` and `attempts` into each task (`src/control/budgetSuggestions.ts:89-108`); confirm freezes
   them as the contract's `tokenBudget`/`maxAttempts` (`src/control/executionSnapshot.ts:215-217`); dispatch keeps the
   smaller of contract and funded grant (`withinGrant`, `src/control/executionDriver.ts:659-688`). A retry is funded with
   what is left (`src/control/fundedAllowance.ts:92`) — #234's "remainder only".
3. **Without an applied estimate, ccloop receives `tokenBudget:null`** in an unlimited group with no spend cap
   (`src/control/tokenPolicy.ts:11-14`); the CLI says "tokens: unlimited (default, not estimated)". This is the #241 path.
4. **Auto-confirm** (person-created, unlimited, draft groups) **never applies an estimate**
   (`src/control/autoConfirm.ts:58-76`; spec `2026-11-05-review-exit-over-grant-start-queue-design.md` D3).
5. **Spend caps** (`all` or one project; total, week or month; human-only) are checked at claim. In optional-v1 groups a
   cap's headroom becomes the run's grant and ccloop **parks** the run at a phase boundary (`token-allowance`) instead of
   stopping mid-call (`fundedAllowance.ts:80-111`; ccloop `src/controller/runLoop.ts:1755-1765`).
6. **ccloop #225** (now pinned) stops a claude/omp phase mid-call only when the task's own finite ceiling is the binder;
   never when `tokenBudget` is null, never for group/spend-cap binders (`ccloop/src/budget/tokenPolicy.ts:27-38`).

So the hard per-task stops the tester hit come from one step: **applying an estimate**. The estimate is a forecast; the
code turns it into a ceiling.

## 3. Options for the budget default

**A (recommended): in an unlimited group, an estimate is an expectation, not a ceiling.**
- In a group whose `limit.tokens` is null, applying an estimate records each task's estimate as `expectedTokens`
  (shown on the task, the board card and the run) and leaves the contract's `tokenBudget` null. Attempts and active
  time keep the defaults (3 attempts, 4 h) unless a person sets them; an estimator's `attempts:1` is not applied (it
  made the first exhaustion final, #162).
- Overrun is shown, not enforced: "used 3.2× its estimate" on the task, so the person learns where estimates are off.
- The hard bounds an ordinary user relies on are the **spend caps** (already human-only, already enforced at claim and
  parked at phase boundaries) and a finite **group** limit if they set one.
- Finite per-task ceilings stay available on purpose: a finite group (today's behaviour unchanged), or a person setting a
  task's tokens explicitly (`proposal-edit`, `set-task-loop`, the budget editor). Those keep #225's mid-call stop.
- Consistent with the rulings already made: #145/#160 (unestimated tasks run unlimited, "保留现行为"), #174 (soft
  amounts), spec 11-05 D2/D3 (unlimited groups do not block on over-grant, no automatic estimate).

**B: keep the ceiling, calibrate the estimator.** Multiply estimates by an observed factor (ledger actual ÷ estimate per
agent × model). Needs data per pair that we do not have (n is small, spread 3–92×); a calibrated ceiling still stops
work at the tail. Can be added later on top of A as a better *expectation*.

**C: keep today's behaviour, improve the wording.** Cheapest; leaves the tester's main failure in place.

Why A over B: in A a wrong estimate costs information, in B it costs a stopped task and a second payment. The person's
real worry — runaway spend — is what spend caps are for, and they already bind at the right place.

## 4. Person-reviewed acceptance (#227)

What is left after #206 (exhausted completion source) and #158 (verification-only source): a run whose work is published
as an attempt commit, but which no recovery path accepts — a final the strict decoder rejects outside OMP's opt-in
case, a historical exhausted run without a capsule, an attempt whose usage is unknown.

**Proposal: `task accept-attempt <group> <task> --run <run> [--attempt N] --note <why>`, human-only.**
- Orca reads the published attempt ref (`refs/ccloop/run/attempts/N` from the run's bundle) and runs the task's
  **required checks** on it the way verify-only recovery does (setup first, Orca's own check runner) — no verifier
  model, no new agent call, no payment beyond the checks' machine time.
- Checks pass ⇒ the attempt is landed like any other (merge into the group branch, post-merge checks of R2), with
  acceptance recorded as `operator-reviewed`: the person's principal, the note, the attempt sha, the check outputs. No
  normalized hash, no rebuilt answer, no decisions written for the agent (the ledger records the person's acceptance
  instead). Checks fail ⇒ refused with the failing command; nothing lands.
- **Accounting is separate and unchanged**: the run must already be settled (`close-run`, `settle-usage`, or the soft
  mode's automatic floor). Accepting never changes what was spent.
- The Web shows it on the run detail of a terminal run with a published attempt: "Accept this attempt after checks",
  with the diff stat and the check list.

**Not proposed now:** the group-level `strict / standard / open` policy from #227. One explicit, human-only escape
hatch covers the cases the tester showed; a policy that skips checks by default is a larger change to what "done" means.

## 5. Order of work if accepted

1. A: estimate as expectation in unlimited groups (server: `budgetSuggestions`/`estimateSettlement`/snapshot; Web and
   CLI wording; criteria for both group kinds; the finite path byte-identical).
2. Overrun visibility (expected vs used on task, card and run).
3. `task accept-attempt` (ccloop: confirm the published-attempt evidence a terminal run keeps; Orca: command, checks,
   landing, ledger record, Web entry).

## 6. Questions for the human

- **Q1.** Option A for unlimited groups — yes / no / B / C?
- **Q2.** In A, should the estimator's attempts and active time also be advisory, or applied when larger than the
  defaults?
- **Q3.** `task accept-attempt` human-only (recommended), or also an agent with a person token's delegation?
- **Q4.** Should a finite group keep today's per-task ceilings exactly (recommended), or also switch to expectations
  under the group limit?
