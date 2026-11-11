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

## 7. Review round 1 and the answers taken (2026-11-11, Orca session `f958ec3f`)

The human was away and asked the session to proceed on its own recommendations and report them for review afterwards
("这一轮执行过程中如果有问题，先按你的建议执行。执行完在最后阶段报给我审核"), and approved rewriting necessary criteria for
this round ("这次批准改写所有必要的判据"). An independent reviewer read this proposal against the code at the commit that
added it. §1–§6 are kept as written; **this section wins where they disagree.**

**Answers.** Q1: **A**. Q2: the estimator's attempts and active time are **advisory too** (an applied `activeMs` also
shrinks the per-attempt timeout, `executionSnapshot.ts` around the freeze block; "apply when larger" would give one field
two meanings). Q3: `task accept-attempt` is a `human-only` verb with socket tier `token` — an owner in the Web UI, or a
socket agent carrying an owner's person token; a run Orca dispatched is always refused (the existing machinery; there is
no Web-only tier). Q4: finite groups keep today's per-task ceilings **exactly** (byte-identical).

**Corrected citations (§2).** Apply: `suggestedOperations` (proposal-edit) and `suggestedLoopActions` (set-task-loop) in
`budgetSuggestions.ts`, re-checked by `verifyModelField` in `webService.ts` at edit and again at confirm. Dispatch:
`dispatchedPolicy` in `executionDriver.ts` (`withinGrant` is the helper above it). The null grant with no binders comes
from `fundedAllowance.ts`, the envelope's `tokenPolicy` from `webDispatch.ts`; the CLI "unlimited (default, not
estimated)" lines are in `src/commands/domains/verbs.ts`. ccloop: `parkAllowance` and the live-threshold suppression for
group/cap binders are in `runLoop.ts`; a fully funded finite task carries no `tokenPolicy` and keeps the mid-call stop.

**Option A, made precise.**
1. Scope: **task work** amounts only (tokens, attempts, activeMs) in a group whose `limit.tokens` is null. Handoff and
   goal-review reserves are finite-only amounts and keep today's apply behaviour.
2. Where the expectation lives: **derived when the view is read**, not stored — the task's work tokens from the newest
   ready estimate whose `planHash` matches the plan, with its `estimateId` and `stale` flag. Estimates are immutable
   rows and none is created after confirm, so this needs no write, no schema change and no migration.
3. The suggestion module skips task-work dimensions when the group's token limit is null (the view gains the group
   limit structurally), and the **server refuses** `model` provenance on task-work amounts in an unlimited group
   (proposal-edit and set-task-loop), so an old Web bundle cannot set a ceiling either. A person's explicit (`human`)
   finite tokens are still accepted and keep the ceiling and #225's mid-call stop.
4. Overrun is shown: expected vs used (ratio; "unknown" when usage is unknown) on the task, the board card and the CLI.
5. Wording: CLI `apply-estimate` in an unlimited group says the estimate is now the expectation (not "already matches /
   nothing to apply"); `group show` / `proposal show` name the expectation instead of "ready but not applied"; the
   "to estimate:" hint says an estimate is advisory in unlimited groups. Rewriting the pinned lines in
   `tests/commands/unestimatedDefault.test.ts` is covered by the round's approval; #145/#160 behaviour (unestimated tasks
   confirm unlimited) is unchanged.
6. Spend caps are "enforced at claim and at phase boundaries; one phase can overshoot" (ccloop switches the live
   threshold off when a cap binds) — not a hard bound.
7. Consequences recorded, not changed now: (a) attempts and active time are counted across a task's whole run lineage
   under optional-v1, so a first run that uses all 3 default attempts cannot be retried without a top-up — the same
   shape as #234 in the attempts dimension; it goes to the human as its own question. (b) An unlimited group's
   integration-conflict run gets the 3,000,000 default instead of the largest estimate.
8. No retroactive change: confirmed groups keep their frozen contracts; an editable proposal that already carries finite
   `model` tokens confirms as before. A person converts one with a proposal-edit to `tokens: null` (provenance human).

**`task accept-attempt`, corrected (§4).**
1. The attempt commit comes from the **run's archive snapshot** (HEAD bundle, index and full tree), rebuilt into a fresh
   repository; refused by name when the snapshot is missing or partial. `refs/ccloop/run/attempts/N` is shared and
   overwritten by later runs, and the workspace is deleted after a failed run is settled. `--attempt` is dropped: only
   the last attempt has lasting evidence.
2. Before checks: the same write-set harvest (out-of-bounds paths refused) and criteria-change classification as the
   success path (an attempt that weakened its own tests is refused or flagged exactly as stepC/stepD would).
3. Two-phase: the command records the intent; the driver merges onto the group branch tip in memory and runs the task's
   setup and required checks **on the merged tree** with Orca's own runner (the post-merge check path), writes nothing
   until a compare-and-swap of the group branch, and re-merges and re-checks if the tip moved. A restart re-checks.
4. On pass: one merge commit (second parent = the attempt), an acceptance artifact `review: "operator-reviewed"`
   (principal, note, commandId, attemptSha, merged commit, setup and check commands with exit codes and output tails),
   an activity row, a code-authored record in `.decisions/<runId>.jsonl` inside the landing commit; the agent's own
   reported decisions ride along unchanged, none are invented. A new, named writer sets `work.status = "done"`.
5. Refused when: the run is not terminal, not settled, or succeeded; the task is done; a debug ladder holds the run; the
   group is reconciling, stopped, archived, a flow child, multi-dir or a `dir` project (v1).
6. Accounting is untouched (byte-identical usage, ledger, allocations).
7. The verify-only analogy in §4 is wrong: that path is a dispatched ccloop run that only re-runs checks under
   `commandChecksDecideGoal`; accept-attempt runs no ccloop and no agent.

**Order.** A and overrun visibility first; accept-attempt second (larger, touches the landing path).

## 8. Correction: `task accept-attempt` as built (2026-11-11, branch `feat/accept-attempt`, commits 3cf99d41..6589f45a)

Recorded by the implementing session; §7 above is kept as written. Where the two differ, this is what the code does, for
the human to confirm or overturn.

1. **A changed check-defining file is refused, not flagged.** §7 item 2 says "refused or flagged exactly as stepC/stepD
   would"; stepD lands a weakening with a flag, and re-runs a modification at base. accept-attempt refuses both
   (`criteria-<kind>:<signals, files>`): the person accepts on the checks' word, so checks the attempt changed cannot give
   it, and there is no base re-run here. Criterion 18 of the round asked for the refusal.
2. **Refused by name beyond §7 item 5:** an attempt with no change against its base (`empty-attempt`, D14's case); a task
   whose contract has no required checks (`no-required-checks`: nothing would be re-run); a merge conflict with the tip
   (`merge-conflict:<paths>`); a task that moved on after the command (`task-moved:<status>`); a recovery (saved-result)
   run. A run settled as `recovered` (`settled-recoverable`, task `held`) is out of scope: only `settled-failed` runs
   (close-run, or a releasing usage settlement) are accepted; a held task can still be continued.
3. **The snapshot used** is the run's newest archive snapshot (cleanup archives again after stepC); the command pins the one
   it verified, and the driver rebuilds from exactly that one.
4. **The driver waits instead of refusing** while the group is reconciling or stopped after the command was recorded; the
   command itself refuses both.
5. **A refused acceptance can be sent again** (a new command); a pending or landed one cannot.
6. **The code-authored ledger record** is a `criteria` decision `<runId>/orca-operator-accept` (major), naming the principal,
   the command and the attempt; its undo is `git revert -m 1` of the landing merge.
